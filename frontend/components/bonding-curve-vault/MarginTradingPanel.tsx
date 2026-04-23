'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Shield,
  AlertTriangle,
  ArrowRightLeft,
  RefreshCw,
  Settings,
  Zap,
} from 'lucide-react';
import {
  PACKAGE_ID,
  MODULES,
  USDC,
  DEEPBOOK_MARGIN,
  TRADING_PAIRS,
  formatUsdc,
  parseUsdc,
} from '@/lib/contracts/config';
import {
  getDeepBookClient,
  appendMarginLong,
  appendMarginShort,
  MARGIN_POOLS,
} from '@/lib/deepbook';

// ============ Types ============

interface MarginTradingPanelProps {
  vaultId: string;
  leaderAddress: string;
  isLeader: boolean;
}

interface MarginAccountInfo {
  id: string;
  totalAllocated: number;
  maxAllocationBps: number;
  maxLeverage: number;
  enabled: boolean;
  cumulativeProfit: number;
  cumulativeLoss: number;
  tradeCount: number;
}

// ============ Component ============

export default function MarginTradingPanel({
  vaultId,
  leaderAddress,
  isLeader,
}: MarginTradingPanelProps) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  // UI state
  const [activeTab, setActiveTab] = useState<'trade' | 'account' | 'settings'>('trade');
  const [tradeDirection, setTradeDirection] = useState<'long' | 'short'>('long');
  const [selectedPair, setSelectedPair] = useState(0);
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(2);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // On-chain objects
  const [leaderCapId, setLeaderCapId] = useState<string>('');
  const [marginAccount, setMarginAccount] = useState<MarginAccountInfo | null>(null);
  const [vaultUsdcBalance, setVaultUsdcBalance] = useState<number>(0);
  const [marginManagerId, setMarginManagerId] = useState<string>('');

  // ============ Fetch Leader Cap ============

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

  // ============ Fetch Margin Account ============

  const fetchMarginAccount = useCallback(async () => {
    try {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${PACKAGE_ID}::${MODULES.MARGIN}::MarginAccountCreated`,
        },
        limit: 50,
      });

      for (const event of events.data) {
        const parsed = event.parsedJson as Record<string, unknown>;
        if (parsed.vault_id !== vaultId) continue;

        const accountId = parsed.margin_account_id as string;

        try {
          const obj = await client.getObject({
            id: accountId,
            options: { showContent: true },
          });

          if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
            const fields = obj.data.content.fields as Record<string, unknown>;
            setMarginAccount({
              id: accountId,
              totalAllocated: Number(fields.total_allocated || 0),
              maxAllocationBps: Number(fields.max_allocation_bps || 5000),
              maxLeverage: Number(fields.max_leverage || 5000),
              enabled: fields.enabled as boolean,
              cumulativeProfit: Number(fields.cumulative_profit || 0),
              cumulativeLoss: Number(fields.cumulative_loss || 0),
              tradeCount: Number(fields.trade_count || 0),
            });
            return;
          }
        } catch {
          // Account may not exist yet
        }
      }
    } catch (e) {
      console.error('Error fetching margin account:', e);
    }
  }, [client, vaultId]);

  // ============ Fetch Vault Balance ============

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

  // ============ Fetch Margin Manager ============

  const fetchMarginManager = useCallback(async () => {
    if (!account) return;

    try {
      // Look for MarginManager objects owned or created by the leader
      const objects = await client.getOwnedObjects({
        owner: account.address,
        filter: {
          Package: DEEPBOOK_MARGIN.PACKAGE_ID,
        },
        options: { showContent: true, showType: true },
      });

      for (const obj of objects.data) {
        if (obj.data?.type?.includes('MarginManager')) {
          setMarginManagerId(obj.data.objectId);
          return;
        }
      }
    } catch (e) {
      console.error('Error fetching margin manager:', e);
    }
  }, [account, client]);

  // ============ Effects ============

  useEffect(() => {
    if (isLeader) {
      fetchLeaderCap();
      fetchMarginAccount();
      fetchVaultBalance();
      fetchMarginManager();
    }
  }, [isLeader, fetchLeaderCap, fetchMarginAccount, fetchVaultBalance, fetchMarginManager]);

  // ============ Create Margin Account ============

  const handleCreateMarginAccount = async () => {
    if (!account || !leaderCapId) return;

    setLoading(true);
    setTxStatus('Creating margin account...');

    try {
      const tx = new Transaction();

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.MARGIN}::create_margin_account`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(leaderCapId),
        ],
      });

      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Margin account created! TX: ${result.digest.slice(0, 8)}...`);

      setTimeout(() => {
        fetchMarginAccount();
        setTxStatus(null);
      }, 2000);
    } catch (e) {
      console.error('Create margin account error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Create DeepBook MarginManager ============

  const handleCreateMarginManager = async () => {
    if (!account) return;

    setLoading(true);
    setTxStatus('Creating DeepBook MarginManager...');

    try {
      const poolKey = 'SUI_DBUSDC';
      const dbClient = getDeepBookClient(client, account.address, 'testnet');

      const tx = new Transaction();
      dbClient.marginManager.newMarginManager(poolKey)(tx);

      const result = await signAndExecute({ transaction: tx });

      // Find created MarginManager
      for (const change of (result as { objectChanges?: Array<{ type: string; objectType?: string; objectId: string }> }).objectChanges || []) {
        if (change.type === 'created' && change.objectType?.includes('MarginManager')) {
          setMarginManagerId(change.objectId);
          setTxStatus(`MarginManager created! ${change.objectId.slice(0, 12)}...`);
        }
      }

      setTimeout(() => setTxStatus(null), 3000);
    } catch (e) {
      console.error('Create MarginManager error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Execute Margin Trade (SDK + Vault PTB) ============

  const handleMarginTrade = async () => {
    if (!account || !leaderCapId || !marginAccount || !amount || !marginManagerId) return;

    const isLong = tradeDirection === 'long';
    const collateralAmount = parseFloat(amount);
    const poolKey = 'SUI_DBUSDC'; // Primary pool
    const managerKey = 'vault_mm';

    setLoading(true);
    setTxStatus('Building margin trade...');

    try {
      // Initialize DeepBook client with our margin manager
      const dbClient = getDeepBookClient(client, account.address, 'testnet', {
        [managerKey]: { address: marginManagerId, poolKey },
      });

      const tx = new Transaction();

      // Step 1: Extract USDC from vault via our authorization system
      const depositAmount = parseUsdc(amount);

      const [depositAuth] = tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.MARGIN}::authorize_margin_deposit`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(leaderCapId),
          tx.object(marginAccount.id),
          tx.pure.u64(depositAmount),
          tx.pure.u64(600),
          tx.object('0x6'),
        ],
      });

      const [usdcCoin] = tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.MARGIN}::consume_margin_deposit`,
        typeArguments: [USDC.TYPE],
        arguments: [
          depositAuth,
          tx.object(vaultId),
          tx.object(marginAccount.id),
          tx.object('0x6'),
        ],
      });

      // Step 2: Deposit extracted USDC to MarginManager via SDK
      dbClient.marginManager.depositQuote({
        managerKey,
        coin: usdcCoin,
      })(tx);

      // Step 3: Borrow + Place order via SDK
      if (isLong) {
        appendMarginLong(dbClient, tx, {
          managerKey,
          poolKey,
          collateralAmount: 0, // Already deposited via coin above
          leverage,
          direction: 'long',
        });
        // Override: borrow based on leverage
        if (leverage > 1) {
          const borrowAmount = collateralAmount * (leverage - 1);
          dbClient.marginManager.borrowQuote(managerKey, borrowAmount)(tx);
        }
        // Market buy
        dbClient.poolProxy.placeMarketOrder({
          poolKey,
          marginManagerKey: managerKey,
          clientOrderId: Date.now().toString(),
          quantity: collateralAmount * leverage,
          isBid: true,
          payWithDeep: false,
        })(tx);
      } else {
        // Short: deposit collateral, borrow base, sell
        if (leverage > 0) {
          dbClient.marginManager.borrowBase(managerKey, collateralAmount * leverage)(tx);
        }
        dbClient.poolProxy.placeMarketOrder({
          poolKey,
          marginManagerKey: managerKey,
          clientOrderId: Date.now().toString(),
          quantity: collateralAmount * leverage,
          isBid: false,
          payWithDeep: false,
        })(tx);
      }

      // Step 4: Settle
      dbClient.poolProxy.withdrawSettledAmounts(managerKey)(tx);

      setTxStatus('Waiting for wallet approval...');
      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Margin trade executed! TX: ${result.digest.slice(0, 8)}...`);

      setTimeout(() => {
        fetchMarginAccount();
        fetchVaultBalance();
        setTxStatus(null);
        setAmount('');
      }, 2000);
    } catch (e) {
      console.error('Margin trade error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Trade failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Render ============

  if (!isLeader) {
    return (
      <div className="bg-black border border-border p-4">
        <div className="flex items-center gap-2 text-gray-400">
          <Shield size={16} />
          <span className="text-sm">Margin trading - Leader only</span>
        </div>
      </div>
    );
  }

  const pair = TRADING_PAIRS[selectedPair];
  const maxLeverage = marginAccount ? marginAccount.maxLeverage / 1000 : 5;
  const maxAllocation = vaultUsdcBalance * (marginAccount?.maxAllocationBps || 5000) / 10000;
  const currentAllocation = (marginAccount?.totalAllocated || 0) / 1_000_000;
  const netPnl = ((marginAccount?.cumulativeProfit || 0) - (marginAccount?.cumulativeLoss || 0)) / 1_000_000;

  return (
    <div className="bg-black border border-border">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-yellow-400" />
            <h3 className="font-black text-lg">Margin Trading</h3>
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
              DeepBook Margin
            </span>
          </div>
          <button
            onClick={() => {
              fetchMarginAccount();
              fetchVaultBalance();
              fetchMarginManager();
            }}
            className="text-gray-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-white/5 p-2 rounded">
            <span className="text-gray-500">Allocated</span>
            <p className="font-mono text-white">${currentAllocation.toFixed(2)}</p>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <span className="text-gray-500">Max Alloc</span>
            <p className="font-mono text-white">${maxAllocation.toFixed(2)}</p>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <span className="text-gray-500">Net P&L</span>
            <p className={`font-mono ${netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(['trade', 'account', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
              activeTab === tab ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-500'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* No Margin Account */}
      {!marginAccount && activeTab !== 'settings' && (
        <div className="p-4 space-y-3">
          <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-sm text-yellow-400">
            <AlertTriangle className="inline mr-2" size={14} />
            No margin account found. Create one to enable leveraged trading.
          </div>
          <button
            onClick={handleCreateMarginAccount}
            disabled={loading || !leaderCapId}
            className="w-full py-3 bg-yellow-500 text-black font-black text-sm uppercase tracking-widest hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
            Create Margin Account
          </button>
        </div>
      )}

      {/* Trade Tab */}
      {activeTab === 'trade' && marginAccount && (
        <div className="p-4 space-y-4">
          {/* Long/Short Toggle */}
          <div className="flex border border-white/10 rounded">
            <button
              onClick={() => setTradeDirection('long')}
              className={`flex-1 py-2 text-sm font-bold transition-colors ${
                tradeDirection === 'long'
                  ? 'bg-green-500/20 text-green-400'
                  : 'text-gray-500 hover:text-white'
              }`}
            >
              <TrendingUp className="inline mr-1" size={14} />
              Long
            </button>
            <button
              onClick={() => setTradeDirection('short')}
              className={`flex-1 py-2 text-sm font-bold transition-colors ${
                tradeDirection === 'short'
                  ? 'bg-red-500/20 text-red-400'
                  : 'text-gray-500 hover:text-white'
              }`}
            >
              <TrendingDown className="inline mr-1" size={14} />
              Short
            </button>
          </div>

          {/* Trading Pair */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Market
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

          {/* Collateral Amount */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Collateral (USDC)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-600 focus:border-yellow-400/50 outline-none transition-colors text-lg font-mono"
            />
            <div className="text-xs text-gray-500 mt-1">
              Available: ${(maxAllocation - currentAllocation).toFixed(2)} USDC (max allocation)
            </div>
          </div>

          {/* Leverage Slider */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Leverage: {leverage}x
            </label>
            <input
              type="range"
              min={1}
              max={maxLeverage}
              step={0.5}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-yellow-400"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>1x</span>
              <span>{maxLeverage}x</span>
            </div>
          </div>

          {/* Position Size */}
          {amount && (
            <div className="bg-white/5 border border-white/10 p-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Collateral</span>
                <span className="font-mono text-white">${parseFloat(amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Position Size</span>
                <span className="font-mono text-yellow-400">
                  ${(parseFloat(amount) * leverage).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Direction</span>
                <span className={`font-mono ${tradeDirection === 'long' ? 'text-green-400' : 'text-red-400'}`}>
                  {tradeDirection.toUpperCase()} {pair?.base}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Liquidation Risk</span>
                <span className={`font-mono ${leverage >= 4 ? 'text-red-400' : leverage >= 3 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {leverage >= 4 ? 'HIGH' : leverage >= 3 ? 'MEDIUM' : 'LOW'}
                </span>
              </div>
            </div>
          )}

          {/* Warning for high leverage */}
          {leverage >= 4 && (
            <div className="bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400">
              <AlertTriangle className="inline mr-1" size={12} />
              High leverage increases liquidation risk. Your collateral can be lost if the market moves against you.
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
                    : 'bg-yellow-500/10 text-yellow-400'
              }`}
            >
              {loading && <Loader2 className="animate-spin inline mr-2" size={14} />}
              {txStatus}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleMarginTrade}
            disabled={loading || !amount || !leaderCapId || !marginAccount || isPending || !marginManagerId}
            className={`w-full py-3 font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
              tradeDirection === 'long'
                ? 'bg-green-500 text-black hover:bg-green-400'
                : 'bg-red-500 text-white hover:bg-red-400'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {loading ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <ArrowRightLeft size={16} />
            )}
            {tradeDirection === 'long' ? `Long ${pair?.base}` : `Short ${pair?.base}`} {leverage}x
          </button>

          {!marginManagerId && marginAccount && (
            <div className="space-y-2">
              <p className="text-xs text-yellow-400 text-center">
                <AlertTriangle className="inline mr-1" size={12} />
                DeepBook MarginManager not found.
              </p>
              <button
                onClick={handleCreateMarginManager}
                disabled={loading}
                className="w-full py-2 text-sm font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
                Create MarginManager (SUI/DBUSDC)
              </button>
            </div>
          )}

          <p className="text-xs text-gray-500 text-center">
            Executes via DeepBook Margin. Spot margin, not perpetuals.
          </p>
        </div>
      )}

      {/* Account Tab */}
      {activeTab === 'account' && marginAccount && (
        <div className="p-4 space-y-3">
          <div className="space-y-2">
            {[
              { label: 'Margin Account', value: marginAccount.id.slice(0, 12) + '...' },
              { label: 'Status', value: marginAccount.enabled ? 'Active' : 'Disabled', color: marginAccount.enabled ? 'text-green-400' : 'text-red-400' },
              { label: 'Total Allocated', value: `$${currentAllocation.toFixed(2)}` },
              { label: 'Max Allocation', value: `${marginAccount.maxAllocationBps / 100}% ($${maxAllocation.toFixed(2)})` },
              { label: 'Max Leverage', value: `${maxLeverage}x` },
              { label: 'Trade Count', value: marginAccount.tradeCount.toString() },
              { label: 'Cumulative Profit', value: `+$${(marginAccount.cumulativeProfit / 1_000_000).toFixed(2)}`, color: 'text-green-400' },
              { label: 'Cumulative Loss', value: `-$${(marginAccount.cumulativeLoss / 1_000_000).toFixed(2)}`, color: 'text-red-400' },
              { label: 'Net P&L', value: `${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}`, color: netPnl >= 0 ? 'text-green-400' : 'text-red-400' },
            ].map((item) => (
              <div key={item.label} className="flex justify-between items-center bg-white/5 border border-white/10 p-2">
                <span className="text-xs text-gray-400">{item.label}</span>
                <span className={`text-sm font-mono ${item.color || 'text-white'}`}>{item.value}</span>
              </div>
            ))}
          </div>

          {marginManagerId && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-3 text-xs text-blue-400">
              <p className="font-bold mb-1">DeepBook MarginManager</p>
              <p className="font-mono text-blue-300/80 break-all">{marginManagerId}</p>
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="p-4 space-y-4">
          <div className="bg-blue-500/10 border border-blue-500/30 p-3 text-xs text-blue-400">
            <Settings className="inline mr-1" size={12} />
            <span className="font-bold">DeepBook Margin Integration</span>
            <p className="mt-1 text-blue-300/80">
              Leveraged spot margin trading via DeepBook Margin.
              Leader can go long/short with up to {maxLeverage}x leverage.
              All funds are extracted from and returned to the vault.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                DeepBook Margin Package
              </label>
              <p className="font-mono text-xs text-gray-500 break-all">
                {DEEPBOOK_MARGIN.PACKAGE_ID}
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                Margin Registry
              </label>
              <p className="font-mono text-xs text-gray-500 break-all">
                {DEEPBOOK_MARGIN.REGISTRY_ID}
              </p>
            </div>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-400">
            <AlertTriangle className="inline mr-1" size={12} />
            <span className="font-bold">Risk Warning</span>
            <p className="mt-1 text-yellow-300/80">
              Margin trading involves risk of liquidation. If the position value drops
              below the maintenance margin, the position will be liquidated and collateral lost.
              DeepBook Margin uses isolated margin per pool.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
