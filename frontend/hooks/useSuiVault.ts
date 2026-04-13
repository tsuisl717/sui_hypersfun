'use client';

import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useCallback, useState } from 'react';
import { PACKAGE_ID, MODULES, OBJECTS, parseUsdc } from '@/lib/contracts/config';

export interface VaultInfo {
  id: string;
  name: string;
  symbol: string;
  leader: string;
  performanceFeeBps: number;
  totalAssets: bigint;
  totalSupply: bigint;
  nav: bigint;
  createdAt: number;
  verified: boolean;
  metadataUri?: string;
}

export interface VaultShare {
  id: string;
  vaultId: string;
  shares: bigint;
  entryNav: bigint;
  acquiredAt: number;
}

export function useSuiVault() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get all vaults from factory
  const getVaults = useCallback(async (): Promise<VaultInfo[]> => {
    if (!OBJECTS.FACTORY) {
      console.warn('Factory object ID not set');
      return [];
    }

    try {
      const factoryObj = await client.getObject({
        id: OBJECTS.FACTORY,
        options: { showContent: true },
      });

      if (!factoryObj.data?.content || factoryObj.data.content.dataType !== 'moveObject') {
        return [];
      }

      // Parse vault list from factory object
      const fields = factoryObj.data.content.fields as Record<string, unknown>;
      const vaultIds = (fields.vault_list as string[]) || [];

      const vaults: VaultInfo[] = [];
      for (const vaultId of vaultIds) {
        try {
          const vaultObj = await client.getObject({
            id: vaultId,
            options: { showContent: true },
          });

          if (vaultObj.data?.content && vaultObj.data.content.dataType === 'moveObject') {
            const vaultFields = vaultObj.data.content.fields as Record<string, unknown>;
            vaults.push({
              id: vaultId,
              name: vaultFields.name as string || '',
              symbol: vaultFields.symbol as string || '',
              leader: vaultFields.leader as string || '',
              performanceFeeBps: Number(vaultFields.performance_fee_bps || 0),
              totalAssets: BigInt(vaultFields.total_assets as string || '0'),
              totalSupply: BigInt(vaultFields.total_supply as string || '0'),
              nav: BigInt(vaultFields.nav as string || '1000000'),
              createdAt: Number(vaultFields.created_at || 0),
              verified: vaultFields.verified as boolean || false,
              metadataUri: vaultFields.metadata_uri as string,
            });
          }
        } catch (e) {
          console.error(`Error fetching vault ${vaultId}:`, e);
        }
      }

      return vaults;
    } catch (e) {
      console.error('Error fetching vaults:', e);
      return [];
    }
  }, [client]);

  // Get user's vault shares
  const getUserShares = useCallback(async (userAddress?: string): Promise<VaultShare[]> => {
    const address = userAddress || account?.address;
    if (!address) return [];

    try {
      const objects = await client.getOwnedObjects({
        owner: address,
        filter: {
          StructType: `${PACKAGE_ID}::${MODULES.VAULT}::VaultShare`,
        },
        options: { showContent: true },
      });

      return objects.data
        .filter(obj => obj.data?.content && obj.data.content.dataType === 'moveObject')
        .map(obj => {
          const fields = (obj.data!.content as { fields: Record<string, unknown> }).fields;
          return {
            id: obj.data!.objectId,
            vaultId: fields.vault_id as string || '',
            shares: BigInt(fields.shares as string || '0'),
            entryNav: BigInt(fields.entry_nav as string || '0'),
            acquiredAt: Number(fields.acquired_at || 0),
          };
        });
    } catch (e) {
      console.error('Error fetching user shares:', e);
      return [];
    }
  }, [client, account]);

  return {
    getVaults,
    getUserShares,
    loading,
    error,
    isConnected: !!account,
    address: account?.address,
  };
}
