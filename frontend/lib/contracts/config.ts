// SUI HypersFun Contract Configuration
// Supports both testnet and mainnet

// ============ Network Selection ============

export type NetworkType = 'testnet' | 'mainnet';

function getNetwork(): NetworkType {
  // Client-side: check localStorage first (set by NetworkSwitcher)
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('sui_network') as NetworkType;
    if (stored === 'testnet' || stored === 'mainnet') return stored;
  }
  return (process.env.NEXT_PUBLIC_SUI_NETWORK as NetworkType) || 'mainnet';
}

export const NETWORK: NetworkType = getNetwork();

// ============ Per-Network Config ============

const NETWORK_CONFIG = {
  testnet: {
    packageId: '0xd2e920ef17bde30f2a3ec7a89c3ab26d7fa8c9010074776e1d2c0e0d9fdf6c05',
    factoryId: '0x04ad2333d82bf89abf608a485cee7c2cfa734b3502bac53938a78af5cb450c46',
    adminCapId: '0x2ba0a5e3c9f2b767072ca90bffa1b888bf3e64becbea243743d013f23cec67c8',
    testVaultId: '0x352ea52814f0c2448e4676bf41b37ff9f9dfaaf1cd75712c6387c066b7bdace8',
    usdcType: '0xd2e920ef17bde30f2a3ec7a89c3ab26d7fa8c9010074776e1d2c0e0d9fdf6c05::test_usdc::TEST_USDC',
    tusdcTreasury: '0xaaf7c19379f463427a9572c3536b2be002e8067b8505cdb5f041a91441974cbd',
    rpcUrl: 'https://fullnode.testnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/testnet',
    // DeepBook V3 (testnet)
    deepbook: {
      packageId: '0xfb28c4cbc6865bd1c897d26aecbe1f8792d1509a20ffec692c800660cbec6982',
      SUI: '0x2::sui::SUI',
      USDC: '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC',
      DEEP: '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP',
    },
    // DeepBook Margin (testnet)
    margin: {
      packageId: '0xd6a42f4df4db73d68cbeb52be66698d2fe6a9464f45ad113ca52b0c6ebd918b6',
      registryId: '0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75',
      pools: {
        SUI: '0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea',
        USDC: '0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d',
        DEEP: '0x610640613f21d9e688d6f8103d17df22315c32e0c80590ce64951a1991378b55',
      },
    },
    tradingPairs: [
      {
        name: 'SUI/DBUSDC', base: 'SUI', quote: 'DBUSDC',
        baseType: '0x2::sui::SUI',
        quoteType: '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC',
        baseDecimals: 9, quoteDecimals: 6, poolKey: 'SUI_DBUSDC',
        poolId: '0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5',
      },
      {
        name: 'DEEP/DBUSDC', base: 'DEEP', quote: 'DBUSDC',
        baseType: '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP',
        quoteType: '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC',
        baseDecimals: 6, quoteDecimals: 6, poolKey: 'DEEP_DBUSDC',
        poolId: '0xe86b991f8632217505fd859445f9803967ac84a9d4a1219065bf191fcb74b622',
      },
    ],
  },
  mainnet: {
    packageId: '0x60636ee15efcdd7ec07fe009d0391ff96ae87b56cf77c08b24f6d6f00f463fdb',
    factoryId: '0x6d294bf8b1af74ef5b993ea8663898ffb59411ec2a3963842a33f9c344539df3',
    adminCapId: '0xd48c37e08610b6ccf6bd29bd9e7821aa1541cebc1fd629fc39e8d26df9eded9f',
    testVaultId: '',
    usdcType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    tusdcTreasury: '',
    rpcUrl: 'https://fullnode.mainnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/mainnet',
    // DeepBook V3 (mainnet)
    deepbook: {
      packageId: '0xf48222c4e057fa468baf136bff8e12504209d43850c5778f76159292a96f621e',
      SUI: '0x2::sui::SUI',
      USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      DEEP: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    },
    // DeepBook Margin (mainnet)
    margin: {
      packageId: '0xfbd322126f1452fd4c89aedbaeb9fd0c44df9b5cedbe70d76bf80dc086031377',
      registryId: '0x0e40998b359a9ccbab22a98ed21bd4346abf19158bc7980c8291908086b3a742',
      pools: {
        SUI: '0x53041c6f86c4782aabbfc1d4fe234a6d37160310c7ee740c915f0a01b7127344',
        USDC: '0xba473d9ae278f10af75c50a8fa341e9c6a1c087dc91a3f23e8048baf67d0754f',
        DEEP: '0x1d723c5cd113296868b55208f2ab5a905184950dd59c48eb7345607d6b5e6af7',
      },
    },
    tradingPairs: [
      {
        name: 'SUI/USDC', base: 'SUI', quote: 'USDC',
        baseType: '0x2::sui::SUI',
        quoteType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
        baseDecimals: 9, quoteDecimals: 6, poolKey: 'SUI_USDC',
        poolId: '0xe05dafb5133bcffb8d59f4e12465dc0e9faeef26b0c23571dbadf44c36a6f1f4',
      },
      {
        name: 'DEEP/USDC', base: 'DEEP', quote: 'USDC',
        baseType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
        quoteType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
        baseDecimals: 6, quoteDecimals: 6, poolKey: 'DEEP_USDC',
        poolId: '0xf948981b806057580f91622417534f491f826e1949a4e2c4132cef1e7e1b3e6e',
      },
      {
        name: 'WAL/USDC', base: 'WAL', quote: 'USDC',
        baseType: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
        quoteType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
        baseDecimals: 9, quoteDecimals: 6, poolKey: 'WAL_USDC',
        poolId: '0x1764194e32339de2caae2e3eb1b2ccec599a2dfb1f54f498e92c2c5a5d746712',
      },
      {
        name: 'DEEP/SUI', base: 'DEEP', quote: 'SUI',
        baseType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
        quoteType: '0x2::sui::SUI',
        baseDecimals: 6, quoteDecimals: 9, poolKey: 'DEEP_SUI',
        poolId: '0xb663828d6217467c8a1838a03e86a8ab95e4c5c6b1b23b97eb240aaa7e02e2c0',
      },
    ],
  },
} as const;

