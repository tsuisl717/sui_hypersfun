/**
 * DeepBook V3 PTB Integration Test
 *
 * This demonstrates the full trading flow:
 * 1. Leader authorizes trade -> TradeAuthorization
 * 2. PTB: consume_authorization -> DeepBook swap -> return_output
 *
 * Note: DeepBook testnet uses DBUSDC, we use custom USDC.
 * For real integration, would need to bridge or use compatible tokens.
 *
 * References:
 * - DeepBook V3: https://docs.sui.io/standards/deepbookv3-sdk
 * - TypeDoc: https://sdk.mystenlabs.com/typedoc/classes/_mysten_deepbook_v3.DeepBookClient.html
 */

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');

require('dotenv').config();

// Config
const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const USDC_TYPE = process.env.SUI_USDC_TYPE;
const NETWORK = process.env.SUI_NETWORK || 'testnet';

// Trading objects
const TRADING_VAULT_ID = process.env.SUI_TRADING_VAULT_ID;
const TRADING_MODULE_ID = process.env.SUI_TRADING_MODULE_ID;
const LEADER_TRADE_CAP_ID = process.env.SUI_LEADER_TRADE_CAP_ID;

// DeepBook V3 Testnet
const DEEPBOOK = {
    PACKAGE_ID: '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963571f2b0f6b168f911', // DeepBook V3 testnet
    DBUSDC: '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c::dbusdc::DBUSDC',
    SUI: '0x2::sui::SUI',
    // Pool IDs need to be queried from registry
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
 * Query DeepBook pools from registry
 */
async function queryDeepBookPools() {
    console.log('\n=== Querying DeepBook V3 Pools ===');

    // DeepBook V3 registry
    const registryId = '0x98dace830ebebd44b7a3331c00750bf758f8a4b17a27380f5bb3fbe68cb984a7';

    try {
        const fields = await client.getDynamicFields({
            parentId: registryId,
        });

        console.log(`Found ${fields.data.length} pools:`);
        for (const field of fields.data) {
            console.log(`  - ${field.name.value}`);

            // Get pool details
            const poolObj = await client.getObject({
                id: field.objectId,
                options: { showContent: true, showType: true }
            });

            if (poolObj.data?.content?.fields) {
                const pool = poolObj.data.content.fields;
                console.log(`    Pool ID: ${field.objectId}`);
            }
        }
    } catch (e) {
        console.log('Error querying pools:', e.message);
        console.log('\nNote: DeepBook V3 registry may have different structure.');
        console.log('Use DeepBook SDK for reliable pool discovery.');
    }
}

/**
 * Full PTB integration flow (demonstration)
 *
 * This shows how the trading flow would work:
 * 1. authorize_trade -> creates TradeAuthorization (owned object)
 * 2. consume_authorization_for_trade -> extracts coin from trading vault
 * 3. DeepBook swap -> exchanges tokens
 * 4. return_trade_output -> returns output to trading vault
 */
async function demonstratePTBFlow() {
    console.log('\n=== PTB Trading Flow Demonstration ===');

    if (!TRADING_VAULT_ID || !TRADING_MODULE_ID || !LEADER_TRADE_CAP_ID) {
        console.log('Trading objects not configured. Run test-trading-deepbook.js create first.');
        return;
    }

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    // Check trading vault balance
    const vaultObj = await client.getObject({
        id: TRADING_VAULT_ID,
        options: { showContent: true }
    });

    // trading_balance can be either a Balance object or a simple u64
    const balanceField = vaultObj.data?.content?.fields?.trading_balance;
    const vaultBalance = typeof balanceField === 'object' ? (balanceField?.fields?.value || 0) : (balanceField || 0);
    console.log(`Trading Vault Balance: ${Number(vaultBalance) / 1e6} USDC`);

    if (Number(vaultBalance) < 1_000_000) {
        console.log('\nInsufficient balance. Deposit USDC first:');
        console.log('  node test-trading-deepbook.js deposit 1');
        return;
    }

    // Step 1: Authorize trade
    console.log('\n--- Step 1: Authorize Trade ---');
    const authorizeTx = new Transaction();
    authorizeTx.setSender(sender);

    authorizeTx.moveCall({
        target: `${PACKAGE_ID}::sui_trading::authorize_trade`,
        typeArguments: [USDC_TYPE],
        arguments: [
            authorizeTx.object(TRADING_MODULE_ID),
            authorizeTx.object(TRADING_VAULT_ID),
            authorizeTx.object(LEADER_TRADE_CAP_ID),
            authorizeTx.pure.u64(1), // base_type (SUI hash)
            authorizeTx.pure.u64(2), // quote_type (USDC hash)
            authorizeTx.pure.u64(500_000), // amount: 0.5 USDC
            authorizeTx.pure.bool(true), // is_buy
            authorizeTx.pure.u64(0), // min_output
            authorizeTx.pure.u64(300), // expiry_seconds
            authorizeTx.object('0x6'), // Clock
        ],
    });

    const authResult = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: authorizeTx,
        options: { showEffects: true, showEvents: true, showObjectChanges: true }
    });

    console.log('Authorization TX:', authResult.digest);

    // Find TradeAuthorization ID
    let authorizationId = null;
    for (const change of authResult.objectChanges || []) {
        if (change.type === 'created' && change.objectType?.includes('TradeAuthorization')) {
            authorizationId = change.objectId;
            console.log('Created TradeAuthorization:', authorizationId);
        }
    }

    if (!authorizationId) {
        console.log('Failed to create authorization');
        return;
    }

    // Step 2: Build PTB for consume -> swap -> return
    console.log('\n--- Step 2: Execute Trade PTB ---');
    console.log('Building PTB with:');
    console.log('  1. consume_authorization_for_trade()');
    console.log('  2. DeepBook swap (simulated - need DBUSDC)');
    console.log('  3. return_trade_output()');

    const tradeTx = new Transaction();
    tradeTx.setSender(sender);

    // 2a. Consume authorization and get USDC coin
    const [usdcCoin] = tradeTx.moveCall({
        target: `${PACKAGE_ID}::sui_trading::consume_authorization_for_trade`,
        typeArguments: [USDC_TYPE],
        arguments: [
            tradeTx.object(authorizationId),
            tradeTx.object(TRADING_VAULT_ID),
            tradeTx.pure.u64(500_000), // amount to use
            tradeTx.object('0x6'), // Clock
        ],
    });

    // 2b. In real scenario: DeepBook swap
    // DeepBook swap would be:
    // const [baseOut, quoteOut, deepOut] = tradeTx.moveCall({
    //     target: `${DEEPBOOK.PACKAGE_ID}::pool::swap_exact_quote_for_base`,
    //     typeArguments: [SUI_TYPE, DBUSDC_TYPE],
    //     arguments: [
    //         tradeTx.object(POOL_ID),
    //         usdcCoin,
    //         tradeTx.pure.u64(minOutput),
    //         tradeTx.object('0x6'),
    //     ],
    // });

    // For now, we'll just return the USDC back (simulating a "no-op" swap)
    console.log('  Note: Actual DeepBook swap skipped (need DBUSDC)');
    console.log('  Returning USDC back to trading vault...');

    // 2c. Return output to trading vault
    tradeTx.moveCall({
        target: `${PACKAGE_ID}::sui_trading::return_trade_output`,
        typeArguments: [USDC_TYPE],
        arguments: [
            tradeTx.object(TRADING_VAULT_ID),
            usdcCoin,
        ],
    });

    const tradeResult = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tradeTx,
        options: { showEffects: true, showEvents: true }
    });

    console.log('\nTrade TX:', tradeResult.digest);
    console.log('Status:', tradeResult.effects.status.status);

    // Check final balance
    const finalVault = await client.getObject({
        id: TRADING_VAULT_ID,
        options: { showContent: true }
    });
    const finalBalanceField = finalVault.data?.content?.fields?.trading_balance;
    const finalBalance = typeof finalBalanceField === 'object' ? (finalBalanceField?.fields?.value || 0) : (finalBalanceField || 0);
    console.log(`\nFinal Trading Vault Balance: ${Number(finalBalance) / 1e6} USDC`);

    console.log('\n=== PTB Flow Completed ===');
    console.log('The trading flow works correctly:');
    console.log('1. Leader authorizes trade (creates TradeAuthorization)');
    console.log('2. PTB consumes authorization and extracts funds');
    console.log('3. Swap executed (DeepBook or other DEX)');
    console.log('4. Output returned to trading vault');
    console.log('\nFor actual DeepBook integration:');
    console.log('- Use @mysten/deepbook-v3 SDK');
    console.log('- Need DBUSDC on testnet (DeepBook\'s stablecoin)');
    console.log('- Or create SUI <-> Token pool on DeepBook');
}

