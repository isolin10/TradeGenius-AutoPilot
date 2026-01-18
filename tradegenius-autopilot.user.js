// ==UserScript==
// @name         Auto Swap Bot + Random Auto Refresh
// @namespace    https://hunter-association.io
// @version      2.0.0
// @description  Automated swap execution with random auto-refresh (20-40min)
// @author       伍壹51
// @homepage     https://x.com/0x515151
// @match        https://www.tradegenius.com/trade
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ========= 小保護：只在頂層頁面跑（避免 iframe 重複啟動）=========
  if (window.top !== window.self) return;

  // ========= Auto Refresh 配置 =========
  const REFRESH_CONFIG = {
    MIN_MINUTES: 20,
    MAX_MINUTES: 40,
    KEY_ENABLED: 'tg_rand_refresh_enabled',
    KEY_NEXT_AT: 'tg_rand_refresh_next_at',
  };

  const MIN_MS = REFRESH_CONFIG.MIN_MINUTES * 60 * 1000;
  const MAX_MS = REFRESH_CONFIG.MAX_MINUTES * 60 * 1000;

  // ========= Auto Swap 配置 =========
  const SWAP_CONFIG = {
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
    waitBeforeStart: 1200,
  };

  // ========= 共用工具函數 =========
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randDelay = () => randInt(MIN_MS, MAX_MS);
  const getRandomTime = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString();
  const fmtLeft = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  };

  // ========= Swap Bot 變數 =========
  let isSwapRunning = false;
  let selectedFromToken = null;
  let loopPromise = null;

  // ========= Auto Refresh 變數 =========
  let refreshEnabled = localStorage.getItem(REFRESH_CONFIG.KEY_ENABLED);
  refreshEnabled = refreshEnabled === null ? true : refreshEnabled === '1';
  let refreshTimerId = null;
  let refreshTickerId = null;

  // ========= 合併 UI 面板 =========
  const UI = {
    root: null,
    // Swap Bot UI
    swapStatusDot: null,
    swapStatusText: null,
    swapBtnToggle: null,
    swapLogEl: null,
    // Refresh UI
    refreshDot: null,
    refreshStatus: null,
    refreshNextEl: null,
    refreshLeftEl: null,
    refreshBtnToggle: null,
    refreshBtnNow: null,

    setSwapRunning(running) {
      if (!this.root) return;
      this.swapStatusDot.style.background = running ? '#16a34a' : '#dc2626';
      this.swapStatusText.textContent = running ? 'RUNNING' : 'STOPPED';
      this.swapBtnToggle.textContent = running ? 'Stop (Ctrl+Alt+S)' : 'Start (Ctrl+Alt+S)';
      this.swapBtnToggle.style.background = running ? '#dc2626' : '#16a34a';
    },

    logSwap(msg) {
      if (!this.swapLogEl) return;
      const t = new Date().toLocaleTimeString();
      this.swapLogEl.textContent = `[${t}] ${msg}\n` + this.swapLogEl.textContent.slice(0, 1200);
    },

    renderRefresh(nextAt) {
      const isOn = refreshEnabled;
      this.refreshDot.style.background = isOn ? '#16a34a' : '#dc2626';
      this.refreshStatus.textContent = isOn ? 'RUNNING' : 'PAUSED';
      this.refreshBtnToggle.textContent = isOn ? 'Pause (Ctrl+Alt+R)' : 'Resume (Ctrl+Alt+R)';
      this.refreshBtnToggle.style.background = isOn ? '#dc2626' : '#16a34a';

      const at = nextAt ?? Number(localStorage.getItem(REFRESH_CONFIG.KEY_NEXT_AT) || 0);
      this.refreshNextEl.textContent = at ? `Next: ${fmtTime(at)}` : 'Next: -';

      const leftMs = at ? (at - Date.now()) : 0;
      this.refreshLeftEl.textContent = at ? `Left: ${fmtLeft(leftMs)}` : 'Left: -';
    }
  };

  function mountUI() {
    if (UI.root) return;

    const root = document.createElement('div');
    root.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 999999;
      width: 300px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
      border-radius: 12px; overflow: hidden;
      background: rgba(17,24,39,.92); color: #e5e7eb; backdrop-filter: blur(8px);
      box-shadow: 0 10px 30px rgba(0,0,0,.25);
    `;

    // ========= Swap Bot Section =========
    const swapHeader = document.createElement('div');
    swapHeader.style.cssText = `padding: 10px 12px; display:flex; align-items:center; gap:10px; border-bottom: 1px solid rgba(255,255,255,.08);`;

    const swapDot = document.createElement('span');
    swapDot.style.cssText = `width:10px; height:10px; border-radius:999px; background:#dc2626; display:inline-block;`;

    const swapTitleWrap = document.createElement('div');
    swapTitleWrap.style.cssText = `display:flex; flex-direction:column; line-height:1.15;`;

    const swapTitle = document.createElement('div');
    swapTitle.textContent = 'AutoSwap Bot';
    swapTitle.style.cssText = `font-weight:700; font-size:13px;`;

    const swapStatus = document.createElement('div');
    swapStatus.textContent = 'STOPPED';
    swapStatus.style.cssText = `font-size:12px; opacity:.9;`;

    swapTitleWrap.appendChild(swapTitle);
    swapTitleWrap.appendChild(swapStatus);

    const swapBtn = document.createElement('button');
    swapBtn.textContent = 'Start (Ctrl+Alt+S)';
    swapBtn.style.cssText = `
      margin-left:auto; border:0; cursor:pointer; color:white;
      background:#16a34a; padding:8px 10px; border-radius:10px;
      font-weight:700; font-size:12px;
    `;

    swapHeader.appendChild(swapDot);
    swapHeader.appendChild(swapTitleWrap);
    swapHeader.appendChild(swapBtn);

    const swapBody = document.createElement('div');
    swapBody.style.cssText = `padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08);`;

    // ========= Author Info (移到這裡，在 Tip 上面) =========
    const authorInfo = document.createElement('div');
    authorInfo.style.cssText = `
      font-size:11px; opacity:.75; margin-bottom:8px;
      padding:6px 8px; border-radius:8px;
      background: rgba(0,0,0,.15);
      border: 1px solid rgba(255,255,255,.05);
    `;
    authorInfo.innerHTML = `
      <div style="font-weight:700; margin-bottom:2px;">作者：伍壹51</div>
      <div style="opacity:.85;">X: <a href="https://x.com/0x515151" target="_blank" style="color:#60a5fa; text-decoration:none;">@0x515151</a></div>
      <div style="opacity:.85;">TradeGenius: <a href="https://www.tradegenius.com/ref/8C2TSF" target="_blank" style="color:#60a5fa; text-decoration:none;">直達鏈結</a></div>
    `;

    const swapTip = document.createElement('div');
    swapTip.style.cssText = `font-size:11px; opacity:.85; margin-bottom:8px;`;
    swapTip.textContent = 'Tip: 先確保頁面手動可交易（MAX/Confirm 不灰）再開，全程使用英文介面。';

    const swapLog = document.createElement('pre');
    swapLog.style.cssText = `
      margin:0; padding:8px; border-radius:10px;
      background: rgba(0,0,0,.25);
      font-size:11px; line-height:1.35;
      white-space: pre-wrap; word-break: break-word;
      max-height: 120px; overflow:auto;
    `;
    swapLog.textContent = 'Ready.\n';

    swapBody.appendChild(authorInfo);  // 作者資訊放最上面
    swapBody.appendChild(swapTip);
    swapBody.appendChild(swapLog);

    // ========= Refresh Section =========
    const refreshHeader = document.createElement('div');
    refreshHeader.style.cssText = `padding: 10px 12px; display:flex; gap:10px; align-items:center; border-bottom: 1px solid rgba(255,255,255,.08);`;

    const refreshDot = document.createElement('span');
    refreshDot.style.cssText = `width:10px; height:10px; border-radius:999px; background:#16a34a; display:inline-block;`;

    const refreshTitleWrap = document.createElement('div');
    refreshTitleWrap.style.cssText = `display:flex; flex-direction:column; line-height:1.15;`;

    const refreshTitle = document.createElement('div');
    refreshTitle.textContent = 'Auto Refresh';
    refreshTitle.style.cssText = `font-weight:700; font-size:13px;`;

    const refreshStatus = document.createElement('div');
    refreshStatus.textContent = 'RUNNING';
    refreshStatus.style.cssText = `font-size:12px; opacity:.9;`;

    refreshTitleWrap.appendChild(refreshTitle);
    refreshTitleWrap.appendChild(refreshStatus);

    refreshHeader.appendChild(refreshDot);
    refreshHeader.appendChild(refreshTitleWrap);

    const refreshBody = document.createElement('div');
    refreshBody.style.cssText = `padding: 10px 12px;`;

    const refreshNext = document.createElement('div');
    refreshNext.style.cssText = `margin-bottom:6px; opacity:.9; font-size:12px;`;
    refreshNext.textContent = 'Next: -';

    const refreshLeft = document.createElement('div');
    refreshLeft.style.cssText = `margin-bottom:10px; opacity:.9; font-size:12px;`;
    refreshLeft.textContent = 'Left: -';

    const refreshBtnRow = document.createElement('div');
    refreshBtnRow.style.cssText = `display:flex; gap:8px;`;

    const refreshBtnToggle = document.createElement('button');
    refreshBtnToggle.style.cssText = `
      flex:1; border:0; cursor:pointer; color:white;
      background:#dc2626; padding:8px 10px; border-radius:10px;
      font-weight:700; font-size:12px;
    `;
    refreshBtnToggle.textContent = 'Pause (Ctrl+Alt+R)';

    const refreshBtnNow = document.createElement('button');
    refreshBtnNow.style.cssText = `
      flex:1; border:0; cursor:pointer; color:white;
      background:#2563eb; padding:8px 10px; border-radius:10px;
      font-weight:700; font-size:12px;
    `;
    refreshBtnNow.textContent = 'Refresh now';

    const refreshTip = document.createElement('div');
    refreshTip.style.cssText = `margin-top:10px; font-size:11px; opacity:.65; line-height:1.35;`;
    refreshTip.textContent = `Interval: random ${REFRESH_CONFIG.MIN_MINUTES}–${REFRESH_CONFIG.MAX_MINUTES} minutes`;

    refreshBtnRow.appendChild(refreshBtnToggle);
    refreshBtnRow.appendChild(refreshBtnNow);

    refreshBody.appendChild(refreshNext);
    refreshBody.appendChild(refreshLeft);
    refreshBody.appendChild(refreshBtnRow);
    refreshBody.appendChild(refreshTip);

    // ========= Assemble UI =========
    root.appendChild(swapHeader);
    root.appendChild(swapBody);
    root.appendChild(refreshHeader);
    root.appendChild(refreshBody);

    document.body.appendChild(root);

    UI.root = root;
    UI.swapStatusDot = swapDot;
    UI.swapStatusText = swapStatus;
    UI.swapBtnToggle = swapBtn;
    UI.swapLogEl = swapLog;
    UI.refreshDot = refreshDot;
    UI.refreshStatus = refreshStatus;
    UI.refreshNextEl = refreshNext;
    UI.refreshLeftEl = refreshLeft;
    UI.refreshBtnToggle = refreshBtnToggle;
    UI.refreshBtnNow = refreshBtnNow;

    UI.setSwapRunning(false);
    UI.renderRefresh();

    // ========= Event Listeners =========
    swapBtn.addEventListener('click', toggleSwap);
    refreshBtnToggle.addEventListener('click', toggleRefresh);
    refreshBtnNow.addEventListener('click', () => doReload('manual'));

    window.addEventListener('keydown', (e) => {
      // Ctrl + Alt + S: Toggle Swap Bot
      if (e.ctrlKey && e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        toggleSwap();
      }
      // Ctrl + Alt + R: Toggle Auto Refresh
      if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        toggleRefresh();
      }
    });
  }

  // ========= Auto Refresh Functions =========
  function clearRefreshTimers() {
    if (refreshTimerId) clearTimeout(refreshTimerId);
    if (refreshTickerId) clearInterval(refreshTickerId);
    refreshTimerId = null;
    refreshTickerId = null;
  }

  function setNextAt(ts) {
    localStorage.setItem(REFRESH_CONFIG.KEY_NEXT_AT, String(ts));
    UI.renderRefresh(ts);
  }

  function scheduleRefresh() {
    clearRefreshTimers();

    let nextAt = Number(localStorage.getItem(REFRESH_CONFIG.KEY_NEXT_AT) || 0);
    const now = Date.now();

    if (!nextAt || nextAt < now + 2000) {
      nextAt = now + randDelay();
      setNextAt(nextAt);
    }

    refreshTickerId = setInterval(() => {
      UI.renderRefresh(nextAt);
    }, 1000);

    const wait = Math.max(0, nextAt - now);
    refreshTimerId = setTimeout(() => doReload('timer'), wait);
  }

  function doReload(reason) {
    const nextAt = Date.now() + randDelay();
    setNextAt(nextAt);

    sleep(150).then(() => {
      location.reload();
    });
  }

  function setRefreshEnabled(v) {
    refreshEnabled = v;
    localStorage.setItem(REFRESH_CONFIG.KEY_ENABLED, v ? '1' : '0');
    if (refreshEnabled) scheduleRefresh();
    else clearRefreshTimers();
    UI.renderRefresh();
  }

  function toggleRefresh() {
    setRefreshEnabled(!refreshEnabled);
  }

  // ========= Swap Bot Functions =========
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

  async function selectMaxBalanceToken() {
    await sleep(SWAP_CONFIG.waitAfterChoose);

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
          UI.logSwap(`发现 ${symbol}: ${balance}`);
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
      UI.logSwap(`✅ From 选择了 ${targetSymbol} (余额: ${maxBalance})`);
      return true;
    }

    UI.logSwap("⚠️ 未找到 USDT/USDC");
    return false;
  }

  async function selectReceiveToken() {
    await sleep(SWAP_CONFIG.waitAfterChoose);

    const targetToken = selectedFromToken === 'USDT' ? 'USDC' : 'USDT';
    UI.logSwap(`From 是 ${selectedFromToken}，Receive 选择 ${targetToken}`);

    const tabs = document.querySelectorAll('[role="dialog"] .flex.flex-row.gap-3 > div');
    let stableTab = null;
    tabs.forEach(tab => {
      if (tab.innerText.trim().toLowerCase() === 'stable') stableTab = tab;
    });

    if (stableTab) {
      stableTab.click();
      UI.logSwap("点击 Stable 标签");
      await sleep(SWAP_CONFIG.waitAfterTabClick);
    } else {
      UI.logSwap("未找到 Stable 标签，尝试直接选择");
    }

    await sleep(300);

    const tokenRows = document.querySelectorAll('[role="dialog"] .relative.group');
    for (const row of tokenRows) {
      const symbolEl = row.querySelector('.text-sm.text-genius-cream');
      const symbol = symbolEl?.innerText?.trim();

      if (symbol === targetToken) {
        UI.logSwap(`找到 ${symbol}，尝试选择 BNB 链...`);

        row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await sleep(SWAP_CONFIG.waitForHover);

        const chainMenu = row.querySelector('.genius-shadow');
        if (chainMenu) {
          const chainOptions = chainMenu.querySelectorAll('.cursor-pointer');
          for (const opt of chainOptions) {
            const chainName = opt.querySelector('span')?.innerText?.trim();
            if (chainName === 'BNB' || chainName === 'Binance') {
              opt.click();
              UI.logSwap(`✅ Receive 选择了 ${symbol} (BNB链)`);
              return true;
            }
          }
        }

        row.click();
        UI.logSwap(`✅ Receive 直接选择了 ${symbol}`);
        return true;
      }
    }

    UI.logSwap(`⚠️ 未找到 ${targetToken}`);
    return false;
  }

  async function startSwapLoop() {
    if (window.botRunning) {
      UI.logSwap("⚠️ 脚本已经在运行了！");
      return;
    }
    window.botRunning = true;
    isSwapRunning = true;
    UI.setSwapRunning(true);

    UI.logSwap(`🚀 Bot started. 区间: ${SWAP_CONFIG.waitRandomMin/1000}s - ${SWAP_CONFIG.waitRandomMax/1000}s`);

    await sleep(SWAP_CONFIG.waitBeforeStart);

    while (isSwapRunning) {
      try {
        UI.logSwap(`--- 新循环 ${new Date().toLocaleTimeString()} ---`);

        const closeBtn = findCloseBtn();
        if (closeBtn) {
          closeBtn.click();
          UI.logSwap("✅ 关闭交易完成弹窗");
          await sleep(SWAP_CONFIG.waitAfterClose);
          continue;
        }

        const chooseBtns = findChooseBtns();
        if (chooseBtns.length > 0) {
          UI.logSwap(`📌 检测到 ${chooseBtns.length} 个 Choose，开始选币...`);

          selectedFromToken = null;

          chooseBtns[0].click();
          UI.logSwap("点击第一个 Choose (From)");
          await sleep(SWAP_CONFIG.waitAfterChoose);

          if (isDialogOpen()) {
            await selectMaxBalanceToken();
            await sleep(SWAP_CONFIG.waitAfterTokenSelect);
          }

          await sleep(500);
          const chooseBtns2 = findChooseBtns();
          if (chooseBtns2.length > 0) {
            chooseBtns2[0].click();
            UI.logSwap("点击第二个 Choose (Receive)");
            await sleep(SWAP_CONFIG.waitAfterChoose);

            if (isDialogOpen()) {
              await selectReceiveToken();
              await sleep(SWAP_CONFIG.waitAfterTokenSelect);
            }
          }

          UI.logSwap("✅ 代币选择完成");
          await sleep(1000);
          continue;
        }

        const btnMax = findMaxBtn();

        if (btnMax && btnMax.disabled) {
          UI.logSwap("⚠️ MAX 灰色，尝试切换方向...");
          const btnSwitch = findSwitchBtn();
          if (btnSwitch) {
            btnSwitch.click();
            await sleep(SWAP_CONFIG.waitAfterFixSwitch);
            continue;
          } else {
            UI.logSwap("❌ 找不到切换按钮");
          }
        }

        if (btnMax && !btnMax.disabled) {
          btnMax.click();
          UI.logSwap("✅ 点击 MAX");
        } else if (!btnMax) {
          UI.logSwap("❌ 没找到 MAX 按钮（可能页面未就绪/按钮文字不同）");
          await sleep(2000);
          continue;
        }

        await sleep(SWAP_CONFIG.waitAfterMax);

        let confirmClicked = false;
        for (let i = 0; i < SWAP_CONFIG.maxRetryConfirm; i++) {
          const btnConfirm = findConfirmBtn();
          if (btnConfirm && !btnConfirm.disabled) {
            btnConfirm.click();
            UI.logSwap(`✅ 点击 Confirm (第 ${i + 1} 次)`);
            confirmClicked = true;
            break;
          }
          await sleep(500);
        }

        if (confirmClicked) {
          await sleep(SWAP_CONFIG.waitAfterConfirm);

          const closeAfterConfirm = findCloseBtn();
          if (closeAfterConfirm) {
            closeAfterConfirm.click();
            UI.logSwap("✅ 关闭成功弹窗");
            await sleep(SWAP_CONFIG.waitAfterClose);
          }

          const btnSwitch = findSwitchBtn();
          if (btnSwitch) {
            btnSwitch.click();
            UI.logSwap("✅ 切换方向");
          }

          const randomWait = getRandomTime(SWAP_CONFIG.waitRandomMin, SWAP_CONFIG.waitRandomMax);
          UI.logSwap(`🎲 随机休息 ${(randomWait / 1000).toFixed(1)} 秒...`);
          await sleep(randomWait);
        } else {
          UI.logSwap("⚠️ Confirm 未成功，短休后重试...");
          await sleep(2000);
        }
      } catch (e) {
        UI.logSwap("❌ 运行出错（已自动继续）");
        console.error(e);
        await sleep(3000);
      }
    }

    window.botRunning = false;
    UI.setSwapRunning(false);
    UI.logSwap("🛑 Bot stopped.");
  }

  function stopSwapLoop() {
    isSwapRunning = false;
    window.botRunning = false;
    UI.setSwapRunning(false);
    UI.logSwap("🛑 stop() called");
  }

  function toggleSwap() {
    if (isSwapRunning) stopSwapLoop();
    else window.startBot();
  }

  // ========= 暴露全域函數 =========
  window.stopBot = () => stopSwapLoop();
  window.startBot = () => {
    if (isSwapRunning) return;
    loopPromise = startSwapLoop();
  };

  // ========= 初始化 =========
  function init() {
    mountUI();
    if (refreshEnabled) scheduleRefresh();
    else UI.renderRefresh();
    UI.logSwap('Loaded. Click Start or press Ctrl+Alt+S.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ============================================================
 * Author: 伍壹51 | Hunter Association
 * X (Twitter): https://x.com/0x515151
 *
 * NOTICE:
 * This script is released publicly.
 * Removing or modifying author attribution is NOT permitted.
 * ============================================================ */
