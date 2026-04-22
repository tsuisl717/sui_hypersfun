/**
 * Setup script for testing with DBUSDC (DeepBook testnet USDC)
 *
 * This creates a vault using DBUSDC as the base currency,
 * so the full DeepBook trading flow can be tested end-to-end.
 *
 * Steps:
 *   1. Swap SUI → DBUSDC via DeepBook (get test tokens)
 *   2. Create a new vault with DBUSDC type
 *   3. Buy VaultShares with DBUSDC
 *   4. Output env vars for frontend config
 *
 * Usage:
 *   node setup-dbusdc-test.js swap       - Swap 1 SUI for DBUSDC
 *   node setup-dbusdc-test.js create     - Create DBUSDC vault
 *   node setup-dbusdc-test.js buy        - Buy VaultShares
 *   node setup-dbusdc-test.js status     - Show balances
 *   node setup-dbusdc-test.js all        - Run full setup
 */

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');

require('dotenv').config();

// ============ Config ============

const NETWORK = process.env.SUI_NETWORK || 'testnet';
const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const FACTORY_ID = process.env.SUI_FACTORY_ID;
const ADMIN_CAP_ID = process.env.SUI_ADMIN_CAP_ID;

// DeepBook V3 Testnet (updated April 2026)
const DEEPBOOK_PKG = '0xfb28c4cbc6865bd1c897d26aecbe1f8792d1509a20ffec692c800660cbec6982';
const DBUSDC_TYPE = '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC';
const DEEP_TYPE = '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP';
const SUI_TYPE = '0x2::sui::SUI';

// Pool IDs (from frontend config)
const SUI_DBUSDC_POOL = '0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5';

const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

function getKeypair() {
    const { secretKey } = decodeSuiPrivateKey(process.env.SUI_PRIVATE_KEY);
    return Ed25519Keypair.fromSecretKey(secretKey);
}

function getAddress() {
    return getKeypair().getPublicKey().toSuiAddress();
}

// ============ Show Status ============

async function showStatus() {
    const address = getAddress();
    console.log(`\n=== Wallet: ${address} ===\n`);

    // SUI
    const sui = await client.getBalance({ owner: address });
    console.log(`SUI:    ${(Number(sui.totalBalance) / 1e9).toFixed(4)}`);

    // DBUSDC
    try {
        const dbusdc = await client.getBalance({ owner: address, coinType: DBUSDC_TYPE });
        console.log(`DBUSDC: ${(Number(dbusdc.totalBalance) / 1e6).toFixed(2)}`);
    } catch {
        console.log('DBUSDC: 0.00');
    }

    // DEEP
    try {
        const deep = await client.getBalance({ owner: address, coinType: DEEP_TYPE });
        console.log(`DEEP:   ${(Number(deep.totalBalance) / 1e6).toFixed(2)}`);
    } catch {
        console.log('DEEP:   0.00');
    }

    // DBUSDC vault ID from env
    const vaultId = process.env.SUI_DBUSDC_VAULT_ID;
    if (vaultId) {
        try {
            const obj = await client.getObject({ id: vaultId, options: { showContent: true } });
            if (obj.data?.content?.fields) {
                const fields = obj.data.content.fields;
                const reserve = typeof fields.usdc_reserve === 'object'
                    ? Number(fields.usdc_reserve?.fields?.value || 0)
                    : Number(fields.usdc_reserve || 0);
                console.log(`\n--- DBUSDC Vault: ${vaultId.slice(0, 12)}... ---`);
                console.log(`Reserve:      ${(reserve / 1e6).toFixed(2)} DBUSDC`);
                console.log(`Total Supply: ${(Number(fields.total_supply || 0) / 1e6).toFixed(6)}`);
                console.log(`Leader:       ${fields.leader}`);
            }
        } catch (e) {
            console.log(`\nVault ${vaultId.slice(0, 12)}... not found`);
        }
    }

    console.log(`\n--- Config ---`);
    console.log(`Package: ${PACKAGE_ID}`);
    console.log(`Factory: ${FACTORY_ID}`);
    console.log(`DBUSDC type: ${DBUSDC_TYPE}`);
}

