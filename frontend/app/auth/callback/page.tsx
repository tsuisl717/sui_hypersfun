'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEnokiFlow } from '@mysten/enoki/react';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export default function AuthCallbackPage() {
  const router = useRouter();
  const enokiFlow = useEnokiFlow();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      try {
        const hash = window.location.hash;
        if (!hash) {
          setStatus('error');
          setError('No authentication data received');
          return;
        }

        await enokiFlow.handleAuthCallback(hash);
        setStatus('success');

        // Redirect to home after short delay
        setTimeout(() => {
          router.push('/');
        }, 1500);
      } catch (e) {
        console.error('zkLogin callback error:', e);
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Authentication failed');
      }
    }

    handleCallback();
  }, [enokiFlow, router]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-center space-y-4">
        {status === 'processing' && (
          <>
            <Loader2 className="animate-spin mx-auto text-primary" size={48} />
            <h2 className="text-xl font-bold text-white">Signing in...</h2>
            <p className="text-gray-400 text-sm">Generating zero-knowledge proof</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="mx-auto text-green-400" size={48} />
            <h2 className="text-xl font-bold text-white">Signed in!</h2>
            <p className="text-gray-400 text-sm">Redirecting...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="mx-auto text-red-400" size={48} />
            <h2 className="text-xl font-bold text-white">Sign in failed</h2>
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={() => router.push('/')}
              className="mt-4 px-6 py-2 bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              Go back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
