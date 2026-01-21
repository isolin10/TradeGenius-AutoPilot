// ==UserScript==
// @name         TradeGenius Auto Swap - Optimism USDC/USDT
// @namespace    https://www.tradegenius.com
// @version      1.0.0
// @description  Automated USDC/USDT swap on Optimism chain with P3 pool
// @author       @ferdie_jhovie
// @match        https://www.tradegenius.com/trade
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // 防止在 iframe 中重复运行
    if (window.top !== window.self) return;

    // ==================== 配置参数 ====================
    const CONFIG = {
        // 延迟设置（毫秒）
        waitAfterChoose: 1500,
        waitAfterTokenSelect: 2000,
        waitAfterSearch: 2000,
        waitAfterP3: 1500,
        waitAfterMax: 1000,
        waitBeforeConfirm: 5000,        // 点击 Confirm 前的缓冲等待
        waitAfterConfirm: 3000,
        waitAfterClose: 1500,
        waitBetweenRounds: 8000,

        // 交易成功后的随机等待（毫秒）
        waitAfterTradeMin: 5000,
        waitAfterTradeMax: 8000,

        // 交易设置
        targetChain: 'Optimism',
        poolLevel: 'P3',
        token1: 'USDC',
        token2: 'USDT',

        // 重试设置
        maxRetryConfirm: 20,

        // 按钮加载超时设置（毫秒）
        buttonLoadingTimeout: 30000, // 30秒

        // 调试
        debug: true
    };

    // ==================== 全局变量 ====================
    let isRunning = false;
    let currentFromToken = null;
    let buttonLoadingStartTime = null; // 按钮开始加载的时间
    let stats = {
        totalSwaps: 0,
        successfulSwaps: 0,
        failedSwaps: 0,
        startTime: null
    };

    // ==================== 工具函数 ====================
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const randomWait = (min, max) => {
        const wait = Math.floor(Math.random() * (max - min + 1)) + min;
        return wait;
    };

    const log = (msg, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        const prefix = `[${time}]`;

        const colors = {
            info: '#3b82f6',
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b'
        };

        console.log(`%c${prefix} ${msg}`, `color: ${colors[type]}; font-weight: bold`);

        if (UI.logEl) {
            UI.logEl.textContent = `${prefix} ${msg}\n` + UI.logEl.textContent.slice(0, 1500);
        }
    };

    // ==================== DOM 查找函数 ====================
    const findChooseButtons = () => {
        return Array.from(document.querySelectorAll('button'))
            .filter(b => {
                const text = b.innerText.trim();
                const spanText = b.querySelector('span')?.innerText?.trim() || '';
                return text === 'Choose' || spanText === 'Choose' ||
                    text === '选择' || spanText === '选择';
            });
    };

    const findMaxButton = () => {
        return Array.from(document.querySelectorAll('button'))
            .find(b => b.innerText.trim().toUpperCase() === 'MAX');
    };

    const findConfirmButton = () => {
        return Array.from(document.querySelectorAll('button'))
            .find(b => {
                const text = b.innerText.trim().toUpperCase();
                return text.includes('CONFIRM') || text.includes('确认') || text.includes('PLACE');
            });
    };

    const findCloseButton = () => {
        return Array.from(document.querySelectorAll('button'))
            .find(b => {
                const text = b.innerText.trim().toUpperCase();
                const hasClass = (b.className || '').includes('bg-genius-pink');
                return (text === 'CLOSE' || text === '关闭') && hasClass;
            });
    };

    const isDialogOpen = () => {
        return !!document.querySelector('[role="dialog"][data-state="open"]');
    };

    // 检查按钮加载超时
    const checkButtonLoadingTimeout = () => {
        // 查找加载中的 Swap 按钮（disabled 且有 loading spinner）
        const loadingButton = document.querySelector('button.bg-genius-pink[disabled] svg.animate-spin');

        if (loadingButton) {
            // 按钮正在加载
            if (!buttonLoadingStartTime) {
                buttonLoadingStartTime = Date.now();
                log('检测到 Swap 按钮加载中...', 'info');
            } else {
                const elapsedTime = Date.now() - buttonLoadingStartTime;
                const remainingTime = Math.ceil((CONFIG.buttonLoadingTimeout - elapsedTime) / 1000);

                if (elapsedTime > CONFIG.buttonLoadingTimeout) {
                    log(`⚠️ Swap 按钮加载超时（${CONFIG.buttonLoadingTimeout / 1000}秒），刷新页面...`, 'error');
                    buttonLoadingStartTime = null;
                    window.location.reload();
                    return true;
                } else if (remainingTime <= 10 && remainingTime % 5 === 0) {
                    log(`按钮加载中... 剩余 ${remainingTime} 秒`, 'warning');
                }
            }
        } else {
            // 按钮不在加载状态，重置计时器
            if (buttonLoadingStartTime) {
                log('✓ Swap 按钮加载完成', 'success');
                buttonLoadingStartTime = null;
            }
        }

        return false;
    };

    // ==================== 核心交易函数 ====================

    // 选择第一个代币（余额最大的 USDC 或 USDT）
    async function selectFirstToken() {
        log('选择发送代币（余额最大）...', 'info');

        await sleep(CONFIG.waitAfterChoose);

        const tokenRows = document.querySelectorAll('[role="dialog"] .cursor-pointer');
        let maxBalance = -1;
        let targetRow = null;
        let targetSymbol = null;

        tokenRows.forEach(row => {
            const symbolEl = row.querySelector('.text-xs.text-genius-cream\\/60');
            const symbol = symbolEl?.innerText?.trim();

            if (symbol === 'USDT' || symbol === 'USDC') {
                const balanceText = row.querySelector('.flex.flex-nowrap.justify-end')?.innerText || '';
                const balanceMatch = balanceText.match(/[\d,\.]+/);

                if (balanceMatch) {
                    const balance = parseFloat(balanceMatch[0].replace(/,/g, ''));
                    log(`发现 ${symbol}: 余额 ${balance}`, 'info');

                    if (balance > maxBalance) {
                        maxBalance = balance;
                        targetRow = row;
                        targetSymbol = symbol;
                    }
                }
            }
        });

        if (targetRow) {
            targetRow.click();
            currentFromToken = targetSymbol;
            log(`✓ 选择了 ${targetSymbol} (余额: ${maxBalance})`, 'success');
            return true;
        }

        log('未找到 USDT/USDC', 'error');
        return false;
    }

    // 选择第二个代币（与第一个相反，Optimism 链）
    async function selectSecondToken() {
        // 调试：显示当前选择的代币
        log(`当前第一个代币: ${currentFromToken}`, 'info');

        const targetToken = currentFromToken === 'USDT' ? 'USDC' : 'USDT';
        log(`选择接收代币: ${targetToken} (Optimism)`, 'info');

        // 确保不选择相同的代币
        if (targetToken === currentFromToken) {
            log(`❌ 错误：目标代币与发送代币相同！`, 'error');
            return false;
        }

        await sleep(CONFIG.waitAfterChoose);

        // 1. 点击 Stable 标签
        log('查找 Stable 标签...', 'info');

        let stableTab = null;

        // 方法 1: 精确类名
        const method1 = document.querySelectorAll('.flex.flex-col.text-sm.cursor-pointer.text-genius-cream');
        for (const tab of method1) {
            if (tab.innerText.trim() === 'Stable' || tab.innerText.trim() === '稳定') {
                stableTab = tab;
                log('✓ 找到 Stable 标签（方法1）', 'info');
                break;
            }
        }

        // 方法 2: 查找所有包含 cursor-pointer 的 div
        if (!stableTab) {
            const method2 = document.querySelectorAll('[role="dialog"] div[class*="cursor-pointer"]');
            for (const tab of method2) {
                const text = tab.innerText?.trim();
                if (text === 'Stable' || text === '稳定') {
                    stableTab = tab;
                    log('✓ 找到 Stable 标签（方法2）', 'info');
                    break;
                }
            }
        }

        if (stableTab) {
            stableTab.click();
            log('✓ 点击 Stable 标签', 'success');
            await sleep(1000);
        } else {
            log('❌ 未找到 Stable 标签', 'warning');
        }

        await sleep(500);

        // 2. 查找并点击目标代币行
        log(`查找 ${targetToken} 代币...`, 'info');

        // 使用正确的选择器：.cursor-pointer
        const rows = document.querySelectorAll('[role="dialog"] .cursor-pointer');
        let targetRow = null;

        log(`找到 ${rows.length} 个可点击的元素`, 'info');

        // 查找包含目标代币的行
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const text = row.textContent || '';

            // 检查是否包含代币符号和价格符号（确保是代币行）
            const hasUSDT = text.includes('USDT');
            const hasUSDC = text.includes('USDC');
            const hasPrice = text.includes('$');

            if (targetToken === 'USDT' && hasUSDT && !hasUSDC && hasPrice) {
                targetRow = row;
                log(`✓ 找到 USDT 代币行`, 'success');
                break;
            } else if (targetToken === 'USDC' && hasUSDC && !hasUSDT && hasPrice) {
                targetRow = row;
                log(`✓ 找到 USDC 代币行`, 'success');
                break;
            }
        }

        if (!targetRow) {
            log(`❌ 未找到 ${targetToken} 代币行`, 'error');
            return false;
        }

        // 3. 点击代币行，打开链选择浮动菜单
        log('点击代币行打开链选择菜单...', 'info');
        targetRow.click();
        await sleep(1500);

        // 4. 在浮动菜单中查找并点击 Optimism 链按钮
        log('在浮动菜单中查找 Optimism 链按钮...', 'info');

        let optimismButton = null;

        for (let i = 0; i < 10; i++) {
            // 查找所有元素
            const allElements = document.querySelectorAll('*');

            for (const el of allElements) {
                const text = el.innerText?.trim();

                // 检查是否是 Optimism 元素（精确匹配）
                if (text === 'Optimism') {
                    // 检查元素是否可见
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);

                    if (rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        el.offsetParent !== null) {

                        // 关键：确保这个元素不是代币行内的图标
                        // 浮动菜单中的 Optimism 元素应该在代币行下方
                        const targetRowRect = targetRow.getBoundingClientRect();

                        // 浮动菜单应该在代币行下方（Y 坐标更大）
                        if (rect.top > targetRowRect.bottom) {
                            // 找到可点击的父元素
                            let clickTarget = el;
                            let parent = el.parentElement;
                            let attempts = 0;

                            while (parent && attempts < 5) {
                                const classes = parent.className || '';
                                if (classes.includes('cursor-pointer') ||
                                    parent.tagName === 'BUTTON' ||
                                    parent.onclick) {
                                    clickTarget = parent;
                                    break;
                                }
                                parent = parent.parentElement;
                                attempts++;
                            }

                            optimismButton = clickTarget;
                            log(`✓ 找到浮动菜单中的 Optimism 链按钮（尝试 ${i + 1}/10）`, 'success');
                            break;
                        }
                    }
                }
            }

            if (optimismButton) break;
            await sleep(300);
        }

        if (!optimismButton) {
            log('⚠️ 未在浮动菜单中找到 Optimism 链按钮', 'warning');
            return false;
        }

        // 5. 点击 Optimism 链按钮
        optimismButton.click();
        log(`✓ 选择了 ${targetToken} (Optimism 链)`, 'success');
        await sleep(1000);

        return true;
    }

    // 主交易循环
    async function executeSwapLoop() {
        if (window.botRunning) {
            log('脚本已在运行中！', 'warning');
            return;
        }

        window.botRunning = true;
        isRunning = true;
        stats.startTime = Date.now();
        UI.setRunning(true);

        log('🚀 自动交易启动！', 'success');
        log(`配置: ${CONFIG.token1} ⇄ ${CONFIG.token2} on ${CONFIG.targetChain}`, 'info');

        await sleep(1200);

        while (isRunning) {
            try {
                // 检查按钮加载超时
                if (checkButtonLoadingTimeout()) {
                    break; // 页面将刷新，退出循环
                }

                log(`\n========== 新一轮交易 ${new Date().toLocaleTimeString()} ==========`, 'info');

                // 1. 检查并关闭成功弹窗
                const closeBtn = findCloseButton();
                if (closeBtn) {
                    closeBtn.click();
                    log('✓ 关闭交易完成弹窗', 'success');
                    await sleep(CONFIG.waitAfterClose);
                    continue;
                }

                // 2. 检查是否需要选择代币
                const chooseBtns = findChooseButtons();

                if (chooseBtns.length > 0) {
                    log(`检测到 ${chooseBtns.length} 个 Choose 按钮，开始选币...`, 'info');

                    currentFromToken = null;

                    // 点击第一个 Choose（发送代币）
                    chooseBtns[0].click();
                    log('点击第一个 Choose (发送)', 'info');
                    await sleep(CONFIG.waitAfterChoose);

                    if (isDialogOpen()) {
                        const success = await selectFirstToken();
                        if (!success) {
                            log('选择第一个代币失败', 'error');
                            await sleep(2000);
                            continue;
                        }
                        await sleep(CONFIG.waitAfterTokenSelect);
                    }

                    // 调试：确认第一个代币已选择
                    log(`✓ 第一个代币已设置为: ${currentFromToken}`, 'success');

                    // 点击第二个 Choose（接收代币）
                    await sleep(500);
                    const chooseBtns2 = findChooseButtons();

                    if (chooseBtns2.length > 0) {
                        chooseBtns2[0].click();
                        log('点击第二个 Choose (接收)', 'info');
                        await sleep(CONFIG.waitAfterChoose);

                        if (isDialogOpen()) {
                            const success = await selectSecondToken();
                            if (!success) {
                                log('选择第二个代币失败', 'error');
                                await sleep(2000);
                                continue;
                            }
                            await sleep(CONFIG.waitAfterTokenSelect);
                        }
                    }

                    log('✓ 代币选择完成', 'success');
                    await sleep(1000);
                    continue;
                }

                // 3. 点击 MAX
                const maxBtn = findMaxButton();

                if (maxBtn && maxBtn.disabled) {
                    log('MAX 按钮被禁用，跳过...', 'warning');
                    await sleep(2000);
                    continue;
                }

                if (maxBtn && !maxBtn.disabled) {
                    maxBtn.click();
                    log('✓ 点击 MAX', 'success');
                    await sleep(CONFIG.waitAfterMax);
                } else if (!maxBtn) {
                    log('未找到 MAX 按钮', 'warning');
                    await sleep(2000);
                    continue;
                }

                // 4. 点击 Confirm
                log('等待 5 秒缓冲...', 'info');
                await sleep(CONFIG.waitBeforeConfirm);

                let confirmClicked = false;

                for (let i = 0; i < CONFIG.maxRetryConfirm; i++) {
                    const confirmBtn = findConfirmButton();

                    if (confirmBtn && !confirmBtn.disabled) {
                        confirmBtn.click();
                        log(`✓ 点击 Confirm (第 ${i + 1} 次)`, 'success');
                        confirmClicked = true;
                        stats.successfulSwaps++;
                        break;
                    }

                    await sleep(500);
                }

                if (confirmClicked) {
                    await sleep(CONFIG.waitAfterConfirm);

                    // 等待并检测交易成功提示
                    log('等待交易成功提示...', 'info');
                    let swapSuccessDetected = false;

                    for (let i = 0; i < 20; i++) {
                        // 查找包含 "Swap" 文本的提示元素
                        const swapElements = document.querySelectorAll('.text-genius-pink');

                        for (const el of swapElements) {
                            if (el.innerText.trim() === 'Swap') {
                                // 检查父元素是否包含代币信息
                                const parent = el.closest('.flex.gap-2.flex-col');
                                if (parent) {
                                    const text = parent.innerText;
                                    if ((text.includes('USDT') && text.includes('USDC')) ||
                                        (text.includes('USDC') && text.includes('USDT'))) {
                                        swapSuccessDetected = true;
                                        log('✓ 检测到交易成功提示！', 'success');
                                        break;
                                    }
                                }
                            }
                        }

                        if (swapSuccessDetected) break;
                        await sleep(500);
                    }

                    if (!swapSuccessDetected) {
                        log('⚠️ 未检测到交易成功提示，可能交易失败', 'warning');
                        stats.failedSwaps++;
                        await sleep(2000);
                        continue;
                    }

                    // 关闭成功弹窗
                    await sleep(1000);
                    const closeAfterConfirm = findCloseButton();
                    if (closeAfterConfirm) {
                        closeAfterConfirm.click();
                        log('✓ 关闭成功弹窗', 'success');
                        await sleep(CONFIG.waitAfterClose);
                    }

                    stats.totalSwaps++;
                    stats.successfulSwaps++;

                    // 随机等待 5-8 秒
                    const randomWaitTime = randomWait(CONFIG.waitAfterTradeMin, CONFIG.waitAfterTradeMax);
                    log(`✓ 交易完成！总计: ${stats.totalSwaps}`, 'success');
                    log(`随机等待 ${(randomWaitTime / 1000).toFixed(1)} 秒后继续...`, 'info');
                    await sleep(randomWaitTime);
                } else {
                    log('Confirm 未成功，重试...', 'warning');
                    stats.failedSwaps++;
                    await sleep(2000);
                }

            } catch (error) {
                log(`运行出错: ${error.message}`, 'error');
                console.error(error);
                stats.failedSwaps++;
                await sleep(3000);
            }
        }

        window.botRunning = false;
        UI.setRunning(false);
        log('🛑 自动交易已停止', 'warning');
    }

    function stopSwapLoop() {
        isRunning = false;
        window.botRunning = false;
        UI.setRunning(false);

        const runtime = stats.startTime ? Math.floor((Date.now() - stats.startTime) / 1000) : 0;
        const minutes = Math.floor(runtime / 60);
        const seconds = runtime % 60;

        log('🛑 停止交易', 'warning');
        log(`统计: 总计 ${stats.totalSwaps} | 成功 ${stats.successfulSwaps} | 失败 ${stats.failedSwaps}`, 'info');
        log(`运行时间: ${minutes}分${seconds}秒`, 'info');
    }

    // ==================== UI 界面 ====================
    const UI = {
        root: null,
        statusDot: null,
        statusText: null,
        btnToggle: null,
        logEl: null,

        mount() {
            if (this.root) return;

            const root = document.createElement('div');
            root.style.cssText = `
        position: fixed; right: 16px; bottom: 16px; z-index: 999999;
        width: 320px; font-family: ui-sans-serif, system-ui, -apple-system;
        border-radius: 12px; overflow: hidden;
        background: rgba(17,24,39,.95); color: #e5e7eb;
        backdrop-filter: blur(8px);
        box-shadow: 0 10px 30px rgba(0,0,0,.3);
      `;

            // Header
            const header = document.createElement('div');
            header.style.cssText = `
        padding: 12px 14px; display: flex; align-items: center; gap: 10px;
        border-bottom: 1px solid rgba(255,255,255,.1);
      `;

            const dot = document.createElement('span');
            dot.style.cssText = `
        width: 10px; height: 10px; border-radius: 999px;
        background: #dc2626; display: inline-block;
      `;

            const titleWrap = document.createElement('div');
            titleWrap.style.cssText = `display: flex; flex-direction: column; line-height: 1.2;`;

            const title = document.createElement('div');
            title.textContent = 'TradeGenius Auto Swap';
            title.style.cssText = `font-weight: 700; font-size: 13px;`;

            const status = document.createElement('div');
            status.textContent = 'STOPPED';
            status.style.cssText = `font-size: 11px; opacity: .85;`;

            titleWrap.appendChild(title);
            titleWrap.appendChild(status);

            const btn = document.createElement('button');
            btn.textContent = 'Start (Ctrl+S)';
            btn.style.cssText = `
        margin-left: auto; border: 0; cursor: pointer; color: white;
        background: #16a34a; padding: 8px 12px; border-radius: 8px;
        font-weight: 700; font-size: 11px; transition: all .2s;
      `;
            btn.onmouseover = () => btn.style.opacity = '.8';
            btn.onmouseout = () => btn.style.opacity = '1';

            header.appendChild(dot);
            header.appendChild(titleWrap);
            header.appendChild(btn);

            // Body
            const body = document.createElement('div');
            body.style.cssText = `padding: 12px 14px;`;

            const info = document.createElement('div');
            info.style.cssText = `
        font-size: 11px; opacity: .75; margin-bottom: 10px;
        padding: 8px; border-radius: 8px;
        background: rgba(0,0,0,.2);
        border: 1px solid rgba(255,255,255,.05);
      `;
            info.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 4px;">配置</div>
        <div>• 代币: USDC ⇄ USDT</div>
        <div>• 链: Optimism</div>
      `;

            const logEl = document.createElement('pre');
            logEl.style.cssText = `
        margin: 0; padding: 10px; border-radius: 8px;
        background: rgba(0,0,0,.3);
        font-size: 10px; line-height: 1.4;
        white-space: pre-wrap; word-break: break-word;
        max-height: 150px; overflow: auto;
        font-family: 'Consolas', 'Monaco', monospace;
      `;
            logEl.textContent = '准备就绪。点击 Start 或按 Ctrl+S 开始。\n';

            body.appendChild(info);
            body.appendChild(logEl);

            root.appendChild(header);
            root.appendChild(body);
            document.body.appendChild(root);

            this.root = root;
            this.statusDot = dot;
            this.statusText = status;
            this.btnToggle = btn;
            this.logEl = logEl;

            btn.addEventListener('click', () => this.toggle());

            window.addEventListener('keydown', (e) => {
                if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
                    e.preventDefault();
                    this.toggle();
                }
            });
        },

        setRunning(running) {
            if (!this.root) return;
            this.statusDot.style.background = running ? '#16a34a' : '#dc2626';
            this.statusText.textContent = running ? 'RUNNING' : 'STOPPED';
            this.btnToggle.textContent = running ? 'Stop (Ctrl+S)' : 'Start (Ctrl+S)';
            this.btnToggle.style.background = running ? '#dc2626' : '#16a34a';
        },

        toggle() {
            if (isRunning) {
                stopSwapLoop();
            } else {
                executeSwapLoop();
            }
        }
    };

    // ==================== 初始化 ====================
    function init() {
        UI.mount();
        log('脚本已加载。按 Ctrl+S 或点击 Start 开始。', 'success');
    }

    // 暴露全局函数
    window.startBot = () => {
        if (!isRunning) executeSwapLoop();
    };

    window.stopBot = () => {
        stopSwapLoop();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