// ============ Step 1: Swap SUI → DBUSDC ============

async function swapSuiForDbusdc(suiAmount = 1) {
    console.log(`\n=== Swapping ${suiAmount} SUI → DBUSDC via DeepBook ===\n`);

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();
    const amountInMist = BigInt(Math.floor(suiAmount * 1e9));

    const tx = new Transaction();
    tx.setSender(sender);

    // Split SUI from gas
    const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountInMist)]);

    // Create zero DEEP coin (fee token - may be zero if pool allows)
    const [deepCoin] = tx.moveCall({
        target: '0x2::coin::zero',
        typeArguments: [DEEP_TYPE],
    });

    // DeepBook swap: SUI (base) → DBUSDC (quote)
    // swap_exact_base_for_quote returns (Coin<Base>, Coin<Quote>, Coin<DEEP>)
    const [baseOut, quoteOut, deepOut] = tx.moveCall({
        target: `${DEEPBOOK_PKG}::pool::swap_exact_base_for_quote`,
        typeArguments: [SUI_TYPE, DBUSDC_TYPE],
        arguments: [
            tx.object(SUI_DBUSDC_POOL),
            suiCoin,
            deepCoin,
            tx.pure.u64(0), // min_quote_out (0 for testing)
            tx.object('0x6'), // Clock
        ],
    });

    // Transfer outputs to sender
    tx.transferObjects([baseOut, quoteOut, deepOut], sender);

    try {
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: { showEffects: true, showEvents: true, showBalanceChanges: true },
        });

        console.log('TX:', result.digest);
        console.log('Status:', result.effects?.status?.status);

        // Show balance changes
        if (result.balanceChanges) {
            console.log('\nBalance changes:');
            for (const change of result.balanceChanges) {
                const type = change.coinType.split('::').pop();
                const amount = Number(change.amount);
                const decimals = change.coinType.includes('sui::SUI') ? 9 : 6;
                console.log(`  ${type}: ${amount > 0 ? '+' : ''}${(amount / Math.pow(10, decimals)).toFixed(decimals === 9 ? 4 : 2)}`);
            }
        }

        return result;
    } catch (e) {
        console.error('Swap failed:', e.message);

        // If the pool doesn't work, try minting DBUSDC directly
        console.log('\nSwap failed. Trying to mint DBUSDC from faucet...');
        return await tryMintDbusdc(sender, keypair);
    }
}

// Try to mint DBUSDC from DeepBook testnet faucet
async function tryMintDbusdc(sender, keypair) {
    const tx = new Transaction();
    tx.setSender(sender);

    // DeepBook testnet typically has a mint function
    // Try: dbusdc::mint or dbusdc::faucet
    const DBUSDC_PKG = '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7';

    try {
        tx.moveCall({
            target: `${DBUSDC_PKG}::dbusdc::mint`,
            arguments: [
                tx.pure.u64(100_000_000), // 100 DBUSDC
            ],
        });

        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: { showEffects: true },
        });
        console.log('Mint TX:', result.digest);
        return result;
    } catch (e) {
        console.log('Mint also failed:', e.message);
        console.log('\nYou may need to get DBUSDC from:');
        console.log('  1. DeepBook testnet faucet (if available)');
        console.log('  2. Ask in Sui Discord for testnet tokens');
        console.log('  3. Try a different SUI amount for the swap');
        return null;
    }
}

// ============ Step 2: Create DBUSDC Vault ============

