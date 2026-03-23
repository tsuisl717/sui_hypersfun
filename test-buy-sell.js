/**
 * Test script for SUI HypersFun Buy/Sell functions
 * Tests the V2 contracts with 6-decimal precision
 */

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');

// Load environment
require('dotenv').config();

// Config
const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const FACTORY_ID = process.env.SUI_FACTORY_ID;
const USDC_TYPE = process.env.SUI_USDC_TYPE;
const NETWORK = process.env.SUI_NETWORK || 'testnet';

// Initialize SUI client
const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// Get keypair from private key
function getKeypair() {
    const privateKey = process.env.SUI_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('SUI_PRIVATE_KEY not set');
    }

    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
}

// Get address from keypair
function getAddress() {
    return getKeypair().getPublicKey().toSuiAddress();
}

// Get USDC coins for address
async function getUsdcCoins(address) {
    const coins = await client.getCoins({
        owner: address,
        coinType: USDC_TYPE,
    });
    return coins.data;
}

// Get all owned objects
async function getOwnedObjects(address, type) {
    const objects = await client.getOwnedObjects({
        owner: address,
        filter: type ? { StructType: type } : undefined,
        options: { showContent: true, showType: true }
    });
    return objects.data;
}

// Get Factory state
async function getFactoryState() {
    const factory = await client.getObject({
        id: FACTORY_ID,
        options: { showContent: true }
    });

    if (factory.error) {
        throw new Error(`Factory not found: ${factory.error}`);
    }

    return factory.data.content.fields;
}

// Get Vault state
async function getVaultState(vaultId) {
    const vault = await client.getObject({
        id: vaultId,
        options: { showContent: true }
    });

    if (vault.error) {
        throw new Error(`Vault not found: ${vault.error}`);
    }

    return vault.data.content.fields;
}

// Create a new vault
async function createVault(name, symbol, performanceFeeBps) {
    console.log('\n=== Creating Vault ===');
    console.log(`Name: ${name}, Symbol: ${symbol}, Performance Fee: ${performanceFeeBps / 100}%`);

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    const tx = new Transaction();
    tx.setSender(sender);

    // Call create_vault
    tx.moveCall({
        target: `${PACKAGE_ID}::sui_vault::create_vault`,
        typeArguments: [USDC_TYPE],
        arguments: [
            tx.object(FACTORY_ID),
            tx.pure.vector('u8', Array.from(new TextEncoder().encode(name))),
            tx.pure.vector('u8', Array.from(new TextEncoder().encode(symbol))),
            tx.pure.u64(performanceFeeBps),
            tx.object('0x6'), // Clock
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true, showObjectChanges: true }
    });

    console.log('Transaction digest:', result.digest);

    // Find the created vault and leader cap
    let vaultId = null;
    let leaderCapId = null;

    for (const change of result.objectChanges || []) {
        if (change.type === 'created') {
            if (change.objectType?.includes('SuiVault')) {
                vaultId = change.objectId;
                console.log('Created Vault ID:', vaultId);
            }
            if (change.objectType?.includes('SuiLeaderCap')) {
                leaderCapId = change.objectId;
                console.log('Created LeaderCap ID:', leaderCapId);
            }
        }
    }

    // Show events
    for (const event of result.events || []) {
        console.log('Event:', event.type);
        console.log('  Data:', JSON.stringify(event.parsedJson, null, 2));
    }

    return { vaultId, leaderCapId, digest: result.digest };
}

