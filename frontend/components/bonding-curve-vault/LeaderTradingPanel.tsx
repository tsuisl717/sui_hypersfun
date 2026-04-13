'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Settings,
  Wallet,
  ArrowRightLeft,
  AlertCircle,
  CheckCircle,
  Clock
} from 'lucide-react';
import { PACKAGE_ID, MODULES, USDC, DEEPBOOK, TRADING_PAIRS, formatUsdc, parseUsdc } from '@/lib/contracts/config';

interface LeaderTradingPanelProps {
  vaultId: string;
  leaderAddress: string;
  isLeader: boolean;
}

interface TradingVaultInfo {
  id: string;
  balance: number;
  maxTradeSize: number;
  dailyLimit: number;
  dailyTraded: number;
  paused: boolean;
}

interface TradeAuthorization {
  id: string;
  amount: number;
  isBuy: boolean;
  expiresAt: number;
}

export default function LeaderTradingPanel({
  vaultId,
  leaderAddress,
  isLeader,
}: LeaderTradingPanelProps) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [activeTab, setActiveTab] = useState<'trade' | 'manage'>('trade');
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [selectedPair, setSelectedPair] = useState(0);
  const [amount, setAmount] = useState('');
  const [minOutput, setMinOutput] = useState('');
  const [slippageBps, setSlippageBps] = useState(100); // 1% default

  const [tradingVault, setTradingVault] = useState<TradingVaultInfo | null>(null);
  const [pendingAuths, setPendingAuths] = useState<TradeAuthorization[]>([]);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Trading Module objects (from env or stored)
  const [tradingModuleId, setTradingModuleId] = useState<string>('');
  const [tradingVaultId, setTradingVaultId] = useState<string>('');
  const [leaderTradeCapId, setLeaderTradeCapId] = useState<string>('');

  // Fetch trading vault info
  const fetchTradingVault = useCallback(async () => {
    if (!tradingVaultId) return;

    try {
      const obj = await client.getObject({
        id: tradingVaultId,
        options: { showContent: true },
      });

      if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
        const fields = obj.data.content.fields as Record<string, unknown>;
        const balanceField = fields.trading_balance as Record<string, unknown>;
        const balance = typeof balanceField === 'object'
          ? Number((balanceField as Record<string, unknown>)?.fields?.value || 0)
          : Number(balanceField || 0);

        setTradingVault({
          id: tradingVaultId,
          balance: balance / 1_000_000,
          maxTradeSize: Number(fields.max_trade_size || 0) / 1_000_000,
          dailyLimit: Number(fields.daily_trade_limit || 0) / 1_000_000,
          dailyTraded: Number(fields.daily_traded || 0) / 1_000_000,
          paused: Boolean(fields.paused),
        });
      }
    } catch (e) {
      console.error('Error fetching trading vault:', e);
    }
  }, [client, tradingVaultId]);

  // Fetch Leader Trade Cap
  const fetchLeaderObjects = useCallback(async () => {
    if (!account || !isLeader) return;

    try {
      // Find LeaderTradeCap owned by this account
      const tradeCaps = await client.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${PACKAGE_ID}::${MODULES.TRADING}::SuiLeaderTradeCap`,
        },
        options: { showContent: true },
      });

      for (const obj of tradeCaps.data) {
        if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
          const fields = obj.data.content.fields as Record<string, unknown>;
          if (fields.vault_id === vaultId) {
            setLeaderTradeCapId(obj.data.objectId);
            setTradingVaultId(fields.trading_vault_id as string);
            break;
          }
        }
      }

      // Find Trading Module (shared object)
      // This would typically be done via events or stored config
    } catch (e) {
      console.error('Error fetching leader objects:', e);
    }
  }, [account, client, isLeader, vaultId]);

  useEffect(() => {
    if (isLeader) {
      fetchLeaderObjects();
    }
  }, [isLeader, fetchLeaderObjects]);

  useEffect(() => {
    if (tradingVaultId) {
      fetchTradingVault();
    }
  }, [tradingVaultId, fetchTradingVault]);

  // Create Trading Vault
  const handleCreateTradingVault = async () => {
    if (!account) return;

    setTxStatus('Creating trading vault...');
    setLoading(true);

    try {
      const tx = new Transaction();

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.TRADING}::create_trading_vault_unlimited`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(process.env.NEXT_PUBLIC_ADMIN_CAP_ID || ''),
          tx.pure.id(vaultId),
          tx.pure.address(account.address),
          tx.object('0x6'), // Clock
        ],
      });

      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Trading vault created! TX: ${result.digest.slice(0, 8)}...`);

      // Refresh leader objects
      setTimeout(() => {
        fetchLeaderObjects();
        setTxStatus(null);
      }, 2000);
    } catch (e) {
      console.error('Create trading vault error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Failed to create trading vault'}`);
    } finally {
      setLoading(false);
    }
  };

  // Deposit to Trading Vault
  const handleDeposit = async () => {
    if (!account || !tradingVaultId || !amount) return;

    setTxStatus('Depositing USDC...');
    setLoading(true);

    try {
      const usdcAmount = parseUsdc(amount);

      // Get user's USDC coins
      const coins = await client.getCoins({
        owner: account.address,
        coinType: USDC.TYPE,
      });

      if (coins.data.length === 0) {
        setTxStatus('Error: No USDC found in wallet');
        setLoading(false);
        return;
      }

      const tx = new Transaction();

      const [primaryCoin, ...otherCoins] = coins.data;
      if (otherCoins.length > 0) {
        tx.mergeCoins(
          tx.object(primaryCoin.coinObjectId),
          otherCoins.map((c) => tx.object(c.coinObjectId))
        );
      }

      const [paymentCoin] = tx.splitCoins(tx.object(primaryCoin.coinObjectId), [usdcAmount]);

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.TRADING}::deposit_to_trading`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(tradingVaultId),
          paymentCoin,
        ],
      });

      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Deposited! TX: ${result.digest.slice(0, 8)}...`);
      setAmount('');

      setTimeout(() => {
        fetchTradingVault();
        setTxStatus(null);
      }, 2000);
    } catch (e) {
      console.error('Deposit error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Deposit failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // Authorize Trade
  const handleAuthorizeTrade = async () => {
    if (!account || !tradingModuleId || !tradingVaultId || !leaderTradeCapId || !amount) return;

    setTxStatus('Authorizing trade...');
    setLoading(true);

    try {
      const tradeAmount = parseUsdc(amount);
      const pair = TRADING_PAIRS[selectedPair];

      // Simple hash for base/quote types
      const baseTypeHash = selectedPair * 2 + 1;
      const quoteTypeHash = selectedPair * 2 + 2;

      const tx = new Transaction();

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.TRADING}::authorize_trade`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(tradingModuleId),
          tx.object(tradingVaultId),
          tx.object(leaderTradeCapId),
          tx.pure.u64(baseTypeHash),
          tx.pure.u64(quoteTypeHash),
          tx.pure.u64(tradeAmount),
          tx.pure.bool(tradeType === 'buy'),
          tx.pure.u64(0), // min_output
          tx.pure.u64(300), // expiry: 5 minutes
          tx.object('0x6'), // Clock
        ],
      });

      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Trade authorized! TX: ${result.digest.slice(0, 8)}...`);
      setAmount('');

      setTimeout(() => {
        fetchTradingVault();
        setTxStatus(null);
      }, 2000);
    } catch (e) {
      console.error('Authorize trade error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Authorization failed'}`);
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <div className="bg-black border border-border">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-black text-lg">Leader Trading</h3>
          {tradingVault?.paused && (
            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded">
              PAUSED
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400">
          Trade vault assets via DeepBook
        </p>
      </div>

      {/* Trading Vault Status */}
      {tradingVault ? (
        <div className="border-b border-border p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Trading Balance</span>
            <span className="font-mono font-bold text-primary">
              ${tradingVault.balance.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Daily Traded</span>
            <span className="text-gray-400">
              ${tradingVault.dailyTraded.toFixed(2)} / ${tradingVault.dailyLimit.toFixed(2)}
            </span>
          </div>
          <div className="w-full bg-white/10 h-1 rounded">
            <div
              className="bg-primary h-1 rounded"
              style={{
                width: `${Math.min(100, (tradingVault.dailyTraded / tradingVault.dailyLimit) * 100)}%`
              }}
            />
          </div>
        </div>
      ) : (
        <div className="border-b border-border p-4">
          <div className="text-center py-4">
            <AlertCircle className="mx-auto mb-2 text-yellow-400" size={32} />
            <p className="text-sm text-gray-400 mb-3">
              Trading vault not set up
            </p>
            <button
              onClick={handleCreateTradingVault}
              disabled={loading}
              className="bg-primary text-black px-4 py-2 text-sm font-bold"
            >
              {loading ? (
                <Loader2 className="animate-spin inline mr-2" size={14} />
              ) : null}
              Create Trading Vault
            </button>
          </div>
        </div>
      )}

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
          onClick={() => setActiveTab('manage')}
          className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
            activeTab === 'manage' ? 'text-primary border-b-2 border-primary' : 'text-gray-500'
          }`}
        >
          Manage
        </button>
      </div>

      {/* Trade Tab */}
      {activeTab === 'trade' && tradingVault && (
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
              {TRADING_PAIRS.map((pair, i) => (
                <option key={i} value={i} className="bg-black">
                  {pair.name}
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              {tradeType === 'buy' ? 'USDC Amount' : 'Token Amount'}
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-600 focus:border-primary/50 outline-none transition-colors text-lg font-mono"
            />
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

          {/* Submit */}
          <button
            onClick={handleAuthorizeTrade}
            disabled={loading || !amount || !tradingModuleId}
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
            Authorize {tradeType === 'buy' ? 'Buy' : 'Sell'}
          </button>

          <p className="text-xs text-gray-500 text-center">
            Creates authorization ticket for DeepBook swap
          </p>
        </div>
      )}

      {/* Manage Tab */}
      {activeTab === 'manage' && (
        <div className="p-4 space-y-4">
          {/* Deposit */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Deposit USDC
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-white/5 border border-white/10 px-4 py-2 text-white placeholder:text-gray-600 focus:border-primary/50 outline-none"
              />
              <button
                onClick={handleDeposit}
                disabled={loading || !amount || !tradingVaultId}
                className="bg-primary text-black px-4 py-2 font-bold disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={16} /> : 'Deposit'}
              </button>
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

          {/* Trading Info */}
          {tradingVault && (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">Trading Vault ID</span>
                <span className="font-mono text-gray-500">
                  {tradingVault.id.slice(0, 8)}...
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Max Trade Size</span>
                <span>${tradingVault.maxTradeSize.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Daily Limit</span>
                <span>${tradingVault.dailyLimit.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Note */}
          <div className="bg-blue-500/10 border border-blue-500/30 p-3 text-xs text-blue-400">
            <p className="font-bold mb-1">DeepBook Integration</p>
            <p className="text-blue-300/80">
              Trades are executed via DeepBook V3 using PTB.
              Authorization creates a ticket that is consumed in the swap transaction.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
