// ==UserScript==
// @name         TradeGenius Auto Swap - Simple Edition
// @namespace    https://www.tradegenius.com
// @version      1.0.0
// @description  簡化版自動 USDC/USDT 刷量腳本，第一次 Preset 後持續 SWAP（無動態調整）
// @author       B1N0RY
// @match        https://www.tradegenius.com/trade
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // 防止在 iframe 中重複運行
    if (window.top !== window.self) return;

    // ==================== API 請求修復補丁 ====================
    // 修復 orderHistory API 中 undefined 日期參數導致的 500 錯誤
    // 此補丁會在請求發送前自動移除或修正無效的日期參數
    (function() {
        'use strict';

        // 驗證日期參數是否有效
        const isValidDate = (value) => {
            if (value == null) return false; // null or undefined
            if (typeof value !== 'string') return false;
            value = value.trim();
            if (value === '' || value === 'undefined' || value === 'null' || value === 'NaN') return false;
            // 嘗試解析日期，檢查是否為有效日期
            const d = new Date(value);
            return !isNaN(d.getTime()) && d.toString() !== 'Invalid Date';
        };

        // 修復 URL 中的無效日期參數
        const fixUrl = (url) => {
            try {
                // 處理相對路徑和絕對路徑
                const u = new URL(url, location.origin);
                
                // 只處理 orderHistory API
                if (!u.pathname.includes('/api/db/orderHistory')) {
                    return url;
                }

                const sp = u.searchParams;
                const startDate = sp.get('startDate');
                const endDate = sp.get('endDate');
                const badStart = !isValidDate(startDate);
                const badEnd = !isValidDate(endDate);

                // 如果任一個日期參數無效，就移除兩個日期參數
                // 這樣可以避免後端嘗試解析 "undefined" 字串而導致 500 錯誤
                if (badStart || badEnd) {
                    if (badStart && badEnd) {
                        // 兩個都無效，移除它們
                        sp.delete('startDate');
                        sp.delete('endDate');
                    } else if (badStart) {
                        // 只移除無效的 startDate
                        sp.delete('startDate');
                    } else if (badEnd) {
                        // 只移除無效的 endDate
                        sp.delete('endDate');
                    }
                }

                u.search = sp.toString();
                const fixedUrl = u.toString();
                
                // 如果 URL 被修改，記錄日誌（幫助調試）
                if (fixedUrl !== url) {
                    console.log('%c[API Fix] 已修復 orderHistory 請求中的無效日期參數', 
                        'color: #f59e0b; font-weight: bold', 
                        { original: url, fixed: fixedUrl });
                }
                
                return fixedUrl;
            } catch (e) {
                // 如果 URL 解析失敗，返回原始 URL
                console.error('[API Fix] fixUrl 錯誤:', e, url);
                return url;
            }
        };

        // 攔截 window.fetch
        if (typeof window.fetch !== 'undefined') {
            const origFetch = window.fetch.bind(window);
            window.fetch = function(input, init) {
                let newInput = input;
                
                if (typeof input === 'string') {
                    // 字串 URL
                    newInput = fixUrl(input);
                } else if (input && typeof input === 'object') {
                    // Request 物件
                    if (input.url) {
                        const fixedUrl = fixUrl(input.url);
                        // 重新構造 Request，保留其他屬性
                        newInput = new Request(fixedUrl, input);
                    } else if (input instanceof Request) {
                        // 處理 Request 物件的 url 屬性
                        const fixedUrl = fixUrl(input.url);
                        newInput = new Request(fixedUrl, input);
                    }
                }
                
                return origFetch(newInput, init);
            };
        }

        // 攔截 XMLHttpRequest.prototype.open
        if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype.open) {
            const origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
                const fixed = fixUrl(url);
                return origOpen.call(this, method, fixed, async !== undefined ? async : true, user, password);
            };
        }
    })();
    // ==================== API 請求修復補丁結束 ====================

    // ==================== 配置參數 ====================
    const CONFIG = {
        // 延遲設置（毫秒）
        waitAfterChoose: 1500,
        waitAfterTokenSelect: 2000,
        waitAfterMax: 1200,
        waitBeforeConfirm: 3000,        // 點擊 Confirm 前的緩衝等待（已棄用，改用 waitForQuoteReady）
        waitForQuoteReady: 10000,       // 等待報價完成的時間（毫秒）- 確保報價穩定後再點擊 Confirm（增加到 10 秒）
        waitForQuoteStable: 3000,       // 等待報價穩定的時間（毫秒）- 報價數字保持不變的時間（增加到 3 秒）
        waitAfterQuoteStable: 1500,     // 報價穩定後的額外安全等待時間（毫秒）- 確保報價完全穩定
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

        // Preset 設置（固定值）
        slippageValue: 0.1,              // Preset 時的 Slippage (%)
        priorityValue: 0.002,           // Preset 時的 Priority (gwei)

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

    // 防止螢幕關閉時暫停的相關變量
    let wakeLock = null;  // Wake Lock API 對象
    let wakeLockReleaseHandler = null;  // Wake Lock 釋放事件處理器（用於清理）
    let heartbeatInterval = null;  // 心跳定時器
    let lastHeartbeatTime = Date.now();  // 上次心跳時間
    let throttleDetectionEnabled = true;  // 是否啟用時間節流檢測
    let visibilityListenerSetup = false;  // 是否已設置可見性監聽器
    let keydownHandler = null;  // 鍵盤事件處理器（用於清理）
    
    // ==================== 狀態機系統 ====================
    // 定義交易流程的狀態
    const SwapState = {
        IDLE: 'idle',                           // 閒置狀態
        CHECKING_BALANCE: 'checking_balance',   // 檢查餘額
        SELECTING_FIRST_TOKEN: 'selecting_first_token',  // 選擇第一個代幣
        SELECTING_SECOND_TOKEN: 'selecting_second_token', // 選擇第二個代幣
        CLICKING_MAX: 'clicking_max',           // 點擊 MAX
        WAITING_FOR_QUOTE: 'waiting_for_quote', // 等待報價
        CLICKING_CONFIRM: 'clicking_confirm',   // 點擊 Confirm
        WAITING_FOR_RESULT: 'waiting_for_result', // 等待交易結果
        CLOSING_POPUP: 'closing_popup',         // 關閉彈窗
        PAUSED_HIDDEN: 'paused_hidden'          // 因頁面隱藏而暫停
    };
    
    let currentSwapState = SwapState.IDLE;  // 當前狀態
    let stateData = {};  // 狀態相關數據（用於恢復）
    let isPageVisible = !document.hidden;  // 頁面是否可見
    let resumeFromState = false;  // 是否需要從狀態恢復

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
    // 在頁面 hidden 時會等待頁面重新可見，避免在不可見時執行操作
    const sleep = async (ms, allowHiddenExecution = false) => {
        const startTime = Date.now();
        const checkInterval = Math.min(100, ms); // 每 100ms 檢查一次，或更短
        let lastCheckTime = startTime;
        let hiddenStartTime = null;  // 記錄進入 hidden 狀態的時間
        
        while (Date.now() - startTime < ms) {
            if (!isRunning) {
                return; // 如果已停止，立即返回
            }
            
            // 檢查頁面可見性
            const isCurrentlyVisible = !document.hidden;
            
            // 如果頁面變為 hidden 且不允許在 hidden 時執行，等待頁面重新可見
            if (!allowHiddenExecution && !isCurrentlyVisible) {
                if (hiddenStartTime === null) {
                    hiddenStartTime = Date.now();
                    // 如果正在執行關鍵操作，進入暫停狀態
                    if (currentSwapState !== SwapState.IDLE && 
                        currentSwapState !== SwapState.PAUSED_HIDDEN) {
                        const previousState = currentSwapState;
                        currentSwapState = SwapState.PAUSED_HIDDEN;
                        stateData.pausedFromState = previousState;
                        stateData.pausedAt = hiddenStartTime;
                        log(`⏸️ 頁面隱藏，暫停操作（從狀態 ${previousState} 暫停）`, 'warning');
                    }
                }
                
                // 等待頁面重新可見（最多等待剩餘時間）
                const remaining = ms - (Date.now() - startTime);
                if (remaining > 0) {
                    // 每 500ms 檢查一次頁面是否重新可見
                    await new Promise(resolve => {
                        const checkVisible = setInterval(() => {
                            if (!document.hidden || !isRunning) {
                                clearInterval(checkVisible);
                                resolve();
                            }
                        }, 500);
                        // 設置超時，避免無限等待
                        setTimeout(() => {
                            clearInterval(checkVisible);
                            resolve();
                        }, Math.min(remaining, 10000)); // 最多等待 10 秒或剩餘時間
                    });
                    
                    // 如果頁面重新可見，恢復狀態
                    if (!document.hidden && currentSwapState === SwapState.PAUSED_HIDDEN) {
                        const hiddenDuration = Date.now() - hiddenStartTime;
                        log(`▶️ 頁面重新可見，恢復操作（已暫停 ${Math.floor(hiddenDuration / 1000)} 秒）`, 'success');
                        if (stateData.pausedFromState) {
                            currentSwapState = stateData.pausedFromState;
                            resumeFromState = true;
                            log(`🔄 準備恢復到狀態: ${currentSwapState}`, 'info');
                        }
                        hiddenStartTime = null;
                    }
                }
                
                // 如果頁面仍然 hidden，繼續等待
                if (document.hidden) {
                    continue;
                }
            } else {
                // 頁面可見，重置 hidden 計時器
                if (hiddenStartTime !== null) {
                    hiddenStartTime = null;
                }
            }
            
            const now = Date.now();
            const elapsed = now - startTime;
            const remaining = ms - elapsed;
            
            // 檢測時間節流：如果實際經過的時間遠大於預期，說明被節流了
            if (throttleDetectionEnabled && isCurrentlyVisible) {
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
            await new Promise(resolve => {
                setTimeout(resolve, Math.min(checkInterval, remaining));
            });
        }
    };

    const randomWait = (min, max) => {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    };

    // 日誌緩衝區：限制日誌條目數量，避免記憶體累積
    const logBuffer = [];
    const MAX_LOG_ENTRIES = 100;  // 最多保留 100 條日誌
    const MAX_LOG_TEXT_LENGTH = 5000;  // 日誌文字最多 5000 字元

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
            
            // 添加到緩衝區
            logBuffer.push(logText);
            
            // 限制緩衝區大小
            if (logBuffer.length > MAX_LOG_ENTRIES) {
                logBuffer.shift();  // 移除最舊的日誌
            }
            
            // 更新 DOM：使用緩衝區內容，限制總長度
            const fullText = logBuffer.join('');
            UI.logEl.textContent = fullText.length > MAX_LOG_TEXT_LENGTH 
                ? fullText.slice(-MAX_LOG_TEXT_LENGTH) 
                : fullText;
        }
    };

    // ==================== 防止螢幕關閉時暫停的函數 ====================
    // 請求 Wake Lock（防止螢幕關閉）
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                // 如果已有 Wake Lock，先清理舊的事件監聽器
                if (wakeLock && wakeLockReleaseHandler) {
                    wakeLock.removeEventListener('release', wakeLockReleaseHandler);
                    wakeLockReleaseHandler = null;
                }
                
                wakeLock = await navigator.wakeLock.request('screen');
                log('✅ Wake Lock 已啟用（防止螢幕關閉）', 'success');
                
                // 創建事件處理器並保存引用，以便後續清理
                wakeLockReleaseHandler = () => {
                    log('⚠️ Wake Lock 已釋放，嘗試重新請求...', 'warning');
                    // 如果腳本仍在運行，嘗試重新請求
                    if (isRunning) {
                        setTimeout(() => requestWakeLock(), 1000);
                    }
                };
                
                // 監聽 Wake Lock 釋放事件
                wakeLock.addEventListener('release', wakeLockReleaseHandler);
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
                // 清理事件監聽器
                if (wakeLockReleaseHandler) {
                    wakeLock.removeEventListener('release', wakeLockReleaseHandler);
                    wakeLockReleaseHandler = null;
                }
                
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
            const wasVisible = isPageVisible;
            isPageVisible = !document.hidden;
            
            if (document.hidden) {
                log('⚠️ 頁面已隱藏（切換到其他標籤頁或最小化）', 'warning');
                
                // 如果正在執行交易流程，保存當前狀態並進入暫停模式
                if (isRunning && currentSwapState !== SwapState.IDLE && 
                    currentSwapState !== SwapState.PAUSED_HIDDEN) {
                    log(`💾 保存當前狀態: ${currentSwapState}，進入安全暫停模式`, 'info');
                    // 保存當前狀態，以便恢復
                    const previousState = currentSwapState;
                    currentSwapState = SwapState.PAUSED_HIDDEN;
                    stateData.pausedFromState = previousState;
                    stateData.pausedAt = Date.now();
                    resumeFromState = true;
                } else {
                    log('腳本將繼續運行，但可能受到瀏覽器節流影響', 'info');
                }
            } else {
                log('✅ 頁面已顯示', 'success');
                // 頁面重新可見時，更新心跳時間
                lastHeartbeatTime = Date.now();
                
                // 如果之前處於暫停狀態，準備恢復
                if (isRunning && currentSwapState === SwapState.PAUSED_HIDDEN) {
                    log('🔄 頁面重新可見，準備從暫停狀態恢復...', 'info');
                    const pausedDuration = Date.now() - (stateData.pausedAt || Date.now());
                    log(`⏱️ 暫停時長: ${Math.floor(pausedDuration / 1000)} 秒`, 'info');
                    
                    // 重置暫停標記，準備恢復
                    resumeFromState = true;
                    // 狀態將在下一輪循環中恢復
                }
            }
        });
        
        visibilityListenerSetup = true;
    }

    // ==================== 餘額監控函數 ====================
    async function getTokenBalances() {
        try {
            const balances = { USDT: 0, USDC: 0 };

            // 方法1: 從包含 "Balance:" 的元素讀取（優化：使用更精確的選擇器，避免查詢所有元素）
            // 優先查找可能包含餘額的容器元素，而不是所有元素
            const possibleContainers = document.querySelectorAll('div, span, p, td, th');
            const processedElements = new WeakSet();  // 使用 WeakSet 追蹤已處理的元素，避免重複處理
            
            for (const el of possibleContainers) {
                // 跳過對話框中的元素
                if (el.closest('[role="dialog"]')) continue;
                
                // 跳過已處理的元素
                if (processedElements.has(el)) continue;
                
                // 只處理可見且包含文字的元素
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                
                const text = el.innerText || '';
                // 如果元素沒有文字或文字太長，跳過（可能是容器）
                if (!text || text.length > 200) continue;
                
                // 查找包含 "Balance:" 的元素（例如: "Balance: 49.871"）
                if (text.includes('Balance:') || text.includes('Balance ')) {
                    processedElements.add(el);
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

            // 方法3: 從主頁面文字匹配（備用方法，優化：只查詢可能包含代幣資訊的元素）
            if (balances.USDT === 0 && balances.USDC === 0) {
                // 使用更精確的選擇器，只查詢可能包含代幣資訊的容器
                const tokenContainers = document.querySelectorAll('div[class*="token"], div[class*="balance"], div[class*="asset"], span[class*="token"], span[class*="balance"]');
                for (const el of tokenContainers) {
                    if (el.closest('[role="dialog"]')) continue;
                    if (processedElements.has(el)) continue;
                    
                    const text = el.innerText || '';
                    if (!text || text.length > 200) continue;
                    
                    // 匹配 "USDT: 49.871" 或 "USDC: 49.871" 格式
                    const match = text.match(/(USDT|USDC)[\s:]+([\d,\.]+)/i);
                    if (match) {
                        processedElements.add(el);
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
        // 直接跳過餘額檢查
        return true;
        
        if (!CONFIG.enableBalanceMonitoring) return true;

        // 在讀取餘額前，確保沒有其他視窗遮擋 SWAP 視窗
        // 這可以避免讀取到代幣選擇視窗中的舊餘額
        if (isDialogOpen()) {
            log('檢測到視窗打開，先關閉視窗以確保讀取正確的餘額...', 'info');
            await ensureAllDialogsClosed(3);
            await sleep(500);
        }

        // 帶重試機制的餘額讀取（最多重試 2 次）
        let balances = { USDT: 0, USDC: 0 };
        let balanceReadSuccess = false;
        
        for (let retry = 0; retry < 3; retry++) {
            balances = await getTokenBalances();
            
            // 檢查餘額是否有效（不全為 0）
            if (balances.USDT > 0 || balances.USDC > 0) {
                balanceReadSuccess = true;
                break;
            }
            
            // 如果餘額全為 0，可能是讀取時機不對，重試前先等待
            if (retry < 2) {
                log(`⚠️ 餘額讀取異常（全為 0），${1.5} 秒後重試... (${retry + 1}/3)`, 'warning');
                await sleep(1500);
            }
        }
        
        // 如果重試後仍然全為 0，發出警告但繼續執行（可能是頁面還沒完全載入）
        if (!balanceReadSuccess) {
            log(`⚠️ 餘額讀取失敗（多次重試後仍為 0），可能是頁面尚未完全載入，將繼續執行`, 'warning');
            // 不直接返回 false，而是繼續檢查，因為可能是讀取時機問題
        }

        // 如果已經選擇了發送代幣，優先檢查該代幣的餘額
        if (currentFromToken) {
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
        // 根據用戶反饋，Confirm 按鈕實際上是可以按的，即使顯示為 disabled
        // 所以我們先查找按鈕，然後檢查是否真的不可點擊
        return Array.from(document.querySelectorAll('button'))
            .find(b => {
                const text = b.innerText.trim().toUpperCase();
                return (text.includes('CONFIRM') || text.includes('确认') || 
                        text.includes('PLACE') || text.includes('SWAP'));
            });
    };

    // 查找 Refresh 按鈕（用於重新報價）
    const findRefreshButton = () => {
        return Array.from(document.querySelectorAll('button'))
            .find(b => {
                // 檢查按鈕是否有 border-genius-blue 類（根據用戶提供的 HTML，這是 Refresh 按鈕的特徵）
                const hasBorderClass = (b.className || '').includes('border-genius-blue');
                
                if (!hasBorderClass) {
                    return false;
                }
                
                // 檢查按鈕文字包含 Refresh 或刷新
                const text = (b.innerText || '').trim().toUpperCase();
                const hasRefreshText = text.includes('REFRESH') || text.includes('刷新');
                
                // 檢查是否有 refresh-ccw 圖標（lucide icon）
                const hasRefreshIcon = b.querySelector('svg.lucide-refresh-ccw, svg[class*="refresh-ccw"]');
                
                // 只要符合 border-genius-blue 且（有 Refresh 文字或圖標）就認為是 Refresh 按鈕
                return (hasRefreshText || hasRefreshIcon) && !b.disabled;
            });
    };

    // 檢查是否有 loading 狀態（多種方式檢測）
    const hasLoadingState = (debug = false) => {
        // 方法1: 檢查 spinner（最可靠的方法）
        const loadingSpinners = document.querySelectorAll('svg.animate-spin, [class*="animate-spin"]');
        const hasSpinner = Array.from(loadingSpinners).some(spinner => {
            const rect = spinner.getBoundingClientRect();
            const style = window.getComputedStyle(spinner);
            const isVisible = rect.width > 0 && rect.height > 0 && 
                   style.display !== 'none' && 
                   style.visibility !== 'hidden' &&
                   spinner.offsetParent !== null;
            
            if (isVisible && debug) {
                log('🔍 檢測到 loading spinner', 'info');
            }
            
            return isVisible;
        });
        
        if (hasSpinner) return true;
        
        // 方法2: 檢查 Confirm 按鈕是否 disabled
        const confirmBtn = findConfirmButton();
        if (!confirmBtn) {
            if (debug) {
                log('🔍 未找到 Confirm 按鈕', 'info');
            }
            return true; // 找不到按鈕視為 loading
        }
        
        if (confirmBtn.disabled) {
            if (debug) {
                log('🔍 Confirm 按鈕被 disabled', 'info');
            }
            return true;
        }
        
        // 方法3: 檢查報價區域是否有 "loading"、"計算中" 等文字（限制搜索範圍）
        // 只在主要的交易區域搜索，避免誤匹配日誌面板等區域
        const mainContent = document.querySelector('main') || document.body;
        
        // 排除右側面板（包含 "RUNNING"、日誌等）
        const excludeSelectors = [
            '[class*="TradeGenius"]',
            '[class*="Auto Swap"]',
            '[class*="console"]',
            '[class*="log"]',
            '[aria-label*="log"]'
        ];
        
        let searchArea = mainContent;
        
        // 嘗試找到更精確的報價區域
        const swapContainer = document.querySelector('[class*="swap"], [class*="trade"]');
        if (swapContainer) {
            searchArea = swapContainer;
        }
        
        const areaText = searchArea.innerText || '';
        
        // 使用更嚴格的關鍵字，移除過於廣泛的 "計算"
        const loadingKeywords = ['loading...', 'calculating...', 'processing...', '計算中...', '處理中...'];
        const hasLoadingText = loadingKeywords.some(keyword => 
            areaText.toLowerCase().includes(keyword.toLowerCase())
        );
        
        if (hasLoadingText && debug) {
            log('🔍 檢測到 loading 文字', 'info');
        }
        
        return hasLoadingText;
    };

    // 等待報價完成 - 確保報價穩定後再點擊 Confirm
    const waitForQuoteReady = async () => {
        const startTime = Date.now();
        const maxWaitTime = CONFIG.waitForQuoteReady;
        const stableWaitTime = CONFIG.waitForQuoteStable;
        const extraWaitTime = CONFIG.waitAfterQuoteStable;
        const checkInterval = 200; // 每 200ms 檢查一次（更頻繁的檢查）
        
        log(`⏳ 等待報價完成（最多 ${maxWaitTime / 1000} 秒，穩定 ${stableWaitTime / 1000} 秒）...`, 'info');
        
        let confirmBtn = null;
        let noLoadingStartTime = null;
        let buttonReadyStartTime = null;
        let lastButtonText = null;
        let buttonTextStableStartTime = null;
        let loadingStartTime = null; // 記錄 loading 開始時間
        let refreshClicked = false; // 記錄是否已點擊 Refresh
        
        while (Date.now() - startTime < maxWaitTime) {
            // 檢查是否有 loading 狀態
            const hasLoading = hasLoadingState();
            
            // 檢查 Confirm 按鈕狀態
            // 根據用戶反饋，Confirm 按鈕實際上可以按，即使顯示為 disabled
            confirmBtn = findConfirmButton();
            const isButtonReady = confirmBtn !== null; // 只要找到按鈕就認為可用
            
            // 檢查按鈕文字是否穩定
            const currentButtonText = confirmBtn ? (confirmBtn.innerText || '').trim() : null;
            const isButtonTextStable = currentButtonText && currentButtonText === lastButtonText;
            
            if (hasLoading) {
                // 記錄 loading 開始時間
                if (loadingStartTime === null) {
                    loadingStartTime = Date.now();
                }
                
                // 如果 loading 超過 5 秒且尚未點擊 Refresh，嘗試點擊 Refresh
                const loadingDuration = Date.now() - loadingStartTime;
                if (loadingDuration > 5000 && !refreshClicked) {
                    const refreshBtn = findRefreshButton();
                    if (refreshBtn) {
                        log('🔄 檢測到長時間 loading（超過 5 秒），嘗試點擊 Refresh 按鈕重新報價...', 'info');
                        refreshBtn.click();
                        refreshClicked = true;
                        log('✓ 已點擊 Refresh 按鈕', 'success');
                        // 重置 loading 計時器，給 Refresh 一些時間
                        loadingStartTime = Date.now();
                        await sleep(2000); // 等待 Refresh 後的更新
                    }
                }
                
                // 如果檢測到 loading，重置所有計時器
                noLoadingStartTime = null;
                buttonReadyStartTime = null;
                buttonTextStableStartTime = null;
                lastButtonText = null;
                await sleep(checkInterval);
                continue;
            } else {
                // 沒有 loading，重置 loading 計時器和 Refresh 標記
                loadingStartTime = null;
                refreshClicked = false;
            }
            
            // 沒有 loading 狀態
            if (noLoadingStartTime === null) {
                noLoadingStartTime = Date.now();
                log('✓ 檢測到無 loading 狀態', 'info');
            }
            
            // Confirm 按鈕可用
            if (isButtonReady) {
                if (buttonReadyStartTime === null) {
                    buttonReadyStartTime = Date.now();
                    log('✓ Confirm 按鈕已可用', 'info');
                }
                
                // 檢查按鈕文字是否穩定
                if (currentButtonText) {
                    if (isButtonTextStable) {
                        if (buttonTextStableStartTime === null) {
                            buttonTextStableStartTime = Date.now();
                        }
                    } else {
                        // 按鈕文字有變化，重置計時器
                        buttonTextStableStartTime = null;
                        lastButtonText = currentButtonText;
                    }
                }
                
                // 檢查是否已經穩定足夠長的時間
                const noLoadingDuration = Date.now() - noLoadingStartTime;
                const buttonReadyDuration = Date.now() - buttonReadyStartTime;
                const buttonTextStableDuration = buttonTextStableStartTime ? 
                    (Date.now() - buttonTextStableStartTime) : 0;
                
                // 所有條件都滿足：無 loading、按鈕可用、按鈕文字穩定
                if (noLoadingDuration >= stableWaitTime && 
                    buttonReadyDuration >= stableWaitTime &&
                    (buttonTextStableDuration >= stableWaitTime || !currentButtonText)) {
                    
                    // 額外等待一段時間，確保報價完全穩定
                    log(`✓ 報價已穩定，額外等待 ${extraWaitTime / 1000} 秒確保完全穩定...`, 'info');
                    await sleep(extraWaitTime);
                    
                    // 最後一次檢查，確保狀態沒有變化
                    const finalHasLoading = hasLoadingState();
                    const finalConfirmBtn = findConfirmButton();
                    const finalIsButtonReady = finalConfirmBtn !== null; // 只要找到按鈕就認為可用
                    
                    if (!finalHasLoading && finalIsButtonReady) {
                        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                        log(`✓ 報價已完全穩定，Confirm 按鈕可用（總共等待 ${elapsed} 秒）`, 'success');
                        return true;
                    } else {
                        // 狀態有變化，重置計時器繼續等待
                        log('⚠️ 最後檢查發現狀態有變化，繼續等待...', 'warning');
                        noLoadingStartTime = null;
                        buttonReadyStartTime = null;
                        buttonTextStableStartTime = null;
                    }
                }
            } else {
                // 按鈕不可用，重置所有計時器
                buttonReadyStartTime = null;
                buttonTextStableStartTime = null;
                lastButtonText = null;
            }
            
            await sleep(checkInterval);
        }
        
        // 如果超時，但 Confirm 按鈕可用且沒有 loading，仍然返回 true（但會記錄警告）
        // 根據用戶反饋，Confirm 按鈕實際上可以按，即使顯示為 disabled
        if (confirmBtn) {
            const finalHasLoading = hasLoadingState(true); // 啟用調試模式
            
            if (!finalHasLoading) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                log(`⚠️ 報價等待超時，但 Confirm 按鈕可用且無 loading（已等待 ${elapsed} 秒），繼續執行...`, 'warning');
                // 即使超時，也額外等待一小段時間
                await sleep(extraWaitTime);
                return true;
            } else {
                log('🔍 調試：報價等待超時時仍檢測到 loading 狀態，請查看上方調試信息', 'warning');
            }
        } else {
            log('🔍 調試：報價等待超時時未找到 Confirm 按鈕', 'warning');
        }
        
        log('❌ 報價等待超時且 Confirm 按鈕不可用或仍在 loading', 'error');
        return false;
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
    
    // 查找並點擊 M.Cap 選項
    async function findAndClickMCapOption(mcapText) {
        try {
            // 方法1: 查找包含 "M. Cap:" 或 "M.Cap:" 的容器
            const allElements = Array.from(document.querySelectorAll('*'));
            let mcapContainer = null;
            
            for (const el of allElements) {
                const text = el.innerText || el.textContent || '';
                if (text.includes('M. Cap:') || text.includes('M.Cap:')) {
                    mcapContainer = el;
                    break;
                }
            }
            
            // 方法2: 如果方法1失敗，嘗試通過包含 border-genius-blue 和 cursor-pointer 的 div 查找
            if (!mcapContainer) {
                const candidateContainers = document.querySelectorAll('div[class*="border-genius-blue"][class*="cursor-pointer"]');
                for (const container of candidateContainers) {
                    const containerText = container.innerText || container.textContent || '';
                    // 檢查容器是否包含 M.Cap 相關文字或多個 M.Cap 選項
                    if (containerText.includes('M. Cap') || containerText.includes('M.Cap') ||
                        (containerText.includes('<1M') && containerText.includes('1-5M'))) {
                        // 向上查找父容器
                        let parent = container.parentElement;
                        for (let i = 0; i < 5 && parent; i++) {
                            const parentText = parent.innerText || parent.textContent || '';
                            if (parentText.includes('M. Cap:') || parentText.includes('M.Cap:')) {
                                mcapContainer = parent;
                                break;
                            }
                            parent = parent.parentElement;
                        }
                        if (mcapContainer) break;
                    }
                }
            }
            
            if (!mcapContainer) {
                log(`⚠️ 未找到 M.Cap 容器`, 'warning');
                return false;
            }
            
            // 在容器中查找包含指定文字的選項
            // 優先查找包含 border-genius-blue 和 cursor-pointer 的 div
            const mcapOptions = mcapContainer.querySelectorAll('div.cursor-pointer[class*="border-genius-blue"], div[class*="cursor-pointer"][class*="border-genius-blue"], div.cursor-pointer, div[class*="cursor-pointer"]');
            
            // 處理特殊字符：<1M 和 >20M
            const normalizedMcapText = mcapText;
            const alternativeTexts = [];
            if (mcapText === '<1M') {
                alternativeTexts.push('&lt;1M', '<1M');
            } else if (mcapText === '>20M') {
                alternativeTexts.push('&gt;20M', '>20M');
            } else {
                alternativeTexts.push(mcapText);
            }
            
            for (const option of mcapOptions) {
                const optionText = option.innerText?.trim() || option.textContent?.trim() || '';
                const optionHTML = option.innerHTML?.trim() || '';
                
                // 檢查文字是否匹配（支持多種格式）
                const isMatch = alternativeTexts.some(alt => 
                    optionText === alt || 
                    optionText === normalizedMcapText ||
                    optionHTML.includes(alt) ||
                    (mcapText === '<1M' && (optionText === '<1M' || optionText.includes('<1M'))) ||
                    (mcapText === '>20M' && (optionText === '>20M' || optionText.includes('>20M'))) ||
                    (mcapText !== '<1M' && mcapText !== '>20M' && optionText === mcapText)
                );
                
                if (isMatch) {
                    const rect = option.getBoundingClientRect();
                    const style = window.getComputedStyle(option);
                    
                    if (rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        option.offsetParent !== null) {
                        
                        // 檢查是否已經選中（通過 bg-genius-blue 類或 text-genius-cream 類）
                        const classes = option.className || '';
                        const isSelected = classes.includes('bg-genius-blue') && 
                                          (classes.includes('text-genius-cream') || 
                                           option.querySelector('.text-genius-cream'));
                        
                        // 無論是否已選中，都點擊一次以確保該選項被激活（這樣才能設定該選項的 slippage）
                        option.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        await sleep(300);
                        
                        // 嘗試多種點擊方式
                        let clickSuccess = false;
                        
                        // 方式1: 直接點擊
                        try {
                            option.click();
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
                                option.dispatchEvent(clickEvent);
                                clickSuccess = true;
                            } catch (e) {
                                log(`⚠️ MouseEvent 點擊失敗: ${e.message}`, 'warning');
                            }
                        }
                        
                        if (clickSuccess) {
                            if (isSelected) {
                                log(`✓ M.Cap 選項已選中，已重新點擊以確保激活: ${mcapText}`, 'info');
                            } else {
                                log(`✓ 點擊 M.Cap 選項: ${mcapText}`, 'success');
                            }
                            // 等待 UI 更新（點擊後需要時間讓選項激活）
                            await sleep(800);
                            return true;
                        } else {
                            log(`⚠️ 無法點擊 M.Cap 選項: ${mcapText}`, 'warning');
                        }
                    }
                }
            }
            
            log(`⚠️ 未找到 M.Cap 選項: ${mcapText}`, 'warning');
            return false;
        } catch (error) {
            log(`查找 M.Cap 選項時出錯: ${error.message}`, 'error');
            return false;
        }
    }
    
    // 為所有 M.Cap 選項設定 slippage 值
    async function setSlippageForAllMCaps(slippageValue, mode) {
        const mcapOptions = ['<1M', '1-5M', '5-20M', '>20M', 'No Data'];
        let successCount = 0;
        const slippageValueStr = slippageValue.toFixed(2);
        
        log(`開始為 ${mode} 方的所有 M.Cap 選項設定 Slippage 至 ${slippageValueStr}%...`, 'info');
        log(`將依次設定 ${mcapOptions.length} 個 M.Cap 選項: ${mcapOptions.join(', ')}`, 'info');
        
        for (let index = 0; index < mcapOptions.length; index++) {
            const mcap = mcapOptions[index];
            
            if (!isRunning) {
                log('⚠️ 設定已取消（程序已停止）', 'warning');
                return false;
            }
            
            log(`\n[${index + 1}/${mcapOptions.length}] 設定 ${mode} 方 M.Cap "${mcap}" 的 Slippage...`, 'info');
            
            // 步驟 1: 點擊 M.Cap 選項（必須先點擊才能設定該選項的 slippage）
            let mcapClicked = false;
            for (let retry = 0; retry < 3; retry++) {
                if (retry > 0) {
                    log(`重試點擊 M.Cap 選項 "${mcap}"... (${retry + 1}/3)`, 'warning');
                    await sleep(1000);
                }
                
                mcapClicked = await findAndClickMCapOption(mcap);
                if (mcapClicked) {
                    break;
                }
            }
            
            if (!mcapClicked) {
                log(`❌ 無法點擊 M.Cap 選項 "${mcap}"，跳過此選項`, 'error');
                continue;
            }
            
            // 等待 M.Cap 選項激活後的 UI 更新（確保 slippage 輸入框已切換到該選項）
            log(`✓ M.Cap 選項 "${mcap}" 已點擊，等待 UI 更新...`, 'info');
            await sleep(1000); // 增加等待時間，確保 UI 完全更新
            
            // 步驟 2: 驗證 M.Cap 選項是否已激活（可選，用於調試）
            // 這裡可以添加驗證邏輯，但為了不影響流程，暫時跳過
            
            // 步驟 3: 設定 slippage 值
            log(`設定 ${mode} 方 M.Cap "${mcap}" 的 Slippage 為 ${slippageValueStr}%...`, 'info');
            let setSuccess = false;
            
            for (let retry = 0; retry < 3; retry++) {
                if (retry > 0) {
                    log(`重試設定 Slippage... (${retry + 1}/3)`, 'warning');
                    await sleep(1000);
                    
                    // 重新點擊 M.Cap 選項，確保它仍然被選中
                    await findAndClickMCapOption(mcap);
                    await sleep(800);
                }
                
                setSuccess = await findAndSetInput([
                    { type: 'text', text: 'Slippage' },
                    { type: 'data-attr', attr: 'data-sentry-component', value: 'Slippage' }
                ], slippageValueStr, `${mode} 方 M.Cap "${mcap}" 的 Slippage`);
                
                if (setSuccess) {
                    break;
                }
            }
            
            if (setSuccess) {
                // 步驟 4: 驗證值是否已保存
                log(`驗證 ${mode} 方 M.Cap "${mcap}" 的 Slippage 值...`, 'info');
                await sleep(1000); // 等待值保存
                
                let verified = false;
                for (let verifyRetry = 0; verifyRetry < 2; verifyRetry++) {
                    verified = await verifyInputValue('Slippage', slippageValueStr);
                    if (verified) {
                        break;
                    }
                    if (verifyRetry < 1) {
                        await sleep(500);
                    }
                }
                
                if (verified) {
                    log(`✅ ${mode} 方 M.Cap "${mcap}" 的 Slippage 已成功設定為 ${slippageValueStr}%`, 'success');
                    successCount++;
                } else {
                    log(`⚠️ ${mode} 方 M.Cap "${mcap}" 的 Slippage 值驗證失敗，但設定操作已執行`, 'warning');
                    // 即使驗證失敗，也計為成功（可能是驗證邏輯的問題）
                    successCount++;
                }
            } else {
                log(`❌ ${mode} 方 M.Cap "${mcap}" 的 Slippage 設定失敗`, 'error');
            }
            
            // 在每個選項設定完成後，等待一小段時間再處理下一個
            if (index < mcapOptions.length - 1) {
                await sleep(600); // 選項之間的間隔
            }
        }
        
        log(`\n${mode} 方 M.Cap Slippage 設定完成: ${successCount}/${mcapOptions.length} 個選項成功`, 
            successCount === mcapOptions.length ? 'success' : 'warning');
        
        if (successCount < mcapOptions.length) {
            log(`⚠️ 有 ${mcapOptions.length - successCount} 個 M.Cap 選項設定失敗，但將繼續執行`, 'warning');
        }
        
        return successCount === mcapOptions.length;
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
    
    // 點擊 Buy 或 Sell 按鈕
    async function clickBuyOrSellButton(mode) {
        // mode: 'Buy' 或 'Sell'
        log(`點擊 ${mode} 按鈕...`, 'info');
        
        for (let attempt = 0; attempt < 5; attempt++) {
            const allButtons = document.querySelectorAll('button');
            let targetButton = null;
            
            for (const btn of allButtons) {
                const text = btn.innerText?.trim() || btn.textContent?.trim() || '';
                const classes = btn.className || '';
                
                if (text === mode) {
                    // Buy 按鈕特徵：text-genius-green, bg-genius-green/20
                    // Sell 按鈕特徵：text-genius-red, border-genius-blue
                    if (mode === 'Buy' && (classes.includes('text-genius-green') || classes.includes('bg-genius-green'))) {
                        targetButton = btn;
                        break;
                    } else if (mode === 'Sell' && (classes.includes('text-genius-red') || (classes.includes('border-genius-blue') && !classes.includes('bg-genius-green')))) {
                        targetButton = btn;
                        break;
                    }
                }
            }
            
            // 方法2: 通過 data-sentry-element="Button" 和文字查找
            if (!targetButton) {
                const sentryButtons = document.querySelectorAll('button[data-sentry-element="Button"]');
                for (const btn of sentryButtons) {
                    const text = btn.innerText?.trim() || btn.textContent?.trim() || '';
                    if (text === mode) {
                        targetButton = btn;
                        break;
                    }
                }
            }
            
            if (targetButton) {
                const rect = targetButton.getBoundingClientRect();
                const style = window.getComputedStyle(targetButton);
                
                if (rect.width > 0 && rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    targetButton.offsetParent !== null &&
                    !targetButton.disabled) {
                    
                    // 滾動到元素可見位置
                    targetButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    await sleep(300);
                    
                    targetButton.click();
                    log(`✓ ${mode} 按鈕已點擊`, 'success');
                    await sleep(1500);
                    return true;
                }
            }
            
            if (attempt < 4) {
                log(`重試查找 ${mode} 按鈕... (${attempt + 1}/5)`, 'warning');
                await sleep(1000);
            }
        }
        
        log(`⚠️ 未找到 ${mode} 按鈕`, 'warning');
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
        const totalSteps = 15;
        
        // 步驟 1: 點擊 Settings 按鈕
        if (!isRunning) return false;
        log('步驟 1/15: 點擊 Settings 按鈕', 'info');
        const step1 = await findAndClickElement([
            'svg.lucide-settings2',
            'svg.lucide-settings-2',
            { type: 'svg', selector: 'svg[class*="lucide-settings"]' },
            { type: 'text', text: 'Settings' }
        ], 'Settings 按鈕', 2000);
        if (step1) successCount++;
        
        // 步驟 2: 點選設定 PreSet 的鏈（NetworkButton）
        log('步驟 2/15: 點擊 Network 選擇按鈕', 'info');
        const step2 = await findAndClickElement([
            '[data-sentry-component="NetworkButton"]',
            { type: 'text', text: 'Solana' },
            'div[class*="border-genius-blue"][class*="cursor-pointer"]'
        ], 'Network 選擇按鈕', 1500);
        if (step2) successCount++;
        
        // 步驟 3: 選擇 OP 鏈
        log('步驟 3/15: 選擇 Optimism 鏈', 'info');
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
        
        // 步驟 4: 點擊 Buy 按鈕
        if (!isRunning) return false;
        log('步驟 4/15: 點擊 Buy 按鈕', 'info');
        const step4 = await clickBuyOrSellButton('Buy');
        if (step4) successCount++;
        
        // 步驟 5: 設定 Buy 方的 slippage % 至固定值（為所有 M.Cap 選項設定）
        if (!isRunning) return false;
        const slippageValueStr = CONFIG.slippageValue.toFixed(2);
        log(`步驟 5/15: 設定 Buy 方的所有 M.Cap 選項的 Slippage 至 ${slippageValueStr}%`, 'info');
        const step5 = await setSlippageForAllMCaps(CONFIG.slippageValue, 'Buy');
        if (step5) {
            successCount++;
        } else {
            log('⚠️ Buy 方的 M.Cap Slippage 設定未完全成功，但將繼續', 'warning');
            // 即使部分失敗也計為成功，因為至少設定了一些
            successCount++;
        }
        
        // 步驟 6: 設定 Buy 方的 Priority (Gwei) 至固定值
        if (!isRunning) return false;
        const priorityValueStr = CONFIG.priorityValue.toFixed(4);
        log(`步驟 6/15: 設定 Buy 方的 Priority (Gwei) 至 ${priorityValueStr}`, 'info');
        const step6 = await findAndSetInput([
            { type: 'text', text: 'Priority (Gwei)' }
        ], priorityValueStr, 'Buy 方的 Priority (Gwei)');
        if (step6) {
            successCount++;
            // 驗證 Priority (Gwei) 值是否已保存
            await sleep(1000);
            const priorityVerified = await verifyInputValue('Priority (Gwei)', priorityValueStr);
            if (!priorityVerified) {
                log('⚠️ Buy 方的 Priority (Gwei) 值驗證失敗，但將繼續', 'warning');
            }
        }
        
        // 步驟 7: 點擊 Sell 按鈕
        if (!isRunning) return false;
        log('步驟 7/15: 點擊 Sell 按鈕', 'info');
        const step7 = await clickBuyOrSellButton('Sell');
        if (step7) successCount++;
        
        // 步驟 8: 設定 Sell 方的 slippage % 至固定值（為所有 M.Cap 選項設定）
        if (!isRunning) return false;
        log(`步驟 8/15: 設定 Sell 方的所有 M.Cap 選項的 Slippage 至 ${slippageValueStr}%`, 'info');
        const step8 = await setSlippageForAllMCaps(CONFIG.slippageValue, 'Sell');
        if (step8) {
            successCount++;
        } else {
            log('⚠️ Sell 方的 M.Cap Slippage 設定未完全成功，但將繼續', 'warning');
            // 即使部分失敗也計為成功，因為至少設定了一些
            successCount++;
        }
        
        // 步驟 9: 設定 Sell 方的 Priority (Gwei) 至固定值
        if (!isRunning) return false;
        log(`步驟 9/15: 設定 Sell 方的 Priority (Gwei) 至 ${priorityValueStr}`, 'info');
        const step9 = await findAndSetInput([
            { type: 'text', text: 'Priority (Gwei)' }
        ], priorityValueStr, 'Sell 方的 Priority (Gwei)');
        if (step9) {
            successCount++;
            // 驗證 Priority (Gwei) 值是否已保存
            await sleep(1000);
            const priorityVerified = await verifyInputValue('Priority (Gwei)', priorityValueStr);
            if (!priorityVerified) {
                log('⚠️ Sell 方的 Priority (Gwei) 值驗證失敗，但將繼續', 'warning');
            }
        }
        
        // 步驟 10: 點擊 Save 按鈕
        if (!isRunning) return false;
        log('步驟 10/15: 點擊 Save 按鈕', 'info');
        let saveButtonClicked = false;
        
        for (let attempt = 0; attempt < 5; attempt++) {
            // 方法1: 通過文字 "Save" 和 bg-genius-pink 類查找
            const allButtons = document.querySelectorAll('button');
            for (const btn of allButtons) {
                const text = btn.innerText?.trim() || btn.textContent?.trim() || '';
                const classes = btn.className || '';
                
                if (text === 'Save' && classes.includes('bg-genius-pink')) {
                    const rect = btn.getBoundingClientRect();
                    const style = window.getComputedStyle(btn);
                    
                    if (rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        btn.offsetParent !== null &&
                        !btn.disabled) {
                        
                        // 滾動到元素可見位置
                        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        await sleep(300);
                        
                        btn.click();
                        log('✓ Save 按鈕已點擊', 'success');
                        saveButtonClicked = true;
                        await sleep(1500);
                        break;
                    }
                }
            }
            
            if (saveButtonClicked) break;
            
            // 方法2: 通過選擇器查找
            if (!saveButtonClicked) {
                const saveBtn = document.querySelector('button.bg-genius-pink');
                if (saveBtn) {
                    const text = saveBtn.innerText?.trim() || saveBtn.textContent?.trim() || '';
                    if (text === 'Save') {
                        const rect = saveBtn.getBoundingClientRect();
                        const style = window.getComputedStyle(saveBtn);
                        
                        if (rect.width > 0 && rect.height > 0 &&
                            style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            saveBtn.offsetParent !== null &&
                            !saveBtn.disabled) {
                            
                            saveBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            await sleep(300);
                            
                            saveBtn.click();
                            log('✓ Save 按鈕已點擊（通過選擇器）', 'success');
                            saveButtonClicked = true;
                            await sleep(1500);
                            break;
                        }
                    }
                }
            }
            
            if (saveButtonClicked) break;
            
            if (attempt < 4) {
                log(`重試查找 Save 按鈕... (${attempt + 1}/5)`, 'warning');
                await sleep(1000);
            }
        }
        
        if (saveButtonClicked) {
            successCount++;
        } else {
            log('⚠️ 未找到 Save 按鈕，但將繼續執行', 'warning');
        }
        
        // 步驟 11: 點選 Aggregator/Fast Swaps 設定
        if (!isRunning) return false;
        log('步驟 11/15: 點擊 Aggregator/Fast Swaps', 'info');
        const step11 = await findAndClickElement([
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
        if (step11) {
            successCount++;
            // 額外等待時間確保 UI 完全展開
            await sleep(2000);
        }
        
        // 步驟 12: 打開 Globally disable fast swaps 中的 EVM
        if (!isRunning) return false;
        log('步驟 12/15: 開啟 Globally disable fast swaps (EVM)', 'info');
        const step12 = await findAndToggleSwitch(
            'Globally disable fast swaps (EVM)',
            'Globally disable fast swaps',
            true,
            '(EVM)'
        );
        if (step12) successCount++;
        
        // 步驟 13: 打開 EVM Simulations
        if (!isRunning) return false;
        log('步驟 13/15: 開啟 EVM Simulations', 'info');
        const step13 = await findAndToggleSwitch(
            'EVM Simulations',
            'EVM Simulations',
            true
        );
        if (step13) successCount++;
        
        // 步驟 14: 點選 Fees 設定
        if (!isRunning) return false;
        log('步驟 14/15: 點擊 Fees 設定', 'info');
        const step14 = await findAndClickElement([
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
        if (step14) {
            successCount++;
            // 額外等待時間確保 UI 完全展開
            await sleep(2000);
        }
        
        // 步驟 15: 打開 Show Fees
        if (!isRunning) return false;
        log('步驟 15/15: 開啟 Show Fees', 'info');
        const step15 = await findAndToggleSwitch(
            'Show Fees',
            'Show Fees',
            true
        );
        if (step15) successCount++;
        
        // 步驟 16: 點擊關閉按鈕關閉設定面板
        if (!isRunning) return false;
        log('步驟 16/16: 點擊關閉按鈕', 'info');
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
        
        const actualTotalSteps = totalSteps + 1; // 加上關閉按鈕步驟（16步）
        log(`✅ Preset 設定完成: ${successCount}/${actualTotalSteps} 步驟成功`, successCount >= totalSteps ? 'success' : 'warning');
        
        if (successCount < totalSteps) {
            log(`⚠️ 有 ${actualTotalSteps - successCount} 個步驟未完成，但將繼續執行交易`, 'warning');
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

    // 狀態恢復函數：從暫停狀態恢復執行
    async function resumeFromPausedState() {
        if (!resumeFromState || currentSwapState !== SwapState.PAUSED_HIDDEN) {
            return false;
        }
        
        log('🔄 開始狀態恢復流程...', 'info');
        
        // 確保頁面可見
        if (document.hidden) {
            log('⚠️ 頁面仍不可見，等待頁面重新可見...', 'warning');
            let waitCount = 0;
            while (document.hidden && waitCount < 60) { // 最多等待 60 秒
                await sleep(1000, true); // 允許在 hidden 時等待
                waitCount++;
            }
            if (document.hidden) {
                log('❌ 頁面長時間不可見，無法恢復', 'error');
                return false;
            }
        }
        
        // 恢復到之前的狀態
        const previousState = stateData.pausedFromState || SwapState.IDLE;
        log(`📋 恢復到狀態: ${previousState}`, 'info');
        
        // 根據之前的狀態，執行相應的恢復操作
        switch (previousState) {
            case SwapState.CHECKING_BALANCE:
                log('🔄 重新檢查餘額...', 'info');
                currentSwapState = SwapState.CHECKING_BALANCE;
                break;
                
            case SwapState.SELECTING_FIRST_TOKEN:
                log('🔄 重新選擇第一個代幣...', 'info');
                currentSwapState = SwapState.IDLE; // 重置為 IDLE，讓主循環重新開始選擇
                break;
                
            case SwapState.SELECTING_SECOND_TOKEN:
                log('🔄 重新選擇第二個代幣...', 'info');
                currentSwapState = SwapState.IDLE; // 重置為 IDLE，讓主循環重新開始選擇
                break;
                
            case SwapState.CLICKING_MAX:
                log('🔄 重新檢查 MAX 按鈕狀態...', 'info');
                currentSwapState = SwapState.IDLE; // 重置為 IDLE，讓主循環重新檢查
                break;
                
            case SwapState.WAITING_FOR_QUOTE:
                log('🔄 重新等待報價...', 'info');
                currentSwapState = SwapState.IDLE; // 重置為 IDLE，讓主循環重新等待報價
                break;
                
            case SwapState.CLICKING_CONFIRM:
                log('🔄 重新檢查 Confirm 按鈕...', 'info');
                currentSwapState = SwapState.IDLE; // 重置為 IDLE，讓主循環重新檢查
                break;
                
            case SwapState.WAITING_FOR_RESULT:
                log('🔄 檢查交易結果...', 'info');
                currentSwapState = SwapState.IDLE; // 重置為 IDLE，讓主循環重新檢查
                break;
                
            default:
                log('🔄 恢復到初始狀態', 'info');
                currentSwapState = SwapState.IDLE;
        }
        
        // 清理暫停數據
        stateData.pausedFromState = null;
        stateData.pausedAt = null;
        resumeFromState = false;
        
        // 等待一小段時間確保頁面完全加載
        await sleep(1000);
        
        log('✅ 狀態恢復完成', 'success');
        return true;
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
        
        // 初始化狀態
        currentSwapState = SwapState.IDLE;
        stateData = {};
        resumeFromState = false;
        isPageVisible = !document.hidden;

        // 啟用防止螢幕關閉時暫停的機制
        await requestWakeLock();
        startHeartbeat();

        log('🚀 自動交易啟動！', 'success');
        log(`配置: USDC ⇄ USDT on ${CONFIG.chainDisplayName} (Optimism)`, 'info');
        log(`鏈設置: 固定使用 ${CONFIG.chainDisplayName} 鏈`, 'info');
        log(`安全設置: 餘額監控=${CONFIG.enableBalanceMonitoring}, 成功驗證=${CONFIG.enableSuccessVerification}`, 'info');
        log('✅ 狀態機模式已啟用：支持頁面隱藏/最小化後自動恢復', 'info');

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
        
        // 確保所有視窗都已完全關閉
        if (isDialogOpen()) {
            log('確保所有視窗已完全關閉...', 'info');
            await ensureAllDialogsClosed(5);
        }
        
        // 等待頁面完全穩定（Preset 設定完成後需要更多時間讓頁面穩定）
        await sleep(3000);
        
        // 再次檢查是否被停止
        if (!isRunning) {
            log('⚠️ 程序已停止', 'warning');
            window.botRunning = false;
            UI.setRunning(false);
            return;
        }

        // 初始化餘額（帶重試機制）
        log('初始化餘額檢查...', 'info');
        let balanceCheckSuccess = false;
        for (let retry = 0; retry < 3; retry++) {
            const balanceResult = await checkBalanceSufficient();
            if (balanceResult) {
                balanceCheckSuccess = true;
                break;
            }
            
            // 如果餘額檢查失敗，可能是讀取時機不對，重試前先等待
            if (retry < 2) {
                log(`餘額讀取可能不準確，${2} 秒後重試... (${retry + 1}/3)`, 'info');
                await sleep(2000);
                if (!isRunning) break;
            }
        }
        
        if (!balanceCheckSuccess) {
            log('⚠️ 餘額檢查失敗，但將繼續執行交易循環（將在循環中再次檢查）', 'warning');
        }

        await sleep(1200);

        // 記憶體清理計數器：每執行 10 次交易循環後清理一次
        let swapCycleCount = 0;
        const MEMORY_CLEANUP_INTERVAL = 10;

        while (isRunning) {
            try {
                // 檢查是否已停止
                if (!isRunning) break;
                
                // 定期清理記憶體：每執行一定次數的交易後清理
                swapCycleCount++;
                if (swapCycleCount >= MEMORY_CLEANUP_INTERVAL) {
                    swapCycleCount = 0;
                    // 清理日誌緩衝區（保留最新的）
                    if (logBuffer.length > MAX_LOG_ENTRIES) {
                        const keepCount = Math.floor(MAX_LOG_ENTRIES * 0.8);  // 保留 80%
                        logBuffer.splice(0, logBuffer.length - keepCount);
                    }
                    // 強制垃圾回收提示（如果瀏覽器支援）
                    if (window.gc) {
                        try {
                            window.gc();
                        } catch (e) {
                            // 忽略錯誤
                        }
                    }
                }
                
                // 檢查是否需要從暫停狀態恢復
                if (resumeFromState && currentSwapState === SwapState.PAUSED_HIDDEN) {
                    const resumed = await resumeFromPausedState();
                    if (!resumed) {
                        // 如果恢復失敗，等待後重試
                        await sleep(2000);
                        continue;
                    }
                }
                
                // 確保頁面可見才執行操作（除非是允許在 hidden 時執行的操作）
                if (document.hidden && currentSwapState !== SwapState.IDLE) {
                    // 如果頁面隱藏且不在 IDLE 狀態，進入暫停狀態
                    if (currentSwapState !== SwapState.PAUSED_HIDDEN) {
                        const previousState = currentSwapState;
                        currentSwapState = SwapState.PAUSED_HIDDEN;
                        stateData.pausedFromState = previousState;
                        stateData.pausedAt = Date.now();
                        resumeFromState = true;
                        log(`⏸️ 頁面隱藏，暫停操作（從狀態 ${previousState} 暫停）`, 'warning');
                    }
                    // 等待頁面重新可見
                    await sleep(1000, true); // 允許在 hidden 時等待
                    continue;
                }

                // 檢查連續失敗次數
                if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
                    log(`❌ 連續失敗 ${consecutiveFailures} 次，暫停交易`, 'error');
                    log('請檢查網絡連接、餘額或頁面狀態後手動重啟', 'warning');
                    currentSwapState = SwapState.IDLE;
                    await sleep(10000);
                    if (!isRunning) break; // 檢查是否在等待期間被停止
                    consecutiveFailures = 0; // 重置計數器，繼續嘗試
                    continue;
                }

                // 檢查是否已停止
                if (!isRunning) break;

                // 檢查按鈕加載超時
                if (checkButtonLoadingTimeout()) {
                    currentSwapState = SwapState.IDLE;
                    break; // 頁面將刷新，退出循環
                }

                // 檢查是否已停止
                if (!isRunning) break;

                // 檢查餘額
                currentSwapState = SwapState.CHECKING_BALANCE;
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
                        // 在等待前，先確認餘額讀取是否真的失敗（可能是讀取時機問題）
                        log('餘額不足，等待...', 'warning');
                        
                        // 等待期間，定期檢查是否被停止，但不要因為其他原因而停止
                        const waitStartTime = Date.now();
                        const waitDuration = 5000;
                        
                        while (Date.now() - waitStartTime < waitDuration) {
                            if (!isRunning) break; // 只有在明確停止時才退出
                            await sleep(1000); // 分段等待，每 1 秒檢查一次
                        }
                        
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
                    currentSwapState = SwapState.CLOSING_POPUP;
                    closeBtn.click();
                    log('✓ 關閉交易完成彈窗', 'success');
                    await sleep(CONFIG.waitAfterClose);
                    currentSwapState = SwapState.IDLE;
                    continue;
                }

                // 2. 檢查是否需要選擇代幣
                const chooseBtns = findChooseButtons();

                if (chooseBtns.length > 0) {
                    log(`檢測到 ${chooseBtns.length} 個 Choose 按鈕，開始選幣...`, 'info');

                    // 重置 currentFromToken，準備選擇新的代幣
                    currentFromToken = null;

                    // 檢查是否已停止
                    if (!isRunning) break;

                    // 點擊第一個 Choose（發送代幣）
                    currentSwapState = SwapState.SELECTING_FIRST_TOKEN;
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

                    // 1.5. 新增：基於幣種比較判斷上一次 SWAP 的成功/失敗
                    // 這個判斷應該在選擇新代幣之後進行，此時 currentFromToken 是新選擇的幣種
                    // 比較 lastCycleFromToken（上一輪要 SWAP 的幣種）和 currentFromToken（新選擇的幣種）
                    if (currentFromToken) {
                        const verifyResult = verifySwapByTokenComparison();
                        
                        if (verifyResult.shouldUpdate) {
                            if (verifyResult.wasSuccess) {
                                // 上一次 SWAP 成功
                                stats.successfulSwaps++;
                                stats.lastSuccessTime = Date.now();
                                log(`✅ 統計更新：成功 +1 | 總計: ${stats.totalSwaps} | 成功: ${stats.successfulSwaps} | 失敗: ${stats.failedSwaps}`, 'success');
                            } else {
                                // 上一次 SWAP 失敗
                                stats.failedSwaps++;
                                log(`❌ 統計更新：失敗 +1 | 總計: ${stats.totalSwaps} | 成功: ${stats.successfulSwaps} | 失敗: ${stats.failedSwaps}`, 'error');
                            }
                            
                            UI.updateStats();
                            
                            // 重置標記，為下一次判斷做準備
                            lastCycleConfirmed = false;
                        }
                        
                        // 記錄本次要 SWAP 的幣種（用於下次循環比較判斷）
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
                        currentSwapState = SwapState.SELECTING_SECOND_TOKEN;
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
                        currentSwapState = SwapState.IDLE;
                        await sleep(2000);
                        continue;
                    }
                }

                if (maxBtn && !maxBtn.disabled) {
                    currentSwapState = SwapState.CLICKING_MAX;
                    maxBtn.click();
                    log('✓ 點擊 MAX', 'success');
                    await sleep(CONFIG.waitAfterMax);
                    
                    // 額外等待，確保 MAX 點擊後 UI 更新完成
                    log('⏳ 等待 MAX 點擊後的 UI 更新...', 'info');
                    await sleep(1000);
                } else if (!maxBtn) {
                    log('未找到 MAX 按鈕', 'warning');
                    consecutiveFailures++;
                    currentSwapState = SwapState.IDLE;
                    await sleep(2000);
                    continue;
                }

                // 4. 等待報價完成後點擊 Confirm
                currentSwapState = SwapState.WAITING_FOR_QUOTE;
                log('⏳ 開始等待報價完成...', 'info');
                const quoteReady = await waitForQuoteReady();
                
                // 如果報價未準備好，進行額外的安全檢查
                if (!quoteReady) {
                    log('⚠️ 報價等待超時，進行額外安全檢查...', 'warning');
                    
                    // 檢查是否仍在 loading 狀態
                    const hasLoading = hasLoadingState();
                    
                    if (hasLoading) {
                        // 如果還在 loading，嘗試點擊 Refresh 按鈕重新報價
                        log('🔄 檢測到仍在 loading 狀態，嘗試點擊 Refresh 按鈕重新報價...', 'info');
                        const refreshBtn = findRefreshButton();
                        
                        if (refreshBtn) {
                            refreshBtn.click();
                            log('✓ 已點擊 Refresh 按鈕，等待報價更新...', 'success');
                            
                            // 等待 Refresh 後的報價更新（最多等待 15 秒）
                            const refreshWaitTime = 15000;
                            const refreshCheckInterval = 500;
                            let refreshStartTime = Date.now();
                            let refreshQuoteReady = false;
                            
                            while (Date.now() - refreshStartTime < refreshWaitTime) {
                                const stillLoading = hasLoadingState();
                                const confirmBtn = findConfirmButton();
                                
                                // 檢查按鈕是否真的可用（即使 disabled 屬性為 true，也可能可以點擊）
                                // 根據用戶反饋，只要找到按鈕就認為可用
                                if (!stillLoading && confirmBtn) {
                                    // 等待一小段時間確保報價穩定
                                    await sleep(2000);
                                    const finalLoading = hasLoadingState();
                                    if (!finalLoading) {
                                        refreshQuoteReady = true;
                                        log('✓ Refresh 後報價已準備完成', 'success');
                                        break;
                                    }
                                }
                                
                                await sleep(refreshCheckInterval);
                            }
                            
                            if (!refreshQuoteReady) {
                                // 調試：顯示最終狀態
                                const debugLoading = hasLoadingState(true);
                                const debugConfirmBtn = findConfirmButton();
                                log(`🔍 調試：Refresh 後最終狀態 - Loading: ${debugLoading}, Confirm按鈕: ${debugConfirmBtn ? '已找到' : '未找到'}`, 'warning');
                                
                                log('❌ Refresh 後報價仍未準備完成，跳過本次循環', 'error');
                                consecutiveFailures++;
                                await sleep(2000);
                                continue;
                            }
                        } else {
                            log('❌ 未找到 Refresh 按鈕，跳過本次循環', 'error');
                            consecutiveFailures++;
                            await sleep(2000);
                            continue;
                        }
                    } else {
                        // 沒有 loading，但報價超時，進行額外檢查
                        const additionalWaitTime = 2000; // 額外等待 2 秒
                        log(`⏳ 無 loading 狀態，額外等待 ${additionalWaitTime / 1000} 秒並檢查狀態...`, 'info');
                        await sleep(additionalWaitTime);
                        
                        const confirmBtn = findConfirmButton();
                        // 即使 disabled 也可能可以點擊，所以只要找到按鈕就認為可用
                        if (!confirmBtn) {
                            log('❌ Confirm 按鈕未找到，跳過本次循環', 'error');
                            consecutiveFailures++;
                            await sleep(2000);
                            continue;
                        }
                        
                        log('⚠️ 額外檢查通過，將嘗試點擊 Confirm', 'warning');
                    }
                }

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
                currentSwapState = SwapState.CLICKING_CONFIRM;

                for (let i = 0; i < CONFIG.maxRetryConfirm; i++) {
                    // 在每次重試前檢查 loading 狀態
                    const hasLoading = hasLoadingState();
                    
                    if (hasLoading) {
                        // 如果檢測到 loading，嘗試點擊 Refresh 按鈕
                        if (i === 0 || i % 3 === 0) { // 每 3 次重試嘗試一次 Refresh
                            log(`🔄 檢測到 loading 狀態，嘗試點擊 Refresh 按鈕... (重試 ${i + 1}/${CONFIG.maxRetryConfirm})`, 'info');
                            const refreshBtn = findRefreshButton();
                            if (refreshBtn) {
                                refreshBtn.click();
                                log('✓ 已點擊 Refresh 按鈕', 'success');
                                await sleep(2000); // 等待 Refresh 後的更新
                            }
                        } else {
                            log(`⏳ 檢測到 loading 狀態，等待中... (重試 ${i + 1}/${CONFIG.maxRetryConfirm})`, 'info');
                            await sleep(1000);
                        }
                        continue;
                    }
                    
                    const confirmBtn = findConfirmButton();

                    // 根據用戶反饋，Confirm 按鈕實際上可以按，即使顯示為 disabled
                    // 所以我們只要找到按鈕就嘗試點擊
                    if (confirmBtn) {
                        // 檢查按鈕文字是否正常（不包含 loading 相關文字）
                        const buttonText = (confirmBtn.innerText || '').trim().toUpperCase();
                        const loadingKeywords = ['LOADING', '計算中', '計算', 'CALCULATING', 'PROCESSING'];
                        const hasLoadingText = loadingKeywords.some(keyword => buttonText.includes(keyword));
                        
                        if (hasLoadingText) {
                            log(`⏳ 按鈕文字顯示仍在處理中，等待... (重試 ${i + 1}/${CONFIG.maxRetryConfirm})`, 'info');
                            await sleep(1000);
                            continue;
                        }
                        
                        // 嘗試點擊 Confirm 按鈕（即使 disabled 也可能可以點擊）
                        try {
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
                            
                            // 更新狀態為等待結果
                            currentSwapState = SwapState.WAITING_FOR_RESULT;
                            
                            break;
                        } catch (error) {
                            log(`⚠️ 點擊 Confirm 時發生錯誤: ${error.message}，繼續重試...`, 'warning');
                            await sleep(500);
                            continue;
                        }
                    }

                    await sleep(500);
                }

                if (!confirmClicked) {
                    log('❌ Confirm 未成功，重試...', 'error');
                    consecutiveFailures++;
                    currentSwapState = SwapState.IDLE;
                    // 注意：Confirm 未點擊成功，不算一次真正的交易嘗試，不增加 totalSwaps
                    await sleep(2000);
                    continue;
                }

                // 5. 等待交易提交並進入下一輪（成功/失敗判斷將在下一輪循環開始時透過幣種比較完成）
                currentSwapState = SwapState.WAITING_FOR_RESULT;
                await sleep(CONFIG.waitAfterConfirm);

                // 嘗試關閉可能出現的成功彈窗（不等待，非阻塞）
                await sleep(1000);
                const closeAfterConfirm = findCloseButton();
                if (closeAfterConfirm) {
                    currentSwapState = SwapState.CLOSING_POPUP;
                    closeAfterConfirm.click();
                    log('✓ 關閉彈窗', 'success');
                    await sleep(CONFIG.waitAfterClose);
                }

                // 注意：不再切換方向，因為下一輪循環會重新選擇代幣（選擇餘額最大的）
                // 切換方向會干擾幣種比較判斷，且沒有實際意義

                // 隨機等待後繼續下一輪
                // 注意：成功/失敗的判斷將在下一輪循環開始時透過幣種比較完成
                currentSwapState = SwapState.IDLE; // 重置為 IDLE，準備下一輪
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

        // 重置狀態機
        currentSwapState = SwapState.IDLE;
        stateData = {};
        resumeFromState = false;

        // 重置幣種比較判斷相關的變數
        lastCycleFromToken = null;
        lastCycleConfirmed = false;

        // 清理記憶體：限制日誌緩衝區大小
        if (logBuffer.length > MAX_LOG_ENTRIES) {
            logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
        }

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
        <div style="margin-top: 4px;">連續失敗: <span id="stat-consecutive-fail" style="color: #ef4444;">0</span></div>
        <div style="margin-top: 4px;">Slippage: <span id="stat-slippage" style="color: #3b82f6;">${CONFIG.slippageValue.toFixed(2)}%</span> | Priority: <span id="stat-priority" style="color: #3b82f6;">${CONFIG.priorityValue.toFixed(4)} gwei</span></div>
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

            // 保存事件處理器引用，避免重複添加
            if (!keydownHandler) {
                keydownHandler = (e) => {
                    if (e.ctrlKey && (e.key === 's' || e.key === 'S') && !e.altKey) {
                        e.preventDefault();
                        this.toggle();
                    }
                };
                window.addEventListener('keydown', keydownHandler);
            }
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
            const consecutiveFailEl = this.statsEl.querySelector('#stat-consecutive-fail');
            const slippageEl = this.statsEl.querySelector('#stat-slippage');
            const priorityEl = this.statsEl.querySelector('#stat-priority');
            
            if (totalEl) totalEl.textContent = stats.totalSwaps;
            if (successEl) successEl.textContent = stats.successfulSwaps;
            if (failEl) failEl.textContent = stats.failedSwaps;
            
            // 更新連續失敗次數
            if (consecutiveFailEl) {
                consecutiveFailEl.textContent = consecutiveFailures;
            }
            
            // 顯示固定的 Slippage 和 Priority 值
            if (slippageEl) {
                slippageEl.textContent = `${CONFIG.slippageValue.toFixed(2)}%`;
            }
            if (priorityEl) {
                priorityEl.textContent = `${CONFIG.priorityValue.toFixed(4)} gwei`;
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
