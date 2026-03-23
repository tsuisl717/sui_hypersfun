/**
 * Test Trading Module with DeepBook V3 Integration
 *
 * DeepBook V3 Testnet Configuration:
 * - Package ID: 0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c
 * - Registry ID: 0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1
 *
 * Available Testnet Pools:
 * - DEEP_SUI, SUI_DBUSDC, DEEP_DBUSDC, DBUSDT_DBUSDC, WAL_DBUSDC, WAL_SUI, DBTC_DBUSDC
 *
 * Note: DeepBook uses DBUSDC (DeepBook USDC) on testnet, which may be different
 * from our custom testnet USDC.
 */

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');

require('dotenv').config();

// Config
const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const FACTORY_ID = process.env.SUI_FACTORY_ID;
const ADMIN_CAP_ID = process.env.SUI_ADMIN_CAP_ID;
const VAULT_ID = process.env.SUI_VAULT_ID;
const USDC_TYPE = process.env.SUI_USDC_TYPE;
const NETWORK = process.env.SUI_NETWORK || 'testnet';

// DeepBook V3 Testnet Config
const DEEPBOOK = {
    PACKAGE_ID: '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c',
    REGISTRY_ID: '0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1',
    // Testnet coin types (from DeepBook)
    DBUSDC: '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c::dbusdc::DBUSDC',
    SUI: '0x2::sui::SUI',
    DEEP: '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c::deep::DEEP',
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

// Get all owned objects of a specific type
async function getOwnedObjectsOfType(address, typeFilter) {
    const objects = await client.getOwnedObjects({
        owner: address,
        filter: { StructType: typeFilter },
        options: { showContent: true, showType: true }
    });
    return objects.data;
}

// Get USDC coins
async function getUsdcCoins(address) {
    const coins = await client.getCoins({
        owner: address,
        coinType: USDC_TYPE,
    });
    return coins.data;
}

// ============ Step 1: Create Trading Vault ============

async function createTradingVault() {
    console.log('\n=== Creating Trading Vault ===');

    if (!VAULT_ID) {
        throw new Error('SUI_VAULT_ID not set. Create a vault first.');
    }

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    const tx = new Transaction();
    tx.setSender(sender);

    // Call create_trading_vault
    tx.moveCall({
        target: `${PACKAGE_ID}::sui_trading::create_trading_vault`,
        typeArguments: [USDC_TYPE],
        arguments: [
            tx.object(ADMIN_CAP_ID),          // admin_cap
            tx.pure.id(VAULT_ID),              // vault_id
            tx.pure.address(sender),           // leader address
            tx.pure.u64(100_000_000_000),      // max_trade_size: 100K USDC
            tx.pure.u64(500_000_000_000),      // daily_trade_limit: 500K USDC
            tx.object('0x6'),                  // Clock
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true, showObjectChanges: true }
    });

    console.log('Transaction digest:', result.digest);

    // Find created objects
    let tradingVaultId = null;
    let leaderTradeCapId = null;
    let tradingModuleId = null;

    for (const change of result.objectChanges || []) {
        if (change.type === 'created') {
            if (change.objectType?.includes('SuiTradingVault')) {
                tradingVaultId = change.objectId;
                console.log('Created TradingVault ID:', tradingVaultId);
            }
            if (change.objectType?.includes('SuiLeaderTradeCap')) {
                leaderTradeCapId = change.objectId;
                console.log('Created LeaderTradeCap ID:', leaderTradeCapId);
            }
            if (change.objectType?.includes('SuiTradingModule')) {
                tradingModuleId = change.objectId;
                console.log('Created TradingModule ID:', tradingModuleId);
            }
        }
    }

    // Show events
    for (const event of result.events || []) {
        console.log('Event:', event.type.split('::').pop());
    }

    return { tradingVaultId, leaderTradeCapId, tradingModuleId };
}

// ============ Step 2: Deposit to Trading Vault ============

async function depositToTradingVault(tradingVaultId, amount) {
    console.log('\n=== Depositing to Trading Vault ===');
    console.log(`Amount: ${amount / 1e6} USDC`);

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    // Get USDC coins
    const usdcCoins = await getUsdcCoins(sender);
    if (usdcCoins.length === 0) {
        throw new Error('No USDC coins found');
    }

    const totalUsdc = usdcCoins.reduce((acc, c) => acc + BigInt(c.balance), 0n);
    console.log(`Available USDC: ${Number(totalUsdc) / 1e6}`);

    if (totalUsdc < BigInt(amount)) {
        throw new Error(`Insufficient USDC: need ${amount / 1e6}, have ${Number(totalUsdc) / 1e6}`);
    }

    const tx = new Transaction();
    tx.setSender(sender);

    // Prepare USDC coin
    let usdcCoin;
    if (usdcCoins.length === 1 && BigInt(usdcCoins[0].balance) >= BigInt(amount)) {
        const [splitCoin] = tx.splitCoins(tx.object(usdcCoins[0].coinObjectId), [tx.pure.u64(amount)]);
        usdcCoin = splitCoin;
    } else {
        const primaryCoin = tx.object(usdcCoins[0].coinObjectId);
        if (usdcCoins.length > 1) {
            const otherCoins = usdcCoins.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(primaryCoin, otherCoins);
        }
        const [splitCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(amount)]);
        usdcCoin = splitCoin;
    }

    // Deposit to trading vault
    tx.moveCall({
        target: `${PACKAGE_ID}::sui_trading::deposit_to_trading`,
        typeArguments: [USDC_TYPE],
        arguments: [
            tx.object(tradingVaultId),
            usdcCoin,
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true }
    });

    console.log('Transaction digest:', result.digest);

    for (const event of result.events || []) {
        console.log('Event:', event.type.split('::').pop());
        if (event.parsedJson?.amount) {
            console.log(`  Amount: ${Number(event.parsedJson.amount) / 1e6} USDC`);
        }
    }

    return result;
}