async function createDbUsdcVault() {
    console.log('\n=== Creating DBUSDC Vault ===\n');

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    const tx = new Transaction();
    tx.setSender(sender);

    tx.moveCall({
        target: `${PACKAGE_ID}::sui_vault::create_vault`,
        typeArguments: [DBUSDC_TYPE],
        arguments: [
            tx.object(FACTORY_ID),
            tx.pure.string('DBUSDC Test Fund'),
            tx.pure.string('DTFUND'),
            tx.pure.u64(1000), // 10% performance fee
            tx.object('0x6'), // Clock
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true, showObjectChanges: true },
    });

    console.log('TX:', result.digest);
    console.log('Status:', result.effects?.status?.status);

    let vaultId = null;
    let leaderCapId = null;

    for (const change of result.objectChanges || []) {
        if (change.type === 'created') {
            if (change.objectType?.includes('SuiVault')) {
                vaultId = change.objectId;
                console.log('Vault ID:', vaultId);
            }
            if (change.objectType?.includes('SuiLeaderCap')) {
                leaderCapId = change.objectId;
                console.log('LeaderCap ID:', leaderCapId);
            }
        }
    }

    if (vaultId) {
        console.log('\n=== Add to .env ===');
        console.log(`SUI_DBUSDC_VAULT_ID=${vaultId}`);
        console.log(`SUI_DBUSDC_LEADER_CAP_ID=${leaderCapId}`);

        console.log('\n=== Add to frontend/.env.local ===');
        console.log(`NEXT_PUBLIC_USDC_TYPE=${DBUSDC_TYPE}`);
        console.log(`NEXT_PUBLIC_TEST_VAULT_ID=${vaultId}`);
    }

    return { vaultId, leaderCapId };
}

// ============ Step 3: Buy VaultShares ============

async function buyVaultShares(vaultId, amount = 5) {
    console.log(`\n=== Buying VaultShares with ${amount} DBUSDC ===\n`);

    if (!vaultId) {
        vaultId = process.env.SUI_DBUSDC_VAULT_ID;
    }
    if (!vaultId) {
        console.log('No vault ID. Run "create" first.');
        return;
    }

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    // Get DBUSDC coins
    const coins = await client.getCoins({ owner: sender, coinType: DBUSDC_TYPE });
    if (coins.data.length === 0) {
        console.log('No DBUSDC. Run "swap" first.');
        return;
    }

    const totalBalance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
    const buyAmount = BigInt(Math.floor(amount * 1e6));
    console.log(`DBUSDC balance: ${(Number(totalBalance) / 1e6).toFixed(2)}`);

    if (totalBalance < buyAmount) {
        console.log(`Insufficient DBUSDC. Need ${amount}, have ${(Number(totalBalance) / 1e6).toFixed(2)}`);
        return;
    }

    const tx = new Transaction();
    tx.setSender(sender);

    // Merge and split coins
    const [primaryCoin, ...otherCoins] = coins.data;
    if (otherCoins.length > 0) {
        tx.mergeCoins(
            tx.object(primaryCoin.coinObjectId),
            otherCoins.map(c => tx.object(c.coinObjectId)),
        );
    }
    const [paymentCoin] = tx.splitCoins(tx.object(primaryCoin.coinObjectId), [tx.pure.u64(buyAmount)]);

    tx.moveCall({
        target: `${PACKAGE_ID}::sui_vault::buy`,
        typeArguments: [DBUSDC_TYPE],
        arguments: [
            tx.object(vaultId),
            tx.object(FACTORY_ID),
            paymentCoin,
            tx.pure.u64(0), // min_tokens_out
            tx.object('0x6'), // Clock
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true },
    });

    console.log('TX:', result.digest);
    console.log('Status:', result.effects?.status?.status);

    for (const event of result.events || []) {
        const data = event.parsedJson;
        const type = event.type.split('::').pop();
        console.log(`\nEvent: ${type}`);
        if (data?.tokens_out) console.log(`  Tokens bought: ${(Number(data.tokens_out) / 1e6).toFixed(6)}`);
        if (data?.usdc_in) console.log(`  DBUSDC spent: ${(Number(data.usdc_in) / 1e6).toFixed(2)}`);
        if (data?.price) console.log(`  Price: ${(Number(data.price) / 1e6).toFixed(6)}`);
        if (data?.nav) console.log(`  NAV: ${(Number(data.nav) / 1e6).toFixed(6)}`);
    }

    return result;
}

