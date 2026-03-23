/**
 * Cetus DEX Integration Test
 *
 * Demonstrates swapping tokens via Cetus CLMM on SUI testnet.
 * Integrates with our Trading Module via PTB.
 *
 * References:
 * - Cetus SDK: https://github.com/CetusProtocol/cetus-clmm-sui-sdk
 * - Swap Docs: https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk/features-available/swap
 */

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
const { initCetusSDK, d, Percentage, adjustForSlippage } = require('@cetusprotocol/cetus-sui-clmm-sdk');
const BN = require('bn.js');

require('dotenv').config();

// Config
const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const USDC_TYPE = process.env.SUI_USDC_TYPE;
const NETWORK = process.env.SUI_NETWORK || 'testnet';

// Trading objects
const TRADING_VAULT_ID = process.env.SUI_TRADING_VAULT_ID;
const TRADING_MODULE_ID = process.env.SUI_TRADING_MODULE_ID;
const LEADER_TRADE_CAP_ID = process.env.SUI_LEADER_TRADE_CAP_ID;

const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// Initialize Cetus SDK
let cetusSDK;
async function initCetus() {
    if (!cetusSDK) {
        cetusSDK = initCetusSDK({ network: NETWORK });
        console.log('Cetus SDK initialized for', NETWORK);
    }
    return cetusSDK;
}

function getKeypair() {
    const privateKey = process.env.SUI_PRIVATE_KEY;
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
}

function getAddress() {
    return getKeypair().getPublicKey().toSuiAddress();
}

/**
 * Query available Cetus pools
 */
async function queryPools() {
    console.log('\n=== Querying Cetus Pools ===');

    const sdk = await initCetus();

    try {
        // Get all pools
        const pools = await sdk.Pool.getPoolsWithPage([]);
        console.log(`Found ${pools.data.length} pools on ${NETWORK}`);

        // Show first 10 pools
        const displayPools = pools.data.slice(0, 10);
        for (const pool of displayPools) {
            const coinA = pool.coinTypeA.split('::').pop();
            const coinB = pool.coinTypeB.split('::').pop();
            console.log(`\n  Pool: ${coinA} / ${coinB}`);
            console.log(`    ID: ${pool.poolAddress}`);
            console.log(`    Fee: ${pool.fee_rate / 10000}%`);
            if (pool.current_sqrt_price) {
                console.log(`    Price: ${pool.current_sqrt_price}`);
            }
        }

        // Look for SUI pools
        console.log('\n--- SUI Pools ---');
        const suiPools = pools.data.filter(p =>
            p.coinTypeA.includes('::sui::SUI') || p.coinTypeB.includes('::sui::SUI')
        );
        console.log(`Found ${suiPools.length} SUI pools`);
        for (const pool of suiPools.slice(0, 5)) {
            const coinA = pool.coinTypeA.split('::').pop();
            const coinB = pool.coinTypeB.split('::').pop();
            console.log(`  ${coinA} / ${coinB}: ${pool.poolAddress.slice(0, 20)}...`);
        }

    } catch (e) {
        console.log('Error querying pools:', e.message);
        console.log('\nNote: Cetus testnet pool availability may vary.');
    }
}

/**
 * Get a specific pool by coin types
 */
async function findPool(coinTypeA, coinTypeB) {
    const sdk = await initCetus();

    try {
        const pools = await sdk.Pool.getPoolsWithPage([]);
        const pool = pools.data.find(p =>
            (p.coinTypeA === coinTypeA && p.coinTypeB === coinTypeB) ||
            (p.coinTypeA === coinTypeB && p.coinTypeB === coinTypeA)
        );
        return pool;
    } catch (e) {
        console.log('Error finding pool:', e.message);
        return null;
    }
}

/**
 * Execute a simple SUI swap on Cetus (direct, no trading module)
 */
