'use client';

import { useState } from 'react';
import { Loader2, ShoppingCart, Wallet, TrendingUp, TrendingDown, DollarSign, Activity } from 'lucide-react';
import { VaultInfo, EXIT_FEE_TIERS } from './types';

interface TradingPanelProps {
  vault: VaultInfo;
  isConnected: boolean;
  userUsdcBalance?: string;
  userShareBalance?: number;
  isPending: boolean;
  txStatus: string | null;
  onBuy: (amount: string) => void;
  onSell: (amount: string) => void;
}

export default function TradingPanel({
  vault,
  isConnected,
  userUsdcBalance,
  userShareBalance = 0,
  isPending,
  txStatus,
  onBuy,
  onSell,
}: TradingPanelProps) {
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');

  const handleSubmit = () => {
    if (!amount) return;
    if (activeTab === 'buy') {
      onBuy(amount);
    } else {
      onSell(amount);
    }
    setAmount('');
  };

  const estimatedOutput = () => {
    if (!amount || !vault) return '0';
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) return '0';

    if (activeTab === 'buy') {
      const price = parseFloat(vault.buyPrice) || 1;
      return (amountNum / price).toFixed(4);
    } else {
      const nav = parseFloat(vault.nav) || 1;
      return (amountNum * nav).toFixed(2);
    }
  };

  return (
    <div className="bg-black border border-border h-full flex flex-col">
      {/* Vault Stats Header */}
      <div className="border-b border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black">{vault.name}</h2>
            <p className="text-sm text-gray-400 font-mono">{vault.symbol}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-primary">${vault.nav}</p>
            <p className="text-xs text-gray-400">NAV per Share</p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white/5 p-2 rounded">
            <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
              <DollarSign size={12} />
              <span>TVL</span>
            </div>
            <p className="font-bold">${vault.tvl}</p>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
              <Activity size={12} />
              <span>Volume</span>
            </div>
            <p className="font-bold">${vault.totalVolume}</p>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
              <TrendingUp size={12} />
              <span>Buy Price</span>
            </div>
            <p className="font-bold text-green-400">${vault.buyPrice}</p>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
              <TrendingDown size={12} />
              <span>Sell Price</span>
            </div>
            <p className="font-bold text-red-400">${vault.sellPrice}</p>
          </div>
        </div>
      </div>

      {/* Trade Form */}
      <div className="flex-1 p-4 flex flex-col">
        {/* Tabs */}
        <div className="flex border-b border-border mb-4">
          <button
            onClick={() => setActiveTab('buy')}
            className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
              activeTab === 'buy' ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-500'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setActiveTab('sell')}
            className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
              activeTab === 'sell' ? 'text-red-400 border-b-2 border-red-400' : 'text-gray-500'
            }`}
          >
            Sell
          </button>
        </div>

        {!isConnected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <Wallet className="mb-4 text-gray-500" size={48} />
            <p className="text-gray-400 mb-2">Connect wallet to trade</p>
            <p className="text-xs text-gray-600">Use the Connect button above</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Balance */}
            {userUsdcBalance && activeTab === 'buy' && (
              <div className="flex justify-between text-xs text-gray-400 mb-2">
                <span>Available USDC</span>
                <span className="font-mono">${userUsdcBalance}</span>
              </div>
            )}

            {/* Amount Input */}
            <div className="mb-4">
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                {activeTab === 'buy' ? 'USDC Amount' : 'Shares to Sell'}
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-600 focus:border-primary/50 outline-none transition-colors text-lg font-mono"
              />
              {/* Percentage buttons */}
              <div className="grid grid-cols-4 gap-1 mt-2">
                {[25, 50, 75, 100].map(pct => {
                  const maxVal = activeTab === 'buy'
                    ? parseFloat(userUsdcBalance || '0')
                    : userShareBalance / 1_000_000; // shares have 6 decimals
                  return (
                    <button
                      key={pct}
                      onClick={() => setAmount((maxVal * pct / 100).toFixed(2))}
                      className="py-1.5 text-xs font-bold border border-white/10 text-gray-400 hover:text-white hover:border-white/30 transition-colors"
                    >
                      {pct}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Estimated Output */}
            {amount && (
              <div className="bg-white/5 border border-white/10 p-3 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">
                    Estimated {activeTab === 'buy' ? 'Shares' : 'USDC'}
                  </span>
                  <span className="font-mono font-bold">{estimatedOutput()}</span>
                </div>
              </div>
            )}

            {/* Exit Fee Info (for sell) */}
            {activeTab === 'sell' && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 mb-4 text-xs">
                <p className="text-yellow-400 font-bold mb-1">Exit Fee Schedule</p>
                <div className="text-gray-400 space-y-1">
                  {EXIT_FEE_TIERS.map((tier, i) => (
                    <div key={i} className="flex justify-between">
                      <span>
                        {i === EXIT_FEE_TIERS.length - 1
                          ? `${tier.daysHeld}+ days`
                          : `${tier.daysHeld}-${EXIT_FEE_TIERS[i + 1]?.daysHeld || '∞'} days`}
                      </span>
                      <span className={tier.feeBps === 0 ? 'text-green-400' : 'text-yellow-400'}>
                        {tier.feeBps / 100}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status */}
            {txStatus && (
              <div
                className={`p-3 mb-4 text-sm ${
                  txStatus.includes('Error') ? 'bg-red-500/10 text-red-400' : 'bg-primary/10 text-primary'
                }`}
              >
                {txStatus}
              </div>
            )}

            {/* Submit Button */}
            <button
              onClick={handleSubmit}
              disabled={isPending || !amount}
              className={`mt-auto w-full py-4 font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                activeTab === 'buy'
                  ? 'bg-green-500 text-black hover:bg-green-400'
                  : 'bg-red-500 text-white hover:bg-red-400'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isPending ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <ShoppingCart size={16} />
              )}
              {activeTab === 'buy' ? 'Buy Shares' : 'Sell Shares'}
            </button>
          </div>
        )}
      </div>

      {/* Vault Info Footer */}
      <div className="border-t border-border p-4 text-xs">
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-400">Performance Fee</span>
            <span>{vault.performanceFeeBps / 100}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Total Supply</span>
            <span className="font-mono">{vault.totalSupply}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Leader</span>
            <span className="font-mono text-primary">{vault.leader.slice(0, 8)}...</span>
          </div>
        </div>
      </div>
    </div>
  );
}
