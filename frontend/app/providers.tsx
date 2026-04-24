'use client';

import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EnokiFlowProvider } from '@mysten/enoki/react';
import '@mysten/dapp-kit/dist/index.css';

// Config options for the networks you want to connect to
// @mysten/sui v2: uses `url` + `network`
const { networkConfig } = createNetworkConfig({
  testnet: { url: 'https://fullnode.testnet.sui.io:443', network: 'testnet' },
  mainnet: { url: 'https://fullnode.mainnet.sui.io:443', network: 'mainnet' },
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
