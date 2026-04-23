'use client';

import { useCallback, useState } from 'react';
import { useEnokiFlow, useZkLogin } from '@mysten/enoki/react';
import { Loader2, LogOut } from 'lucide-react';
import { formatAddress } from '@/lib/contracts/config';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

export default function ZkLoginButton() {
  const enokiFlow = useEnokiFlow();
  const zkLogin = useZkLogin();
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = useCallback(async () => {
    if (!GOOGLE_CLIENT_ID) {
      console.error('NEXT_PUBLIC_GOOGLE_CLIENT_ID not configured');
      return;
    }

    setLoading(true);
    try {
      const url = await enokiFlow.createAuthorizationURL({
        provider: 'google',
        clientId: GOOGLE_CLIENT_ID,
        redirectUrl: `${window.location.origin}/auth/callback`,
        extraParams: { prompt: 'consent' },
      });
      window.location.href = url;
    } catch (e) {
      console.error('zkLogin error:', e);
      setLoading(false);
    }
  }, [enokiFlow]);

  const handleLogout = useCallback(() => {
    enokiFlow.logout();
  }, [enokiFlow]);

  // User is logged in via zkLogin
  if (zkLogin.address) {
    return (
      <div className="flex items-center gap-2">
        <div className="bg-green-500/10 border border-green-500/30 px-3 py-1.5 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm font-mono text-green-400">
            {formatAddress(zkLogin.address)}
          </span>
          <span className="text-xs text-green-400/60">zkLogin</span>
        </div>
        <button
          onClick={handleLogout}
          className="p-1.5 text-gray-400 hover:text-white transition-colors"
          title="Sign out"
        >
          <LogOut size={14} />
        </button>
      </div>
    );
  }

  // Not configured
  if (!GOOGLE_CLIENT_ID) {
    return null;
  }

  // Show login button
  return (
    <button
      onClick={handleGoogleLogin}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-bold hover:bg-gray-200 transition-colors disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="animate-spin" size={16} />
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
      )}
      Sign in with Google
    </button>
  );
}
