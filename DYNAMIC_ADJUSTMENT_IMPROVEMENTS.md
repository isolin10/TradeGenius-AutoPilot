# 動態調整機制改進說明

## 改進概要

針對動態調整 Slippage 和 Priority 的邏輯進行了全面改進，提升了穩定性和可靠性。

---

## 主要改進項目

### 1. **並發控制機制**

#### 問題
- 調整可能在交易過程中並發執行，導致 Settings 面板狀態混亂
- 多個調整請求可能同時觸發

#### 解決方案
```javascript
let isAdjusting = false;        // 調整中標記
let pendingAdjustment = null;   // 待處理的調整請求

async function safeAdjustParameters(slippage, priority) {
    // 如果正在調整中，記錄待處理請求
    if (isAdjusting) {
        log('⚠️ 參數調整進行中，待完成後處理', 'warning');
        pendingAdjustment = { slippage, priority };
        return false;
    }
    
    isAdjusting = true;
    try {
        // 執行調整邏輯
    } finally {
        isAdjusting = false;
    }
}
```

---

### 2. **重試機制**

#### 問題
- 單次失敗就放棄，導致調整頻繁失敗
- 網絡波動或 UI 延遲可能導致臨時失敗

#### 解決方案
- **外層重試**：`safeAdjustParameters` 最多重試 3 次
- **內層重試**：Slippage 和 Priority 驗證各自重試 3 次
- 失敗時自動重新設定並驗證

```javascript
// 最多重試 3 次
for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
        log(`重試參數調整 (${attempt}/3)...`, 'info');
        await sleep(2000);
    }
    
    const success = await applySlippageAndPriority(slippage, priority);
    if (success) {
        return true;
    }
}
```

---

### 3. **Settings 面板狀態管理**

#### 問題
- 未檢查面板是否已打開就嘗試設定
- 關閉機制不完善

#### 解決方案
```javascript
// 1. 檢查 Settings 面板是否已打開
const settingsPanelCheck = document.querySelector('[class*="Settings"]') || 
                         document.querySelector('[role="dialog"]');
if (settingsPanelCheck) {
    const panelText = settingsPanelCheck.innerText || '';
    if (panelText.includes('Slippage') || panelText.includes('Priority')) {
        settingsWasOpen = true;
    }
}

// 2. 如果未打開，則打開它
if (!settingsWasOpen) {
    const settingsBtn = await findAndClickElement(...);
    await sleep(2000); // 等待面板完全展開
    
    // 驗證面板是否真的打開了
    const panelOpened = // 檢查邏輯
    if (!panelOpened) {
        return false;
    }
}

// 3. 完成後關閉面板
const closeBtn = findCloseButton();
if (closeBtn) {
    closeBtn.click();
} else {
    // 使用 ESC 鍵作為備用方案
    document.dispatchEvent(new KeyboardEvent('keydown', { 
        key: 'Escape', code: 'Escape', keyCode: 27 
    }));
}
```

---

### 4. **增強驗證機制**

#### 問題
- 驗證失敗後不重試
- 單次驗證不夠可靠

#### 解決方案

**多次驗證**：
```javascript
// 驗證 Slippage（重試最多 3 次）
let slippageVerified = false;
for (let i = 0; i < 3; i++) {
    await sleep(800);
    slippageVerified = await verifyInputValue('Slippage', slippageValue);
    if (slippageVerified) {
        log(`✓ Slippage 驗證通過: ${slippageValue}%`, 'success');
        break;
    }
    if (i < 2) {
        log(`⚠️ Slippage 驗證失敗，重試 ${i + 1}/3...`, 'warning');
        // 重新設定
        await findAndSetInput([...], slippageValue, 'Slippage');
    }
}
```

**最終驗證**：
```javascript
// 最終驗證兩者
await sleep(500);
const finalSlippageCheck = await verifyInputValue('Slippage', slippageValue);
const finalPriorityCheck = await verifyInputValue('Priority (Gwei)', priorityValue);

if (!finalSlippageCheck || !finalPriorityCheck) {
    log('❌ 最終驗證失敗', 'error');
    return false;
}
```

---

### 5. **改進日誌輸出**

#### 新增日誌
- 每個關鍵步驟都有詳細日誌
- 失敗時輸出具體原因
- 重試時顯示進度

#### 日誌示例
```
📉 連續成功 8 次，準備調整參數：Slippage 0.10% → 0.08%, Priority 0.0020 gwei → 0.0015 gwei
開始調整參數：Slippage → 0.08%, Priority → 0.0015 gwei
✓ Settings 面板已打開
設定 Slippage 至 0.08%...
✓ Slippage 驗證通過: 0.08%
設定 Priority (Gwei) 至 0.0015...
✓ Priority 驗證通過: 0.0015 gwei
✓ 關閉 Settings 面板
✓ 參數調整完成並驗證：Slippage=0.08%, Priority=0.0015 gwei
✓ 參數調整成功
```

