/**
 * Cetus Aggregator Integration Test
 *
 * Uses Cetus Plus Aggregator to find optimal swap routes across multiple DEXs.
 * Supports: DeepBook, Cetus, Turbos, Kriya, FlowX, Aftermath, etc.
 *
 * References:
 * - GitHub: https://github.com/CetusProtocol/aggregator
 * - Docs: https://cetus-1.gitbook.io/cetus-developer-docs/developer/cetus-aggregator
 */

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
const BN = require('bn.js');

require('dotenv').config();

// Try to import Cetus Aggregator SDK
let AggregatorClient;
try {
    const aggregatorModule = require('@cetusprotocol/aggregator-sdk');
    AggregatorClient = aggregatorModule.AggregatorClient || aggregatorModule.default?.AggregatorClient;
    console.log('Aggregator SDK loaded');
} catch (e) {
    console.log('Note: Aggregator SDK not loaded:', e.message);
}

// Config
const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const USDC_TYPE = process.env.SUI_USDC_TYPE;
const NETWORK = process.env.SUI_NETWORK || 'testnet';

// Trading objects
const TRADING_VAULT_ID = process.env.SUI_TRADING_VAULT_ID;
const TRADING_MODULE_ID = process.env.SUI_TRADING_MODULE_ID;
const LEADER_TRADE_CAP_ID = process.env.SUI_LEADER_TRADE_CAP_ID;

// Common tokens
const TOKENS = {
    SUI: '0x2::sui::SUI',
    // Mainnet USDC (Wormhole)
    USDC_MAINNET: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
    // Cetus token
    CETUS: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
};

const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

function getKeypair() {
    const privateKey = process.env.SUI_PRIVATE_KEY;
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
}

function getAddress() {
    return getKeypair().getPublicKey().toSuiAddress();
}

/**
 * Initialize Cetus Aggregator
 */
async function initAggregator() {
    if (!AggregatorClient) {
        console.log('Aggregator SDK not available. Checking module structure...');

        const aggregatorModule = require('@cetusprotocol/aggregator-sdk');
        console.log('Module exports:', Object.keys(aggregatorModule));

        return null;
    }

    const aggregator = new AggregatorClient({
        network: NETWORK,
    });

    return aggregator;
}

/**
 * Find swap routes using aggregator
 */
async function findRoutes(fromToken, toToken, amount, byAmountIn = true) {
    console.log('\n=== Finding Swap Routes ===');
    console.log(`From: ${fromToken.split('::').pop()}`);
    console.log(`To: ${toToken.split('::').pop()}`);
    console.log(`Amount: ${amount}`);
    console.log(`Mode: ${byAmountIn ? 'Fixed Input' : 'Fixed Output'}`);

    const aggregator = await initAggregator();
    if (!aggregator) {
        console.log('Cannot initialize aggregator');
        return null;
    }

    try {
        const routes = await aggregator.findRouters({
            from: fromToken,
            target: toToken,
            amount: new BN(amount),
            byAmountIn: byAmountIn,
            depth: 3, // Max hops
        });

        console.log('\nRoutes found:', routes?.length || 0);

        if (routes && routes.length > 0) {
            console.log('\nBest route:');
            const best = routes[0];
            console.log('  Input:', best.amountIn?.toString());
            console.log('  Output:', best.amountOut?.toString());
            console.log('  Path:', best.path?.map(p => p.split('::').pop()).join(' -> '));
            console.log('  DEXs:', best.providers?.join(', '));
        }

        return routes;
    } catch (e) {
        console.log('Error finding routes:', e.message);
        return null;
    }
}

/**
 * Execute swap with aggregator
 */
async function executeSwap(fromToken, toToken, amount, slippage = 0.01) {
    console.log('\n=== Executing Aggregator Swap ===');

    const aggregator = await initAggregator();
    if (!aggregator) {
        console.log('Cannot initialize aggregator');
        return;
    }

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    try {
        // Find best route
        const routes = await aggregator.findRouters({
            from: fromToken,
            target: toToken,
            amount: new BN(amount),
            byAmountIn: true,
        });

        if (!routes || routes.length === 0) {
            console.log('No routes found');
            return;
        }

        const bestRoute = routes[0];
        console.log('Best route found');
        console.log('  Expected output:', bestRoute.amountOut?.toString());

        // Create swap transaction
        const tx = new Transaction();

        // fastRouterSwap builds the swap PTB and returns output coins
        const outputCoins = await aggregator.fastRouterSwap({
            routers: bestRoute,
            txb: tx,
            slippage: slippage,
            isMergeTragetCoin: true,
            refreshAllCoins: true,
        });

        console.log('Swap transaction built');

        // Transfer output to sender
        if (outputCoins) {
            tx.transferObjects([outputCoins], sender);
        }

        // Execute
        if (process.argv.includes('--execute')) {
            console.log('\nExecuting swap...');
            const result = await client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
                options: { showEffects: true, showEvents: true }
            });
            console.log('TX:', result.digest);
            console.log('Status:', result.effects?.status?.status);
        } else {
            console.log('\nDry run mode. Use --execute to perform swap.');
        }

    } catch (e) {
        console.log('Error executing swap:', e.message);
    }
}