async function testSimpleSwap() {
    console.log('\n=== Testing Simple Cetus Swap ===');

    const sdk = await initCetus();
    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    // Check SUI balance
    const suiBalance = await client.getBalance({ owner: sender });
    console.log(`SUI Balance: ${Number(suiBalance.totalBalance) / 1e9} SUI`);

    if (Number(suiBalance.totalBalance) < 0.5e9) {
        console.log('Need at least 0.5 SUI to test swap');
        return;
    }

    try {
        // Find SUI pools
        const pools = await sdk.Pool.getPoolsWithPage([]);
        const suiPools = pools.data.filter(p =>
            p.coinTypeA === '0x2::sui::SUI' || p.coinTypeB === '0x2::sui::SUI'
        );

        if (suiPools.length === 0) {
            console.log('No SUI pools found on testnet');
            return;
        }

        const pool = suiPools[0];
        console.log('\nUsing pool:', pool.poolAddress.slice(0, 30) + '...');

        const coinA = pool.coinTypeA.split('::').pop();
        const coinB = pool.coinTypeB.split('::').pop();
        console.log(`Pair: ${coinA} / ${coinB}`);

        // Determine swap direction (we want to swap SUI -> other)
        const a2b = pool.coinTypeA === '0x2::sui::SUI';
        const swapAmount = new BN(100_000_000); // 0.1 SUI
        const slippage = Percentage.fromDecimal(d(5)); // 5% slippage

        console.log(`\nSwap: ${a2b ? coinA : coinB} -> ${a2b ? coinB : coinA}`);
        console.log(`Amount: ${swapAmount.toNumber() / 1e9} SUI`);

        // Preswap to estimate output
        const preswapResult = await sdk.Swap.preswap({
            pool: pool,
            current_sqrt_price: pool.current_sqrt_price,
            coinTypeA: pool.coinTypeA,
            coinTypeB: pool.coinTypeB,
            decimalsA: a2b ? 9 : 6, // SUI has 9 decimals
            decimalsB: a2b ? 6 : 9,
            a2b: a2b,
            by_amount_in: true,
            amount: swapAmount.toString(),
        });

        console.log('\nPreswap result:');
        console.log(`  Amount In: ${preswapResult.amount}`);
        console.log(`  Estimated Out: ${preswapResult.estimatedAmountOut}`);

        // Calculate slippage-adjusted limit
        const amountLimit = adjustForSlippage(
            new BN(preswapResult.estimatedAmountOut),
            slippage,
            false
        );

        console.log(`  Min Out (with slippage): ${amountLimit.toString()}`);

        // Create swap payload
        const swapPayload = await sdk.Swap.createSwapTransactionPayload({
            pool_id: pool.poolAddress,
            coinTypeA: pool.coinTypeA,
            coinTypeB: pool.coinTypeB,
            a2b: a2b,
            by_amount_in: true,
            amount: preswapResult.amount.toString(),
            amount_limit: amountLimit.toString(),
        });

        console.log('\nSwap transaction created');
        console.log('Note: Not executing to preserve funds. Use --execute to run.');

        if (process.argv.includes('--execute')) {
            console.log('\nExecuting swap...');
            const result = await sdk.fullClient.sendTransaction(keypair, swapPayload);
            console.log('TX:', result.digest);
        }

    } catch (e) {
        console.log('Error during swap:', e.message);
        if (e.message.includes('pool')) {
            console.log('\nNote: Testnet may have limited pools. Try mainnet for testing.');
        }
    }
}

/**
 * Demonstrate Cetus + Trading Module PTB integration
 */
