// ==UserScript==
// @name         Auto Swap Bot
// @namespace    https://hunter-association.io
// @version      1.0.1
// @description  Automated swap execution script
// @author       伍壹51
// @homepage     https://x.com/0x515151
// @match        https://www.tradegenius.com/trade
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ========= 使用說明 =========
  // 1) 把上面的 @match 改成你的 DApp 網址網域，例如：
  //    @match https://app.example.com/*
  // 2) 進入該網站後，右下角會出現面板，按 Start 開始跑
  // 3) 熱鍵 Ctrl + Alt + S 開關
  // 4) 停止可按 Stop，或 console 輸入 stopBot()

  // ========= 小保護：只在頂層頁面跑（避免 iframe 重複啟動）=========
  if (window.top !== window.self) return;

  // ========= UI 面板 =========
  const UI = {
    root: null,
    statusDot: null,
    statusText: null,
    btnToggle: null,
    logEl: null,
    setRunning(running) {
      if (!this.root) return;
      this.statusDot.style.background = running ? '#16a34a' : '#dc2626';
      this.statusText.textContent = running ? 'RUNNING' : 'STOPPED';
      this.btnToggle.textContent = running ? 'Stop (Ctrl+Alt+S)' : 'Start (Ctrl+Alt+S)';
      this.btnToggle.style.background = running ? '#dc2626' : '#16a34a';
    },
    log(msg) {
      if (!this.logEl) return;
      const t = new Date().toLocaleTimeString();
      this.logEl.textContent = `[${t}] ${msg}\n` + this.logEl.textContent.slice(0, 1200);
    }
  };

  function mountUI() {
    if (UI.root) return;

    const root = document.createElement('div');
    root.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 999999;
      width: 260px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
      border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,.25);
      background: rgba(17, 24, 39, .92); color: #e5e7eb; backdrop-filter: blur(8px);
    `;

    const header = document.createElement('div');
    header.style.cssText = `padding: 10px 12px; display:flex; align-items:center; gap:10px; border-bottom: 1px solid rgba(255,255,255,.08);`;

    const dot = document.createElement('span');
    dot.style.cssText = `width:10px; height:10px; border-radius:999px; background:#dc2626; display:inline-block;`;

    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = `display:flex; flex-direction:column; line-height:1.15;`;

    const title = document.createElement('div');
    title.textContent = 'AutoSwap';

const author = document.createElement('div');
author.innerHTML = `
  <div style="font-size:11px; opacity:.75;">伍壹51</div>
  <div style="font-size:11px; opacity:.65;">X：0x515151</div>
`;
author.style.marginTop = '2px';

