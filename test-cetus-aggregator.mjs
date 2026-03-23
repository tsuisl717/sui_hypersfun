/**
 * Cetus Aggregator Integration Test (ESM)
 *
 * Uses Cetus Plus Aggregator to find optimal swap routes across multiple DEXs.
 *
 * References:
 * - GitHub: https://github.com/CetusProtocol/aggregator
 * - Docs: https://cetus-1.gitbook.io/cetus-developer-docs/developer/cetus-aggregator
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { AggregatorClient, Env } from '@cetusprotocol/aggregator-sdk';
import BN from 'bn.js';
import dotenv from 'dotenv';

dotenv.config();

// Cetus API endpoints
const CETUS_ENDPOINTS = {
    mainnet: 'https://api-sui.cetus.zone/router_v3/find_routes',
    testnet: 'https://api-sui.cetus.zone/router_v3/find_routes', // Same endpoint, different env
};

// Config
const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const USDC_TYPE = process.env.SUI_USDC_TYPE;
const NETWORK = process.env.SUI_NETWORK || 'testnet';

// Trading objects
const TRADING_VAULT_ID = process.env.SUI_TRADING_VAULT_ID;

// Common tokens (mainnet)
const TOKENS = {
    SUI: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    // Mainnet USDC (Wormhole - most common)
    USDC_WORMHOLE: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
    // Mainnet USDC (Native Circle)
    USDC_NATIVE: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    // CETUS token
    CETUS: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
    // Testnet - DeepBook USDC
    DBUSDC: '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c::dbusdc::DBUSDC',
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
function initAggregator(network = 'mainnet') {
    const suiClient = new SuiClient({ url: getFullnodeUrl(network) });
    const sender = getAddress();

    const aggregator = new AggregatorClient({
        client: suiClient,
        signer: sender,
        env: network === 'mainnet' ? Env.Mainnet : Env.Testnet,
    });

    return aggregator;
}

/**
 * Find swap routes using aggregator
 */
async function findRoutes(fromToken, toToken, amount, byAmountIn = true, network = 'mainnet') {
    console.log('\n=== Finding Swap Routes ===');
    console.log(`Network: ${network}`);
    console.log(`From: ${fromToken.split('::').pop()}`);
    console.log(`To: ${toToken.split('::').pop()}`);
    console.log(`Amount: ${amount}`);
    console.log(`Mode: ${byAmountIn ? 'Fixed Input' : 'Fixed Output'}`);

    const aggregator = initAggregator(network);

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
            if (best.path) {
                console.log('  Path:', best.path.map(p => p.split('::').pop()).join(' -> '));
            }
            if (best.providers) {
                console.log('  DEXs:', best.providers.join(', '));
            }
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

    const aggregator = initAggregator();
    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    console.log(`Sender: ${sender}`);
    console.log(`From: ${fromToken.split('::').pop()}`);
    console.log(`To: ${toToken.split('::').pop()}`);
    console.log(`Amount: ${amount}`);
    console.log(`Slippage: ${slippage * 100}%`);

    try {
        // Find best route
        console.log('\nFinding routes...');
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
        tx.setSender(sender);

        // fastRouterSwap builds the swap PTB and returns output coins
        console.log('\nBuilding swap transaction...');
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
            console.log('\nDry run mode. Add --execute to perform swap.');
        }

    } catch (e) {
        console.log('Error executing swap:', e.message);
        console.error(e);
    }
}

/**
 * Test with SUI balance
 */
async function testWithSUI() {
    console.log('\n=== Testing with SUI ===');

    const sender = getAddress();
    const suiBalance = await client.getBalance({ owner: sender });
    console.log(`SUI Balance: ${Number(suiBalance.totalBalance) / 1e9} SUI`);

    if (Number(suiBalance.totalBalance) < 0.1e9) {
        console.log('Need at least 0.1 SUI to test');
        return;
    }

    // Try to find SUI -> USDC route
    console.log('\nTrying to find SUI -> USDC route on mainnet...');

    // Must use mainnet for actual liquidity
    const mainnetAggregator = initAggregator('mainnet');

    try {
        const routes = await mainnetAggregator.findRouters({
            from: TOKENS.SUI,
            target: TOKENS.USDC_MAINNET,
            amount: new BN('100000000'), // 0.1 SUI
            byAmountIn: true,
        });

        if (routes && routes.length > 0) {
            console.log('Route found!');
            console.log('  Output:', routes[0].amountOut?.toString(), 'USDC units');
        } else {
            console.log('No routes found');
        }
    } catch (e) {
        console.log('Error:', e.message);
    }
}

