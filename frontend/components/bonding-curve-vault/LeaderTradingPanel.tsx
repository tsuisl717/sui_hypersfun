'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowRightLeft,
  AlertCircle,
  Plus,
  RefreshCw,
} from 'lucide-react';
import {
  PACKAGE_ID,
  MODULES,
  USDC,
  DEEPBOOK,
  TRADING_PAIRS,
  formatUsdc,
  parseUsdc,
} from '@/lib/contracts/config';

// ============ Types ============

interface LeaderTradingPanelProps {
  vaultId: string;
  leaderAddress: string;
  isLeader: boolean;
}

interface AssetVaultInfo {
  id: string;
  assetType: string;
  balance: number;
  decimals: number;
  symbol: string;
}

// ============ Component ============

export default function LeaderTradingPanel({
  vaultId,
  leaderAddress,
  isLeader,
}: LeaderTradingPanelProps) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  // UI state
  const [activeTab, setActiveTab] = useState<'trade' | 'assets'>('trade');
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [selectedPair, setSelectedPair] = useState(0);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(100); // 1% default
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // On-chain objects
  const [leaderCapId, setLeaderCapId] = useState<string>('');
  const [assetVaults, setAssetVaults] = useState<AssetVaultInfo[]>([]);
  const [vaultUsdcBalance, setVaultUsdcBalance] = useState<number>(0);

  // Price quote
  const [midPrice, setMidPrice] = useState<number | null>(null);
  const [estimatedOutput, setEstimatedOutput] = useState<string | null>(null);

  // ============ Fetch DeepBook Price Quote ============

  const fetchPriceQuote = useCallback(async () => {
    const pair = TRADING_PAIRS[selectedPair];
    if (!pair) return;

    try {
      const obj = await client.getObject({
        id: pair.poolId,
        options: { showContent: true },
      });

      if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
        const fields = obj.data.content.fields as Record<string, unknown>;

        // Try to extract mid price from pool state
        // DeepBook V3 pool has best_bid and best_ask in its order book
        const midPriceField = fields.mid_price as number | undefined;
        if (midPriceField) {
          const price = Number(midPriceField) / Math.pow(10, pair.quoteDecimals);
          setMidPrice(price);
        }
      }

      // Estimate output based on amount input
      if (amount && midPrice) {
        const inputNum = parseFloat(amount);
        if (tradeType === 'buy') {
          // Buying base with USDC: output = input / price
          const est = inputNum / midPrice;
          setEstimatedOutput(`~${est.toFixed(4)} ${pair.base}`);
        } else {
          // Selling base for USDC: output = input * price
          const est = inputNum * midPrice;
          setEstimatedOutput(`~$${est.toFixed(2)} USDC`);
        }
      } else {
        setEstimatedOutput(null);
      }
    } catch (e) {
      console.error('Error fetching price quote:', e);
    }
  }, [client, selectedPair, amount, tradeType, midPrice]);

  // ============ Fetch Leader Cap (from sui_vault module) ============

  const fetchLeaderCap = useCallback(async () => {
    if (!account || !isLeader) return;

    try {
      const caps = await client.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${PACKAGE_ID}::${MODULES.VAULT}::SuiLeaderCap`,
        },
        options: { showContent: true },
      });

      for (const obj of caps.data) {
        if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
          const fields = obj.data.content.fields as Record<string, unknown>;
          if (fields.vault_id === vaultId) {
            setLeaderCapId(obj.data.objectId);
            return;
          }
        }
      }
    } catch (e) {
      console.error('Error fetching LeaderCap:', e);
    }
  }, [account, client, isLeader, vaultId]);

  // ============ Fetch Asset Vaults ============

  const fetchAssetVaults = useCallback(async () => {
    try {
      // Query AssetVaultCreated events to find asset vaults for this vault
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::AssetVaultCreated`,
        },
        limit: 50,
      });

      const vaults: AssetVaultInfo[] = [];

      for (const event of events.data) {
        const parsed = event.parsedJson as Record<string, unknown>;
        if (parsed.vault_id !== vaultId) continue;

        const assetVaultId = parsed.asset_vault_id as string;

        // Fetch the asset vault object
        try {
          const obj = await client.getObject({
            id: assetVaultId,
            options: { showContent: true, showType: true },
          });

          if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
            const fields = obj.data.content.fields as Record<string, unknown>;
            const balanceField = fields.balance;
            const balance = typeof balanceField === 'object' && balanceField !== null
              ? Number((balanceField as Record<string, Record<string, unknown>>)?.fields?.value ?? 0)
              : Number(balanceField || 0);

            // Extract asset type from the object type string
            const objType = obj.data.type || '';
            // Type format: PACKAGE::sui_deepbook::AssetVault<0x2::sui::SUI>
            const typeMatch = objType.match(/AssetVault<(.+)>/);
            const assetType = typeMatch ? typeMatch[1] : '';

            // Find matching trading pair for symbol and decimals
            const pair = TRADING_PAIRS.find(
              (p) => p.baseType === assetType || p.quoteType === assetType
            );

            vaults.push({
              id: assetVaultId,
              assetType,
              balance,
              decimals: pair?.baseType === assetType ? pair.baseDecimals : (pair?.quoteDecimals || 6),
              symbol: assetType.includes('::sui::SUI')
                ? 'SUI'
                : assetType.includes('::deep::DEEP')
                  ? 'DEEP'
                  : assetType.split('::').pop() || 'Unknown',
            });
          }
        } catch {
          // Asset vault may have been deleted or not accessible
        }
      }

      setAssetVaults(vaults);
    } catch (e) {
      console.error('Error fetching asset vaults:', e);
    }
  }, [client, vaultId]);

  // ============ Fetch Vault USDC Balance ============

  const fetchVaultBalance = useCallback(async () => {
    try {
      const obj = await client.getObject({
        id: vaultId,
        options: { showContent: true },
      });

      if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
        const fields = obj.data.content.fields as Record<string, unknown>;
        const reserveField = fields.usdc_reserve;
        const reserve = typeof reserveField === 'object' && reserveField !== null
          ? Number((reserveField as Record<string, Record<string, unknown>>)?.fields?.value ?? 0)
          : Number(reserveField || 0);
        setVaultUsdcBalance(reserve / 1_000_000);
      }
    } catch (e) {
      console.error('Error fetching vault balance:', e);
    }
  }, [client, vaultId]);

  // ============ Effects ============

  useEffect(() => {
    if (isLeader) {
      fetchLeaderCap();
      fetchAssetVaults();
      fetchVaultBalance();
    }
  }, [isLeader, fetchLeaderCap, fetchAssetVaults, fetchVaultBalance]);

  // Fetch price when pair or amount changes
  useEffect(() => {
    if (isLeader) {
      fetchPriceQuote();
    }
  }, [isLeader, selectedPair, amount, tradeType, fetchPriceQuote]);

  // ============ Create Asset Vault ============

  const handleCreateAssetVault = async (baseType: string) => {
    if (!account || !leaderCapId) return;

    setLoading(true);
    setTxStatus('Creating asset vault...');

    try {
      const tx = new Transaction();

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::create_asset_vault`,
        typeArguments: [USDC.TYPE, baseType],
        arguments: [
          tx.object(vaultId),
          tx.object(leaderCapId),
        ],
      });

      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Asset vault created! TX: ${result.digest.slice(0, 8)}...`);

      setTimeout(() => {
        fetchAssetVaults();
        setTxStatus(null);
      }, 2000);
    } catch (e) {
      console.error('Create asset vault error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Failed to create asset vault'}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Execute Trade (single PTB) ============

  const handleExecuteTrade = async () => {
    if (!account || !leaderCapId || !amount) return;

    const pair = TRADING_PAIRS[selectedPair];
    const isBuy = tradeType === 'buy';

    const assetVault = assetVaults.find((v) => v.assetType === pair.baseType);
    if (!assetVault) {
      setTxStatus(`Error: No asset vault for ${pair.base}. Create one first in the Assets tab.`);
      return;
    }

    setLoading(true);
    setTxStatus('Building transaction...');

    try {
      const inputAmount = isBuy
        ? parseUsdc(amount)
        : BigInt(Math.floor(parseFloat(amount) * Math.pow(10, pair.baseDecimals)));

      const tx = new Transaction();

      // Step 1: authorize_swap → returns SwapAuthorization (no separate TX needed)
      const [swapAuth] = tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::authorize_swap`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(leaderCapId),
          tx.pure.u64(inputAmount),
          tx.pure.u64(0), // min_output (checked in deposit step)
          tx.pure.bool(isBuy),
          tx.pure.u64(300), // 5 min expiry
          tx.object('0x6'), // Clock
        ],
      });

      // Get or create DEEP coin for DeepBook fees
      const [deepCoin] = await getOrCreateDeepCoin(tx);

      if (isBuy) {
        // BUY: USDC → Base Asset
        const [usdcCoin, obligation] = tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::consume_swap_for_buy`,
          typeArguments: [USDC.TYPE],
          arguments: [swapAuth, tx.object(vaultId), tx.object('0x6')],
        });

        const [baseOut, quoteOut, deepOut] = tx.moveCall({
          target: `${DEEPBOOK.packageId}::pool::swap_exact_quote_for_base`,
          typeArguments: [pair.baseType, pair.quoteType],
          arguments: [tx.object(pair.poolId), usdcCoin, deepCoin, tx.pure.u64(0), tx.object('0x6')],
        });

        // Repay obligation — base asset to AssetVault (hot potato consumed)
        tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::repay_obligation_with_base`,
          typeArguments: [pair.baseType],
          arguments: [obligation, tx.object(assetVault.id), baseOut, tx.pure.u64(0)],
        });

        tx.transferObjects([quoteOut, deepOut], account.address);
      } else {
        // SELL: Base Asset → USDC
        const [assetCoin, obligation] = tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::consume_swap_for_sell`,
          typeArguments: [pair.baseType],
          arguments: [swapAuth, tx.object(assetVault.id), tx.pure.u64(inputAmount), tx.object('0x6')],
        });

        const [baseOut, quoteOut, deepOut] = tx.moveCall({
          target: `${DEEPBOOK.packageId}::pool::swap_exact_base_for_quote`,
          typeArguments: [pair.baseType, pair.quoteType],
          arguments: [tx.object(pair.poolId), assetCoin, deepCoin, tx.pure.u64(0), tx.object('0x6')],
        });

        // Repay obligation — USDC back to vault (hot potato consumed)
        tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::repay_obligation_with_usdc`,
          typeArguments: [USDC.TYPE],
          arguments: [obligation, tx.object(vaultId), quoteOut, tx.pure.u64(0)],
        });

        // Return leftover base + DEEP to sender
        tx.transferObjects([baseOut, deepOut], account.address);
      }

      setTxStatus('Waiting for wallet approval...');
      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Trade executed! TX: ${result.digest.slice(0, 8)}...`);

      setTimeout(() => {
        fetchAssetVaults();
        fetchVaultBalance();
        setTxStatus(null);
        setAmount('');
      }, 2000);
    } catch (e) {
      console.error('Trade error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Trade failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Helper: Get or create DEEP coin ============

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function getOrCreateDeepCoin(tx: Transaction): Promise<[any]> {
    if (!account) {
      const [zeroCoin] = tx.moveCall({
        target: '0x2::coin::zero',
        typeArguments: [DEEPBOOK.DEEP],
      });
      return [zeroCoin];
    }

    try {
      const deepCoins = await client.getCoins({
        owner: account.address,
        coinType: DEEPBOOK.DEEP,
      });

      if (deepCoins.data.length > 0) {
        const [primaryCoin, ...otherCoins] = deepCoins.data;
        if (otherCoins.length > 0) {
          tx.mergeCoins(
            tx.object(primaryCoin.coinObjectId),
            otherCoins.map((c) => tx.object(c.coinObjectId)),
          );
        }
        return [tx.object(primaryCoin.coinObjectId)];
      }
    } catch {
      // No DEEP coins found
    }

    const [zeroCoin] = tx.moveCall({
      target: '0x2::coin::zero',
      typeArguments: [DEEPBOOK.DEEP],
    });
    return [zeroCoin];
  }

  // ============ Render ============

  if (!isLeader) {
    return (
      <div className="bg-black border border-border p-4">
        <div className="flex items-center gap-2 text-gray-400">
          <AlertCircle size={16} />
          <span className="text-sm">Leader trading panel - Not authorized</span>
        </div>
      </div>
    );
  }

  const pair = TRADING_PAIRS[selectedPair];
  const hasAssetVault = assetVaults.some((v) => v.assetType === pair?.baseType);

  return (
    <div className="bg-black border border-border">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-black text-lg">Leader Trading</h3>
          <button
            onClick={() => {
              fetchAssetVaults();
              fetchVaultBalance();
              fetchLeaderCap();
            }}
            className="text-gray-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Wallet size={12} />
          <span>Vault USDC: ${vaultUsdcBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
        {!leaderCapId && (
          <div className="mt-2 text-xs text-yellow-400">
            <AlertCircle className="inline mr-1" size={12} />
            LeaderCap not found. You may not be the vault leader.
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('trade')}
          className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
            activeTab === 'trade' ? 'text-primary border-b-2 border-primary' : 'text-gray-500'
          }`}
        >
          Trade
        </button>
        <button
          onClick={() => setActiveTab('assets')}
          className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
            activeTab === 'assets' ? 'text-primary border-b-2 border-primary' : 'text-gray-500'
          }`}
        >
          Assets
        </button>
      </div>

      {/* Trade Tab */}
      {activeTab === 'trade' && (
        <div className="p-4 space-y-4">
          {/* Buy/Sell Toggle */}
          <div className="flex border border-white/10 rounded">
            <button
              onClick={() => setTradeType('buy')}
              className={`flex-1 py-2 text-sm font-bold transition-colors ${
                tradeType === 'buy'
                  ? 'bg-green-500/20 text-green-400'
                  : 'text-gray-500 hover:text-white'
              }`}
            >
              <TrendingUp className="inline mr-1" size={14} />
              Buy
            </button>
            <button
              onClick={() => setTradeType('sell')}
              className={`flex-1 py-2 text-sm font-bold transition-colors ${
                tradeType === 'sell'
                  ? 'bg-red-500/20 text-red-400'
                  : 'text-gray-500 hover:text-white'
              }`}
            >
              <TrendingDown className="inline mr-1" size={14} />
              Sell
            </button>
          </div>

          {/* Trading Pair */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Trading Pair
            </label>
            <select
              value={selectedPair}
              onChange={(e) => setSelectedPair(Number(e.target.value))}
              className="w-full bg-white/5 border border-white/10 px-4 py-2 text-white"
            >
              {TRADING_PAIRS.map((p, i) => (
                <option key={i} value={i} className="bg-black">
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Asset Vault Check */}
          {!hasAssetVault && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-400">
              <AlertCircle className="inline mr-1" size={12} />
              No asset vault for <strong>{pair?.base}</strong>. Go to the Assets tab to create one before trading.
            </div>
          )}

          {/* Amount */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              {tradeType === 'buy' ? `USDC Amount` : `${pair?.base} Amount`}
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-600 focus:border-primary/50 outline-none transition-colors text-lg font-mono"
            />
            {tradeType === 'buy' && (
              <div className="text-xs text-gray-500 mt-1">
                Available: ${vaultUsdcBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC in vault
              </div>
            )}
            {tradeType === 'sell' && (
              <div className="text-xs text-gray-500 mt-1">
                Available: {
                  (() => {
                    const av = assetVaults.find((v) => v.assetType === pair?.baseType);
                    if (!av) return '0';
                    return (av.balance / Math.pow(10, av.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 });
                  })()
                } {pair?.base}
              </div>
            )}
          </div>

          {/* Slippage */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Slippage Tolerance
            </label>
            <div className="flex gap-2">
              {[50, 100, 200, 500].map((bps) => (
                <button
                  key={bps}
                  onClick={() => setSlippageBps(bps)}
                  className={`flex-1 py-2 text-xs border ${
                    slippageBps === bps
                      ? 'border-primary text-primary'
                      : 'border-white/10 text-gray-400 hover:border-white/30'
                  }`}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
          </div>

          {/* Price Info */}
          {(midPrice || estimatedOutput) && (
            <div className="bg-white/5 border border-white/10 p-3 space-y-1">
              {midPrice && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Pool Price</span>
                  <span className="font-mono text-white">
                    1 {pair?.base} = ${midPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </div>
              )}
              {estimatedOutput && amount && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Est. Output</span>
                  <span className="font-mono text-primary">{estimatedOutput}</span>
                </div>
              )}
              {slippageBps > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Max Slippage</span>
                  <span className="font-mono text-gray-300">{slippageBps / 100}%</span>
                </div>
              )}
            </div>
          )}

          {/* Status */}
          {txStatus && (
            <div
              className={`p-3 text-sm ${
                txStatus.includes('Error')
                  ? 'bg-red-500/10 text-red-400'
                  : txStatus.includes('Waiting')
                    ? 'bg-blue-500/10 text-blue-400'
                    : 'bg-primary/10 text-primary'
              }`}
            >
              {loading && <Loader2 className="animate-spin inline mr-2" size={14} />}
              {txStatus}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleExecuteTrade}
            disabled={loading || !amount || !leaderCapId || !hasAssetVault || isPending}
            className={`w-full py-3 font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
              tradeType === 'buy'
                ? 'bg-green-500 text-black hover:bg-green-400'
                : 'bg-red-500 text-white hover:bg-red-400'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {loading ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <ArrowRightLeft size={16} />
            )}
            {tradeType === 'buy' ? `Buy ${pair?.base}` : `Sell ${pair?.base}`}
          </button>

          <p className="text-xs text-gray-500 text-center">
            Executes atomically via DeepBook V3 in a single transaction.
          </p>
        </div>
      )}

      {/* Assets Tab */}
      {activeTab === 'assets' && (
        <div className="p-4 space-y-4">
          {/* Vault USDC Balance */}
          <div className="bg-white/5 border border-white/10 p-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">USDC Reserve</span>
              <span className="font-mono font-bold text-primary">
                ${vaultUsdcBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Asset Vaults */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Asset Vaults
            </label>

            {assetVaults.length === 0 ? (
              <div className="text-center py-4 text-gray-500 text-sm">
                No asset vaults created yet
              </div>
            ) : (
              <div className="space-y-2">
                {assetVaults.map((vault) => (
                  <div
                    key={vault.id}
                    className="bg-white/5 border border-white/10 p-3 flex justify-between items-center"
                  >
                    <div>
                      <span className="font-bold text-sm">{vault.symbol}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {vault.id.slice(0, 8)}...
                      </span>
                    </div>
                    <span className="font-mono text-sm">
                      {(vault.balance / Math.pow(10, vault.decimals)).toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create Asset Vault */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Create Asset Vault
            </label>
            <div className="space-y-2">
              {TRADING_PAIRS.map((p, i) => {
                const exists = assetVaults.some((v) => v.assetType === p.baseType);
                return (
                  <button
                    key={i}
                    onClick={() => handleCreateAssetVault(p.baseType)}
                    disabled={loading || exists || !leaderCapId}
                    className={`w-full flex items-center justify-between px-4 py-2 text-sm border transition-colors ${
                      exists
                        ? 'border-green-500/30 text-green-400/50 cursor-not-allowed'
                        : 'border-white/10 text-gray-400 hover:border-primary/50 hover:text-white'
                    } disabled:opacity-50`}
                  >
                    <span className="flex items-center gap-2">
                      {exists ? (
                        <span className="text-green-400 text-xs">&#10003;</span>
                      ) : (
                        <Plus size={14} />
                      )}
                      {p.base} Vault
                    </span>
                    <span className="text-xs text-gray-600">
                      {exists ? 'Created' : 'Create'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status */}
          {txStatus && (
            <div
              className={`p-3 text-sm ${
                txStatus.includes('Error')
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-primary/10 text-primary'
              }`}
            >
              {txStatus}
            </div>
          )}

          {/* Info */}
          <div className="bg-blue-500/10 border border-blue-500/30 p-3 text-xs text-blue-400">
            <p className="font-bold mb-1">DeepBook V3 Integration</p>
            <p className="text-blue-300/80">
              Asset vaults hold traded assets. Create a vault for each asset type before trading.
              All trades execute atomically via DeepBook V3 on-chain order book.
            </p>
            <p className="text-blue-300/60 mt-1">
              Note: Testnet uses DBUSDC. Pools may have limited liquidity.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
