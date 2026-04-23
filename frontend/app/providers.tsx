'use client';

import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EnokiFlowProvider } from '@mysten/enoki/react';
import '@mysten/dapp-kit/dist/index.css';

// Config options for the networks you want to connect to
const { networkConfig } = createNetworkConfig({
  localnet: { url: getFullnodeUrl('localnet') },
  devnet: { url: getFullnodeUrl('devnet') },
  testnet: { url: getFullnodeUrl('testnet') },
  mainnet: { url: getFullnodeUrl('mainnet') },
});

const queryClient = new QueryClient();

// Enoki API key for zkLogin (configure at https://portal.enoki.mystenlabs.com)
const ENOKI_API_KEY = process.env.NEXT_PUBLIC_ENOKI_API_KEY || 'enoki_public_demo';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect>
          <EnokiFlowProvider apiKey={ENOKI_API_KEY}>
            {children}
          </EnokiFlowProvider>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
