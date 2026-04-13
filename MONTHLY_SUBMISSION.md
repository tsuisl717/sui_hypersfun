# SUI HypersFun - Monthly Submission

## Project Overview

**SUI HypersFun** is a CopyFund protocol migrated from HyperEVM to SUI blockchain. It enables users to invest in vault tokens managed by Leaders, featuring a bonding curve AMM mechanism for fair price discovery.

---

## Submission Details

### Primary GitHub Repository

```
https://github.com/[YOUR_USERNAME]/sui_hypersfun
```

### GitHub Username (Author)

```
[YOUR_GITHUB_USERNAME]
```

### Execution Path

- [x] **Move smart contracts**
- [x] **Application / backend integration (SDK / RPC / Indexer)**
- [ ] Developer tools / infrastructure
- [x] **Integration with Sui ecosystem infrastructure (DeepBook)**

---

## Work Completed This Month

### 1. Core Vault System (Move Smart Contracts)

Developed a complete vault system with bonding curve AMM:

| Module | Description |
|--------|-------------|
| `sui_vault.move` | Core vault logic with bonding curve, buy/sell, NAV calculation, TWAP protection |
| `sui_factory.move` | Factory for vault creation, exit fee tiers, graduation tiers |
| `sui_trading.move` | Trading module for Leader spot trading with authorization system |
| `sui_deepbook.move` | DeepBook V3 integration for external asset management |
| `sui_math.move` | Math utilities for bonding curve calculations |
| `sui_types.move` | Shared type definitions |

**Key Features Implemented:**
- Bonding Curve AMM for fair token pricing
- VaultShare NFT tokens for user ownership
- Performance Fee system (Leader earns on profits)
- Exit Fee tiers (15% → 8% → 3% → 0% over 30 days)
- TWAP NAV protection against price manipulation
- Graduation tiers for vault scaling

### 2. DeepBook V3 Integration

Integrated DeepBook V3 for Leader spot trading capabilities:

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
                              │ Leader Trade via DeepBook
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      DeepBook V3                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ SUI/USDC   │  │ WETH/USDC  │  │ DEEP/USDC  │  ...     │
│  │   Pool     │  │    Pool    │  │   Pool     │          │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

**Trading Flow:**
1. Leader creates `SuiTradingVault` (one-time setup)
2. Admin deposits USDC to trading vault
3. Leader authorizes trade → creates `TradeAuthorization` ticket
4. PTB executes: `consume_authorization` → DeepBook swap → `return_output`

**Security Features:**
- Leader can only TRADE, not WITHDRAW
- All funds return to TradingVault
- TradeAuthorization expires (configurable)
- Daily trade limits enforced
- Max trade size limits

### 3. Frontend Application (Next.js + @mysten/dapp-kit)

Built a complete frontend for vault interaction:

| Component | Description |
|-----------|-------------|
| `TradingPanel.tsx` | Buy/Sell vault tokens interface |
| `LeaderTradingPanel.tsx` | DeepBook trading for Leaders |
| `PriceChart.tsx` | Real-time price chart using lightweight-charts v5 |
| `TradeHistory.tsx` | Trade history and user shares display |

**Features:**
- Wallet connection (OKX, Sui Wallet, etc.)
- Real-time NAV and price display
- K-line and line chart modes
- Exit fee calculator
- Leader trading authorization UI

---

## Sui Stack Components Used

### DeepBook V3

**Integration Status:** ✅ Implemented

**Package IDs (Testnet):**
```
DeepBook V3 Package: 0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963571f2b0f6b168f911
Registry ID: 0x98dace830ebebd44b7a3331c00750bf758f8a4b17a27380f5bb3fbe68cb984a7
```

**Supported Trading Pairs:**
- SUI/DBUSDC
- DEEP/SUI
- DEEP/DBUSDC

---

## Integration Description

### How SUI HypersFun Integrates with DeepBook

1. **Asset Management Module (`sui_deepbook.move`)**
   - `AssetVault<T>` struct holds external assets (SUI, WETH, BTC)
   - `SwapAuthorization` provides secure swap execution
   - NAV calculation includes external asset values

2. **Trading Module (`sui_trading.move`)**
   - `SuiTradingVault` holds USDC for trading
   - `SuiLeaderTradeCap` grants trading rights to Leader
   - `TradeAuthorization` is consumed in PTB for atomic swap execution

