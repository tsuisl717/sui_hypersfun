'use client';

import { useState, useEffect } from 'react';
import { Globe } from 'lucide-react';

type Network = 'mainnet' | 'testnet';

function getStoredNetwork(): Network {
  if (typeof window === 'undefined') return 'mainnet';
  return (localStorage.getItem('sui_network') as Network) || 'mainnet';
}

export function getActiveNetwork(): Network {
  if (typeof window === 'undefined') {
    return (process.env.NEXT_PUBLIC_SUI_NETWORK as Network) || 'mainnet';
  }
  return getStoredNetwork();
}

export default function NetworkSwitcher() {
  const [network, setNetwork] = useState<Network>('mainnet');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setNetwork(getStoredNetwork());
  }, []);

  const switchNetwork = (n: Network) => {
    if (n === network) { setOpen(false); return; }
    localStorage.setItem('sui_network', n);
    setOpen(false);
    window.location.reload();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`h-9 px-3 flex items-center gap-1.5 border rounded-sm text-xs font-bold uppercase tracking-widest transition-all ${
          network === 'mainnet'
            ? 'border-green-500/30 text-green-400 bg-green-500/10'
            : 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10'
        }`}
      >
        <Globe size={12} />
        <span className="hidden sm:inline">{network === 'mainnet' ? 'Mainnet' : 'Testnet'}</span>
        <span className="sm:hidden">{network === 'mainnet' ? 'M' : 'T'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-black border border-border rounded-sm shadow-xl min-w-[140px]">
            <button
              onClick={() => switchNetwork('mainnet')}
              className={`w-full px-4 py-2.5 text-left text-xs font-bold flex items-center justify-between transition-colors ${
                network === 'mainnet' ? 'text-green-400 bg-green-500/10' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>Mainnet</span>
              {network === 'mainnet' && <span className="text-green-400">&#10003;</span>}
            </button>
            <button
              onClick={() => switchNetwork('testnet')}
              className={`w-full px-4 py-2.5 text-left text-xs font-bold flex items-center justify-between transition-colors ${
                network === 'testnet' ? 'text-yellow-400 bg-yellow-500/10' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>Testnet</span>
              {network === 'testnet' && <span className="text-yellow-400">&#10003;</span>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