async function demonstrateTradingModuleIntegration() {
    console.log('\n=== Cetus + Trading Module Integration ===');

    if (!TRADING_VAULT_ID || !TRADING_MODULE_ID || !LEADER_TRADE_CAP_ID) {
        console.log('Trading objects not configured.');
        console.log('Run: node test-trading-deepbook.js create');
        return;
    }

    const sdk = await initCetus();
    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    // Check trading vault balance
    const vaultObj = await client.getObject({
        id: TRADING_VAULT_ID,
        options: { showContent: true }
    });

    const balanceField = vaultObj.data?.content?.fields?.trading_balance;
    const vaultBalance = typeof balanceField === 'object' ? (balanceField?.fields?.value || 0) : (balanceField || 0);
    console.log(`Trading Vault Balance: ${Number(vaultBalance) / 1e6} USDC`);

    console.log(`
Integration Flow:
─────────────────────────────────────────────────────────────────────

1. Leader calls authorize_trade()
   → Creates TradeAuthorization ticket

2. PTB executes:
   a. consume_authorization_for_trade()
      → Extracts Coin<USDC> from TradingVault

   b. Cetus SDK createSwapTransactionWithoutTransferCoinsPayload()
      → Returns swap coins (coinA, coinB)

   c. return_trade_output()
      → Returns output coins to TradingVault

─────────────────────────────────────────────────────────────────────

Note: For actual Cetus integration, you need:
1. A pool with your token pair (e.g., SUI/USDC)
2. The pool must exist on the target network
3. Sufficient liquidity in the pool

Our testnet USDC: ${USDC_TYPE}
`);

    // Check if any pool exists with our USDC
    console.log('Checking for pools with our USDC...');
    try {
        const pools = await sdk.Pool.getPoolsWithPage([]);

        // Find pools with our USDC type
        const ourUsdcPools = pools.data.filter(p =>
            p.coinTypeA === USDC_TYPE || p.coinTypeB === USDC_TYPE
        );

        if (ourUsdcPools.length > 0) {
            console.log(`Found ${ourUsdcPools.length} pools with our USDC!`);
            for (const pool of ourUsdcPools) {
                console.log(`  Pool: ${pool.poolAddress}`);
            }
        } else {
            console.log('No pools found with our custom USDC.');
            console.log('\nOptions:');
            console.log('1. Create a pool on Cetus with our USDC');
            console.log('2. Use Cetus testnet USDC instead');
            console.log('3. Use SUI as the trading asset');
        }
    } catch (e) {
        console.log('Error checking pools:', e.message);
    }
}

/**
 * Show architecture diagram
 */
function showArchitecture() {
    console.log(`
═══════════════════════════════════════════════════════════════════════
                    Trading Module + Cetus Architecture
═══════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────┐
│                        PTB (Atomic Transaction)                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │ 1. consume_      │     │ 2. Cetus         │     │ 3. return_  │ │
│  │    authorization │ ──► │    Swap.create   │ ──► │    trade_   │ │
│  │    _for_trade()  │     │    SwapTx...()   │     │    output() │ │
│  │                  │     │                  │     │             │ │
│  │ Returns Coin<>   │     │ Returns coinAB   │     │ Deposit to  │ │
│  └──────────────────┘     └──────────────────┘     │ TradingVault│ │
│                                                    └─────────────┘ │
└─────────────────────────────────────────────────────────────────────┘

Cetus SDK Key Functions:
  • initCetusSDK({ network: 'testnet' })
  • sdk.Pool.getPoolsWithPage([])
  • sdk.Swap.preswap({ pool, a2b, amount, ... })
  • sdk.Swap.createSwapTransactionWithoutTransferCoinsPayload(...)

Advantages of Cetus:
  • CLMM (Concentrated Liquidity) - better capital efficiency
  • Supports custom token pools
  • Good TypeScript SDK
  • Active on both testnet and mainnet

═══════════════════════════════════════════════════════════════════════
`);
}

// Main
async function main() {
    const command = process.argv[2];

    console.log('=== Cetus DEX Integration Test ===');
    console.log(`Network: ${NETWORK}`);
    console.log(`Address: ${getAddress()}`);

    if (command === 'pools') {
        await queryPools();
    } else if (command === 'swap') {
        await testSimpleSwap();
    } else if (command === 'integrate') {
        await demonstrateTradingModuleIntegration();
    } else if (command === 'arch') {
        showArchitecture();
    } else {
        console.log('\nUsage:');
        console.log('  node test-cetus-swap.js pools      - Query available pools');
        console.log('  node test-cetus-swap.js swap       - Test simple swap');
        console.log('  node test-cetus-swap.js swap --execute  - Execute swap');
        console.log('  node test-cetus-swap.js integrate  - Show Trading Module integration');
        console.log('  node test-cetus-swap.js arch       - Show architecture');
        showArchitecture();
    }
}

main().catch(console.error);
