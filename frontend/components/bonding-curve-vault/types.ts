// Shared types for SUI Bonding Curve Vault components

export interface VaultInfo {
  id: string;
  leader: string;
  name: string;
  symbol: string;
  performanceFeeBps: number;
  totalSupply: string;
  nav: string;
  buyPrice: string;
  sellPrice: string;
  tvl: string;
  totalVolume: string;
  metadataURI?: string;
  imageUrl?: string;
  description?: string;
  createdAt: number;
  verified: boolean;
}

export interface BondingCurveState {
  virtualBase: string;
  virtualTokens: string;
  realBase: string;
  realTokens: string;
}

export interface UserShare {
  objectId: string;
  amount: number;
  entryNav: number;
  acquiredAt: number;
}

export interface Trade {
  id: string;
  txHash: string;
  type: 'buy' | 'sell';
  user: string;
  usdcAmount: string;
  tokenAmount: string;
  price: string;
  nav: string;
  exitFee?: string;
  performanceFee?: string;
  timestamp: number;
}

export interface ExitFeeTier {
  daysHeld: number;
  feeBps: number;
}

export const EXIT_FEE_TIERS: ExitFeeTier[] = [
  { daysHeld: 0, feeBps: 1500 },   // 0-3 days: 15%
  { daysHeld: 3, feeBps: 800 },    // 3-7 days: 8%
  { daysHeld: 7, feeBps: 300 },    // 7-30 days: 3%
  { daysHeld: 30, feeBps: 0 },     // 30+ days: 0%
];

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
