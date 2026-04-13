# SUI HypersFun

A CopyFund protocol on SUI blockchain that enables users to invest in vault tokens managed by Leaders, featuring a bonding curve AMM mechanism for fair price discovery.

Migrated from HyperEVM to SUI.

## Architecture

```
sui_hypersfun/
├── sources/
│   ├── sui_vault.move       # Core vault: bonding curve AMM, buy/sell, NAV, TWAP
│   ├── sui_factory.move     # Factory for vault creation, fee tiers, graduation
│   ├── sui_trading.move     # Leader spot trading with authorization system
│   ├── sui_deepbook.move    # DeepBook V3 integration for external asset mgmt
│   ├── sui_math.move        # Math utilities for bonding curve calculations
│   └── sui_types.move       # Shared type definitions
└── frontend/                # Next.js + @mysten/dapp-kit frontend
```

## Key Features

- **Bonding Curve AMM** - Fair token pricing with automatic price discovery
- **VaultShare NFTs** - Transferable ownership tokens for vault positions
- **Performance Fee** - Leaders earn on profits generated for investors
- **Exit Fee Tiers** - Graduated fees (15% -> 8% -> 3% -> 0%) over 30 days to discourage short-term flipping
- **TWAP NAV Protection** - Time-weighted average price to prevent manipulation
- **Graduation Tiers** - Vault scaling as AUM grows
- **DeepBook V3 Integration** - Leader spot trading through on-chain order book
- **Authorization System** - Leaders can trade but never withdraw funds directly

## How It Works

```
Users ──► Buy VaultShare (Bonding Curve) ──► Vault holds USDC
                                                │
Leader ──► Authorized Trading ──► DeepBook V3 ──► Returns to Vault
                                                │
Users ──► Sell VaultShare ──► Exit Fee applied ──► Receive USDC
```

**Security Model:**
- Leaders can only TRADE, not WITHDRAW
- All swap outputs return to the vault, not the Leader's wallet
- Trade authorizations are time-limited and size-capped
- Daily trade limits enforced on-chain

## Sui Ecosystem Integration

| Component | Usage |
|-----------|-------|
| **Move Smart Contracts** | Core protocol logic (6 modules, ~2500 LOC) |
| **DeepBook V3** | On-chain spot trading for Leaders |

## Deployed Contracts (Testnet)

| Object | ID |
|--------|------|
| Package | `0x342c90eee2a578c7a3e7aca6b2be6163b349870d8e0240a2b54f1bf3bb9ba23f` |
| Factory | `0x4ed7a7caa3517e7c3abb9044b749ee980dfc2e117a0a4a21c458cdfa442c13a9` |
| Admin Cap | `0x1d6b8d86f78df8ddd43510ee198f500d8591b61b76bdae030ff63e77886fbc31` |

## Getting Started

### Prerequisites

- [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) (v1.68.0+)
- [Node.js](https://nodejs.org/) (v18+)

### Build Contracts

```bash
sui move build
```

### Run Frontend

```bash
cd frontend
npm install
npm run dev
```

## License

MIT