// ============ Step 3: Check Trading Vault State ============

async function getTradingVaultState(tradingVaultId) {
    const obj = await client.getObject({
        id: tradingVaultId,
        options: { showContent: true }
    });

    if (obj.error) {
        throw new Error(`TradingVault not found: ${obj.error}`);
    }

    return obj.data.content.fields;
}

// ============ Step 4: Authorize Trade ============

async function authorizeTrade(tradingModuleId, tradingVaultId, leaderTradeCapId, amount, isBuy) {
    console.log('\n=== Authorizing Trade ===');
    console.log(`Amount: ${amount / 1e6} USDC`);
    console.log(`Direction: ${isBuy ? 'BUY' : 'SELL'}`);

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    const tx = new Transaction();
    tx.setSender(sender);

    // Hash types for base/quote (simplified - use type hash in real impl)
    const baseTypeHash = 1; // SUI
    const quoteTypeHash = 2; // USDC

    tx.moveCall({
        target: `${PACKAGE_ID}::sui_trading::authorize_trade`,
        typeArguments: [USDC_TYPE],
        arguments: [
            tx.object(tradingModuleId),
            tx.object(tradingVaultId),
            tx.object(leaderTradeCapId),
            tx.pure.u64(baseTypeHash),
            tx.pure.u64(quoteTypeHash),
            tx.pure.u64(amount),
            tx.pure.bool(isBuy),
            tx.pure.u64(0), // min_output (0 for testing)
            tx.pure.u64(300), // expiry: 5 minutes
            tx.object('0x6'), // Clock
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true, showObjectChanges: true }
    });

    console.log('Transaction digest:', result.digest);

    let authorizationId = null;
    for (const change of result.objectChanges || []) {
        if (change.type === 'created' && change.objectType?.includes('TradeAuthorization')) {
            authorizationId = change.objectId;
            console.log('Created TradeAuthorization ID:', authorizationId);
        }
    }

    for (const event of result.events || []) {
        console.log('Event:', event.type.split('::').pop());
        const data = event.parsedJson;
        if (data?.order_nonce) {
            console.log(`  Order Nonce: ${data.order_nonce}`);
        }
        if (data?.max_amount) {
            console.log(`  Max Amount: ${Number(data.max_amount) / 1e6} USDC`);
        }
    }

    return authorizationId;
}

// ============ DeepBook Integration Info ============

async function showDeepBookInfo() {
    console.log('\n=== DeepBook V3 Testnet Info ===');
    console.log('Package ID:', DEEPBOOK.PACKAGE_ID);
    console.log('Registry ID:', DEEPBOOK.REGISTRY_ID);
    console.log('\nAvailable Pools:');
    console.log('  - SUI_DBUSDC (SUI ↔ DBUSDC)');
    console.log('  - DEEP_SUI (DEEP ↔ SUI)');
    console.log('  - DEEP_DBUSDC (DEEP ↔ DBUSDC)');
    console.log('\nNote: DeepBook uses DBUSDC (DeepBook USDC) on testnet.');
    console.log('To trade, you need DBUSDC from DeepBook faucet or swap from SUI.');

    // Check if we have any DBUSDC
    const address = getAddress();
    try {
        const dbusdc = await client.getCoins({
            owner: address,
            coinType: DEEPBOOK.DBUSDC,
        });
        console.log(`\nDBUSDC Balance: ${dbusdc.data.reduce((acc, c) => acc + BigInt(c.balance), 0n) / 1000000n} DBUSDC`);
    } catch (e) {
        console.log('\nDBUSDC Balance: 0 (coin type may not exist on this testnet)');
    }

    // Check SUI balance
    const sui = await client.getBalance({ owner: address });
    console.log(`SUI Balance: ${Number(sui.totalBalance) / 1e9} SUI`);
}