// Buy vault tokens
async function buyTokens(vaultId, usdcAmount, minTokensOut = 0) {
    console.log('\n=== Buying Tokens ===');
    console.log(`Vault: ${vaultId}`);
    console.log(`USDC Amount: ${usdcAmount / 1e6} USDC`);

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    // Get USDC coins
    const usdcCoins = await getUsdcCoins(sender);
    console.log(`Found ${usdcCoins.length} USDC coins`);

    if (usdcCoins.length === 0) {
        throw new Error('No USDC coins found');
    }

    // Calculate total USDC balance
    const totalUsdc = usdcCoins.reduce((acc, c) => acc + BigInt(c.balance), 0n);
    console.log(`Total USDC balance: ${Number(totalUsdc) / 1e6} USDC`);

    if (totalUsdc < BigInt(usdcAmount)) {
        throw new Error(`Insufficient USDC: need ${usdcAmount / 1e6}, have ${Number(totalUsdc) / 1e6}`);
    }

    const tx = new Transaction();
    tx.setSender(sender);

    // Merge coins if needed and split exact amount
    let usdcCoin;
    if (usdcCoins.length === 1 && BigInt(usdcCoins[0].balance) >= BigInt(usdcAmount)) {
        // Split from single coin
        const [splitCoin] = tx.splitCoins(tx.object(usdcCoins[0].coinObjectId), [tx.pure.u64(usdcAmount)]);
        usdcCoin = splitCoin;
    } else {
        // Merge all coins first, then split
        const primaryCoin = tx.object(usdcCoins[0].coinObjectId);
        if (usdcCoins.length > 1) {
            const otherCoins = usdcCoins.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(primaryCoin, otherCoins);
        }
        const [splitCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(usdcAmount)]);
        usdcCoin = splitCoin;
    }

    // Call buy
    tx.moveCall({
        target: `${PACKAGE_ID}::sui_vault::buy`,
        typeArguments: [USDC_TYPE],
        arguments: [
            tx.object(vaultId),
            tx.object(FACTORY_ID),
            usdcCoin,
            tx.pure.u64(minTokensOut),
            tx.object('0x6'), // Clock
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true }
    });

    console.log('Transaction digest:', result.digest);

    // Parse events
    for (const event of result.events || []) {
        console.log('\nEvent:', event.type.split('::').pop());
        const data = event.parsedJson;
        if (data.tokens_out) {
            console.log(`  Tokens bought: ${Number(data.tokens_out) / 1e6}`);
        }
        if (data.usdc_in) {
            console.log(`  USDC spent: ${Number(data.usdc_in) / 1e6}`);
        }
        if (data.nav) {
            console.log(`  NAV: ${Number(data.nav) / 1e6}`);
        }
        if (data.price) {
            console.log(`  Price: ${Number(data.price) / 1e6}`);
        }
        if (data.instant_nav !== undefined) {
            console.log(`  Instant NAV: ${Number(data.instant_nav) / 1e6}`);
        }
        if (data.twap_nav !== undefined) {
            console.log(`  TWAP NAV: ${Number(data.twap_nav) / 1e6}`);
        }
        if (data.total_assets !== undefined) {
            console.log(`  Total Assets: ${Number(data.total_assets) / 1e6} USDC`);
        }
        if (data.total_supply !== undefined) {
            console.log(`  Total Supply: ${Number(data.total_supply) / 1e6}`);
        }
    }

    return result;
}

// Sell vault tokens
async function sellTokens(vaultId, tokenAmount, minUsdcOut = 0) {
    console.log('\n=== Selling Tokens ===');
    console.log(`Vault: ${vaultId}`);
    console.log(`Token Amount: ${tokenAmount / 1e6}`);

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    const tx = new Transaction();
    tx.setSender(sender);

    // Call sell
    // Note: In the current implementation, tokens are tracked internally
    // A full implementation would use actual Coin<VAULT_TOKEN>
    tx.moveCall({
        target: `${PACKAGE_ID}::sui_vault::sell`,
        typeArguments: [USDC_TYPE],
        arguments: [
            tx.object(vaultId),
            tx.object(FACTORY_ID),
            tx.pure.u64(tokenAmount),
            tx.pure.u64(minUsdcOut),
            tx.object('0x6'), // Clock
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true }
    });

    console.log('Transaction digest:', result.digest);

    // Parse events
    for (const event of result.events || []) {
        console.log('\nEvent:', event.type.split('::').pop());
        const data = event.parsedJson;
        if (data.tokens_in) {
            console.log(`  Tokens sold: ${Number(data.tokens_in) / 1e6}`);
        }
        if (data.usdc_out !== undefined) {
            console.log(`  USDC received: ${Number(data.usdc_out) / 1e6}`);
        }
        if (data.nav) {
            console.log(`  NAV: ${Number(data.nav) / 1e6}`);
        }
        if (data.price) {
            console.log(`  Price: ${Number(data.price) / 1e6}`);
        }
        if (data.exit_fee !== undefined) {
            console.log(`  Exit Fee: ${Number(data.exit_fee) / 1e6} USDC`);
        }
        if (data.performance_fee_tokens !== undefined) {
            console.log(`  Performance Fee (tokens): ${Number(data.performance_fee_tokens) / 1e6}`);
        }
        if (data.instant_nav !== undefined) {
            console.log(`  Instant NAV: ${Number(data.instant_nav) / 1e6}`);
        }
        if (data.twap_nav !== undefined) {
            console.log(`  TWAP NAV: ${Number(data.twap_nav) / 1e6}`);
        }
    }

    return result;
}

