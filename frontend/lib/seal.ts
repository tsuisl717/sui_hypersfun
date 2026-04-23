// Seal MEV Protection - Encrypted Trade Intents
// Uses @mysten/seal for time-lock encryption of Leader trade intents

import { SealClient } from '@mysten/seal';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { PACKAGE_ID, MODULES } from '@/lib/contracts/config';

// ============ Config ============

// Seal key servers (testnet)
const SEAL_KEY_SERVERS = [
  { objectId: '0x3cf2a38f061ede3239c1629cb80a9be0e0676b1c15d34c94d104d4ba9d99076f', weight: 1 },
  { objectId: '0x81aeaa8c25d2c912e1dc23b4372305b7a602c4ec4cc3e510963bc635e500aa37', weight: 1 },
];

// ============ Types ============

export interface TradeIntent {
  action: 'spot_buy' | 'spot_sell' | 'margin_long' | 'margin_short';
  pair: string;         // e.g., "SUI/DBUSDC"
  amount: number;       // USDC amount
  leverage?: number;    // For margin trades
  slippageBps: number;
  timestamp: number;
}

export interface SealedIntent {
  encryptedData: Uint8Array;
  decryptAfter: number;  // ms since epoch
  expiresAt: number;
  intentId?: string;     // on-chain object ID after submission
}

// ============ Seal Client ============

let _sealClient: SealClient | null = null;

export function getSealClient(suiClient: SuiClient): SealClient {
  if (!_sealClient) {
    _sealClient = new SealClient({
      suiClient,
      serverConfigs: SEAL_KEY_SERVERS,
      verifyKeyServers: false, // Skip verification on testnet
      timeout: 15000,
    });
  }
  return _sealClient;
}

// ============ Encrypt Trade Intent ============

export async function encryptTradeIntent(
  suiClient: SuiClient,
  intent: TradeIntent,
  delayMs: number = 30_000, // 30 second default delay
): Promise<SealedIntent> {
  const sealClient = getSealClient(suiClient);

  const decryptAfter = Date.now() + delayMs;
  const expiresAt = decryptAfter + 300_000; // 5 min execution window

  // Encode the identity as BCS u64 (timestamp when decryption is allowed)
  const idBytes = bcs.u64().serialize(BigInt(decryptAfter)).toBytes();
  // Convert to hex string as required by Seal SDK
  const id = Array.from(idBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Encrypt the trade intent
  const data = new TextEncoder().encode(JSON.stringify(intent));

  const { encryptedObject } = await sealClient.encrypt({
    threshold: 2,
    packageId: PACKAGE_ID,
    id,
    data,
  });

  return {
    encryptedData: encryptedObject,
    decryptAfter,
    expiresAt,
  };
}

// ============ Build Seal Approve TX ============

export function buildSealApproveTx(
  decryptAfter: number,
): Transaction {
  const tx = new Transaction();

  const id = bcs.u64().serialize(BigInt(decryptAfter)).toBytes();

  tx.moveCall({
    target: `${PACKAGE_ID}::${MODULES.SEAL}::seal_approve`,
    arguments: [
      tx.pure.vector('u8', Array.from(id)),
      tx.object('0x6'), // Clock
    ],
  });

  return tx;
}

// ============ Create On-Chain Sealed Intent ============

export function buildCreateSealedIntentTx(
  vaultId: string,
  leaderCapId: string,
  encryptedData: Uint8Array,
  decryptAfter: number,
  intentDuration: number,
  usdcType: string,
): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::${MODULES.SEAL}::create_sealed_intent`,
    typeArguments: [usdcType],
    arguments: [
      tx.object(vaultId),
      tx.object(leaderCapId),
      tx.pure.vector('u8', Array.from(encryptedData)),
      tx.pure.u64(decryptAfter),
      tx.pure.u64(intentDuration),
      tx.object('0x6'), // Clock
    ],
  });

  return tx;
}

// ============ Seal Config Export ============

export const SEAL_CONFIG = {
  keyServers: SEAL_KEY_SERVERS,
  defaultDelayMs: 30_000,     // 30 seconds
  executionWindowMs: 300_000, // 5 minutes
};
