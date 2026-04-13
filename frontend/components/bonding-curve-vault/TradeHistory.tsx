'use client';

import { useState } from 'react';
import { Trade, UserShare, EXIT_FEE_TIERS } from './types';
import { formatAddress } from '@/lib/contracts/config';
import { RefreshCw } from 'lucide-react';

interface TradeHistoryProps {
  trades: Trade[];
  userShares: UserShare[];
  loading?: boolean;
  onRefresh?: () => void;
  vaultNav?: string;
  explorerUrl?: string;
}

export default function TradeHistory({
  trades,
  userShares,
  loading,
  onRefresh,
  vaultNav,
  explorerUrl = 'https://testnet.suivision.xyz',
}: TradeHistoryProps) {
  const [activeTab, setActiveTab] = useState<'trades' | 'holders'>('trades');

  // Calculate exit fee for a share
  const calculateExitFee = (acquiredAt: number): { feeBps: number; daysHeld: number } => {
    const now = Math.floor(Date.now() / 1000);
    const daysHeld = Math.floor((now - acquiredAt) / 86400);

    for (let i = EXIT_FEE_TIERS.length - 1; i >= 0; i--) {
      if (daysHeld >= EXIT_FEE_TIERS[i].daysHeld) {
        return { feeBps: EXIT_FEE_TIERS[i].feeBps, daysHeld };
      }
    }
    return { feeBps: EXIT_FEE_TIERS[0].feeBps, daysHeld };
  };

  return (
    <div className="flex-1 border-t border-border bg-black flex flex-col min-h-[200px] overflow-hidden">
      {/* Tabs */}
      <div className="h-10 border-b border-border flex px-4 items-center gap-4 shrink-0">
        <button
          onClick={() => setActiveTab('trades')}
          className={`text-sm font-black uppercase cursor-pointer h-full tracking-widest transition-colors ${
            activeTab === 'trades' ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-white'
          }`}
        >
          Trade History
        </button>
        <button
          onClick={() => setActiveTab('holders')}
          className={`text-sm font-black uppercase cursor-pointer h-full tracking-widest transition-colors ${
            activeTab === 'holders' ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-white'
          }`}
        >
          Your Shares ({userShares.length})
        </button>
        <div className="flex-1" />
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-gray-500 hover:text-primary transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'trades' && (
          <div className="p-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : trades.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">No trades yet</p>
            ) : (
              <>
                {/* Mobile: Compact layout */}
                <div className="md:hidden space-y-1">
                  {trades.map((trade) => {
                    const usdcAmt = (parseFloat(trade.usdcAmount) / 1_000_000).toFixed(2);
                    const exitFee = trade.exitFee ? parseFloat(trade.exitFee) / 1_000_000 : 0;
                    const exitFeePercent = exitFee > 0 ? (exitFee / (parseFloat(trade.usdcAmount) / 1_000_000 + exitFee)) * 100 : 0;

                    return (
                      <div key={trade.id} className="flex items-center justify-between text-[10px] py-1 border-b border-gray-800/50">
                        <div className="flex items-center gap-1">
                          <span className={`font-bold ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.type === 'buy' ? 'B' : 'S'}
                          </span>
                          <a
                            href={`${explorerUrl}/address/${trade.user}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white font-mono hover:text-primary"
                          >
                            {formatAddress(trade.user, 4)}
                          </a>
                          <span className="text-gray-500">${usdcAmt}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {trade.type === 'sell' && exitFee > 0 && (
                            <span className="text-orange-400">{exitFeePercent.toFixed(1)}%</span>
                          )}
                          <span className="text-gray-500">
                            {new Date(trade.timestamp * 1000).toLocaleString('en-US', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop: Table layout */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm font-mono">
                    <thead className="text-gray-600 border-b border-white/5 sticky top-0 bg-black z-10">
                      <tr>
                        <th className="text-left pb-3">USER</th>
                        <th className="text-left pb-3">TYPE</th>
                        <th className="text-right pb-3">USDC</th>
                        <th className="text-right pb-3">TOKENS</th>
                        <th className="text-right pb-3">PRICE</th>
                        <th className="text-right pb-3">EXIT FEE</th>
                        <th className="text-right pb-3">TIME</th>
                        <th className="text-right pb-3">TX</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-400">
                      {trades.map((trade) => {
                        const exitFee = trade.exitFee ? parseFloat(trade.exitFee) / 1_000_000 : 0;
                        const exitFeePercent = exitFee > 0 ? (exitFee / (parseFloat(trade.usdcAmount) / 1_000_000 + exitFee)) * 100 : 0;

                        return (
                          <tr key={trade.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                            <td className="py-3">
                              <a
                                href={`${explorerUrl}/address/${trade.user}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-white font-mono hover:text-primary transition-colors"
                              >
                                {formatAddress(trade.user, 6)}
                              </a>
                            </td>
                            <td className={`py-3 font-bold ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                              {trade.type.toUpperCase()}
                            </td>
                            <td className="text-right py-3">${(parseFloat(trade.usdcAmount) / 1_000_000).toFixed(2)}</td>
                            <td className="text-right py-3">{(parseFloat(trade.tokenAmount) / 1_000_000).toFixed(4)}</td>
                            <td className="text-right py-3">${(parseFloat(trade.price) / 1_000_000).toFixed(6)}</td>
                            <td className="text-right py-3">
                              {trade.type === 'sell' ? (
                                exitFee > 0 ? (
                                  <span className="text-orange-400" title={`Fee: $${exitFee.toFixed(2)}`}>
                                    {exitFeePercent.toFixed(1)}%
                                  </span>
                                ) : (
                                  <span className="text-green-400">0%</span>
                                )
                              ) : (
                                <span className="text-gray-600">-</span>
                              )}
                            </td>
                            <td className="text-right py-3 text-gray-500">
                              {new Date(trade.timestamp * 1000).toLocaleString()}
                            </td>
                            <td className="text-right py-3">
                              <a
                                href={`${explorerUrl}/txblock/${trade.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-primary transition-colors"
                              >
                                {trade.txHash.slice(0, 8)}...
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'holders' && (
          <div className="p-4">
            {userShares.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No shares found</p>
                <p className="text-gray-600 text-sm mt-2">Buy some shares to get started!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {userShares.map((share, index) => {
                  const { feeBps, daysHeld } = calculateExitFee(share.acquiredAt);
                  const currentNav = vaultNav ? parseFloat(vaultNav) : 1;
                  const entryNav = share.entryNav / 1_000_000;
                  const pnlPercent = entryNav > 0 ? ((currentNav - entryNav) / entryNav) * 100 : 0;

                  return (
                    <div key={share.objectId} className="bg-white/5 border border-white/10 p-4">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm text-gray-400">Share #{index + 1}</span>
                        <span className="font-mono text-xs text-gray-500">{formatAddress(share.objectId, 6)}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-gray-400 text-xs mb-1">Amount</p>
                          <p className="font-bold text-primary">{(share.amount / 1_000_000).toFixed(4)}</p>
                        </div>
                        <div>
                          <p className="text-gray-400 text-xs mb-1">Entry NAV</p>
                          <p className="font-mono">${entryNav.toFixed(6)}</p>
                        </div>
                        <div>
                          <p className="text-gray-400 text-xs mb-1">Days Held</p>
                          <p className="font-mono">{daysHeld}d</p>
                        </div>
                        <div>
                          <p className="text-gray-400 text-xs mb-1">Exit Fee</p>
                          <p className={`font-bold ${feeBps === 0 ? 'text-green-400' : 'text-yellow-400'}`}>
                            {feeBps / 100}%
                          </p>
                        </div>
                      </div>
                      {pnlPercent !== 0 && (
                        <div className="mt-3 pt-3 border-t border-white/5">
                          <span className="text-xs text-gray-400">Unrealized P&L: </span>
                          <span className={`font-bold ${pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Total */}
                <div className="border-t border-white/10 pt-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Total Shares</span>
                    <span className="font-bold text-primary">
                      {(userShares.reduce((sum, s) => sum + s.amount, 0) / 1_000_000).toFixed(4)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
