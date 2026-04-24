'use client';

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { PACKAGE_ID, MODULES, OBJECTS, formatUsdc } from './contracts/config';

export interface VaultPosition {
  coin: string;
  size: number;
  isLong: boolean;
}

export interface VaultInfo {
  id: string;
  core: string; // alias for id, for compatibility
  trading?: string;
  name: string;
  symbol: string;
  leader: string;
  performanceFeeBps: number;
  totalAssets: string;
  totalSupply: string;
  nav: string;
  buyPrice: string;
  sellPrice?: string;
  metadataURI?: string;
  imageUrl: string;
  tvl: string;
  totalVolume: string;
  createdAt: number;
  verified: boolean;
  priceChange24h: number;
  priceChange: number;
  positions?: VaultPosition[];
  winRate?: number;
  apy?: number;
}

export type VaultUpdateCallback = (coreAddress: string, updates: Partial<VaultInfo>) => void;

// Create SUI client
const client = new SuiJsonRpcClient({ url: 'https://fullnode.testnet.sui.io:443', network: 'testnet' });

// Cache for vault data
const VAULTS_CACHE_KEY = 'sui_vaults_cache';
const VAULTS_CACHE_TTL = 30 * 1000; // 30 seconds

interface VaultsCache {
  data: VaultInfo[];
  timestamp: number;
}

// Get cached vaults data
function getCachedVaults(): VaultInfo[] | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = sessionStorage.getItem(VAULTS_CACHE_KEY);
    if (!cached) return null;

    const { data, timestamp }: VaultsCache = JSON.parse(cached);
    const age = Date.now() - timestamp;

    if (age < VAULTS_CACHE_TTL) {
      console.log(`[Cache] Using cached vaults data (age: ${(age / 1000).toFixed(1)}s)`);
      return data;
    }

    console.log(`[Cache] Vaults cache expired (age: ${(age / 1000).toFixed(1)}s)`);
    return null;
  } catch (e) {
    console.warn('[Cache] Failed to read vaults cache:', e);
    return null;
  }
}

// Save vaults data to cache
function setCachedVaults(data: VaultInfo[]): void {
  if (typeof window === 'undefined') return;

  try {
    const cache: VaultsCache = {
      data,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(VAULTS_CACHE_KEY, JSON.stringify(cache));
    console.log(`[Cache] Saved ${data.length} vaults to cache`);
  } catch (e) {
    console.warn('[Cache] Failed to save vaults cache:', e);
  }
}

/**
 * Load all vaults from the factory contract
 */
export async function loadVaults(
  onUpdate?: VaultUpdateCallback,
  forceRefresh?: boolean
): Promise<VaultInfo[]> {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = getCachedVaults();
    if (cached) {
      return cached;
    }
  }

  try {
    console.log('[Vaults] Loading from factory:', OBJECTS.FACTORY);

    // Get factory object
    const factoryObj = await client.getObject({
      id: OBJECTS.FACTORY,
      options: { showContent: true },
    });

    if (!factoryObj.data?.content || factoryObj.data.content.dataType !== 'moveObject') {
      console.warn('Factory object not found or invalid');
      return [];
    }

    const factoryFields = factoryObj.data.content.fields as Record<string, unknown>;
    console.log('[Factory] Fields:', Object.keys(factoryFields));

    // Get vault table ID
    const vaultsTable = factoryFields.vaults as { fields?: { id?: { id: string } } };
    if (!vaultsTable?.fields?.id?.id) {
      console.warn('Vaults table not found in factory');
      return [];
    }

    const vaultsTableId = vaultsTable.fields.id.id;
    console.log('[Factory] Vaults table ID:', vaultsTableId);

    // Get all dynamic fields (vault entries)
    const dynamicFields = await client.getDynamicFields({
      parentId: vaultsTableId,
    });

    console.log('[Factory] Found', dynamicFields.data.length, 'vault entries');

    const vaults: VaultInfo[] = [];

    // Load each vault's details
    for (const field of dynamicFields.data) {
      try {
        // The field contains VaultInfo (metadata), but we need to get the actual vault object
        // field.name.value should be the vault ID
        const vaultId = (field.name as { value: string }).value;

        // Get the actual vault object
        const vaultObj = await client.getObject({
          id: vaultId,
          options: { showContent: true },
        });

        if (vaultObj.data?.content && vaultObj.data.content.dataType === 'moveObject') {
          const vaultData = vaultObj.data.content.fields as Record<string, unknown>;
          const vault = parseVaultObject(vaultId, vaultData);
          vaults.push(vault);

          if (onUpdate) {
            onUpdate(vault.id, vault);
          }
        }
      } catch (e) {
        console.error(`Error fetching vault:`, e);
      }
    }

    // Sort by creation time (newest first)
    vaults.sort((a, b) => b.createdAt - a.createdAt);

    // Save to cache
    setCachedVaults(vaults);

    console.log('[Vaults] Loaded', vaults.length, 'vaults');
    return vaults;
  } catch (error) {
    console.error('Error loading vaults:', error);
    return [];
  }
}

/**
 * Parse vault object fields into VaultInfo
 */
