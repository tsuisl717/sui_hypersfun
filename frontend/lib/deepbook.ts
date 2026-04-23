// DeepBook V3 SDK Client for Margin Trading
// Wraps @mysten/deepbook-v3 for use with HypersFun vaults

import { DeepBookClient } from '@mysten/deepbook-v3';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';

// ============ Types ============

export interface MarginManagerConfig {
  key: string;       // e.g., 'vault_mm'
  address: string;   // on-chain MarginManager object ID
  poolKey: string;   // e.g., 'SUI_DBUSDC'
}

export interface MarginTradeParams {
  managerKey: string;
  poolKey: string;
  direction: 'long' | 'short';
  collateralAmount: number;  // human-readable USDC amount
  leverage: number;          // e.g., 2, 3, 5
}

// ============ Client Factory ============

let _deepbookClient: DeepBookClient | null = null;

export function getDeepBookClient(
  suiClient: SuiClient,
  address: string,
  network: 'testnet' | 'mainnet' = 'testnet',
  marginManagers?: Record<string, { address: string; poolKey: string }>,
): DeepBookClient {
  // Always create fresh if managers change
  _deepbookClient = new DeepBookClient({
    client: suiClient,
    network,
    address,
    marginManagers: marginManagers || {},
  });

  return _deepbookClient;
}

// ============ Create Margin Manager ============

export function buildCreateMarginManagerTx(
  dbClient: DeepBookClient,
  poolKey: string,
  initialDepositCoin?: { coinType: string; coin: ReturnType<Transaction['object']> },
): Transaction {
  const tx = new Transaction();

  if (initialDepositCoin) {
    // Create with initializer → deposit → share
    const { manager, initializer } = dbClient.marginManager.newMarginManagerWithInitializer(poolKey)(tx);

    dbClient.marginManager.depositDuringInitialization({
      manager,
      poolKey,
      coinType: initialDepositCoin.coinType,
      coin: initialDepositCoin.coin,
    })(tx);

    dbClient.marginManager.shareMarginManager(poolKey, manager, initializer)(tx);
  } else {
    // Simple create and share
    dbClient.marginManager.newMarginManager(poolKey)(tx);
  }

  return tx;
}

// ============ Margin Long Trade ============

export function appendMarginLong(
  dbClient: DeepBookClient,
  tx: Transaction,
  params: MarginTradeParams,
) {
  const { managerKey, poolKey, collateralAmount, leverage } = params;

  // 1. Deposit quote (USDC/DBUSDC) as collateral
  dbClient.marginManager.depositQuote({
    managerKey,
    amount: collateralAmount,
  })(tx);

  // 2. Borrow additional quote for leverage
  const borrowAmount = collateralAmount * (leverage - 1);
  if (borrowAmount > 0) {
    dbClient.marginManager.borrowQuote(managerKey, borrowAmount)(tx);
  }

  // 3. Place market buy order (buy base asset with quote)
  const totalSize = collateralAmount * leverage;
  dbClient.poolProxy.placeMarketOrder({
    poolKey,
    marginManagerKey: managerKey,
    clientOrderId: Date.now().toString(),
    quantity: totalSize, // quote quantity for buy
    isBid: true,
    payWithDeep: false,
  })(tx);

  // 4. Withdraw settled amounts
  dbClient.poolProxy.withdrawSettledAmounts(managerKey)(tx);
}

// ============ Margin Short Trade ============

export function appendMarginShort(
  dbClient: DeepBookClient,
  tx: Transaction,
  params: MarginTradeParams,
) {
  const { managerKey, poolKey, collateralAmount, leverage } = params;

  // 1. Deposit quote (USDC/DBUSDC) as collateral
  dbClient.marginManager.depositQuote({
    managerKey,
    amount: collateralAmount,
  })(tx);

  // 2. Borrow base asset to sell
  const borrowBaseAmount = collateralAmount * leverage; // approximate, price-dependent
  dbClient.marginManager.borrowBase(managerKey, borrowBaseAmount)(tx);

  // 3. Place market sell order (sell borrowed base for quote)
  dbClient.poolProxy.placeMarketOrder({
    poolKey,
    marginManagerKey: managerKey,
    clientOrderId: Date.now().toString(),
    quantity: borrowBaseAmount,
    isBid: false,
    payWithDeep: false,
  })(tx);

  // 4. Withdraw settled amounts
  dbClient.poolProxy.withdrawSettledAmounts(managerKey)(tx);
}

// ============ Close Position ============

export function appendClosePosition(
  dbClient: DeepBookClient,
  tx: Transaction,
  managerKey: string,
  poolKey: string,
  isLong: boolean,
  positionSize: number,
) {
  if (isLong) {
    // Close long: sell base back for quote
    dbClient.poolProxy.placeMarketOrder({
      poolKey,
      marginManagerKey: managerKey,
      clientOrderId: `close_${Date.now()}`,
      quantity: positionSize,
      isBid: false,
      payWithDeep: false,
    })(tx);
  } else {
    // Close short: buy base back to repay borrow
    dbClient.poolProxy.placeReduceOnlyMarketOrder({
      poolKey,
      marginManagerKey: managerKey,
      clientOrderId: `close_${Date.now()}`,
      quantity: positionSize,
      isBid: true,
      payWithDeep: false,
    })(tx);
  }

  // Settle
  dbClient.poolProxy.withdrawSettledAmounts(managerKey)(tx);

  // Repay any remaining debt
  dbClient.marginManager.repayBase(managerKey)(tx);
  dbClient.marginManager.repayQuote(managerKey)(tx);
}

// ============ Read State ============

export function getMarginManagerState(
  dbClient: DeepBookClient,
  poolKey: string,
  marginManagerId: string,
) {
  return dbClient.marginManager.managerState(poolKey, marginManagerId);
}

// ============ Supported Pools ============

export const MARGIN_POOLS = {
  testnet: ['SUI_DBUSDC', 'DEEP_DBUSDC', 'DEEP_SUI'],
  mainnet: ['SUI_USDC', 'DEEP_USDC', 'DEEP_SUI'],
};
