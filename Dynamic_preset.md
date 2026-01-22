# Dynamic Preset 設定步驟

本文檔描述 TradeGenius AutoPilot 的動態 Preset 設定流程。此模式使用動態調整的 Slippage 和 Priority 值，適用於增強版腳本。

## 概述

- **模式**: 動態調整模式
- **Slippage**: 動態值（根據交易結果自動調整）
- **Priority**: 動態值（根據交易結果自動調整）
- **鏈**: Optimism (OP)
- **總步驟數**: 11 步（不包含額外的開關設定）

**與固定 Preset 的差異**:
- 使用動態的 Slippage 和 Priority 初始值
- 不包含 Aggregator/Fast Swaps、EVM Simulations、Show Fees 等額外設定
- 設定完成後直接開始交易，參數會根據交易結果自動調整

---

## 詳細步驟

### 步驟 1: 點擊 Settings 按鈕

**說明**: 打開設定面板

**HTML 結構**:
```html
<div class="flex items-center justify-center cursor-pointer opacity-50 hover:opacity-100 px-0.5 py-[0.2rem] rounded-sm transition-opacity">
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings2 lucide-settings-2 w-4 h-4" aria-hidden="true">
    <path d="M14 17H5"></path>
    <path d="M19 7h-9"></path>
    <circle cx="17" cy="17" r="3"></circle>
    <circle cx="7" cy="7" r="3"></circle>
  </svg>
</div>
```

**識別方式**: 
- 查找包含 `lucide-settings2` 或 `lucide-settings-2` 類的 SVG 元素
- 或查找包含 `cursor-pointer` 和 `opacity-50` 的 div 元素

---

### 步驟 2: 點擊 Network 選擇按鈕

**說明**: 打開鏈選擇對話框（預設顯示 Solana）

**HTML 結構**:
```html
<div class="whitespace-nowrap w-fit cursor-pointer flex items-center gap-1.5 px-2 rounded-sm text-sm transition-all lg:hover:brightness-75 h-fit border border-genius-blue py-2 pl-2.5" 
     data-sentry-component="NetworkButton" 
     data-sentry-source-file="NetworkDropdown.tsx">
  <div class="relative overflow-hidden" data-sentry-component="ImageWithFallback">
    <img alt="solana logo" ... />
  </div>
  Solana
  <svg class="lucide lucide-chevron-down ml-auto">...</svg>
</div>
```

**識別方式**: 
- 使用 `data-sentry-component="NetworkButton"` 屬性
- 或查找包含 "Solana" 文字且帶有 `border-genius-blue` 的按鈕

---

### 步驟 3: 選擇 Optimism 鏈

**說明**: 在鏈選擇對話框中選擇 Optimism (OP) 鏈

**HTML 結構**:
```html
<div class="flex items-center gap-2 p-1 cursor-pointer hover:bg-genius-blue rounded-sm text-sm transition-colors">
  <div class="relative rounded-sm" data-sentry-component="TokenImage">
    <div class="relative overflow-hidden object-cover rounded-sm" data-sentry-component="ImageWithFallback">
      <img alt="main-image" ... src="optimism.png" />
    </div>
  </div>
  <div class="flex flex-col w-full">
    <div class="flex items-center gap-2">
      <span class="text-genius-cream capitalize">Optimism</span>
    </div>
  </div>
</div>
```

**識別方式**: 
- 查找包含 `data-sentry-component="TokenImage"` 的元素
- 向上查找包含 "Optimism" 文字且帶有 `cursor-pointer` 和 `hover:bg-genius-blue` 的父元素
- 確認在 Network 選擇對話框內（`[role="dialog"]`）

**注意事項**: 
- 必須在 Network 選擇對話框打開時才能找到此元素
- 點擊後需要等待對話框關閉並驗證鏈已切換

---

### 步驟 4: 點擊 Buy 按鈕

**說明**: 切換到 Buy 模式以設定買入參數

**HTML 結構**:
```html
<button class="inline-flex p-4 items-center justify-center whitespace-nowrap rounded-sm text-md ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:brightness-50 transition-all flex-1 h-[36px] border border-transparent lg:text-xs text-genius-green bg-genius-green/20 lg:hover:brightness-100" 
        data-sentry-element="Button" 
        data-sentry-source-file="AdvancedModeSelector.tsx">
  Buy
</button>
```

**識別方式**: 
- 查找文字為 "Buy" 的按鈕
- 確認包含 `text-genius-green` 和 `bg-genius-green/20` 類

---

### 步驟 5: 設定 Buy 方的 Slippage（為所有 M.Cap 選項設定）

**說明**: 為 Buy 方的所有 M.Cap 選項設定 Slippage 至 **動態初始值**

**重要**: 必須為每個 M.Cap 選項分別設定，不能只設定一個。

**M.Cap 選項列表**:
- `<1M` (市值小於 1M)
- `1-5M` (市值 1M 到 5M)
- `5-20M` (市值 5M 到 20M)
- `>20M` (市值大於 20M)
- `No Data` (無市值數據)

