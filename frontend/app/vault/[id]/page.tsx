"use client";

import { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import dynamic from "next/dynamic";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Broadcast from "@/components/Broadcast";
import TradingPanel from "@/components/bonding-curve-vault/TradingPanel";
import TradeHistory from "@/components/bonding-curve-vault/TradeHistory";
import LeaderTradingPanel from "@/components/bonding-curve-vault/LeaderTradingPanel";
import MarginTradingPanel from "@/components/bonding-curve-vault/MarginTradingPanel";
import ApiTradingPanel from "@/components/bonding-curve-vault/ApiTradingPanel";
import VaultHistoryWalrus from "@/components/bonding-curve-vault/VaultHistoryWalrus";
import { VaultInfo, Trade, UserShare } from "@/components/bonding-curve-vault/types";
import { PACKAGE_ID, MODULES, OBJECTS, USDC, NETWORK, SUI_CONFIG, TRADING_PAIRS, DEEPBOOK_MARGIN, formatUsdc, parseUsdc } from "@/lib/contracts/config";
import { loadVaultByAddress } from "@/lib/vaults";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";

// Dynamic import for chart (client-only)
const PriceChart = dynamic(
  () => import("@/components/bonding-curve-vault/PriceChart"),
  {
    ssr: false,
    loading: () => (
      <div className="bg-[#131722] h-full flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    ),
  }
);

export default function VaultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: vaultId } = use(params);
  const router = useRouter();
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"trading" | "api-trading" | "margin" | "history">("trading");
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  // Data state
  const [trades, setTrades] = useState<Trade[]>([]);
  const [userShares, setUserShares] = useState<UserShare[]>([]);
  const [userUsdcBalance, setUserUsdcBalance] = useState<string>("0");
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [loadingShares, setLoadingShares] = useState(false);

  // Leader trade events (spot swap + margin)
  interface LeaderTrade {
    type: 'swap' | 'margin_deposit' | 'margin_return';
    amount: number;
    isBuy?: boolean;
    pnl?: number;
    isProfit?: boolean;
    timestamp: number;
    txDigest: string;
  }
  const [leaderTrades, setLeaderTrades] = useState<LeaderTrade[]>([]);

  // Margin position for NAV adjustment
  const [marginAssets, setMarginAssets] = useState<{
    baseBalance: number; quoteBalance: number;
    borrowedQuote: number; baseSymbol: string;
    basePrice: number;
  } | null>(null);

  // Fetch vault data
  const fetchVaultData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await loadVaultByAddress(vaultId);
      if (data) {
        setVault({
          id: data.id,
          name: data.name,
          symbol: data.symbol,
          leader: data.leader,
          performanceFeeBps: data.performanceFeeBps,
          totalSupply: data.totalSupply,
          nav: data.nav,
          buyPrice: data.buyPrice,
          sellPrice: data.sellPrice || data.nav,
          tvl: data.tvl,
          totalVolume: data.totalVolume,
          createdAt: data.createdAt,
          verified: data.verified,
          imageUrl: data.imageUrl,
        });
      } else {
        setError("Vault not found");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load vault");
    } finally {
      setLoading(false);
    }
  }, [vaultId]);

  // Fetch trade events
  const fetchTrades = useCallback(async () => {
    setLoadingTrades(true);
    try {
      // Get TokenBought events
      const buyEvents = await client.queryEvents({
        query: {
          MoveEventType: `${PACKAGE_ID}::${MODULES.VAULT}::TokenBought`,
        },
        limit: 50,
      });

      // Get TokenSold events
      const sellEvents = await client.queryEvents({
        query: {
          MoveEventType: `${PACKAGE_ID}::${MODULES.VAULT}::TokenSold`,
        },
        limit: 50,
      });

      const allTrades: Trade[] = [];

      // Parse buy events
      for (const event of buyEvents.data) {
        const data = event.parsedJson as Record<string, unknown>;
        if (data.vault_id === vaultId) {
          // timestampMs is a number (milliseconds) or string
          const tsMs = typeof event.timestampMs === 'string'
            ? parseInt(event.timestampMs)
            : Number(event.timestampMs ?? 0);

          allTrades.push({
            id: event.id.txDigest + "-buy",
            txHash: event.id.txDigest,
            type: "buy",
            user: data.buyer as string,
            usdcAmount: data.usdc_in as string,
            tokenAmount: data.tokens_out as string,
            price: data.price as string,
            nav: data.nav as string,
            timestamp: Math.floor(tsMs / 1000),
          });
        }
      }

      // Parse sell events
      for (const event of sellEvents.data) {
        const data = event.parsedJson as Record<string, unknown>;
        if (data.vault_id === vaultId) {
          // timestampMs is a number (milliseconds) or string
          const tsMs = typeof event.timestampMs === 'string'
            ? parseInt(event.timestampMs)
            : Number(event.timestampMs ?? 0);

          allTrades.push({
            id: event.id.txDigest + "-sell",
            txHash: event.id.txDigest,
            type: "sell",
            user: data.seller as string,
            usdcAmount: data.usdc_out as string,
            tokenAmount: data.tokens_in as string,
            price: data.price as string,
            nav: data.nav as string,
            exitFee: data.exit_fee as string,
            performanceFee: data.performance_fee_tokens as string,
            timestamp: Math.floor(tsMs / 1000),
          });
        }
      }

      // Sort by timestamp desc
      allTrades.sort((a, b) => b.timestamp - a.timestamp);
      setTrades(allTrades);
    } catch (e) {
      console.error("Error fetching trades:", e);
    } finally {
      setLoadingTrades(false);
    }
  }, [client, vaultId]);

  // Fetch leader trade events (swap, margin)
  const fetchLeaderTrades = useCallback(async () => {
    try {
      const allLeaderTrades: LeaderTrade[] = [];

      // Swap events
      const swapEvents = await client.queryEvents({
        query: { MoveEventType: `${PACKAGE_ID}::${MODULES.DEEPBOOK_MOD}::SwapExecuted` },
        limit: 50,
      });
      for (const ev of swapEvents.data) {
        const d = ev.parsedJson as Record<string, unknown>;
        if (d.vault_id !== vaultId) continue;
        allLeaderTrades.push({
          type: 'swap',
          amount: Number(d.output_amount || d.input_amount || 0),
          isBuy: d.is_buy as boolean,
          timestamp: Number(ev.timestampMs ?? 0),
          txDigest: ev.id.txDigest,
        });
      }

      // Margin extract events
      const marginExtractEvents = await client.queryEvents({
        query: { MoveEventType: `${PACKAGE_ID}::${MODULES.MARGIN}::MarginFundsExtracted` },
        limit: 50,
      });
      for (const ev of marginExtractEvents.data) {
        const d = ev.parsedJson as Record<string, unknown>;
        if (d.vault_id !== vaultId) continue;
        allLeaderTrades.push({
          type: 'margin_deposit',
          amount: Number(d.amount || 0),
          timestamp: Number(ev.timestampMs ?? 0),
          txDigest: ev.id.txDigest,
        });
      }

      // Margin return events
      const marginReturnEvents = await client.queryEvents({
        query: { MoveEventType: `${PACKAGE_ID}::${MODULES.MARGIN}::MarginFundsReturned` },
        limit: 50,
      });
      for (const ev of marginReturnEvents.data) {
        const d = ev.parsedJson as Record<string, unknown>;
        if (d.vault_id !== vaultId) continue;
        allLeaderTrades.push({
          type: 'margin_return',
          amount: Number(d.amount || 0),
          pnl: Number(d.pnl_amount || 0),
          isProfit: d.is_profit as boolean,
          timestamp: Number(ev.timestampMs ?? 0),
          txDigest: ev.id.txDigest,
        });
      }

      allLeaderTrades.sort((a, b) => b.timestamp - a.timestamp);
      setLeaderTrades(allLeaderTrades);
    } catch (e) {
      console.error("Error fetching leader trades:", e);
    }
  }, [client, vaultId]);

  // Fetch margin position for NAV adjustment
  const fetchMarginAssets = useCallback(async () => {
    if (!account) return;
    try {
      const MARGIN_PKG = '0xfbd322126f1452fd4c89aedbaeb9fd0c44df9b5cedbe70d76bf80dc086031377';
      const pair = TRADING_PAIRS[0];
      if (!pair) return;

      // Find MarginManager from recent TXs
      const txns = await client.queryTransactionBlocks({
        filter: { FromAddress: account.address },
        options: { showObjectChanges: true },
        limit: 15, order: 'descending',
      });

      let mmId = '';
      for (const txn of txns.data) {
        for (const c of txn.objectChanges || []) {
          if (c.type === 'created' && c.objectType?.includes('MarginManager')) {
            mmId = c.objectId;
          }
        }
      }
      if (!mmId) return;

      // Query balances
      const { Transaction: Tx } = await import('@mysten/sui/transactions');
      const tx = new Tx();
      tx.moveCall({
        target: `${MARGIN_PKG}::margin_manager::base_balance`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [tx.object(mmId)],
      });
      tx.moveCall({
        target: `${MARGIN_PKG}::margin_manager::quote_balance`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [tx.object(mmId)],
      });
      tx.moveCall({
        target: `${MARGIN_PKG}::margin_manager::borrowed_quote_shares`,
        typeArguments: [pair.baseType, pair.quoteType],
        arguments: [tx.object(mmId)],
      });

      const result = await client.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
      });

      if (result.results) {
        const vals = result.results.map(r => {
          const rv = r?.returnValues?.[0];
          if (!rv) return 0n;
          return BigInt('0x' + [...rv[0]].map((b: number) => b.toString(16).padStart(2, '0')).reverse().join(''));
        });

        const baseBalance = Number(vals[0]) / Math.pow(10, pair.baseDecimals);
        const quoteBalance = Number(vals[1]) / 1e6;
        const borrowedQuoteShares = Number(vals[2]);

        // Estimate SUI price for NAV
        const PRICE_EST: Record<string, number> = { SUI: 3.5, DEEP: 0.02, WAL: 0.5 };
        const basePrice = PRICE_EST[pair.base] || 1;

        if (baseBalance > 0 || quoteBalance > 0) {
          setMarginAssets({
            baseBalance, quoteBalance,
            borrowedQuote: borrowedQuoteShares,
            baseSymbol: pair.base,
            basePrice,
          });
        }
      }
    } catch (e) {
      console.error("Error fetching margin assets:", e);
    }
  }, [account, client]);

  // Fetch user shares
  const fetchUserShares = useCallback(async () => {
    if (!account) {
      setUserShares([]);
      return;
    }

    setLoadingShares(true);
    try {
      // Get user's VaultShare objects
      const ownedObjects = await client.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${PACKAGE_ID}::${MODULES.VAULT}::VaultShare`,
        },
        options: { showContent: true },
      });

      const shares: UserShare[] = [];
      for (const obj of ownedObjects.data) {
        if (obj.data?.content && obj.data.content.dataType === "moveObject") {
          const fields = obj.data.content.fields as Record<string, unknown>;
          const shareVaultId = fields.vault_id as string;
          if (shareVaultId === vaultId) {
            shares.push({
              objectId: obj.data.objectId,
              amount: Number(fields.amount || 0),
              entryNav: Number(fields.entry_nav || 0),
              acquiredAt: Number(fields.acquired_at || 0),
            });
          }
        }
      }
      setUserShares(shares);

      // Also fetch USDC balance
      const coins = await client.getCoins({
        owner: account.address,
        coinType: USDC.TYPE,
      });
      const totalBalance = coins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
      setUserUsdcBalance((Number(totalBalance) / 1_000_000).toFixed(2));
    } catch (e) {
      console.error("Error fetching shares:", e);
    } finally {
      setLoadingShares(false);
    }
  }, [account, client, vaultId]);

  // Initial load
  useEffect(() => {
    fetchVaultData();
    fetchTrades();
    fetchLeaderTrades();
    fetchMarginAssets();
  }, [fetchVaultData, fetchTrades, fetchLeaderTrades, fetchMarginAssets]);

  // Fetch user data when account changes
  useEffect(() => {
    fetchUserShares();
  }, [fetchUserShares]);

  // Handle buy
  const handleBuy = async (amount: string) => {
    if (!account || !amount) return;

    setTxStatus("Preparing transaction...");

    try {
      const usdcAmount = parseUsdc(amount);

      // Get user's USDC coins
      const coins = await client.getCoins({
        owner: account.address,
        coinType: USDC.TYPE,
      });

      if (coins.data.length === 0) {
        setTxStatus("Error: No USDC found in wallet. Get testnet USDC from faucet.circle.com");
        return;
      }

      const totalBalance = coins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
      if (totalBalance < usdcAmount) {
        setTxStatus(`Error: Insufficient USDC. Have ${Number(totalBalance) / 1_000_000}, need ${amount}`);
        return;
      }

      const tx = new Transaction();

      const [primaryCoin, ...otherCoins] = coins.data;
      if (otherCoins.length > 0) {
        tx.mergeCoins(
          tx.object(primaryCoin.coinObjectId),
          otherCoins.map((c) => tx.object(c.coinObjectId))
        );
      }

      const [paymentCoin] = tx.splitCoins(tx.object(primaryCoin.coinObjectId), [usdcAmount]);

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.VAULT}::buy`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(OBJECTS.FACTORY),
          paymentCoin,
          tx.pure.u64(0),
          tx.object("0x6"),
        ],
      });

      setTxStatus("Waiting for signature...");
      const result = await signAndExecute({ transaction: tx });

      setTxStatus(`Success! TX: ${result.digest.slice(0, 8)}...`);

      setTimeout(() => {
        fetchVaultData();
        fetchTrades();
        fetchUserShares();
        setTxStatus(null);
      }, 2000);
    } catch (e) {
      console.error("Buy error:", e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : "Transaction failed"}`);
    }
  };

  // Handle sell
  const handleSell = async (amount: string) => {
    if (!account) return;

    setTxStatus("Preparing sell transaction...");

    try {
      // Get user's VaultShare objects for this vault
      const ownedObjects = await client.getOwnedObjects({
        owner: account.address,
        filter: {
          StructType: `${PACKAGE_ID}::${MODULES.VAULT}::VaultShare`,
        },
        options: { showContent: true },
      });

      const vaultShares = ownedObjects.data.filter((obj) => {
        if (obj.data?.content && obj.data.content.dataType === "moveObject") {
          const fields = obj.data.content.fields as Record<string, unknown>;
          return fields.vault_id === vaultId;
        }
        return false;
      });

      if (vaultShares.length === 0) {
        setTxStatus("Error: No shares found for this vault");
        return;
      }

      // Get the first VaultShare and check its amount
      const shareToSell = vaultShares[0];
      if (!shareToSell.data?.objectId || !shareToSell.data?.content) {
        setTxStatus("Error: Invalid share object");
        return;
      }

      const shareFields = (shareToSell.data.content as { fields: Record<string, unknown> }).fields;
      // amount is human-readable (e.g. "1.5"), convert to raw (6 decimals)
      const sellAmountRaw = Math.floor(parseFloat(amount) * 1_000_000);
      const totalShares = vaultShares.reduce((sum, s) => {
        const f = (s.data?.content as { fields: Record<string, unknown> })?.fields;
        return sum + Number(f?.amount || 0);
      }, 0);

      if (sellAmountRaw <= 0 || isNaN(sellAmountRaw)) {
        setTxStatus("Error: Invalid sell amount");
        return;
      }

      const tx = new Transaction();

      // If multiple shares, merge them all into the first one in the same PTB
      const primaryShareId = vaultShares[0].data!.objectId;
      if (vaultShares.length > 1) {
        for (let i = 1; i < vaultShares.length; i++) {
          tx.moveCall({
            target: `${PACKAGE_ID}::${MODULES.VAULT}::merge_shares`,
            arguments: [
              tx.object(primaryShareId),
              tx.object(vaultShares[i].data!.objectId),
            ],
          });
        }
      }

      if (sellAmountRaw < totalShares) {
        // Partial sell: split then sell
        const [splitShare] = tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.VAULT}::split_share`,
          arguments: [
            tx.object(primaryShareId),
            tx.pure.u64(BigInt(sellAmountRaw)),
          ],
        });

        tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.VAULT}::sell_shares`,
          typeArguments: [USDC.TYPE],
          arguments: [
            tx.object(vaultId),
            tx.object(OBJECTS.FACTORY),
            splitShare,
            tx.pure.u64(0),
            tx.object("0x6"),
          ],
        });
      } else {
        // Full sell: sell the entire (merged) share
        tx.moveCall({
          target: `${PACKAGE_ID}::${MODULES.VAULT}::sell_shares`,
          typeArguments: [USDC.TYPE],
          arguments: [
            tx.object(vaultId),
            tx.object(OBJECTS.FACTORY),
            tx.object(primaryShareId),
            tx.pure.u64(0),
            tx.object("0x6"),
          ],
        });
      }

      setTxStatus("Waiting for signature...");
      const result = await signAndExecute({ transaction: tx });

      setTxStatus(`Success! TX: ${result.digest.slice(0, 8)}...`);

      setTimeout(() => {
        fetchVaultData();
        fetchTrades();
        fetchUserShares();
        setTxStatus(null);
      }, 2000);
    } catch (e) {
      console.error("Sell error:", e);
      setTxStatus(`Error: ${e instanceof Error ? e.message : "Transaction failed"}`);
    }
  };

  const handleRefresh = () => {
    fetchVaultData();
    fetchTrades();
    fetchUserShares();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={48} />
      </div>
    );
  }

  if (error || !vault) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col">
        <Header searchQuery={searchQuery} onSearchChange={setSearchQuery} onLogoClick={() => router.push("/")} />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 text-xl mb-4">{error || "Vault not found"}</p>
            <Link href="/" className="text-primary hover:underline">
              Back to Home
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // Compute adjusted vault with margin assets included in NAV/TVL
  // NAV comes from on-chain calculation which already includes external_assets_value
  // No frontend adjustment needed — on-chain is the source of truth
  const displayVault = vault;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <Broadcast />
      <Header searchQuery={searchQuery} onSearchChange={setSearchQuery} onLogoClick={() => router.push("/")} />

      <main className="flex-1 flex flex-col lg:flex-row">
        {/* Left: Chart and History */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Back Button */}
          <div className="px-4 py-2 border-b border-border">
            <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
              <ArrowLeft size={16} />
              <span className="text-sm font-bold uppercase tracking-widest">Back to Vaults</span>
            </Link>
          </div>

          {/* Chart Section */}
          <div className="h-[300px] sm:h-[400px] lg:h-[50%] border-b border-border">
            <PriceChart
              trades={trades}
              currentPrice={parseFloat(vault.buyPrice)}
              tokenSymbol={vault.symbol}
              loading={loadingTrades}
            />
          </div>

          {/* Leader Activity (spot swap + margin) */}
          {leaderTrades.length > 0 && (
            <div className="border-b border-border">
              <div className="p-2 border-b border-border flex items-center justify-between">
                <h3 className="font-black text-[10px] lg:text-xs uppercase tracking-widest text-yellow-400">
                  Leader Activity ({leaderTrades.length})
                </h3>
                <button onClick={fetchLeaderTrades} className="text-xs text-gray-500 hover:text-primary">&#x21bb;</button>
              </div>
              <div className="max-h-[150px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 sticky top-0 bg-black">
                    <tr>
                      <th className="text-left px-2 py-1">Type</th>
                      <th className="text-right px-2 py-1">Amount</th>
                      <th className="text-right px-2 py-1">P&L</th>
                      <th className="text-right px-2 py-1">Time</th>
                      <th className="text-right px-2 py-1">TX</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderTrades.map((lt, i) => (
                      <tr key={i} className="border-t border-gray-800/50 hover:bg-white/5">
                        <td className="px-2 py-1">
                          <span className={
                            lt.type === 'swap' ? (lt.isBuy ? 'text-green-400' : 'text-red-400')
                            : lt.type === 'margin_deposit' ? 'text-yellow-400'
                            : 'text-blue-400'
                          }>
                            {lt.type === 'swap' ? (lt.isBuy ? 'BUY' : 'SELL')
                              : lt.type === 'margin_deposit' ? 'MARGIN OUT'
                              : 'MARGIN IN'}
                          </span>
                        </td>
                        <td className="text-right px-2 py-1 font-mono">${(lt.amount / 1e6).toFixed(2)}</td>
                        <td className="text-right px-2 py-1 font-mono">
                          {lt.pnl !== undefined ? (
                            <span className={lt.isProfit ? 'text-green-400' : 'text-red-400'}>
                              {lt.isProfit ? '+' : '-'}${(lt.pnl / 1e6).toFixed(2)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="text-right px-2 py-1 text-gray-400">
                          {new Date(lt.timestamp).toLocaleDateString()}
                        </td>
                        <td className="text-right px-2 py-1">
                          <a
                            href={`${SUI_CONFIG[NETWORK].explorerUrl}/tx/${lt.txDigest}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-500 hover:text-primary font-mono"
                          >
                            {lt.txDigest.slice(0, 6)}...
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Trade History */}
          <TradeHistory
            trades={trades}
            userShares={userShares}
            loading={loadingTrades || loadingShares}
            onRefresh={handleRefresh}
            vaultNav={vault.nav}
            explorerUrl={SUI_CONFIG[NETWORK].explorerUrl}
          />
        </div>

        {/* Right: Tab-based Panel */}
        <div className="w-full lg:w-[420px] border-l border-border flex flex-col">
          {/* Top Tab Navigation */}
          <div className="flex border-b border-border bg-black sticky top-0 z-10">
            <button
              onClick={() => setActiveTab("trading")}
              className={`px-4 py-3 font-black uppercase tracking-widest text-[10px] sm:text-[11px] transition-colors whitespace-nowrap ${
                activeTab === "trading"
                  ? "text-primary border-b-2 border-primary"
                  : "text-gray-500 hover:text-white"
              }`}
            >
              Trading
            </button>
            {account && vault.leader.toLowerCase() === account.address.toLowerCase() && (
              <>
                <button
                  onClick={() => setActiveTab("api-trading")}
                  className={`px-4 py-3 font-black uppercase tracking-widest text-[10px] sm:text-[11px] transition-colors whitespace-nowrap ${
                    activeTab === "api-trading"
                      ? "text-primary border-b-2 border-primary"
                      : "text-gray-500 hover:text-white"
                  }`}
                >
                  API Trade<span className="ml-1 text-[10px] text-green-400">(L)</span>
                </button>
                <button
                  onClick={() => setActiveTab("margin")}
                  className={`px-4 py-3 font-black uppercase tracking-widest text-[10px] sm:text-[11px] transition-colors whitespace-nowrap ${
                    activeTab === "margin"
                      ? "text-yellow-400 border-b-2 border-yellow-400"
                      : "text-gray-500 hover:text-white"
                  }`}
                >
                  Margin
                </button>
              </>
            )}
            <button
              onClick={() => setActiveTab("history")}
              className={`px-4 py-3 font-black uppercase tracking-widest text-[10px] sm:text-[11px] transition-colors whitespace-nowrap ${
                activeTab === "history"
                  ? "text-blue-400 border-b-2 border-blue-400"
                  : "text-gray-500 hover:text-white"
              }`}
            >
              History
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Trading Tab — Buy/Sell vault tokens */}
            {activeTab === "trading" && (
              <TradingPanel
                vault={displayVault}
                isConnected={!!account}
                userUsdcBalance={userUsdcBalance}
                userShareBalance={userShares.reduce((sum, s) => sum + s.amount, 0)}
                isPending={isPending}
                txStatus={txStatus}
                onBuy={handleBuy}
                onSell={handleSell}
              />
            )}

            {/* API Trading Tab — Leader spot trading via DeepBook */}
            {activeTab === "api-trading" && (
              <ApiTradingPanel
                vaultId={vaultId}
                leaderAddress={vault.leader}
                isLeader={!!(account && vault.leader.toLowerCase() === account.address.toLowerCase())}
              />
            )}

            {/* Margin Tab — Leveraged trading */}
            {activeTab === "margin" && (
              <MarginTradingPanel
                vaultId={vaultId}
                leaderAddress={vault.leader}
                isLeader={!!(account && vault.leader.toLowerCase() === account.address.toLowerCase())}
              />
            )}

            {/* History Tab — Walrus + trade history */}
            {activeTab === "history" && (
              <VaultHistoryWalrus
                vaultId={vaultId}
                isLeader={!!(account && vault.leader.toLowerCase() === account.address.toLowerCase())}
                trades={trades.map(t => ({
                  vaultId,
                  txDigest: t.txHash,
                  timestamp: t.timestamp,
                  type: t.type,
                  inputAmount: Number(t.usdcAmount),
                  outputAmount: Number(t.tokenAmount),
                }))}
                currentNav={Number(vault.nav)}
                totalSupply={Number(vault.totalSupply)}
                usdcReserve={Number(vault.tvl)}
              />
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