3. **PTB (Programmable Transaction Block) Flow**
   ```
   PTB {
     1. consume_authorization_for_trade() → extracts USDC from TradingVault
     2. DeepBook.swap_exact_quote_for_base() → executes swap
     3. return_trade_output() → deposits output to AssetVault
   }
   ```

4. **Security Model**
   - Leader CANNOT withdraw funds directly
   - All swaps must go through authorization system
   - Output always returns to vault (not Leader's wallet)
   - Time-limited authorizations prevent stale trades

---

## Technical Specifications

### Smart Contract Architecture

```
sui_hypersfun/
├── sources/
│   ├── sui_vault.move      # Core vault (1124 lines)
│   ├── sui_factory.move    # Factory & settings
│   ├── sui_trading.move    # Trading authorization (573 lines)
│   ├── sui_deepbook.move   # DeepBook integration (366 lines)
│   ├── sui_math.move       # Math utilities
│   └── sui_types.move      # Type definitions
└── frontend/
    ├── app/vault/[id]/     # Vault trading page
    ├── components/         # React components
    └── lib/contracts/      # Contract config
```

### Deployed Objects (Testnet)

| Object | ID |
|--------|------|
| Package | `0x342c90eee2a578c7a3e7aca6b2be6163b349870d8e0240a2b54f1bf3bb9ba23f` |
| Factory | `0x4ed7a7caa3517e7c3abb9044b749ee980dfc2e117a0a4a21c458cdfa442c13a9` |
| Admin Cap | `0x1d6b8d86f78df8ddd43510ee198f500d8591b61b76bdae030ff63e77886fbc31` |
| Test Vault | `0xd94b15b21ba57e8bfeb54d6a302b4db865a07c9c8b90c05b64416c5d8c6ab042` |

### USDC Token (Custom Testnet)

```
Type: 0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
Decimals: 6
```

---

## Code Statistics

| Category | Files | Lines of Code |
|----------|-------|---------------|
| Move Contracts | 6 | ~2,500 |
| Frontend (TSX) | 15+ | ~3,000 |
| Test Scripts (JS) | 7 | ~1,500 |
| **Total** | **28+** | **~7,000** |

---

## Links & Resources

- **GitHub Repository:** [YOUR_REPO_URL]
- **Testnet Explorer:** https://testnet.suivision.xyz
- **DeepBook V3 Docs:** https://docs.sui.io/standards/deepbookv3-sdk

---

## SUI Testnet Perpetual Trading Exchanges (研究)

為了讓 Leader 能夠進行更多元的交易策略，我們研究了 SUI 上可用的**全鏈上**永續合約交易所：

### 全鏈上架構要求

| 交易所 | 訂單簿 | 撮合引擎 | 結算 | 架構類型 |
|--------|--------|----------|------|----------|
| **DeepBook** | ✅ 鏈上 | ✅ 鏈上 | ✅ 鏈上 | 🟢 **全鏈上** (現貨) |
| **Aftermath** | ✅ 鏈上 | ✅ 鏈上 | ✅ 鏈上 | 🟢 **全鏈上** (永續) |

> ⚠️ 只考慮全鏈上方案，鏈下訂單簿/撮合的交易所不適用

---

### Aftermath Finance (全鏈上永續合約)

**狀態:** ✅ Testnet 可用 | ✅ SDK 可用 | 🟢 **全鏈上架構**

| 項目 | 資訊 |
|------|------|
| Testnet URL | https://testnet.aftermath.finance/perpetuals |
| TypeScript SDK | [aftermath-ts-sdk](https://github.com/AftermathFinance/aftermath-ts-sdk) |
| 文檔 | https://docs.aftermath.finance/perpetuals/aftermath-perpetuals |

**全鏈上架構圖:**
```
┌─────────────────────────────────────────┐
│         ALL ON-CHAIN (全鏈上)            │
│                                          │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │ Order Book │  │ Matching Engine │   │
│  │  (on-chain) │  │   (on-chain)    │   │
│  └─────────────┘  └─────────────────┘   │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │ Settlement / Margin / Liquidation│   │
│  │      (Move Smart Contracts)      │   │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

**為什麼能全鏈上？**
- SUI Mysticeti 共識升級
- 低 Gas 費用 (negligible gas costs)
- Storage rebates 機制
- 批量訂單更新成本低

**特點:**
- ✅ 完全鏈上訂單簿 (Order book on-chain)
- ✅ 完全鏈上撮合 (Matching on-chain)
- ✅ 無需信任第三方
- ✅ 可用 PTB 原子化整合
- ✅ 整合 Router、Pools、Staking
- 支持 Crypto、Forex、Commodities

**SDK 安裝:**
```bash
npm i aftermath-ts-sdk
```

**SDK 使用:**
```typescript
import { Aftermath } from "aftermath-ts-sdk";

const af = new Aftermath("TESTNET");
await af.init();

// 獲取 Perpetuals API
const perps = af.Perpetuals();

// Get markets
const markets = await perps.getMarkets();

// Get account positions
const positions = await perps.getAccountPositions({ accountAddress: "0x..." });
```

---

## Perpetual 整合計劃

### Phase 1: Aftermath 整合 (全鏈上)

```
┌─────────────────────────────────────────────────────────────┐
│                    SUI HypersFun Vault                      │
│                                                             │
│  ┌─────────────────┐      ┌─────────────────────────────┐  │
│  │  USDC Reserve   │      │   Perpetual Positions       │  │
│  │                 │      │  ┌──────┐ ┌──────┐ ┌──────┐│  │
│  │                 │─────▶│  │BTC-P │ │ETH-P │ │SUI-P ││  │
│  └─────────────────┘      │  └──────┘ └──────┘ └──────┘│  │
│                           └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Leader Trade via Aftermath SDK
                              │ (全鏈上 PTB 整合)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Aftermath Finance (全鏈上)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ BTC-PERP   │  │ ETH-PERP   │  │ SUI-PERP   │  ...     │
│  │   Market   │  │   Market   │  │   Market   │          │
│  │ (on-chain) │  │ (on-chain) │  │ (on-chain) │          │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

**為什麼選 Aftermath？**
- ✅ 全鏈上 - 訂單簿和撮合都在 SUI 上
- ✅ 可以用 PTB 原子化整合
- ✅ 無需信任第三方伺服器
- ✅ 完全去中心化

### 需要新增的 Move 模組

```move
module sui_hypersfun::sui_perpetual {
    /// Perpetual position tracking
    public struct PerpPosition has store {
        market: String,        // e.g., "BTC-PERP"
        size: u64,            // Position size
        entry_price: u64,     // Entry price
        leverage: u8,         // 1-50x
        is_long: bool,        // Long or Short
        margin: u64,          // Collateral
        unrealized_pnl: i64,  // Unrealized P&L
    }

    /// Authorization for perpetual trade
    public struct PerpTradeAuth has key {
        id: UID,
        vault_id: ID,
        market: String,
        max_size: u64,
        max_leverage: u8,
        expires_at: u64,
    }
}
```

---

## 整合優先級

| 優先級 | 交易所 | 類型 | 架構 | 原因 |
|--------|--------|------|------|------|
| 🥇 1st | **DeepBook** | 現貨 | 🟢 全鏈上 | 原生 SUI，已整合 |
| 🥈 2nd | **Aftermath** | 永續 | 🟢 全鏈上 | 無需信任第三方，完全去中心化 |

> **原則：** 只整合全鏈上方案，確保 Leader 交易完全透明可驗證

---

## Next Steps (Planned)

1. [ ] Complete DeepBook PTB execution in frontend
2. [ ] Add price quotes from DeepBook pools
3. [ ] **Integrate Aftermath SDK for perpetual trading (全鏈上)**
4. [ ] **Add perpetual position tracking in Move contracts**
5. [ ] Implement Walrus for vault metadata storage
6. [ ] Add zkLogin for social login
7. [ ] Mainnet deployment

---

## References

### 全鏈上交易所
- [DeepBook V3 Docs](https://docs.sui.io/standards/deepbookv3-sdk)
- [Aftermath Finance Testnet Perpetuals](https://testnet.aftermath.finance/perpetuals)
- [Aftermath Perpetuals Docs](https://docs.aftermath.finance/perpetuals/aftermath-perpetuals)
- [Aftermath TypeScript SDK](https://github.com/AftermathFinance/aftermath-ts-sdk)

### 研究資料
- [SUI Perp DEX Landscape](https://www.gate.com/learn/articles/the-perp-dex-landscape-on-sui/8947)
- [Perps on Sui: Builder Discussion](https://blog.sui.io/perps-on-sui-builder-discussion/)

---

*Generated: March 2026*