// ============ Main ============

async function main() {
    const command = process.argv[2];
    const address = getAddress();

    console.log('=== Trading Module Test ===');
    console.log(`Wallet: ${address}`);
    console.log(`Package: ${PACKAGE_ID}`);
    console.log(`Vault: ${VAULT_ID}`);

    // Environment variables for trading objects
    const tradingVaultId = process.env.SUI_TRADING_VAULT_ID;
    const leaderTradeCapId = process.env.SUI_LEADER_TRADE_CAP_ID;
    const tradingModuleId = process.env.SUI_TRADING_MODULE_ID;

    if (command === 'create') {
        // Create trading vault
        const result = await createTradingVault();
        console.log('\n=== Update .env with: ===');
        console.log(`SUI_TRADING_VAULT_ID=${result.tradingVaultId}`);
        console.log(`SUI_LEADER_TRADE_CAP_ID=${result.leaderTradeCapId}`);
        console.log(`SUI_TRADING_MODULE_ID=${result.tradingModuleId}`);
        return;
    }

    if (command === 'deposit') {
        if (!tradingVaultId) {
            console.log('SUI_TRADING_VAULT_ID not set. Run "create" first.');
            return;
        }
        const amount = parseInt(process.argv[3]) || 5;
        await depositToTradingVault(tradingVaultId, amount * 1e6);

        // Show updated state
        const state = await getTradingVaultState(tradingVaultId);
        console.log('\n=== Trading Vault State ===');
        console.log(`Balance: ${Number(state.trading_balance) / 1e6} USDC`);
        console.log(`Max Trade Size: ${Number(state.max_trade_size) / 1e6} USDC`);
        console.log(`Daily Limit: ${Number(state.daily_trade_limit) / 1e6} USDC`);
        console.log(`Daily Traded: ${Number(state.daily_traded) / 1e6} USDC`);
        return;
    }

    if (command === 'status') {
        if (!tradingVaultId) {
            console.log('SUI_TRADING_VAULT_ID not set.');
            console.log('Run "node test-trading-deepbook.js create" to create a trading vault.');
            return;
        }
        const state = await getTradingVaultState(tradingVaultId);
        console.log('\n=== Trading Vault State ===');
        console.log(`Trading Vault ID: ${tradingVaultId}`);
        console.log(`Balance: ${Number(state.trading_balance) / 1e6} USDC`);
        console.log(`Max Trade Size: ${Number(state.max_trade_size) / 1e6} USDC`);
        console.log(`Daily Limit: ${Number(state.daily_trade_limit) / 1e6} USDC`);
        console.log(`Daily Traded: ${Number(state.daily_traded) / 1e6} USDC`);
        console.log(`Paused: ${state.paused}`);
        return;
    }

    if (command === 'authorize') {
        if (!tradingModuleId || !tradingVaultId || !leaderTradeCapId) {
            console.log('Trading objects not set. Run "create" and "deposit" first.');
            return;
        }
        const amount = parseInt(process.argv[3]) || 1;
        const isBuy = process.argv[4] !== 'sell';
        await authorizeTrade(tradingModuleId, tradingVaultId, leaderTradeCapId, amount * 1e6, isBuy);
        return;
    }

    if (command === 'deepbook') {
        await showDeepBookInfo();
        return;
    }

    // Default: show help
    console.log('\nUsage:');
    console.log('  node test-trading-deepbook.js create     - Create trading vault');
    console.log('  node test-trading-deepbook.js deposit 5  - Deposit 5 USDC');
    console.log('  node test-trading-deepbook.js status     - Show trading vault status');
    console.log('  node test-trading-deepbook.js authorize 1 buy  - Authorize 1 USDC buy trade');
    console.log('  node test-trading-deepbook.js deepbook   - Show DeepBook info');
    console.log('\nDeepBook Integration:');
    console.log('  The authorize command creates a TradeAuthorization ticket.');
    console.log('  This ticket is used in a PTB to execute actual DeepBook trades.');
    console.log('  See the DeepBook V3 SDK docs: https://docs.sui.io/standards/deepbookv3-sdk');
}

main().catch(console.error);
