'use client';

import { useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { ConnectButton } from '@mysten/dapp-kit';
import { Loader2, Droplets, CheckCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { PACKAGE_ID, OBJECTS } from '@/lib/contracts/config';

const TUSDC_TYPE = `${PACKAGE_ID}::test_usdc::TEST_USDC`;
const TREASURY_ID = OBJECTS.TUSDC_TREASURY;
const MINT_AMOUNT = 1_000_000_000; // 1000 tUSDC (6 decimals)

export default function FaucetPage() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [status, setStatus] = useState<'idle' | 'minting' | 'success' | 'error'>('idle');
  const [txDigest, setTxDigest] = useState<string>('');
  const [balance, setBalance] = useState<string>('--');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Fetch balance
  const fetchBalance = async () => {
    if (!account) return;
    try {
      const bal = await client.getBalance({
        owner: account.address,
        coinType: TUSDC_TYPE,
      });
      setBalance((Number(bal.totalBalance) / 1_000_000).toFixed(2));
    } catch {
      setBalance('0.00');
    }
  };

  // Mint
  const handleMint = async () => {
    if (!account) return;

    setStatus('minting');
    setErrorMsg('');

    try {
      const tx = new Transaction();

      tx.moveCall({
        target: `${PACKAGE_ID}::test_usdc::mint`,
        arguments: [
          tx.object(TREASURY_ID),
          tx.pure.u64(MINT_AMOUNT),
          tx.pure.address(account.address),
        ],
      });

      const result = await signAndExecute({ transaction: tx });
      setTxDigest(result.digest);
      setStatus('success');

      // Refresh balance
      setTimeout(fetchBalance, 1500);
    } catch (e) {
      console.error('Mint error:', e);
      setErrorMsg(e instanceof Error ? e.message : 'Mint failed');
      setStatus('error');
    }
  };

  // Fetch balance on account change
  if (account && balance === '--') {
    fetchBalance();
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              <Droplets className="inline mr-2 text-blue-400" size={24} />
              tUSDC Faucet
            </h1>
            <p className="text-sm text-gray-500">Testnet token for HypersFun vault testing</p>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white/5 border border-border p-8 space-y-6">
          {/* Token Info */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Token</span>
              <span className="font-bold">tUSDC (Test USDC)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Amount per claim</span>
              <span className="font-mono text-xl text-blue-400">1,000 tUSDC</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Decimals</span>
              <span className="font-mono">6</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Network</span>
              <span className="text-yellow-400">Testnet</span>
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Balance */}
          {account && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-4 flex justify-between items-center">
              <div>
                <p className="text-xs text-blue-400 uppercase tracking-widest font-bold">Your Balance</p>
                <p className="text-2xl font-mono font-bold text-white mt-1">{balance} tUSDC</p>
              </div>
              <button
                onClick={fetchBalance}
                className="text-blue-400 hover:text-blue-300 text-xs"
              >
                Refresh
              </button>
            </div>
          )}

          {/* Connect or Mint */}
          {!account ? (
            <div className="text-center space-y-4">
              <p className="text-gray-400">Connect your wallet to claim tUSDC</p>
              <ConnectButton
                connectText="Connect Wallet"
                className="!mx-auto"
              />
            </div>
          ) : (
            <button
              onClick={handleMint}
              disabled={isPending || status === 'minting'}
              className="w-full py-4 bg-blue-500 text-white font-black text-lg uppercase tracking-widest hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 transition-colors"
            >
              {status === 'minting' ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <Droplets size={20} />
              )}
              {status === 'minting' ? 'Minting...' : 'Claim 1,000 tUSDC'}
            </button>
          )}

          {/* Success */}
          {status === 'success' && (
            <div className="bg-green-500/10 border border-green-500/30 p-4 space-y-2">
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle size={16} />
                <span className="font-bold">1,000 tUSDC minted!</span>
              </div>
              <a
                href={`https://suiscan.xyz/testnet/tx/${txDigest}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-400/80 hover:text-green-300 font-mono break-all"
              >
                TX: {txDigest}
              </a>
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="bg-red-500/10 border border-red-500/30 p-4 text-red-400 text-sm">
              {errorMsg}
            </div>
          )}

          {/* Info */}
          <div className="bg-white/5 border border-white/10 p-4 text-xs text-gray-500 space-y-1">
            <p>tUSDC is a test token for HypersFun on Sui testnet.</p>
            <p>The TreasuryCap is a shared object — anyone can mint unlimited tokens.</p>
            <p>Use tUSDC to create vaults, buy shares, and test trading features.</p>
            <p className="font-mono mt-2 text-gray-600 break-all">
              Type: {TUSDC_TYPE}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