**M.Cap 選項 HTML 結構**:
```html
<div class="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[9px] text-genius-cream/50">
  M. Cap:
  <div class="flex-shrink-0 px-1 py-0.5 rounded-full border border-genius-blue cursor-pointer hover:bg-genius-blue/40 transition-colors bg-genius-blue text-genius-cream">&lt;1M</div>
  <div class="flex-shrink-0 px-1 py-0.5 rounded-full border border-genius-blue cursor-pointer hover:bg-genius-blue/40 transition-colors">1-5M</div>
  <div class="flex-shrink-0 px-1 py-0.5 rounded-full border border-genius-blue cursor-pointer hover:bg-genius-blue/40 transition-colors">5-20M</div>
  <div class="flex-shrink-0 px-1 py-0.5 rounded-full border border-genius-blue cursor-pointer hover:bg-genius-blue/40 transition-colors">&gt;20M</div>
  <div class="flex-shrink-0 px-1 py-0.5 rounded-full border border-genius-blue cursor-pointer hover:bg-genius-blue/40 transition-colors">No Data</div>
</div>
```

**詳細步驟**（對每個 M.Cap 選項重複）:

1. **點擊 M.Cap 選項**（例如 `<1M`）
   - 查找包含 "M. Cap:" 的容器
   - 在容器中查找對應的 M.Cap 選項（文字匹配）
   - 點擊該選項以激活
   - 等待 UI 更新（約 1 秒）

2. **設定 Slippage 值**
   - 查找 Slippage 輸入框
   - 設定值為動態初始值（例如 `CONFIG.slippageInitial`）
   - 驗證值已正確保存

**Slippage 輸入框 HTML 結構**:
```html
<div class="w-full flex flex-col border border-genius-blue rounded-sm">
  <div class="relative">
    <input class="flex w-full border p-3.5 ring-offset-background file:border-0 file:bg-transparent file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 py-1 border-none bg-genius-blue/40 text-center text-xs rounded-none border-b border-genius-blue" 
           value="3">
  </div>
  <div class="h-full flex justify-center items-center gap-1 py-1.5 px-2 text-[10px] uppercase leading-none opacity-50">
    <svg ... data-sentry-component="Slippage" ...>...</svg>
    Slippage  %
  </div>
</div>
```

**識別方式**: 
- 使用 `data-sentry-component="Slippage"` 屬性查找 SVG 元素
- 向上查找包含 `border-genius-blue` 的容器
- 在容器中查找 `input` 元素

**注意事項**: 
- ⚠️ **必須依次點擊每個 M.Cap 選項並設定 Slippage**
- ⚠️ 每個選項設定後需要等待 UI 更新
- ⚠️ 設定值後需要驗證是否正確保存
- ⚠️ 動態模式下，此值會根據交易結果自動調整

---

### 步驟 6: 設定 Buy 方的 Priority (Gwei)

**說明**: 設定 Buy 方的 Priority (Gwei) 至 **動態初始值**

**HTML 結構**:
```html
<div class="w-full flex flex-col border border-genius-blue rounded-sm" data-state="closed">
  <div class="relative">
    <input class="flex w-full border p-3.5 ring-offset-background file:border-0 file:bg-transparent file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 py-1 border-none bg-genius-blue/40 text-center text-xs rounded-none border-b border-genius-blue" 
           value="0.02">
    <div class="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none">
      <div class="relative overflow-hidden" data-sentry-component="ImageWithFallback">
        <img alt="native" ... src="ethereum.png" />
      </div>
    </div>
  </div>
  <div class="h-full flex justify-center items-center gap-1 py-1.5 px-2 text-[10px] uppercase leading-none opacity-50">
    <svg xmlns="http://www.w3.org/2000/svg" ... class="lucide lucide-fuel size-2.5">...</svg>
    Priority (Gwei)
  </div>
</div>
```

**識別方式**: 
- 查找包含 `lucide-fuel` 類的 SVG 元素
- 向上查找包含 `border-genius-blue` 的容器
- 在容器中查找 `input` 元素
- 或通過文字 "Priority (Gwei)" 查找

**注意事項**: 
- ⚠️ 動態模式下，此值會根據交易結果自動調整

---

### 步驟 7: 點擊 Sell 按鈕

**說明**: 切換到 Sell 模式以設定賣出參數

**HTML 結構**:
```html
<button class="inline-flex p-4 items-center justify-center whitespace-nowrap rounded-sm text-md ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:brightness-50 transition-all lg:hover:brightness-75 bg-transparent flex-1 h-[36px] border lg:text-xs text-genius-red hover:bg-genius-blue/80 border-genius-blue" 
        data-sentry-element="Button" 
        data-sentry-source-file="AdvancedModeSelector.tsx">
  Sell
</button>
```

**識別方式**: 
- 查找文字為 "Sell" 的按鈕
- 確認包含 `text-genius-red` 和 `border-genius-blue` 類

---

### 步驟 8: 設定 Sell 方的 Slippage（為所有 M.Cap 選項設定）

**說明**: 為 Sell 方的所有 M.Cap 選項設定 Slippage 至 **動態初始值**

**重要**: 與步驟 5 相同，必須為每個 M.Cap 選項分別設定。

