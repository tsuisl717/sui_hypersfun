'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Shield,
  AlertTriangle,
  ArrowRightLeft,
  RefreshCw,
  Settings,
  Zap,
  X,
} from 'lucide-react';
import {
  PACKAGE_ID,
  MODULES,
  USDC,
  DEEPBOOK_MARGIN,
  TRADING_PAIRS,
  formatUsdc,
  parseUsdc,
  DEEPBOOK,
} from '@/lib/contracts/config';
// DeepBook SDK imported dynamically to avoid BcsStruct build error
// import { getDeepBookClient, appendMarginLong, appendMarginShort, MARGIN_POOLS } from '@/lib/deepbook';

// ============ Types ============

interface MarginTradingPanelProps {
  vaultId: string;
  leaderAddress: string;
  isLeader: boolean;
}

interface MarginAccountInfo {
  id: string;
  totalAllocated: number;
  maxAllocationBps: number;
  maxLeverage: number;
  enabled: boolean;
  cumulativeProfit: number;
  cumulativeLoss: number;
  tradeCount: number;
}

// ============ Component ============

export default function MarginTradingPanel({
  vaultId,
  leaderAddress,
  isLeader,
}: MarginTradingPanelProps) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  // UI state
  const [activeTab, setActiveTab] = useState<'trade' | 'account' | 'settings'>('trade');
  const [tradeDirection, setTradeDirection] = useState<'long' | 'short'>('long');
  const [selectedPair, setSelectedPair] = useState(0);
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(2);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // On-chain objects
  const [leaderCapId, setLeaderCapId] = useState<string>('');
  const [marginAccount, setMarginAccount] = useState<MarginAccountInfo | null>(null);
  const [vaultUsdcBalance, setVaultUsdcBalance] = useState<number>(0);
  const [marginManagerId, setMarginManagerId] = useState<string>('');

  // Position data from MarginManager
  const [mmBaseBalance, setMmBaseBalance] = useState<number>(0);
  const [mmQuoteBalance, setMmQuoteBalance] = useState<number>(0);
  const [mmBorrowedBase, setMmBorrowedBase] = useState<number>(0);
  const [mmBorrowedQuote, setMmBorrowedQuote] = useState<number>(0);
  const [riskRatio, setRiskRatio] = useState<number>(0);
  const [closingPosition, setClosingPosition] = useState(false);

  // ============ Fetch Leader Cap ============

  const fetchLeaderCap = useCallback(async () => {
    if (!account || !isLeader) return;

    try {
      const caps = await client.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${PACKAGE_ID}::${MODULES.VAULT}::SuiLeaderCap`,
        },
        options: { showContent: true },
      });

      for (const obj of caps.data) {
        if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
          const fields = obj.data.content.fields as Record<string, unknown>;
          if (fields.vault_id === vaultId) {
            setLeaderCapId(obj.data.objectId);
            return;
          }
        }
      }
    } catch (e) {
      console.error('Error fetching LeaderCap:', e);
    }
  }, [account, client, isLeader, vaultId]);

  // ============ Fetch Margin Account ============

  const fetchMarginAccount = useCallback(async () => {
    try {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${PACKAGE_ID}::${MODULES.MARGIN}::MarginAccountCreated`,
        },
        limit: 50,
      });

      for (const event of events.data) {
        const parsed = event.parsedJson as Record<string, unknown>;
        if (parsed.vault_id !== vaultId) continue;

        const accountId = parsed.margin_account_id as string;

        try {
          const obj = await client.getObject({
            id: accountId,
            options: { showContent: true },
          });

          if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
            const fields = obj.data.content.fields as Record<string, unknown>;
            setMarginAccount({
              id: accountId,
              totalAllocated: Number(fields.total_allocated || 0),
              maxAllocationBps: Number(fields.max_allocation_bps || 5000),
              maxLeverage: Number(fields.max_leverage || 5000),
              enabled: fields.enabled as boolean,
              cumulativeProfit: Number(fields.cumulative_profit || 0),
              cumulativeLoss: Number(fields.cumulative_loss || 0),
              tradeCount: Number(fields.trade_count || 0),
            });
            return;
          }
        } catch {
          // Account may not exist yet
        }
      }
    } catch (e) {
      console.error('Error fetching margin account:', e);
    }
  }, [client, vaultId]);

  // ============ Fetch Vault Balance ============

  const fetchVaultBalance = useCallback(async () => {
    try {
      const obj = await client.getObject({
        id: vaultId,
        options: { showContent: true },
      });

      if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
        const fields = obj.data.content.fields as Record<string, unknown>;
        const reserveField = fields.usdc_reserve;
        const reserve = typeof reserveField === 'object' && reserveField !== null
          ? Number((reserveField as Record<string, Record<string, unknown>>)?.fields?.value ?? 0)
          : Number(reserveField || 0);
        setVaultUsdcBalance(reserve / 1_000_000);
      }
    } catch (e) {
      console.error('Error fetching vault balance:', e);
    }
  }, [client, vaultId]);

  // ============ Fetch Margin Manager ============
  // Each vault has its own MarginManager, stored in localStorage keyed by vaultId

  const mmStorageKey = `mm_${vaultId}`;

  const fetchMarginManager = useCallback(async () => {
    if (!account) return;

    // Check localStorage first
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(mmStorageKey);
      if (stored) {
        setMarginManagerId(stored);
        return;
      }
    }

    // No stored MM for this vault — don't search old TXs
    // MarginManager will be auto-created on first trade
  }, [account, mmStorageKey]);

  // ============ Fetch MarginManager Position ============

  const fetchPosition = useCallback(async () => {
    if (!marginManagerId) return;

    try {
      const pair = TRADING_PAIRS[0]; // SUI/USDC
      const { Transaction } = await import('@mysten/sui/transactions');
      const tx = new Transaction();

      // Query base_balance, quote_balance, borrowed shares
      tx.moveCall({
        target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::base_balance`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [tx.object(marginManagerId)],
      });
      tx.moveCall({
        target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::quote_balance`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [tx.object(marginManagerId)],
      });
      tx.moveCall({
        target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::borrowed_base_shares`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [tx.object(marginManagerId)],
      });
      tx.moveCall({
        target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::borrowed_quote_shares`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [tx.object(marginManagerId)],
      });

      // Also query risk_ratio
      const SUI_ORACLE = '0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37';
      const USDC_ORACLE = '0x5dec622733a204ca27f5a90d8c2fad453cc6665186fd5dff13a83d0b6c9027ab';
      tx.moveCall({
        target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::risk_ratio`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [
          tx.object(marginManagerId),
          tx.object(DEEPBOOK_MARGIN.registryId),
          tx.object(SUI_ORACLE),
          tx.object(USDC_ORACLE),
          tx.object(pair.poolId),
          tx.object(DEEPBOOK_MARGIN.pools.SUI),
          tx.object(DEEPBOOK_MARGIN.pools.USDC),
          tx.object('0x6'),
        ],
      });

      const result = await client.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
      });

      if (result.results) {
        const values = result.results.map(r => {
          const rv = r?.returnValues?.[0];
          if (!rv) return 0n;
          return BigInt('0x' + [...rv[0]].map((b: number) => b.toString(16).padStart(2, '0')).reverse().join(''));
        });

        setMmBaseBalance(Number(values[0]) / Math.pow(10, pair.baseDecimals));
        setMmQuoteBalance(Number(values[1]) / 1_000_000);
        setMmBorrowedBase(Number(values[2]));
        setMmBorrowedQuote(Number(values[3]));
        if (values[4]) setRiskRatio(Number(values[4]) / 1e9);
      }
    } catch (e) {
      console.error('Error fetching position:', e);
    }
  }, [client, marginManagerId]);

  // ============ Effects ============

  useEffect(() => {
    if (isLeader) {
      fetchLeaderCap();
      fetchMarginAccount();
      fetchVaultBalance();
      fetchMarginManager();
    }
  }, [isLeader, fetchLeaderCap, fetchMarginAccount, fetchVaultBalance, fetchMarginManager]);

  // Fetch position when marginManager is found
  useEffect(() => {
    if (marginManagerId) fetchPosition();
  }, [marginManagerId, fetchPosition]);

  // ============ Create Margin Account ============

  const handleCreateMarginAccount = async () => {
    if (!account || !leaderCapId) return;

    setLoading(true);
    setTxStatus('Creating margin account...');

    try {
      const tx = new Transaction();

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.MARGIN}::create_margin_account`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(leaderCapId),
        ],
      });

      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Margin account created! TX: ${result.digest.slice(0, 8)}...`);

      setTimeout(() => {
        fetchMarginAccount();
        setTxStatus(null);
      }, 2000);
    } catch (e) {
      console.error('Create margin account error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Create DeepBook MarginManager ============

  const handleCreateMarginManager = async () => {
    if (!account) return;

    setLoading(true);
    setTxStatus('Creating DeepBook MarginManager...');

    try {
      // Use DeepBook Margin package to create MarginManager
      // Requires: Pool, DeepBook Registry, Margin Registry, Clock
      const pair = TRADING_PAIRS[0]; // Default to first pair (SUI/USDC)
      const tx = new Transaction();

      tx.moveCall({
        target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::new`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [
          tx.object(pair.poolId),                    // DeepBook Pool
          tx.object('0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d'), // DeepBook Registry (mainnet)
          tx.object(DEEPBOOK_MARGIN.registryId),     // Margin Registry
          tx.object('0x6'),                           // Clock
        ],
      });

      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`MarginManager TX: ${result.digest.slice(0, 12)}... Checking...`);

      // Wait for indexer, then find the created MarginManager
      await new Promise(r => setTimeout(r, 3000));

      // Query the TX to find created objects
      const txDetails = await client.getTransactionBlock({
        digest: result.digest,
        options: { showObjectChanges: true },
      });

      for (const change of txDetails.objectChanges || []) {
        if (change.type === 'created' && change.objectType?.includes('MarginManager')) {
          setMarginManagerId(change.objectId);
          setTxStatus(`MarginManager created! ${change.objectId.slice(0, 16)}...`);
        }
      }

      // Fallback: re-fetch
      if (!marginManagerId) {
        await fetchMarginManager();
      }

      setTimeout(() => setTxStatus(null), 3000);
    } catch (e) {
      console.error('Create MarginManager error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Execute Margin Trade (Vault + DeepBook Margin PTB) ============

  // Pyth oracle price info objects (mainnet)
  const PYTH_ORACLES: Record<string, string> = {
    SUI: '0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37',
    USDC: '0x5dec622733a204ca27f5a90d8c2fad453cc6665186fd5dff13a83d0b6c9027ab',
    DEEP: '0x8c7f3a322b94cc69db2a2ac575cbd94bf5766113324c3a3eceac91e3e88a51ed',
    WAL: '0xeb7e669f74d976c0b99b6ef9801e3a77716a95f1a15754e0f1399ce3fb60973d',
  };

  const handleMarginTrade = async () => {
    if (!account || !leaderCapId || !amount) return;

    const pair = TRADING_PAIRS[selectedPair];
    const isLong = tradeDirection === 'long';
    const collateralAmount = parseFloat(amount);
    const depositAmount = parseUsdc(amount);

    // Get oracle IDs for this pair
    const baseOracle = PYTH_ORACLES[pair.base] || PYTH_ORACLES.SUI;
    const quoteOracle = PYTH_ORACLES[pair.quote] || PYTH_ORACLES.USDC;

    setLoading(true);

    try {
      // ===== Auto-create Margin Account if missing =====
      let currentMarginAccount = marginAccount;
      if (!currentMarginAccount) {
        setTxStatus('Creating Margin Account...');
        const txMA = new Transaction();
        txMA.moveCall({
          target: `${PACKAGE_ID}::${MODULES.MARGIN}::create_margin_account`,
          typeArguments: [USDC.TYPE],
          arguments: [txMA.object(vaultId), txMA.object(leaderCapId)],
        });
        const rMA = await signAndExecute({ transaction: txMA });

        // Find created MarginAccount
        await new Promise(r => setTimeout(r, 2000));
        const txDetails = await client.getTransactionBlock({ digest: rMA.digest, options: { showObjectChanges: true } });
        for (const c of txDetails.objectChanges || []) {
          if (c.type === 'created' && c.objectType?.includes('MarginAccount')) {
            currentMarginAccount = {
              id: c.objectId, totalAllocated: 0, maxAllocationBps: 5000,
              maxLeverage: 5000, enabled: true, cumulativeProfit: 0,
              cumulativeLoss: 0, tradeCount: 0,
            };
            setMarginAccount(currentMarginAccount);
          }
        }
        if (!currentMarginAccount) { setTxStatus('Error: Failed to create Margin Account'); setLoading(false); return; }
      }

      // ===== Auto-create MarginManager if missing =====
      let currentMmId = marginManagerId;
      if (!currentMmId) {
        setTxStatus('Creating DeepBook MarginManager...');
        const txMM = new Transaction();
        txMM.moveCall({
          target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::new`,
          typeArguments: [pair.baseType, pair.quoteType],
          arguments: [
            txMM.object(pair.poolId),
            txMM.object('0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d'),
            txMM.object(DEEPBOOK_MARGIN.registryId),
            txMM.object('0x6'),
          ],
        });
        const rMM = await signAndExecute({ transaction: txMM });

        await new Promise(r => setTimeout(r, 3000));
        const mmDetails = await client.getTransactionBlock({ digest: rMM.digest, options: { showObjectChanges: true } });
        for (const c of mmDetails.objectChanges || []) {
          if (c.type === 'created' && c.objectType?.includes('MarginManager')) {
            currentMmId = c.objectId;
            setMarginManagerId(currentMmId);
            if (typeof window !== 'undefined') localStorage.setItem(mmStorageKey, currentMmId);
          }
        }
        if (!currentMmId) { setTxStatus('Error: Failed to create MarginManager'); setLoading(false); return; }
      }

      setTxStatus('Building margin trade...');
      const tx = new Transaction();

      // ===== Step 1: Extract USDC from vault =====
      const [depositAuth] = tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.MARGIN}::authorize_margin_deposit`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(leaderCapId),
          tx.object(currentMarginAccount.id),
          tx.pure.u64(depositAmount),
          tx.pure.u64(600),
          tx.object('0x6'),
        ],
      });

      const [usdcCoin] = tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.MARGIN}::consume_margin_deposit`,
        typeArguments: [USDC.TYPE],
        arguments: [
          depositAuth,
          tx.object(vaultId),
          tx.object(currentMarginAccount.id),
          tx.object('0x6'),
        ],
      });

      // ===== Step 2: Deposit USDC to DeepBook MarginManager =====
      tx.moveCall({
        target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::deposit`,
        typeArguments: [pair.baseType, pair.quoteType, USDC.TYPE],
        arguments: [
          tx.object(currentMmId),
          tx.object(DEEPBOOK_MARGIN.registryId),
          tx.object(baseOracle),
          tx.object(quoteOracle),
          usdcCoin,
          tx.object('0x6'),
        ],
      });

      // ===== Step 3: Borrow + Place order =====
      // Estimate base quantity from USDC amount
      // DeepBook quantity is ALWAYS in base asset units
      // Pool constraints: min_size=1 SUI, lot_size=0.1 SUI for SUI/USDC
      const PRICE_ESTIMATES: Record<string, number> = {
        SUI: 3.5, DEEP: 0.02, WAL: 0.5, XBTC: 95000, BETH: 3500,
        USDT: 1, NS: 0.3, SEND: 0.1,
      };
      const LOT_SIZES: Record<string, bigint> = {
        SUI: 100_000_000n,       // 0.1 SUI
        DEEP: 1_000_000n,        // 1 DEEP
        WAL: 100_000_000n,       // 0.1 WAL
        XBTC: 1_000n,            // 0.00001 XBTC
        BETH: 10_000n,           // 0.0001 BETH
      };
      const MIN_SIZES: Record<string, bigint> = {
        SUI: 1_000_000_000n,     // 1 SUI (~$3.5)
        DEEP: 100_000_000n,      // 100 DEEP
        WAL: 1_000_000_000n,     // 1 WAL
        XBTC: 10_000n,           // 0.0001 XBTC
        BETH: 100_000n,          // 0.001 BETH
      };

      const estPrice = PRICE_ESTIMATES[pair.base] || 1;
      const lotSize = LOT_SIZES[pair.base] || 100_000_000n;
      const minSize = MIN_SIZES[pair.base] || 1_000_000_000n;
      const totalUsdc = collateralAmount * leverage;
      const estBaseQty = totalUsdc / estPrice;
      const rawQty = BigInt(Math.floor(estBaseQty * Math.pow(10, pair.baseDecimals)));
      // Round down to lot size
      const baseQuantity = (rawQty / lotSize) * lotSize;

      // Check minimum
      if (baseQuantity < minSize) {
        const minUsdc = (Number(minSize) / Math.pow(10, pair.baseDecimals)) * estPrice;
        setTxStatus(`Error: Minimum order is ${(Number(minSize) / Math.pow(10, pair.baseDecimals)).toFixed(2)} ${pair.base} (~$${minUsdc.toFixed(2)}). Increase amount or leverage.`);
        setLoading(false);
        return;
      }

      if (isLong) {
        // LONG: borrow more quote (USDC), then buy base
        if (leverage > 1) {
          const borrowAmount = BigInt(Math.floor(collateralAmount * (leverage - 1) * 1_000_000));
          tx.moveCall({
            target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::borrow_quote`,
            typeArguments: [pair.baseType, pair.quoteType],
            arguments: [
              tx.object(currentMmId),
              tx.object(DEEPBOOK_MARGIN.registryId),
              tx.object(DEEPBOOK_MARGIN.pools.USDC),
              tx.object(baseOracle),
              tx.object(quoteOracle),
              tx.object(pair.poolId),
              tx.pure.u64(borrowAmount),
              tx.object('0x6'),
            ],
          });
        }

        // Place market buy order (quantity in BASE units)
        tx.moveCall({
          target: `${DEEPBOOK_MARGIN.packageId}::pool_proxy::place_market_order`,
          typeArguments: [pair.baseType, pair.quoteType],
          arguments: [
            tx.object(DEEPBOOK_MARGIN.registryId),
            tx.object(currentMmId),
            tx.object(pair.poolId),
            tx.pure.u64(Date.now()),  // client_order_id
            tx.pure.u8(0),            // self_matching_option
            tx.pure.u64(baseQuantity), // quantity in base units
            tx.pure.bool(true),        // is_bid = buy
            tx.pure.bool(false),       // pay_with_deep
            tx.object('0x6'),
          ],
        });
      } else {
        // SHORT: borrow base asset, sell for quote
        tx.moveCall({
          target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::borrow_base`,
          typeArguments: [pair.baseType, pair.quoteType],
          arguments: [
            tx.object(currentMmId),
            tx.object(DEEPBOOK_MARGIN.registryId),
            tx.object(DEEPBOOK_MARGIN.pools[pair.base as keyof typeof DEEPBOOK_MARGIN.pools] || DEEPBOOK_MARGIN.pools.SUI),
            tx.object(baseOracle),
            tx.object(quoteOracle),
            tx.object(pair.poolId),
            tx.pure.u64(baseQuantity),
            tx.object('0x6'),
          ],
        });

        // Place market sell order (quantity in BASE units)
        tx.moveCall({
          target: `${DEEPBOOK_MARGIN.packageId}::pool_proxy::place_market_order`,
          typeArguments: [pair.baseType, pair.quoteType],
          arguments: [
            tx.object(DEEPBOOK_MARGIN.registryId),
            tx.object(currentMmId),
            tx.object(pair.poolId),
            tx.pure.u64(Date.now()),
            tx.pure.u8(0),
            tx.pure.u64(baseQuantity), // quantity in base units
            tx.pure.bool(false),      // is_bid = sell
            tx.pure.bool(false),
            tx.object('0x6'),
          ],
        });
      }

      // ===== Step 4: Settle =====
      tx.moveCall({
        target: `${DEEPBOOK_MARGIN.packageId}::pool_proxy::withdraw_settled_amounts`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [
          tx.object(DEEPBOOK_MARGIN.registryId),
          tx.object(currentMmId),
          tx.object(pair.poolId),
        ],
      });

      setTxStatus(`Waiting for wallet... (${isLong ? 'Long' : 'Short'} ${pair.base} ${leverage}x)`);
      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`${isLong ? 'Long' : 'Short'} ${pair.base} ${leverage}x executed! TX: ${result.digest.slice(0, 8)}...`);

      setTimeout(() => {
        fetchMarginAccount();
        fetchVaultBalance();
        fetchPosition();
        fetchMarginManager();
        setTxStatus(null);
        setAmount('');
      }, 3000);
    } catch (e) {
      console.error('Margin trade error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Trade failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Close Position ============

  // Debug: test step 1 only (withdraw SUI → swap → deposit USDC back)
  const handleTestStep1 = async () => {
    if (!account || !marginManagerId || mmBaseBalance <= 0.01) return;
    setClosingPosition(true);
    setTxStatus('Test Step 1: Withdraw SUI → swap → deposit USDC...');
    try {
      const pair = TRADING_PAIRS[0];
      const baseOracle = '0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37';
      const quoteOracle = '0x5dec622733a204ca27f5a90d8c2fad453cc6665186fd5dff13a83d0b6c9027ab';

      const tx = new Transaction();
      tx.setGasBudget(50_000_000);

      // Round to lot_size and ensure >= min_size for swap
      const lotSize = 100_000_000n;
      const minSize = 1_000_000_000n;
      const rawAmt = BigInt(Math.floor(mmBaseBalance * Math.pow(10, pair.baseDecimals)));
      const baseAmt = (rawAmt / lotSize) * lotSize; // round down to lot

      if (baseAmt < minSize) {
        setTxStatus(`Error: SUI balance ${mmBaseBalance.toFixed(4)} < min swap size 1.0 SUI. Cannot close via swap.`);
        setClosingPosition(false);
        return;
      }

      const [suiCoin] = tx.moveCall({
        target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::withdraw`,
        typeArguments: [pair.baseType, pair.quoteType, pair.baseType],
        arguments: [
          tx.object(marginManagerId), tx.object(DEEPBOOK_MARGIN.registryId),
          tx.object(DEEPBOOK_MARGIN.pools.SUI), tx.object(DEEPBOOK_MARGIN.pools.USDC),
          tx.object(baseOracle), tx.object(quoteOracle),
          tx.object(pair.poolId), tx.pure.u64(baseAmt), tx.object('0x6'),
        ],
      });

      const [deepCoin] = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [DEEPBOOK.DEEP] });
      const [baseOut, quoteOut, deepOut] = tx.moveCall({
        target: `${DEEPBOOK.packageId}::pool::swap_exact_base_for_quote`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [tx.object(pair.poolId), suiCoin, deepCoin, tx.pure.u64(0), tx.object('0x6')],
      });

      tx.moveCall({
        target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::deposit`,
        typeArguments: [pair.baseType, pair.quoteType, USDC.TYPE],
        arguments: [
          tx.object(marginManagerId), tx.object(DEEPBOOK_MARGIN.registryId),
          tx.object(baseOracle), tx.object(quoteOracle),
          quoteOut, tx.object('0x6'),
        ],
      });
      tx.transferObjects([baseOut, deepOut], account.address);

      const result = await signAndExecute({ transaction: tx });
      setTxStatus(`Step 1 done! TX: ${result.digest}`);
      setTimeout(() => { fetchPosition(); setTxStatus(null); }, 3000);
    } catch (e) {
      setTxStatus(`Step 1 error: ${e instanceof Error ? e.message : 'Failed'}`);
    } finally {
      setClosingPosition(false);
    }
  };

  const handleClosePosition = async () => {
    if (!account || !marginManagerId || (mmBaseBalance <= 0.01 && mmQuoteBalance <= 0.01)) return;

    setClosingPosition(true);

    try {
      const pair = TRADING_PAIRS[0];
      const baseOracle = '0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37';
      const quoteOracle = '0x5dec622733a204ca27f5a90d8c2fad453cc6665186fd5dff13a83d0b6c9027ab';
      const currentMarginAccount = marginAccount;

      // ===== Step 1: Sell SUI → USDC, deposit USDC back to MM =====
      const lotSize = 100_000_000n;
      const minSwapSize = 1_000_000_000n;
      const rawBaseAmt = BigInt(Math.floor(mmBaseBalance * Math.pow(10, pair.baseDecimals)));
      const swapBaseAmt = (rawBaseAmt / lotSize) * lotSize;

      if (swapBaseAmt >= minSwapSize) {
        setTxStatus('Step 1/3: Selling SUI for USDC...');
        const txSwap = new Transaction();
        txSwap.setGasBudget(50_000_000);

        const baseAmt = swapBaseAmt;
        const [suiCoin] = txSwap.moveCall({
          target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::withdraw`,
          typeArguments: [pair.baseType, pair.quoteType, pair.baseType],
          arguments: [
            txSwap.object(marginManagerId), txSwap.object(DEEPBOOK_MARGIN.registryId),
            txSwap.object(DEEPBOOK_MARGIN.pools.SUI), txSwap.object(DEEPBOOK_MARGIN.pools.USDC),
            txSwap.object(baseOracle), txSwap.object(quoteOracle),
            txSwap.object(pair.poolId), txSwap.pure.u64(baseAmt), txSwap.object('0x6'),
          ],
        });

        const [deepCoin] = txSwap.moveCall({ target: '0x2::coin::zero', typeArguments: [DEEPBOOK.DEEP] });
        const [baseOut, quoteOut, deepOut] = txSwap.moveCall({
          target: `${DEEPBOOK.packageId}::pool::swap_exact_base_for_quote`,
          typeArguments: [pair.baseType, pair.quoteType],
          arguments: [txSwap.object(pair.poolId), suiCoin, deepCoin, txSwap.pure.u64(0), txSwap.object('0x6')],
        });

        // Deposit USDC back to MM
        txSwap.moveCall({
          target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::deposit`,
          typeArguments: [pair.baseType, pair.quoteType, USDC.TYPE],
          arguments: [
            txSwap.object(marginManagerId), txSwap.object(DEEPBOOK_MARGIN.registryId),
            txSwap.object(baseOracle), txSwap.object(quoteOracle),
            quoteOut, txSwap.object('0x6'),
          ],
        });
        txSwap.transferObjects([baseOut, deepOut], account.address);

        await signAndExecute({ transaction: txSwap });
        await new Promise(r => setTimeout(r, 3000));
        await fetchPosition();
      }

      // ===== Step 2: Repay all debt =====
      if (mmBorrowedQuote > 0) {
        setTxStatus('Step 2/3: Repaying debt...');
        for (let i = 0; i < 3; i++) {
          const txRepay = new Transaction();
          txRepay.setGasBudget(50_000_000);
          const [noneOpt] = txRepay.moveCall({ target: '0x1::option::none', typeArguments: ['u64'] });
          txRepay.moveCall({
            target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::repay_quote`,
            typeArguments: [pair.baseType, pair.quoteType],
            arguments: [txRepay.object(marginManagerId), txRepay.object(DEEPBOOK_MARGIN.registryId), txRepay.object(DEEPBOOK_MARGIN.pools.USDC), noneOpt, txRepay.object('0x6')],
          });
          await signAndExecute({ transaction: txRepay });
          await new Promise(r => setTimeout(r, 2000));
          await fetchPosition();
          if (mmBorrowedQuote === 0) break;
        }
      }

      // ===== Step 3: Withdraw USDC + return to vault (hot potato) =====
      await fetchPosition();
      if (mmQuoteBalance > 0.01 && currentMarginAccount && leaderCapId) {
        setTxStatus('Step 3/3: Returning USDC to vault...');
        const txClose = new Transaction();
        txClose.setGasBudget(50_000_000);

        // initiate_margin_close → CloseObligation (hot potato)
        const [closeObligation] = txClose.moveCall({
          target: `${PACKAGE_ID}::${MODULES.MARGIN}::initiate_margin_close`,
          typeArguments: [USDC.TYPE],
          arguments: [
            txClose.object(vaultId), txClose.object(leaderCapId),
            txClose.object(currentMarginAccount.id), txClose.pure.u64(0),
          ],
        });

        // Withdraw USDC from MM
        const quoteAmt = BigInt(Math.floor((mmQuoteBalance - 0.001) * 1_000_000));
        const [qCoin] = txClose.moveCall({
          target: `${DEEPBOOK_MARGIN.packageId}::margin_manager::withdraw`,
          typeArguments: [pair.baseType, pair.quoteType, USDC.TYPE],
          arguments: [
            txClose.object(marginManagerId), txClose.object(DEEPBOOK_MARGIN.registryId),
            txClose.object(DEEPBOOK_MARGIN.pools.SUI), txClose.object(DEEPBOOK_MARGIN.pools.USDC),
            txClose.object(baseOracle), txClose.object(quoteOracle),
            txClose.object(pair.poolId), txClose.pure.u64(quoteAmt), txClose.object('0x6'),
          ],
        });

        // complete_margin_close → USDC to vault, obligation consumed
        const originalAmount = currentMarginAccount.totalAllocated > 0 ? BigInt(currentMarginAccount.totalAllocated) : 0n;
        txClose.moveCall({
          target: `${PACKAGE_ID}::${MODULES.MARGIN}::complete_margin_close`,
          typeArguments: [USDC.TYPE],
          arguments: [
            closeObligation, txClose.object(vaultId),
            txClose.object(currentMarginAccount.id), qCoin,
            txClose.pure.u64(originalAmount), txClose.object('0x6'),
          ],
        });

        await signAndExecute({ transaction: txClose });
      }

      setTxStatus('Position closed! All USDC returned to vault.');

      setTimeout(() => {
        fetchPosition();
        fetchMarginAccount();
        fetchVaultBalance();
        setTxStatus(null);
      }, 3000);
    } catch (e) {
      console.error('Close position error:', e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : 'Close failed'}`);
    } finally {
      setClosingPosition(false);
    }
  };

  // ============ Render ============

  if (!isLeader) {
    return (
      <div className="bg-black border border-border p-4">
        <div className="flex items-center gap-2 text-gray-400">
          <Shield size={16} />
          <span className="text-sm">Margin trading - Leader only</span>
        </div>
      </div>
    );
  }

  const pair = TRADING_PAIRS[selectedPair];
  const maxLeverage = marginAccount ? marginAccount.maxLeverage / 1000 : 5;
  const maxAllocation = vaultUsdcBalance * (marginAccount?.maxAllocationBps || 5000) / 10000;
  const currentAllocation = (marginAccount?.totalAllocated || 0) / 1_000_000;
  const netPnl = ((marginAccount?.cumulativeProfit || 0) - (marginAccount?.cumulativeLoss || 0)) / 1_000_000;

  return (
    <div className="bg-black border border-border">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-yellow-400" />
            <h3 className="font-black text-lg">Margin Trading</h3>
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
              DeepBook Margin
            </span>
          </div>
          <button
            onClick={() => {
              fetchMarginAccount();
              fetchVaultBalance();
              fetchMarginManager();
            }}
            className="text-gray-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Position + Stats */}
        {(mmBaseBalance > 0.01 || mmQuoteBalance > 0.01) && (
          <div className="bg-green-500/10 border border-green-500/30 p-2 rounded mb-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-green-400 font-bold">LONG {TRADING_PAIRS[0]?.base}</span>
              <span className="font-mono text-white text-sm">{mmBaseBalance.toFixed(4)} {TRADING_PAIRS[0]?.base}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-400 mt-1">
              <span>USDC: ${mmQuoteBalance.toFixed(2)}</span>
              <span>Borrowed: {mmBorrowedQuote > 0 ? 'Yes' : 'No'}</span>
              <span>Risk Ratio: <span className={riskRatio > 1.5 ? 'text-green-400' : riskRatio > 1.25 ? 'text-yellow-400' : 'text-red-400'}>{riskRatio.toFixed(3)}</span></span>
              <span>Liq: {riskRatio > 0 ? '<1.15' : '-'}</span>
            </div>
            <div className="flex gap-1 mt-2">
              <button
                onClick={handleClosePosition}
                disabled={closingPosition || loading}
                className="flex-1 py-1.5 text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {closingPosition ? <Loader2 className="animate-spin" size={12} /> : <X size={12} />}
                Close Position
              </button>
              <button
                onClick={handleTestStep1}
                disabled={closingPosition || loading}
                className="py-1.5 px-2 text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50"
                title="Test: Withdraw SUI → swap USDC → deposit back to MM"
              >
                Test S1
              </button>
            </div>
          </div>
        )}
        {/* Balance breakdown */}
        <div className="grid grid-cols-2 gap-2 text-xs mb-2">
          <div className="bg-white/5 p-2 rounded">
            <span className="text-gray-500">Vault USDC</span>
            <p className="font-mono text-white">${vaultUsdcBalance.toFixed(2)}</p>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <span className="text-gray-500">Margin USDC</span>
            <p className="font-mono text-yellow-400">${mmQuoteBalance.toFixed(2)}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-white/5 p-2 rounded">
            <span className="text-gray-500">Allocated</span>
            <p className="font-mono text-white">${currentAllocation.toFixed(2)}</p>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <span className="text-gray-500">Available</span>
            <p className="font-mono text-white">${(maxAllocation - currentAllocation).toFixed(2)}</p>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <span className="text-gray-500">Net P&L</span>
            <p className={`font-mono ${netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(['trade', 'account', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
              activeTab === tab ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-500'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Setup notice — shown inline, trading UI always visible */}
      {(!marginAccount || !marginManagerId) && activeTab === 'trade' && (
        <div className="px-4 pt-3">
          <div className="bg-yellow-500/10 border border-yellow-500/30 p-2 text-xs text-yellow-400">
            <Zap className="inline mr-1" size={12} />
            {!marginAccount ? 'Margin Account + ' : ''}MarginManager will be auto-created on first trade.
          </div>
        </div>
      )}

      {/* Trade Tab */}
      {activeTab === 'trade' && (
        <div className="p-4 space-y-4">
          {/* Long/Short Toggle */}
          <div className="flex border border-white/10 rounded">
            <button
              onClick={() => setTradeDirection('long')}
              className={`flex-1 py-2 text-sm font-bold transition-colors ${
                tradeDirection === 'long'
                  ? 'bg-green-500/20 text-green-400'
                  : 'text-gray-500 hover:text-white'
              }`}
            >
              <TrendingUp className="inline mr-1" size={14} />
              Long
            </button>
            <button
              onClick={() => setTradeDirection('short')}
              className={`flex-1 py-2 text-sm font-bold transition-colors ${
                tradeDirection === 'short'
                  ? 'bg-red-500/20 text-red-400'
                  : 'text-gray-500 hover:text-white'
              }`}
            >
              <TrendingDown className="inline mr-1" size={14} />
              Short
            </button>
          </div>

          {/* Trading Pair */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Market
            </label>
            <select
              value={selectedPair}
              onChange={(e) => setSelectedPair(Number(e.target.value))}
              className="w-full bg-white/5 border border-white/10 px-4 py-2 text-white"
            >
              {TRADING_PAIRS.map((p, i) => (
                <option key={i} value={i} className="bg-black">
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Collateral Amount */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Collateral (USDC)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-600 focus:border-yellow-400/50 outline-none transition-colors text-lg font-mono"
            />
            <div className="grid grid-cols-4 gap-1 mt-2">
              {[25, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => setAmount(((maxAllocation - currentAllocation) * pct / 100).toFixed(2))}
                  className="py-1.5 text-xs font-bold border border-white/10 text-gray-400 hover:text-white hover:border-white/30 transition-colors"
                >
                  {pct}%
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Available: ${(maxAllocation - currentAllocation).toFixed(2)} USDC (max allocation)
            </div>
          </div>

          {/* Leverage Slider */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Leverage: {leverage}x
            </label>
            <input
              type="range"
              min={1}
              max={maxLeverage}
              step={0.5}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-yellow-400"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>1x</span>
              <span>{maxLeverage}x</span>
            </div>
          </div>

          {/* Position Size */}
          {amount && (
            <div className="bg-white/5 border border-white/10 p-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Collateral</span>
                <span className="font-mono text-white">${parseFloat(amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Position Size</span>
                <span className="font-mono text-yellow-400">
                  ${(parseFloat(amount) * leverage).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Direction</span>
                <span className={`font-mono ${tradeDirection === 'long' ? 'text-green-400' : 'text-red-400'}`}>
                  {tradeDirection.toUpperCase()} {pair?.base}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Liquidation Risk</span>
                <span className={`font-mono ${leverage >= 4 ? 'text-red-400' : leverage >= 3 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {leverage >= 4 ? 'HIGH' : leverage >= 3 ? 'MEDIUM' : 'LOW'}
                </span>
              </div>
            </div>
          )}

          {/* Warning for high leverage */}
          {leverage >= 4 && (
            <div className="bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400">
              <AlertTriangle className="inline mr-1" size={12} />
              High leverage increases liquidation risk. Your collateral can be lost if the market moves against you.
            </div>
          )}

          {/* Status */}
          {txStatus && (
            <div
              className={`p-3 text-sm ${
                txStatus.includes('Error')
                  ? 'bg-red-500/10 text-red-400'
                  : txStatus.includes('Waiting')
                    ? 'bg-blue-500/10 text-blue-400'
                    : 'bg-yellow-500/10 text-yellow-400'
              }`}
            >
              {loading && <Loader2 className="animate-spin inline mr-2" size={14} />}
              {txStatus}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleMarginTrade}
            disabled={loading || !amount || !leaderCapId || isPending}
            className={`w-full py-3 font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
              tradeDirection === 'long'
                ? 'bg-green-500 text-black hover:bg-green-400'
                : 'bg-red-500 text-white hover:bg-red-400'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {loading ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <ArrowRightLeft size={16} />
            )}
            {tradeDirection === 'long' ? `Long ${pair?.base}` : `Short ${pair?.base}`} {leverage}x
          </button>

          <p className="text-xs text-gray-500 text-center">
            Executes via DeepBook Margin. Spot margin, not perpetuals.
          </p>
        </div>
      )}

      {/* Account Tab */}
      {activeTab === 'account' && marginAccount && (
        <div className="p-4 space-y-3">
          {/* MarginManager Position */}
          {marginManagerId && (mmBaseBalance > 0 || mmQuoteBalance > 0) && (
            <div className="bg-green-500/10 border border-green-500/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-green-400 uppercase tracking-widest">DeepBook Position</span>
                <button onClick={fetchPosition} className="text-xs text-gray-500 hover:text-primary">&#x21bb;</button>
              </div>
              <div className="space-y-1">
                {(mmBaseBalance > 0.01 || mmQuoteBalance > 0.01) && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">{TRADING_PAIRS[0]?.base} Balance</span>
                    <span className="font-mono text-green-400 font-bold">{mmBaseBalance.toFixed(4)} {TRADING_PAIRS[0]?.base}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">USDC in Manager</span>
                  <span className="font-mono text-white">${mmQuoteBalance.toFixed(2)}</span>
                </div>
                {mmBorrowedQuote > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Borrowed USDC</span>
                    <span className="font-mono text-yellow-400">Yes (shares: {mmBorrowedQuote})</span>
                  </div>
                )}
                {mmBorrowedBase > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Borrowed {TRADING_PAIRS[0]?.base}</span>
                    <span className="font-mono text-yellow-400">Yes (shares: {mmBorrowedBase})</span>
                  </div>
                )}
              </div>
              <div className="text-[10px] text-gray-500 font-mono break-all mt-1">
                Manager: {marginManagerId}
              </div>
            </div>
          )}

          {/* Account Info */}
          <div className="space-y-2">
            {[
              { label: 'Margin Account', value: marginAccount.id.slice(0, 12) + '...' },
              { label: 'Status', value: marginAccount.enabled ? 'Active' : 'Disabled', color: marginAccount.enabled ? 'text-green-400' : 'text-red-400' },
              { label: 'Total Allocated', value: `$${currentAllocation.toFixed(2)}` },
              { label: 'Max Allocation', value: `${marginAccount.maxAllocationBps / 100}% ($${maxAllocation.toFixed(2)})` },
              { label: 'Max Leverage', value: `${maxLeverage}x` },
              { label: 'Trade Count', value: marginAccount.tradeCount.toString() },
              { label: 'Cumulative Profit', value: `+$${(marginAccount.cumulativeProfit / 1_000_000).toFixed(2)}`, color: 'text-green-400' },
              { label: 'Cumulative Loss', value: `-$${(marginAccount.cumulativeLoss / 1_000_000).toFixed(2)}`, color: 'text-red-400' },
              { label: 'Net P&L', value: `${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}`, color: netPnl >= 0 ? 'text-green-400' : 'text-red-400' },
            ].map((item) => (
              <div key={item.label} className="flex justify-between items-center bg-white/5 border border-white/10 p-2">
                <span className="text-xs text-gray-400">{item.label}</span>
                <span className={`text-sm font-mono ${item.color || 'text-white'}`}>{item.value}</span>
              </div>
            ))}
          </div>

          {marginManagerId && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-3 text-xs text-blue-400">
              <p className="font-bold mb-1">DeepBook MarginManager</p>
              <p className="font-mono text-blue-300/80 break-all">{marginManagerId}</p>
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="p-4 space-y-4">
          <div className="bg-blue-500/10 border border-blue-500/30 p-3 text-xs text-blue-400">
            <Settings className="inline mr-1" size={12} />
            <span className="font-bold">DeepBook Margin Integration</span>
            <p className="mt-1 text-blue-300/80">
              Leveraged spot margin trading via DeepBook Margin.
              Leader can go long/short with up to {maxLeverage}x leverage.
              All funds are extracted from and returned to the vault.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                DeepBook Margin Package
              </label>
              <p className="font-mono text-xs text-gray-500 break-all">
                {DEEPBOOK_MARGIN.packageId}
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                Margin Registry
              </label>
              <p className="font-mono text-xs text-gray-500 break-all">
                {DEEPBOOK_MARGIN.registryId}
              </p>
            </div>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-400">
            <AlertTriangle className="inline mr-1" size={12} />
            <span className="font-bold">Risk Warning</span>
            <p className="mt-1 text-yellow-300/80">
              Margin trading involves risk of liquidation. If the position value drops
              below the maintenance margin, the position will be liquidated and collateral lost.
              DeepBook Margin uses isolated margin per pool.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