// ============ Full Setup ============

async function fullSetup() {
    console.log('╔══════════════════════════════════════╗');
    console.log('║  DBUSDC End-to-End Test Setup        ║');
    console.log('╚══════════════════════════════════════╝');

    await showStatus();

    // Step 1: Get DBUSDC
    console.log('\n--- Step 1: Get DBUSDC ---');
    const address = getAddress();
    let dbBalance;
    try {
        dbBalance = await client.getBalance({ owner: address, coinType: DBUSDC_TYPE });
    } catch {
        dbBalance = { totalBalance: '0' };
    }

    if (Number(dbBalance.totalBalance) < 10_000_000) { // Less than 10 DBUSDC
        console.log('Low DBUSDC balance. Swapping 2 SUI → DBUSDC...');
        await swapSuiForDbusdc(2);
    } else {
        console.log(`DBUSDC balance OK: ${(Number(dbBalance.totalBalance) / 1e6).toFixed(2)}`);
    }

    // Step 2: Create vault
    console.log('\n--- Step 2: Create DBUSDC Vault ---');
    let vaultId = process.env.SUI_DBUSDC_VAULT_ID;
    if (!vaultId) {
        const result = await createDbUsdcVault();
        vaultId = result.vaultId;
    } else {
        console.log(`Vault already exists: ${vaultId.slice(0, 12)}...`);
    }

    // Step 3: Buy VaultShares
    if (vaultId) {
        console.log('\n--- Step 3: Buy VaultShares ---');
        await buyVaultShares(vaultId, 5);
    }

    // Final status
    await showStatus();

    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  Setup Complete!                     ║');
    console.log('╠══════════════════════════════════════╣');
    console.log('║  Next steps:                         ║');
    console.log('║  1. Update .env with vault IDs       ║');
    console.log('║  2. Update frontend/.env.local       ║');
    console.log('║  3. Run: cd frontend && npm run dev   ║');
    console.log('║  4. Connect wallet & test trading    ║');
    console.log('╚══════════════════════════════════════╝');
}

// ============ Main ============

async function main() {
    const command = process.argv[2];

    if (!PACKAGE_ID || !FACTORY_ID) {
        console.error('Missing env vars. Set SUI_PACKAGE_ID and SUI_FACTORY_ID in .env');
        process.exit(1);
    }

    switch (command) {
        case 'status':
            await showStatus();
            break;
        case 'swap':
            const amount = parseFloat(process.argv[3]) || 1;
            await swapSuiForDbusdc(amount);
            break;
        case 'create':
            await createDbUsdcVault();
            break;
        case 'buy':
            const buyAmt = parseFloat(process.argv[3]) || 5;
            await buyVaultShares(null, buyAmt);
            break;
        case 'all':
            await fullSetup();
            break;
        default:
            console.log('DBUSDC Test Setup');
            console.log('=================');
            console.log('');
            console.log('Usage:');
            console.log('  node setup-dbusdc-test.js status    - Show wallet & vault status');
            console.log('  node setup-dbusdc-test.js swap [n]  - Swap n SUI for DBUSDC (default: 1)');
            console.log('  node setup-dbusdc-test.js create    - Create DBUSDC vault');
            console.log('  node setup-dbusdc-test.js buy [n]   - Buy n DBUSDC of VaultShares (default: 5)');
            console.log('  node setup-dbusdc-test.js all       - Run full setup');
            console.log('');
            console.log('Config:');
            console.log(`  Package:    ${PACKAGE_ID}`);
            console.log(`  Factory:    ${FACTORY_ID}`);
            console.log(`  DBUSDC:     ${DBUSDC_TYPE}`);
            console.log(`  Pool:       ${SUI_DBUSDC_POOL}`);
            break;
    }
}

main().catch(console.error);
