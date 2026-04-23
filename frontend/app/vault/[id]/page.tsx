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
import { VaultInfo, Trade, UserShare } from "@/components/bonding-curve-vault/types";
import { PACKAGE_ID, MODULES, OBJECTS, USDC, formatUsdc, parseUsdc } from "@/lib/contracts/config";
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
            : (event.timestampMs as number);

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
            : (event.timestampMs as number);

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
  }, [fetchVaultData, fetchTrades]);

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

      const shareToSell = vaultShares[0];
      if (!shareToSell.data?.objectId) {
        setTxStatus("Error: Invalid share object");
        return;
      }

      const tx = new Transaction();

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULES.VAULT}::sell_shares`,
        typeArguments: [USDC.TYPE],
        arguments: [
          tx.object(vaultId),
          tx.object(OBJECTS.FACTORY),
          tx.object(shareToSell.data.objectId),
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

          {/* Trade History */}
          <TradeHistory
            trades={trades}
            userShares={userShares}
            loading={loadingTrades || loadingShares}
            onRefresh={handleRefresh}
            vaultNav={vault.nav}
            explorerUrl="https://testnet.suivision.xyz"
          />
        </div>

        {/* Right: Trading Panel */}
        <div className="w-full lg:w-[380px] border-l border-border overflow-y-auto">
          <TradingPanel
            vault={vault}
            isConnected={!!account}
            userUsdcBalance={userUsdcBalance}
            isPending={isPending}
            txStatus={txStatus}
            onBuy={handleBuy}
            onSell={handleSell}
          />

          {/* Leader Trading Panel - Only visible to vault leader */}
          {account && vault.leader.toLowerCase() === account.address.toLowerCase() && (
            <div className="border-t border-border">
              <LeaderTradingPanel
                vaultId={vaultId}
                leaderAddress={vault.leader}
                isLeader={true}
              />
              <MarginTradingPanel
                vaultId={vaultId}
                leaderAddress={vault.leader}
                isLeader={true}
              />
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