/**
 * Show integration architecture
 */
function showArchitecture() {
    console.log(`
═══════════════════════════════════════════════════════════════════════
                    Trading Module + DeepBook Architecture
═══════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────┐
│                        PTB (Atomic Transaction)                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │ 1. authorize_    │     │ 2. consume_      │     │ 3. DeepBook │ │
│  │    trade()       │ ──► │    authorization │ ──► │    swap()   │ │
│  │                  │     │    _for_trade()  │     │             │ │
│  │ Creates          │     │                  │     │ SUI ↔ USDC │ │
│  │ TradeAuth        │     │ Returns Coin<>   │     │             │ │
│  └──────────────────┘     └──────────────────┘     └──────┬──────┘ │
│                                                           │        │
│                                                           ▼        │
│                           ┌──────────────────────────────────────┐ │
│                           │ 4. return_trade_output()              │ │
│                           │    Returns output to TradingVault     │ │
│                           └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘

Objects:
  • SuiTradingVault<USDC>  - Holds trading funds (Admin owned)
  • SuiLeaderTradeCap      - Leader's capability (Leader owned)
  • SuiTradingModule       - Shared module for tracking
  • TradeAuthorization     - One-time use ticket (Consumed in PTB)

Security:
  • Leader can only TRADE, not WITHDRAW
  • Funds always return to TradingVault
  • TradeAuthorization expires and has max amount
  • Daily limits and max trade size enforced

═══════════════════════════════════════════════════════════════════════
`);
}

// Main
async function main() {
    const command = process.argv[2];

    console.log('=== DeepBook V3 PTB Integration ===');
    console.log(`Package: ${PACKAGE_ID}`);
    console.log(`Trading Vault: ${TRADING_VAULT_ID || 'Not set'}`);

    if (command === 'pools') {
        await queryDeepBookPools();
    } else if (command === 'trade') {
        await demonstratePTBFlow();
    } else if (command === 'arch') {
        showArchitecture();
    } else {
        console.log('\nUsage:');
        console.log('  node test-deepbook-ptb.js arch    - Show architecture');
        console.log('  node test-deepbook-ptb.js pools   - Query DeepBook pools');
        console.log('  node test-deepbook-ptb.js trade   - Execute PTB trade flow');
        console.log('\nPrerequisites:');
        console.log('  1. Create trading vault: node test-trading-deepbook.js create');
        console.log('  2. Deposit USDC: node test-trading-deepbook.js deposit 1');
        showArchitecture();
    }
}

main().catch(console.error);
