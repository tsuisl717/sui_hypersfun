/**
 * Test sell_shares with VaultShare
 */
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
require('dotenv').config();

const client = new SuiClient({ url: getFullnodeUrl('testnet') });

async function main() {
    const privateKey = process.env.SUI_PRIVATE_KEY;
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    const sender = keypair.getPublicKey().toSuiAddress();

    const packageId = process.env.SUI_PACKAGE_ID;
    const vaultId = process.env.SUI_VAULT_ID;
    const factoryId = process.env.SUI_FACTORY_ID;
    const usdcType = process.env.SUI_USDC_TYPE;

    // Find VaultShare objects
    const objects = await client.getOwnedObjects({
        owner: sender,
        filter: { StructType: `${packageId}::sui_vault::VaultShare` },
        options: { showContent: true, showType: true }
    });

    if (objects.data.length === 0) {
        console.log('No VaultShare objects found');
        return;
    }

    // Use first VaultShare
    const vaultShare = objects.data[0];
    const vaultShareId = vaultShare.data.objectId;
    const fields = vaultShare.data.content.fields;

    console.log('=== Selling VaultShare ===');
    console.log('VaultShare ID:', vaultShareId);
    console.log('Amount:', Number(fields.amount) / 1e6);
    console.log('Entry NAV:', Number(fields.entry_nav) / 1e6);

    const tx = new Transaction();
    tx.setSender(sender);

    // Call sell_shares
    tx.moveCall({
        target: `${packageId}::sui_vault::sell_shares`,
        typeArguments: [usdcType],
        arguments: [
            tx.object(vaultId),
            tx.object(factoryId),
            tx.object(vaultShareId),
            tx.pure.u64(0), // min_usdc_out
            tx.object('0x6'), // Clock
        ],
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true }
    });

    console.log('\nTX:', result.digest);
    console.log('Status:', result.effects.status.status);

    // Parse events
    for (const event of result.events || []) {
        const typeName = event.type.split('::').pop();
        console.log('\nEvent:', typeName);
        const data = event.parsedJson;
        if (data.tokens_in) console.log('  Tokens sold:', Number(data.tokens_in) / 1e6);
        if (data.usdc_out !== undefined) console.log('  USDC received:', Number(data.usdc_out) / 1e6);
        if (data.exit_fee !== undefined) console.log('  Exit Fee:', Number(data.exit_fee) / 1e6);
        if (data.performance_fee_tokens !== undefined) console.log('  Perf Fee (tokens):', Number(data.performance_fee_tokens) / 1e6);
        if (data.instant_nav !== undefined) console.log('  Instant NAV:', Number(data.instant_nav) / 1e6);
        if (data.twap_nav !== undefined) console.log('  TWAP NAV:', Number(data.twap_nav) / 1e6);
    }

    // Check remaining VaultShare objects
    const remaining = await client.getOwnedObjects({
        owner: sender,
        filter: { StructType: `${packageId}::sui_vault::VaultShare` },
        options: { showContent: true }
    });
    console.log('\nRemaining VaultShares:', remaining.data.length);
}

main().catch(console.error);
