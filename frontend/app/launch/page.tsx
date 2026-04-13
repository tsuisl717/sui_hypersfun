'use client';

import { useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { ArrowLeft, Rocket } from 'lucide-react';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { PACKAGE_ID, MODULES, OBJECTS } from '@/lib/contracts/config';

export default function LaunchPage() {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [performanceFee, setPerformanceFee] = useState('20');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleCreateVault = async () => {
    if (!account) {
      setError('Please connect your wallet first');
      return;
    }

    if (!name || !symbol) {
      setError('Please fill in all required fields');
      return;
    }

    if (!OBJECTS.FACTORY) {
      setError('Factory contract not configured. Please set NEXT_PUBLIC_FACTORY_ID in .env.local');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const tx = new Transaction();

      // Call create_vault on factory
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.FACTORY}::create_vault`,
        arguments: [
          tx.object(OBJECTS.FACTORY),
          tx.pure.string(name),
          tx.pure.string(symbol),
          tx.pure.u64(parseInt(performanceFee) * 100), // Convert to BPS
          tx.object('0x6'), // Clock
        ],
      });

      const result = await signAndExecute({
        transaction: tx,
      });

      setSuccess(`Vault created successfully! Transaction: ${result.digest}`);
      setName('');
      setSymbol('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create vault');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onLogoClick={() => window.location.href = '/'}
      />

      {/* Content */}
      <main className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/" className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="w-12 h-12 bg-primary/20 border border-primary/40 flex items-center justify-center">
            <Rocket className="text-primary" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">Create Vault</h1>
            <p className="text-sm text-gray-500">Launch your tokenized fund on SUI</p>
          </div>
        </div>

        {!account ? (
          <div className="border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
            <p className="text-yellow-400 font-bold">Please connect your wallet to create a vault</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Name */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                Vault Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Alpha Fund"
                className="w-full bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-600 focus:border-primary/50 outline-none transition-colors"
              />
            </div>

            {/* Symbol */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                Token Symbol *
              </label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="e.g., ALPHA"
                maxLength={10}
                className="w-full bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-600 focus:border-primary/50 outline-none transition-colors uppercase"
              />
            </div>

            {/* Performance Fee */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                Performance Fee (%)
              </label>
              <input
                type="number"
                value={performanceFee}
                onChange={(e) => setPerformanceFee(e.target.value)}
                placeholder="20"
                min="0"
                max="30"
                className="w-full bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-600 focus:border-primary/50 outline-none transition-colors"
              />
              <p className="text-xs text-gray-500 mt-1">Max 30%. You earn this % of profits above entry NAV.</p>
            </div>

            {/* Error */}
            {error && (
              <div className="border border-red-500/30 bg-red-500/10 p-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Success */}
            {success && (
              <div className="border border-green-500/30 bg-green-500/10 p-4">
                <p className="text-green-400 text-sm">{success}</p>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleCreateVault}
              disabled={isPending || !name || !symbol}
              className="w-full py-4 bg-primary text-black font-black text-sm uppercase tracking-widest hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Rocket size={16} />
                  Create Vault
                </>
              )}
            </button>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