// Main test flow
async function main() {
    console.log('=== SUI HypersFun Test ===');
    console.log(`Network: ${NETWORK}`);
    console.log(`Package ID: ${PACKAGE_ID}`);
    console.log(`Factory ID: ${FACTORY_ID}`);
    console.log(`USDC Type: ${USDC_TYPE}`);

    const address = getAddress();
    console.log(`\nWallet Address: ${address}`);

    // Get factory state
    console.log('\n=== Factory State ===');
    const factory = await getFactoryState();
    console.log(`Treasury: ${factory.treasury}`);
    console.log(`Total Vaults: ${factory.total_vaults}`);
    console.log(`Paused: ${factory.paused}`);
    console.log(`Default BC Virtual Base: ${Number(factory.default_bc_virtual_base) / 1e6} (should be 2M)`);
    console.log(`Default BC Virtual Tokens: ${Number(factory.default_bc_virtual_tokens) / 1e6} (should be 2M)`);
    console.log(`Default Initial Assets: ${Number(factory.default_initial_assets) / 1e6} (should be 100K)`);

    // Get USDC balance
    const usdcCoins = await getUsdcCoins(address);
    const totalUsdc = usdcCoins.reduce((acc, c) => acc + BigInt(c.balance), 0n);
    console.log(`\nUSDC Balance: ${Number(totalUsdc) / 1e6} USDC`);

    // Check if we have a vault ID from env
    let vaultId = process.env.SUI_VAULT_ID;
    let leaderCapId = process.env.SUI_LEADER_CAP_ID;

    const command = process.argv[2];

    if (command === 'create' || (!vaultId && command !== 'status')) {
        // Create a new vault
        const result = await createVault('Test Vault V2', 'TV2', 2000); // 20% performance fee
        vaultId = result.vaultId;
        leaderCapId = result.leaderCapId;

        console.log('\n=== Update .env with: ===');
        console.log(`SUI_VAULT_ID=${vaultId}`);
        console.log(`SUI_LEADER_CAP_ID=${leaderCapId}`);
    }

    if (command === 'status' && vaultId) {
        // Show vault status
        console.log('\n=== Vault State ===');
        const vault = await getVaultState(vaultId);
        console.log(`Name: ${vault.name}`);
        console.log(`Symbol: ${vault.symbol}`);
        console.log(`Leader: ${vault.leader}`);
        console.log(`Total Supply: ${Number(vault.total_supply) / 1e6}`);
        console.log(`USDC Reserve: ${Number(vault.usdc_reserve) / 1e6}`);
        console.log(`TWAP NAV: ${Number(vault.twap_nav) / 1e6}`);
        console.log(`Virtual Base: ${Number(vault.virtual_base) / 1e6}`);
        console.log(`Virtual Tokens: ${Number(vault.virtual_tokens) / 1e6}`);
        console.log(`Initial Assets: ${Number(vault.initial_assets) / 1e6}`);
        console.log(`Performance Fee: ${vault.performance_fee_bps / 100}%`);
        console.log(`Paused: ${vault.paused}`);
        return;
    }

    if (!vaultId) {
        console.log('\nNo vault ID set. Run with "create" to create a new vault.');
        return;
    }

    if (command === 'buy') {
        // Buy tokens - default 10 USDC
        const amount = parseInt(process.argv[3]) || 10;
        await buyTokens(vaultId, amount * 1e6);

        // Show updated vault state
        console.log('\n=== Updated Vault State ===');
        const vault = await getVaultState(vaultId);
        console.log(`Total Supply: ${Number(vault.total_supply) / 1e6}`);
        console.log(`USDC Reserve: ${Number(vault.usdc_reserve) / 1e6}`);
        console.log(`TWAP NAV: ${Number(vault.twap_nav) / 1e6}`);
    }

    if (command === 'sell') {
        // Sell tokens
        const amount = parseInt(process.argv[3]);
        if (!amount) {
            console.log('Usage: node test-buy-sell.js sell <token_amount>');
            return;
        }
        await sellTokens(vaultId, amount * 1e6);

        // Show updated vault state
        console.log('\n=== Updated Vault State ===');
        const vault = await getVaultState(vaultId);
        console.log(`Total Supply: ${Number(vault.total_supply) / 1e6}`);
        console.log(`USDC Reserve: ${Number(vault.usdc_reserve) / 1e6}`);
        console.log(`TWAP NAV: ${Number(vault.twap_nav) / 1e6}`);
    }

    if (command === 'test') {
        // Full test: Create vault, Buy, then Sell
        console.log('\n=== Starting Full Test ===');

        // Create vault if not exists
        if (!vaultId) {
            const result = await createVault('Test Vault V2', 'TV2', 2000);
            vaultId = result.vaultId;
        }

        // Buy 10 USDC worth of tokens
        console.log('\n--- Step 1: Buy 10 USDC ---');
        await buyTokens(vaultId, 10 * 1e6);

        // Check vault state
        let vault = await getVaultState(vaultId);
        console.log(`\nAfter Buy - Total Supply: ${Number(vault.total_supply) / 1e6}`);
        console.log(`After Buy - USDC Reserve: ${Number(vault.usdc_reserve) / 1e6}`);
        console.log(`After Buy - TWAP NAV: ${Number(vault.twap_nav) / 1e6}`);

        // Sell half of the tokens
        const tokensToSell = Math.floor(Number(vault.total_supply) / 2);
        console.log(`\n--- Step 2: Sell ${tokensToSell / 1e6} tokens ---`);
        await sellTokens(vaultId, tokensToSell);

        // Final state
        vault = await getVaultState(vaultId);
        console.log(`\nAfter Sell - Total Supply: ${Number(vault.total_supply) / 1e6}`);
        console.log(`After Sell - USDC Reserve: ${Number(vault.usdc_reserve) / 1e6}`);
        console.log(`After Sell - TWAP NAV: ${Number(vault.twap_nav) / 1e6}`);

        console.log('\n=== Test Complete ===');
        console.log('NAV should remain stable near 1.0 with the 2M BC virtual reserves');
    }
}

// Run
main().catch(console.error);