/**
 * Show PTB integration example
 */
function showPTBIntegration() {
    console.log(`
═══════════════════════════════════════════════════════════════════════
               Trading Module + Cetus Aggregator PTB Integration
═══════════════════════════════════════════════════════════════════════

// Example: Full PTB with Trading Module + Cetus Aggregator

const tx = new Transaction();

// Step 1: Consume authorization and get trading funds
const [inputCoin] = tx.moveCall({
    target: \`\${PACKAGE_ID}::sui_trading::consume_authorization_for_trade\`,
    typeArguments: [USDC_TYPE],
    arguments: [
        tx.object(authorizationId),
        tx.object(TRADING_VAULT_ID),
        tx.pure.u64(amount),
        tx.object('0x6'),
    ],
});

// Step 2: Find best route via Cetus Aggregator
const routes = await aggregator.findRouters({
    from: USDC_TYPE,
    target: SUI_TYPE,
    amount: new BN(amount),
    byAmountIn: true,
});

// Step 3: Build swap transaction
const [outputCoin] = await aggregator.fastRouterSwap({
    routers: routes[0],
    txb: tx,
    slippage: 0.01,
    isMergeTragetCoin: true,
});

// Step 4: Return output to trading vault
tx.moveCall({
    target: \`\${PACKAGE_ID}::sui_trading::return_trade_output\`,
    typeArguments: [SUI_TYPE],
    arguments: [
        tx.object(TRADING_VAULT_ID),
        outputCoin,
    ],
});

// Execute
await client.signAndExecuteTransaction({ signer, transaction: tx });

═══════════════════════════════════════════════════════════════════════

Supported DEXs via Aggregator:
• DeepBook V3    • Cetus CLMM     • Turbos
• Kriya V2/V3    • FlowX V2/V3   • Aftermath
• BlueMov        • Scallop        • Volo
• ... and more!

═══════════════════════════════════════════════════════════════════════
`);
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

═══════════════════════════════════════════════════════════════════════
`);
}

// Main
async function main() {
    const command = process.argv[2];

    console.log('=== Cetus Aggregator Integration (ESM) ===');
    console.log(`Network: ${NETWORK}`);
    console.log(`Address: ${getAddress()}`);

    if (command === 'routes') {
        // Try multiple token pairs on mainnet
        console.log('\n--- Trying SUI -> Native USDC (mainnet) ---');
        await findRoutes(TOKENS.SUI, TOKENS.USDC_NATIVE, '100000000', true, 'mainnet'); // 0.1 SUI

        console.log('\n--- Trying SUI -> CETUS (mainnet) ---');
        await findRoutes(TOKENS.SUI, TOKENS.CETUS, '100000000', true, 'mainnet');
    } else if (command === 'swap') {
        await executeSwap(TOKENS.SUI, TOKENS.USDC_NATIVE, '100000000', 0.01);
    } else if (command === 'test') {
        await testWithSUI();
    } else if (command === 'ptb') {
        showPTBIntegration();
    } else if (command === 'arch') {
        showArchitecture();
    } else {
        console.log('\nUsage:');
        console.log('  node test-cetus-aggregator.mjs routes  - Find swap routes');
        console.log('  node test-cetus-aggregator.mjs swap    - Build swap tx');
        console.log('  node test-cetus-aggregator.mjs test    - Test with SUI');
        console.log('  node test-cetus-aggregator.mjs ptb     - Show PTB integration');
        console.log('  node test-cetus-aggregator.mjs arch    - Show architecture');
        showArchitecture();
    }
}

main().catch(console.error);
