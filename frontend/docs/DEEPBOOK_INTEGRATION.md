# DeepBook Integration Plan

## Overview

整合 DeepBook V3 讓 Leader 可以用 Vault 資金進行現貨交易。

## 架構設計

```
┌─────────────────────────────────────────────────────────────┐
│                        SuiVault                             │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │  USDC Reserve   │  │     External Assets             │  │
│  │  (for buy/sell) │  │  ┌─────┐ ┌─────┐ ┌─────┐       │  │
│  └─────────────────┘  │  │ SUI │ │WETH │ │ BTC │  ...  │  │
│                       │  └─────┘ └─────┘ └─────┘       │  │
│                       └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Leader Trade
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      DeepBook V3                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ SUI/USDC   │  │ WETH/USDC  │  │ DEEP/USDC  │  ...     │
│  │   Pool     │  │    Pool    │  │   Pool     │          │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## DeepBook V3 關鍵信息

### Package ID
- **V2 (Legacy)**: `0xdee9`
- **V3 (Current)**: 需要從 SDK 獲取最新地址

### 主要函數

#### Swap (不需要 BalanceManager)
```move
public fun swap_exact_base_for_quote<BaseAsset, QuoteAsset>(
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    base_in: Coin<BaseAsset>,
    deep_in: Coin<DEEP>,
    min_quote_out: u64,
    clock: &Clock,
    ctx: &mut TxContext
): (Coin<BaseAsset>, Coin<QuoteAsset>, Coin<DEEP>)

public fun swap_exact_quote_for_base<BaseAsset, QuoteAsset>(
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    quote_in: Coin<QuoteAsset>,
    deep_in: Coin<DEEP>,
    min_base_out: u64,
    clock: &Clock,
    ctx: &mut TxContext
): (Coin<BaseAsset>, Coin<QuoteAsset>, Coin<DEEP>)
```

#### Place Orders (需要 BalanceManager)
```move
public fun place_market_order<BaseAsset, QuoteAsset>(
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    balance_manager: &mut BalanceManager,
    trade_proof: &TradeProof,
    client_order_id: u64,
    self_matching_option: u8,
    quantity: u64,
    is_bid: bool,
    pay_with_deep: bool,
    clock: &Clock,
    ctx: &TxContext
): OrderInfo
```

### 可用交易對 (Mainnet)
- SUI/USDC
- WETH/USDC
- USDT/USDC
- DEEP/USDC
- DEEP/SUI

### 可用交易對 (Testnet)
- SUI/DBUSDC
- DBUSDT/DBUSDC
- DEEP/SUI

## 實現方案

### Phase 1: 基礎 Swap 功能

1. **新增 MultiAssetVault 結構**
   - 持有多種資產餘額
   - 追蹤每種資產的數量

2. **實現 PTB 交易流程**
   ```
   1. Leader 調用 authorize_swap()
   2. PTB 組合:
      a. consume_swap_authorization() -> 取出 USDC
      b. DeepBook.swap_exact_quote_for_base() -> 換成目標資產
      c. deposit_asset() -> 存入目標資產
   ```

3. **NAV 計算更新**
   - 讀取所有外部資產餘額
   - 從 DeepBook 獲取價格
   - 計算總資產價值

### Phase 2: 進階功能

1. **限價單支持**
2. **止損/止盈**
3. **自動再平衡**

## 代幣類型定義

### Mainnet
```move
// SUI
0x2::sui::SUI

// USDC (Circle)
0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN

// WETH
0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN

// DEEP
0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP
```

### Testnet
```move
// SUI
0x2::sui::SUI

// DBUSDC (DeepBook Test USDC)
0x<testnet_address>::dbusdc::DBUSDC

// DEEP
0x<testnet_address>::deep::DEEP
```

## 安全考量

1. **資金安全**
   - Leader 只能交易，不能提款
   - 所有資產留在 Vault 內

2. **滑點保護**
   - 每筆交易設定最小輸出量
   - 超過滑點限制則 revert

3. **交易限制**
   - 單筆交易上限
   - 每日交易總額上限

## 下一步

1. [ ] 研究 DeepBook V3 SDK 獲取準確的 Package ID 和 Pool 地址
2. [ ] 創建 sui_deepbook.move 模組
3. [ ] 更新 sui_vault.move 支持多資產 NAV
4. [ ] 前端整合交易界面
