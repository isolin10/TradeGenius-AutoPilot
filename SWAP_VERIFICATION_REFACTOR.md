# SWAP 成功/失敗判斷機制重構說明

## 📅 日期
2026-01-21

## 🎯 重構目標
改進 SWAP 交易成功/失敗的判斷機制，從「基於彈窗檢測」改為「基於幣種比較」，以提高判斷的準確性和可靠性。

---

## ❌ 舊機制的問題

### 判斷方式
在交易提交後，透過以下方式判斷成功/失敗：
1. 檢測交易成功彈窗
2. 監測頁面上顯示的幣種變化
3. 驗證餘額變化

### 存在的問題
- **易受干擾**：彈窗延遲、網絡錯誤、API 500 錯誤等因素會影響判斷
- **複雜度高**：需要監聽多種信號，處理各種邊緣情況
- **時機不準**：在交易完成後立即判斷，可能頁面還沒更新完成

---

## ✅ 新機制的優勢

### 判斷原理
基於一個簡單而可靠的觀察：
- **SWAP 成功** → 幣種會切換（USDT → USDC 或 USDC → USDT）
- **SWAP 失敗** → 幣種不變（還是原來的幣種）

### 判斷方式
在**下一個交易循環開始時**，比較：
- 上一次循環要 SWAP 的幣種（`lastCycleFromToken`）
- 這一次循環要 SWAP 的幣種（`currentFromToken`）

**如果相同** → 上一次 SWAP 失敗  
**如果不同** → 上一次 SWAP 成功

### 優勢
1. **更可靠**：不依賴彈窗、不依賴網絡請求，只看實際的幣種狀態
2. **更簡單**：邏輯清晰，易於理解和維護
3. **時機更好**：在下一輪開始時判斷，此時頁面狀態已經穩定

---

## 🔧 技術實作

### 新增的全域變數

```javascript
let lastCycleFromToken = null;  // 記錄上一次交易循環開始時的發送幣種
let lastCycleConfirmed = false; // 記錄上一次循環是否執行了 Confirm
```

### 新增的判斷函數

```javascript
function verifySwapByTokenComparison()
```

**功能**：比較上一次和這一次要 SWAP 的幣種，判斷上一次交易是否成功

**返回值**：
```javascript
{
    shouldUpdate: boolean,  // 是否應該更新統計資訊
    wasSuccess: boolean     // 上一次交易是否成功
}
```

### 主流程修改

#### 1. 循環開始時進行判斷（新增）

```javascript
// 1.5. 基於幣種比較判斷上一次 SWAP 的成功/失敗
if (currentFromToken) {
    const verifyResult = verifySwapByTokenComparison();
    
    if (verifyResult.shouldUpdate) {
        if (verifyResult.wasSuccess) {
            // 上一次 SWAP 成功
            stats.successfulSwaps++;
            stats.lastSuccessTime = Date.now();
            consecutiveFailures = 0;
        } else {
            // 上一次 SWAP 失敗
            stats.failedSwaps++;
            consecutiveFailures++;
        }
        
        UI.updateStats();
        lastCycleConfirmed = false; // 重置標記
    }
}
```

#### 2. Confirm 成功後記錄資訊（修改）

```javascript
// 記錄本次循環的關鍵資訊（用於下次循環比較判斷）
lastCycleFromToken = currentFromToken;
lastCycleConfirmed = true;
stats.totalSwaps++;

log(`📝 記錄：本次交易要 SWAP ${lastCycleFromToken}，總交易次數: ${stats.totalSwaps}`, 'info');
UI.updateStats();
```

#### 3. 交易後流程簡化（修改）

**舊流程**：
```
Confirm → 等待 → verifySwapSuccess() → 根據結果更新統計 → 切換方向
```

**新流程**：
```
Confirm → 記錄資訊 → 等待 → 關閉彈窗 → 切換方向 → 進入下一輪
                                                    ↓
                                           在下一輪開始時判斷上一次的成功/失敗
```

#### 4. 停止時重置變數（新增）

```javascript
// 重置幣種比較判斷相關的變數
lastCycleFromToken = null;
lastCycleConfirmed = false;
```

---

## 📊 邏輯流程圖

```
循環 N:
  1. 開始
  2. 關閉彈窗
  3. [新增] 判斷循環 N-1 的成功/失敗（透過幣種比較）
     - 如果 lastCycleFromToken === currentFromToken → 失敗
     - 如果 lastCycleFromToken !== currentFromToken → 成功
  4. 選擇代幣（如果需要）
  5. 點擊 MAX
  6. 點擊 Confirm
     - 記錄 lastCycleFromToken = currentFromToken
     - 設置 lastCycleConfirmed = true
     - 增加 totalSwaps
  7. 等待、關閉彈窗、切換方向
  8. 進入循環 N+1

循環 N+1:
  1. 開始
  2. 關閉彈窗
  3. [新增] 判斷循環 N 的成功/失敗
     ...
```

---

## 🔄 與舊機制的比較

| 項目 | 舊機制 | 新機制 |
|-----|-------|-------|
| **判斷時機** | 交易提交後立即判斷 | 下一輪循環開始時判斷 |
| **判斷依據** | 彈窗、幣種變化、餘額變化 | 幣種比較 |
| **可靠性** | 易受彈窗、網絡等因素干擾 | 只看實際幣種狀態，更可靠 |
| **複雜度** | 高（需處理多種信號和邊緣情況） | 低（邏輯簡單清晰） |
| **執行效率** | 需要等待並監聽多種事件 | 只需簡單比較 |

---

## 📝 注意事項

1. **首次交易**：首次交易時沒有上一次的記錄，不會進行判斷，這是正常的
2. **Confirm 失敗**：如果 Confirm 按鈕沒有成功點擊，不會增加 `totalSwaps`，也不會記錄 `lastCycleFromToken`
3. **停止/重啟**：停止程式時會重置所有記錄變數，重啟後視為首次交易
4. **舊函數保留**：`verifySwapSuccess()` 函數已不再使用，但保留在程式碼中供參考

---

## 🧪 測試建議

1. **正常流程**：運行多次交易，觀察統計是否正確更新
2. **失敗情況**：手動製造失敗（如餘額不足），觀察下一輪是否正確判斷為失敗
3. **成功情況**：正常交易成功，觀察下一輪是否正確判斷為成功
4. **首次交易**：啟動後的首次交易應該跳過判斷
5. **停止/重啟**：停止後重啟，應該視為首次交易

---

## 📚 相關文件

- `SWAP_VERIFICATION_IMPROVEMENTS.md` - 之前的改進記錄
- `tradegenius-autopilot-enhanced.user.js` - 主程式文件

---

## ✨ 總結

這次重構透過改變判斷機制的時機和方式，大幅提升了 SWAP 成功/失敗判斷的準確性和可靠性。新機制基於簡單而可靠的邏輯：**如果下一次還要 SWAP 同樣的幣種，代表上一次沒有成功**。這種方式不受彈窗、網絡等外部因素影響，是一個更優雅、更可靠的解決方案。
