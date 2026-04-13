/**
 * Hyperliquid Asset Cache
 * 動態從 API 獲取 asset 資訊，避免硬編碼 index 過時的問題
 */

export interface AssetInfo {
  index: number;
  symbol: string;
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

// 緩存
let assetCache: AssetInfo[] | null = null;
let assetMapBySymbol: Map<string, AssetInfo> | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 分鐘緩存

// 靜態 fallback（僅在 API 完全失敗時使用）
const FALLBACK_ASSETS: AssetInfo[] = [
  { index: 0, symbol: "BTC", name: "Bitcoin", szDecimals: 5, maxLeverage: 50 },
  { index: 1, symbol: "ETH", name: "Ethereum", szDecimals: 4, maxLeverage: 50 },
  { index: 5, symbol: "SOL", name: "Solana", szDecimals: 2, maxLeverage: 20 },
  { index: 7, symbol: "BNB", name: "BNB", szDecimals: 3, maxLeverage: 20 },
  { index: 11, symbol: "ARB", name: "Arbitrum", szDecimals: 0, maxLeverage: 20 },
  { index: 12, symbol: "DOGE", name: "Dogecoin", szDecimals: 0, maxLeverage: 20 },
  { index: 14, symbol: "SUI", name: "Sui", szDecimals: 1, maxLeverage: 20 },
  { index: 159, symbol: "HYPE", name: "Hyperliquid", szDecimals: 2, maxLeverage: 10 },
  { index: 187, symbol: "PAXG", name: "PAX Gold", szDecimals: 3, maxLeverage: 10 },
];

/**
 * 從 Hyperliquid API 獲取所有 perp 資產
 */
export async function fetchAllAssets(): Promise<AssetInfo[]> {
  // 檢查緩存是否有效
  if (assetCache && Date.now() - lastFetchTime < CACHE_DURATION) {
    return assetCache;
  }

  try {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    });

    if (!response.ok) {
      throw new Error(`API responded with ${response.status}`);
    }

    const data = await response.json();
    const universe = data.universe || [];

    const assets: AssetInfo[] = universe.map((u: any, index: number) => ({
      index,
      symbol: u.name,
      name: u.name,
      szDecimals: u.szDecimals ?? 0,
      maxLeverage: u.maxLeverage ?? 20,
    }));

    // 更新緩存
    assetCache = assets;
    assetMapBySymbol = new Map(assets.map(a => [a.symbol, a]));
    lastFetchTime = Date.now();

    console.log(`[AssetCache] Loaded ${assets.length} assets from API`);
    return assets;
  } catch (error) {
    console.error("[AssetCache] Failed to fetch assets:", error);

    // 如果有舊緩存，繼續使用
    if (assetCache) {
      console.log("[AssetCache] Using stale cache");
      return assetCache;
    }

    // 否則使用 fallback
    console.log("[AssetCache] Using fallback assets");
    return FALLBACK_ASSETS;
  }
}

/**
 * 根據 symbol 獲取單個資產資訊
 */
export async function getAssetBySymbol(symbol: string): Promise<AssetInfo | null> {
  // 先檢查緩存
  if (assetMapBySymbol && Date.now() - lastFetchTime < CACHE_DURATION) {
    return assetMapBySymbol.get(symbol) || null;
  }

  // 重新獲取
  await fetchAllAssets();
  return assetMapBySymbol?.get(symbol) || null;
}

/**
 * 根據 index 獲取單個資產資訊
 */
export async function getAssetByIndex(index: number): Promise<AssetInfo | null> {
  const assets = await fetchAllAssets();
  return assets.find(a => a.index === index) || null;
}

/**
 * 清除緩存（用於測試或強制刷新）
 */
export function clearAssetCache(): void {
  assetCache = null;
  assetMapBySymbol = null;
  lastFetchTime = 0;
}

/**
 * 預載入緩存（可在應用啟動時呼叫）
 */
export async function preloadAssetCache(): Promise<void> {
  await fetchAllAssets();
}
