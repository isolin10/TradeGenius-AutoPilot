// ==UserScript==
// @name         TradeGenius Auto Swap - Enhanced (Preset 統一 Slippage/Priority)
// @namespace    https://www.tradegenius.com
// @version      1.0.1
// @description  增強版自動 USDC/USDT 刷量腳本，具備完善的防呆機制與風險控制
// @author       B1N0RY & Keepplay
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
    (function () {
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
            window.fetch = function (input, init) {
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
            XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
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

        // 重試設置
        maxRetryConfirm: 25,
        maxRetryTokenSelect: 5,
        maxConsecutiveFailures: 5,      // 連續失敗次數上限

        // 按鈕加載超時設置（毫秒）
        buttonLoadingTimeout: 35000,    // 35秒

        // 交易頻率控制
        minIntervalBetweenSwaps: 10000, // 兩次交易之間的最小間隔（毫秒）

        // 鏈設置（固定為 Optimism/OP）
        targetChain: 'Optimism',        // 固定使用 Optimism (OP) 鏈
        chainDisplayName: 'OP',          // 顯示名稱

        // 安全設置
        enableSuccessVerification: true, // 啟用交易成功驗證
        enableAutoRecovery: true,        // 啟用自動恢復

        // 動態調整設置
        enableDynamicAdjustment: true,   // 啟用動態調整 Slippage 和 Priority
        // Slippage 設置
        slippageInitial: 0.01,          // 初始 Slippage (%)
        slippageMin: 0.0001,            // Slippage 下限 (%)
        slippageMax: 0.30,              // Slippage 上限 (%)
        slippageIncreaseOnFailure: 0.003, // 失敗時增加的 Slippage (%)
        slippageDecreaseOnSuccess: 0.003, // 成功時減少的 Slippage (%)
        // Priority 設置
        priorityInitial: 0.002,         // 初始 Priority (gwei)
        priorityMin: 0.002,             // Priority 下限 (gwei)
        priorityMax: 0.01,              // Priority 上限 (gwei)
        priorityIncreaseOnFailure: 0.001, // 失敗時增加的 Priority (gwei)
        priorityDecreaseOnSuccess: 0.001, // 成功時減少的 Priority (gwei)
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

    // 新增：用於基於幣種比較的 SWAP 成功/失敗判斷
    let lastCycleFromToken = null;  // 記錄上一次交易循環開始時的發送幣種
    let lastCycleConfirmed = false; // 記錄上一次循環是否執行了 Confirm

    // 動態調整相關變量
    let consecutiveSuccesses = 0;   // 連續成功次數
    let currentSlippage = CONFIG.slippageInitial;  // 當前 Slippage 值
    let currentPriority = CONFIG.priorityInitial;  // 當前 Priority 值
    let isAdjusting = false;        // 調整中標記，避免並發調整
    let pendingAdjustment = null;   // 待處理的調整請求

    // 防止螢幕關閉時暫停的相關變量
    let wakeLock = null;  // Wake Lock API 對象
    let wakeLockReleaseHandler = null;  // Wake Lock 釋放事件處理器（用於清理）
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
    // 從文字中解析餘額數值
    const parseFloatBalance = (text) => {
        if (!text) return 0;
        // 尋找包含 $ 的部分或包含數字的部分，移除 $ 和 ,
        // 例如："$1,234.56" -> 1234.56, "0.00" -> 0
        const matches = text.match(/\$?\d+(?:,\d+)*(?:\.\d+)?/g);
        if (matches && matches.length > 0) {
            // 通常餘額是 row 文案中的最後一個數值
            const lastMatch = matches[matches.length - 1].replace(/[$,\s]/g, '');
            const val = parseFloat(numericStr(lastMatch));
            return isNaN(val) ? 0 : val;
        }
        return 0;
    };

    // 移除數值字串中的非數字字元（除小數點外）
    const numericStr = (str) => str.replace(/[^0-9.]/g, '');


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

    // 日誌緩衝區：限制日誌條目數量，避免記憶體累積
    const logBuffer = [];
    const MAX_LOG_ENTRIES = 100;  // 最多保留 100 條日誌
    const MAX_LOG_TEXT_LENGTH = 5000;  // 日誌文字最多 5000 字元

    // ==================== 錯誤日誌收集系統 ====================
    const errorLogs = {
        entries: [],
        maxEntries: 500,  // 最多保留 500 條錯誤日誌
        config: {
            collectErrors: true,      // 收集錯誤
            collectWarnings: true,   // 收集警告
            collectInfo: false,      // 不收集一般資訊（減少檔案大小）
            collectSuccess: false    // 不收集成功訊息（減少檔案大小）
        }
    };

    // 添加日誌條目到錯誤日誌收集系統
    function addToErrorLog(entry) {
        if (!errorLogs.config.collectErrors && entry.type === 'error') return;
        if (!errorLogs.config.collectWarnings && entry.type === 'warning') return;
        if (!errorLogs.config.collectInfo && entry.type === 'info') return;
        if (!errorLogs.config.collectSuccess && entry.type === 'success') return;

        errorLogs.entries.push(entry);

        // 限制日誌條目數量
        if (errorLogs.entries.length > errorLogs.maxEntries) {
            errorLogs.entries.shift();
        }
    }

    // 捕獲全局錯誤
    const originalErrorHandler = window.onerror;
    window.onerror = function (message, source, lineno, colno, error) {
        const errorEntry = {
            timestamp: new Date().toISOString(),
            type: 'error',
            category: 'global',
            message: message || 'Unknown error',
            source: source || 'unknown',
            line: lineno || 0,
            column: colno || 0,
            stack: error?.stack || null,
            url: window.location.href,
            userAgent: navigator.userAgent
        };
        addToErrorLog(errorEntry);

        // 調用原始錯誤處理器（如果存在）
        if (originalErrorHandler) {
            return originalErrorHandler(message, source, lineno, colno, error);
        }
        return false;
    };

    // 捕獲未處理的 Promise 拒絕
    window.addEventListener('unhandledrejection', function (event) {
        const errorEntry = {
            timestamp: new Date().toISOString(),
            type: 'error',
            category: 'unhandledRejection',
            message: event.reason?.message || String(event.reason) || 'Unhandled promise rejection',
            stack: event.reason?.stack || null,
            url: window.location.href,
            userAgent: navigator.userAgent
        };
        addToErrorLog(errorEntry);
    });

    const log = (msg, type = 'info', error = null) => {
        const time = new Date().toLocaleTimeString();
        const timestamp = new Date().toISOString();
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

        // 添加到錯誤日誌收集系統
        const logEntry = {
            timestamp: timestamp,
            type: type,
            category: 'application',
            message: msg,
            stack: error?.stack || null,
            error: error ? {
                name: error.name,
                message: error.message,
                stack: error.stack
            } : null,
            stats: {
                totalSwaps: stats.totalSwaps,
                successfulSwaps: stats.successfulSwaps,
                failedSwaps: stats.failedSwaps,
                consecutiveFailures: consecutiveFailures,
                lastError: stats.lastError
            },
            config: {
                slippage: CONFIG.enableDynamicAdjustment ? currentSlippage : CONFIG.slippageInitial,
                priority: CONFIG.enableDynamicAdjustment ? currentPriority : CONFIG.priorityInitial,
                chain: CONFIG.targetChain
            },
            url: window.location.href,
            userAgent: navigator.userAgent
        };
        addToErrorLog(logEntry);

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
            log(`⚠️ 無法啟用 Wake Lock: ${err.message}`, 'warning', err);
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
            log(`釋放 Wake Lock 時出錯: ${err.message}`, 'warning', err);
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
            log(`讀取當前發送幣失敗: ${error.message}`, 'error', error);
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
                log(`⚠️ 關閉視窗時發生錯誤: ${error.message}`, 'warning', error);
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
                // 將兩個值都轉換為數字進行比較，使用更小的容差以支持 0.0001% 的精度
                const currentNum = parseFloat(currentValue);
                const expectedNum = parseFloat(expectedValue);
                const valueMatch = currentValue === expectedValue ||
                    currentNum === expectedNum ||
                    (isNaN(currentNum) === false && isNaN(expectedNum) === false &&
                        Math.abs(currentNum - expectedNum) < 0.00001); // 使用更小的容差

                if (valueMatch) {
                    log(`✓ ${description} 值驗證成功: ${currentValue}`, 'info');
                    return true;
                } else {
                    log(`⚠️ ${description} 值不匹配（當前: ${currentValue}, 期望: ${expectedValue}, 差值: ${Math.abs(currentNum - expectedNum)}）`, 'warning');
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
                                            preventDefault: () => { },
                                            stopPropagation: () => { },
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
                                        const currentNum = parseFloat(currentValue);
                                        const valueNum = parseFloat(value);
                                        // 使用數值比較，容差為 0.00001 以支持 0.0001% 的精度
                                        if (currentValue === value ||
                                            currentNum === valueNum ||
                                            (isNaN(currentNum) === false && isNaN(valueNum) === false &&
                                                Math.abs(currentNum - valueNum) < 0.00001)) {
                                            log(`✓ ${description}: 設置為 ${value}（已驗證，實際值: ${currentValue}）`, 'success');
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

    // 設定聚合器來源（只開啟指定的聚合器）
    async function configureAggregators(enabledAggregators = ['odos', '0x', 'KyberSwap', 'OpenOcean', 'UniswapV3', 'Ve33']) {
        // 初始等待，確保 UI 完全展開
        await sleep(1500);

        for (let attempt = 0; attempt < 10; attempt++) {
            // 查找 EVM 區塊標籤
            const allElements = Array.from(document.querySelectorAll('*'));
            let evmLabel = null;

            // 查找包含 "EVM" 文字的標籤（在 Aggregator/Fast Swaps 區域內）
            // 優先查找包含 "text-sm" 類的元素（根據 HTML 結構）
            for (const el of allElements) {
                const text = el.innerText?.trim() || el.textContent?.trim();
                if (text === 'EVM') {
                    const elClasses = typeof el.className === 'string' ? el.className : (el.className?.baseVal || el.className?.toString() || '');

                    // 檢查是否符合 HTML 結構（text-sm text-genius-cream/50）
                    const hasCorrectClasses = elClasses.includes('text-sm') || elClasses.includes('text-genius-cream');

                    // 確認這是在 Aggregator/Fast Swaps 區域內的 EVM 標籤
                    // 檢查是否在包含 "Aggregator" 或 "Fast Swaps" 的區域內
                    const parent = el.parentElement;
                    const parentText = parent?.innerText || parent?.textContent || '';
                    const hasAggregatorContext = parentText.includes('Aggregator') ||
                        parentText.includes('Fast Swaps') ||
                        parentText.includes('Globally disable');

                    // 或者檢查是否在 pl-2.5 容器內（根據 HTML 結構）
                    const inPlContainer = el.closest('[class*="pl-2.5"]');

                    // 檢查父元素或祖先元素是否包含聚合器相關內容
                    let ancestor = el.parentElement;
                    let foundAggregatorSection = false;
                    for (let i = 0; i < 5 && ancestor; i++) {
                        const ancestorText = ancestor?.innerText || ancestor?.textContent || '';
                        if (ancestorText.includes('Aggregator') || ancestorText.includes('Fast Swaps') ||
                            ancestorText.includes('Globally disable') || ancestorText.includes('odos') ||
                            ancestorText.includes('KyberSwap') || ancestorText.includes('0x')) {
                            foundAggregatorSection = true;
                            break;
                        }
                        ancestor = ancestor.parentElement;
                    }

                    if (hasCorrectClasses || hasAggregatorContext || inPlContainer || foundAggregatorSection) {
                        evmLabel = el;
                        log(`✓ 找到 EVM 標籤（類: ${elClasses.substring(0, 50)}）`, 'info');
                        break;
                    }
                }
            }

            if (!evmLabel) {
                if (attempt < 9) {
                    await sleep(attempt < 3 ? 1000 : 1500);
                    continue;
                }
                log('⚠️ 未找到 EVM 區塊標籤', 'warning');
                return false;
            }

            // 找到 EVM 區塊容器
            // 根據 HTML 結構，EVM 標籤的下一個兄弟元素就是包含聚合器的容器
            let evmContainer = null;

            // 方法1: 查找下一個兄弟元素（包含 border-genius-blue 和 rounded-sm）
            let sibling = evmLabel.nextElementSibling;
            while (sibling) {
                const siblingClasses = typeof sibling.className === 'string' ? sibling.className : (sibling.className?.baseVal || sibling.className?.toString() || '');
                if (siblingClasses.includes('border-genius-blue') && siblingClasses.includes('rounded-sm')) {
                    evmContainer = sibling;
                    break;
                }
                sibling = sibling.nextElementSibling;
            }

            // 方法2: 如果沒找到，查找父元素的下一個兄弟元素
            if (!evmContainer && evmLabel.parentElement) {
                sibling = evmLabel.parentElement.nextElementSibling;
                while (sibling) {
                    const siblingClasses = typeof sibling.className === 'string' ? sibling.className : (sibling.className?.baseVal || sibling.className?.toString() || '');
                    if (siblingClasses.includes('border-genius-blue') && siblingClasses.includes('rounded-sm')) {
                        evmContainer = sibling;
                        break;
                    }
                    sibling = sibling.nextElementSibling;
                }
            }

            // 方法3: 向上查找包含 border-genius-blue 的容器
            if (!evmContainer) {
                evmContainer = evmLabel.closest('[class*="border-genius-blue"][class*="rounded-sm"]');
            }

            // 方法4: 在父容器中查找
            if (!evmContainer) {
                let parent = evmLabel.parentElement;
                for (let i = 0; i < 5 && parent; i++) {
                    const children = Array.from(parent.children);
                    for (const child of children) {
                        const childClasses = typeof child.className === 'string' ? child.className : (child.className?.baseVal || child.className?.toString() || '');
                        if (childClasses.includes('border-genius-blue') && childClasses.includes('rounded-sm') &&
                            childClasses.includes('p-2.5')) {
                            evmContainer = child;
                            break;
                        }
                    }
                    if (evmContainer) break;
                    parent = parent.parentElement;
                }
            }

            if (!evmContainer) {
                if (attempt < 9) {
                    log(`⚠️ 嘗試 ${attempt + 1}/10: 未找到 EVM 區塊容器，等待後重試...`, 'warning');
                    await sleep(attempt < 3 ? 1500 : 2000);
                    continue;
                }
                log('⚠️ 未找到 EVM 區塊容器', 'warning');
                return false;
            }

            log(`✓ 找到 EVM 區塊容器`, 'info');

            // 在 EVM 容器中查找所有聚合器選項
            // 嘗試多種選擇器來找到聚合器選項
            let aggregatorItems = Array.from(evmContainer.querySelectorAll('[class*="flex items-center gap-2 justify-between w-full"]'));

            // 如果沒找到，嘗試更寬鬆的選擇器
            if (aggregatorItems.length === 0) {
                aggregatorItems = Array.from(evmContainer.querySelectorAll('[class*="flex items-center gap-2 justify-between"]'));
            }

            // 如果還是沒找到，查找所有包含 switch 的 flex 容器
            if (aggregatorItems.length === 0) {
                const allFlexItems = Array.from(evmContainer.querySelectorAll('[class*="flex"]'));
                aggregatorItems = allFlexItems.filter(item => {
                    const hasSwitch = item.querySelector('button[role="switch"]');
                    const hasText = item.textContent && item.textContent.trim().length > 0 && item.textContent.trim().length < 30;
                    return hasSwitch && hasText;
                });
            }

            log(`找到 ${aggregatorItems.length} 個聚合器選項`, 'info');

            let foundAny = false;
            let successCount = 0;

            // 處理每個聚合器選項
            for (const item of aggregatorItems) {
                // 查找聚合器名稱（文字標籤）
                // 優先查找包含 "capitalize" 類的元素（聚合器名稱通常有這個類）
                let aggregatorName = null;
                const capitalizeElements = Array.from(item.querySelectorAll('div[class*="capitalize"]'));

                if (capitalizeElements.length > 0) {
                    for (const textEl of capitalizeElements) {
                        const text = textEl.innerText?.trim() || textEl.textContent?.trim();
                        if (text && text.length > 0 && text.length < 30) {
                            // 排除明顯不是聚合器名稱的元素
                            if (!text.includes(':') && !text.includes('(') && !text.includes(')') &&
                                !text.includes('M. Cap') && !text.includes('EVM') && !text.includes('Solana')) {
                                aggregatorName = text;
                                break;
                            }
                        }
                    }
                }

                // 如果沒找到，嘗試查找所有 text-xs 元素
                if (!aggregatorName) {
                    const textElements = Array.from(item.querySelectorAll('div[class*="text-xs"]'));
                    for (const textEl of textElements) {
                        const text = textEl.innerText?.trim() || textEl.textContent?.trim();
                        if (text && text.length > 0 && text.length < 30) {
                            // 排除明顯不是聚合器名稱的元素
                            if (!text.includes(':') && !text.includes('(') && !text.includes(')') &&
                                !text.includes('M. Cap') && !text.includes('EVM') && !text.includes('Solana')) {
                                // 檢查是否可能是聚合器名稱（通常是簡短的單詞）
                                const possibleNames = ['odos', '0x', 'kyber', 'openocean', 'okx', 'lifi', 'jupiter', 'raydium', 'uniswap', 've33', 'evmdirectpool', 'lfj', 'algebra'];
                                const normalizedText = text.toLowerCase();
                                if (possibleNames.some(name => normalizedText.includes(name) || name.includes(normalizedText))) {
                                    aggregatorName = text;
                                    break;
                                }
                            }
                        }
                    }
                }

                if (!aggregatorName) {
                    // 如果找不到名稱，跳過這個項目
                    continue;
                }

                // 查找對應的 switch 按鈕
                const switchBtn = item.querySelector('button[role="switch"]');
                if (!switchBtn) {
                    log(`⚠️ 找到聚合器 "${aggregatorName}" 但沒有找到 switch 按鈕`, 'warning');
                    continue;
                }

                foundAny = true;
                log(`處理聚合器: ${aggregatorName}`, 'info');

                // 檢查是否為目標聚合器（不區分大小寫，並處理各種變體）
                const normalizedName = aggregatorName.toLowerCase().trim();
                const isTarget = enabledAggregators.some(agg => {
                    const normalizedAgg = agg.toLowerCase().trim();
                    // 完全匹配
                    if (normalizedName === normalizedAgg) return true;
                    // 處理 "KyberSwap" vs "kyberswap" 或 "kyber"
                    if (normalizedName.includes('kyber') && normalizedAgg.includes('kyber')) return true;
                    // 處理 "0x" 的特殊情況
                    if (normalizedName === '0x' && normalizedAgg === '0x') return true;
                    // 處理 "odos" vs "Odos"
                    if (normalizedName === 'odos' && normalizedAgg === 'odos') return true;
                    // 處理 "OpenOcean" vs "openocean"
                    if (normalizedName.includes('openocean') && normalizedAgg.includes('openocean')) return true;
                    // 處理 "UniswapV3" vs "uniswapv3" 或 "uniswap v3"
                    if (normalizedName.includes('uniswap') && normalizedAgg.includes('uniswap')) {
                        // 檢查版本號
                        const nameHasV3 = normalizedName.includes('v3') || normalizedName.includes('3');
                        const aggHasV3 = normalizedAgg.includes('v3') || normalizedAgg.includes('3');
                        if (nameHasV3 && aggHasV3) return true;
                        // 如果其中一個沒有版本號，也允許匹配（但優先匹配有版本號的）
                        if (!nameHasV3 && !aggHasV3) return true;
                    }
                    // 處理 "Ve33" vs "ve33" 或 "ve 33"
                    if (normalizedName.includes('ve33') || normalizedName.includes('ve 33')) {
                        if (normalizedAgg.includes('ve33') || normalizedAgg.includes('ve 33')) return true;
                    }
                    return false;
                });

                // 檢查當前狀態
                const isChecked = switchBtn.getAttribute('aria-checked') === 'true' ||
                    switchBtn.getAttribute('data-state') === 'checked';

                // 滾動到元素可見位置
                switchBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(300);

                if (isTarget) {
                    // 目標聚合器：確保開啟
                    if (!isChecked) {
                        switchBtn.click();
                        log(`✓ 已開啟聚合器: ${aggregatorName}`, 'success');
                        successCount++;
                        await sleep(500);
                    } else {
                        log(`✓ 聚合器已開啟: ${aggregatorName}`, 'info');
                        successCount++;
                    }
                } else {
                    // 非目標聚合器：確保關閉
                    if (isChecked) {
                        switchBtn.click();
                        log(`✓ 已關閉聚合器: ${aggregatorName}`, 'success');
                        successCount++;
                        await sleep(500);
                    } else {
                        log(`✓ 聚合器已關閉: ${aggregatorName}`, 'info');
                        successCount++;
                    }
                }
            }

            if (foundAny && successCount > 0) {
                log(`✓ 聚合器設定完成（已處理 ${successCount} 個聚合器）`, 'success');
                await sleep(1000);
                return true;
            }

            if (!foundAny) {
                log(`⚠️ 嘗試 ${attempt + 1}/10: 未找到任何聚合器選項，等待後重試...`, 'warning');
            }

            if (attempt < 9) {
                await sleep(attempt < 3 ? 1500 : 2000);
            }
        }

        log('⚠️ 未找到任何聚合器選項', 'warning');
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
        log('步驟 1/16: 點擊 Settings 按鈕', 'info');
        const step1 = await findAndClickElement([
            'svg.lucide-settings2',
            'svg.lucide-settings-2',
            { type: 'svg', selector: 'svg[class*="lucide-settings"]' },
            { type: 'text', text: 'Settings' }
        ], 'Settings 按鈕', 2000);
        if (step1) successCount++;

        // 步驟 2: 點選設定 PreSet 的鏈（NetworkButton）
        log('步驟 2/16: 點擊 Network 選擇按鈕', 'info');
        const step2 = await findAndClickElement([
            '[data-sentry-component="NetworkButton"]',
            { type: 'text', text: 'Solana' },
            'div[class*="border-genius-blue"][class*="cursor-pointer"]'
        ], 'Network 選擇按鈕', 1500);
        if (step2) successCount++;

        // 步驟 3: 選擇 OP 鏈
        log('步驟 3/16: 選擇 Optimism 鏈', 'info');
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
        log('步驟 4/16: 點擊 Buy 按鈕', 'info');
        const step4 = await clickBuyOrSellButton('Buy');
        if (step4) successCount++;

        // 步驟 5: 設定 Buy 方的 Slippage % 至初始值（統一設定，無 M.Cap）
        if (!isRunning) return false;
        const slippageInitialValue = CONFIG.enableDynamicAdjustment ? CONFIG.slippageInitial : 0.05;
        const slippageInitialStr = slippageInitialValue.toFixed(4);
        log(`步驟 5/16: 設定 Buy 方的 Slippage 至 ${slippageInitialStr}%`, 'info');
        const step5 = await findAndSetInput([
            { type: 'text', text: 'Slippage' },
            { type: 'data-attr', attr: 'data-sentry-component', value: 'Slippage' }
        ], slippageInitialStr, 'Buy 方的 Slippage');
        if (step5) {
            successCount++;
            if (CONFIG.enableDynamicAdjustment) {
                currentSlippage = slippageInitialValue;
            }
        } else {
            log('⚠️ Buy 方的 Slippage 設定失敗，但將繼續', 'warning');
            successCount++;
            if (CONFIG.enableDynamicAdjustment) {
                currentSlippage = slippageInitialValue;
            }
        }

        // 步驟 6: 設定 Buy 方的 Priority (Gwei) 至初始值
        if (!isRunning) return false;
        const priorityInitialValue = CONFIG.enableDynamicAdjustment ? CONFIG.priorityInitial : 0.002;
        const priorityInitialStr = priorityInitialValue.toFixed(4);
        log(`步驟 6/15: 設定 Buy 方的 Priority (Gwei) 至 ${priorityInitialStr}`, 'info');
        const step6 = await findAndSetInput([
            { type: 'text', text: 'Priority (Gwei)' }
        ], priorityInitialStr, 'Buy 方的 Priority (Gwei)');
        if (step6) {
            successCount++;
            // 更新當前值
            if (CONFIG.enableDynamicAdjustment) {
                currentPriority = priorityInitialValue;
            }
            // 驗證 Priority (Gwei) 值是否已保存
            await sleep(1000);
            const priorityVerified = await verifyInputValue('Priority (Gwei)', priorityInitialStr);
            if (!priorityVerified) {
                log('⚠️ Buy 方的 Priority (Gwei) 值驗證失敗，但將繼續', 'warning');
            }
        }

        // 步驟 7: 點擊 Sell 按鈕
        if (!isRunning) return false;
        log('步驟 7/16: 點擊 Sell 按鈕', 'info');
        const step7 = await clickBuyOrSellButton('Sell');
        if (step7) successCount++;

        // 步驟 8: 設定 Sell 方的 Slippage % 至初始值（統一設定，無 M.Cap）
        if (!isRunning) return false;
        log(`步驟 8/16: 設定 Sell 方的 Slippage 至 ${slippageInitialStr}%`, 'info');
        const step8 = await findAndSetInput([
            { type: 'text', text: 'Slippage' },
            { type: 'data-attr', attr: 'data-sentry-component', value: 'Slippage' }
        ], slippageInitialStr, 'Sell 方的 Slippage');
        if (step8) {
            successCount++;
        } else {
            log('⚠️ Sell 方的 Slippage 設定失敗，但將繼續', 'warning');
            successCount++;
        }

        // 步驟 9: 設定 Sell 方的 Priority (Gwei) 至初始值
        if (!isRunning) return false;
        log(`步驟 9/16: 設定 Sell 方的 Priority (Gwei) 至 ${priorityInitialStr}`, 'info');
        const step9 = await findAndSetInput([
            { type: 'text', text: 'Priority (Gwei)' }
        ], priorityInitialStr, 'Sell 方的 Priority (Gwei)');
        if (step9) {
            successCount++;
            // 驗證 Priority (Gwei) 值是否已保存
            await sleep(1000);
            const priorityVerified = await verifyInputValue('Priority (Gwei)', priorityInitialStr);
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
        log('步驟 11/16: 點擊 Aggregator/Fast Swaps', 'info');
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

        // 步驟 12: 設定聚合器來源（只開啟 odos、0x、KyberSwap、OpenOcean、UniswapV3、Ve33）
        if (!isRunning) return false;
        log('步驟 12/16: 設定聚合器來源（只開啟 odos、0x、KyberSwap、OpenOcean、UniswapV3、Ve33）', 'info');
        const step12 = await configureAggregators(['odos', '0x', 'KyberSwap', 'OpenOcean', 'UniswapV3', 'Ve33']);
        if (step12) {
            successCount++;
            await sleep(1000);
        }

        // 步驟 13: 打開 Globally disable fast swaps 中的 EVM
        if (!isRunning) return false;
        log('步驟 13/16: 開啟 Globally disable fast swaps (EVM)', 'info');
        const step13 = await findAndToggleSwitch(
            'Globally disable fast swaps (EVM)',
            'Globally disable fast swaps',
            true,
            '(EVM)'
        );
        if (step13) successCount++;

        // 步驟 14: 打開 EVM Simulations
        if (!isRunning) return false;
        log('步驟 14/16: 開啟 EVM Simulations', 'info');
        const step14 = await findAndToggleSwitch(
            'EVM Simulations',
            'EVM Simulations',
            true
        );
        if (step14) successCount++;

        // 步驟 15: 點選 Fees 設定
        if (!isRunning) return false;
        log('步驟 15/16: 點擊 Fees 設定', 'info');
        const step15 = await findAndClickElement([
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
        if (step15) {
            successCount++;
            // 額外等待時間確保 UI 完全展開
            await sleep(2000);
        }

        // 步驟 16: 打開 Show Fees
        if (!isRunning) return false;
        log('步驟 16/16: 開啟 Show Fees', 'info');
        const step16 = await findAndToggleSwitch(
            'Show Fees',
            'Show Fees',
            true
        );
        if (step16) successCount++;

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

    // 選擇第一個代幣（USDC 或 USDT）
    async function selectFirstToken() {
        log('選擇發送代幣...', 'info');

        await sleep(CONFIG.waitAfterChoose);

        for (let attempt = 0; attempt < CONFIG.maxRetryTokenSelect; attempt++) {
            // 檢查是否已停止
            if (!isRunning) {
                log('⚠️ 選擇代幣已取消（程序已停止）', 'warning');
                return false;
            }

            const tokenRows = document.querySelectorAll('[role="dialog"] .cursor-pointer');
            const candidates = [];

            for (const row of tokenRows) {
                const symbolEl = row.querySelector('.text-xs.text-genius-cream\\/60, .text-sm.text-genius-cream');
                const symbol = symbolEl?.innerText?.trim();

                if (symbol === 'USDT' || symbol === 'USDC') {
                    const rowText = row.innerText || row.textContent || '';
                    const balance = parseFloatBalance(rowText);

                    candidates.push({ row, symbol, balance });
                    log(`發現候選幣種: ${symbol}，檢測到餘額約為: $${balance.toFixed(2)}`, 'info');
                }
            }

            // 核心優化：優先選擇餘額大於 0 的代幣 (且選擇餘額較多的一個，避免選錯)
            // 按餘額從大到小排序
            candidates.sort((a, b) => b.balance - a.balance);

            if (candidates.length > 0 && candidates[0].balance > 0) {
                const best = candidates[0];

                // 再次檢查是否已停止
                if (!isRunning) return false;

                best.row.click();
                currentFromToken = best.symbol;
                log(`✓ 已選擇有餘額的代幣: ${best.symbol} (餘額: $${best.balance.toFixed(2)})`, 'success');
                return true;
            }

            // 如果找到代幣但餘額都為 0，可能是因為剛轉帳完，或是真的沒錢
            if (candidates.length > 0) {
                log(`⚠️ 發現 USDT/USDC 但檢測到餘額皆為 $0，等待重試...`, 'warning');
            }

            if (attempt < CONFIG.maxRetryTokenSelect - 1) {
                log(`未找到有餘額的 USDT/USDC，重試 ${attempt + 1}/${CONFIG.maxRetryTokenSelect}...`, 'warning');
                await sleep(1500);
                if (!isRunning) return false;
            }
        }

        log('❌ 未找到有餘額的 USDT/USDC，請檢查帳戶餘額', 'error');
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

        // 3. 只 hover 到代幣行，觸發鏈選擇菜單（不要點擊，參考 tradegenius-autopilot.user.js）
        log('懸浮到代幣行以觸發鏈選擇菜單（不點擊）...', 'info');
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

        // 等待 hover 效果觸發鏈選擇菜單（.genius-shadow）
        await sleep(800); // 增加等待時間，確保菜單出現

        // 檢查是否已停止
        if (!isRunning) {
            log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
            return false;
        }

        // 4. 查找鏈選擇菜單（.genius-shadow）並在其中查找目標鏈選項
        log(`在 hover 菜單中查找 ${CONFIG.chainDisplayName} 鏈選項...`, 'info');
        let chainButton = null;
        let chainMenu = null;

        // 方法1: 先查找 .genius-shadow 菜單（這是 hover 後出現的菜單）
        chainMenu = targetRow.querySelector('.genius-shadow');

        if (chainMenu) {
            log('✓ 找到鏈選擇菜單 (.genius-shadow)', 'success');

            // 在菜單中查找鏈選項
            const chainOptions = chainMenu.querySelectorAll('.cursor-pointer');
            log(`在菜單中找到 ${chainOptions.length} 個鏈選項`, 'info');

            for (const opt of chainOptions) {
                if (!isRunning) {
                    log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
                    return false;
                }

                // 查找包含鏈名稱的元素
                const chainNameEl = opt.querySelector('span');
                const chainName = chainNameEl?.innerText?.trim() || '';

                const chainNames = [CONFIG.targetChain];
                if (CONFIG.targetChain === 'Optimism') {
                    chainNames.push('OP', 'OP Mainnet', 'Optimism', 'Optimistic Ethereum', 'Optimism Mainnet');
                }

                // 檢查是否匹配目標鏈
                if (chainNames.some(name => chainName === name || chainName.includes(name))) {
                    chainButton = opt;
                    log(`✓ 在菜單中找到 ${CONFIG.chainDisplayName} 鏈選項`, 'success');
                    break;
                }
            }
        }

        // 方法2: 如果方法1失敗，使用原來的全頁面搜索方法（作為 fallback）
        if (!chainButton) {
            log('方法1未找到鏈選項，嘗試方法2（全頁面搜索）...', 'info');

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

                    // 精確匹配 Optimism 文字
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
                                log(`✓ 找到 ${CONFIG.chainDisplayName} 鏈按鈕（方法2，嘗試 ${i + 1}/10）`, 'success');
                                break;
                            }
                        }
                    }
                }

                if (chainButton) break;
                await sleep(300);
            }
        }

        // 檢查是否已停止
        if (!isRunning) {
            log('⚠️ 選擇接收代幣已取消（程序已停止）', 'warning');
            return false;
        }

        if (!chainButton) {
            log(`⚠️ 未在浮動菜單中找到 ${CONFIG.chainDisplayName} 鏈按鈕，嘗試直接選擇代幣（使用默認鏈）`, 'warning');
            // Fallback: 直接點擊代幣（使用默認鏈）
            // 注意：這裡需要點擊代幣行來選擇代幣
            targetRow.click();
            await sleep(1500);
            await ensureAllDialogsClosed(5);
            await sleep(500);
            return true;
        }

        // 5. 點擊鏈按鈕（使用更可靠的方式）
        log(`準備點擊 ${CONFIG.chainDisplayName} 鏈按鈕...`, 'info');
        chainButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(200);

        // 先 hover 到鏈按鈕本身，確保它處於可點擊狀態
        const chainMouseEnter = new MouseEvent('mouseenter', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        chainButton.dispatchEvent(chainMouseEnter);

        const chainMouseOver = new MouseEvent('mouseover', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        chainButton.dispatchEvent(chainMouseOver);
        await sleep(150);

        // 使用多種方式觸發點擊，確保點擊生效
        try {
            // 方法1: 直接 click（最可靠的方式）
            chainButton.click();
            log(`✓ 已點擊 ${CONFIG.chainDisplayName} 鏈按鈕`, 'success');

            // 方法2: 如果方法1失敗，觸發 mousedown 和 mouseup 事件（模擬真實點擊）
            await sleep(100);
            const mouseDown = new MouseEvent('mousedown', {
                view: window,
                bubbles: true,
                cancelable: true,
                button: 0
            });
            chainButton.dispatchEvent(mouseDown);

            await sleep(50);

            const mouseUp = new MouseEvent('mouseup', {
                view: window,
                bubbles: true,
                cancelable: true,
                button: 0
            });
            chainButton.dispatchEvent(mouseUp);
        } catch (error) {
            log(`⚠️ 點擊鏈按鈕時出錯: ${error.message}`, 'warning');
        }

        await sleep(2000); // 增加等待時間，確保選擇生效

        // 8. 驗證選擇是否成功
        log('驗證第二個代幣是否選擇成功...', 'info');
        let selectionVerified = false;

        for (let verifyAttempt = 0; verifyAttempt < 5; verifyAttempt++) {
            if (!isRunning) {
                log('⚠️ 驗證過程已取消（程序已停止）', 'warning');
                return false;
            }

            // 確保視窗已關閉
            await ensureAllDialogsClosed(3);
            await sleep(300);

            // 檢查第二個代幣按鈕是否顯示了目標代幣名稱
            const allTokenBtns = findAllTokenSelectionButtons();
            if (allTokenBtns.length >= 2) {
                const secondBtn = allTokenBtns[1]; // 第二個按鈕（接收代幣）
                const btnText = (secondBtn.innerText || '').trim();
                const btnSpanText = (secondBtn.querySelector('span')?.innerText || '').trim();

                // 檢查按鈕是否顯示了目標代幣名稱（而不是 "Choose"）
                const hasTargetToken = btnText.includes(targetToken) || btnSpanText.includes(targetToken);
                const isNotChoose = !btnText.includes('Choose') && !btnText.includes('选择') &&
                    !btnSpanText.includes('Choose') && !btnSpanText.includes('选择');

                if (hasTargetToken && isNotChoose) {
                    log(`✓ 驗證成功：第二個代幣按鈕顯示 ${targetToken}`, 'success');
                    selectionVerified = true;
                    break;
                } else {
                    log(`驗證嘗試 ${verifyAttempt + 1}/5：按鈕文字為 "${btnText}"，等待 UI 更新...`, 'info');
                    await sleep(500);
                }
            } else {
                log(`驗證嘗試 ${verifyAttempt + 1}/5：未找到足夠的代幣按鈕，等待 UI 更新...`, 'info');
                await sleep(500);
            }
        }

        if (!selectionVerified) {
            log(`⚠️ 無法驗證第二個代幣選擇是否成功，嘗試重試選擇鏈...`, 'warning');

            // 重試一次：重新打開代幣選擇視窗並選擇鏈
            // 檢查是否還需要選擇（視窗可能已關閉）
            if (!isDialogOpen()) {
                // 如果視窗已關閉，重新點擊第二個代幣按鈕打開視窗
                const allTokenBtns = findAllTokenSelectionButtons();
                if (allTokenBtns.length >= 2) {
                    const secondBtn = allTokenBtns[1];
                    log('重新點擊第二個代幣按鈕以打開選擇視窗...', 'info');
                    secondBtn.click();
                    await sleep(CONFIG.waitAfterChoose);
                }
            }

            // 如果視窗已打開，嘗試重新選擇鏈
            if (isDialogOpen()) {
                log('重試選擇鏈...', 'info');

                // 重新查找代幣行和鏈按鈕（因為 DOM 可能已更新）
                const retryRows = document.querySelectorAll('[role="dialog"] .cursor-pointer, [role="dialog"] .relative.group');
                let retryTargetRow = null;

                for (const row of retryRows) {
                    const text = row.textContent || '';
                    const hasTarget = targetToken === 'USDT' ? text.includes('USDT') && !text.includes('USDC') :
                        text.includes('USDC') && !text.includes('USDT');
                    const hasPrice = text.includes('$');

                    if (hasTarget && hasPrice) {
                        retryTargetRow = row;
                        break;
                    }
                }

                if (retryTargetRow) {
                    // 重新 hover 到代幣行
                    retryTargetRow.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                    retryTargetRow.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                    await sleep(800);

                    // 重新查找鏈選擇菜單
                    const retryChainMenu = retryTargetRow.querySelector('.genius-shadow');
                    if (retryChainMenu) {
                        const retryChainOptions = retryChainMenu.querySelectorAll('.cursor-pointer');
                        let retryChainButton = null;

                        for (const opt of retryChainOptions) {
                            const chainNameEl = opt.querySelector('span');
                            const chainName = chainNameEl?.innerText?.trim() || '';
                            const chainNames = [CONFIG.targetChain];
                            if (CONFIG.targetChain === 'Optimism') {
                                chainNames.push('OP', 'OP Mainnet', 'Optimism', 'Optimistic Ethereum', 'Optimism Mainnet');
                            }

                            if (chainNames.some(name => chainName === name || chainName.includes(name))) {
                                retryChainButton = opt;
                                break;
                            }
                        }

                        if (retryChainButton) {
                            retryChainButton.click();
                            await sleep(2000);

                            // 再次驗證
                            await ensureAllDialogsClosed(3);
                            await sleep(500);

                            const retryAllTokenBtns = findAllTokenSelectionButtons();
                            if (retryAllTokenBtns.length >= 2) {
                                const retrySecondBtn = retryAllTokenBtns[1];
                                const retryBtnText = (retrySecondBtn.innerText || '').trim();
                                const retryBtnSpanText = (retrySecondBtn.querySelector('span')?.innerText || '').trim();
                                const retryHasTargetToken = retryBtnText.includes(targetToken) || retryBtnSpanText.includes(targetToken);
                                const retryIsNotChoose = !retryBtnText.includes('Choose') && !retryBtnText.includes('选择');

                                if (retryHasTargetToken && retryIsNotChoose) {
                                    log(`✓ 重試後驗證成功：第二個代幣按鈕顯示 ${targetToken}`, 'success');
                                    selectionVerified = true;
                                } else {
                                    log(`⚠️ 重試後仍無法驗證選擇是否成功，按鈕文字為 "${retryBtnText}"`, 'warning');
                                }
                            }
                        } else {
                            log('⚠️ 重試時未找到鏈按鈕', 'warning');
                        }
                    } else {
                        log('⚠️ 重試時未找到鏈選擇菜單', 'warning');
                    }
                } else {
                    log('⚠️ 重試時未找到代幣行', 'warning');
                }
            }

            if (!selectionVerified) {
                log(`⚠️ 無法驗證第二個代幣選擇是否成功，但繼續執行（可能是驗證邏輯的問題）`, 'warning');
            }
        }

        // 9. 確保視窗已關閉
        log('確保代幣選擇視窗已關閉...', 'info');
        await ensureAllDialogsClosed(5);
        await sleep(500);

        if (selectionVerified) {
            log(`✓ 選擇了 ${targetToken} (${CONFIG.chainDisplayName} 鏈)`, 'success');
        } else {
            log(`⚠️ 選擇了 ${targetToken} (${CONFIG.chainDisplayName} 鏈)（未驗證）`, 'warning');
        }
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
            log(`檢測失敗信號時出錯: ${error.message}`, 'warning', error);
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
            log(`檢測交易 hash 時出錯: ${error.message}`, 'warning', error);
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

    // 動態調整 Slippage 和 Priority（改進版）
    async function adjustSlippageAndPriority(isSuccess) {
        if (!CONFIG.enableDynamicAdjustment) {
            return;
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
                    log(`📉 連續成功 ${consecutiveSuccesses} 次，準備調整參數：Slippage ${currentSlippage.toFixed(4)}% → ${newSlippage.toFixed(4)}%, Priority ${currentPriority.toFixed(4)} gwei → ${newPriority.toFixed(4)} gwei`, 'info');

                    // 使用安全調整機制
                    const adjusted = await safeAdjustParameters(newSlippage, newPriority);
                    if (adjusted) {
                        currentSlippage = newSlippage;
                        currentPriority = newPriority;
                        log(`✓ 參數調整成功`, 'success');
                        UI.updateStats(); // 更新 UI 顯示
                        // 調整成功後重置計數器
                        consecutiveSuccesses = 0;
                        UI.updateStats(); // 更新連續成功次數顯示
                    } else {
                        log(`⚠️ 參數調整失敗，保留計數器以便下次重試（當前連續成功: ${consecutiveSuccesses}）`, 'warning');
                        // 調整失敗時不重置計數器，保留以便下次達到閾值時重試
                        // 但為了避免無限累積，如果連續成功次數過多，則重置
                        if (consecutiveSuccesses >= CONFIG.consecutiveSuccessThreshold * 2) {
                            log(`⚠️ 連續成功次數過多（${consecutiveSuccesses}），重置計數器以避免無限累積`, 'warning');
                            consecutiveSuccesses = CONFIG.consecutiveSuccessThreshold - 1; // 重置為接近閾值的值，以便下次快速觸發
                            UI.updateStats();
                        }
                    }
                } else {
                    // 已達到下限，重置計數器
                    log(`ℹ️ 連續成功 ${consecutiveSuccesses} 次，但參數已達下限（Slippage: ${currentSlippage.toFixed(4)}%, Priority: ${currentPriority.toFixed(4)} gwei），重置計數器`, 'info');
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
                    log(`📈 連續失敗 ${consecutiveFailures} 次，準備調整參數：Slippage ${currentSlippage.toFixed(4)}% → ${newSlippage.toFixed(4)}%, Priority ${currentPriority.toFixed(4)} gwei → ${newPriority.toFixed(4)} gwei`, 'warning');

                    // 使用安全調整機制
                    const adjusted = await safeAdjustParameters(newSlippage, newPriority);
                    if (adjusted) {
                        currentSlippage = newSlippage;
                        currentPriority = newPriority;
                        log(`✓ 參數調整成功`, 'success');
                        UI.updateStats(); // 更新 UI 顯示
                        // 調整成功後重置計數器
                        consecutiveFailures = 0;
                        UI.updateStats(); // 更新連續失敗次數顯示
                    } else {
                        log(`⚠️ 參數調整失敗，保留計數器以便下次重試（當前連續失敗: ${consecutiveFailures}）`, 'warning');
                        // 調整失敗時不重置計數器，保留以便下次達到閾值時重試
                        // 但為了避免無限累積，如果連續失敗次數過多，則重置
                        if (consecutiveFailures >= CONFIG.consecutiveFailureThreshold * 2) {
                            log(`⚠️ 連續失敗次數過多（${consecutiveFailures}），重置計數器以避免無限累積`, 'warning');
                            consecutiveFailures = CONFIG.consecutiveFailureThreshold - 1; // 重置為接近閾值的值，以便下次快速觸發
                            UI.updateStats();
                        }
                    }
                } else {
                    // 已達到上限，重置計數器
                    log(`ℹ️ 連續失敗 ${consecutiveFailures} 次，但參數已達上限（Slippage: ${currentSlippage.toFixed(4)}%, Priority: ${currentPriority.toFixed(4)} gwei），重置計數器`, 'info');
                    consecutiveFailures = 0;
                    UI.updateStats(); // 更新連續失敗次數顯示
                }
            }
        }
    }

    // 安全調整參數（帶並發控制和重試）
    async function safeAdjustParameters(slippage, priority) {
        // 如果正在調整中，記錄待處理請求
        if (isAdjusting) {
            log('⚠️ 參數調整進行中，待完成後處理', 'warning');
            pendingAdjustment = { slippage, priority };
            return false;
        }

        isAdjusting = true;

        try {
            // 最多重試 3 次
            for (let attempt = 1; attempt <= 3; attempt++) {
                if (!isRunning) {
                    log('⚠️ 程序已停止，取消參數調整', 'warning');
                    return false;
                }

                if (attempt > 1) {
                    log(`重試參數調整 (${attempt}/3)...`, 'info');
                    await sleep(2000);
                }

                const success = await applySlippageAndPriority(slippage, priority);
                if (success) {
                    return true;
                }
            }

            log('❌ 參數調整失敗（已重試 3 次）', 'error');
            return false;
        } finally {
            isAdjusting = false;
        }
    }

    // 選擇 Optimism 鏈（用於動態調整）
    async function selectOptimismChainInSettings() {
        log('檢查並選擇 Optimism 鏈...', 'info');

        // 先檢查當前是否已選擇 Optimism 鏈
        const networkButton = document.querySelector('[data-sentry-component="NetworkButton"]');
        if (networkButton) {
            const networkText = networkButton.innerText?.trim() || networkButton.textContent?.trim() || '';
            if (networkText.includes('Optimism') || networkText.includes('OP') || networkText.includes('OP Mainnet')) {
                log('✓ 當前已選擇 Optimism 鏈', 'success');
                return true;
            }
        }

        // 如果未選擇 Optimism 鏈，則選擇它
        log('當前未選擇 Optimism 鏈，開始選擇...', 'info');

        // 步驟 1: 點擊 Network 選擇按鈕
        const networkBtnClicked = await findAndClickElement([
            '[data-sentry-component="NetworkButton"]',
            { type: 'text', text: 'Solana' },
            'div[class*="border-genius-blue"][class*="cursor-pointer"]'
        ], 'Network 選擇按鈕', 1500);

        if (!networkBtnClicked) {
            log('❌ 無法點擊 Network 選擇按鈕', 'error');
            return false;
        }

        await sleep(1500);

        // 步驟 2: 查找並點擊 Optimism 鏈按鈕
        let optimismButton = null;

        // 確保 Network 選擇對話框已打開
        const networkDialog = document.querySelector('[role="dialog"][data-state="open"]');
        const hasNetworkDialog = networkDialog &&
            (networkDialog.querySelector('[data-sentry-component="NetworkButton"]') ||
                networkDialog.innerText?.includes('Network') ||
                networkDialog.innerText?.includes('Optimism') ||
                networkDialog.innerText?.includes('Solana'));

        if (!hasNetworkDialog) {
            log('⚠️ Network 選擇對話框未打開，重試...', 'warning');
            const networkBtn = document.querySelector('[data-sentry-component="NetworkButton"]');
            if (networkBtn) {
                networkBtn.click();
                await sleep(1500);
            }
        }

        // 方法1: 通過 TokenImage 查找
        const tokenImages = document.querySelectorAll('[data-sentry-component="TokenImage"]');
        for (const tokenImage of tokenImages) {
            let parent = tokenImage.parentElement;
            let attempts = 0;
            while (parent && attempts < 12) {
                const classes = typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || parent.className?.toString() || '');

                if (classes.includes('cursor-pointer') &&
                    (classes.includes('hover:bg-genius-blue') || classes.includes('rounded-sm'))) {

                    const text = parent.innerText?.trim() || parent.textContent?.trim() || '';
                    const hasOptimismText = text === 'Optimism' ||
                        (text.includes('Optimism') && !text.includes('Solana') && !text.includes('Ethereum') && text.length < 50);

                    if (hasOptimismText) {
                        const inDialog = parent.closest('[role="dialog"]');
                        if (inDialog || hasNetworkDialog) {
                            const rect = parent.getBoundingClientRect();
                            const style = window.getComputedStyle(parent);

                            if (rect.width > 0 && rect.height > 0 &&
                                style.display !== 'none' &&
                                style.visibility !== 'hidden' &&
                                parent.offsetParent !== null) {
                                optimismButton = parent;
                                log('✓ 找到 Optimism 鏈按鈕', 'info');
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

        // 方法2: 通過 span 文字查找
        if (!optimismButton) {
            const allSpans = document.querySelectorAll('span.text-genius-cream, span[class*="text-genius-cream"]');
            for (const span of allSpans) {
                const text = span.innerText?.trim() || span.textContent?.trim() || '';
                if (text === 'Optimism' || (text.toLowerCase() === 'optimism')) {
                    let parent = span.parentElement;
                    let attempts = 0;
                    while (parent && attempts < 12) {
                        const classes = typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || parent.className?.toString() || '');

                        if (classes.includes('cursor-pointer') &&
                            (classes.includes('hover:bg-genius-blue') || classes.includes('rounded-sm'))) {

                            const hasTokenImage = parent.querySelector('[data-sentry-component="TokenImage"]');
                            if (hasTokenImage) {
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

        // 方法3: 通過 div 查找
        if (!optimismButton) {
            const allDivs = document.querySelectorAll('div.cursor-pointer');
            for (const div of allDivs) {
                const text = div.innerText?.trim() || div.textContent?.trim() || '';
                if (text === 'Optimism' || (text.includes('Optimism') && !text.includes('Solana') && !text.includes('Ethereum') && text.length < 50)) {
                    const rect = div.getBoundingClientRect();
                    const style = window.getComputedStyle(div);

                    if (rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        div.offsetParent !== null) {
                        const hasTokenImage = div.querySelector('[data-sentry-component="TokenImage"]');
                        if (hasTokenImage) {
                            const inDialog = div.closest('[role="dialog"]');
                            if (inDialog || hasNetworkDialog) {
                                optimismButton = div;
                                log('✓ 通過 div 找到 Optimism 鏈按鈕', 'info');
                                break;
                            }
                        }
                    }
                }
            }
        }

        if (!optimismButton) {
            log('❌ 未找到 Optimism 鏈按鈕', 'error');
            return false;
        }

        // 點擊 Optimism 鏈按鈕
        optimismButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(400);
        optimismButton.click();
        log('✓ 點擊 Optimism 鏈按鈕', 'success');

        // 等待 UI 更新並驗證
        await sleep(2500);

        // 驗證是否成功選擇
        for (let verifyAttempt = 0; verifyAttempt < 5; verifyAttempt++) {
            const checkNetworkBtn = document.querySelector('[data-sentry-component="NetworkButton"]');
            if (checkNetworkBtn) {
                const checkText = checkNetworkBtn.innerText?.trim() || checkNetworkBtn.textContent?.trim() || '';
                if (checkText.includes('Optimism') || checkText.includes('OP') || checkText.includes('OP Mainnet')) {
                    log('✓ Optimism 鏈已成功選中', 'success');
                    return true;
                }
            }

            // 檢查對話框是否已關閉（表示已選擇）
            const currentNetworkDialog = document.querySelector('[role="dialog"][data-state="open"]');
            const stillHasNetworkDialog = currentNetworkDialog &&
                (currentNetworkDialog.querySelector('[data-sentry-component="NetworkButton"]') ||
                    currentNetworkDialog.innerText?.includes('Network') ||
                    currentNetworkDialog.innerText?.includes('Optimism') ||
                    currentNetworkDialog.innerText?.includes('Solana'));

            if (!stillHasNetworkDialog && verifyAttempt >= 2) {
                log('✓ Network 選擇對話框已關閉，假設 Optimism 鏈已選中', 'success');
                return true;
            }

            await sleep(500);
        }

        log('⚠️ Optimism 鏈選擇驗證失敗，但繼續執行', 'warning');
        return true; // 即使驗證失敗也繼續，可能是驗證邏輯的問題
    }

    // 應用 Slippage 和 Priority 設定（改進版）
    async function applySlippageAndPriority(slippage, priority) {
        let settingsWasOpen = false;

        try {
            const slippageValue = slippage.toFixed(4);
            const priorityValue = priority.toFixed(4);

            log(`開始調整參數：Slippage → ${slippageValue}%, Priority → ${priorityValue} gwei`, 'info');

            // 檢查 Settings 面板是否已打開（使用更準確的驗證方法）
            const checkSettingsPanelOpen = () => {
                // 方法1: 檢查是否有打開的dialog且包含Settings相關元素
                const dialog = document.querySelector('[role="dialog"][data-state="open"]') ||
                    document.querySelector('[role="dialog"]:not([data-state="closed"])');

                if (dialog) {
                    // 檢查dialog內是否包含Slippage或Priority元素
                    const hasSlippage = dialog.querySelector('[data-sentry-component="Slippage"]') !== null;
                    const hasPriority = dialog.querySelector('svg.lucide-fuel') !== null ||
                        dialog.innerText.includes('Priority (Gwei)');
                    const hasSettingsIcon = dialog.querySelector('svg.lucide-settings2, svg.lucide-settings-2') !== null;

                    if (hasSlippage || hasPriority || hasSettingsIcon) {
                        return true;
                    }

                    // 檢查dialog內文字是否包含Settings相關內容
                    const dialogText = dialog.innerText || '';
                    if ((dialogText.includes('Slippage') || dialogText.includes('Priority')) &&
                        (dialogText.includes('Buy') || dialogText.includes('Sell') || dialogText.includes('Network'))) {
                        return true;
                    }
                }

                // 方法2: 檢查Settings按鈕是否在dialog內（表示dialog已打開）
                const settingsIcon = document.querySelector('svg.lucide-settings2, svg.lucide-settings-2');
                if (settingsIcon) {
                    const settingsDialog = settingsIcon.closest('[role="dialog"]');
                    if (settingsDialog) {
                        const dialogState = settingsDialog.getAttribute('data-state');
                        if (dialogState !== 'closed') {
                            return true;
                        }
                    }
                }

                return false;
            };

            // 檢查 Settings 面板是否已打開
            settingsWasOpen = checkSettingsPanelOpen();
            if (settingsWasOpen) {
                log('Settings 面板已打開', 'info');
            }

            // 如果 Settings 面板未打開，則打開它
            if (!settingsWasOpen) {
                log('打開 Settings 面板...', 'info');
                const settingsBtn = await findAndClickElement([
                    { type: 'svg', class: 'lucide-settings2' },
                    { type: 'svg', class: 'lucide-settings-2' },
                    'svg[class*="lucide-settings"]'
                ], 'Settings 按鈕', 2000);

                if (!settingsBtn) {
                    log('❌ 無法打開 Settings 面板', 'error');
                    return false;
                }

                // 等待面板完全展開，並多次驗證
                let panelOpened = false;
                for (let verifyAttempt = 0; verifyAttempt < 5; verifyAttempt++) {
                    await sleep(verifyAttempt === 0 ? 2000 : 500); // 第一次等待2秒，之後每次500ms
                    panelOpened = checkSettingsPanelOpen();

                    if (panelOpened) {
                        log('✓ Settings 面板已打開', 'success');
                        break;
                    }

                    if (verifyAttempt < 4) {
                        log(`⚠️ Settings 面板驗證中（嘗試 ${verifyAttempt + 1}/5）...`, 'warning');
                    }
                }

                if (!panelOpened) {
                    log('❌ Settings 面板未成功打開（已重試 5 次）', 'error');
                    return false;
                }
            }

            // 關鍵改進：在調整參數前，先確保選擇了 Optimism 鏈
            log('確保已選擇 Optimism 鏈...', 'info');
            const chainSelected = await selectOptimismChainInSettings();
            if (!chainSelected) {
                log('⚠️ Optimism 鏈選擇失敗，但繼續嘗試調整參數', 'warning');
                // 即使鏈選擇失敗也繼續，因為可能已經在正確的鏈上
            }

            // 等待鏈選擇完成後的 UI 更新
            await sleep(1500);

            // 設定 Buy 方的參數
            log('點擊 Buy 按鈕...', 'info');
            const buyClicked = await clickBuyOrSellButton('Buy');
            if (!buyClicked) {
                log('⚠️ Buy 按鈕點擊失敗，但繼續嘗試設定參數', 'warning');
            }
            await sleep(1000);

            // 設定 Buy 方的 Slippage（統一設定，無 M.Cap）
            log(`設定 Buy 方的 Slippage 至 ${slippageValue}%...`, 'info');
            const buySlippageSuccess = await findAndSetInput([
                { type: 'text', text: 'Slippage' },
                { type: 'data-attr', attr: 'data-sentry-component', value: 'Slippage' }
            ], slippageValue, 'Buy 方的 Slippage');

            if (!buySlippageSuccess) {
                log('⚠️ Buy 方的 Slippage 設定失敗，但將繼續', 'warning');
            }

            // 設定 Buy 方的 Priority
            log(`設定 Buy 方的 Priority (Gwei) 至 ${priorityValue}...`, 'info');
            const buyPrioritySuccess = await findAndSetInput([
                { type: 'text', text: 'Priority (Gwei)' }
            ], priorityValue, 'Buy 方的 Priority (Gwei)');

            if (!buyPrioritySuccess) {
                log('❌ Buy 方的 Priority 設定失敗', 'error');
                return false;
            }

            // 驗證 Buy 方的 Priority（重試最多 3 次）
            let buyPriorityVerified = false;
            for (let i = 0; i < 3; i++) {
                await sleep(800);
                buyPriorityVerified = await verifyInputValue('Priority (Gwei)', priorityValue);
                if (buyPriorityVerified) {
                    log(`✓ Buy 方的 Priority 驗證通過: ${priorityValue} gwei`, 'success');
                    break;
                }
                if (i < 2) {
                    log(`⚠️ Buy 方的 Priority 驗證失敗，重試 ${i + 1}/3...`, 'warning');
                    await findAndSetInput([
                        { type: 'text', text: 'Priority (Gwei)' }
                    ], priorityValue, 'Buy 方的 Priority (Gwei)');
                }
            }

            if (!buyPriorityVerified) {
                log('❌ Buy 方的 Priority 驗證失敗（已重試 3 次）', 'error');
                return false;
            }

            // 設定 Sell 方的參數
            log('點擊 Sell 按鈕...', 'info');
            const sellClicked = await clickBuyOrSellButton('Sell');
            if (!sellClicked) {
                log('⚠️ Sell 按鈕點擊失敗，但繼續嘗試設定參數', 'warning');
            }
            await sleep(1000);

            // 設定 Sell 方的 Slippage（統一設定，無 M.Cap）
            log(`設定 Sell 方的 Slippage 至 ${slippageValue}%...`, 'info');
            const sellSlippageSuccess = await findAndSetInput([
                { type: 'text', text: 'Slippage' },
                { type: 'data-attr', attr: 'data-sentry-component', value: 'Slippage' }
            ], slippageValue, 'Sell 方的 Slippage');

            if (!sellSlippageSuccess) {
                log('⚠️ Sell 方的 Slippage 設定失敗，但將繼續', 'warning');
            }

            // 設定 Sell 方的 Priority
            log(`設定 Sell 方的 Priority (Gwei) 至 ${priorityValue}...`, 'info');
            const sellPrioritySuccess = await findAndSetInput([
                { type: 'text', text: 'Priority (Gwei)' }
            ], priorityValue, 'Sell 方的 Priority (Gwei)');

            if (!sellPrioritySuccess) {
                log('❌ Sell 方的 Priority 設定失敗', 'error');
                return false;
            }

            // 驗證 Sell 方的 Priority（重試最多 3 次）
            let sellPriorityVerified = false;
            for (let i = 0; i < 3; i++) {
                await sleep(800);
                sellPriorityVerified = await verifyInputValue('Priority (Gwei)', priorityValue);
                if (sellPriorityVerified) {
                    log(`✓ Sell 方的 Priority 驗證通過: ${priorityValue} gwei`, 'success');
                    break;
                }
                if (i < 2) {
                    log(`⚠️ Sell 方的 Priority 驗證失敗，重試 ${i + 1}/3...`, 'warning');
                    await findAndSetInput([
                        { type: 'text', text: 'Priority (Gwei)' }
                    ], priorityValue, 'Sell 方的 Priority (Gwei)');
                }
            }

            if (!sellPriorityVerified) {
                log('❌ Sell 方的 Priority 驗證失敗（已重試 3 次）', 'error');
                return false;
            }

            // 最終驗證 Sell 方的參數（當前應該在 Sell 模式）
            await sleep(500);
            const finalSlippageCheck = await verifyInputValue('Slippage', slippageValue);
            const finalPriorityCheck = await verifyInputValue('Priority (Gwei)', priorityValue);

            if (!finalSlippageCheck || !finalPriorityCheck) {
                log('❌ 最終驗證失敗', 'error');
                return false;
            }

            // 點擊 Save 按鈕
            log('點擊 Save 按鈕保存設定...', 'info');
            await sleep(500);
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

            if (!saveButtonClicked) {
                log('⚠️ 未找到 Save 按鈕，但將繼續執行', 'warning');
            }

            // 關閉 Settings 面板
            await sleep(500);
            const closeBtn = findCloseButton();
            if (closeBtn) {
                closeBtn.click();
                log('✓ 關閉 Settings 面板', 'success');
                await sleep(800);
            } else {
                // 如果找不到關閉按鈕，嘗試按 ESC 鍵
                log('嘗試使用 ESC 鍵關閉 Settings 面板...', 'info');
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27 }));
                await sleep(800);
            }

            log(`✓ 參數調整完成並驗證：Slippage=${slippageValue}%, Priority=${priorityValue} gwei`, 'success');
            return true;

        } catch (error) {
            log(`❌ 調整 Slippage/Priority 時出錯: ${error.message}`, 'error', error);

            // 嘗試關閉可能打開的 Settings 面板
            try {
                const closeBtn = findCloseButton();
                if (closeBtn) {
                    closeBtn.click();
                    await sleep(500);
                }
            } catch (e) {
                // 忽略清理錯誤
            }

            return false;
        }
    }

    // 驗證交易成功（舊版：使用彈窗檢測 + 多重信號檢測，現已改為備用機制）
    // 注意：此函數現在主要作為備用驗證機制，主要判斷邏輯已改為 verifySwapByTokenComparison
    async function verifySwapSuccess() {
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
            fetchWrapper = function (...args) {
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

                        response.json = async function () {
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

                    if (failureSignals.hasSlippageError) {
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

                    // 第三步：如果 SWAP pending 未完成，但檢測到成功彈窗，認為交易成功
                    if (!swapPendingCompleted) {
                        log('⚠️ SWAP pending 幣種未變化，但檢測到成功彈窗，認為交易成功', 'warning');
                        currentFromToken = expectedToToken;
                        window.fetch = originalFetch;
                        return true;
                    }

                    // 第四步：驗證幣種變化（SWAP pending 已完成）
                    if (fromTokenBeforeSwap) {
                        log('驗證幣種變化...', 'info');

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

                            log(`✓ 交易確認成功：幣種變化驗證通過`, 'success');
                            // 更新 currentFromToken 為新的發送幣
                            currentFromToken = fromTokenAfterSwap;
                            // 恢復原始 fetch
                            window.fetch = originalFetch;
                            return true;
                        } else if (fromTokenAfterSwap === fromTokenBeforeSwap) {
                            log(`⚠️ 幣種讀取未變化：${fromTokenBeforeSwap} → ${fromTokenAfterSwap}，但已檢測到成功彈窗，認為交易成功`, 'warning');
                            currentFromToken = expectedToToken;
                            window.fetch = originalFetch;
                            return true;
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

            // 最終檢查 2: 檢查幣種是否已經變化（可能彈窗沒有出現但交易已成功）
            if (fromTokenBeforeSwap) {
                const finalToken = getCurrentDisplayedFromToken();
                const expectedToToken = fromTokenBeforeSwap === 'USDT' ? 'USDC' : 'USDT';

                if (finalToken === expectedToToken) {
                    log(`✓ 最終檢查：幣種已變化 (${fromTokenBeforeSwap} → ${finalToken})，認為交易成功`, 'success');
                    currentFromToken = finalToken;
                    window.fetch = originalFetch;
                    return true;
                } else {
                    log(`⚠️ 最終檢查：幣種未變化 (${fromTokenBeforeSwap} → ${finalToken})`, 'warning');
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
        log(`安全設置: 成功驗證=${CONFIG.enableSuccessVerification}`, 'info');

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

        // 重置動態調整計數器
        if (CONFIG.enableDynamicAdjustment) {
            consecutiveSuccesses = 0;
            consecutiveFailures = 0;
            currentSlippage = CONFIG.slippageInitial;
            currentPriority = CONFIG.priorityInitial;
            log(`🔄 動態調整已重置：Slippage=${currentSlippage.toFixed(4)}%, Priority=${currentPriority.toFixed(4)} gwei`, 'info');
            UI.updateStats(); // 更新 UI 顯示
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

                // 2. 檢查是否需要選擇代幣
                // 使用 findAllTokenSelectionButtons 來查找所有按鈕（包括已選擇的）
                let allTokenBtns;
                let chooseBtns;
                try {
                    allTokenBtns = findAllTokenSelectionButtons();
                    chooseBtns = findChooseButtons();
                } catch (e) {
                    log(`查找代幣按鈕時出錯: ${e.message}`, 'error');
                    allTokenBtns = [];
                    chooseBtns = [];
                }

                // 如果找到至少一個代幣選擇按鈕（無論是否已選擇），都需要處理
                if ((allTokenBtns && allTokenBtns.length > 0) || (chooseBtns && chooseBtns.length > 0)) {
                    // 確定第一個按鈕：優先使用已選擇的按鈕（如果存在），否則使用 Choose 按鈕
                    const firstBtn = (allTokenBtns && allTokenBtns.length > 0) ? allTokenBtns[0] : (chooseBtns && chooseBtns.length > 0 ? chooseBtns[0] : null);
                    if (!firstBtn) {
                        log('無法找到有效的代幣選擇按鈕', 'error');
                        consecutiveFailures++;
                        await sleep(2000);
                        continue;
                    }
                    const isAlreadySelected = (allTokenBtns && allTokenBtns.length > 0) && (!chooseBtns || !chooseBtns.includes(firstBtn));

                    if (isAlreadySelected) {
                        log(`檢測到第一個代幣已選擇（可能需要重新選擇），開始選幣...`, 'info');
                    } else {
                        log(`檢測到 ${chooseBtns.length} 個 Choose 按鈕，開始選幣...`, 'info');
                    }

                    // 重置 currentFromToken，準備選擇新的代幣
                    currentFromToken = null;

                    // 檢查是否已停止
                    if (!isRunning) break;

                    // 點擊第一個按鈕（發送代幣），無論是否已選擇都可以點擊來重新打開選擇對話框
                    firstBtn.click();
                    log(`點擊第一個 ${isAlreadySelected ? '已選擇的代幣按鈕' : 'Choose'} (發送)`, 'info');
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

                        // 記錄本次要 SWAP 的幣種（用於下次循環比較判斷）
                        lastCycleFromToken = currentFromToken;
                        log(`📝 記錄本次循環要 SWAP 的幣種: ${lastCycleFromToken}`, 'info');
                    }

                    // 點擊第二個 Choose（接收代幣）
                    await sleep(500);

                    // 檢查是否已停止
                    if (!isRunning) break;

                    // 使用 findAllTokenSelectionButtons 來查找，確保即使第一個已經被選擇了也能找到第二個
                    let allTokenBtns2;
                    let chooseBtns2;
                    try {
                        allTokenBtns2 = findAllTokenSelectionButtons();
                        // 如果找不到，回退到使用 findChooseButtons
                        chooseBtns2 = (allTokenBtns2 && allTokenBtns2.length >= 2) ? allTokenBtns2 : findChooseButtons();
                    } catch (e) {
                        log(`查找第二個代幣按鈕時出錯: ${e.message}`, 'error');
                        allTokenBtns2 = [];
                        chooseBtns2 = findChooseButtons();
                    }

                    if (chooseBtns2 && chooseBtns2.length > 0) {
                        // 如果使用 findAllTokenSelectionButtons 且找到至少 2 個按鈕，點擊第二個
                        // 否則點擊第一個（因為 findChooseButtons 只會返回未選擇的按鈕）
                        const btnToClick = (allTokenBtns2 && allTokenBtns2.length >= 2 && chooseBtns2 === allTokenBtns2) ? chooseBtns2[1] : chooseBtns2[0];
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
                    // 注意：lastCycleFromToken 已在選擇第一個代幣完成時記錄
                    // 代幣選擇完成後，繼續執行後續的 MAX 和 Confirm 步驟，不要直接 continue
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

                    // 額外等待，確保 MAX 點擊後 UI 更新完成
                    log('⏳ 等待 MAX 點擊後的 UI 更新...', 'info');
                    await sleep(1000);
                } else if (!maxBtn) {
                    log('未找到 MAX 按鈕', 'warning');
                    consecutiveFailures++;
                    await sleep(2000);
                    continue;
                }

                // 4. 等待報價完成後點擊 Confirm
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


                let confirmClicked = false;

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

                            break;
                        } catch (error) {
                            log(`⚠️ 點擊 Confirm 時發生錯誤: ${error.message}，繼續重試...`, 'warning', error);
                            await sleep(500);
                            continue;
                        }
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

                // 注意：不再切換方向，因為下一輪循環會重新選擇代幣（選擇餘額最大的）
                // 切換方向會干擾幣種比較判斷，且沒有實際意義

                // 隨機等待後繼續下一輪
                // 注意：成功/失敗的判斷將在下一輪循環開始時透過幣種比較完成
                const randomWaitTime = randomWait(CONFIG.waitAfterTradeMin, CONFIG.waitAfterTradeMax);
                log(`✓ 交易已提交！總計: ${stats.totalSwaps} 次`, 'success');
                log(`⏳ 成功/失敗判斷將在下一輪循環開始時透過幣種比較完成`, 'info');
                log(`隨機等待 ${(randomWaitTime / 1000).toFixed(1)} 秒後繼續...`, 'info');
                await sleep(randomWaitTime);
                if (!isRunning) break; // 檢查是否在等待期間被停止

            } catch (error) {
                log(`運行出錯: ${error.message}`, 'error', error);
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


        // 停止防止暫停的機制
        stopHeartbeat();
        releaseWakeLock();

        // 重置幣種比較判斷相關的變數
        lastCycleFromToken = null;
        lastCycleConfirmed = false;

        // 重置動態調整相關的變數
        if (CONFIG.enableDynamicAdjustment) {
            isAdjusting = false;
            pendingAdjustment = null;
            log('🔄 已重置動態調整狀態', 'info');
        }

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
        position: fixed; 
        left: 20px; 
        top: 20px; 
        right: auto;
        bottom: auto;
        z-index: 999999;
        width: min(380px, calc(100vw - 40px)); 
        max-width: 380px;
        max-height: calc(100vh - 40px);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        border-radius: 16px; 
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background: linear-gradient(135deg, rgba(79, 70, 229, 0.98) 0%, rgba(99, 102, 241, 0.95) 100%);
        color: #ffffff;
        backdrop-filter: blur(12px);
        box-shadow: 0 20px 60px rgba(79, 70, 229, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.1);
        border: 2px solid rgba(255, 255, 255, 0.15);
      `;

            // Header - 重新設計為更現代的樣式
            const header = document.createElement('div');
            header.style.cssText = `
        padding: 16px 18px; display: flex; align-items: center; gap: 12px;
        background: rgba(0, 0, 0, 0.2);
        border-bottom: 2px solid rgba(255, 255, 255, 0.2);
      `;

            // 狀態指示器 - 使用更大的圓形和動畫效果
            const dot = document.createElement('span');
            dot.style.cssText = `
        width: 14px; height: 14px; border-radius: 50%;
        background: #ef4444; display: inline-block;
        box-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
        transition: all 0.3s ease;
      `;

            const titleWrap = document.createElement('div');
            titleWrap.style.cssText = `display: flex; flex-direction: column; line-height: 1.4; flex: 1; gap: 3px;`;

            const title = document.createElement('div');
            title.textContent = 'Genius AutoSwap';
            title.style.cssText = `font-weight: 800; font-size: 17px; letter-spacing: 0.5px;`;

            const author = document.createElement('div');
            author.textContent = 'B1N0RY & Keepplay 開發';
            author.style.cssText = `font-size: 13px; opacity: 0.85; font-weight: 500;`;

            const status = document.createElement('div');
            status.textContent = '已停止';
            status.style.cssText = `font-size: 14px; opacity: 0.9; font-weight: 600; margin-top: 2px;`;

            titleWrap.appendChild(title);
            titleWrap.appendChild(author);
            titleWrap.appendChild(status);

            // 按鈕 - 使用漸變和更大的尺寸
            const btn = document.createElement('button');
            btn.textContent = '開始';
            btn.style.cssText = `
        border: none; cursor: pointer; color: white;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        padding: 10px 16px; border-radius: 10px;
        font-weight: 700; font-size: 14px; 
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `;
            btn.onmouseover = () => {
                btn.style.transform = 'translateY(-2px)';
                btn.style.boxShadow = '0 6px 16px rgba(16, 185, 129, 0.4)';
            };
            btn.onmouseout = () => {
                btn.style.transform = 'translateY(0)';
                btn.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3)';
            };

            header.appendChild(dot);
            header.appendChild(titleWrap);
            header.appendChild(btn);

            // Body - 使用更寬鬆的間距和不同的背景，可滾動
            const body = document.createElement('div');
            body.style.cssText = `
        padding: 16px 18px; 
        background: rgba(0, 0, 0, 0.15);
        overflow-y: auto;
        overflow-x: hidden;
        flex: 1;
        min-height: 0;
      `;

            // 添加自定義滾動條樣式
            if (!document.getElementById('tradegenius-autopilot-scrollbar-style')) {
                const style = document.createElement('style');
                style.id = 'tradegenius-autopilot-scrollbar-style';
                style.textContent = `
        #tradegenius-autopilot-panel-body::-webkit-scrollbar {
            width: 8px;
        }
        #tradegenius-autopilot-panel-body::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
        }
        #tradegenius-autopilot-panel-body::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 4px;
        }
        #tradegenius-autopilot-panel-body::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.5);
        }
      `;
                document.head.appendChild(style);
            }

            // 為 body 添加 ID 以便樣式應用
            body.id = 'tradegenius-autopilot-panel-body';

            // 配置信息卡片 - 使用不同的樣式
            const info = document.createElement('div');
            info.style.cssText = `
        font-size: 14px; margin-bottom: 12px;
        padding: 12px; border-radius: 10px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(4px);
      `;
            info.innerHTML = `
        <div style="font-weight: 800; margin-bottom: 8px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px;">⚙️ 系統配置</div>
        <div style="margin: 4px 0; padding-left: 8px; border-left: 3px solid rgba(255, 255, 255, 0.3); font-size: 14px;">代幣配對: USDC ⇄ USDT</div>
        <div style="margin: 4px 0; padding-left: 8px; border-left: 3px solid rgba(255, 255, 255, 0.3); font-size: 14px;">區塊鏈: ${CONFIG.chainDisplayName} (Optimism)</div>
        <div style="margin: 4px 0; padding-left: 8px; border-left: 3px solid rgba(255, 255, 255, 0.3); font-size: 14px;">安全模式: ✅ 已啟用</div>
      `;

            // 統計信息卡片 - 使用網格佈局
            const statsDiv = document.createElement('div');
            statsDiv.style.cssText = `
        font-size: 13px; margin-bottom: 12px;
        padding: 12px; border-radius: 10px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(4px);
      `;
            statsDiv.innerHTML = `
        <div style="font-weight: 800; margin-bottom: 8px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px;">📊 交易統計</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
          <div style="padding: 6px; background: rgba(0, 0, 0, 0.2); border-radius: 6px;">
            <div style="opacity: 0.8; font-size: 12px; margin-bottom: 2px;">總計</div>
            <div style="font-weight: 700; font-size: 16px;"><span id="stat-total">0</span></div>
          </div>
          <div style="padding: 6px; background: rgba(0, 0, 0, 0.2); border-radius: 6px;">
            <div style="opacity: 0.8; font-size: 12px; margin-bottom: 2px;">成功</div>
            <div style="font-weight: 700; font-size: 16px; color: #34d399;"><span id="stat-success">0</span></div>
          </div>
          <div style="padding: 6px; background: rgba(0, 0, 0, 0.2); border-radius: 6px;">
            <div style="opacity: 0.8; font-size: 12px; margin-bottom: 2px;">失敗</div>
            <div style="font-weight: 700; font-size: 16px; color: #f87171;"><span id="stat-fail">0</span></div>
          </div>
          <div style="padding: 6px; background: rgba(0, 0, 0, 0.2); border-radius: 6px;">
            <div style="opacity: 0.8; font-size: 12px; margin-bottom: 2px;">連勝</div>
            <div style="font-weight: 700; font-size: 16px; color: #34d399;"><span id="stat-consecutive-success">0</span></div>
          </div>
        </div>
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.2);">
          <div style="display: flex; justify-content: space-between; margin: 4px 0; font-size: 13px;">
            <span style="opacity: 0.9;">滑點容忍度:</span>
            <span style="font-weight: 700; color: #60a5fa;"><span id="stat-slippage">${CONFIG.enableDynamicAdjustment ? CONFIG.slippageInitial.toFixed(4) : '0.0500'}%</span></span>
          </div>
          <div style="display: flex; justify-content: space-between; margin: 4px 0; font-size: 13px;">
            <span style="opacity: 0.9;">優先級費用:</span>
            <span style="font-weight: 700; color: #60a5fa;"><span id="stat-priority">${CONFIG.enableDynamicAdjustment ? CONFIG.priorityInitial.toFixed(4) : '0.0020'} gwei</span></span>
          </div>
          <div style="display: flex; justify-content: space-between; margin: 4px 0; font-size: 13px;">
            <span style="opacity: 0.9;">連續失敗:</span>
            <span style="font-weight: 700; color: #f87171;"><span id="stat-consecutive-fail">0</span></span>
          </div>
        </div>
      `;

            // 提醒信息卡片
            const noticeDiv = document.createElement('div');
            noticeDiv.style.cssText = `
        font-size: 13px; margin-bottom: 0;
        padding: 12px; border-radius: 10px;
        background: rgba(251, 191, 36, 0.15);
        border: 1px solid rgba(251, 191, 36, 0.3);
        backdrop-filter: blur(4px);
      `;
            noticeDiv.innerHTML = `
        <div style="font-weight: 800; margin-bottom: 8px; font-size: 14px; color: #fbbf24; display: flex; align-items: center; gap: 6px;">
          <span>⚠️</span>
          <span>重要提醒</span>
        </div>
        <div style="margin: 6px 0; padding-left: 8px; border-left: 2px solid rgba(251, 191, 36, 0.5); font-size: 12px; line-height: 1.5; opacity: 0.95;">
          1. 請在 <span style="color: #60a5fa; font-weight: 600;">https://www.tradegenius.com/trade</span> 頁面上使用此腳本
        </div>
        <div style="margin: 6px 0; padding-left: 8px; border-left: 2px solid rgba(251, 191, 36, 0.5); font-size: 12px; line-height: 1.5; opacity: 0.95;">
          2. 保持電腦清醒，不要進入休眠與睡眠（黑畫面或重新登入），但可以關閉螢幕
        </div>
        <div style="margin: 6px 0; padding-left: 8px; border-left: 2px solid rgba(251, 191, 36, 0.5); font-size: 12px; line-height: 1.5; opacity: 0.95;">
          3. 若有問題請詢問 <span style="color: #60a5fa; font-weight: 600;">Twitter/IG 好玩一直玩(Keepplay)</span> 或者加入以下LINE社群，並且tag 二進衛
        </div>
        <div style="margin: 6px 0; padding-left: 8px; border-left: 2px solid rgba(251, 191, 36, 0.5); font-size: 12px; line-height: 1.5; opacity: 0.95;">
          <a href="https://line.me/ti/g2/l6DdDVkz71R2S6TdCiSZll96Y2hqwTJL5wIzNQ?utm_source=invitation&utm_medium=link_copy&utm_campaign=default" target="_blank" style="color: #60a5fa; font-weight: 600; text-decoration: none; display: inline-block; margin-top: 4px; padding: 6px 12px; background: rgba(96, 165, 250, 0.1); border-radius: 6px; transition: all 0.2s ease;">
            📱 加入「好玩一直玩討論群」
          </a>
        </div>
        <div style="margin: 6px 0; padding-left: 8px; border-left: 2px solid rgba(251, 191, 36, 0.5); font-size: 12px; line-height: 1.5; opacity: 0.95;">
          4. 後續更新請持續追蹤 <a href="https://goldenrod-opera-26e.notion.site/Genius-AutoSwap-8730681db9d54a1fb21405976ffbf9e9?source=copy_link" target="_blank" style="color: #60a5fa; font-weight: 600; text-decoration: none;">https://goldenrod-opera-26e.notion.site/Genius-AutoSwap-8730681db9d54a1fb21405976ffbf9e9?source=copy_link</a>
        </div>
      `;

            // 錯誤日誌導出按鈕區域
            const exportDiv = document.createElement('div');
            exportDiv.style.cssText = `
        margin-top: 12px;
        display: flex;
        gap: 8px;
      `;

            const btnExport = document.createElement('button');
            btnExport.textContent = '📥 導出錯誤日誌';
            btnExport.style.cssText = `
        flex: 1;
        border: none;
        cursor: pointer;
        color: white;
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        padding: 10px 16px;
        border-radius: 10px;
        font-weight: 700;
        font-size: 13px;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `;
            btnExport.onmouseover = () => {
                btnExport.style.transform = 'translateY(-2px)';
                btnExport.style.boxShadow = '0 6px 16px rgba(59, 130, 246, 0.4)';
            };
            btnExport.onmouseout = () => {
                btnExport.style.transform = 'translateY(0)';
                btnExport.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.3)';
            };
            btnExport.addEventListener('click', () => exportErrorLogs());

            const btnCopy = document.createElement('button');
            btnCopy.textContent = '📋 複製日誌';
            btnCopy.style.cssText = `
        flex: 1;
        border: none;
        cursor: pointer;
        color: white;
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
        padding: 10px 16px;
        border-radius: 10px;
        font-weight: 700;
        font-size: 13px;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `;
            btnCopy.onmouseover = () => {
                btnCopy.style.transform = 'translateY(-2px)';
                btnCopy.style.boxShadow = '0 6px 16px rgba(139, 92, 246, 0.4)';
            };
            btnCopy.onmouseout = () => {
                btnCopy.style.transform = 'translateY(0)';
                btnCopy.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3)';
            };
            btnCopy.addEventListener('click', () => copyErrorLogsToClipboard());

            exportDiv.appendChild(btnExport);
            exportDiv.appendChild(btnCopy);

            body.appendChild(info);
            body.appendChild(statsDiv);
            body.appendChild(noticeDiv);
            body.appendChild(exportDiv);

            root.appendChild(header);
            root.appendChild(body);
            document.body.appendChild(root);

            // 添加視窗大小調整監聽器，確保面板始終在視窗內
            const adjustPanelPosition = () => {
                if (!root || !root.parentElement) return;
                const rect = root.getBoundingClientRect();
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;

                // 檢查右邊界
                if (rect.right > viewportWidth - 20) {
                    root.style.left = `${Math.max(20, viewportWidth - rect.width - 20)}px`;
                }

                // 檢查下邊界
                if (rect.bottom > viewportHeight - 20) {
                    root.style.top = `${Math.max(20, viewportHeight - rect.height - 20)}px`;
                }

                // 確保不會超出左邊界
                if (rect.left < 20) {
                    root.style.left = '20px';
                }

                // 確保不會超出上邊界
                if (rect.top < 20) {
                    root.style.top = '20px';
                }
            };

            // 初始調整（使用 requestAnimationFrame 確保 DOM 已渲染）
            requestAnimationFrame(() => {
                adjustPanelPosition();
                // 監聽視窗大小變化
                window.addEventListener('resize', adjustPanelPosition);
            });

            this.root = root;
            this.statusDot = dot;
            this.statusText = status;
            this.btnToggle = btn;
            this.logEl = null; // 不再顯示日誌
            this.statsEl = statsDiv;

            btn.addEventListener('click', () => this.toggle());
        },

        setRunning(running) {
            if (!this.root) return;
            this.statusDot.style.background = running ? '#10b981' : '#ef4444';
            this.statusDot.style.boxShadow = running
                ? '0 0 12px rgba(16, 185, 129, 0.8)'
                : '0 0 8px rgba(239, 68, 68, 0.6)';
            this.statusText.textContent = running ? '運行中' : '已停止';
            this.btnToggle.textContent = running ? '停止' : '開始';
            this.btnToggle.style.background = running
                ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                : 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            this.btnToggle.style.boxShadow = running
                ? '0 4px 12px rgba(239, 68, 68, 0.3)'
                : '0 4px 12px rgba(16, 185, 129, 0.3)';
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
                slippageEl.textContent = `${currentSlippage.toFixed(4)}%`;
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

    // ==================== 錯誤日誌導出功能 ====================
    function exportErrorLogs() {
        try {
            const exportData = {
                metadata: {
                    scriptName: 'TradeGenius Auto Swap - Enhanced Safety Edition',
                    version: '1.0.0',
                    exportTime: new Date().toISOString(),
                    exportTimestamp: Date.now(),
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    browserInfo: {
                        language: navigator.language,
                        platform: navigator.platform,
                        cookieEnabled: navigator.cookieEnabled,
                        onLine: navigator.onLine
                    }
                },
                config: {
                    waitAfterChoose: CONFIG.waitAfterChoose,
                    waitAfterTokenSelect: CONFIG.waitAfterTokenSelect,
                    waitAfterMax: CONFIG.waitAfterMax,
                    waitForQuoteReady: CONFIG.waitForQuoteReady,
                    waitForQuoteStable: CONFIG.waitForQuoteStable,
                    waitAfterQuoteStable: CONFIG.waitAfterQuoteStable,
                    waitAfterConfirm: CONFIG.waitAfterConfirm,
                    waitAfterClose: CONFIG.waitAfterClose,
                    waitAfterSwitch: CONFIG.waitAfterSwitch,
                    waitAfterTradeMin: CONFIG.waitAfterTradeMin,
                    waitAfterTradeMax: CONFIG.waitAfterTradeMax,
                    waitAfterSuccessPopup: CONFIG.waitAfterSuccessPopup,
                    waitForSwapPendingMax: CONFIG.waitForSwapPendingMax,
                    checkSwapPendingInterval: CONFIG.checkSwapPendingInterval,
                    swapPendingExtraRetries: CONFIG.swapPendingExtraRetries,
                    swapPendingRetryInterval: CONFIG.swapPendingRetryInterval,
                    maxRetryConfirm: CONFIG.maxRetryConfirm,
                    maxRetryTokenSelect: CONFIG.maxRetryTokenSelect,
                    maxConsecutiveFailures: CONFIG.maxConsecutiveFailures,
                    buttonLoadingTimeout: CONFIG.buttonLoadingTimeout,
                    minIntervalBetweenSwaps: CONFIG.minIntervalBetweenSwaps,
                    targetChain: CONFIG.targetChain,
                    chainDisplayName: CONFIG.chainDisplayName,
                    enableSuccessVerification: CONFIG.enableSuccessVerification,
                    enableAutoRecovery: CONFIG.enableAutoRecovery,
                    enableDynamicAdjustment: CONFIG.enableDynamicAdjustment,
                    slippageInitial: CONFIG.slippageInitial,
                    slippageMin: CONFIG.slippageMin,
                    slippageMax: CONFIG.slippageMax,
                    slippageIncreaseOnFailure: CONFIG.slippageIncreaseOnFailure,
                    slippageDecreaseOnSuccess: CONFIG.slippageDecreaseOnSuccess,
                    priorityInitial: CONFIG.priorityInitial,
                    priorityMin: CONFIG.priorityMin,
                    priorityMax: CONFIG.priorityMax,
                    priorityIncreaseOnFailure: CONFIG.priorityIncreaseOnFailure,
                    priorityDecreaseOnSuccess: CONFIG.priorityDecreaseOnSuccess,
                    consecutiveFailureThreshold: CONFIG.consecutiveFailureThreshold,
                    consecutiveSuccessThreshold: CONFIG.consecutiveSuccessThreshold,
                    debug: CONFIG.debug
                },
                currentState: {
                    isRunning: isRunning,
                    currentFromToken: currentFromToken,
                    lastSwapTime: lastSwapTime,
                    consecutiveFailures: consecutiveFailures,
                    consecutiveSuccesses: consecutiveSuccesses || 0,
                    currentSlippage: CONFIG.enableDynamicAdjustment ? currentSlippage : CONFIG.slippageInitial,
                    currentPriority: CONFIG.enableDynamicAdjustment ? currentPriority : CONFIG.priorityInitial,
                    lastCycleFromToken: lastCycleFromToken,
                    lastCycleConfirmed: lastCycleConfirmed
                },
                statistics: {
                    totalSwaps: stats.totalSwaps,
                    successfulSwaps: stats.successfulSwaps,
                    failedSwaps: stats.failedSwaps,
                    lastError: stats.lastError,
                    lastSuccessTime: stats.lastSuccessTime,
                    startTime: stats.startTime,
                    runtime: stats.startTime ? Math.floor((Date.now() - stats.startTime) / 1000) : 0
                },
                errorLogs: errorLogs.entries,
                summary: {
                    totalLogEntries: errorLogs.entries.length,
                    errorCount: errorLogs.entries.filter(e => e.type === 'error').length,
                    warningCount: errorLogs.entries.filter(e => e.type === 'warning').length,
                    infoCount: errorLogs.entries.filter(e => e.type === 'info').length,
                    successCount: errorLogs.entries.filter(e => e.type === 'success').length
                }
            };

            // 轉換為 JSON 字串
            const jsonString = JSON.stringify(exportData, null, 2);

            // 創建 Blob 並下載
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tradegenius-error-log-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            log('✅ 錯誤日誌已導出', 'success');
            return true;
        } catch (error) {
            log(`❌ 導出錯誤日誌時發生錯誤: ${error.message}`, 'error', error);
            console.error('導出錯誤日誌失敗:', error);
            return false;
        }
    }

    // 複製錯誤日誌到剪貼板（作為備選方案）
    function copyErrorLogsToClipboard() {
        try {
            const exportData = {
                metadata: {
                    scriptName: 'TradeGenius Auto Swap - Enhanced Safety Edition',
                    version: '1.0.0',
                    exportTime: new Date().toISOString(),
                    url: window.location.href
                },
                statistics: {
                    totalSwaps: stats.totalSwaps,
                    successfulSwaps: stats.successfulSwaps,
                    failedSwaps: stats.failedSwaps,
                    lastError: stats.lastError
                },
                errorLogs: errorLogs.entries.slice(-100)  // 只複製最近 100 條
            };

            const jsonString = JSON.stringify(exportData, null, 2);

            navigator.clipboard.writeText(jsonString).then(() => {
                log('✅ 錯誤日誌已複製到剪貼板', 'success');
            }).catch(err => {
                log(`❌ 複製到剪貼板失敗: ${err.message}`, 'error', err);
            });
        } catch (error) {
            log(`❌ 複製錯誤日誌時發生錯誤: ${error.message}`, 'error', error);
        }
    }

    // ==================== 初始化 ====================
    function init() {
        UI.mount();
        // 設置頁面可見性監聽器（在腳本加載時就設置，不需要等到啟動）
        setupVisibilityListener();
        log('腳本已加載。點擊「開始」按鈕開始。', 'success');
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
 * TradeGenius Auto Swap - Enhanced Safety Edition
 * 
 * Authors: B1N0RY & Keepplay
 * Version: 1.0.0
 * 
 * ============================================================
 * CREDITS & ATTRIBUTION
 * ============================================================
 * 
 * This script is based on and incorporates code from the following
 * original works:
 * 
 * 1. "TradeGenius Auto Swap - Optimism USDC/USDT"
 *    Original Author: @ferdie_jhovie
 *    Source: tradegenius_userscript.js
 *    - Token selection logic
 *    - Chain selection mechanism
 *    - Basic swap execution flow
 * 
 * 2. "Auto Swap Bot + Random Auto Refresh"
 *    Original Author: 伍壹51
 *    Source: tradegenius-autopilot.user.js
 *    - Auto refresh functionality
 *    - UI components and structure
 *    - Swap loop implementation patterns
 * 
 * We acknowledge and thank the original authors for their contributions.
 * This enhanced version builds upon their work with significant
 * improvements and additional features.
 * 
 * ============================================================
 * ENHANCED FEATURES
 * ============================================================
 * 
 * - 完善的防呆機制與風險控制
 * - 交易成功驗證（基於幣種比較）
 * - 自動恢復機制
 * - 連續失敗保護
 * - 交易頻率控制
 * - 動態調整 Slippage 和 Priority
 * - 詳細統計與日誌
 * - Preset 設定自動化
 * - 防止螢幕關閉時暫停
 * - API 請求修復補丁
 * 
 * ============================================================
 * LICENSE & USAGE
 * ============================================================
 * 
 * This script is released publicly for educational and personal use.
 * 
 * NOTICE:
 * - Removing or modifying author attribution is NOT permitted.
 * - This script is provided "as is" without warranty.
 * - Use at your own risk. The authors are not responsible for any
 *   losses or damages resulting from the use of this script.
 * - Always test thoroughly before using in production environments.
 * 
 * ============================================================
 * 
 * Copyright (c) 2024 B1N0RY & Keepplay
 * Based on works by @ferdie_jhovie and 伍壹51
 * 
 * ============================================================ */
