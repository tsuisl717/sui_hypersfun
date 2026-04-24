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
  RefreshCw,
  Plus,
  X,
  BarChart3,
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

interface ApiTradingPanelProps {
  vaultId: string;
  leaderAddress: string;
  isLeader: boolean;
}

interface AssetPosition {
  symbol: string;
  assetType: string;
  assetVaultId: string;
  balance: number;
  decimals: number;
  valueUsdc: number; // estimated
}

interface TradeRecord {
  type: 'buy' | 'sell';
  asset: string;
  amount: number;
  timestamp: number;
  txDigest: string;
}

// ============ Component ============

export default function ApiTradingPanel({
  vaultId,
  leaderAddress,
  isLeader,
}: ApiTradingPanelProps) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  // UI state
  const [activeTab, setActiveTab] = useState<'trade' | 'positions' | 'history'>('trade');
  const [orderType, setOrderType] = useState<'market'>('market');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [selectedPair, setSelectedPair] = useState(0);
  const [amount, setAmount] = useState('');
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // On-chain state
  const [leaderCapId, setLeaderCapId] = useState<string>('');
  const [vaultUsdcBalance, setVaultUsdcBalance] = useState<number>(0);
  const [positions, setPositions] = useState<AssetPosition[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);

  // ============ Data Fetching ============

  const fetchLeaderCap = useCallback(async () => {
    if (!account || !isLeader) return;
    try {
      const caps = await client.getOwnedObjects({
        owner: account.address,
        filter: { StructType: `${PACKAGE_ID}::${MODULES.VAULT}::SuiLeaderCap` },
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

  const fetchVaultBalance = useCallback(async () => {
    try {
      const obj = await client.getObject({ id: vaultId, options: { showContent: true } });
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

  const fetchPositions = useCallback(async () => {
    try {
      const events = await client.queryEvents({
        query: { MoveEventType: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::AssetVaultCreated` },
        limit: 50,
      });

      const pos: AssetPosition[] = [];
      for (const event of events.data) {
        const parsed = event.parsedJson as Record<string, unknown>;
        if (parsed.vault_id !== vaultId) continue;

        const avId = parsed.asset_vault_id as string;
        try {
          const obj = await client.getObject({ id: avId, options: { showContent: true, showType: true } });
          if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
            const fields = obj.data.content.fields as Record<string, unknown>;
            const balanceField = fields.balance;
            const balance = typeof balanceField === 'object' && balanceField !== null
              ? Number((balanceField as Record<string, Record<string, unknown>>)?.fields?.value ?? 0)
              : Number(balanceField || 0);

            const objType = obj.data.type || '';
            const typeMatch = objType.match(/AssetVault<(.+)>/);
            const assetType = typeMatch ? typeMatch[1] : '';

            const pair = TRADING_PAIRS.find(p => p.baseType === assetType);
            const symbol = assetType.includes('::sui::SUI') ? 'SUI'
              : assetType.includes('::deep::DEEP') ? 'DEEP'
              : assetType.split('::').pop() || 'Unknown';
            const decimals = pair?.baseDecimals || 9;

            pos.push({
              symbol,
              assetType,
              assetVaultId: avId,
              balance,
              decimals,
              valueUsdc: 0, // TODO: fetch price
            });
          }
        } catch { /* skip */ }
      }
      setPositions(pos);
    } catch (e) {
      console.error('Error fetching positions:', e);
    }
  }, [client, vaultId]);

  const fetchTradeHistory = useCallback(async () => {
    try {
      const events = await client.queryEvents({
        query: { MoveEventType: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::SwapExecuted` },
        limit: 20,
      });

      const trades: TradeRecord[] = [];
      for (const event of events.data) {
        const parsed = event.parsedJson as Record<string, unknown>;
        if (parsed.vault_id !== vaultId) continue;
        trades.push({
          type: parsed.is_buy ? 'buy' : 'sell',
          asset: 'SUI',
          amount: Number(parsed.output_amount || parsed.input_amount || 0),
          timestamp: Number(event.timestampMs ?? 0),
          txDigest: event.id.txDigest,
        });
      }
      setTradeHistory(trades);
    } catch (e) {
      console.error('Error fetching trade history:', e);
    }
  }, [client, vaultId]);

  useEffect(() => {
    if (isLeader) {
      fetchLeaderCap();
      fetchVaultBalance();
      fetchPositions();
      fetchTradeHistory();
    }
  }, [isLeader, fetchLeaderCap, fetchVaultBalance, fetchPositions, fetchTradeHistory]);

  // ============ Size Helpers ============

  const setPercentage = (pct: number) => {
    if (side === 'buy') {
      setAmount((vaultUsdcBalance * pct / 100).toFixed(2));
    } else {
      const pair = TRADING_PAIRS[selectedPair];
      const pos = positions.find(p => p.assetType === pair?.baseType);
      if (pos) {
        const bal = pos.balance / Math.pow(10, pos.decimals);
        setAmount((bal * pct / 100).toFixed(4));
      }
    }
  };

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
        arguments: [tx.object(vaultId), tx.object(leaderCapId)],
      });
      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Asset vault created! TX: ${result.digest.slice(0, 8)}...`);
      setTimeout(() => { fetchPositions(); setTxStatus(null); }, 2000);
    } catch (e) {
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Execute Trade ============

  const handleExecuteTrade = async () => {
    if (!account || !leaderCapId || !amount) return;

    const pair = TRADING_PAIRS[selectedPair];
    const isBuy = side === 'buy';
    const assetVault = positions.find(v => v.assetType === pair.baseType);

    if (!assetVault) {
      setTxStatus(`No asset vault for ${pair.base}. Create one in Positions tab.`);
      return;
    }

    setLoading(true);
    setTxStatus('Building trade...');

    try {
      const inputAmount = isBuy
        ? parseUsdc(amount)
        : BigInt(Math.floor(parseFloat(amount) * Math.pow(10, pair.baseDecimals)));

      const tx = new Transaction();

      // authorize_swap (returns SwapAuthorization in same PTB)
      const [swapAuth] = tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::authorize_swap`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(vaultId), tx.object(leaderCapId),
          tx.pure.u64(inputAmount), tx.pure.u64(0),
          tx.pure.bool(isBuy), tx.pure.u64(300), tx.object('0x6'),
        ],
      });

      // Get or create DEEP coin for fees
      let deepCoinArg;
      try {
        const deepCoins = await client.getCoins({ owner: account.address, coinType: DEEPBOOK.DEEP });
        if (deepCoins.data.length > 0) {
          const [primary, ...rest] = deepCoins.data;
          if (rest.length > 0) {
            tx.mergeCoins(tx.object(primary.coinObjectId), rest.map(c => tx.object(c.coinObjectId)));
          }
          deepCoinArg = tx.object(primary.coinObjectId);
        }
      } catch { /* no DEEP coins */ }

      if (!deepCoinArg) {
        [deepCoinArg] = tx.moveCall({
          target: '0x2::coin::zero',
          typeArguments: [DEEPBOOK.DEEP],
        });
      }

      if (isBuy) {
        // consume → DeepBook swap → repay obligation (deposit base to AssetVault)
        const [usdcCoin, obligation] = tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::consume_swap_for_buy`,
          typeArguments: [USDC.TYPE],
          arguments: [swapAuth, tx.object(vaultId), tx.object('0x6')],
        });

        const [baseOut, quoteOut, deepOut] = tx.moveCall({
          target: `${DEEPBOOK.packageId}::pool::swap_exact_quote_for_base`,
          typeArguments: [pair.baseType, pair.quoteType],
          arguments: [tx.object(pair.poolId), usdcCoin, deepCoinArg, tx.pure.u64(0), tx.object('0x6')],
        });

        // Repay obligation — base asset goes back to AssetVault (hot potato consumed)
        tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::repay_obligation_with_base`,
          typeArguments: [pair.baseType],
          arguments: [obligation, tx.object(assetVault.assetVaultId), baseOut, tx.pure.u64(0)],
        });

        tx.transferObjects([quoteOut, deepOut], account.address);
      } else {
        // consume → DeepBook swap → repay obligation (deposit USDC back to vault)
        const [assetCoin, obligation] = tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::consume_swap_for_sell`,
          typeArguments: [pair.baseType],
          arguments: [swapAuth, tx.object(assetVault.assetVaultId), tx.pure.u64(inputAmount), tx.object('0x6')],
        });

        const [baseOut, quoteOut, deepOut] = tx.moveCall({
          target: `${DEEPBOOK.packageId}::pool::swap_exact_base_for_quote`,
          typeArguments: [pair.baseType, pair.quoteType],
          arguments: [tx.object(pair.poolId), assetCoin, deepCoinArg, tx.pure.u64(0), tx.object('0x6')],
        });

        // Repay obligation — USDC goes back to vault (hot potato consumed)
        tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::repay_obligation_with_usdc`,
          typeArguments: [USDC.TYPE],
          arguments: [obligation, tx.object(vaultId), quoteOut, tx.pure.u64(0)],
        });

        tx.transferObjects([baseOut, deepOut], account.address);
      }

      setTxStatus('Waiting for wallet...');
      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Trade executed! TX: ${result.digest.slice(0, 8)}...`);

      setTimeout(() => {
        fetchPositions();
        fetchVaultBalance();
        fetchTradeHistory();
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

  // ============ Render ============

  if (!isLeader) return null;

  const pair = TRADING_PAIRS[selectedPair];
  const hasAssetVault = positions.some(v => v.assetType === pair?.baseType);
  const currentPosition = positions.find(v => v.assetType === pair?.baseType);
  const totalPositionValue = positions.reduce((sum, p) => sum + p.valueUsdc, 0);

  return (
    <div className="bg-black border border-border">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-primary" />
            <h3 className="font-black text-lg">API Trade</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              Balance: <span className="text-white font-mono">${vaultUsdcBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </span>
            <button
              onClick={() => { fetchPositions(); fetchVaultBalance(); fetchTradeHistory(); }}
              className="text-gray-400 hover:text-white"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(['trade', 'positions', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors ${
              activeTab === tab ? 'text-primary border-b-2 border-primary' : 'text-gray-500'
            }`}
          >
            {tab === 'trade' ? 'Trade' : tab === 'positions' ? `Positions (${positions.length})` : `History (${tradeHistory.length})`}
          </button>
        ))}
      </div>

      {/* ======== TRADE TAB ======== */}
      {activeTab === 'trade' && (
        <div className="p-4 space-y-3">
          {/* Asset Pair Selector */}
          <div className="flex gap-2">
            {TRADING_PAIRS.map((p, i) => (
              <button
                key={i}
                onClick={() => setSelectedPair(i)}
                className={`flex-1 py-2 text-xs font-bold border transition-colors ${
                  selectedPair === i
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-white/10 text-gray-500 hover:text-white'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Buy/Sell */}
          <div className="grid grid-cols-2 gap-0 border border-white/10">
            <button
              onClick={() => setSide('buy')}
              className={`py-2.5 text-sm font-black uppercase tracking-widest transition-colors ${
                side === 'buy' ? 'bg-green-500 text-black' : 'text-gray-500 hover:text-white'
              }`}
            >
              Buy {pair?.base}
            </button>
            <button
              onClick={() => setSide('sell')}
              className={`py-2.5 text-sm font-black uppercase tracking-widest transition-colors ${
                side === 'sell' ? 'bg-red-500 text-white' : 'text-gray-500 hover:text-white'
              }`}
            >
              Sell {pair?.base}
            </button>
          </div>

          {/* Order Type */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Order:</span>
            <span className="text-white font-bold">Market</span>
          </div>

          {/* Size Input */}
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>{side === 'buy' ? 'Amount (USDC)' : `Amount (${pair?.base})`}</span>
              <span>
                Avail: {side === 'buy'
                  ? `$${vaultUsdcBalance.toFixed(2)}`
                  : `${currentPosition ? (currentPosition.balance / Math.pow(10, currentPosition.decimals)).toFixed(4) : '0'} ${pair?.base}`
                }
              </span>
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white/5 border border-white/10 px-4 py-3 text-white text-lg font-mono placeholder:text-gray-600 focus:border-primary/50 outline-none"
            />
          </div>

          {/* Percentage Buttons */}
          <div className="grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map(pct => (
              <button
                key={pct}
                onClick={() => setPercentage(pct)}
                className="py-1.5 text-xs font-bold border border-white/10 text-gray-400 hover:text-white hover:border-white/30 transition-colors"
              >
                {pct}%
              </button>
            ))}
          </div>

          {/* Asset Vault Warning */}
          {!hasAssetVault && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-yellow-400">
                <AlertCircle size={14} />
                <span>No {pair?.base} vault. Create one first.</span>
              </div>
              <button
                onClick={() => handleCreateAssetVault(pair.baseType)}
                disabled={loading}
                className="text-xs font-bold text-yellow-400 border border-yellow-400/30 px-3 py-1 hover:bg-yellow-400/10"
              >
                <Plus className="inline mr-1" size={12} />
                Create
              </button>
            </div>
          )}

          {/* Status */}
          {txStatus && (
            <div className={`p-3 text-sm ${
              txStatus.includes('Error') ? 'bg-red-500/10 text-red-400'
                : txStatus.includes('Waiting') ? 'bg-blue-500/10 text-blue-400'
                : 'bg-primary/10 text-primary'
            }`}>
              {loading && <Loader2 className="animate-spin inline mr-2" size={14} />}
              {txStatus}
            </div>
          )}

          {/* Execute Button */}
          <button
            onClick={handleExecuteTrade}
            disabled={loading || !amount || !leaderCapId || !hasAssetVault || isPending}
            className={`w-full py-3.5 font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
              side === 'buy'
                ? 'bg-green-500 text-black hover:bg-green-400'
                : 'bg-red-500 text-white hover:bg-red-400'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <ArrowRightLeft size={16} />}
            {side === 'buy' ? `Buy ${pair?.base}` : `Sell ${pair?.base}`}
          </button>

          <p className="text-[10px] text-gray-600 text-center">
            Single PTB via DeepBook V3 — atomic execution
          </p>
        </div>
      )}

      {/* ======== POSITIONS TAB ======== */}
      {activeTab === 'positions' && (
        <div className="p-4 space-y-3">
          {/* USDC Reserve */}
          <div className="bg-white/5 border border-white/10 p-3 flex justify-between items-center">
            <div>
              <span className="text-xs text-gray-500">USDC Reserve</span>
              <p className="font-mono font-bold text-lg text-white">${vaultUsdcBalance.toFixed(2)}</p>
            </div>
            <Wallet size={20} className="text-primary" />
          </div>

          {/* Asset Positions */}
          {positions.length === 0 ? (
            <div className="text-center py-6 text-gray-500 text-sm">No asset positions</div>
          ) : (
            positions.map(pos => (
              <div key={pos.assetVaultId} className="bg-white/5 border border-white/10 p-3">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-bold text-white">{pos.symbol}</span>
                    <span className="text-xs text-gray-500 ml-2">{pos.assetVaultId.slice(0, 10)}...</span>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-white">
                      {(pos.balance / Math.pow(10, pos.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </p>
                    <p className="text-xs text-gray-500">{pos.symbol}</p>
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Create Asset Vault Buttons */}
          <div className="border-t border-border pt-3">
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-widest font-bold">Add Asset Vault</p>
            {TRADING_PAIRS.map((p, i) => {
              const exists = positions.some(v => v.assetType === p.baseType);
              return (
                <button
                  key={i}
                  onClick={() => handleCreateAssetVault(p.baseType)}
                  disabled={loading || exists || !leaderCapId}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm border mb-1 transition-colors ${
                    exists
                      ? 'border-green-500/30 text-green-400/50 cursor-not-allowed'
                      : 'border-white/10 text-gray-400 hover:border-primary/50 hover:text-white'
                  } disabled:opacity-50`}
                >
                  <span>{exists ? '✓' : '+'} {p.base} Vault</span>
                  <span className="text-xs text-gray-600">{exists ? 'Created' : 'Create'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ======== HISTORY TAB ======== */}
      {activeTab === 'history' && (
        <div className="p-4">
          {tradeHistory.length === 0 ? (
            <div className="text-center py-6 text-gray-500 text-sm">No trade history</div>
          ) : (
            <div className="space-y-1">
              {tradeHistory.map((trade, i) => (
                <div key={i} className="flex justify-between items-center bg-white/5 border border-white/10 p-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    {trade.type === 'buy' ? (
                      <TrendingUp size={12} className="text-green-400" />
                    ) : (
                      <TrendingDown size={12} className="text-red-400" />
                    )}
                    <span className={trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}>
                      {trade.type.toUpperCase()}
                    </span>
                    <span className="text-white">{trade.asset}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-white">{(trade.amount / 1e6).toFixed(2)}</span>
                    <a
                      href={`https://suiscan.xyz/testnet/tx/${trade.txDigest}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 ml-2 hover:text-primary"
                    >
                      {trade.txDigest.slice(0, 6)}...
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
