// Walrus Decentralized Storage Integration
// Uses REST API for blob upload/download - no SDK dependency needed

const WALRUS_CONFIG = {
  testnet: {
    aggregator: 'https://aggregator.walrus-testnet.walrus.space',
    publisher: 'https://publisher.walrus-testnet.walrus.space',
  },
  mainnet: {
    aggregator: 'https://aggregator.walrus.space',
    publisher: 'https://publisher.walrus.space',
  },
};

const network = (process.env.NEXT_PUBLIC_WALRUS_NETWORK || 'testnet') as 'testnet' | 'mainnet';
const config = WALRUS_CONFIG[network];

// ============ Types ============

export interface VaultTradeRecord {
  vaultId: string;
  txDigest: string;
  timestamp: number;
  type: 'buy' | 'sell' | 'spot_swap' | 'margin_long' | 'margin_short' | 'margin_close';
  inputAmount: number;
  outputAmount: number;
  asset?: string;
  leverage?: number;
  nav?: number;
}

export interface VaultSnapshot {
  vaultId: string;
  timestamp: number;
  nav: number;
  totalSupply: number;
  usdcReserve: number;
  externalAssets: { symbol: string; balance: number; valueUsdc: number }[];
  marginAllocated: number;
  tradeCount: number;
}

export interface VaultHistory {
  vaultId: string;
  createdAt: number;
  lastUpdated: number;
  trades: VaultTradeRecord[];
  snapshots: VaultSnapshot[];
  blobIds: string[]; // Previous blob IDs for chain of custody
}

// ============ Upload ============

export async function uploadToWalrus(data: object, epochs: number = 5): Promise<string> {
  const body = JSON.stringify(data);

  const response = await fetch(`${config.publisher}/v1/blobs?epochs=${epochs}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Walrus upload failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();

  if (result.newlyCreated) {
    return result.newlyCreated.blobObject.blobId;
  } else if (result.alreadyCertified) {
    return result.alreadyCertified.blobId;
  }

  throw new Error('Unexpected Walrus response format');
}

// ============ Download ============

export async function readFromWalrus<T = unknown>(blobId: string): Promise<T> {
  const response = await fetch(`${config.aggregator}/v1/blobs/${blobId}`);

  if (!response.ok) {
    throw new Error(`Walrus read failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ============ Vault History Helpers ============

export async function uploadVaultHistory(history: VaultHistory): Promise<string> {
  history.lastUpdated = Date.now();
  return uploadToWalrus(history);
}

export async function loadVaultHistory(blobId: string): Promise<VaultHistory> {
  return readFromWalrus<VaultHistory>(blobId);
}

export async function appendTradeToHistory(
  existingBlobId: string | null,
  vaultId: string,
  trade: VaultTradeRecord,
): Promise<{ history: VaultHistory; blobId: string }> {
  let history: VaultHistory;

  if (existingBlobId) {
    try {
      history = await loadVaultHistory(existingBlobId);
      history.blobIds.push(existingBlobId);
    } catch {
      // Previous blob not found, start fresh
      history = createEmptyHistory(vaultId);
    }
  } else {
    history = createEmptyHistory(vaultId);
  }

  history.trades.push(trade);
  const newBlobId = await uploadVaultHistory(history);

  return { history, blobId: newBlobId };
}

export async function appendSnapshotToHistory(
  existingBlobId: string | null,
  vaultId: string,
  snapshot: VaultSnapshot,
): Promise<{ history: VaultHistory; blobId: string }> {
  let history: VaultHistory;

  if (existingBlobId) {
    try {
      history = await loadVaultHistory(existingBlobId);
      history.blobIds.push(existingBlobId);
    } catch {
      history = createEmptyHistory(vaultId);
    }
  } else {
    history = createEmptyHistory(vaultId);
  }

  history.snapshots.push(snapshot);
  const newBlobId = await uploadVaultHistory(history);

  return { history, blobId: newBlobId };
}

function createEmptyHistory(vaultId: string): VaultHistory {
  return {
    vaultId,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    trades: [],
    snapshots: [],
    blobIds: [],
  };
}

// ============ Walrus Config Export ============

export const WALRUS = {
  network,
  aggregator: config.aggregator,
  publisher: config.publisher,
};