// ============ Active Config (based on NETWORK) ============

const activeConfig = NETWORK_CONFIG[NETWORK];

export const PACKAGE_ID = process.env.NEXT_PUBLIC_PACKAGE_ID || activeConfig.packageId;

export const MODULES = {
  FACTORY: 'sui_factory',
  VAULT: 'sui_vault',
  TRADING: 'sui_trading',
  DEEPBOOK_MOD: 'sui_deepbook',
  MARGIN: 'sui_margin',
  SEAL: 'sui_seal',
  TYPES: 'sui_types',
  MATH: 'sui_math',
} as const;

export const OBJECTS = {
  FACTORY: process.env.NEXT_PUBLIC_FACTORY_ID || activeConfig.factoryId,
  ADMIN_CAP: process.env.NEXT_PUBLIC_ADMIN_CAP_ID || activeConfig.adminCapId,
  TEST_VAULT: process.env.NEXT_PUBLIC_TEST_VAULT_ID || activeConfig.testVaultId,
  TUSDC_TREASURY: activeConfig.tusdcTreasury,
};

export const USDC = {
  TYPE: process.env.NEXT_PUBLIC_USDC_TYPE || activeConfig.usdcType,
  DECIMALS: 6,
};

export const SUI_CONFIG = {
  testnet: { rpcUrl: NETWORK_CONFIG.testnet.rpcUrl, explorerUrl: NETWORK_CONFIG.testnet.explorerUrl },
  mainnet: { rpcUrl: NETWORK_CONFIG.mainnet.rpcUrl, explorerUrl: NETWORK_CONFIG.mainnet.explorerUrl },
};

export const DEEPBOOK = activeConfig.deepbook;

export const DEEPBOOK_MARGIN = activeConfig.margin;

export const TRADING_PAIRS = activeConfig.tradingPairs;

// ============ Constants ============

export const CONSTANTS = {
  BPS: 10000,
  PRECISION: 1_000_000,
  HIGH_PRECISION: 1_000_000_000_000,
  MAX_PERFORMANCE_FEE_BPS: 3000,
  MAX_EXIT_FEE_BPS: 5000,
  DEFAULT_TWAP_HALF_LIFE: 600,
};

export const DEFAULT_BC_PARAMS = {
  bcVirtualBase: 2_000_000_000_000,
  bcVirtualTokens: 2_000_000_000_000,
  initialAssets: 100_000_000_000,
};

export const EXIT_FEE_TIERS = [
  { days: 0, bps: 1500 },
  { days: 3, bps: 800 },
  { days: 7, bps: 300 },
  { days: 30, bps: 0 },
];

// ============ Helpers ============

export function getExplorerUrl(network: 'testnet' | 'mainnet', type: 'object' | 'tx' | 'address', id: string): string {
  return `${SUI_CONFIG[network].explorerUrl}/${type}/${id}`;
}

export function formatAddress(address: string, length: number = 6): string {
  if (!address) return '';
  if (address.length <= length * 2 + 2) return address;
  return `${address.slice(0, length + 2)}...${address.slice(-length)}`;
}

export function formatUsdc(amount: bigint | number | string, decimals: number = 2): string {
  const num = typeof amount === 'bigint' ? Number(amount) : Number(amount);
  return (num / 1_000_000).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function parseUsdc(amount: string | number): bigint {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return BigInt(Math.floor(num * 1_000_000));
}

// ============ All Network Configs (for network switcher) ============

export const ALL_NETWORKS = NETWORK_CONFIG;
