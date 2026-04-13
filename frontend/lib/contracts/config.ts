// SUI HypersFun Contract Configuration

// Package ID from deployment (testnet V4)
export const PACKAGE_ID = process.env.NEXT_PUBLIC_PACKAGE_ID || "0x342c90eee2a578c7a3e7aca6b2be6163b349870d8e0240a2b54f1bf3bb9ba23f";

// Module names
export const MODULES = {
  FACTORY: "sui_factory",
  VAULT: "sui_vault",
  TRADING: "sui_trading",
  TYPES: "sui_types",
  MATH: "sui_math",
} as const;

// Object IDs
export const OBJECTS = {
  // Factory shared object
  FACTORY: process.env.NEXT_PUBLIC_FACTORY_ID || "0x4ed7a7caa3517e7c3abb9044b749ee980dfc2e117a0a4a21c458cdfa442c13a9",
  // Admin cap - owned by deployer
  ADMIN_CAP: process.env.NEXT_PUBLIC_ADMIN_CAP_ID || "0x1d6b8d86f78df8ddd43510ee198f500d8591b61b76bdae030ff63e77886fbc31",
  // Test vault for development
  TEST_VAULT: process.env.NEXT_PUBLIC_TEST_VAULT_ID || "0xd94b15b21ba57e8bfeb54d6a302b4db865a07c9c8b90c05b64416c5d8c6ab042",
};

// SUI Network Configuration
export const SUI_CONFIG = {
  testnet: {
    rpcUrl: "https://fullnode.testnet.sui.io:443",
    explorerUrl: "https://suiscan.xyz/testnet",
  },
  mainnet: {
    rpcUrl: "https://fullnode.mainnet.sui.io:443",
    explorerUrl: "https://suiscan.xyz/mainnet",
  },
  devnet: {
    rpcUrl: "https://fullnode.devnet.sui.io:443",
    explorerUrl: "https://suiscan.xyz/devnet",
  },
};

// USDC on SUI Testnet
export const USDC = {
  TYPE: process.env.NEXT_PUBLIC_USDC_TYPE || "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
  DECIMALS: 6,
};

// Constants matching Move contract
export const CONSTANTS = {
  BPS: 10000,
  PRECISION: 1_000_000, // 1e6
  HIGH_PRECISION: 1_000_000_000_000, // 1e12
  MAX_PERFORMANCE_FEE_BPS: 3000, // 30%
  MAX_EXIT_FEE_BPS: 5000, // 50%
  DEFAULT_TWAP_HALF_LIFE: 600, // 10 minutes
};

// Default BC parameters
export const DEFAULT_BC_PARAMS = {
  bcVirtualBase: 2_000_000_000_000, // 2M USDC (6 decimals)
  bcVirtualTokens: 2_000_000_000_000, // 2M tokens
  initialAssets: 100_000_000_000, // 100K USDC
};

// Exit fee tiers (days -> bps)
export const EXIT_FEE_TIERS = [
  { days: 0, bps: 1500 },   // 0-3 days: 15%
  { days: 3, bps: 800 },    // 3-7 days: 8%
  { days: 7, bps: 300 },    // 7-30 days: 3%
  { days: 30, bps: 0 },     // 30+ days: 0%
];

// Helper function to get explorer URL
export function getExplorerUrl(network: 'testnet' | 'mainnet' | 'devnet', type: 'object' | 'tx' | 'address', id: string): string {
  const baseUrl = SUI_CONFIG[network].explorerUrl;
  return `${baseUrl}/${type}/${id}`;
}

// Helper function to format SUI address
export function formatAddress(address: string, length: number = 6): string {
  if (!address) return '';
  if (address.length <= length * 2 + 2) return address;
  return `${address.slice(0, length + 2)}...${address.slice(-length)}`;
}

// Helper function to format USDC amount (6 decimals)
export function formatUsdc(amount: bigint | number | string, decimals: number = 2): string {
  const num = typeof amount === 'bigint' ? Number(amount) : Number(amount);
  return (num / 1_000_000).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Helper function to parse USDC input to raw amount
export function parseUsdc(amount: string | number): bigint {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return BigInt(Math.floor(num * 1_000_000));
}

// DeepBook V3 Configuration (Testnet)
export const DEEPBOOK = {
  PACKAGE_ID: "0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963571f2b0f6b168f911",
  REGISTRY_ID: "0x98dace830ebebd44b7a3331c00750bf758f8a4b17a27380f5bb3fbe68cb984a7",
  // Testnet tokens
  DBUSDC: "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c::dbusdc::DBUSDC",
  SUI: "0x2::sui::SUI",
  DEEP: "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c::deep::DEEP",
};

// Supported trading pairs for DeepBook
// Note: DeepBook testnet uses DBUSDC, not our custom USDC.
// Leader trading via DeepBook requires DBUSDC-denominated pools.
export const TRADING_PAIRS = [
  {
    name: "SUI/DBUSDC",
    base: "SUI",
    quote: "DBUSDC",
    baseType: DEEPBOOK.SUI,
    quoteType: DEEPBOOK.DBUSDC,
    baseDecimals: 9,
    quoteDecimals: 6,
    poolKey: "SUI_DBUSDC",
    poolId: "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5",
  },
  {
    name: "DEEP/SUI",
    base: "DEEP",
    quote: "SUI",
    baseType: DEEPBOOK.DEEP,
    quoteType: DEEPBOOK.SUI,
    baseDecimals: 9,
    quoteDecimals: 9,
    poolKey: "DEEP_SUI",
    poolId: "0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f",
  },
  {
    name: "DEEP/DBUSDC",
    base: "DEEP",
    quote: "DBUSDC",
    baseType: DEEPBOOK.DEEP,
    quoteType: DEEPBOOK.DBUSDC,
    baseDecimals: 9,
    quoteDecimals: 6,
    poolKey: "DEEP_DBUSDC",
    poolId: "0xe86b991f8632217505fd859445f9803967ac84a9d4a1219065bf191fcb74b622",
  },
];