/**
 * Demonstrate Trading Module + Aggregator PTB
 */
async function demonstratePTBIntegration() {
    console.log('\n=== Trading Module + Cetus Aggregator PTB ===');

    if (!TRADING_VAULT_ID) {
        console.log('Trading vault not configured.');
        return;
    }

    console.log(`
PTB Flow with Cetus Aggregator:
───────────────────────────────────────────────────────────────────────

1. authorize_trade()
   Leader creates TradeAuthorization

2. consume_authorization_for_trade()
   Extract Coin<USDC> from TradingVault

3. aggregator.fastRouterSwap()
   Find best route across all DEXs:
   - DeepBook V3
   - Cetus CLMM
   - Turbos
   - Kriya
   - FlowX
   - Aftermath
   - ... and more

4. return_trade_output()
   Return swapped tokens to TradingVault

───────────────────────────────────────────────────────────────────────

Example Code:
\`\`\`typescript
// 1. Find best route
const routes = await aggregator.findRouters({
  from: USDC_TYPE,
  target: SUI_TYPE,
  amount: new BN(1_000_000), // 1 USDC
  byAmountIn: true,
});

// 2. Build PTB
const tx = new Transaction();

// Consume authorization
const [inputCoin] = tx.moveCall({
  target: \`\${PACKAGE_ID}::sui_trading::consume_authorization_for_trade\`,
  // ...
});

// Execute aggregator swap
const outputCoin = await aggregator.fastRouterSwap({
  routers: routes[0],
  txb: tx,
  slippage: 0.01,
});

// Return to trading vault
tx.moveCall({
  target: \`\${PACKAGE_ID}::sui_trading::return_trade_output\`,
  arguments: [tradingVault, outputCoin],
});
\`\`\`
`);
}

/**
 * Check module structure
 */
async function checkSDK() {
    console.log('\n=== Checking SDK Structure ===');

    try {
        const aggregatorModule = require('@cetusprotocol/aggregator-sdk');
        console.log('Module type:', typeof aggregatorModule);
        console.log('Module keys:', Object.keys(aggregatorModule));

        if (aggregatorModule.default) {
            console.log('Default export keys:', Object.keys(aggregatorModule.default));
        }

        // Try different ways to access the client
        const possibleClients = [
            aggregatorModule.AggregatorClient,
            aggregatorModule.default?.AggregatorClient,
            aggregatorModule.Aggregator,
            aggregatorModule.default?.Aggregator,
            aggregatorModule.Client,
        ];

        for (let i = 0; i < possibleClients.length; i++) {
            if (possibleClients[i]) {
                console.log(`Found client at index ${i}`);
            }
        }
    } catch (e) {
        console.log('Error:', e.message);
    }
}

/**
 * Show architecture
 */
function showArchitecture() {
    console.log(`
═══════════════════════════════════════════════════════════════════════
                Trading Module + Cetus Aggregator Architecture
═══════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────┐
│                         Cetus Aggregator                             │
│                                                                      │
│   Finds optimal routes across multiple DEXs:                        │
│   ┌─────────┬─────────┬─────────┬─────────┬─────────┐              │
│   │DeepBook │  Cetus  │ Turbos  │  Kriya  │ FlowX   │ ...          │
│   │   V3    │  CLMM   │         │   V3    │   V3    │              │
│   └────┬────┴────┬────┴────┬────┴────┬────┴────┬────┘              │
│        └─────────┴─────────┴─────────┴─────────┘                    │
│                           │                                          │
│                    Best Route Found                                  │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        PTB (Atomic Transaction)                      │
│                                                                      │
│  1. consume_authorization_for_trade() ─► Coin<USDC>                 │
│  2. aggregator.fastRouterSwap()       ─► Coin<SUI>                  │
│  3. return_trade_output()             ─► TradingVault               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

Benefits:
  • Best price across all DEXs
  • Automatic route optimization
  • Multi-hop swaps supported
  • Single SDK for all DEXs

═══════════════════════════════════════════════════════════════════════
`);
}

// Main
async function main() {
    const command = process.argv[2];

    console.log('=== Cetus Aggregator Integration ===');
    console.log(`Network: ${NETWORK}`);
    console.log(`Address: ${getAddress()}`);

    if (command === 'check') {
        await checkSDK();
    } else if (command === 'routes') {
        // Example: Find SUI -> USDC routes on mainnet
        await findRoutes(TOKENS.SUI, TOKENS.USDC_MAINNET, '100000000'); // 0.1 SUI
    } else if (command === 'swap') {
        await executeSwap(TOKENS.SUI, TOKENS.USDC_MAINNET, '100000000', 0.01);
    } else if (command === 'ptb') {
        await demonstratePTBIntegration();
    } else if (command === 'arch') {
        showArchitecture();
    } else {
        console.log('\nUsage:');
        console.log('  node test-cetus-aggregator.js check    - Check SDK structure');
        console.log('  node test-cetus-aggregator.js routes   - Find swap routes');
        console.log('  node test-cetus-aggregator.js swap     - Build swap tx');
        console.log('  node test-cetus-aggregator.js ptb      - Show PTB integration');
        console.log('  node test-cetus-aggregator.js arch     - Show architecture');
        showArchitecture();
    }
}

main().catch(console.error);
