'use client'

import { useState, useEffect } from 'react';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Broadcast from '@/components/Broadcast';
import { PACKAGE_ID, MODULES, formatAddress, formatUsdc } from '@/lib/contracts/config';
import { User, Wallet, TrendingUp, Coins } from 'lucide-react';

interface TokenInfo {
  id: string;
  name: string;
  symbol: string;
  imageUrl: string;
  balance?: string;
  tvl?: string;
  isCreator?: boolean;
}

interface VaultShareInfo {
  id: string;
  vaultId: string;
  vaultName: string;
  vaultSymbol: string;
  shares: string;
  entryNav: string;
  currentNav?: string;
  pnl?: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const account = useCurrentAccount();
  const client = useSuiClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [issuedTokens, setIssuedTokens] = useState<TokenInfo[]>([]);
  const [heldShares, setHeldShares] = useState<VaultShareInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'issued' | 'held'>('held');

  useEffect(() => {
    if (!account?.address) {
      setLoading(false);
      return;
    }

    fetchUserData();
  }, [account?.address]);

  const fetchUserData = async () => {
    if (!account?.address) return;

    setLoading(true);
    try {
      // Fetch user's VaultShare objects
      const objects = await client.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${PACKAGE_ID}::${MODULES.VAULT}::VaultShare`,
        },
        options: { showContent: true },
      });

      const shares: VaultShareInfo[] = objects.data
        .filter(obj => obj.data?.content && obj.data.content.dataType === 'moveObject')
        .map(obj => {
          const fields = (obj.data!.content as { fields: Record<string, unknown> }).fields;
          return {
            id: obj.data!.objectId,
            vaultId: fields.vault_id as string || '',
            vaultName: 'Unknown Vault', // Would need to fetch vault details
            vaultSymbol: 'VAULT',
            shares: formatUsdc(BigInt(fields.shares as string || '0')),
            entryNav: formatUsdc(BigInt(fields.entry_nav as string || '0')),
          };
        });

      setHeldShares(shares);

      // TODO: Fetch vaults created by user
      setIssuedTokens([]);

    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col text-white">
      <Broadcast />
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onLogoClick={() => router.push('/')}
      />

      <main className="flex-1 max-w-4xl mx-auto px-4 py-8 w-full">
        {/* Profile Header */}
        <div className="border border-white/10 bg-white/5 p-6 mb-8">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-primary/20 border border-primary/40 flex items-center justify-center">
              <User className="text-primary" size={32} />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">My Profile</h1>
              {account ? (
                <p className="text-sm text-gray-400 font-mono">{formatAddress(account.address, 8)}</p>
              ) : (
                <p className="text-sm text-yellow-400">Connect wallet to view profile</p>
              )}
            </div>
          </div>
        </div>

        {!account ? (
          <div className="border border-yellow-500/30 bg-yellow-500/10 p-8 text-center">
            <Wallet className="mx-auto mb-4 text-yellow-400" size={48} />
            <p className="text-yellow-400 font-bold text-lg mb-2">Wallet Not Connected</p>
            <p className="text-gray-400 text-sm">Please connect your SUI wallet to view your profile</p>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex items-center border-b border-white/10 mb-6">
              <button
                onClick={() => setActiveTab('held')}
                className={`px-6 py-3 text-sm font-bold uppercase tracking-widest transition-colors ${
                  activeTab === 'held'
                    ? 'text-primary border-b-2 border-primary'
                    : 'text-gray-500 hover:text-white'
                }`}
              >
                <Coins size={14} className="inline mr-2" />
                Holdings
              </button>
              <button
                onClick={() => setActiveTab('issued')}
                className={`px-6 py-3 text-sm font-bold uppercase tracking-widest transition-colors ${
                  activeTab === 'issued'
                    ? 'text-primary border-b-2 border-primary'
                    : 'text-gray-500 hover:text-white'
                }`}
              >
                <TrendingUp size={14} className="inline mr-2" />
                Created Vaults
              </button>
            </div>

            {/* Content */}
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : activeTab === 'held' ? (
              <div className="space-y-4">
                {heldShares.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Coins size={48} className="mx-auto mb-4 opacity-50" />
                    <p>No vault shares found</p>
                    <p className="text-sm mt-2">Buy shares from the marketplace to start investing</p>
                  </div>
                ) : (
                  heldShares.map((share) => (
                    <div
                      key={share.id}
                      className="border border-white/10 bg-white/5 p-4 hover:border-primary/30 transition-colors cursor-pointer"
                      onClick={() => router.push(`/vault/${share.vaultId}`)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-bold">{share.vaultSymbol}</h3>
                          <p className="text-sm text-gray-400">{share.vaultName}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono font-bold">{share.shares} shares</p>
                          <p className="text-sm text-gray-400">Entry NAV: ${share.entryNav}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {issuedTokens.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <TrendingUp size={48} className="mx-auto mb-4 opacity-50" />
                    <p>No vaults created yet</p>
                    <button
                      onClick={() => router.push('/launch')}
                      className="mt-4 px-6 py-2 bg-primary text-black font-bold text-sm uppercase tracking-widest hover:brightness-110 transition-colors"
                    >
                      Create Your First Vault
                    </button>
                  </div>
                ) : (
                  issuedTokens.map((token) => (
                    <div
                      key={token.id}
                      className="border border-white/10 bg-white/5 p-4 hover:border-primary/30 transition-colors cursor-pointer"
                      onClick={() => router.push(`/vault/${token.id}`)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {token.imageUrl ? (
                            <img src={token.imageUrl} alt={token.name} className="w-10 h-10 object-cover" />
                          ) : (
                            <div className="w-10 h-10 bg-primary/20 flex items-center justify-center">
                              <span className="text-primary font-bold">{token.symbol[0]}</span>
                            </div>
                          )}
                          <div>
                            <h3 className="font-bold">{token.name}</h3>
                            <p className="text-sm text-gray-400">{token.symbol}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono font-bold">${token.tvl || '0'}</p>
                          <p className="text-sm text-gray-400">TVL</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