---

### 6. **錯誤處理和清理**

#### 改進
```javascript
try {
    // 調整邏輯
    return true;
} catch (error) {
    log(`❌ 調整 Slippage/Priority 時出錯: ${error.message}`, 'error');
    
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
```

---

### 7. **停止時重置狀態**

#### 改進
```javascript
function stopSwapLoop() {
    // ... 其他停止邏輯 ...
    
    // 重置動態調整相關的變數
    if (CONFIG.enableDynamicAdjustment) {
        isAdjusting = false;
        pendingAdjustment = null;
        log('🔄 已重置動態調整狀態', 'info');
    }
}
```

---

## 流程圖

```
交易成功/失敗判斷
    ↓
更新連續成功/失敗計數
    ↓
是否達到閾值？
    ├─ 否 → 繼續交易
    └─ 是 → 計算新參數
            ↓
        是否在調整中？
            ├─ 是 → 記錄待處理請求 → 繼續交易
            └─ 否 → 開始調整
                    ↓
                重試循環（最多 3 次）
                    ↓
                檢查 Settings 面板狀態
                    ↓
                打開 Settings（如需要）
                    ↓
                設定 Slippage（重試 3 次）
                    ↓
                設定 Priority（重試 3 次）
                    ↓
                最終驗證
                    ↓
                關閉 Settings
                    ↓
                成功/失敗
```

---

## 關鍵改進點總結

| 項目 | 改進前 | 改進後 |
|------|--------|--------|
| **並發控制** | ❌ 無 | ✅ 使用 `isAdjusting` 標記 |
| **重試機制** | ❌ 單次失敗就放棄 | ✅ 外層 3 次 + 內層各 3 次 |
| **面板管理** | ⚠️ 簡單檢查 | ✅ 完整狀態檢查和驗證 |
| **驗證機制** | ⚠️ 單次驗證 | ✅ 多次驗證 + 最終驗證 |
| **日誌輸出** | ⚠️ 基本日誌 | ✅ 詳細進度和錯誤日誌 |
| **錯誤處理** | ⚠️ 基本捕獲 | ✅ 完整清理機制 |
| **狀態重置** | ❌ 未重置 | ✅ 停止時完整重置 |

---

## 使用建議

### 正常使用
- 啟用動態調整後，系統會自動根據交易成功/失敗調整參數
- 所有調整都會在日誌中詳細記錄
- UI 會即時顯示當前參數值

### 監控調整狀態
檢查以下日誌：
- `📉 連續成功 X 次...` - 準備下調參數
- `📈 連續失敗 X 次...` - 準備上調參數
- `✓ 參數調整成功` - 調整完成
- `⚠️ 參數調整失敗` - 調整失敗，將重試

### 故障排除
如果調整頻繁失敗：
1. 檢查 Settings 面板是否能正常打開
2. 檢查網絡連接是否穩定
3. 查看詳細錯誤日誌
4. 確認 UI 元素選擇器是否正確

---

## 配置參數

```javascript
CONFIG = {
    enableDynamicAdjustment: true,   // 啟用動態調整
    
    // Slippage 設置
    slippageInitial: 0.10,           // 初始 0.10%
    slippageMin: 0.05,               // 下限 0.05%
    slippageMax: 0.30,               // 上限 0.30%
    slippageIncreaseOnFailure: 0.05, // 失敗時 +0.05%
    slippageDecreaseOnSuccess: 0.02, // 成功時 -0.02%
    
    // Priority 設置
    priorityInitial: 0.002,          // 初始 0.002 gwei
    priorityMin: 0.002,              // 下限 0.002 gwei
    priorityMax: 0.01,               // 上限 0.01 gwei
    priorityIncreaseOnFailure: 0.001,// 失敗時 +0.001 gwei
    priorityDecreaseOnSuccess: 0.0005,// 成功時 -0.0005 gwei
    
    // 觸發閾值
    consecutiveFailureThreshold: 2,  // 連續失敗 2 次觸發
    consecutiveSuccessThreshold: 8,  // 連續成功 8 次觸發
}
```

---

## 結論

通過以上改進，動態調整機制現在更加穩定和可靠：
- ✅ 避免並發衝突
- ✅ 增強容錯能力
- ✅ 完善狀態管理
- ✅ 提供詳細日誌
- ✅ 確保參數正確應用

系統可以在長時間連續運行的情況下正確地進行動態調整。
