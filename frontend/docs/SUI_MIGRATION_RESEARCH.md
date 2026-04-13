# HypersFun → SUI 區塊鏈遷移研究報告

## 目錄
1. [現有架構概述](#現有架構概述)
2. [SUI 遷移可行性分析](#sui-遷移可行性分析)
3. [Hyperliquid Perps 替代方案](#hyperliquid-perps-替代方案)
4. [Aftermath Finance 深度研究](#aftermath-finance-深度研究)
5. [技術遷移評估](#技術遷移評估)
6. [結論與建議](#結論與建議)

---

## 現有架構概述

### HypersFun CopyFundFi Protocol 架構

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                        │
│                     TypeScript + React + Wagmi                   │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         HyperEVM Layer                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ HyperFunFactory │  │  HyperFunToken  │  │ HyperFunTrading │  │
│  │   (工廠合約)     │  │   (基金代幣)     │  │   (交易模組)     │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
│           └────────────────────┼────────────────────┘            │
│                                │                                 │
│                                ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Hyperliquid L1 Precompiles                      │ │
│  │    (永續合約交易、槓桿、倉位管理、訂單執行)                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 核心智能合約功能

#### 1. HyperFunFactory.sol
- 創建新的基金代幣 (Vault)
- 管理所有已部署的基金
- 設定協議費用

#### 2. HyperFunToken.sol
- ERC20 代幣標準
- **Bonding Curve AMM 定價** (x * y = k)
- NAV-anchored 價格機制
- 買入/賣出手續費
- 時間基礎退出費用 (防止套利)

#### 3. HyperFunTrading.sol
- **Hyperliquid L1 Precompile 整合** (關鍵依賴)
- 永續合約交易執行
- 倉位管理 (開倉/平倉)
- 槓桿設定 (最高 50x)
- PnL 計算與同步

---

## SUI 遷移可行性分析

### 整體評估

| 層級 | 可重用性 | 說明 |
|------|---------|------|
| Frontend | 60-70% | UI 組件可重用，需更換 Wagmi → SUI SDK |
| 業務邏輯 | 70-80% | Bonding Curve、NAV 計算邏輯可移植 |
| 智能合約 | 0% | 需完全重寫為 Move 語言 |
| Perps 整合 | 100% 重做 | Hyperliquid Precompile → SUI DEX |

### 前端遷移

```typescript
// 現有 (EVM/Wagmi)
import { useAccount, useContractWrite } from 'wagmi'

// 遷移後 (SUI)
import { useWallet, useSuiClient } from '@mysten/dapp-kit'
import { TransactionBlock } from '@mysten/sui.js'
```

**需更換的庫：**
- `wagmi` → `@mysten/dapp-kit`
- `viem` → `@mysten/sui.js`
- `ethers` → SUI SDK

### 智能合約遷移

**Solidity → Move 語言差異：**

| 特性 | Solidity (EVM) | Move (SUI) |
|------|---------------|------------|
| 資源模型 | 帳戶餘額 | Object-based |
| 所有權 | 隱式 | 顯式 (線性類型) |
| 存儲 | Storage slots | Objects with UID |
| 繼承 | 支援 | 不支援 (用 Abilities) |
| 可升級性 | Proxy pattern | Package upgrades |

**範例對比：**

```solidity
// Solidity - HyperFunToken.sol
function buy(uint256 usdcAmount) external {
    USDC.transferFrom(msg.sender, address(this), usdcAmount);
    uint256 tokens = calculateTokensOut(usdcAmount);
    _mint(msg.sender, tokens);
}
```

```move
// Move (SUI) - 等效實現
public entry fun buy(
    vault: &mut Vault,
    payment: Coin<USDC>,
    ctx: &mut TxContext
) {
    let tokens_out = calculate_tokens_out(vault, coin::value(&payment));
    coin::put(&mut vault.reserve, payment);
    let tokens = coin::mint(&mut vault.treasury, tokens_out, ctx);
    transfer::public_transfer(tokens, tx_context::sender(ctx));
}
```

---

## Hyperliquid Perps 替代方案

### SUI 上的 DEX 選項比較

| 項目 | 類型 | 永續合約 | 全鏈上 | 可整合性 |
|------|------|---------|-------|---------|
| **Aftermath Finance** | CLOB | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| Cetus | AMM | ❌ | ✅ | ⭐⭐ |
| Turbos | AMM | ❌ | ✅ | ⭐⭐ |
| DeepBook | Orderbook | ❌ | ✅ | ⭐⭐⭐ |
| BlueFin | CLOB | ✅ | ❌ (Off-chain) | ⭐⭐ |

### 推薦方案：Aftermath Finance Perpetuals

**為什麼選 Aftermath：**

1. **全鏈上 CLOB** - 與 Hyperliquid 架構最接近
2. **已上線運營** - https://aftermath.finance/perpetuals
3. **支援主流資產** - BTC, ETH, SUI 等
4. **槓桿支援** - 與現有 50x 槓桿需求匹配
5. **Move 合約** - 可直接整合

---

## Aftermath Finance 深度研究

### 架構概述

```
┌─────────────────────────────────────────────────────────────────┐
│                    Aftermath Finance on SUI                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐│
│  │   Spot AMM    │  │   Staking     │  │  Perpetuals (CLOB)    ││
│  │  (現貨交易)    │  │   (質押)      │  │  (永續合約 - 目標)    ││
│  └───────────────┘  └───────────────┘  └───────────────────────┘│
│                                                                  │
│  基礎設施：DeepBook (SUI 原生訂單簿)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Perpetuals 功能

- **訂單類型：** 市價單、限價單
- **槓桿：** 可配置 (需確認最高倍數)
- **保證金：** USDC
- **清算：** 鏈上自動清算
- **資金費率：** 每 8 小時結算

### 整合方式

```move
// 概念性整合代碼
module hypersfun::trading {
    use aftermath::perpetuals;

    public entry fun open_position(
        vault: &mut Vault,
        market: &mut PerpMarket,
        side: bool,        // true = long, false = short
        size: u64,
        leverage: u64,
        ctx: &mut TxContext
    ) {
        // 驗證調用者是 vault manager
        assert!(is_vault_manager(vault, ctx), E_NOT_MANAGER);

        // 從 vault 取出保證金
        let margin = coin::split(&mut vault.reserve, calculate_margin(size, leverage), ctx);

        // 調用 Aftermath perpetuals 開倉
        perpetuals::open_position(market, side, size, margin, ctx);

        // 記錄倉位到 vault
        record_position(vault, market_id, side, size, leverage);
    }
}
```

### DeepBook 基礎設施

Aftermath Perpetuals 底層使用 **DeepBook** - SUI 的原生訂單簿協議：

```move
// DeepBook 訂單簿結構
struct OrderBook has key {
    id: UID,
    bids: CritbitTree<Order>,  // 買單
    asks: CritbitTree<Order>,  // 賣單
    tick_size: u64,
    lot_size: u64,
}
```

**優勢：**
- 全鏈上訂單匹配
- 低延遲 (SUI ~400ms 出塊)
- 高吞吐量 (SUI 並行執行)
- 原生 Move 整合

---

## 技術遷移評估

### 遷移工作量估算

| 組件 | 工作量 | 複雜度 | 風險 |
|------|-------|--------|------|
| Move 合約開發 | 4-6 週 | 高 | 中 |
| 前端 SUI 整合 | 2-3 週 | 中 | 低 |
| Aftermath 整合 | 2-3 週 | 高 | 高 |
| 測試與審計 | 3-4 週 | 中 | 中 |
| **總計** | **11-16 週** | - | - |

### 關鍵技術挑戰

#### 1. Bonding Curve 遷移
```move
// SUI Move 實現 x*y=k
public fun calculate_tokens_out(
    reserve_usdc: u64,
    reserve_tokens: u64,
    usdc_in: u64
): u64 {
    let k = (reserve_usdc as u128) * (reserve_tokens as u128);
    let new_reserve_usdc = reserve_usdc + usdc_in;
    let new_reserve_tokens = (k / (new_reserve_usdc as u128)) as u64;
    reserve_tokens - new_reserve_tokens
}
```

#### 2. NAV 計算與同步
- 需要從 Aftermath 讀取實時 PnL
- 可能需要 Oracle 輔助

#### 3. 跨合約調用
- SUI 使用 Object-based 模型
- 需要仔細設計權限和所有權

### 遷移路線圖

```
Phase 1: 研究與設計 (2 週)
├── Aftermath SDK 深度研究
├── Move 合約架構設計
└── 技術可行性驗證

Phase 2: 核心合約開發 (4 週)
├── Vault 合約 (Bonding Curve)
├── Trading 合約 (Aftermath 整合)
└── Factory 合約

Phase 3: 前端遷移 (3 週)
├── SUI SDK 整合
├── Wallet 連接
└── 交易流程

Phase 4: 測試與審計 (3 週)
├── 測試網部署
├── 安全審計
└── Bug 修復

Phase 5: 主網上線 (1 週)
├── 主網部署
├── 流動性遷移
└── 用戶遷移
```

---

## 結論與建議

### 可行性結論

**SUI 遷移是可行的**，但需要：

1. ✅ **全新 Move 合約開發** - 無法移植 Solidity
2. ✅ **Aftermath Finance 作為 Perps 層** - 功能對標 Hyperliquid
3. ✅ **前端重構** - Wagmi → SUI SDK
4. ⚠️ **3-4 個月開發週期**
5. ⚠️ **新的安全審計**

### 優勢

| 方面 | HyperEVM | SUI |
|------|----------|-----|
| TPS | ~10,000 | ~100,000+ |
| 出塊時間 | ~1s | ~400ms |
| Gas 費 | 低 | 極低 |
| 生態系統 | 新興 | 快速成長 |
| 開發者工具 | 成熟 (EVM) | 改進中 |

### 劣勢/風險

1. **Move 語言學習曲線** - 團隊需要學習新語言
2. **Aftermath 依賴風險** - 依賴第三方協議
3. **用戶遷移成本** - 需要用戶切換錢包
4. **流動性分散** - 兩條鏈分散流動性

### 建議

**短期 (0-3 個月)：**
- 繼續優化 HyperEVM 版本
- 監控 Aftermath Finance 發展
- 小規模 PoC 驗證

**中期 (3-6 個月)：**
- 如果 SUI 生態持續成長，啟動正式遷移
- 優先開發核心 Vault 合約
- 與 Aftermath 團隊建立合作

**長期：**
- 多鏈部署 (HyperEVM + SUI)
- 跨鏈流動性橋接

---

## 參考資源

- [Aftermath Finance](https://aftermath.finance)
- [Aftermath Perpetuals](https://aftermath.finance/perpetuals)
- [SUI Documentation](https://docs.sui.io)
- [Move Language](https://move-language.github.io/move/)
- [DeepBook](https://deepbook.tech)
- [SUI dApp Kit](https://sdk.mystenlabs.com/dapp-kit)

---

*文檔更新日期：2026-03-19*
*版本：1.0*