titleWrap.appendChild(author);

    title.style.cssText = `font-weight:700; font-size:13px;`;

    const status = document.createElement('div');
    status.textContent = 'STOPPED';
    status.style.cssText = `font-size:12px; opacity:.9;`;

    titleWrap.appendChild(title);
    titleWrap.appendChild(status);

    const btn = document.createElement('button');
    btn.textContent = 'Start (Ctrl+Alt+S)';
    btn.style.cssText = `
      margin-left:auto; border:0; cursor:pointer; color:white;
      background:#16a34a; padding:8px 10px; border-radius:10px;
      font-weight:700; font-size:12px;
    `;

    const body = document.createElement('div');
    body.style.cssText = `padding: 10px 12px;`;

    const tip = document.createElement('div');
    tip.style.cssText = `font-size:12px; opacity:.85; margin-bottom:8px;`;
    tip.textContent = 'Tip: 先確保頁面手動可交易（MAX/Confirm 不灰）再開，全程使用EN介面。';

    const log = document.createElement('pre');
    log.style.cssText = `
      margin:0; padding:8px; border-radius:10px;
      background: rgba(0,0,0,.25);
      font-size:11px; line-height:1.35;
      white-space: pre-wrap; word-break: break-word;
      max-height: 140px; overflow:auto;
    `;
    log.textContent = 'Ready.\n';

    body.appendChild(tip);
    body.appendChild(log);

    header.appendChild(dot);
    header.appendChild(titleWrap);
    header.appendChild(btn);

    root.appendChild(header);
    root.appendChild(body);
    document.body.appendChild(root);

    UI.root = root;
    UI.statusDot = dot;
    UI.statusText = status;
    UI.btnToggle = btn;
    UI.logEl = log;

    UI.setRunning(false);
  }

  // ========= 原脚本：配置 =========
  const CONFIG = {
    waitAfterMax: 1000,
    maxRetryConfirm: 20,
    waitAfterConfirm: 3000,
    waitAfterFixSwitch: 2000,
    waitRandomMin: 12000,
    waitRandomMax: 25000,

    waitAfterClose: 1500,
    waitAfterChoose: 1000,
    waitAfterTokenSelect: 1500,
    waitAfterTabClick: 800,
    waitForHover: 500,

    // 新增：啟動前等待頁面穩定
    waitBeforeStart: 1200,
  };

  let isRunning = false;
  let selectedFromToken = null;
  let loopPromise = null;

  // ========= 工具函数 =========
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const getRandomTime = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  function findCloseBtn() {
    return Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText.trim().toUpperCase() === 'CLOSE' &&
        (b.className || '').includes('bg-genius-pink'));
  }

  function findChooseBtns() {
    return Array.from(document.querySelectorAll('button'))
      .filter(b => b.innerText.trim() === 'Choose' ||
        (b.querySelector('span')?.innerText || '').trim() === 'Choose');
  }

  function findMaxBtn() {
    return Array.from(document.querySelectorAll('button'))
      .find(b => ["MAX", "最大"].includes(b.innerText.trim().toUpperCase()));
  }

  function findConfirmBtn() {
    return Array.from(document.querySelectorAll('button'))
      .find(b => {
        const t = b.innerText.trim().toUpperCase();
        return t.includes("CONFIRM") || t.includes("确认") || t.includes("PLACE");
      });
  }

  function findSwitchBtn() {
    const svg = document.querySelector('svg.lucide-arrow-up-down');
    return svg ? svg.closest('button') : document.querySelector('button[aria-label="Switch"]');
  }

  function isDialogOpen() {
    return !!document.querySelector('[role="dialog"][data-state="open"]');
  }

  // ========= 代币选择函数 =========
  async function selectMaxBalanceToken() {
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
          UI.log(`发现 ${symbol}: ${balance}`);
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
      selectedFromToken = targetSymbol;
      UI.log(`✅ From 选择了 ${targetSymbol} (余额: ${maxBalance})`);
      return true;
    }

    UI.log("⚠️ 未找到 USDT/USDC");
    return false;
  }

  async function selectReceiveToken() {
    await sleep(CONFIG.waitAfterChoose);

    const targetToken = selectedFromToken === 'USDT' ? 'USDC' : 'USDT';
    UI.log(`From 是 ${selectedFromToken}，Receive 选择 ${targetToken}`);

    // 点击 Stable 标签
    const tabs = document.querySelectorAll('[role="dialog"] .flex.flex-row.gap-3 > div');
    let stableTab = null;
    tabs.forEach(tab => {
      if (tab.innerText.trim().toLowerCase() === 'stable') stableTab = tab;
    });

    if (stableTab) {
      stableTab.click();
      UI.log("点击 Stable 标签");
      await sleep(CONFIG.waitAfterTabClick);
    } else {
      UI.log("未找到 Stable 标签，尝试直接选择");
    }

    await sleep(300);

    const tokenRows = document.querySelectorAll('[role="dialog"] .relative.group');
    for (const row of tokenRows) {
      const symbolEl = row.querySelector('.text-sm.text-genius-cream');
      const symbol = symbolEl?.innerText?.trim();

      if (symbol === targetToken) {
        UI.log(`找到 ${symbol}，尝试选择 BNB 链...`);

        // 触发悬停
        row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await sleep(CONFIG.waitForHover);

        // hover 菜单（若网站使用 portal，这里可能抓不到，会走 fallback）
        const chainMenu = row.querySelector('.genius-shadow');
        if (chainMenu) {
          const chainOptions = chainMenu.querySelectorAll('.cursor-pointer');
          for (const opt of chainOptions) {
            const chainName = opt.querySelector('span')?.innerText?.trim();
            if (chainName === 'BNB' || chainName === 'Binance') {
              opt.click();
              UI.log(`✅ Receive 选择了 ${symbol} (BNB链)`);
              return true;
            }
          }
        }

        // fallback：直接点 token
        row.click();
        UI.log(`✅ Receive 直接选择了 ${symbol}`);
        return true;
      }
    }

    UI.log(`⚠️ 未找到 ${targetToken}`);
    return false;
  }

  // ========= 主循环 =========
  async function startLoop() {
    if (window.botRunning) {
      UI.log("⚠️ 脚本已经在运行了！");
      return;
    }
    window.botRunning = true;
    isRunning = true;
    UI.setRunning(true);

    UI.log(`🚀 Bot started. 区间: ${CONFIG.waitRandomMin/1000}s - ${CONFIG.waitRandomMax/1000}s`);

    await sleep(CONFIG.waitBeforeStart);

    while (isRunning) {
      try {
        UI.log(`--- 新循环 ${new Date().toLocaleTimeString()} ---`);

        // Step 0: close
        const closeBtn = findCloseBtn();
        if (closeBtn) {
          closeBtn.click();
          UI.log("✅ 关闭交易完成弹窗");
          await sleep(CONFIG.waitAfterClose);
          continue;
        }

        // Step 0.5: choose tokens
        const chooseBtns = findChooseBtns();
        if (chooseBtns.length > 0) {
          UI.log(`📌 检测到 ${chooseBtns.length} 个 Choose，开始选币...`);

          selectedFromToken = null;

          chooseBtns[0].click();
          UI.log("点击第一个 Choose (From)");
          await sleep(CONFIG.waitAfterChoose);

          if (isDialogOpen()) {
            await selectMaxBalanceToken();
            await sleep(CONFIG.waitAfterTokenSelect);
          }

          await sleep(500);
          const chooseBtns2 = findChooseBtns();
          if (chooseBtns2.length > 0) {
            chooseBtns2[0].click();
            UI.log("点击第二个 Choose (Receive)");
            await sleep(CONFIG.waitAfterChoose);

            if (isDialogOpen()) {
              await selectReceiveToken();
              await sleep(CONFIG.waitAfterTokenSelect);
            }
          }

          UI.log("✅ 代币选择完成");
          await sleep(1000);
          continue;
        }

        // Step 1: MAX
        const btnMax = findMaxBtn();

        if (btnMax && btnMax.disabled) {
          UI.log("⚠️ MAX 灰色，尝试切换方向...");
          const btnSwitch = findSwitchBtn();
          if (btnSwitch) {
            btnSwitch.click();
            await sleep(CONFIG.waitAfterFixSwitch);
            continue;
          } else {
            UI.log("❌ 找不到切换按钮");
          }
        }

        if (btnMax && !btnMax.disabled) {
          btnMax.click();
          UI.log("✅ 点击 MAX");
        } else if (!btnMax) {
          UI.log("❌ 没找到 MAX 按钮（可能页面未就绪/按钮文字不同）");
          await sleep(2000);
          continue;
        }

        await sleep(CONFIG.waitAfterMax);

        // Step 2: Confirm
        let confirmClicked = false;
        for (let i = 0; i < CONFIG.maxRetryConfirm; i++) {
          const btnConfirm = findConfirmBtn();
          if (btnConfirm && !btnConfirm.disabled) {
            btnConfirm.click();
            UI.log(`✅ 点击 Confirm (第 ${i + 1} 次)`);
            confirmClicked = true;
            break;
          }
          await sleep(500);
        }

        // Step 3: After confirm
        if (confirmClicked) {
          await sleep(CONFIG.waitAfterConfirm);

          const closeAfterConfirm = findCloseBtn();
          if (closeAfterConfirm) {
            closeAfterConfirm.click();
            UI.log("✅ 关闭成功弹窗");
            await sleep(CONFIG.waitAfterClose);
          }

          const btnSwitch = findSwitchBtn();
          if (btnSwitch) {
            btnSwitch.click();
            UI.log("✅ 切换方向");
          }

          const randomWait = getRandomTime(CONFIG.waitRandomMin, CONFIG.waitRandomMax);
          UI.log(`🎲 随机休息 ${(randomWait / 1000).toFixed(1)} 秒...`);
          await sleep(randomWait);
        } else {
          UI.log("⚠️ Confirm 未成功，短休后重试...");
          await sleep(2000);
        }
      } catch (e) {
        UI.log("❌ 运行出错（已自动继续）");
        console.error(e);
        await sleep(3000);
      }
    }

    // loop ended
    window.botRunning = false;
    UI.setRunning(false);
    UI.log("🛑 Bot stopped.");
  }

  function stopLoop() {
    isRunning = false;
    window.botRunning = false;
    UI.setRunning(false);
    UI.log("🛑 stop() called");
  }

  // ========= 暴露停止方法（兼容你原来的 stopBot）=========
  window.stopBot = () => stopLoop();
  window.startBot = () => {
    if (isRunning) return;
    loopPromise = startLoop();
  };

  // ========= 绑定 UI / 热键 =========
  function toggle() {
    if (isRunning) stopLoop();
    else window.startBot();
  }

  function bindHotkey() {
    window.addEventListener('keydown', (e) => {
      // Ctrl + Alt + S
      if (e.ctrlKey && e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        toggle();
      }
    });
  }

  // ========= 初始化 =========
  function init() {
    mountUI();
    bindHotkey();

    UI.btnToggle.addEventListener('click', toggle);
    UI.log('Loaded. Click Start or press Ctrl+Alt+S.');
  }

  // 等 body 可用
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


/* ============================================================
 * Author: 51 | Hunter Association
 * X (Twitter): https://x.com/0x515151
 *
 * NOTICE:
 * This script is released publicly.
 * Removing or modifying author attribution is NOT permitted.
 * ============================================================ */