**詳細步驟**: 與步驟 5 完全相同，但現在是在 Sell 模式下操作。

**M.Cap 選項**: `<1M`, `1-5M`, `5-20M`, `>20M`, `No Data`

**設定值**: 動態初始值（例如 `CONFIG.slippageInitial`）

**注意事項**: 
- ⚠️ **必須依次點擊每個 M.Cap 選項並設定 Slippage**
- ⚠️ 每個選項設定後需要等待 UI 更新
- ⚠️ 設定值後需要驗證是否正確保存
- ⚠️ 動態模式下，此值會根據交易結果自動調整

---

### 步驟 9: 設定 Sell 方的 Priority (Gwei)

**說明**: 設定 Sell 方的 Priority (Gwei) 至 **動態初始值**

**詳細步驟**: 與步驟 6 完全相同，但現在是在 Sell 模式下操作。

**設定值**: 動態初始值（例如 `CONFIG.priorityInitial`）

**注意事項**: 
- ⚠️ 動態模式下，此值會根據交易結果自動調整

---

### 步驟 10: 點擊 Save 按鈕

**說明**: 保存所有設定

**HTML 結構**:
```html
<button class="inline-flex p-4 items-center justify-center whitespace-nowrap rounded-sm text-md lg:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:brightness-50 transition-all lg:hover:brightness-75 bg-genius-pink text-genius-blue dark:text-genius-pink-foreground w-full py-2.5">
  Save
</button>
```

**識別方式**: 
- 查找文字為 "Save" 的按鈕
- 確認包含 `bg-genius-pink` 類

---

### 步驟 11: 關閉視窗，繼續進行交易

**說明**: 關閉設定視窗，開始執行自動交易循環

**注意事項**: 
- 設定完成後，腳本會自動關閉視窗
- 開始交易後，Slippage 和 Priority 會根據交易結果自動調整

---

## 動態調整機制

### Slippage 調整規則

- **交易成功**: 可能降低 Slippage（提高成功率）
- **交易失敗**: 可能提高 Slippage（增加成功機會）

### Priority 調整規則

- **交易成功**: 可能降低 Priority（節省 gas 費用）
- **交易失敗**: 可能提高 Priority（加快確認速度）

### 調整範圍

- 調整幅度由配置參數控制
- 有最小值和最大值限制
- 調整是漸進式的，不會突然大幅變化

---

## 重要注意事項

### M.Cap 選項設定

⚠️ **關鍵**: 必須為每個 M.Cap 選項（`<1M`, `1-5M`, `5-20M`, `>20M`, `No Data`）分別設定 Slippage，不能只設定一個。

**正確流程**:
1. 點擊第一個 M.Cap 選項（例如 `<1M`）
2. 等待 UI 更新（約 1 秒）
3. 設定 Slippage 值（動態初始值）
4. 驗證值已保存
5. 重複步驟 1-4 處理下一個 M.Cap 選項

**錯誤做法**: 
- ❌ 只設定一個 M.Cap 選項
- ❌ 不等待 UI 更新就設定下一個選項
- ❌ 不驗證值是否正確保存

### 動態調整注意事項

⚠️ **重要**: 
- 動態調整是自動進行的，無需手動干預
- 調整會根據最近的交易結果進行
- 建議監控調整後的參數值，確保在合理範圍內

### 等待時間

建議在以下操作後等待：
- 點擊 M.Cap 選項後：**1 秒**
- 設定 Slippage/Priority 後：**1 秒**
- 點擊 Save 後：**1.5 秒**

---

## 故障排除

### 找不到元素

1. **檢查頁面是否完全載入**
2. **確認 Settings 面板已打開**
3. **檢查是否在正確的模式（Buy/Sell）**
4. **確認鏈已切換到 Optimism**

### M.Cap 選項設定失敗

1. **確認已點擊 M.Cap 選項**（選項應顯示為選中狀態）
2. **等待足夠時間讓 UI 更新**
3. **重新點擊 M.Cap 選項後再設定**
4. **檢查 Slippage 輸入框是否可見且可編輯**

### 動態調整異常

1. **檢查配置參數是否正確**
2. **確認交易結果判斷邏輯正常**
3. **檢查調整範圍限制是否合理**

---

## 與固定 Preset 的比較

| 項目 | 固定 Preset | 動態 Preset |
|------|------------|-------------|
| Slippage | 固定 0.1% | 動態調整 |
| Priority | 固定 0.002 gwei | 動態調整 |
| 額外設定 | 包含 Aggregator/Fast Swaps 等 | 不包含 |
| 步驟數 | 15 步 | 11 步 |
| 適用腳本 | Simple Edition | Enhanced Edition |

---

## 總結

此 Dynamic Preset 設定流程包含 11 個步驟，主要設定：
- ✅ Optimism 鏈
- ✅ Buy/Sell 方的 Slippage（所有 M.Cap 選項，動態初始值）
- ✅ Buy/Sell 方的 Priority（動態初始值）

設定完成後，腳本將自動開始執行交易循環，並根據交易結果自動調整 Slippage 和 Priority 參數。
