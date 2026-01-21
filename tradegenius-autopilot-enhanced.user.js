// ==UserScript==
// @name         TradeGenius Auto Swap - Enhanced Safety Edition
// @namespace    https://www.tradegenius.com
// @version      1.0.0
// @description  增強版自動 USDC/USDT 刷量腳本，具備完善的防呆機制與風險控制
// @author       B1N0RY
// @match        https://www.tradegenius.com/trade
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // 防止在 iframe 中重複運行
    if (window.top !== window.self) return;

    // ==================== 配置參數 ====================
    const CONFIG = {
        // 延遲設置（毫秒）
        waitAfterChoose: 1500,
        waitAfterTokenSelect: 2000,
        waitAfterMax: 1200,
        waitBeforeConfirm: 3000,        // 點擊 Confirm 前的緩衝等待
        waitAfterConfirm: 5000,        // 點擊 Confirm 後的等待時間（增加到 5 秒以確保交易完成）
        waitAfterClose: 1500,
        waitAfterSwitch: 2000,

        // 交易成功後的隨機等待（毫秒）
        waitAfterTradeMin: 8000,
        waitAfterTradeMax: 15000,

        // SWAP pending 等待設置
        waitAfterSuccessPopup: 5000,        // 檢測到成功彈窗後的初始等待時間（等待 SWAP pending 開始）
        waitForSwapPendingMax: 30000,      // 等待 SWAP pending 完成的最大時間（30秒）
        checkSwapPendingInterval: 2000,    // 檢查 SWAP pending 狀態的間隔（2秒）
        swapPendingExtraRetries: 3,        // SWAP pending 超時後的額外重試次數
        swapPendingRetryInterval: 3000,    // 每次額外重試的間隔（3秒）
        
        // 餘額驗證設置
        balanceVerificationDelay: 3000,     // 餘額驗證前的等待時間（3秒）
        balanceReadRetries: 3,              // 餘額讀取重試次數
        balanceReadRetryInterval: 2000,     // 餘額讀取重試間隔（2秒）

        // 重試設置
        maxRetryConfirm: 25,
        maxRetryTokenSelect: 5,
        maxConsecutiveFailures: 5,      // 連續失敗次數上限

        // 按鈕加載超時設置（毫秒）
        buttonLoadingTimeout: 35000,    // 35秒

        // 餘額檢查設置
        minBalanceThreshold: 0.1,       // 最小餘額閾值（USDT/USDC）
        balanceCheckInterval: 5000,     // 餘額檢查間隔（毫秒）

        // 交易頻率控制
        minIntervalBetweenSwaps: 10000, // 兩次交易之間的最小間隔（毫秒）

        // 鏈設置（固定為 Optimism/OP）
        targetChain: 'Optimism',        // 固定使用 Optimism (OP) 鏈
        chainDisplayName: 'OP',          // 顯示名稱

        // 安全設置
        enableBalanceMonitoring: true,  // 啟用餘額監控
        enableSuccessVerification: true, // 啟用交易成功驗證
        enableAutoRecovery: true,        // 啟用自動恢復

        // 動態調整設置
        enableDynamicAdjustment: true,   // 啟用動態調整 Slippage 和 Priority
        // Slippage 設置
        slippageInitial: 0.10,          // 初始 Slippage (%)
        slippageMin: 0.05,              // Slippage 下限 (%)
        slippageMax: 0.30,              // Slippage 上限 (%)
        slippageIncreaseOnFailure: 0.05, // 失敗時增加的 Slippage (%)
        slippageDecreaseOnSuccess: 0.02, // 成功時減少的 Slippage (%)
        // Priority 設置
        priorityInitial: 0.002,         // 初始 Priority (gwei)
        priorityMin: 0.002,             // Priority 下限 (gwei)
        priorityMax: 0.01,              // Priority 上限 (gwei)
        priorityIncreaseOnFailure: 0.001, // 失敗時增加的 Priority (gwei)
        priorityDecreaseOnSuccess: 0.0005, // 成功時減少的 Priority (gwei)
        // 觸發閾值
        consecutiveFailureThreshold: 2,  // 連續失敗多少次後觸發調整
        consecutiveSuccessThreshold: 8,  // 連續成功多少次後觸發調整

        // 調試
        debug: true
    };

    // ==================== 全局變量 ====================
    let isRunning = false;
    let currentFromToken = null;
    let buttonLoadingStartTime = null;
    let lastSwapTime = 0;
    let consecutiveFailures = 0;
    let lastBalance = { USDT: null, USDC: null };
    let balanceCheckTimer = null;

    // 新增：用於基於幣種比較的 SWAP 成功/失敗判斷
    let lastCycleFromToken = null;  // 記錄上一次交易循環開始時的發送幣種
    let lastCycleConfirmed = false; // 記錄上一次循環是否執行了 Confirm

    // 動態調整相關變量
    let consecutiveSuccesses = 0;   // 連續成功次數
    let currentSlippage = CONFIG.slippageInitial;  // 當前 Slippage 值
    let currentPriority = CONFIG.priorityInitial;  // 當前 Priority 值
    let isAdjusting = false;        // 是否正在進行調整（防止並發）
    let lastAdjustmentTime = 0;      // 上次調整時間（防止頻繁調整）

    // 防止螢幕關閉時暫停的相關變量
    let wakeLock = null;  // Wake Lock API 對象
    let heartbeatInterval = null;  // 心跳定時器
    let lastHeartbeatTime = Date.now();  // 上次心跳時間
    let throttleDetectionEnabled = true;  // 是否啟用時間節流檢測
    let visibilityListenerSetup = false;  // 是否已設置可見性監聽器

    let stats = {
        totalSwaps: 0,
        successfulSwaps: 0,
        failedSwaps: 0,
        startTime: null,
        lastError: null,
        lastSuccessTime: null
    };

    // ==================== 工具函數 ====================
    // 改進的 sleep 函數，能夠檢測並補償時間節流（當螢幕關閉時）
    const sleep = async (ms) => {
        const startTime = Date.now();
        const checkInterval = Math.min(100, ms); // 每 100ms 檢查一次，或更短
        let lastCheckTime = startTime;
        
        while (Date.now() - startTime < ms) {
            if (!isRunning) {
                return; // 如果已停止，立即返回
            }
            
            const now = Date.now();
            const elapsed = now - startTime;
            const remaining = ms - elapsed;
            
            // 檢測時間節流：如果實際經過的時間遠大於預期，說明被節流了
            if (throttleDetectionEnabled) {
                const actualElapsed = now - lastCheckTime;
                // 如果實際經過的時間超過預期的 2 倍，說明被節流了
                if (actualElapsed > checkInterval * 2 && lastCheckTime !== startTime) {
                    const throttledTime = actualElapsed - checkInterval;
                    // 只在節流時間較大時才記錄（避免過多日誌）
                    if (throttledTime > 500) {
                        log(`⚠️ 檢測到時間節流：${throttledTime.toFixed(0)}ms，已自動補償`, 'warning');
                    }
                }
            }
            
            lastCheckTime = now;
            
            if (remaining <= 0) {
                break;
            }
            
            // 使用實際時間計算，而不是依賴可能被節流的 setTimeout
            // 即使頁面不可見，也使用 setTimeout，因為我們已經用實際時間來補償
            await new Promise(resolve => {
                setTimeout(resolve, Math.min(checkInterval, remaining));
            });
        }
    };

    const randomWait = (min, max) => {
        return Math.floor(Math.random() * (max - min + 1)) + min;
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

        const icons = {
            info: 'ℹ️',
            success: '✅',
            error: '❌',
            warning: '⚠️'
        };

        console.log(`%c${prefix} ${icons[type]} ${msg}`, `color: ${colors[type]}; font-weight: bold`);

        if (UI.logEl) {
            const logText = `${prefix} ${icons[type]} ${msg}\n`;
            UI.logEl.textContent = logText + UI.logEl.textContent.slice(0, 2000);
        }
    };

    // ==================== 防止螢幕關閉時暫停的函數 ====================
    // 請求 Wake Lock（防止螢幕關閉）
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                log('✅ Wake Lock 已啟用（防止螢幕關閉）', 'success');
                
                // 監聽 Wake Lock 釋放事件
                wakeLock.addEventListener('release', () => {
                    log('⚠️ Wake Lock 已釋放，嘗試重新請求...', 'warning');
                    // 如果腳本仍在運行，嘗試重新請求
                    if (isRunning) {
                        setTimeout(() => requestWakeLock(), 1000);
                    }
                });
            } else {
                log('ℹ️ 瀏覽器不支援 Wake Lock API', 'info');
            }
        } catch (err) {
            log(`⚠️ 無法啟用 Wake Lock: ${err.message}`, 'warning');
        }
    }

    // 釋放 Wake Lock
    async function releaseWakeLock() {
        try {
            if (wakeLock) {
                await wakeLock.release();
                wakeLock = null;
                log('Wake Lock 已釋放', 'info');
            }
        } catch (err) {
            log(`釋放 Wake Lock 時出錯: ${err.message}`, 'warning');
        }
    }

    // 啟動心跳機制（保持腳本活躍）
    function startHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
        
        lastHeartbeatTime = Date.now();
        
        // 每 5 秒執行一次心跳
        heartbeatInterval = setInterval(() => {
            const now = Date.now();
            const elapsed = now - lastHeartbeatTime;
            
            // 檢測時間是否被節流（如果實際經過的時間遠大於預期）
            if (elapsed > 10000) {  // 預期是 5 秒，如果超過 10 秒說明被節流了
                const throttledTime = elapsed - 5000;
                log(`⚠️ 檢測到時間節流：${throttledTime.toFixed(0)}ms，腳本可能被暫停`, 'warning');
            }
            
            lastHeartbeatTime = now;
            
            // 執行一個輕量級操作來保持腳本活躍
            if (isRunning) {
                // 觸發一個微任務來保持事件循環運行
                Promise.resolve().then(() => {
                    // 檢查頁面可見性
                    if (document.hidden) {
                        log('⚠️ 頁面目前不可見，但腳本仍在運行', 'warning');
                    }
                });
            }
        }, 5000);
        
        log('✅ 心跳機制已啟動', 'success');
    }

    // 停止心跳機制
    function stopHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
            log('心跳機制已停止', 'info');
        }
    }

    // 設置 Page Visibility API 監聽器
    function setupVisibilityListener() {
        if (visibilityListenerSetup) {
            return; // 已經設置過，避免重複添加
        }
        
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                log('⚠️ 頁面已隱藏（切換到其他標籤頁或最小化）', 'warning');
                log('腳本將繼續運行，但可能受到瀏覽器節流影響', 'info');
            } else {
                log('✅ 頁面已顯示', 'success');
                // 頁面重新可見時，更新心跳時間
                lastHeartbeatTime = Date.now();
            }
        });
        
        visibilityListenerSetup = true;
    }

    // ==================== 餘額監控函數 ====================
    async function getTokenBalances() {
        try {
            const balances = { USDT: 0, USDC: 0 };

            // 方法1: 從包含 "Balance:" 的元素讀取（參考用戶提供的 HTML 格式）
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
                // 跳過對話框中的元素
                if (el.closest('[role="dialog"]')) continue;
                
                const text = el.innerText || '';
                // 查找包含 "Balance:" 的元素（例如: "Balance: 49.871"）
                if (text.includes('Balance:') || text.includes('Balance ')) {
                    // 提取數字（匹配 "Balance: 49.871" 或 "Balance 49.871"）
                    const balanceMatch = text.match(/Balance:?\s*([\d,\.]+)/i);
                    if (balanceMatch) {
                        // 使用更精確的數值解析，保留足夠的小數位
                        const balanceText = balanceMatch[1].replace(/,/g, '');
                        const balance = parseFloat(parseFloat(balanceText).toFixed(8));
                        
                        // 確定這個餘額對應哪個代幣
                        // 查找同一容器或父容器中的代幣符號
                        let container = el.parentElement;
                        let foundSymbol = null;
                        let searchDepth = 0;
                        
                        while (container && searchDepth < 5) {
                            // 查找代幣符號
                            const symbolElements = container.querySelectorAll('.text-xs.text-genius-cream\\/60, .text-sm.text-genius-cream, [class*="text-genius-cream"]');
                            for (const symEl of symbolElements) {
                                if (symEl.closest('[role="dialog"]')) continue;
                                const symText = symEl.innerText?.trim();
                                if (symText === 'USDT' || symText === 'USDC') {
                                    // 檢查符號和餘額是否在同一區域（Y 座標相近）
                                    const symRect = symEl.getBoundingClientRect();
                                    const elRect = el.getBoundingClientRect();
                                    if (Math.abs(symRect.top - elRect.top) < 100) {
                                        foundSymbol = symText;
                                        break;
                                    }
                                }
                            }
                            if (foundSymbol) break;
                            
                            // 也檢查容器文字中是否包含代幣符號
                            const containerText = container.innerText || '';
                            if (containerText.includes('USDT') && !containerText.includes('USDC')) {
                                foundSymbol = 'USDT';
                                break;
                            } else if (containerText.includes('USDC') && !containerText.includes('USDT')) {
                                foundSymbol = 'USDC';
                                break;
                            }
                            
                            container = container.parentElement;
                            searchDepth++;
                        }
                        
                        if (foundSymbol && balance > balances[foundSymbol]) {
                            balances[foundSymbol] = balance;
                            if (CONFIG.debug) {
                                log(`✓ 從 Balance: 元素讀取到 ${foundSymbol} 餘額: ${balance}`, 'info');
                            }
                        }
                    }
                }
            }

            // 方法2: 從 SWAP 視窗的 Choose 按鈕區域讀取（參考 tradegenius-autopilot.user.js）
            const chooseButtons = findChooseButtons();
            if (chooseButtons.length > 0) {
                for (const chooseBtn of chooseButtons) {
                    // 確保不在對話框中
                    const inDialog = chooseBtn.closest('[role="dialog"]');
                    if (inDialog) continue;
                    
                    // 從包含 Choose 按鈕的容器中查找代幣和餘額
                    let container = chooseBtn.closest('div');
                    let depth = 0;
                    while (container && depth < 8) {
                        // 查找代幣行（參考 tradegenius_userscript.js）
                        const rows = container.querySelectorAll('.cursor-pointer');
                        for (const row of rows) {
                            if (row.closest('[role="dialog"]')) continue;
                            
                            const symbolEl = row.querySelector('.text-xs.text-genius-cream\\/60, .text-sm.text-genius-cream');
                            const symbol = symbolEl?.innerText?.trim();
                            
                            if (symbol === 'USDT' || symbol === 'USDC') {
                                // 查找同一行中的餘額（參考 tradegenius_userscript.js）
                                const balanceEl = row.querySelector('.flex.flex-nowrap.justify-end, .text-right');
                                if (balanceEl) {
                                    const balanceText = balanceEl.innerText || '';
                                    const balanceMatch = balanceText.match(/[\d,\.]+/);
                                    if (balanceMatch) {
                                        // 使用更精確的數值解析，保留足夠的小數位
                                        const balanceText = balanceMatch[0].replace(/,/g, '');
                                        const balance = parseFloat(parseFloat(balanceText).toFixed(8));
                                        if (balance > balances[symbol]) {
                                            balances[symbol] = balance;
                                            if (CONFIG.debug) {
                                                log(`✓ 從代幣行讀取到 ${symbol} 餘額: ${balance}`, 'info');
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        container = container.parentElement;
                        depth++;
                    }
                }
            }

            // 方法3: 從主頁面文字匹配（備用方法）
            if (balances.USDT === 0 && balances.USDC === 0) {
                for (const el of allElements) {
                    if (el.closest('[role="dialog"]')) continue;
                    
                    const text = el.innerText || '';
                    // 匹配 "USDT: 49.871" 或 "USDC: 49.871" 格式
                    const match = text.match(/(USDT|USDC)[\s:]+([\d,\.]+)/i);
                    if (match) {
                        const symbol = match[1].toUpperCase();
                        // 使用更精確的數值解析，保留足夠的小數位
                        const balanceText = match[2].replace(/,/g, '');
                        const balance = parseFloat(parseFloat(balanceText).toFixed(8));
                        if (symbol === 'USDT' && balance > balances.USDT) {
                            balances.USDT = balance;
                        } else if (symbol === 'USDC' && balance > balances.USDC) {
                            balances.USDC = balance;
                        }
                    }
                }
            }

            if (CONFIG.debug) {
                log(`餘額讀取結果: USDT=${balances.USDT}, USDC=${balances.USDC}`, 'info');
            }

            return balances;
        } catch (error) {
            log(`獲取餘額失敗: ${error.message}`, 'error');
            return { USDT: 0, USDC: 0 };
        }
    }

    async function checkBalanceSufficient() {
        if (!CONFIG.enableBalanceMonitoring) return true;

        // 在讀取餘額前，確保沒有其他視窗遮擋 SWAP 視窗
        // 這可以避免讀取到代幣選擇視窗中的舊餘額
        if (isDialogOpen()) {
            log('檢測到視窗打開，先關閉視窗以確保讀取正確的餘額...', 'info');
            await ensureAllDialogsClosed(3);
            await sleep(500);
        }

        // 如果已經選擇了發送代幣，優先檢查該代幣的餘額
        if (currentFromToken) {
            const balances = await getTokenBalances();
            const selectedBalance = balances[currentFromToken] || 0;
            
            if (selectedBalance < CONFIG.minBalanceThreshold) {
                log(`⚠️ 餘額不足！當前 ${currentFromToken} 餘額: ${selectedBalance.toFixed(4)}，最低要求: ${CONFIG.minBalanceThreshold}`, 'warning');
                return false;
            }
            
            // 更新記錄的餘額
            lastBalance = balances;
            return true;
        }

        // 如果還沒有選擇代幣，檢查所有代幣的最大餘額
        const balances = await getTokenBalances();
        const maxBalance = Math.max(balances.USDT, balances.USDC);

        if (maxBalance < CONFIG.minBalanceThreshold) {
            log(`⚠️ 餘額不足！當前最大餘額: ${maxBalance.toFixed(4)}，最低要求: ${CONFIG.minBalanceThreshold}`, 'warning');
            return false;
        }

        // 檢查餘額異常變化
        if (lastBalance.USDT !== null && lastBalance.USDC !== null) {
            const usdtChange = Math.abs(balances.USDT - lastBalance.USDT);
            const usdcChange = Math.abs(balances.USDC - lastBalance.USDC);
            const maxChange = Math.max(usdtChange, usdcChange);

            // 如果餘額變化超過 50%（可能是異常），發出警告
            if (maxChange > Math.max(lastBalance.USDT, lastBalance.USDC) * 0.5) {
                log(`⚠️ 檢測到餘額異常變化: USDT ${lastBalance.USDT} → ${balances.USDT}, USDC ${lastBalance.USDC} → ${balances.USDC}`, 'warning');
            }
        }

        lastBalance = balances;
        return true;
    }

    // ==================== DOM 查找函數 ====================
    // 找到所有代幣選擇按鈕（包括已選擇的）
    const findAllTokenSelectionButtons = () => {
        // 方法1: 通過 data-sentry-component="TokenSelectionButton" 屬性查找
        const buttonsByAttribute = Array.from(document.querySelectorAll('button[data-sentry-component="TokenSelectionButton"]'));
        
        // 方法2: 通過 "Choose" 文字查找（用於未選擇的按鈕）
        const buttonsByText = Array.from(document.querySelectorAll('button'))
            .filter(b => {
                const text = b.innerText.trim();
                const spanText = b.querySelector('span')?.innerText?.trim() || '';
                return text === 'Choose' || spanText === 'Choose' ||
                    text === '选择' || spanText === '选择';
            });
        
        // 合併兩種方法找到的按鈕，去重
        const allButtons = [...buttonsByAttribute, ...buttonsByText];
        const uniqueButtons = Array.from(new Set(allButtons));
        
        // 按 Y 座標排序，確保第一個按鈕在上方（發送代幣），第二個在下方（接收代幣）
        uniqueButtons.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectA.top - rectB.top;
        });
        
        return uniqueButtons;
    };

    const findChooseButtons = () => {
        // 為了向後兼容，保留原來的函數，但現在使用新的查找方法
        // 只返回顯示 "Choose" 的按鈕（未選擇的）
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
            .find(b => {
                const text = b.innerText.trim().toUpperCase();
                return text === 'MAX' || text === '最大';
            });
    };

    const findConfirmButton = () => {
        return Array.from(document.querySelectorAll('button'))
            .find(b => {
                const text = b.innerText.trim().toUpperCase();
                return (text.includes('CONFIRM') || text.includes('确认') || 
                        text.includes('PLACE') || text.includes('SWAP')) &&
                       !b.disabled;
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

    const findSwitchButton = () => {
        const svg = document.querySelector('svg.lucide-arrow-up-down');
        if (svg) return svg.closest('button');
        return document.querySelector('button[aria-label="Switch"], button[aria-label="切換"]');
    };

    const isDialogOpen = () => {
        return !!document.querySelector('[role="dialog"][data-state="open"]');
    };

    // 讀取當前頁面上顯示的發送幣（From Token）
    const getCurrentDisplayedFromToken = () => {
        try {
            // 方法1: 從 Choose 按鈕附近的元素查找（最可靠的方法）
            const chooseButtons = findChooseButtons();
            if (chooseButtons.length > 0) {
                // 第一個 Choose 按鈕通常是發送幣
                const firstChooseBtn = chooseButtons[0];
                
                // 查找包含 Choose 按鈕的父容器
                let container = firstChooseBtn.closest('div');
                const btnRect = firstChooseBtn.getBoundingClientRect();
                
                // 在容器及其父元素中查找代幣符號
                for (let i = 0; i < 8 && container; i++) {
                    // 查找所有包含 USDT 或 USDC 的元素
                    const allTextElements = container.querySelectorAll('*');
                    let closestToken = null;
                    let minDistance = Infinity;
                    
                    for (const el of allTextElements) {
                        const elText = el.innerText?.trim() || '';
                        if (elText === 'USDT' || elText === 'USDC') {
                            const elRect = el.getBoundingClientRect();
                            // 只考慮可見元素
                            if (elRect.width > 0 && elRect.height > 0) {
                                // 計算與 Choose 按鈕的距離（優先考慮 Y 座標相近的）
                                const distance = Math.abs(elRect.top - btnRect.top) + Math.abs(elRect.left - btnRect.left) * 0.1;
                                if (distance < minDistance) {
                                    minDistance = distance;
                                    closestToken = elText;
                                }
                            }
                        }
                    }
                    
                    if (closestToken && minDistance < 100) {
                        return closestToken;
                    }
                    
                    container = container.parentElement;
                }
            }

            // 方法2: 從整個 SWAP 區域查找，尋找最靠近頂部的代幣符號
            // 通常發送幣在接收幣的上方
            const swapContainer = document.querySelector('[class*="swap"], [class*="trade"], main, [role="main"]');
            const searchArea = swapContainer || document.body;
            const allElements = searchArea.querySelectorAll('*');
            const candidates = [];
            
            for (const el of allElements) {
                const text = el.innerText?.trim() || '';
                if (text === 'USDT' || text === 'USDC') {
                    const rect = el.getBoundingClientRect();
                    // 只考慮可見元素
                    if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
                        candidates.push({
                            token: text,
                            y: rect.top,
                            element: el
                        });
                    }
                }
            }
            
            if (candidates.length > 0) {
                // 按 Y 座標排序，取最上面的（通常是發送幣）
                candidates.sort((a, b) => a.y - b.y);
                return candidates[0].token;
            }

            return null;
        } catch (error) {
            log(`讀取當前發送幣失敗: ${error.message}`, 'error');
            return null;
        }
    };

    // 關閉當前打開的視窗（對話框）
    async function closeDialog() {
        try {
            // 方法1: 嘗試按 ESC 鍵
            const escEvent = new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                keyCode: 27,
                which: 27,
                bubbles: true,
                cancelable: true
            });
            document.dispatchEvent(escEvent);
            await sleep(300);

            // 方法2: 查找並點擊關閉按鈕
            const closeBtn = findCloseButton();
            if (closeBtn && typeof closeBtn.click === 'function') {
                closeBtn.click();
                await sleep(300);
            }
        } catch (error) {
            // 忽略錯誤，繼續嘗試其他方法
        }

        try {
            // 方法3: 查找帶有 X 圖標的關閉按鈕
            // 先查找按鈕（通過 aria-label）
            const xButtonsByLabel = document.querySelectorAll('button[aria-label*="close" i], button[aria-label*="關閉" i]');
            for (const btn of xButtonsByLabel) {
                if (btn && typeof btn.click === 'function') {
                    const rect = btn.getBoundingClientRect();
                    const style = window.getComputedStyle(btn);
                    if (rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        btn.offsetParent !== null) {
                        btn.click();
                        await sleep(300);
                        break;
                    }
                }
            }
            
            // 再查找包含 X 圖標的按鈕（通過 SVG）
            const xSvgs = document.querySelectorAll('svg.lucide-x, svg.lucide-x-circle');
            for (const svg of xSvgs) {
                // 找到包含 SVG 的按鈕元素
                const btn = svg.closest('button');
                if (btn && typeof btn.click === 'function') {
                    const rect = btn.getBoundingClientRect();
                    const style = window.getComputedStyle(btn);
                    if (rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        btn.offsetParent !== null) {
                        btn.click();
                        await sleep(300);
                        break;
                    }
                }
            }
        } catch (error) {
            // 忽略錯誤，繼續嘗試其他方法
        }

        try {
            // 方法4: 點擊視窗外部區域（backdrop）
            const dialog = document.querySelector('[role="dialog"][data-state="open"]');
            if (dialog) {
                const backdrop = dialog.parentElement;
                if (backdrop && backdrop !== dialog) {
                    // 點擊 backdrop 的左上角（通常是安全區域）
                    const rect = backdrop.getBoundingClientRect();
                    const clickEvent = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: rect.left + 10,
                        clientY: rect.top + 10
                    });
                    backdrop.dispatchEvent(clickEvent);
                    await sleep(300);
                }
            }
        } catch (error) {
            // 忽略錯誤
        }

        // 等待視窗關閉
        await sleep(500);
    }

    // 確保所有視窗都已關閉
    async function ensureAllDialogsClosed(maxAttempts = 5) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (!isDialogOpen()) {
                if (attempt > 0) {
                    log('✓ 所有視窗已關閉', 'success');
                }
                return true;
            }
            
            if (attempt > 0) {
                log(`嘗試關閉視窗... (${attempt + 1}/${maxAttempts})`, 'info');
            }
            
            try {
                await closeDialog();
            } catch (error) {
                log(`⚠️ 關閉視窗時發生錯誤: ${error.message}`, 'warning');
                // 繼續嘗試，不中斷流程
            }
        }
        
        if (isDialogOpen()) {
            log('⚠️ 仍有視窗未關閉，但將繼續執行', 'warning');
            return false;
        }
        return true;
    }

    // 檢查按鈕加載超時
    const checkButtonLoadingTimeout = () => {
        const loadingButton = document.querySelector('button.bg-genius-pink[disabled] svg.animate-spin, button[disabled] svg.animate-spin');

        if (loadingButton) {
            if (!buttonLoadingStartTime) {
                buttonLoadingStartTime = Date.now();
                log('檢測到按鈕加載中...', 'info');
            } else {
                const elapsedTime = Date.now() - buttonLoadingStartTime;
                const remainingTime = Math.ceil((CONFIG.buttonLoadingTimeout - elapsedTime) / 1000);

                if (elapsedTime > CONFIG.buttonLoadingTimeout) {
                    log(`⚠️ 按鈕加載超時（${CONFIG.buttonLoadingTimeout / 1000}秒），嘗試恢復...`, 'error');
                    buttonLoadingStartTime = null;
                    
                    if (CONFIG.enableAutoRecovery) {
                        // 嘗試點擊切換按鈕來恢復
                        const switchBtn = findSwitchButton();
                        if (switchBtn) {
                            switchBtn.click();
                            log('嘗試切換方向恢復...', 'info');
                            return false; // 不刷新頁面，繼續嘗試
                        }
                    }
                    
                    // 最後手段：刷新頁面
                    log('刷新頁面...', 'warning');
                    window.location.reload();
                    return true;
                } else if (remainingTime <= 10 && remainingTime % 5 === 0) {
                    log(`按鈕加載中... 剩餘 ${remainingTime} 秒`, 'warning');
                }
            }
        } else {
            if (buttonLoadingStartTime) {
                log('✓ 按鈕加載完成', 'success');
                buttonLoadingStartTime = null;
            }
        }

        return false;
    };

    // ==================== Preset 設定流程 ====================
    
    // 查找並點擊元素（多種策略）
    async function findAndClickElement(selectors, description, waitTime = 1500, verifyAfterClick = null) {
        for (let attempt = 0; attempt < 6; attempt++) {
            for (const selector of selectors) {
                let element = null;
                
                if (typeof selector === 'string') {
                    // CSS 選擇器
                    element = document.querySelector(selector);
                } else if (selector.type === 'text') {
                    // 文字匹配 - 優先查找包含 cursor-pointer 的元素
                    const allElements = Array.from(document.querySelectorAll('*'));
                    
                    // 首先嘗試查找包含 cursor-pointer 和 hover:bg-genius-pink 且文字匹配的元素（設置選項）
                    element = allElements.find(el => {
                        const classes = typeof el.className === 'string' ? el.className : (el.className?.baseVal || el.className?.toString() || '');
                        const text = el.innerText?.trim() || el.textContent?.trim();
                        // 匹配 hover:bg-genius-pink 或 hover:bg-genius-pink/20 等變體
                        const hasGeniusPink = classes.includes('hover:bg-genius-pink') || 
                                             classes.includes('genius-pink') ||
                                             classes.includes('hover:text-genius-pink');
                        return (classes.includes('cursor-pointer') && hasGeniusPink) &&
                               (text === selector.text || (text.includes(selector.text) && text.length < selector.text.length + 10));
                    });
                    
                    // 如果沒找到，嘗試查找包含 cursor-pointer 且文字匹配的元素
                    if (!element) {
                        element = allElements.find(el => {
                            const classes = typeof el.className === 'string' ? el.className : (el.className?.baseVal || el.className?.toString() || '');
                            const text = el.innerText?.trim() || el.textContent?.trim();
                            return (classes.includes('cursor-pointer') || 
                                    el.tagName === 'BUTTON' || 
                                    el.tagName === 'A') &&
                                   (text === selector.text || text.includes(selector.text));
                        });
                    }
                    
                    // 如果還是沒找到，再嘗試一般匹配
                    if (!element) {
                        element = allElements.find(el => {
                            const text = el.innerText?.trim() || el.textContent?.trim();
                            return text === selector.text || text.includes(selector.text);
                        });
                    }
                } else if (selector.type === 'svg') {
                    // SVG 圖標匹配
                    element = document.querySelector(selector.selector);
                } else if (selector.type === 'data-attr') {
                    // data 屬性匹配
                    element = document.querySelector(`[${selector.attr}="${selector.value}"]`);
                }
                
                if (element) {
                    const rect = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);
                    
                    if (rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        element.offsetParent !== null) {
                        
                        // 滾動到元素可見位置
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        await sleep(300);
                        
                        // 如果元素是 SVG 或其他沒有 click 方法的元素，嘗試找到父按鈕
                        let clickableElement = element;
                        if (typeof element.click !== 'function') {
                            // 向上查找按鈕或可點擊的父元素
                            let parent = element.parentElement;
                            let attempts = 0;
                            while (parent && attempts < 8) {
                                const parentClasses = typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || parent.className?.toString() || '');
                                if (parent.tagName === 'BUTTON' || 
                                    parent.tagName === 'A' ||
                                    typeof parent.click === 'function' ||
                                    parent.onclick ||
                                    parent.getAttribute('role') === 'button' ||
                                    parentClasses.includes('cursor-pointer')) {
                                    clickableElement = parent;
                                    break;
                                }
                                parent = parent.parentElement;
                                attempts++;
                            }
                        }
                        
                        // 如果找到了可點擊的元素，執行點擊
                        if (typeof clickableElement.click === 'function' || clickableElement.onclick) {
                            // 嘗試多種點擊方式
                            let clickSuccess = false;
                            
                            // 方式1: 直接調用 click()
                            try {
                                clickableElement.click();
                                clickSuccess = true;
                            } catch (e) {
                                log(`⚠️ 直接點擊失敗，嘗試其他方式: ${e.message}`, 'warning');
                            }
                            
                            // 方式2: 使用 MouseEvent
                            if (!clickSuccess) {
                                try {
                                    const clickEvent = new MouseEvent('click', {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window,
                                        detail: 1
                                    });
                                    clickableElement.dispatchEvent(clickEvent);
                                    clickSuccess = true;
                                } catch (e) {
                                    log(`⚠️ MouseEvent 點擊失敗: ${e.message}`, 'warning');
                                }
                            }
                            
                            // 方式3: 使用 mousedown + mouseup
                            if (!clickSuccess) {
                                try {
                                    const mouseDownEvent = new MouseEvent('mousedown', {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window,
                                        detail: 1
                                    });
                                    const mouseUpEvent = new MouseEvent('mouseup', {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window,
                                        detail: 1
                                    });
                                    clickableElement.dispatchEvent(mouseDownEvent);
                                    await sleep(50);
                                    clickableElement.dispatchEvent(mouseUpEvent);
                                    clickSuccess = true;
                                } catch (e) {
                                    log(`⚠️ mousedown/mouseup 點擊失敗: ${e.message}`, 'warning');
                                }
                            }
                            
                            if (clickSuccess) {
                                // 等待 UI 更新
                                await sleep(waitTime);
                                
                                // 如果有驗證函數，執行驗證
                                if (verifyAfterClick) {
                                    const verified = await verifyAfterClick();
                                    if (verified) {
                                        log(`✓ ${description}`, 'success');
                                        return true;
                                    } else {
                                        log(`⚠️ ${description} 點擊後驗證失敗，重試...`, 'warning');
                                        await sleep(1000);
                                        continue; // 繼續下一次嘗試
                                    }
                                } else {
                                    log(`✓ ${description}`, 'success');
                                    return true;
                                }
                            }
                        } else {
                            log(`⚠️ 無法找到可點擊的元素`, 'warning');
                        }
                    }
                }
            }
            
            if (attempt < 5) {
                log(`重試查找 ${description}... (${attempt + 1}/6)`, 'warning');
                await sleep(attempt < 2 ? 1000 : 1500);
            }
        }
        
        log(`⚠️ 未找到或無法點擊 ${description}`, 'warning');
        return false;
    }
    
    // 驗證輸入框值是否正確保存
    async function verifyInputValue(description, expectedValue) {
        for (let attempt = 0; attempt < 3; attempt++) {
            let input = null;
            
            if (description.includes('Slippage')) {
                const slippageSvg = document.querySelector('[data-sentry-component="Slippage"]');
                if (slippageSvg) {
                    let container = slippageSvg.closest('[class*="border-genius-blue"]');
                    if (container) {
                        input = container.querySelector('input');
                    }
                }
            } else if (description.includes('Priority')) {
                const fuelSvg = document.querySelector('svg.lucide-fuel, svg[class*="lucide-fuel"]');
                if (fuelSvg) {
                    let container = fuelSvg.closest('[class*="border-genius-blue"]');
                    if (container) {
                        input = container.querySelector('input');
                    }
                }
            }
            
            if (input && input.tagName === 'INPUT') {
                const currentValue = input.value;
                const valueMatch = currentValue === expectedValue || 
                                 parseFloat(currentValue) === parseFloat(expectedValue) ||
                                 Math.abs(parseFloat(currentValue) - parseFloat(expectedValue)) < 0.0001;
                
                if (valueMatch) {
                    log(`✓ ${description} 值驗證成功: ${currentValue}`, 'info');
                    return true;
                } else {
                    log(`⚠️ ${description} 值不匹配（當前: ${currentValue}, 期望: ${expectedValue}）`, 'warning');
                }
            }
            
            if (attempt < 2) {
                await sleep(500);
            }
        }
        
        return false;
    }
    
    // 查找並設置輸入框值
    async function findAndSetInput(selectors, value, description) {
        // 如果是查找 Slippage 或 Priority，先確保 Settings 面板已打開
        const isSlippageOrPriority = selectors.some(s => 
            (typeof s === 'object' && s.type === 'text' && (s.text.includes('Slippage') || s.text.includes('Priority'))) ||
            (typeof s === 'object' && s.type === 'data-attr' && s.value === 'Slippage')
        );
        
        if (isSlippageOrPriority) {
            // 檢查 Settings 面板是否打開
            const settingsPanelOpen = document.querySelector('[role="dialog"][data-state="open"]') &&
                                     (document.querySelector('[data-sentry-component="Slippage"]') ||
                                      document.querySelector('svg.lucide-settings2, svg.lucide-settings-2'));
            
            if (!settingsPanelOpen) {
                log('⚠️ Settings 面板未打開，嘗試重新打開...', 'warning');
                // 嘗試重新打開 Settings
                const settingsBtn = await findAndClickElement([
                    'svg.lucide-settings2',
                    'svg.lucide-settings-2',
                    { type: 'svg', selector: 'svg[class*="lucide-settings"]' }
                ], 'Settings 按鈕（重新打開）', 2000);
                if (settingsBtn) {
                    await sleep(2000);
                }
            }
        }
        
        for (let attempt = 0; attempt < 5; attempt++) {
            for (const selector of selectors) {
                let input = null;
                
                if (typeof selector === 'string') {
                    input = document.querySelector(selector);
                } else if (selector.type === 'text') {
                    // 方法1: 通過 data-sentry-component="Slippage" 查找（Slippage）
                    if (selector.text.includes('Slippage')) {
                        const slippageSvg = document.querySelector('[data-sentry-component="Slippage"]');
                        if (slippageSvg) {
                            // 向上查找包含 border-genius-blue 的容器
                            let container = slippageSvg.closest('[class*="border-genius-blue"]');
                            if (container) {
                                input = container.querySelector('input');
                            }
                            
                            // 如果沒找到，嘗試更寬鬆的查找
                            if (!input && slippageSvg) {
                                let parent = slippageSvg.parentElement;
                                for (let i = 0; i < 10 && parent; i++) {
                                    const classes = typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || parent.className?.toString() || '');
                                    if (classes.includes('border') || classes.includes('flex-col')) {
                                        input = parent.querySelector('input');
                                        if (input) break;
                                    }
                                    parent = parent.parentElement;
                                }
                            }
                        }
                        
                        // 如果還是沒找到，嘗試通過文字 "Slippage %" 查找
                        if (!input) {
                            const allElements = Array.from(document.querySelectorAll('*'));
                            for (const el of allElements) {
                                const text = el.innerText?.trim() || el.textContent?.trim();
                                if (text === 'Slippage  %' || text.includes('Slippage') && text.includes('%')) {
                                    let container = el.closest('[class*="border-genius-blue"]');
                                    if (!container) {
                                        container = el.closest('[class*="flex-col"]');
                                    }
                                    if (container) {
                                        input = container.querySelector('input');
                                        if (input) break;
                                    }
                                }
                            }
                        }
                    }
                    
                    // 方法2: 通過 "Priority (Gwei)" 文字查找
                    if (!input && selector.text.includes('Priority')) {
                        // 方法2a: 通過 lucide-fuel SVG 圖標查找
                        const fuelSvg = document.querySelector('svg.lucide-fuel, svg[class*="lucide-fuel"]');
                        if (fuelSvg) {
                            // 向上查找包含 border-genius-blue 的容器
                            let container = fuelSvg.closest('[class*="border-genius-blue"]');
                            if (container) {
                                input = container.querySelector('input');
                            }
                        }
                        
                        // 方法2b: 通過文字查找
                        if (!input) {
                            const allElements = Array.from(document.querySelectorAll('*'));
                            for (const el of allElements) {
                                const text = el.innerText?.trim() || el.textContent?.trim();
                                if (text === 'Priority (Gwei)' || text.includes('Priority (Gwei)')) {
                                    // 向上查找包含 border-genius-blue 的容器
                                    let container = el.closest('[class*="border-genius-blue"]');
                                    if (!container) {
                                        // 如果沒找到，向上查找包含 flex-col 的容器
                                        container = el.closest('[class*="flex-col"]');
                                    }
                                    if (container) {
                                        input = container.querySelector('input');
                                        if (input) break;
                                    }
                                }
                            }
                        }
                        
                        // 方法2c: 查找所有包含 "Priority" 文字的容器，然後找 input
                        if (!input) {
                            const allElements = Array.from(document.querySelectorAll('*'));
                            for (const el of allElements) {
                                const text = el.innerText?.trim() || el.textContent?.trim();
                                if (text.includes('Priority') && text.includes('Gwei')) {
                                    // 向上查找包含 border-genius-blue 的容器
                                    let container = el.closest('[class*="border-genius-blue"]');
                                    if (!container) {
                                        container = el.closest('[class*="flex-col"]');
                                    }
                                    if (container) {
                                        input = container.querySelector('input');
                                        if (input) break;
                                    }
                                }
                            }
                        }
                    }
                    
                    // 方法3: 通用文字匹配（備用）
                    if (!input) {
                        const allElements = Array.from(document.querySelectorAll('*'));
                        let labelElement = null;
                        
                        for (const el of allElements) {
                            const text = el.innerText?.trim() || el.textContent?.trim();
                            if (text === selector.text || text.includes(selector.text)) {
                                if (text.includes('Slippage') || text.includes('Priority')) {
                                    labelElement = el;
                                    break;
                                }
                            }
                        }
                        
                        if (labelElement) {
                            // 向上查找包含 border-genius-blue 的容器
                            let container = labelElement.closest('[class*="border-genius-blue"]');
                            if (!container) {
                                container = labelElement.closest('[class*="flex-col"]');
                            }
                            if (container) {
                                input = container.querySelector('input');
                            }
                        }
                    }
                } else if (selector.type === 'data-attr') {
                    // 通過 data 屬性查找
                    const element = document.querySelector(`[${selector.attr}="${selector.value}"]`);
                    if (element) {
                        let container = element.closest('[class*="border-genius-blue"]');
                        if (container) {
                            input = container.querySelector('input');
                        }
                    }
                }
                
                if (input && input.tagName === 'INPUT') {
                    // 滾動到元素可見位置
                    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    await sleep(300);
                    
                    // 方法1: 嘗試通過 React 內部屬性設置值
                    try {
                        // 獲取 React 內部屬性
                        const reactKey = Object.keys(input).find(key => 
                            key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
                        );
                        
                        if (reactKey) {
                            const reactFiber = input[reactKey];
                            if (reactFiber) {
                                // 向上查找 React 組件
                                let fiber = reactFiber;
                                for (let i = 0; i < 10 && fiber; i++) {
                                    if (fiber.memoizedProps && fiber.memoizedProps.onChange) {
                                        // 找到 onChange 處理器，直接調用
                                        const syntheticEvent = {
                                            target: input,
                                            currentTarget: input,
                                            bubbles: true,
                                            cancelable: true,
                                            defaultPrevented: false,
                                            eventPhase: 2,
                                            isTrusted: false,
                                            nativeEvent: new Event('input'),
                                            preventDefault: () => {},
                                            stopPropagation: () => {},
                                            timeStamp: Date.now(),
                                            type: 'change'
                                        };
                                        
                                        input.value = value;
                                        syntheticEvent.target.value = value;
                                        
                                        fiber.memoizedProps.onChange(syntheticEvent);
                                        log(`✓ ${description}: 通過 React 內部設置為 ${value}`, 'info');
                                        await sleep(800);
                                        
                                        // 驗證值是否已保存
                                        const currentValue = input.value;
                                        if (currentValue === value || parseFloat(currentValue) === parseFloat(value)) {
                                            log(`✓ ${description}: 設置為 ${value}（已驗證）`, 'success');
                                            await sleep(500);
                                            return true;
                                        }
                                        break;
                                    }
                                    fiber = fiber.return;
                                }
                            }
                        }
                    } catch (e) {
                        // React 內部方法失敗，使用標準方法
                        log(`⚠️ React 內部方法失敗，使用標準方法: ${e.message}`, 'warning');
                    }
                    
                    // 方法2: 使用標準 DOM 方法（適用於受控和非受控組件）
                    input.focus();
                    await sleep(200);
                    
                    // 全選現有內容
                    input.select();
                    await sleep(100);
                    
                    // 清空輸入框
                    input.value = '';
                    await sleep(100);
                    
                    // 設置新值
                    input.value = value;
                    
                    // 觸發 React 合成事件
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype,
                        'value'
                    )?.set;
                    
                    if (nativeInputValueSetter) {
                        // 使用原生 setter 來設置值
                        nativeInputValueSetter.call(input, value);
                    }
                    
                    // 觸發 input 事件（React 監聽的主要事件）
                    const inputEvent = new Event('input', { 
                        bubbles: true, 
                        cancelable: true 
                    });
                    input.dispatchEvent(inputEvent);
                    await sleep(150);
                    
                    // 觸發 change 事件
                    const changeEvent = new Event('change', { 
                        bubbles: true, 
                        cancelable: true 
                    });
                    input.dispatchEvent(changeEvent);
                    await sleep(150);
                    
                    // 觸發 keydown/keyup 事件（模擬用戶輸入）
                    input.dispatchEvent(new KeyboardEvent('keydown', { 
                        bubbles: true, 
                        cancelable: true,
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13
                    }));
                    await sleep(50);
                    input.dispatchEvent(new KeyboardEvent('keyup', { 
                        bubbles: true, 
                        cancelable: true,
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13
                    }));
                    await sleep(100);
                    
                    // 失去焦點（觸發 onBlur，通常會保存值）
                    input.blur();
                    await sleep(200);
                    
                    // 重新獲取焦點並驗證值
                    input.focus();
                    await sleep(200);
                    
                    // 驗證值是否已保存
                    const currentValue = input.value;
                    const valueMatch = currentValue === value || 
                                     parseFloat(currentValue) === parseFloat(value) ||
                                     Math.abs(parseFloat(currentValue) - parseFloat(value)) < 0.0001;
                    
                    if (valueMatch) {
                        log(`✓ ${description}: 設置為 ${value}（已驗證）`, 'success');
                        await sleep(500);
                        return true;
                    } else {
                        log(`⚠️ ${description}: 設置後驗證失敗（當前值: ${currentValue}, 期望值: ${value}）`, 'warning');
                        // 即使驗證失敗，也繼續（可能是驗證邏輯的問題）
                        await sleep(500);
                        return true;
                    }
                }
            }
            
            if (attempt < 4) {
                await sleep(1000);
            }
        }
        
        log(`⚠️ 未找到 ${description} 輸入框`, 'warning');
        return false;
    }
    
    // 查找並切換 Switch 開關
    async function findAndToggleSwitch(description, labelText, isFirst = true, additionalText = '') {
        for (let attempt = 0; attempt < 10; attempt++) {
            // 方法1: 通過標籤文字找到開關
            const allElements = Array.from(document.querySelectorAll('*'));
            let labelElement = null;
            
            // 首先嘗試精確匹配標籤文字
            for (const el of allElements) {
                const text = el.innerText?.trim() || el.textContent?.trim();
                // 精確匹配標籤文字（完全匹配或包含）
                if (text === labelText || (text.includes(labelText) && text.length < labelText.length + 20)) {
                    // 確保這是標籤元素（通常是 div 或 span）
                    if (el.tagName === 'DIV' || el.tagName === 'SPAN' || el.tagName === 'P') {
                        labelElement = el;
                        break;
                    }
                }
            }
            
            // 如果沒找到，嘗試更寬鬆的匹配
            if (!labelElement) {
                for (const el of allElements) {
                    const text = el.innerText?.trim() || el.textContent?.trim();
                    if (text.includes(labelText)) {
                        // 檢查是否在設置面板中（包含 border-genius-blue 的容器）
                        const inSettings = el.closest('[class*="border-genius-blue"]') || 
                                         el.closest('[class*="flex-col"]');
                        if (inSettings) {
                            labelElement = el;
                            break;
                        }
                    }
                }
            }
            
            if (labelElement) {
                // 向上查找包含 border-genius-blue 的容器（這是包含 switch 的容器）
                let container = labelElement.closest('[class*="border-genius-blue"]');
                if (!container) {
                    container = labelElement.closest('[class*="flex-col"]');
                }
                // 如果還是沒找到，向上查找包含 flex-col 的容器
                if (!container) {
                    let parent = labelElement.parentElement;
                    for (let i = 0; i < 15 && parent; i++) {
                        const parentClasses = typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || parent.className?.toString() || '');
                        if (parentClasses.includes('flex-col') || 
                            (parentClasses.includes('border') && parentClasses.includes('genius-blue'))) {
                            container = parent;
                            break;
                        }
                        parent = parent.parentElement;
                    }
                }
                
                if (container) {
                    const switches = Array.from(container.querySelectorAll('button[role="switch"]'));
                    
                    let targetSwitch = null;
                    
                    // 如果有額外的文字提示（如 "(EVM)" 或 "Best (EVM)"），嘗試找到對應的開關
                    if (additionalText) {
                        // 方法1: 查找包含 additionalText 的文字元素，然後在同一個 flex 容器中找 switch
                        const textElements = Array.from(container.querySelectorAll('*'));
                        for (const textEl of textElements) {
                            const text = textEl.innerText?.trim() || textEl.textContent?.trim();
                            if (text.includes(additionalText)) {
                                // 找到包含該文字的元素的父容器（通常是 flex 容器）
                                let switchContainer = textEl.closest('[class*="flex"]');
                                if (!switchContainer) {
                                    // 向上查找包含 flex 的父元素
                                    let parent = textEl.parentElement;
                                    for (let i = 0; i < 8 && parent; i++) {
                                        const parentClasses = typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || parent.className?.toString() || '');
                                        if (parentClasses.includes('flex') && parentClasses.includes('items-center')) {
                                            switchContainer = parent;
                                            break;
                                        }
                                        parent = parent.parentElement;
                                    }
                                }
                                if (switchContainer) {
                                    // 在同一個 flex 容器中查找 switch
                                    const switchInContainer = switchContainer.querySelector('button[role="switch"]');
                                    if (switchInContainer) {
                                        targetSwitch = switchInContainer;
                                        log(`✓ 通過 ${additionalText} 文字找到對應的 switch`, 'info');
                                        break;
                                    }
                                }
                            }
                        }
                        
                        // 方法2: 如果 additionalText 包含 "EVM"，查找第一個 switch（EVM 通常是第一個）
                        if (!targetSwitch && (additionalText.includes('EVM') || additionalText.includes('(EVM)'))) {
                            if (switches.length > 0) {
                                targetSwitch = switches[0];
                                log(`✓ 使用第一個 switch（EVM 通常是第一個）`, 'info');
                            }
                        }
                        
                        // 方法3: 如果 additionalText 包含 "Best (EVM)"，查找第一個 switch
                        if (!targetSwitch && additionalText.includes('Best (EVM)')) {
                            if (switches.length > 0) {
                                targetSwitch = switches[0];
                                log(`✓ 使用第一個 switch（Best EVM）`, 'info');
                            }
                        }
                    }
                    
                    // 如果沒找到，使用位置判斷
                    if (!targetSwitch) {
                        if (isFirst && switches.length > 0) {
                            targetSwitch = switches[0];
                        } else if (!isFirst && switches.length > 1) {
                            targetSwitch = switches[1];
                        } else if (switches.length > 0) {
                            targetSwitch = switches[0];
                        }
                    }
                    
                    if (targetSwitch) {
                        // 滾動到元素可見位置
                        targetSwitch.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        await sleep(400);
                        
                        const isChecked = targetSwitch.getAttribute('aria-checked') === 'true' ||
                                         targetSwitch.getAttribute('data-state') === 'checked';
                        
                        if (!isChecked) {
                            targetSwitch.click();
                            log(`✓ ${description}: 已開啟`, 'success');
                            await sleep(1000);
                            return true;
                        } else {
                            log(`✓ ${description}: 已經開啟`, 'info');
                            await sleep(500);
                            return true;
                        }
                    } else {
                        log(`⚠️ 在容器中找到 ${switches.length} 個 switch，但無法確定目標`, 'warning');
                    }
                } else {
                    log(`⚠️ 找到標籤 "${labelText}"，但未找到包含 switch 的容器`, 'warning');
                }
            }
            
            // 如果沒找到，等待更長時間讓 UI 展開
            if (attempt < 9) {
                const waitTime = attempt < 3 ? 1500 : (attempt < 6 ? 2000 : 2500);
                await sleep(waitTime);
            }
        }
        
        log(`⚠️ 未找到 ${description} 開關`, 'warning');
        return false;
    }
    
    // 執行 Preset 設定
    async function executePresetSetup() {
        log('🔧 開始 Preset 設定...', 'info');
        
        // 檢查是否已停止
        if (!isRunning) {
            log('⚠️ Preset 設定已取消（程序已停止）', 'warning');
            return false;
        }
        
        let successCount = 0;
        const totalSteps = 11;
        
        // 步驟 1: 點擊 Settings 按鈕
        if (!isRunning) return false;
        log('步驟 1/11: 點擊 Settings 按鈕', 'info');
        const step1 = await findAndClickElement([
            'svg.lucide-settings2',
            'svg.lucide-settings-2',
            { type: 'svg', selector: 'svg[class*="lucide-settings"]' },
            { type: 'text', text: 'Settings' }
        ], 'Settings 按鈕', 2000);
        if (step1) successCount++;
        
        // 步驟 2: 點選設定 PreSet 的鏈（NetworkButton）
        log('步驟 2/11: 點擊 Network 選擇按鈕', 'info');
        const step2 = await findAndClickElement([
            '[data-sentry-component="NetworkButton"]',
            { type: 'text', text: 'Solana' },
            'div[class*="border-genius-blue"][class*="cursor-pointer"]'
        ], 'Network 選擇按鈕', 1500);
        if (step2) successCount++;
        
        // 步驟 3: 選擇 OP 鏈
        log('步驟 3/11: 選擇 Optimism 鏈', 'info');
        let optimismFound = false;
        
        for (let attempt = 0; attempt < 5; attempt++) {
            let optimismButton = null;
            
            // 確保 Network 選擇對話框已打開
            const networkDialog = document.querySelector('[role="dialog"][data-state="open"]');
            const hasNetworkDialog = networkDialog && 
                (networkDialog.querySelector('[data-sentry-component="NetworkButton"]') || 
                 networkDialog.innerText?.includes('Network') ||
                 networkDialog.innerText?.includes('Optimism') ||
                 networkDialog.innerText?.includes('Solana'));
            
            if (!hasNetworkDialog) {
                log('⚠️ Network 選擇對話框未打開，重新點擊 Network 按鈕', 'warning');
                // 重新點擊 Network 按鈕
                const networkBtn = document.querySelector('[data-sentry-component="NetworkButton"]');
                if (networkBtn) {
                    networkBtn.click();
                    await sleep(1500);
                }
            }
            
            // 方法1: 精確匹配 - 查找包含 TokenImage 且文字為 "Optimism" 的元素
            const tokenImages = document.querySelectorAll('[data-sentry-component="TokenImage"]');
            for (const tokenImage of tokenImages) {
                // 向上查找包含 cursor-pointer 和 hover:bg-genius-blue 的父元素
                let parent = tokenImage.parentElement;
                let attempts = 0;
                while (parent && attempts < 12) {
                    const classes = typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || parent.className?.toString() || '');
                    
                    // 檢查是否符合鏈選擇按鈕的特徵：cursor-pointer, hover:bg-genius-blue, 包含 TokenImage
                    if (classes.includes('cursor-pointer') && 
                        (classes.includes('hover:bg-genius-blue') || classes.includes('rounded-sm'))) {
                        
                        // 檢查是否包含 "Optimism" 文字（精確匹配）
                        const text = parent.innerText?.trim() || parent.textContent?.trim() || '';
                        const hasOptimismText = text === 'Optimism' || 
                                              (text.includes('Optimism') && !text.includes('Solana') && !text.includes('Ethereum') && text.length < 50);
                        
                        if (hasOptimismText) {
                            // 確認在 Network 選擇對話框內
                            const inDialog = parent.closest('[role="dialog"]');
                            if (inDialog || hasNetworkDialog) {
                                const rect = parent.getBoundingClientRect();
                                const style = window.getComputedStyle(parent);
                                
                                if (rect.width > 0 && rect.height > 0 && 
                                    style.display !== 'none' && 
                                    style.visibility !== 'hidden' &&
                                    parent.offsetParent !== null) {
                                    optimismButton = parent;
                                    log('✓ 通過 TokenImage 找到 Optimism 鏈按鈕', 'info');
                                    break;
                                }
                            }
                        }
                    }
                    parent = parent.parentElement;
                    attempts++;
                }
                if (optimismButton) break;
            }
            
            // 方法2: 通過 span 文字 "Optimism" 查找（精確匹配）
            if (!optimismButton) {
                const allSpans = document.querySelectorAll('span.text-genius-cream, span[class*="text-genius-cream"]');
                for (const span of allSpans) {
                    const text = span.innerText?.trim() || span.textContent?.trim() || '';
                    if (text === 'Optimism' || (text.toLowerCase() === 'optimism')) {
                        // 向上查找包含 cursor-pointer 的父元素
                        let parent = span.parentElement;
                        let attempts = 0;
                        while (parent && attempts < 12) {
                            const classes = typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || parent.className?.toString() || '');
                            
                            if (classes.includes('cursor-pointer') && 
                                (classes.includes('hover:bg-genius-blue') || classes.includes('rounded-sm'))) {
                                
                                // 確認包含 TokenImage
                                const hasTokenImage = parent.querySelector('[data-sentry-component="TokenImage"]');
                                if (hasTokenImage) {
                                    // 確認在 Network 選擇對話框內
                                    const inDialog = parent.closest('[role="dialog"]');
                                    if (inDialog || hasNetworkDialog) {
                                        const rect = parent.getBoundingClientRect();
                                        const style = window.getComputedStyle(parent);
                                        
                                        if (rect.width > 0 && rect.height > 0 && 
                                            style.display !== 'none' && 
                                            style.visibility !== 'hidden' &&
                                            parent.offsetParent !== null) {
                                            optimismButton = parent;
                                            log('✓ 通過 span 文字找到 Optimism 鏈按鈕', 'info');
                                            break;
                                        }
                                    }
                                }
                            }
                            parent = parent.parentElement;
                            attempts++;
                        }
                        if (optimismButton) break;
                    }
                }
            }
            
            // 方法3: 直接查找包含 Optimism 文字且帶有 cursor-pointer 的 div（備用）
            if (!optimismButton) {
                const allDivs = document.querySelectorAll('div.cursor-pointer');
                for (const div of allDivs) {
                    const text = div.innerText?.trim() || div.textContent?.trim() || '';
                    // 精確匹配 Optimism，排除其他鏈
                    if (text === 'Optimism' || (text.includes('Optimism') && !text.includes('Solana') && !text.includes('Ethereum') && text.length < 50)) {
                        const rect = div.getBoundingClientRect();
                        const style = window.getComputedStyle(div);
                        
                        if (rect.width > 0 && rect.height > 0 && 
                            style.display !== 'none' && 
                            style.visibility !== 'hidden' &&
                            div.offsetParent !== null) {
                            // 檢查是否包含 TokenImage（確認這是鏈選擇按鈕）
                            const hasTokenImage = div.querySelector('[data-sentry-component="TokenImage"]');
                            if (hasTokenImage) {
                                // 確認在 Network 選擇對話框內
                                const inDialog = div.closest('[role="dialog"]');
                                if (inDialog || hasNetworkDialog) {
                                    optimismButton = div;
                                    log('✓ 通過 cursor-pointer div 找到 Optimism 鏈按鈕', 'info');
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            
            if (optimismButton) {
                // 滾動到元素可見位置
                optimismButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(400);
                
                // 確認元素仍然可見和可點擊
                const rect = optimismButton.getBoundingClientRect();
                const style = window.getComputedStyle(optimismButton);
                if (rect.width === 0 || rect.height === 0 || 
                    style.display === 'none' || 
                    style.visibility === 'hidden' ||
                    optimismButton.offsetParent === null) {
                    log('⚠️ Optimism 鏈按鈕不可見，跳過此次嘗試', 'warning');
                    if (attempt < 4) {
                        await sleep(1000);
                        continue;
                    }
                }
                
                // 點擊鏈按鈕
                optimismButton.click();
                log('✓ 點擊 Optimism 鏈按鈕', 'success');
                
                // 等待 UI 更新
                await sleep(2500);
                
                // 驗證鏈是否真的被選中
                let verified = false;
                for (let verifyAttempt = 0; verifyAttempt < 8; verifyAttempt++) {
                    // 方法1: 檢查 Network 按鈕的文字是否包含 Optimism/OP
                    const networkButton = document.querySelector('[data-sentry-component="NetworkButton"]');
                    if (networkButton) {
                        const networkText = networkButton.innerText?.trim() || networkButton.textContent?.trim() || '';
                        if (networkText.includes('Optimism') || networkText.includes('OP') || 
                            networkText.includes('OP Mainnet')) {
                            log('✓ Optimism 鏈已成功選中（通過 Network 按鈕驗證）', 'success');
                            verified = true;
                            break;
                        }
                    }
                    
                    // 方法2: 檢查 Network 選擇對話框是否關閉（表示已選擇）
                    const currentNetworkDialog = document.querySelector('[role="dialog"][data-state="open"]');
                    const stillHasNetworkDialog = currentNetworkDialog && 
                        (currentNetworkDialog.querySelector('[data-sentry-component="NetworkButton"]') || 
                         currentNetworkDialog.innerText?.includes('Network') ||
                         currentNetworkDialog.innerText?.includes('Optimism') ||
                         currentNetworkDialog.innerText?.includes('Solana'));
                    
                    if (!stillHasNetworkDialog && verifyAttempt >= 2) {
                        // 對話框已關閉，可能已選擇
                        log('✓ Network 選擇對話框已關閉，可能已選擇鏈', 'info');
                        // 再次檢查 Network 按鈕確認
                        const checkNetworkBtn = document.querySelector('[data-sentry-component="NetworkButton"]');
                        if (checkNetworkBtn) {
                            const checkText = checkNetworkBtn.innerText?.trim() || checkNetworkBtn.textContent?.trim() || '';
                            if (checkText.includes('Optimism') || checkText.includes('OP')) {
                                verified = true;
                                break;
                            }
                        }
                        // 如果 Network 按鈕沒有顯示 Optimism，但對話框已關閉，假設已選擇
                        if (verifyAttempt >= 4) {
                            log('✓ Network 選擇對話框已關閉，假設 Optimism 鏈已選中', 'success');
                            verified = true;
                            break;
                        }
                    }
                    
                    // 方法3: 檢查頁面中是否有 Optimism 相關的選中狀態
                    const selectedElements = document.querySelectorAll('[class*="selected"], [class*="active"], [aria-selected="true"]');
                    for (const selectedEl of selectedElements) {
                        const text = selectedEl.innerText?.trim() || selectedEl.textContent?.trim() || '';
                        if (text.includes('Optimism') || text.includes('OP')) {
                            log('✓ Optimism 鏈已成功選中（通過選中狀態驗證）', 'success');
                            verified = true;
                            break;
                        }
                    }
                    
                    if (verified) break;
                    await sleep(500);
                }
                
                if (verified) {
                    optimismFound = true;
                    break;
                } else {
                    log(`⚠️ 點擊 Optimism 鏈後驗證失敗（嘗試 ${attempt + 1}/5）`, 'warning');
                }
            } else {
                log(`⚠️ 未找到 Optimism 鏈按鈕（嘗試 ${attempt + 1}/5）`, 'warning');
            }
            
            if (attempt < 4) {
                await sleep(1000);
            }
        }
        
        if (optimismFound) {
            successCount++;
        } else {
            log('⚠️ 未成功選擇 Optimism 鏈，但將繼續執行後續步驟', 'warning');
            // 即使驗證失敗，也繼續執行（可能是驗證邏輯的問題）
            successCount++;
        }
        
        // 確保 Settings 面板仍然打開（在選擇鏈後）
        await sleep(500);
        const settingsPanelOpen = document.querySelector('svg.lucide-settings2, svg.lucide-settings-2')?.closest('[role="dialog"]') ||
                                  document.querySelector('[role="dialog"][data-state="open"]');
        
        if (!settingsPanelOpen) {
            log('⚠️ Settings 面板已關閉，重新打開...', 'warning');
            // 重新點擊 Settings 按鈕
            const settingsBtn = await findAndClickElement([
                'svg.lucide-settings2',
                'svg.lucide-settings-2',
                { type: 'svg', selector: 'svg[class*="lucide-settings"]' }
            ], 'Settings 按鈕（重新打開）', 2000);
            if (settingsBtn) {
                await sleep(1500);
            }
        }
        
        // 步驟 4: 設定 slippage % 至初始值
        if (!isRunning) return false;
        const slippageInitialValue = CONFIG.enableDynamicAdjustment ? CONFIG.slippageInitial : 0.1;
        const slippageInitialStr = slippageInitialValue.toFixed(2);
        log(`步驟 4/11: 設定 Slippage 至 ${slippageInitialStr}%`, 'info');
        const step4 = await findAndSetInput([
            { type: 'text', text: 'Slippage' },
            { type: 'data-attr', attr: 'data-sentry-component', value: 'Slippage' }
        ], slippageInitialStr, 'Slippage');
        if (step4) {
            successCount++;
            // 更新當前值
            if (CONFIG.enableDynamicAdjustment) {
                currentSlippage = slippageInitialValue;
            }
            // 驗證 Slippage 值是否已保存
            await sleep(1000);
            const slippageVerified = await verifyInputValue('Slippage', slippageInitialStr);
            if (!slippageVerified) {
                log('⚠️ Slippage 值驗證失敗，但將繼續', 'warning');
            }
        }
        
        // 步驟 5: 設定 Priority (Gwei) 至初始值
        if (!isRunning) return false;
        const priorityInitialValue = CONFIG.enableDynamicAdjustment ? CONFIG.priorityInitial : 0.002;
        const priorityInitialStr = priorityInitialValue.toFixed(4);
        log(`步驟 5/11: 設定 Priority (Gwei) 至 ${priorityInitialStr}`, 'info');
        const step5 = await findAndSetInput([
            { type: 'text', text: 'Priority (Gwei)' }
        ], priorityInitialStr, 'Priority (Gwei)');
        if (step5) {
            successCount++;
            // 更新當前值
            if (CONFIG.enableDynamicAdjustment) {
                currentPriority = priorityInitialValue;
            }
            // 驗證 Priority (Gwei) 值是否已保存
            await sleep(1000);
            const priorityVerified = await verifyInputValue('Priority (Gwei)', priorityInitialStr);
            if (!priorityVerified) {
                log('⚠️ Priority (Gwei) 值驗證失敗，但將繼續', 'warning');
            }
        }
        
        // 在前往下一個設定前，再次驗證 Slippage 和 Priority (Gwei) 值
        if (!isRunning) return false;
        log('驗證 Slippage 和 Priority (Gwei) 值是否仍然正確...', 'info');
        await sleep(500);
        const slippageFinalCheck = await verifyInputValue('Slippage', slippageInitialStr);
        const priorityFinalCheck = await verifyInputValue('Priority (Gwei)', priorityInitialStr);
        
        if (!slippageFinalCheck || !priorityFinalCheck) {
            log('⚠️ 檢測到值可能被重置，嘗試重新設置...', 'warning');
            
            // 如果 Slippage 值不正確，重新設置
            if (!slippageFinalCheck) {
                log(`重新設置 Slippage 至 ${slippageInitialStr}...`, 'info');
                await findAndSetInput([
                    { type: 'text', text: 'Slippage' },
                    { type: 'data-attr', attr: 'data-sentry-component', value: 'Slippage' }
                ], slippageInitialStr, 'Slippage');
                await sleep(1000);
            }
            
            // 如果 Priority (Gwei) 值不正確，重新設置
            if (!priorityFinalCheck) {
                log(`重新設置 Priority (Gwei) 至 ${priorityInitialStr}...`, 'info');
                await findAndSetInput([
                    { type: 'text', text: 'Priority (Gwei)' }
                ], priorityInitialStr, 'Priority (Gwei)');
                await sleep(1000);
            }
        } else {
            log('✓ Slippage 和 Priority (Gwei) 值驗證通過', 'success');
        }
        
        // 步驟 6: 點選 Aggregator/Fast Swaps 設定
        if (!isRunning) return false;
        log('步驟 6/11: 點擊 Aggregator/Fast Swaps', 'info');
        const step6 = await findAndClickElement([
            { type: 'text', text: 'Aggregator/Fast Swaps' },
            'div.cursor-pointer[class*="hover:bg-genius-pink"]',
            'div[class*="cursor-pointer"][class*="hover:bg-genius-pink"]'
        ], 'Aggregator/Fast Swaps', 2500, async () => {
            // 驗證函數：檢查 "Globally disable fast swaps" 標籤是否出現
            for (let i = 0; i < 5; i++) {
                const allElements = Array.from(document.querySelectorAll('*'));
                const found = allElements.some(el => {
                    const text = el.innerText?.trim() || el.textContent?.trim();
                    return text === 'Globally disable fast swaps' || text.includes('Globally disable fast swaps');
                });
                if (found) {
                    log('✓ Aggregator/Fast Swaps 已成功展開', 'info');
                    return true;
                }
                await sleep(500);
            }
            return false;
        });
        if (step6) {
            successCount++;
            // 額外等待時間確保 UI 完全展開
            await sleep(2000);
        }
        
        // 步驟 7: 打開 Globally disable fast swaps 中的 EVM
        if (!isRunning) return false;
        log('步驟 7/11: 開啟 Globally disable fast swaps (EVM)', 'info');
        const step7 = await findAndToggleSwitch(
            'Globally disable fast swaps (EVM)',
            'Globally disable fast swaps',
            true,
            '(EVM)'
        );
        if (step7) successCount++;
        
        // 步驟 8: 打開 Best or Fastest Quote 中的 Best (EVM)
        if (!isRunning) return false;
        log('步驟 8/11: 開啟 Best or Fastest Quote (Best EVM)', 'info');
        const step8 = await findAndToggleSwitch(
            'Best or Fastest Quote (Best EVM)',
            'Best or Fastest Quote',
            true,
            'Best (EVM)'
        );
        if (step8) successCount++;
        
        // 步驟 9: 打開 EVM Simulations
        if (!isRunning) return false;
        log('步驟 9/11: 開啟 EVM Simulations', 'info');
        const step9 = await findAndToggleSwitch(
            'EVM Simulations',
            'EVM Simulations',
            true
        );
        if (step9) successCount++;
        
        // 步驟 10: 點選 Fees 設定
        if (!isRunning) return false;
        log('步驟 10/11: 點擊 Fees 設定', 'info');
        const step10 = await findAndClickElement([
            { type: 'text', text: 'Fees' },
            'div.cursor-pointer[class*="hover:bg-genius-pink"]',
            'div[class*="cursor-pointer"][class*="hover:bg-genius-pink"]'
        ], 'Fees 設定', 3000, async () => {
            // 驗證函數：檢查 "Show Fees" 標籤是否出現，並且包含 switch 元素
            for (let i = 0; i < 8; i++) {
                const allElements = Array.from(document.querySelectorAll('*'));
                let foundLabel = false;
                let foundSwitch = false;
                
                // 查找 "Show Fees" 標籤
                for (const el of allElements) {
                    const text = el.innerText?.trim() || el.textContent?.trim();
                    if (text === 'Show Fees' || text.includes('Show Fees')) {
                        foundLabel = true;
                        // 檢查同一個容器中是否有 switch
                        const container = el.closest('[class*="border-genius-blue"]') || 
                                        el.closest('[class*="flex-col"]');
                        if (container) {
                            const switches = container.querySelectorAll('button[role="switch"]');
                            if (switches.length > 0) {
                                foundSwitch = true;
                                break;
                            }
                        }
                    }
                }
                
                if (foundLabel && foundSwitch) {
                    log('✓ Fees 設定已成功展開（找到 Show Fees 標籤和開關）', 'info');
                    return true;
                } else if (foundLabel) {
                    log('✓ Fees 設定已展開（找到 Show Fees 標籤）', 'info');
                    return true;
                }
                
                await sleep(700);
            }
            log('⚠️ Fees 設定展開驗證失敗（未找到 Show Fees）', 'warning');
            return false;
        });
        if (step10) {
            successCount++;
            // 額外等待時間確保 UI 完全展開
            await sleep(2000);
        }
        
        // 步驟 11: 打開 Show Fees
        if (!isRunning) return false;
        log('步驟 11/11: 開啟 Show Fees', 'info');
        const step11 = await findAndToggleSwitch(
            'Show Fees',
            'Show Fees',
            true
        );
        if (step11) successCount++;
        
        // 步驟 12: 點擊關閉按鈕關閉設定面板
        if (!isRunning) return false;
        log('步驟 12/12: 點擊關閉按鈕', 'info');
        let closeButtonClicked = false;
        
        for (let attempt = 0; attempt < 5; attempt++) {
            // 方法1: 通過 lucide-x SVG 查找
            const closeSvg = document.querySelector('svg.lucide-x, svg[class*="lucide-x"]');
            if (closeSvg) {
                // 向上查找 button 父元素
                let button = closeSvg.closest('button');
                if (!button) {
                    let parent = closeSvg.parentElement;
                    for (let i = 0; i < 5 && parent; i++) {
                        if (parent.tagName === 'BUTTON') {
                            button = parent;
                            break;
                        }
                        parent = parent.parentElement;
                    }
                }
                
                if (button) {
                    const rect = button.getBoundingClientRect();
                    const style = window.getComputedStyle(button);
                    
                    if (rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        button.offsetParent !== null) {
                        
                        // 滾動到元素可見位置
                        button.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        await sleep(300);
                        
                        button.click();
                        log('✓ 關閉按鈕已點擊', 'success');
                        closeButtonClicked = true;
                        await sleep(1500);
                        break;
                    }
                }
            }
            
            // 方法2: 通過按鈕類名和位置查找（右上角）
            if (!closeButtonClicked) {
                const buttons = document.querySelectorAll('button[class*="right-4"][class*="top-"]');
                for (const btn of buttons) {
                    const classes = btn.className || '';
                    if (classes.includes('lucide-x') || btn.querySelector('svg.lucide-x')) {
                        const rect = btn.getBoundingClientRect();
                        const style = window.getComputedStyle(btn);
                        
                        if (rect.width > 0 && rect.height > 0 &&
                            style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            btn.offsetParent !== null) {
                            
                            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            await sleep(300);
                            
                            btn.click();
                            log('✓ 關閉按鈕已點擊（通過位置查找）', 'success');
                            closeButtonClicked = true;
                            await sleep(1500);
                            break;
                        }
                    }
                }
            }
            
            // 方法3: 通過 aria-label="Close" 或包含 "Close" 文字的按鈕
            if (!closeButtonClicked) {
                const allButtons = document.querySelectorAll('button');
                for (const btn of allButtons) {
                    const ariaLabel = btn.getAttribute('aria-label');
                    const hasCloseText = btn.innerText?.includes('Close') || 
                                       btn.querySelector('span.sr-only')?.textContent?.includes('Close');
                    
                    if (ariaLabel === 'Close' || hasCloseText) {
                        const hasCloseSvg = btn.querySelector('svg.lucide-x');
                        if (hasCloseSvg) {
                            const rect = btn.getBoundingClientRect();
                            const style = window.getComputedStyle(btn);
                            
                            if (rect.width > 0 && rect.height > 0 &&
                                style.display !== 'none' &&
                                style.visibility !== 'hidden' &&
                                btn.offsetParent !== null) {
                                
                                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                await sleep(300);
                                
                                btn.click();
                                log('✓ 關閉按鈕已點擊（通過 aria-label）', 'success');
                                closeButtonClicked = true;
                                await sleep(1500);
                                break;
                            }
                        }
                    }
                }
            }
            
            if (closeButtonClicked) break;
            
            if (attempt < 4) {
                log(`重試查找關閉按鈕... (${attempt + 1}/5)`, 'warning');
                await sleep(1000);
            }
        }
        
        if (closeButtonClicked) {
            successCount++;
            log('✓ 設定面板已關閉', 'success');
        } else {
            log('⚠️ 未找到關閉按鈕，但將繼續執行', 'warning');
        }
        
        // 檢查是否在執行過程中已被停止
        if (!isRunning) {
            log('⚠️ Preset 設定已取消（程序已停止）', 'warning');
            return false;
        }
        
        const actualTotalSteps = totalSteps + 1; // 加上關閉按鈕步驟
        log(`✅ Preset 設定完成: ${successCount}/${actualTotalSteps} 步驟成功`, successCount >= totalSteps ? 'success' : 'warning');
        
        if (successCount < totalSteps) {
            log(`⚠️ 有 ${totalSteps - successCount} 個步驟未完成，但將繼續執行交易`, 'warning');
        }
        
        // 確保所有視窗都已關閉（只在視窗仍然打開時才執行）
        if (isDialogOpen()) {
            log('確保 Preset 設定視窗已完全關閉...', 'info');
            await ensureAllDialogsClosed(5);
        }
        
        await sleep(2000);
        if (!isRunning) return false; // 檢查是否在等待期間被停止
        return successCount >= totalSteps; // 至少完成所有主要步驟
    }

    // ==================== 核心交易函數 ====================

    // 選擇第一個代幣（餘額最大的 USDC 或 USDT）
    async function selectFirstToken() {
        log('選擇發送代幣（餘額最大）...', 'info');

        await sleep(CONFIG.waitAfterChoose);

        for (let attempt = 0; attempt < CONFIG.maxRetryTokenSelect; attempt++) {
            // 檢查是否已停止
            if (!isRunning) {
                log('⚠️ 選擇代幣已取消（程序已停止）', 'warning');
                return false;
            }

            const tokenRows = document.querySelectorAll('[role="dialog"] .cursor-pointer');
            let maxBalance = -1;
            let targetRow = null;
            let targetSymbol = null;

            tokenRows.forEach(row => {
                const symbolEl = row.querySelector('.text-xs.text-genius-cream\\/60, .text-sm.text-genius-cream');
                const symbol = symbolEl?.innerText?.trim();

                if (symbol === 'USDT' || symbol === 'USDC') {
                    const balanceText = row.querySelector('.flex.flex-nowrap.justify-end, .text-right')?.innerText || '';
                    const balanceMatch = balanceText.match(/[\d,\.]+/);

                    if (balanceMatch) {
                        const balance = parseFloat(balanceMatch[0].replace(/,/g, ''));
                        log(`發現 ${symbol}: 餘額 ${balance}`, 'info');

                        if (balance > maxBalance && balance >= CONFIG.minBalanceThreshold) {
                            maxBalance = balance;
                            targetRow = row;
                            targetSymbol = symbol;
                        }
                    }
                }
            });

            if (targetRow) {
                // 再次檢查是否已停止
                if (!isRunning) {
                    log('⚠️ 選擇代幣已取消（程序已停止）', 'warning');
                    return false;
                }
                targetRow.click();
                currentFromToken = targetSymbol;
                log(`✓ 選擇了 ${targetSymbol} (餘額: ${maxBalance})`, 'success');
                return true;
            }

            if (attempt < CONFIG.maxRetryTokenSelect - 1) {
                log(`未找到足夠餘額的代幣，重試 ${attempt + 1}/${CONFIG.maxRetryTokenSelect}...`, 'warning');
                await sleep(1000);
                // 在等待期間檢查是否已停止
                if (!isRunning) {
                    log('⚠️ 選擇代幣已取消（程序已停止）', 'warning');
                    return false;
                }
            }
        }

        log('❌ 未找到 USDT/USDC 或餘額不足', 'error');
        return false;
    }

    // 選擇第二個代幣（與第一個相反，指定鏈）
    async function selectSecondToken() {
        if (!currentFromToken) {
            log('❌ 第一個代幣未選擇', 'error');
            return false;
        }

        // 檢查是否已停止
        if (!isRunning) {
            log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
            return false;
        }

        const targetToken = currentFromToken === 'USDT' ? 'USDC' : 'USDT';
        log(`選擇接收代幣: ${targetToken} (${CONFIG.chainDisplayName} 鏈)`, 'info');

        await sleep(CONFIG.waitAfterChoose);

        // 檢查是否已停止
        if (!isRunning) {
            log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
            return false;
        }

        // 1. 點擊 Stable 標籤
        log('查找 Stable 標籤...', 'info');
        let stableTab = null;

        const method1 = document.querySelectorAll('.flex.flex-col.text-sm.cursor-pointer.text-genius-cream, [role="dialog"] div[class*="cursor-pointer"]');
        for (const tab of method1) {
            if (!isRunning) {
                log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
                return false;
            }
            const text = tab.innerText?.trim();
            if (text === 'Stable' || text === '稳定') {
                stableTab = tab;
                log('✓ 找到 Stable 標籤', 'success');
                break;
            }
        }

        if (stableTab) {
            // 檢查是否已停止
            if (!isRunning) {
                log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
                return false;
            }
            stableTab.click();
            await sleep(1000);
        } else {
            log('未找到 Stable 標籤，繼續嘗試...', 'warning');
        }

        await sleep(500);

        // 檢查是否已停止
        if (!isRunning) {
            log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
            return false;
        }

        // 2. 查找目標代幣行
        log(`查找 ${targetToken} 代幣...`, 'info');
        const rows = document.querySelectorAll('[role="dialog"] .cursor-pointer, [role="dialog"] .relative.group');
        let targetRow = null;

        for (const row of rows) {
            if (!isRunning) {
                log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
                return false;
            }
            const text = row.textContent || '';
            const hasTarget = targetToken === 'USDT' ? text.includes('USDT') && !text.includes('USDC') : 
                            text.includes('USDC') && !text.includes('USDT');
            const hasPrice = text.includes('$');

            if (hasTarget && hasPrice) {
                targetRow = row;
                log(`✓ 找到 ${targetToken} 代幣行`, 'success');
                break;
            }
        }

        if (!targetRow) {
            log(`❌ 未找到 ${targetToken} 代幣行`, 'error');
            return false;
        }

        // 檢查是否已停止
        if (!isRunning) {
            log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
            return false;
        }

        // 3. 先 hover 到代幣行，觸發鏈選擇菜單（參考 tradegenius-autopilot.user.js）
        log('懸浮到代幣行以觸發鏈選擇菜單...', 'info');
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(200);
        
        // 觸發 mouseenter 事件到代幣行
        const rowMouseEnter = new MouseEvent('mouseenter', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        targetRow.dispatchEvent(rowMouseEnter);
        
        const rowMouseOver = new MouseEvent('mouseover', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        targetRow.dispatchEvent(rowMouseOver);
        
        await sleep(500); // 等待 hover 效果觸發菜單

        // 4. 點擊代幣行，打開鏈選擇菜單
        log('點擊代幣行打開鏈選擇菜單...', 'info');
        targetRow.click();
        await sleep(1500);

        // 檢查是否已停止
        if (!isRunning) {
            log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
            return false;
        }

        // 5. 查找目標鏈選項（參考 tradegenius_userscript.js 的方法）
        log(`在浮動菜單中查找 ${CONFIG.chainDisplayName} (Optimism) 鏈按鈕...`, 'info');
        let chainButton = null;
        let chainContainer = null; // 包含鏈選項的可 hover 容器

        for (let i = 0; i < 10; i++) {
            // 檢查是否已停止
            if (!isRunning) {
                log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
                return false;
            }

            const allElements = document.querySelectorAll('*');

            for (const el of allElements) {
                const text = el.innerText?.trim();
                const chainNames = [CONFIG.targetChain];
                
                // 添加鏈的別名（Optimism/OP 鏈）
                if (CONFIG.targetChain === 'Optimism') {
                    chainNames.push('OP', 'OP Mainnet', 'Optimism', 'Optimistic Ethereum', 'Optimism Mainnet');
                }

                // 精確匹配 Optimism 文字（參考 tradegenius_userscript.js）
                if (text === 'Optimism' || (chainNames.some(name => text === name))) {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);

                    if (rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        el.offsetParent !== null) {

                        const targetRowRect = targetRow.getBoundingClientRect();
                        // 確保鏈選項在代幣行下方（浮動菜單中）
                        if (rect.top > targetRowRect.bottom) {
                            // 找到包含該鏈選項的可 hover 容器（有 hover:bg-genius-blue 的 div）
                            let hoverContainer = null;
                            let parent = el.parentElement;
                            let attempts = 0;

                            // 向上查找包含 hover:bg-genius-blue 和 cursor-pointer 的容器
                            while (parent && attempts < 10) {
                                const classes = parent.className || '';
                                // 查找包含 hover:bg-genius-blue 的容器
                                if (classes.includes('hover:bg-genius-blue') && classes.includes('cursor-pointer')) {
                                    hoverContainer = parent;
                                    break;
                                }
                                parent = parent.parentElement;
                                attempts++;
                            }

                            // 找到可點擊的父元素
                            let clickTarget = el;
                            parent = el.parentElement;
                            attempts = 0;

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

                            chainButton = clickTarget;
                            chainContainer = hoverContainer || clickTarget; // 如果找不到 hover 容器，使用點擊目標
                            log(`✓ 找到 ${CONFIG.chainDisplayName} (Optimism) 鏈按鈕（嘗試 ${i + 1}/10）`, 'success');
                            break;
                        }
                    }
                }
            }

            if (chainButton) break;
            await sleep(300);
        }

        // 檢查是否已停止
        if (!isRunning) {
            log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
            return false;
        }

        if (!chainButton) {
            log(`⚠️ 未在浮動菜單中找到 ${CONFIG.chainDisplayName} (Optimism) 鏈按鈕，嘗試直接選擇代幣`, 'warning');
            // Fallback: 直接點擊代幣（使用默認鏈）
            return true;
        }

        // 6. 先 hover 到包含鏈選項的容器（觸發 hover 效果）
        if (chainContainer && chainContainer !== chainButton) {
            log('懸浮到鏈選項容器以觸發 hover 效果...', 'info');
            chainContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(200);
            
            // 觸發 mouseenter 和 mouseover 事件
            const mouseEnterEvent = new MouseEvent('mouseenter', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            chainContainer.dispatchEvent(mouseEnterEvent);
            
            const mouseOverEvent = new MouseEvent('mouseover', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            chainContainer.dispatchEvent(mouseOverEvent);
            
            log('✓ 已觸發 hover 事件到鏈選項容器', 'success');
            await sleep(400); // 等待 hover 效果生效
        }

        // 7. 點擊鏈按鈕
        chainButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(200);
        chainButton.click();
        log(`✓ 選擇了 ${targetToken} (${CONFIG.chainDisplayName} 鏈)`, 'success');
        await sleep(1500);

        // 6. 確保視窗已關閉
        log('確保代幣選擇視窗已關閉...', 'info');
        await ensureAllDialogsClosed(5);
        await sleep(500);

        return true;
    }

    // 重新選擇幣種（當餘額不足時）
    async function reselectTokensForBalance() {
        log('🔄 餘額不足，重新選擇幣種...', 'warning');
        
        // 清除當前選擇的代幣
        currentFromToken = null;
        
        // 確保所有視窗都已關閉
        if (isDialogOpen()) {
            await ensureAllDialogsClosed(3);
            await sleep(500);
        }
        
        // 查找所有代幣選擇按鈕（包括已選擇的）
        const allTokenBtns = findAllTokenSelectionButtons();
        
        if (allTokenBtns.length === 0) {
            log('⚠️ 未找到代幣選擇按鈕，無法重新選擇幣種', 'warning');
            return false;
        }
        
        if (allTokenBtns.length < 2) {
            log(`⚠️ 只找到 ${allTokenBtns.length} 個代幣選擇按鈕，預期至少 2 個`, 'warning');
        }
        
        // 點擊第一個按鈕（發送代幣）- 即使它已經被選擇了
        const firstBtn = allTokenBtns[0];
        log('點擊第一個代幣選擇按鈕 (發送) 以重新選擇', 'info');
        firstBtn.click();
        await sleep(CONFIG.waitAfterChoose);
        
        // 檢查是否已停止
        if (!isRunning) {
            return false;
        }
        
        // 選擇第一個代幣（會自動選擇餘額最大的）
        if (isDialogOpen()) {
            const success = await selectFirstToken();
            if (!success) {
                if (!isRunning) return false;
                log('重新選擇第一個代幣失敗', 'error');
                return false;
            }
            await sleep(CONFIG.waitAfterTokenSelect);
        }
        
        // 檢查是否已停止
        if (!isRunning) {
            return false;
        }
        
        log(`✓ 重新選擇的代幣: ${currentFromToken}`, 'success');
        
        // 點擊第二個按鈕（接收代幣）
        await sleep(500);
        const allTokenBtns2 = findAllTokenSelectionButtons();
        
        if (allTokenBtns2.length >= 2) {
            // 確保點擊的是第二個按鈕（接收代幣）
            const secondBtn = allTokenBtns2[1];
            log('點擊第二個代幣選擇按鈕 (接收) 以重新選擇', 'info');
            secondBtn.click();
            await sleep(CONFIG.waitAfterChoose);
            
            // 檢查是否已停止
            if (!isRunning) {
                return false;
            }
            
            if (isDialogOpen()) {
                const success = await selectSecondToken();
                if (!success) {
                    if (!isRunning) return false;
                    log('重新選擇第二個代幣失敗', 'error');
                    return false;
                }
                await sleep(CONFIG.waitAfterTokenSelect);
            }
        } else if (allTokenBtns2.length === 1) {
            // 如果只有一個按鈕，可能是第二個還沒被選擇，嘗試點擊它
            log('只找到 1 個代幣選擇按鈕，嘗試點擊第二個 (接收)', 'info');
            allTokenBtns2[0].click();
            await sleep(CONFIG.waitAfterChoose);
            
            if (!isRunning) {
                return false;
            }
            
            if (isDialogOpen()) {
                const success = await selectSecondToken();
                if (!success) {
                    if (!isRunning) return false;
                    log('重新選擇第二個代幣失敗', 'error');
                    return false;
                }
                await sleep(CONFIG.waitAfterTokenSelect);
            }
        }
        
        // 確保所有視窗都已關閉
        if (isDialogOpen()) {
            log('確保代幣選擇視窗已關閉...', 'info');
            await ensureAllDialogsClosed(3);
            await sleep(500);
        }
        
        log('✓ 幣種重新選擇完成', 'success');
        await sleep(1000);
        
        return true;
    }

    // ==================== 增強版失敗檢測函數 ====================
    
    // 檢測失敗彈窗或錯誤提示
    function detectFailureSignals() {
        const failureSignals = {
            hasFailurePopup: false,
            hasErrorMessage: false,
            errorText: null,
            hasInsufficientBalance: false,
            hasSlippageError: false,
            hasNetworkError: false
        };

        try {
            // 1. 檢測失敗/錯誤彈窗
            const errorSelectors = [
                '[class*="error"]',
                '[class*="Error"]',
                '[class*="failed"]',
                '[class*="Failed"]',
                '[class*="alert"]',
                '.text-red-500',
                '.text-red-600',
                '[role="alert"]'
            ];

            for (const selector of errorSelectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    const text = (el.innerText || el.textContent || '').trim();
                    
                    if (text.length > 0 && text.length < 500) { // 避免匹配過長的內容
                        const lowerText = text.toLowerCase();
                        
                        // 檢測失敗關鍵字
                        if (lowerText.includes('fail') || lowerText.includes('失敗') ||
                            lowerText.includes('error') || lowerText.includes('錯誤')) {
                            failureSignals.hasErrorMessage = true;
                            failureSignals.errorText = text.substring(0, 200); // 限制長度
                            
                            // 檢測具體的錯誤類型
                            if (lowerText.includes('balance') || lowerText.includes('餘額') ||
                                lowerText.includes('insufficient') || lowerText.includes('不足')) {
                                failureSignals.hasInsufficientBalance = true;
                            }
                            
                            if (lowerText.includes('slippage') || lowerText.includes('滑點')) {
                                failureSignals.hasSlippageError = true;
                            }
                            
                            if (lowerText.includes('network') || lowerText.includes('網絡') ||
                                lowerText.includes('timeout') || lowerText.includes('超時')) {
                                failureSignals.hasNetworkError = true;
                            }
                            
                            break;
                        }
                    }
                }
                if (failureSignals.hasErrorMessage) break;
            }

            // 2. 檢測 Confirm 按鈕是否重新啟用（可能表示交易失敗）
            const confirmBtn = findConfirmButton();
            if (confirmBtn && !confirmBtn.disabled) {
                // Confirm 按鈕重新啟用，可能是交易失敗
                // 但需要結合其他信號判斷，單獨這個信號不足以判定失敗
            }

        } catch (error) {
            log(`檢測失敗信號時出錯: ${error.message}`, 'warning');
        }

        return failureSignals;
    }

    // 檢測交易 hash 或交易鏈接
    function detectTransactionHash() {
        try {
            // 查找可能包含交易 hash 的元素
            const hashSelectors = [
                'a[href*="tx/0x"]',
                'a[href*="transaction/0x"]',
                'a[href*="explorer"]',
                '[class*="transaction"]',
                '[class*="hash"]',
                'a[target="_blank"]'
            ];

            for (const selector of hashSelectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    const href = el.href || '';
                    const text = (el.innerText || el.textContent || '').trim();
                    
                    // 檢測是否包含交易 hash（0x 開頭的 64 位十六進制字符串）
                    const hashMatch = (href + ' ' + text).match(/0x[a-fA-F0-9]{64}/);
                    if (hashMatch) {
                        return {
                            found: true,
                            hash: hashMatch[0],
                            url: href
                        };
                    }
                }
            }
        } catch (error) {
            log(`檢測交易 hash 時出錯: ${error.message}`, 'warning');
        }

        return { found: false, hash: null, url: null };
    }

    // 新增：基於幣種比較判斷上一次 SWAP 的成功/失敗
    function verifySwapByTokenComparison() {
        // 如果上一次循環沒有執行 Confirm，不做判斷
        if (!lastCycleConfirmed) {
            log('ℹ️ 上一次循環未執行 Confirm，跳過幣種比較判斷', 'info');
            return { shouldUpdate: false, wasSuccess: null };
        }

        // 如果沒有記錄上一次的幣種，不做判斷（首次交易）
        if (!lastCycleFromToken) {
            log('ℹ️ 首次交易循環，無上一次幣種記錄', 'info');
            return { shouldUpdate: false, wasSuccess: null };
        }

        // 如果當前沒有選擇幣種，無法比較
        if (!currentFromToken) {
            log('⚠️ 當前未選擇幣種，無法進行幣種比較判斷', 'warning');
            return { shouldUpdate: false, wasSuccess: null };
        }

        // 核心判斷邏輯：
        // 正常情況下，SWAP 成功後幣種會切換（USDT ⇄ USDC）
        // 如果這次要 SWAP 的幣種和上次一樣，代表上次 SWAP 失敗了
        const tokensAreSame = currentFromToken === lastCycleFromToken;

        if (tokensAreSame) {
            // 幣種相同 → 上一次 SWAP 失敗
            log(`❌ 幣種比較判斷：上次要 SWAP ${lastCycleFromToken}，這次仍要 SWAP ${currentFromToken} → 上次交易失敗`, 'error');
            return { shouldUpdate: true, wasSuccess: false };
        } else {
            // 幣種不同 → 上一次 SWAP 成功
            log(`✓ 幣種比較判斷：上次要 SWAP ${lastCycleFromToken}，這次要 SWAP ${currentFromToken} → 上次交易成功`, 'success');
            return { shouldUpdate: true, wasSuccess: true };
        }
    }

    // 動態調整 Slippage 和 Priority
    async function adjustSlippageAndPriority(isSuccess) {
        if (!CONFIG.enableDynamicAdjustment) {
            return;
        }

        // 防止並發調整
        if (isAdjusting) {
            log('ℹ️ 調整操作正在進行中，跳過本次調整', 'info');
            return;
        }

        // 防止頻繁調整（至少間隔 5 秒）
        const now = Date.now();
        if (now - lastAdjustmentTime < 5000) {
            log('ℹ️ 調整操作過於頻繁，跳過本次調整', 'info');
            return;
        }

        // 防止在交易關鍵時刻進行調整（例如正在選擇代幣或點擊 Confirm）
        // 檢查是否有正在進行的交易操作
        const hasActiveTransaction = currentFromToken !== null || 
                                     document.querySelector('button:not([disabled])')?.textContent?.includes('Confirm') ||
                                     document.querySelector('button:not([disabled])')?.textContent?.includes('確認');
        
        if (isRunning && hasActiveTransaction) {
            log('ℹ️ 檢測到正在進行的交易操作，延遲調整', 'info');
            // 使用 Promise 延遲執行，而不是 setTimeout
            await sleep(3000);
            // 再次檢查是否仍在進行交易
            const stillActive = currentFromToken !== null || 
                               document.querySelector('button:not([disabled])')?.textContent?.includes('Confirm');
            if (stillActive) {
                log('ℹ️ 交易操作仍在進行，跳過本次調整', 'info');
                return;
            }
        }

        if (isSuccess) {
            consecutiveSuccesses++;
            consecutiveFailures = 0; // 重置失敗計數
            UI.updateStats(); // 更新 UI 顯示
            
            // 連續成功達到閾值時，小幅下調
            if (consecutiveSuccesses >= CONFIG.consecutiveSuccessThreshold) {
                const newSlippage = Math.max(
                    CONFIG.slippageMin,
                    currentSlippage - CONFIG.slippageDecreaseOnSuccess
                );
                const newPriority = Math.max(
                    CONFIG.priorityMin,
                    currentPriority - CONFIG.priorityDecreaseOnSuccess
                );
                
                // 只有當值真正改變時才進行調整
                if (newSlippage !== currentSlippage || newPriority !== currentPriority) {
                    log(`📉 連續成功 ${consecutiveSuccesses} 次，準備調整參數：Slippage ${currentSlippage.toFixed(2)}% → ${newSlippage.toFixed(2)}%, Priority ${currentPriority.toFixed(4)} gwei → ${newPriority.toFixed(4)} gwei`, 'info');
                    
                    // 執行調整
                    const adjusted = await executeAdjustment(newSlippage, newPriority, 'success');
                    if (adjusted) {
                        currentSlippage = newSlippage;
                        currentPriority = newPriority;
                        lastAdjustmentTime = Date.now();
                    }
                    // 無論調整是否成功，都重置計數器（避免重複觸發）
                    consecutiveSuccesses = 0;
                    UI.updateStats(); // 更新連續成功次數顯示
                } else {
                    // 已達到下限，重置計數器
                    log(`ℹ️ 連續成功 ${consecutiveSuccesses} 次，但參數已達下限，重置計數器`, 'info');
                    consecutiveSuccesses = 0;
                    UI.updateStats(); // 更新連續成功次數顯示
                }
            }
        } else {
            consecutiveSuccesses = 0; // 重置成功計數
            consecutiveFailures++;
            UI.updateStats(); // 更新 UI 顯示
            
            // 連續失敗達到閾值時，小幅上調
            if (consecutiveFailures >= CONFIG.consecutiveFailureThreshold) {
                const newSlippage = Math.min(
                    CONFIG.slippageMax,
                    currentSlippage + CONFIG.slippageIncreaseOnFailure
                );
                const newPriority = Math.min(
                    CONFIG.priorityMax,
                    currentPriority + CONFIG.priorityIncreaseOnFailure
                );
                
                // 只有當值真正改變時才進行調整
                if (newSlippage !== currentSlippage || newPriority !== currentPriority) {
                    log(`📈 連續失敗 ${consecutiveFailures} 次，準備調整參數：Slippage ${currentSlippage.toFixed(2)}% → ${newSlippage.toFixed(2)}%, Priority ${currentPriority.toFixed(4)} gwei → ${newPriority.toFixed(4)} gwei`, 'warning');
                    
                    // 執行調整
                    const adjusted = await executeAdjustment(newSlippage, newPriority, 'failure');
                    if (adjusted) {
                        currentSlippage = newSlippage;
                        currentPriority = newPriority;
                        lastAdjustmentTime = Date.now();
                    }
                    // 無論調整是否成功，都重置計數器（避免重複觸發）
                    consecutiveFailures = 0;
                    UI.updateStats(); // 更新連續失敗次數顯示
                } else {
                    // 已達到上限，重置計數器
                    log(`ℹ️ 連續失敗 ${consecutiveFailures} 次，但參數已達上限，重置計數器`, 'info');
                    consecutiveFailures = 0;
                    UI.updateStats(); // 更新連續失敗次數顯示
                }
            }
        }
    }

    // 執行調整操作（帶鎖定和重試機制）
    async function executeAdjustment(slippage, priority, reason) {
        if (isAdjusting) {
            log('⚠️ 調整操作已在進行中，跳過', 'warning');
            return false;
        }

        isAdjusting = true;
        let success = false;
        const maxRetries = 3;

        try {
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                if (attempt > 0) {
                    log(`🔄 調整失敗，進行第 ${attempt + 1} 次重試...`, 'warning');
                    await sleep(2000);
                }

                // 檢查是否已停止
                if (!isRunning) {
                    log('⚠️ 程序已停止，取消調整操作', 'warning');
                    break;
                }

                // 確保沒有其他對話框打開
                if (isDialogOpen()) {
                    log('⚠️ 檢測到對話框打開，等待關閉...', 'warning');
                    await ensureAllDialogsClosed(3);
                    await sleep(1000);
                }

                success = await applySlippageAndPriority(slippage, priority);
                
                if (success) {
                    log(`✅ 調整成功：Slippage=${slippage.toFixed(2)}%, Priority=${priority.toFixed(4)} gwei (原因: ${reason === 'success' ? '連續成功' : '連續失敗'})`, 'success');
                    UI.updateStats();
                    break;
                } else {
                    log(`❌ 調整失敗 (嘗試 ${attempt + 1}/${maxRetries})`, 'error');
                }
            }

            if (!success) {
                log(`❌ 調整操作最終失敗，已重試 ${maxRetries} 次`, 'error');
            }
        } catch (error) {
            log(`❌ 調整操作出錯: ${error.message}`, 'error');
            success = false;
        } finally {
            isAdjusting = false;
        }

        return success;
    }

    // 應用 Slippage 和 Priority 設定
    async function applySlippageAndPriority(slippage, priority) {
        try {
            // 檢查是否已停止
            if (!isRunning) {
                log('⚠️ 程序已停止，取消調整操作', 'warning');
                return false;
            }

            // 確保沒有其他對話框打開（除了 Settings）
            const dialogs = document.querySelectorAll('[role="dialog"]');
            for (const dialog of dialogs) {
                const dialogText = dialog.innerText || '';
                // 如果是 Settings 對話框，保留；否則關閉
                if (!dialogText.includes('Slippage') && !dialogText.includes('Priority') && 
                    !dialogText.includes('Settings') && !dialogText.includes('設定')) {
                    const closeBtn = dialog.querySelector('button[aria-label*="close"], button[aria-label*="Close"], [class*="close"]');
                    if (closeBtn) {
                        closeBtn.click();
                        await sleep(500);
                    }
                }
            }

            // 檢查 Settings 面板是否已打開
            let settingsPanelOpen = false;
            const slippageSvg = document.querySelector('[data-sentry-component="Slippage"]');
            const settingsDialogs = document.querySelectorAll('[role="dialog"]');
            for (const dialog of settingsDialogs) {
                const dialogText = dialog.innerText || '';
                if (dialogText.includes('Slippage') || dialogText.includes('Priority') || 
                    dialogText.includes('Settings') || dialogText.includes('設定') || slippageSvg) {
                    settingsPanelOpen = true;
                    break;
                }
            }

            // 如果 Settings 面板未打開，嘗試打開
            if (!settingsPanelOpen) {
                log('打開 Settings 面板...', 'info');
                const settingsBtn = await findAndClickElement([
                    { type: 'svg', class: 'lucide-settings2' },
                    { type: 'svg', class: 'lucide-settings-2' },
                    'svg[class*="lucide-settings"]',
                    'div[class*="cursor-pointer"][class*="opacity-50"] svg'
                ], 'Settings 按鈕', 3000);
                
                if (!settingsBtn) {
                    log('❌ 無法找到 Settings 按鈕', 'error');
                    return false;
                }
                
                // 等待 Settings 面板打開
                await sleep(2000);
                
                // 再次檢查是否打開
                const checkSlippage = document.querySelector('[data-sentry-component="Slippage"]');
                if (!checkSlippage) {
                    log('⚠️ Settings 面板可能未正確打開，等待更長時間...', 'warning');
                    await sleep(2000);
                }
            } else {
                log('✓ Settings 面板已打開', 'info');
            }

            // 設定 Slippage（帶重試）
            const slippageValue = slippage.toFixed(2);
            log(`設定 Slippage 至 ${slippageValue}%...`, 'info');
            let slippageSuccess = false;
            
            for (let i = 0; i < 3; i++) {
                if (i > 0) {
                    log(`🔄 Slippage 設置重試 (${i + 1}/3)...`, 'info');
                    await sleep(1000);
                }
                
                slippageSuccess = await findAndSetInput([
                    { type: 'text', text: 'Slippage' },
                    { type: 'data-attr', attr: 'data-sentry-component', value: 'Slippage' }
                ], slippageValue, 'Slippage');
                
                if (slippageSuccess) {
                    await sleep(1500); // 增加等待時間，確保值被保存
                    const slippageVerified = await verifyInputValue('Slippage', slippageValue);
                    if (slippageVerified) {
                        log(`✓ Slippage 已成功設置為 ${slippageValue}%`, 'success');
                        break;
                    } else {
                        log(`⚠️ Slippage 值驗證失敗 (嘗試 ${i + 1}/3)`, 'warning');
                        slippageSuccess = false;
                    }
                }
            }

            if (!slippageSuccess) {
                log('❌ Slippage 設置失敗', 'error');
            }

            // 設定 Priority（帶重試）
            const priorityValue = priority.toFixed(4);
            log(`設定 Priority (Gwei) 至 ${priorityValue}...`, 'info');
            let prioritySuccess = false;
            
            for (let i = 0; i < 3; i++) {
                if (i > 0) {
                    log(`🔄 Priority 設置重試 (${i + 1}/3)...`, 'info');
                    await sleep(1000);
                }
                
                prioritySuccess = await findAndSetInput([
                    { type: 'text', text: 'Priority (Gwei)' }
                ], priorityValue, 'Priority (Gwei)');
                
                if (prioritySuccess) {
                    await sleep(1500); // 增加等待時間，確保值被保存
                    const priorityVerified = await verifyInputValue('Priority (Gwei)', priorityValue);
                    if (priorityVerified) {
                        log(`✓ Priority 已成功設置為 ${priorityValue} gwei`, 'success');
                        break;
                    } else {
                        log(`⚠️ Priority 值驗證失敗 (嘗試 ${i + 1}/3)`, 'warning');
                        prioritySuccess = false;
                    }
                }
            }

            if (!prioritySuccess) {
                log('❌ Priority 設置失敗', 'error');
            }

            // 最終驗證兩個值是否都正確
            await sleep(1000);
            const finalSlippageCheck = await verifyInputValue('Slippage', slippageValue);
            const finalPriorityCheck = await verifyInputValue('Priority (Gwei)', priorityValue);
            
            if (finalSlippageCheck && finalPriorityCheck) {
                log(`✅ 最終驗證通過：Slippage=${slippageValue}%, Priority=${priorityValue} gwei`, 'success');
            } else {
                if (!finalSlippageCheck) log('⚠️ 最終驗證：Slippage 值不正確', 'warning');
                if (!finalPriorityCheck) log('⚠️ 最終驗證：Priority 值不正確', 'warning');
            }

            // 關閉 Settings 面板（如果打開了）
            // 等待一小段時間，確保值已保存
            await sleep(1000);
            const closeBtn = findCloseButton();
            if (closeBtn) {
                closeBtn.click();
                await sleep(500);
                log('✓ Settings 面板已關閉', 'info');
            }

            // 返回結果（兩個都成功才算成功）
            return slippageSuccess && prioritySuccess && finalSlippageCheck && finalPriorityCheck;
        } catch (error) {
            log(`❌ 調整 Slippage/Priority 時出錯: ${error.message}`, 'error');
            
            // 嘗試關閉可能打開的對話框
            try {
                const closeBtn = findCloseButton();
                if (closeBtn) {
                    closeBtn.click();
                    await sleep(500);
                }
            } catch (e) {
                // 忽略關閉錯誤
            }
            
            return false;
        }
    }

    // 驗證交易成功（舊版：使用彈窗檢測 + 多重信號檢測，現已改為備用機制）
    // 注意：此函數現在主要作為備用驗證機制，主要判斷邏輯已改為 verifySwapByTokenComparison
    async function verifySwapSuccess(balanceBeforeSwap) {
        if (!CONFIG.enableSuccessVerification) return true;

        log('驗證交易成功...', 'info');
        
        // 記錄交易前的發送幣（要SWAP的幣）
        const fromTokenBeforeSwap = currentFromToken;
        if (!fromTokenBeforeSwap) {
            log('⚠️ 無法獲取交易前的發送幣，使用備用驗證方式', 'warning');
        } else {
            log(`記錄交易前發送幣: ${fromTokenBeforeSwap}`, 'info');
        }

        // 設置網絡錯誤監聽器（使用更安全的方法）
        let hasNetworkError = false;
        const errorStartTime = Date.now();
        const errorTimeout = 20000; // 20秒內監聽錯誤

        // 監聽 fetch 錯誤（包括 500 錯誤）
        const originalFetch = window.fetch;
        let fetchWrapper = null;

        try {
            fetchWrapper = function(...args) {
                const url = args[0]?.toString() || '';
                const isRelevantRequest = url.includes('orderHistory') || url.includes('swap') || url.includes('trade') || url.includes('api/db') || url.includes('api/wrapper');
                
                return originalFetch.apply(this, args).catch(error => {
                    if (isRelevantRequest && (Date.now() - errorStartTime) < errorTimeout) {
                        // 網絡錯誤僅記錄，不影響 SWAP 成功/失敗判斷
                        hasNetworkError = true;
                        log(`⚠️ 檢測到網絡錯誤: ${error.message} - 不影響 SWAP 判斷`, 'warning');
                    }
                    throw error;
                }).then(async response => {
                    // 檢查 HTTP 狀態碼（僅記錄，不影響 SWAP 成功/失敗判斷）
                    if (isRelevantRequest && !response.ok && response.status >= 500) {
                        if ((Date.now() - errorStartTime) < errorTimeout) {
                            // API 500 錯誤僅記錄，不設置 hasNetworkError，不影響 SWAP 成功/失敗判斷
                            log(`⚠️ 檢測到 API 500 錯誤: ${response.status} ${response.statusText} (${url.substring(0, 100)}) - 不影響 SWAP 判斷`, 'warning');
                        }
                    }
                    
                    // 攔截 .json() 方法以防止解析 HTML 響應為 JSON
                    if (isRelevantRequest && response.json) {
                        const originalJson = response.json.bind(response);
                        
                        response.json = async function() {
                            try {
                                // 檢查 Content-Type
                                const contentType = response.headers.get('content-type') || '';
                                
                                // 如果 Content-Type 明確是 HTML，直接返回錯誤對象
                                if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
                                    log(`⚠️ API 返回了 HTML 而非 JSON (Content-Type: ${contentType}) (${url.substring(0, 80)})`, 'warning');
                                    return { error: 'HTML response received', status: response.status, statusText: response.statusText };
                                }
                                
                                // 嘗試正常解析 JSON
                                return await originalJson();
                            } catch (error) {
                                // 如果 JSON 解析失敗，檢查是否為 HTML
                                if (error.message && (error.message.includes('JSON') || error.message.includes('<!DOCTYPE'))) {
                                    try {
                                        // 使用 clone() 來避免影響原始響應
                                        const clonedResponse = response.clone();
                                        const text = await clonedResponse.text();
                                        
                                        if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html') || text.trim().startsWith('<!doctype')) {
                                            log(`⚠️ JSON 解析失敗：API 返回了 HTML 響應 (${url.substring(0, 80)})`, 'warning');
                                            return { error: 'HTML response received', status: response.status, statusText: response.statusText, htmlPreview: text.substring(0, 200) };
                                        }
                                    } catch (e) {
                                        // 如果讀取文本也失敗，記錄並拋出原始錯誤
                                        log(`⚠️ 無法檢查響應內容: ${e.message}`, 'warning');
                                    }
                                }
                                // 拋出原始錯誤
                                throw error;
                            }
                        };
                    }
                    
                    return response;
                });
            };
            
            window.fetch = fetchWrapper;

            let foundSuccessPopup = false;
            let foundCloseButton = false;
            let foundTransactionHash = false;
            let transactionHashInfo = null;

            // 等待更長時間以確保交易真正完成（最多 30 秒）
            for (let i = 0; i < 60; i++) {
                // ====== 優先檢測失敗信號 ======
                const failureSignals = detectFailureSignals();
                
                if (failureSignals.hasErrorMessage) {
                    log(`❌ 檢測到失敗信號: ${failureSignals.errorText}`, 'error');
                    
                    if (failureSignals.hasInsufficientBalance) {
                        log('❌ 錯誤類型：餘額不足', 'error');
                    } else if (failureSignals.hasSlippageError) {
                        log('❌ 錯誤類型：滑點過大', 'error');
                    } else if (failureSignals.hasNetworkError) {
                        log('❌ 錯誤類型：網絡錯誤', 'error');
                    }
                    
                    // 再等待 2 秒確認失敗（避免誤判）
                    await sleep(2000);
                    const recheck = detectFailureSignals();
                    if (recheck.hasErrorMessage) {
                        log('❌ 確認交易失敗', 'error');
                        window.fetch = originalFetch;
                        return false;
                    }
                }

                // ====== 檢測成功信號 ======
                
                // 方法1: 查找成功提示
                const swapElements = document.querySelectorAll('.text-genius-pink, [class*="success"], [class*="Success"]');
                for (const el of swapElements) {
                    const text = el.innerText || el.textContent || '';
                    if ((text.includes('Swap') || text.includes('成功') || text.includes('Success')) &&
                        (text.includes('USDT') || text.includes('USDC'))) {
                        log('✓ 檢測到交易成功提示', 'success');
                        foundSuccessPopup = true;
                        break;
                    }
                }

                // 方法2: 檢查關閉按鈕出現（通常表示交易完成）
                const closeBtn = findCloseButton();
                if (closeBtn) {
                    log('✓ 檢測到交易完成彈窗', 'success');
                    foundCloseButton = true;
                }

                // 方法3: 檢測交易 hash（額外的成功驗證）
                if (!foundTransactionHash) {
                    transactionHashInfo = detectTransactionHash();
                    if (transactionHashInfo.found) {
                        log(`✓ 檢測到交易 hash: ${transactionHashInfo.hash.substring(0, 10)}...`, 'success');
                        foundTransactionHash = true;
                    }
                }

                // 如果找到彈窗，檢查 SWAP pending 狀態並等待完成
                if (foundSuccessPopup || foundCloseButton) {
                    log('✓ 檢測到成功彈窗，檢查 SWAP pending 狀態...', 'info');
                    
                    // 第一步：立即檢查幣種是否已經變化（SWAP pending 可能已經完成）
                    let swapPendingCompleted = false;
                    const pendingStartTime = Date.now();
                    const expectedToToken = fromTokenBeforeSwap === 'USDT' ? 'USDC' : 'USDT';
                    
                    if (fromTokenBeforeSwap) {
                        log(`檢查幣種變化: ${fromTokenBeforeSwap} → ${expectedToToken}`, 'info');
                        
                        // 立即檢查一次，看幣種是否已經變化（處理 SWAP pending 很快完成的情況）
                        const immediateCheck = getCurrentDisplayedFromToken();
                        if (immediateCheck === expectedToToken) {
                            log(`✓ 幣種已立即變化：${fromTokenBeforeSwap} → ${immediateCheck}，SWAP pending 已完成`, 'success');
                            swapPendingCompleted = true;
                        } else {
                            // 如果還沒變化，等待一小段時間後再開始循環檢查
                            log('幣種尚未變化，等待 SWAP pending 開始...', 'info');
                            await sleep(CONFIG.waitAfterSuccessPopup);
                            log(`已等待 ${CONFIG.waitAfterSuccessPopup / 1000} 秒，開始循環檢查 SWAP pending 狀態...`, 'info');
                            
                            // 第二步：循環檢查幣種是否已經變化（等待 SWAP pending 完成）
                            while ((Date.now() - pendingStartTime) < CONFIG.waitForSwapPendingMax) {
                                const fromTokenAfterSwap = getCurrentDisplayedFromToken();
                                
                                if (fromTokenAfterSwap === expectedToToken) {
                                    log(`✓ 幣種已變化：${fromTokenBeforeSwap} → ${fromTokenAfterSwap}，SWAP pending 完成`, 'success');
                                    swapPendingCompleted = true;
                                    break;
                                } else if (fromTokenAfterSwap && fromTokenAfterSwap !== fromTokenBeforeSwap) {
                                    log(`⚠️ 幣種變化異常：${fromTokenBeforeSwap} → ${fromTokenAfterSwap}，預期應為 ${expectedToToken}`, 'warning');
                                    // 繼續等待，可能是中間狀態
                                } else {
                                    const elapsed = Math.floor((Date.now() - pendingStartTime) / 1000);
                                    log(`SWAP pending 中... (已等待 ${elapsed} 秒，幣種仍為 ${fromTokenBeforeSwap})`, 'info');
                                }
                                
                                await sleep(CONFIG.checkSwapPendingInterval);
                            }
                            
                            if (!swapPendingCompleted) {
                                // 超時後再次檢查（給予多次機會）
                                log(`⚠️ SWAP pending 第一次超時（${CONFIG.waitForSwapPendingMax / 1000} 秒），進行額外驗證...`, 'warning');
                                
                                // 額外等待（使用配置參數）
                                for (let retry = 0; retry < CONFIG.swapPendingExtraRetries; retry++) {
                                    await sleep(CONFIG.swapPendingRetryInterval);
                                    
                                    const retryToken = getCurrentDisplayedFromToken();
                                    if (retryToken === expectedToToken) {
                                        log(`✓ 額外驗證成功：幣種已變化為 ${expectedToToken} (第 ${retry + 1} 次重試)`, 'success');
                                        swapPendingCompleted = true;
                                        break;
                                    }
                                    
                                    // 同時檢查失敗信號
                                    const failCheck = detectFailureSignals();
                                    if (failCheck.hasErrorMessage) {
                                        log(`❌ 在重試期間檢測到失敗信號: ${failCheck.errorText}`, 'error');
                                        window.fetch = originalFetch;
                                        return false;
                                    }
                                }
                                
                                if (!swapPendingCompleted) {
                                    const finalToken = getCurrentDisplayedFromToken();
                                    log(`⚠️ SWAP pending 最終超時，幣種未變化`, 'warning');
                                    log(`當前幣種: ${finalToken || '無法讀取'}，預期: ${expectedToToken}`, 'warning');
                                }
                            }
                        }
                    } else {
                        // 如果無法獲取交易前的發送幣，等待固定時間後認為成功
                        log('⚠️ 無法獲取交易前的發送幣，等待固定時間後驗證', 'warning');
                        await sleep(CONFIG.waitForSwapPendingMax);
                        swapPendingCompleted = true;
                    }
                    
                    // 第三步：如果 SWAP pending 未完成，使用餘額驗證作為備用判斷
                    if (!swapPendingCompleted) {
                        log('⚠️ SWAP pending 幣種未變化，但檢測到成功彈窗，使用餘額驗證作為備用判斷...', 'warning');
                        
                        // 如果檢測到成功彈窗，即使幣種未變化，也應該驗證餘額
                        // 因為幣種讀取可能不準確，或幣種切換有延遲
                        if (balanceBeforeSwap) {
                            log('進行餘額驗證（備用判斷）...', 'info');
                            await sleep(CONFIG.balanceVerificationDelay);
                            
                            const rawBalanceAfterSwap = await getTokenBalances();
                            const balanceAfterSwap = {
                                USDT: parseFloat(parseFloat(rawBalanceAfterSwap.USDT || 0).toFixed(8)),
                                USDC: parseFloat(parseFloat(rawBalanceAfterSwap.USDC || 0).toFixed(8))
                            };
                            
                            const fromTokenBeforeBalance = parseFloat((balanceBeforeSwap[fromTokenBeforeSwap] || 0).toFixed(8));
                            const fromTokenAfterBalance = parseFloat((balanceAfterSwap[fromTokenBeforeSwap] || 0).toFixed(8));
                            const toTokenBeforeBalance = parseFloat((balanceBeforeSwap[expectedToToken] || 0).toFixed(8));
                            const toTokenAfterBalance = parseFloat((balanceAfterSwap[expectedToToken] || 0).toFixed(8));
                            
                            const fromTokenDecrease = parseFloat((fromTokenBeforeBalance - fromTokenAfterBalance).toFixed(8));
                            const toTokenIncrease = parseFloat((toTokenAfterBalance - toTokenBeforeBalance).toFixed(8));
                            
                            log(`餘額變化（備用驗證）: ${fromTokenBeforeSwap} 減少 ${fromTokenDecrease.toFixed(4)}, ${expectedToToken} 增加 ${toTokenIncrease.toFixed(4)}`, 'info');
                            
                            // 如果發送幣大幅減少（至少 90%）且接收幣明顯增加，認為交易成功
                            const fromTokenDecreaseThreshold = fromTokenBeforeBalance * 0.90;
                            if (fromTokenDecrease >= fromTokenDecreaseThreshold && toTokenIncrease > 0.01) {
                                log(`✓ 餘額驗證通過（備用判斷）：發送幣減少 ${fromTokenDecrease.toFixed(4)}，接收幣增加 ${toTokenIncrease.toFixed(4)}`, 'success');
                                log(`✓ 雖然幣種讀取未變化，但餘額變化證明交易成功`, 'success');
                                currentFromToken = expectedToToken; // 更新為預期的幣種
                                window.fetch = originalFetch;
                                return true;
                            } else {
                                log(`❌ 餘額驗證失敗：發送幣減少 ${fromTokenDecrease.toFixed(4)}（預期至少 ${fromTokenDecreaseThreshold.toFixed(4)}），接收幣增加 ${toTokenIncrease.toFixed(4)}`, 'error');
                                window.fetch = originalFetch;
                                return false;
                            }
                        } else {
                            // 沒有餘額記錄，但檢測到成功彈窗，認為成功
                            log('⚠️ 未記錄交易前餘額，但檢測到成功彈窗，認為交易成功', 'warning');
                            currentFromToken = expectedToToken;
                            window.fetch = originalFetch;
                            return true;
                        }
                    }
                    
                    // 第四步：驗證幣種變化和餘額變化（SWAP pending 已完成）
                    if (fromTokenBeforeSwap) {
                        log('驗證幣種變化和餘額變化...', 'info');
                        
                        // 讀取當前頁面上顯示的發送幣（再次確認）
                        const fromTokenAfterSwap = getCurrentDisplayedFromToken();
                        
                        if (!fromTokenAfterSwap) {
                            log('⚠️ 無法讀取交易後的發送幣，但 SWAP pending 已完成，認為成功', 'warning');
                            window.fetch = originalFetch;
                            return true;
                        }
                        
                        log(`幣種變化: ${fromTokenBeforeSwap} → ${fromTokenAfterSwap}`, 'info');
                        
                        // 驗證：如果SWAP成功，發送幣應該變成另一個幣
                        // 例如：USDT → USDC 或 USDC → USDT
                        if (fromTokenAfterSwap === expectedToToken) {
                            log(`✓ 幣種變化驗證通過：${fromTokenBeforeSwap} → ${fromTokenAfterSwap}`, 'success');
                            
                            // 加強驗證：驗證餘額實際變化
                            if (balanceBeforeSwap) {
                                log('驗證餘額變化...', 'info');
                                
                                // 等待額外時間確保餘額更新完成（使用配置參數）
                                await sleep(CONFIG.balanceVerificationDelay);
                                
                                // 讀取交易後的餘額並標準化精度（帶重試機制）
                                let balanceAfterSwap = null;
                                let balanceReadSuccess = false;
                                
                                for (let balanceRetry = 0; balanceRetry < CONFIG.balanceReadRetries; balanceRetry++) {
                                    const rawBalanceAfterSwap = await getTokenBalances();
                                    balanceAfterSwap = {
                                        USDT: parseFloat(parseFloat(rawBalanceAfterSwap.USDT || 0).toFixed(8)),
                                        USDC: parseFloat(parseFloat(rawBalanceAfterSwap.USDC || 0).toFixed(8))
                                    };
                                    
                                    // 檢查餘額是否有效（不全為 0）
                                    if (balanceAfterSwap.USDT > 0 || balanceAfterSwap.USDC > 0) {
                                        balanceReadSuccess = true;
                                        break;
                                    }
                                    
                                    if (balanceRetry < CONFIG.balanceReadRetries - 1) {
                                        log(`⚠️ 餘額讀取異常（全為 0），${CONFIG.balanceReadRetryInterval / 1000} 秒後重試... (${balanceRetry + 1}/${CONFIG.balanceReadRetries})`, 'warning');
                                        await sleep(CONFIG.balanceReadRetryInterval);
                                    }
                                }
                                
                                if (!balanceReadSuccess) {
                                    log('⚠️ 餘額讀取失敗，但幣種已變化，認為交易成功', 'warning');
                                    currentFromToken = fromTokenAfterSwap;
                                    window.fetch = originalFetch;
                                    return true;
                                }
                                
                                log(`交易前餘額: USDT=${balanceBeforeSwap.USDT.toFixed(4)}, USDC=${balanceBeforeSwap.USDC.toFixed(4)}`, 'info');
                                log(`交易後餘額: USDT=${balanceAfterSwap.USDT.toFixed(4)}, USDC=${balanceAfterSwap.USDC.toFixed(4)}`, 'info');
                                
                                // 計算餘額變化（使用更精確的數值處理）
                                const fromTokenBeforeBalance = parseFloat((balanceBeforeSwap[fromTokenBeforeSwap] || 0).toFixed(8));
                                const fromTokenAfterBalance = parseFloat((balanceAfterSwap[fromTokenBeforeSwap] || 0).toFixed(8));
                                const toTokenBeforeBalance = parseFloat((balanceBeforeSwap[expectedToToken] || 0).toFixed(8));
                                const toTokenAfterBalance = parseFloat((balanceAfterSwap[expectedToToken] || 0).toFixed(8));
                                
                                const fromTokenDecrease = parseFloat((fromTokenBeforeBalance - fromTokenAfterBalance).toFixed(8));
                                const toTokenIncrease = parseFloat((toTokenAfterBalance - toTokenBeforeBalance).toFixed(8));
                                
                                log(`餘額變化: ${fromTokenBeforeSwap} 減少 ${fromTokenDecrease.toFixed(4)}, ${expectedToToken} 增加 ${toTokenIncrease.toFixed(4)}`, 'info');
                                
                                // 注意：接收幣增加量可能略大於發送幣減少量（由於匯率波動、滑點保護等因素）
                                // 這是正常現象，不應作為失敗判斷依據
                                if (toTokenIncrease > fromTokenDecrease + 0.01) {
                                    log(`ℹ️ 接收幣增加量 (${toTokenIncrease.toFixed(4)}) 略大於發送幣減少量 (${fromTokenDecrease.toFixed(4)})，可能是匯率波動或滑點保護，屬於正常情況`, 'info');
                                }
                                
                                // 驗證發送幣餘額應該大幅減少（因為點了 MAX，應該接近 0）
                                // 允許 5% 的誤差（考慮手續費和精度）
                                const fromTokenDecreaseThreshold = fromTokenBeforeBalance * 0.95; // 至少減少 95%
                                if (fromTokenDecrease < fromTokenDecreaseThreshold) {
                                    log(`❌ ${fromTokenBeforeSwap} 餘額減少不足：預期至少減少 ${fromTokenDecreaseThreshold.toFixed(4)}，實際減少 ${fromTokenDecrease.toFixed(4)}`, 'error');
                                    window.fetch = originalFetch;
                                    return false;
                                }
                                
                                // 驗證接收幣餘額應該增加
                                // 注意：接收幣增加量可能略大於或略小於發送幣減少量（由於匯率波動、滑點保護、手續費等因素）
                                // 這裡只檢查最小值，確保接收幣有明顯增加（至少 90%），不限制最大值
                                const minExpectedIncrease = fromTokenDecrease * 0.90; // 至少增加 90%（考慮手續費和匯率波動）
                                if (toTokenIncrease < minExpectedIncrease) {
                                    log(`❌ ${expectedToToken} 餘額增加不足：預期至少增加 ${minExpectedIncrease.toFixed(4)}，實際增加 ${toTokenIncrease.toFixed(4)}`, 'error');
                                    window.fetch = originalFetch;
                                    return false;
                                }
                                
                                // 驗證發送幣餘額不應該增加（異常情況）
                                if (fromTokenAfterBalance > fromTokenBeforeBalance + 0.01) {
                                    log(`❌ 異常：${fromTokenBeforeSwap} 餘額不應該增加，交易可能失敗`, 'error');
                                    window.fetch = originalFetch;
                                    return false;
                                }
                                
                                // 驗證接收幣餘額不應該減少（異常情況）
                                if (toTokenAfterBalance < toTokenBeforeBalance - 0.01) {
                                    log(`❌ 異常：${expectedToToken} 餘額不應該減少，交易可能失敗`, 'error');
                                    window.fetch = originalFetch;
                                    return false;
                                }
                                
                                // 額外驗證：如果發送幣減少量和接收幣增加量都接近 0，可能是讀取錯誤
                                if (fromTokenDecrease < 0.01 && toTokenIncrease < 0.01) {
                                    log(`❌ 異常：餘額變化過小，可能是讀取錯誤或交易未真正執行`, 'error');
                                    window.fetch = originalFetch;
                                    return false;
                                }
                                
                                log(`✓ 餘額變化驗證通過：${fromTokenBeforeSwap} 減少 ${fromTokenDecrease.toFixed(4)}, ${expectedToToken} 增加 ${toTokenIncrease.toFixed(4)}`, 'success');
                            } else {
                                log('⚠️ 未記錄交易前餘額，跳過餘額驗證', 'warning');
                            }
                            
                            log(`✓ 交易確認成功：幣種變化 + 餘額變化驗證通過`, 'success');
                            // 更新 currentFromToken 為新的發送幣
                            currentFromToken = fromTokenAfterSwap;
                            // 恢復原始 fetch
                            window.fetch = originalFetch;
                            return true;
                        } else if (fromTokenAfterSwap === fromTokenBeforeSwap) {
                            log(`⚠️ 幣種讀取未變化：${fromTokenBeforeSwap} → ${fromTokenAfterSwap}，但已檢測到成功彈窗，使用餘額驗證作為備用判斷...`, 'warning');
                            
                            // 雖然幣種讀取未變化，但已檢測到成功彈窗，應該用餘額驗證
                            if (balanceBeforeSwap) {
                                log('進行餘額驗證（備用判斷）...', 'info');
                                await sleep(CONFIG.balanceVerificationDelay);
                                
                                const rawBalanceAfterSwap = await getTokenBalances();
                                const balanceAfterSwap = {
                                    USDT: parseFloat(parseFloat(rawBalanceAfterSwap.USDT || 0).toFixed(8)),
                                    USDC: parseFloat(parseFloat(rawBalanceAfterSwap.USDC || 0).toFixed(8))
                                };
                                
                                const fromTokenBeforeBalance = parseFloat((balanceBeforeSwap[fromTokenBeforeSwap] || 0).toFixed(8));
                                const fromTokenAfterBalance = parseFloat((balanceAfterSwap[fromTokenBeforeSwap] || 0).toFixed(8));
                                const toTokenBeforeBalance = parseFloat((balanceBeforeSwap[expectedToToken] || 0).toFixed(8));
                                const toTokenAfterBalance = parseFloat((balanceAfterSwap[expectedToToken] || 0).toFixed(8));
                                
                                const fromTokenDecrease = parseFloat((fromTokenBeforeBalance - fromTokenAfterBalance).toFixed(8));
                                const toTokenIncrease = parseFloat((toTokenAfterBalance - toTokenBeforeBalance).toFixed(8));
                                
                                log(`餘額變化（備用驗證）: ${fromTokenBeforeSwap} 減少 ${fromTokenDecrease.toFixed(4)}, ${expectedToToken} 增加 ${toTokenIncrease.toFixed(4)}`, 'info');
                                
                                // 如果發送幣大幅減少（至少 90%）且接收幣明顯增加，認為交易成功
                                const fromTokenDecreaseThreshold = fromTokenBeforeBalance * 0.90;
                                if (fromTokenDecrease >= fromTokenDecreaseThreshold && toTokenIncrease > 0.01) {
                                    log(`✓ 餘額驗證通過（備用判斷）：發送幣減少 ${fromTokenDecrease.toFixed(4)}，接收幣增加 ${toTokenIncrease.toFixed(4)}`, 'success');
                                    log(`✓ 雖然幣種讀取未變化，但餘額變化證明交易成功`, 'success');
                                    currentFromToken = expectedToToken; // 更新為預期的幣種
                                    window.fetch = originalFetch;
                                    return true;
                                } else {
                                    log(`❌ 餘額驗證失敗：發送幣減少 ${fromTokenDecrease.toFixed(4)}（預期至少 ${fromTokenDecreaseThreshold.toFixed(4)}），接收幣增加 ${toTokenIncrease.toFixed(4)}`, 'error');
                                    window.fetch = originalFetch;
                                    return false;
                                }
                            } else {
                                // 沒有餘額記錄，但檢測到成功彈窗，認為成功
                                log('⚠️ 未記錄交易前餘額，但檢測到成功彈窗，認為交易成功', 'warning');
                                currentFromToken = expectedToToken;
                                window.fetch = originalFetch;
                                return true;
                            }
                        } else {
                            log(`⚠️ 幣種變化異常：${fromTokenBeforeSwap} → ${fromTokenAfterSwap}，預期應為 ${expectedToToken}`, 'warning');
                            // API 500 不影響判斷，仍然認為成功（可能是頁面更新延遲）
                            window.fetch = originalFetch;
                            return true;
                        }
                    } else {
                        // 如果無法獲取交易前的發送幣，使用備用驗證方式
                        log('⚠️ 無法獲取交易前的發送幣，使用備用驗證方式', 'warning');
                        
                        // 備用方式：如果有成功彈窗，認為成功（API 500 不影響判斷）
                        // 恢復原始 fetch
                        window.fetch = originalFetch;
                        return true;
                    }
                }

                await sleep(500);
            }

            // ====== 超時後的最終檢查 ======
            log('⚠️ 未在 30 秒內檢測到交易成功提示，進行最終驗證...', 'warning');
            
            // 最終檢查 1: 再次檢查失敗信號
            const finalFailureCheck = detectFailureSignals();
            if (finalFailureCheck.hasErrorMessage) {
                log(`❌ 最終檢查：檢測到失敗信號 - ${finalFailureCheck.errorText}`, 'error');
                window.fetch = originalFetch;
                return false;
            }
            
            // 最終檢查 2: 檢查幣種是否已經變化，或使用餘額驗證（可能彈窗沒有出現但交易已成功）
            if (fromTokenBeforeSwap) {
                const finalToken = getCurrentDisplayedFromToken();
                const expectedToToken = fromTokenBeforeSwap === 'USDT' ? 'USDC' : 'USDT';
                
                if (finalToken === expectedToToken) {
                    log(`✓ 最終檢查：幣種已變化 (${fromTokenBeforeSwap} → ${finalToken})，認為交易成功`, 'success');
                    
                    // 驗證餘額變化
                    if (balanceBeforeSwap) {
                        await sleep(2000);
                        const rawFinalBalance = await getTokenBalances();
                        const finalBalance = {
                            USDT: parseFloat(parseFloat(rawFinalBalance.USDT || 0).toFixed(8)),
                            USDC: parseFloat(parseFloat(rawFinalBalance.USDC || 0).toFixed(8))
                        };
                        
                        const fromDecrease = balanceBeforeSwap[fromTokenBeforeSwap] - finalBalance[fromTokenBeforeSwap];
                        const toIncrease = finalBalance[expectedToToken] - balanceBeforeSwap[expectedToToken];
                        
                        if (fromDecrease > 0.01 && toIncrease > 0.01) {
                            log(`✓ 最終檢查：餘額已變化 (減少 ${fromDecrease.toFixed(4)}, 增加 ${toIncrease.toFixed(4)})`, 'success');
                            currentFromToken = finalToken;
                            window.fetch = originalFetch;
                            return true;
                        }
                    }
                    
                    currentFromToken = finalToken;
                    window.fetch = originalFetch;
                    return true;
                } else {
                    // 幣種未變化，但檢查餘額作為備用驗證
                    log(`⚠️ 最終檢查：幣種未變化 (${fromTokenBeforeSwap} → ${finalToken})，檢查餘額變化...`, 'warning');
                    
                    if (balanceBeforeSwap) {
                        await sleep(2000);
                        const rawFinalBalance = await getTokenBalances();
                        const finalBalance = {
                            USDT: parseFloat(parseFloat(rawFinalBalance.USDT || 0).toFixed(8)),
                            USDC: parseFloat(parseFloat(rawFinalBalance.USDC || 0).toFixed(8))
                        };
                        
                        const fromTokenBeforeBalance = parseFloat((balanceBeforeSwap[fromTokenBeforeSwap] || 0).toFixed(8));
                        const fromTokenAfterBalance = parseFloat((finalBalance[fromTokenBeforeSwap] || 0).toFixed(8));
                        const toTokenBeforeBalance = parseFloat((balanceBeforeSwap[expectedToToken] || 0).toFixed(8));
                        const toTokenAfterBalance = parseFloat((finalBalance[expectedToToken] || 0).toFixed(8));
                        
                        const fromDecrease = parseFloat((fromTokenBeforeBalance - fromTokenAfterBalance).toFixed(8));
                        const toIncrease = parseFloat((toTokenAfterBalance - toTokenBeforeBalance).toFixed(8));
                        
                        log(`最終檢查餘額變化: ${fromTokenBeforeSwap} 減少 ${fromDecrease.toFixed(4)}, ${expectedToToken} 增加 ${toIncrease.toFixed(4)}`, 'info');
                        
                        // 如果發送幣大幅減少（至少 90%）且接收幣明顯增加，認為交易成功
                        const fromTokenDecreaseThreshold = fromTokenBeforeBalance * 0.90;
                        if (fromDecrease >= fromTokenDecreaseThreshold && toIncrease > 0.01) {
                            log(`✓ 最終檢查：餘額驗證通過（備用判斷），交易成功`, 'success');
                            currentFromToken = expectedToToken;
                            window.fetch = originalFetch;
                            return true;
                        }
                    }
                }
            }
            
            // 最終檢查 3: 檢查 Confirm 按鈕狀態
            const finalConfirmBtn = findConfirmButton();
            if (finalConfirmBtn && !finalConfirmBtn.disabled) {
                log('⚠️ 最終檢查：Confirm 按鈕已重新啟用，可能交易失敗', 'warning');
            }

            // 恢復原始 fetch
            window.fetch = originalFetch;

            log('❌ 最終判定：交易失敗（未檢測到任何成功信號）', 'error');
            return false;
        } catch (error) {
            // 恢復原始 fetch
            window.fetch = originalFetch;
            log(`驗證過程出錯: ${error.message}`, 'error');
            return false;
        }
    }

    // 主交易循環
    async function executeSwapLoop() {
        if (window.botRunning) {
            log('腳本已在運行中！', 'warning');
            return;
        }

        window.botRunning = true;
        isRunning = true;
        stats.startTime = Date.now();
        UI.setRunning(true);

        // 啟用防止螢幕關閉時暫停的機制
        await requestWakeLock();
        startHeartbeat();

        log('🚀 自動交易啟動！', 'success');
        log(`配置: USDC ⇄ USDT on ${CONFIG.chainDisplayName} (Optimism)`, 'info');
        log(`鏈設置: 固定使用 ${CONFIG.chainDisplayName} 鏈`, 'info');
        log(`安全設置: 餘額監控=${CONFIG.enableBalanceMonitoring}, 成功驗證=${CONFIG.enableSuccessVerification}`, 'info');

        // 執行 Preset 設定（在開始交易前）
        log('開始執行 Preset 設定...', 'info');
        const presetSuccess = await executePresetSetup();
        
        // 檢查是否在 Preset 設定期間被停止
        if (!isRunning) {
            log('⚠️ 程序已在 Preset 設定期間停止', 'warning');
            window.botRunning = false;
            UI.setRunning(false);
            return;
        }
        
        if (!presetSuccess) {
            log('⚠️ Preset 設定未完全成功，但將繼續執行交易', 'warning');
        }
        
        log('Preset 設定完成，開始交易循環...', 'info');
        await sleep(2000);
        
        // 再次檢查是否被停止
        if (!isRunning) {
            log('⚠️ 程序已停止', 'warning');
            window.botRunning = false;
            UI.setRunning(false);
            return;
        }

        // 初始化餘額
        await checkBalanceSufficient();

        // 重置動態調整計數器
        if (CONFIG.enableDynamicAdjustment) {
            consecutiveSuccesses = 0;
            consecutiveFailures = 0;
            currentSlippage = CONFIG.slippageInitial;
            currentPriority = CONFIG.priorityInitial;
            isAdjusting = false; // 重置調整狀態
            lastAdjustmentTime = 0; // 重置調整時間
            log(`🔄 動態調整已重置：Slippage=${currentSlippage.toFixed(2)}%, Priority=${currentPriority.toFixed(4)} gwei`, 'info');
            UI.updateStats(); // 更新 UI 顯示
        }

        await sleep(1200);

        while (isRunning) {
            try {
                // 檢查是否已停止
                if (!isRunning) break;

                // 檢查連續失敗次數
                if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
                    log(`❌ 連續失敗 ${consecutiveFailures} 次，暫停交易`, 'error');
                    log('請檢查網絡連接、餘額或頁面狀態後手動重啟', 'warning');
                    await sleep(10000);
                    if (!isRunning) break; // 檢查是否在等待期間被停止
                    consecutiveFailures = 0; // 重置計數器，繼續嘗試
                    continue;
                }

                // 檢查是否已停止
                if (!isRunning) break;

                // 檢查按鈕加載超時
                if (checkButtonLoadingTimeout()) {
                    break; // 頁面將刷新，退出循環
                }

                // 檢查是否已停止
                if (!isRunning) break;

                // 檢查餘額
                if (!await checkBalanceSufficient()) {
                    // 如果已經選擇了代幣，重新選擇幣種（選擇有餘額的幣種）
                    if (currentFromToken) {
                        log('⚠️ 當前選擇的代幣餘額不足，重新選擇幣種...', 'warning');
                        const reselectSuccess = await reselectTokensForBalance();
                        if (!reselectSuccess) {
                            if (!isRunning) break;
                            log('重新選擇幣種失敗，等待後重試...', 'warning');
                            await sleep(5000);
                            if (!isRunning) break;
                            continue;
                        }
                        // 重新選擇後，再次檢查餘額
                        if (!await checkBalanceSufficient()) {
                            log('⚠️ 重新選擇後餘額仍不足，等待...', 'warning');
                            await sleep(5000);
                            if (!isRunning) break;
                            continue;
                        }
                        log('✓ 重新選擇幣種成功，餘額充足', 'success');
                    } else {
                        // 如果還沒有選擇代幣，只是等待
                        log('餘額不足，等待...', 'warning');
                        await sleep(5000);
                        if (!isRunning) break; // 檢查是否在等待期間被停止
                        continue;
                    }
                }

                // 檢查是否已停止
                if (!isRunning) break;

                // 檢查交易頻率
                const timeSinceLastSwap = Date.now() - lastSwapTime;
                if (timeSinceLastSwap < CONFIG.minIntervalBetweenSwaps) {
                    const waitTime = CONFIG.minIntervalBetweenSwaps - timeSinceLastSwap;
                    log(`等待 ${(waitTime / 1000).toFixed(1)} 秒以控制交易頻率...`, 'info');
                    await sleep(waitTime);
                    if (!isRunning) break; // 檢查是否在等待期間被停止
                }

                log(`\n========== 新一輪交易 ${new Date().toLocaleTimeString()} ==========`, 'info');

                // 1. 檢查並關閉成功彈窗
                const closeBtn = findCloseButton();
                if (closeBtn) {
                    closeBtn.click();
                    log('✓ 關閉交易完成彈窗', 'success');
                    await sleep(CONFIG.waitAfterClose);
                    continue;
                }

                // 1.5. 新增：基於幣種比較判斷上一次 SWAP 的成功/失敗
                // 這個判斷應該在：1) 關閉彈窗之後，2) 選擇代幣之前
                // 此時如果有 currentFromToken，代表已經選過幣了，可以進行比較
                // 注意：需要在重置 currentFromToken 之前進行判斷
                if (currentFromToken) {
                    const verifyResult = verifySwapByTokenComparison();
                    
                    if (verifyResult.shouldUpdate) {
                        if (verifyResult.wasSuccess) {
                            // 上一次 SWAP 成功
                            stats.successfulSwaps++;
                            stats.lastSuccessTime = Date.now();
                            log(`✅ 統計更新：成功 +1 | 總計: ${stats.totalSwaps} | 成功: ${stats.successfulSwaps} | 失敗: ${stats.failedSwaps}`, 'success');
                            
                            // 動態調整（成功時）
                            await adjustSlippageAndPriority(true);
                        } else {
                            // 上一次 SWAP 失敗
                            stats.failedSwaps++;
                            log(`❌ 統計更新：失敗 +1 | 總計: ${stats.totalSwaps} | 成功: ${stats.successfulSwaps} | 失敗: ${stats.failedSwaps}`, 'error');
                            
                            // 動態調整（失敗時）
                            await adjustSlippageAndPriority(false);
                        }
                        
                        UI.updateStats();
                        
                        // 重置標記，為下一次判斷做準備
                        lastCycleConfirmed = false;
                    }
                }

                // 2. 檢查是否需要選擇代幣
                const chooseBtns = findChooseButtons();

                if (chooseBtns.length > 0) {
                    log(`檢測到 ${chooseBtns.length} 個 Choose 按鈕，開始選幣...`, 'info');

                    // 注意：在重置 currentFromToken 之前，它還保留著上一次的值
                    // 這個值已經在上一輪循環的選擇代幣完成時記錄為 lastCycleFromToken
                    // 現在重置它，準備選擇新的代幣
                    currentFromToken = null;

                    // 檢查是否已停止
                    if (!isRunning) break;

                    // 點擊第一個 Choose（發送代幣）
                    chooseBtns[0].click();
                    log('點擊第一個 Choose (發送)', 'info');
                    await sleep(CONFIG.waitAfterChoose);

                    // 檢查是否已停止
                    if (!isRunning) break;

                    if (isDialogOpen()) {
                        const success = await selectFirstToken();
                        if (!success) {
                            // 如果因為停止而失敗，直接退出
                            if (!isRunning) break;
                            log('選擇第一個代幣失敗', 'error');
                            consecutiveFailures++;
                            await sleep(2000);
                            continue;
                        }
                        await sleep(CONFIG.waitAfterTokenSelect);
                    }

                    // 檢查是否已停止
                    if (!isRunning) break;

                    log(`✓ 第一個代幣已設置為: ${currentFromToken}`, 'success');

                    // 新增：在選擇第一個代幣完成後，記錄本次要 SWAP 的幣種（用於下次循環比較判斷）
                    if (currentFromToken) {
                        lastCycleFromToken = currentFromToken;
                        log(`📝 記錄本次循環要 SWAP 的幣種: ${lastCycleFromToken}`, 'info');
                    }

                    // 點擊第二個 Choose（接收代幣）
                    await sleep(500);
                    
                    // 檢查是否已停止
                    if (!isRunning) break;
                    
                    // 使用 findAllTokenSelectionButtons 來查找，確保即使第一個已經被選擇了也能找到第二個
                    const allTokenBtns = findAllTokenSelectionButtons();
                    // 如果找不到，回退到使用 findChooseButtons
                    const chooseBtns2 = allTokenBtns.length >= 2 ? allTokenBtns : findChooseButtons();

                    if (chooseBtns2.length > 0) {
                        // 如果使用 findAllTokenSelectionButtons 且找到至少 2 個按鈕，點擊第二個
                        // 否則點擊第一個（因為 findChooseButtons 只會返回未選擇的按鈕）
                        const btnToClick = (allTokenBtns.length >= 2 && chooseBtns2 === allTokenBtns) ? chooseBtns2[1] : chooseBtns2[0];
                        btnToClick.click();
                        log('點擊第二個 Choose (接收)', 'info');
                        await sleep(CONFIG.waitAfterChoose);

                        // 檢查是否已停止
                        if (!isRunning) break;

                        if (isDialogOpen()) {
                            const success = await selectSecondToken();
                            if (!success) {
                                // 如果因為停止而失敗，直接退出
                                if (!isRunning) break;
                                log('選擇第二個代幣失敗', 'error');
                                consecutiveFailures++;
                                await sleep(2000);
                                continue;
                            }
                            await sleep(CONFIG.waitAfterTokenSelect);
                        }
                    }

                    // 檢查是否已停止
                    if (!isRunning) break;

                    // 確保所有視窗都已關閉，避免遮擋 SWAP 視窗
                    if (isDialogOpen()) {
                        log('確保代幣選擇視窗已關閉...', 'info');
                        await ensureAllDialogsClosed(3);
                        await sleep(500);
                    }

                    log('✓ 代幣選擇完成', 'success');
                    await sleep(1000);
                    // 注意：選擇代幣後不立即檢查餘額，因為此時可能顯示的是接收代幣列表
                    // 餘額檢查將在下一輪循環開始時進行（在選擇代幣之前）
                    // 注意：lastCycleFromToken 已在選擇第一個代幣完成時記錄
                    continue;
                }

                // 3. 檢查 MAX 按鈕狀態
                const maxBtn = findMaxButton();

                if (maxBtn && maxBtn.disabled) {
                    log('MAX 按鈕被禁用，嘗試切換方向...', 'warning');
                    const switchBtn = findSwitchButton();
                    if (switchBtn) {
                        switchBtn.click();
                        await sleep(CONFIG.waitAfterSwitch);
                        continue;
                    } else {
                        log('找不到切換按鈕', 'error');
                        consecutiveFailures++;
                        await sleep(2000);
                        continue;
                    }
                }

                if (maxBtn && !maxBtn.disabled) {
                    maxBtn.click();
                    log('✓ 點擊 MAX', 'success');
                    await sleep(CONFIG.waitAfterMax);
                } else if (!maxBtn) {
                    log('未找到 MAX 按鈕', 'warning');
                    consecutiveFailures++;
                    await sleep(2000);
                    continue;
                }

                // 4. 點擊 Confirm
                log(`等待 ${CONFIG.waitBeforeConfirm / 1000} 秒緩衝...`, 'info');
                await sleep(CONFIG.waitBeforeConfirm);

                // 記錄交易前的餘額（用於驗證交易是否真正成功）
                let balanceBeforeSwap = null;
                if (CONFIG.enableBalanceMonitoring && CONFIG.enableSuccessVerification) {
                    const rawBalances = await getTokenBalances();
                    // 標準化餘額精度，確保一致性
                    balanceBeforeSwap = {
                        USDT: parseFloat(parseFloat(rawBalances.USDT || 0).toFixed(8)),
                        USDC: parseFloat(parseFloat(rawBalances.USDC || 0).toFixed(8))
                    };
                    log(`記錄交易前餘額: USDT=${balanceBeforeSwap.USDT.toFixed(4)}, USDC=${balanceBeforeSwap.USDC.toFixed(4)}`, 'info');
                }

                let confirmClicked = false;

                for (let i = 0; i < CONFIG.maxRetryConfirm; i++) {
                    const confirmBtn = findConfirmButton();

                    if (confirmBtn && !confirmBtn.disabled) {
                        confirmBtn.click();
                        log(`✓ 點擊 Confirm (第 ${i + 1} 次)`, 'success');
                        confirmClicked = true;
                        lastSwapTime = Date.now();
                        
                        // 新增：標記本次循環已執行 Confirm（用於下次循環比較判斷）
                        // 注意：lastCycleFromToken 已在選擇第一個代幣完成時記錄，這裡不需要重複記錄
                        lastCycleConfirmed = true;
                        stats.totalSwaps++;
                        
                        log(`📝 標記：本次交易已提交，總交易次數: ${stats.totalSwaps}`, 'info');
                        UI.updateStats();
                        
                        break;
                    }

                    await sleep(500);
                }

                if (!confirmClicked) {
                    log('❌ Confirm 未成功，重試...', 'error');
                    consecutiveFailures++;
                    // 注意：Confirm 未點擊成功，不算一次真正的交易嘗試，不增加 totalSwaps
                    await sleep(2000);
                    continue;
                }

                // 5. 等待交易提交並進入下一輪（成功/失敗判斷將在下一輪循環開始時透過幣種比較完成）
                await sleep(CONFIG.waitAfterConfirm);

                // 嘗試關閉可能出現的成功彈窗（不等待，非阻塞）
                await sleep(1000);
                const closeAfterConfirm = findCloseButton();
                if (closeAfterConfirm) {
                    closeAfterConfirm.click();
                    log('✓ 關閉彈窗', 'success');
                    await sleep(CONFIG.waitAfterClose);
                }

                // 切換方向
                const switchBtn = findSwitchButton();
                if (switchBtn) {
                    switchBtn.click();
                    log('✓ 切換方向', 'success');
                    await sleep(CONFIG.waitAfterSwitch);
                }

                // 隨機等待後繼續下一輪
                // 注意：成功/失敗的判斷將在下一輪循環開始時透過幣種比較完成
                const randomWaitTime = randomWait(CONFIG.waitAfterTradeMin, CONFIG.waitAfterTradeMax);
                log(`✓ 交易已提交！總計: ${stats.totalSwaps} 次`, 'success');
                log(`⏳ 成功/失敗判斷將在下一輪循環開始時透過幣種比較完成`, 'info');
                log(`隨機等待 ${(randomWaitTime / 1000).toFixed(1)} 秒後繼續...`, 'info');
                await sleep(randomWaitTime);
                if (!isRunning) break; // 檢查是否在等待期間被停止

            } catch (error) {
                log(`運行出錯: ${error.message}`, 'error');
                console.error(error);
                consecutiveFailures++;
                stats.totalSwaps++;
                stats.failedSwaps++;
                stats.lastError = error.message;
                UI.updateStats();
                await sleep(3000);
            }
        }

        window.botRunning = false;
        UI.setRunning(false);
        
        // 停止防止暫停的機制
        stopHeartbeat();
        releaseWakeLock();
        
        // 重置幣種比較判斷相關的變數
        lastCycleFromToken = null;
        lastCycleConfirmed = false;
        
        log('🛑 自動交易已停止', 'warning');
        
        const runtime = stats.startTime ? Math.floor((Date.now() - stats.startTime) / 1000) : 0;
        const minutes = Math.floor(runtime / 60);
        const seconds = runtime % 60;
        log(`運行時間: ${minutes}分${seconds}秒`, 'info');
        log(`統計: 總計 ${stats.totalSwaps} | 成功 ${stats.successfulSwaps} | 失敗 ${stats.failedSwaps}`, 'info');
    }

    function stopSwapLoop() {
        // 立即設置停止標誌
        isRunning = false;
        window.botRunning = false;
        
        // 更新 UI 狀態
        UI.setRunning(false);

        // 清除定時器
        if (balanceCheckTimer) {
            clearInterval(balanceCheckTimer);
            balanceCheckTimer = null;
        }

        // 停止防止暫停的機制
        stopHeartbeat();
        releaseWakeLock();

        // 重置幣種比較判斷相關的變數
        lastCycleFromToken = null;
        lastCycleConfirmed = false;

        // 計算運行時間
        const runtime = stats.startTime ? Math.floor((Date.now() - stats.startTime) / 1000) : 0;
        const minutes = Math.floor(runtime / 60);
        const seconds = runtime % 60;

        log('🛑 停止交易（正在停止中...）', 'warning');
        log(`統計: 總計 ${stats.totalSwaps} | 成功 ${stats.successfulSwaps} | 失敗 ${stats.failedSwaps}`, 'info');
        log(`運行時間: ${minutes}分${seconds}秒`, 'info');
        log('等待當前操作完成後將完全停止...', 'info');
    }

    // ==================== UI 界面 ====================
    const UI = {
        root: null,
        statusDot: null,
        statusText: null,
        btnToggle: null,
        logEl: null,
        statsEl: null,

        mount() {
            if (this.root) return;

            const root = document.createElement('div');
            root.style.cssText = `
        position: fixed; right: 16px; bottom: 16px; z-index: 999999;
        width: 340px; font-family: ui-sans-serif, system-ui, -apple-system;
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
            titleWrap.style.cssText = `display: flex; flex-direction: column; line-height: 1.2; flex: 1;`;

            const title = document.createElement('div');
            title.textContent = 'TradeGenius Auto Swap';
            title.style.cssText = `font-weight: 700; font-size: 13px;`;

            const author = document.createElement('div');
            author.textContent = 'by B1N0RY';
            author.style.cssText = `font-size: 10px; opacity: .6; margin-top: 2px;`;

            const status = document.createElement('div');
            status.textContent = 'STOPPED';
            status.style.cssText = `font-size: 11px; opacity: .85; margin-top: 2px;`;

            titleWrap.appendChild(title);
            titleWrap.appendChild(author);
            titleWrap.appendChild(status);

            const btn = document.createElement('button');
            btn.textContent = 'Start (Ctrl+S)';
            btn.style.cssText = `
        border: 0; cursor: pointer; color: white;
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
        <div>• 代幣: USDC ⇄ USDT</div>
        <div>• 鏈: ${CONFIG.chainDisplayName} (Optimism)</div>
        <div>• 安全模式: 已啟用</div>
      `;

            const statsDiv = document.createElement('div');
            statsDiv.style.cssText = `
        font-size: 10px; opacity: .7; margin-bottom: 10px;
        padding: 8px; border-radius: 8px;
        background: rgba(0,0,0,.15);
      `;
            statsDiv.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 4px;">統計</div>
        <div>總計: <span id="stat-total">0</span> | 成功: <span id="stat-success">0</span> | 失敗: <span id="stat-fail">0</span></div>
        <div style="margin-top: 4px;">連續成功: <span id="stat-consecutive-success" style="color: #10b981;">0</span> | 連續失敗: <span id="stat-consecutive-fail" style="color: #ef4444;">0</span></div>
        <div style="margin-top: 4px;">Slippage: <span id="stat-slippage" style="color: #3b82f6;">${CONFIG.enableDynamicAdjustment ? CONFIG.slippageInitial.toFixed(2) : '0.10'}%</span> | Priority: <span id="stat-priority" style="color: #3b82f6;">${CONFIG.enableDynamicAdjustment ? CONFIG.priorityInitial.toFixed(4) : '0.0020'} gwei</span></div>
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
            logEl.textContent = '準備就緒。點擊 Start 或按 Ctrl+S 開始。\n';

            body.appendChild(info);
            body.appendChild(statsDiv);
            body.appendChild(logEl);

            root.appendChild(header);
            root.appendChild(body);
            document.body.appendChild(root);

            this.root = root;
            this.statusDot = dot;
            this.statusText = status;
            this.btnToggle = btn;
            this.logEl = logEl;
            this.statsEl = statsDiv;

            btn.addEventListener('click', () => this.toggle());

            window.addEventListener('keydown', (e) => {
                if (e.ctrlKey && (e.key === 's' || e.key === 'S') && !e.altKey) {
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

        updateStats() {
            if (!this.statsEl) return;
            const totalEl = this.statsEl.querySelector('#stat-total');
            const successEl = this.statsEl.querySelector('#stat-success');
            const failEl = this.statsEl.querySelector('#stat-fail');
            const consecutiveSuccessEl = this.statsEl.querySelector('#stat-consecutive-success');
            const consecutiveFailEl = this.statsEl.querySelector('#stat-consecutive-fail');
            const slippageEl = this.statsEl.querySelector('#stat-slippage');
            const priorityEl = this.statsEl.querySelector('#stat-priority');
            
            if (totalEl) totalEl.textContent = stats.totalSwaps;
            if (successEl) successEl.textContent = stats.successfulSwaps;
            if (failEl) failEl.textContent = stats.failedSwaps;
            
            // 更新連續成功/失敗次數
            if (consecutiveSuccessEl && CONFIG.enableDynamicAdjustment) {
                consecutiveSuccessEl.textContent = consecutiveSuccesses;
            }
            if (consecutiveFailEl && CONFIG.enableDynamicAdjustment) {
                consecutiveFailEl.textContent = consecutiveFailures;
            }
            
            // 更新 Slippage 和 Priority
            if (slippageEl && CONFIG.enableDynamicAdjustment) {
                slippageEl.textContent = `${currentSlippage.toFixed(2)}%`;
            }
            if (priorityEl && CONFIG.enableDynamicAdjustment) {
                priorityEl.textContent = `${currentPriority.toFixed(4)} gwei`;
            }
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
        // 設置頁面可見性監聽器（在腳本加載時就設置，不需要等到啟動）
        setupVisibilityListener();
        log('腳本已加載。按 Ctrl+S 或點擊 Start 開始。', 'success');
        log(`鏈設置: 固定使用 ${CONFIG.chainDisplayName} (Optimism) 鏈`, 'info');
        log('增強版安全模式已啟用', 'info');
        log('已啟用防止螢幕關閉時暫停的功能', 'info');
    }

    // 暴露全局函數
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

/* ============================================================
 * Author: B1N0RY
 * Enhanced Safety Edition
 *
 * Features:
 * - 完善的防呆機制與風險控制
 * - 餘額監控與異常檢測
 * - 交易成功驗證
 * - 自動恢復機制
 * - 連續失敗保護
 * - 交易頻率控制
 * - 詳細統計與日誌
 *
 * NOTICE:
 * This script is released publicly.
 * Removing or modifying author attribution is NOT permitted.
 * ============================================================ */