function parseVaultObject(id: string, fields: Record<string, unknown>): VaultInfo {
  // Get USDC reserve balance - can be direct value or nested object
  let totalAssets = 0n;
  const usdcReserve = fields.usdc_reserve;
  if (typeof usdcReserve === 'string' || typeof usdcReserve === 'number') {
    totalAssets = BigInt(usdcReserve);
  } else if (usdcReserve && typeof usdcReserve === 'object') {
    const nested = usdcReserve as { fields?: { value: string } };
    totalAssets = BigInt(nested?.fields?.value || '0');
  }

  const totalSupply = BigInt(fields.total_supply as string || '0');

  // Calculate NAV = totalAssets / totalSupply (with 6 decimal precision)
  let nav = 1_000_000n; // Default 1.0
  if (totalSupply > 0n) {
    nav = (totalAssets * 1_000_000n) / totalSupply;
  }

  // Format values
  const navStr = (Number(nav) / 1_000_000).toFixed(6);
  const totalAssetsStr = formatUsdc(totalAssets);
  const totalSupplyStr = formatUsdc(totalSupply);
  const tvlStr = formatUsdc(totalAssets);
  const totalVolumeStr = formatUsdc(BigInt(fields.total_volume as string || '0'));

  return {
    id,
    core: id,
    name: fields.name as string || 'Unknown Vault',
    symbol: fields.symbol as string || 'VAULT',
    leader: fields.leader as string || '',
    performanceFeeBps: Number(fields.performance_fee_bps || 0),
    totalAssets: totalAssetsStr,
    totalSupply: totalSupplyStr,
    nav: navStr,
    buyPrice: navStr, // Simplified - actual BC calculation would be more complex
    sellPrice: navStr,
    tvl: tvlStr,
    totalVolume: totalVolumeStr,
    createdAt: Date.now(), // Would need to get from factory VaultInfo
    verified: false,
    imageUrl: '',
    priceChange24h: 0,
    priceChange: 0,
  };
}

/**
 * Load a single vault by ID
 */
export async function loadVaultByAddress(vaultId: string): Promise<VaultInfo | null> {
  try {
    const vaultObj = await client.getObject({
      id: vaultId,
      options: { showContent: true },
    });

    if (!vaultObj.data?.content || vaultObj.data.content.dataType !== 'moveObject') {
      return null;
    }

    const fields = vaultObj.data.content.fields as Record<string, unknown>;
    return parseVaultObject(vaultId, fields);
  } catch (error) {
    console.error('Error fetching vault:', error);
    return null;
  }
}

/**
 * Parse metadata URI to extract image URL
 */
export async function parseMetadataImage(metadataURI: string): Promise<string> {
  if (!metadataURI || typeof metadataURI !== 'string') {
    return '';
  }
  try {
    let metadataJson;
    if (metadataURI.startsWith('data:application/json;base64,')) {
      const base64 = metadataURI.replace('data:application/json;base64,', '');
      metadataJson = JSON.parse(atob(base64));
    } else if (metadataURI.startsWith('ipfs://')) {
      const ipfsHash = metadataURI.replace('ipfs://', '');
      const response = await fetch(`https://gateway.pinata.cloud/ipfs/${ipfsHash}`, {
        cache: 'no-store',
      });
      metadataJson = await response.json();
    } else if (metadataURI.startsWith('http')) {
      const response = await fetch(metadataURI, { cache: 'no-store' });
      metadataJson = await response.json();
    }

    if (metadataJson?.image) {
      if (metadataJson.image.startsWith('ipfs://')) {
        return `https://gateway.pinata.cloud/ipfs/${metadataJson.image.replace('ipfs://', '')}`;
      } else if (metadataJson.image.startsWith('data:')) {
        return metadataJson.image;
      } else {
        return metadataJson.image;
      }
    }

    return '';
  } catch (e) {
    console.warn('Failed to parse metadata:', e);
    return '';
  }
}

/**
 * Parse metadata URI to extract both image URL and description
 */
export async function parseMetadata(metadataURI: string): Promise<{
  imageUrl: string;
  description: string;
  links: { website?: string; twitter?: string; telegram?: string };
}> {
  if (!metadataURI || typeof metadataURI !== 'string') {
    return { imageUrl: '', description: '', links: {} };
  }
  try {
    let metadataJson;
    if (metadataURI.startsWith('data:application/json;base64,')) {
      const base64 = metadataURI.replace('data:application/json;base64,', '');
      metadataJson = JSON.parse(atob(base64));
    } else if (metadataURI.startsWith('ipfs://')) {
      const ipfsHash = metadataURI.replace('ipfs://', '');
      const response = await fetch(`https://gateway.pinata.cloud/ipfs/${ipfsHash}`, {
        cache: 'no-store',
      });
      metadataJson = await response.json();
    } else if (metadataURI.startsWith('http')) {
      const response = await fetch(metadataURI, { cache: 'no-store' });
      metadataJson = await response.json();
    }

    let imageUrl = '';
    let description = '';
    let links: { website?: string; twitter?: string; telegram?: string } = {};

    if (metadataJson?.image) {
      if (metadataJson.image.startsWith('ipfs://')) {
        const ipfsHash = metadataJson.image.replace('ipfs://', '');
        imageUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
      } else if (metadataJson.image.startsWith('data:')) {
        imageUrl = metadataJson.image;
      } else {
        imageUrl = metadataJson.image;
      }
    }

    if (metadataJson?.description) {
      description = metadataJson.description;
    }

    if (metadataJson?.links) {
      links = {
        website: metadataJson.links?.website,
        twitter: metadataJson.links?.twitter,
        telegram: metadataJson.links?.telegram,
      };
    }

    return { imageUrl, description, links };
  } catch (e) {
    console.warn('Failed to parse metadata:', e);
    return { imageUrl: '', description: '', links: {} };
  }
}
