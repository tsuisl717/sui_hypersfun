'use client';

import { useState, useCallback } from 'react';
import {
  Loader2,
  Database,
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  Clock,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import {
  WALRUS,
  uploadVaultHistory,
  loadVaultHistory,
  VaultHistory,
  VaultTradeRecord,
  VaultSnapshot,
} from '@/lib/walrus';

interface VaultHistoryWalrusProps {
  vaultId: string;
  isLeader: boolean;
  trades: VaultTradeRecord[];
  currentNav: number;
  totalSupply: number;
  usdcReserve: number;
}

export default function VaultHistoryWalrus({
  vaultId,
  isLeader,
  trades,
  currentNav,
  totalSupply,
  usdcReserve,
}: VaultHistoryWalrusProps) {
  const [blobId, setBlobId] = useState<string>('');
  const [loadedHistory, setLoadedHistory] = useState<VaultHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // ============ Upload History to Walrus ============

  const handleUploadHistory = useCallback(async () => {
    setLoading(true);
    setStatus('Uploading to Walrus...');

    try {
      const snapshot: VaultSnapshot = {
        vaultId,
        timestamp: Date.now(),
        nav: currentNav,
        totalSupply,
        usdcReserve,
        externalAssets: [],
        marginAllocated: 0,
        tradeCount: trades.length,
      };

      const history: VaultHistory = {
        vaultId,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        trades,
        snapshots: [snapshot],
        blobIds: blobId ? [blobId] : [],
      };

      const newBlobId = await uploadVaultHistory(history);
      setBlobId(newBlobId);
      setStatus(`Uploaded! Blob ID: ${newBlobId.slice(0, 16)}...`);
    } catch (e) {
      console.error('Walrus upload error:', e);
      setStatus(`Error: ${e instanceof Error ? e.message : 'Upload failed'}`);
    } finally {
      setLoading(false);
    }
  }, [vaultId, trades, currentNav, totalSupply, usdcReserve, blobId]);

  // ============ Load History from Walrus ============

  const handleLoadHistory = useCallback(async () => {
    if (!blobId) return;

    setLoading(true);
    setStatus('Loading from Walrus...');

    try {
      const history = await loadVaultHistory(blobId);
      setLoadedHistory(history);
      setStatus(`Loaded! ${history.trades.length} trades, ${history.snapshots.length} snapshots`);
    } catch (e) {
      console.error('Walrus load error:', e);
      setStatus(`Error: ${e instanceof Error ? e.message : 'Load failed'}`);
    } finally {
      setLoading(false);
    }
  }, [blobId]);

  // ============ Render ============

  return (
    <div className="bg-black border border-border">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2 mb-2">
          <Database size={18} className="text-blue-400" />
          <h3 className="font-black text-lg">Vault History</h3>
          <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
            Walrus
          </span>
        </div>
        <p className="text-xs text-gray-500">
          Immutable trade history stored on Walrus decentralized storage
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Blob ID Input */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            Blob ID
          </label>
          <input
            type="text"
            value={blobId}
            onChange={(e) => setBlobId(e.target.value)}
            placeholder="Enter Walrus blob ID or upload new..."
            className="w-full bg-white/5 border border-white/10 px-4 py-2 text-white text-sm font-mono placeholder:text-gray-600 focus:border-blue-400/50 outline-none transition-colors"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {isLeader && (
            <button
              onClick={handleUploadHistory}
              disabled={loading}
              className="flex-1 py-2 text-sm font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
              Upload Snapshot
            </button>
          )}
          <button
            onClick={handleLoadHistory}
            disabled={loading || !blobId}
            className="flex-1 py-2 text-sm font-bold bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
            Load History
          </button>
        </div>

        {/* Status */}
        {status && (
          <div
            className={`p-3 text-sm ${
              status.includes('Error')
                ? 'bg-red-500/10 text-red-400'
                : status.includes('Uploaded') || status.includes('Loaded')
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-blue-500/10 text-blue-400'
            }`}
          >
            {loading && <Loader2 className="animate-spin inline mr-2" size={14} />}
            {status.includes('Uploaded') && <CheckCircle className="inline mr-2" size={14} />}
            {status}
          </div>
        )}

        {/* Loaded History Display */}
        {loadedHistory && (
          <div className="space-y-3">
            {/* Snapshots */}
            {loadedHistory.snapshots.length > 0 && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                  NAV Snapshots
                </label>
                <div className="space-y-1">
                  {loadedHistory.snapshots.map((s, i) => (
                    <div key={i} className="flex justify-between items-center bg-white/5 border border-white/10 p-2 text-xs">
                      <span className="text-gray-400 flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(s.timestamp).toLocaleString()}
                      </span>
                      <span className="font-mono text-white">NAV: ${(s.nav / 1_000_000).toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Trade History */}
            {loadedHistory.trades.length > 0 && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Trade Records ({loadedHistory.trades.length})
                </label>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {loadedHistory.trades.slice(-20).map((t, i) => (
                    <div key={i} className="flex justify-between items-center bg-white/5 border border-white/10 p-2 text-xs">
                      <div className="flex items-center gap-2">
                        {t.type.includes('long') || t.type === 'buy' ? (
                          <TrendingUp size={10} className="text-green-400" />
                        ) : (
                          <TrendingDown size={10} className="text-red-400" />
                        )}
                        <span className={
                          t.type.includes('long') || t.type === 'buy'
                            ? 'text-green-400'
                            : 'text-red-400'
                        }>
                          {t.type.toUpperCase()}
                        </span>
                        {t.leverage && t.leverage > 1 && (
                          <span className="text-yellow-400">{t.leverage}x</span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-white">
                          ${(t.inputAmount / 1_000_000).toFixed(2)}
                        </span>
                        <span className="text-gray-500 ml-2">
                          {new Date(t.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chain of Custody */}
            {loadedHistory.blobIds.length > 0 && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Previous Blob IDs ({loadedHistory.blobIds.length})
                </label>
                <div className="space-y-1">
                  {loadedHistory.blobIds.map((id, i) => (
                    <div key={i} className="text-xs font-mono text-gray-500 truncate">
                      {i + 1}. {id}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Info */}
        <div className="bg-blue-500/10 border border-blue-500/30 p-3 text-xs text-blue-400">
          <p className="font-bold mb-1">Walrus Decentralized Storage</p>
          <p className="text-blue-300/80">
            Trade history and NAV snapshots are stored immutably on Walrus.
            Anyone can verify the vault&apos;s track record using the blob ID.
          </p>
          <p className="text-blue-300/60 mt-1 font-mono">
            Network: {WALRUS.network} | Aggregator: {WALRUS.aggregator.replace('https://', '')}
          </p>
        </div>
      </div>
    </div>
  );
}
