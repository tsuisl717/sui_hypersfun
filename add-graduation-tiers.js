/**
 * Add Graduation Tiers to Factory
 * Matches the original EVM HypersFun design
 *
 * Graduation Tiers adjust BC Virtual as vault grows:
 * - Higher tiers = lower BC virtual = more price impact per trade
 * - This creates better price discovery as vault matures
 */

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');

require('dotenv').config();

const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const FACTORY_ID = process.env.SUI_FACTORY_ID;
const ADMIN_CAP_ID = process.env.SUI_ADMIN_CAP_ID;
const NETWORK = process.env.SUI_NETWORK || 'testnet';

const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

function getKeypair() {
    const privateKey = process.env.SUI_PRIVATE_KEY;
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
}

/**
 * Original EVM Graduation Tiers Configuration
 * All values in 6-decimal precision
 *
 * threshold: Total assets required to reach this tier (USDC, 6 decimals)
 * bc_virtual: Bonding curve virtual reserves at this tier (6 decimals)
 * nav_min_mul_bps: Minimum NAV multiplier (basis points, 10000 = 100%)
 * nav_max_mul_bps: Maximum NAV multiplier (basis points)
 * squared_ratio_bps: How much to use squared growth (basis points)
 */
const GRADUATION_TIERS = [
    // Tier 0: $0 - $100K (startup phase)
    {
        threshold: 0,                          // $0
        bc_virtual: 2_000_000_000_000,         // 2M (same as default)
        nav_min_mul_bps: 10000,                // 100%
        nav_max_mul_bps: 10000,                // 100%
        squared_ratio_bps: 0,                  // 0%
    },
    // Tier 1: $100K - $500K
    {
        threshold: 100_000_000_000,            // $100K (6 decimals)
        bc_virtual: 1_000_000_000_000,         // 1M - reduced for more price impact
        nav_min_mul_bps: 9000,                 // 90%
        nav_max_mul_bps: 11000,                // 110%
        squared_ratio_bps: 1000,               // 10%
    },
    // Tier 2: $500K - $1M
    {
        threshold: 500_000_000_000,            // $500K
        bc_virtual: 500_000_000_000,           // 500K
        nav_min_mul_bps: 8000,                 // 80%
        nav_max_mul_bps: 12000,                // 120%
        squared_ratio_bps: 2000,               // 20%
    },
    // Tier 3: $1M - $5M
    {
        threshold: 1_000_000_000_000,          // $1M
        bc_virtual: 250_000_000_000,           // 250K
        nav_min_mul_bps: 7000,                 // 70%
        nav_max_mul_bps: 13000,                // 130%
        squared_ratio_bps: 3000,               // 30%
    },
    // Tier 4: $5M+ (mature vault)
    {
        threshold: 5_000_000_000_000,          // $5M
        bc_virtual: 100_000_000_000,           // 100K - high price discovery
        nav_min_mul_bps: 6000,                 // 60%
        nav_max_mul_bps: 15000,                // 150%
        squared_ratio_bps: 5000,               // 50%
    },
];

async function addGraduationTiers() {
    console.log('=== Adding Graduation Tiers ===');
    console.log(`Package: ${PACKAGE_ID}`);
    console.log(`Factory: ${FACTORY_ID}`);
    console.log(`Admin Cap: ${ADMIN_CAP_ID}`);

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();
    console.log(`Sender: ${sender}`);

    // Create single transaction with all operations
    const tx = new Transaction();
    tx.setSender(sender);

    // First, clear existing tiers
    console.log('\n--- Adding operations to transaction ---');
    console.log('1. Clear existing tiers');
    tx.moveCall({
        target: `${PACKAGE_ID}::sui_factory::clear_graduation_tiers`,
        arguments: [
            tx.object(ADMIN_CAP_ID),
            tx.object(FACTORY_ID),
        ],
    });

    // Add each tier
    for (let i = 0; i < GRADUATION_TIERS.length; i++) {
        const tier = GRADUATION_TIERS[i];
        console.log(`2. Add Tier ${i}: $${tier.threshold / 1e6} threshold, ${tier.bc_virtual / 1e6} BC virtual`);

        tx.moveCall({
            target: `${PACKAGE_ID}::sui_factory::add_graduation_tier`,
            arguments: [
                tx.object(ADMIN_CAP_ID),
                tx.object(FACTORY_ID),
                tx.pure.u64(tier.threshold),
                tx.pure.u64(tier.bc_virtual),
                tx.pure.u64(tier.nav_min_mul_bps),
                tx.pure.u64(tier.nav_max_mul_bps),
                tx.pure.u64(tier.squared_ratio_bps),
            ],
        });
    }

    // Execute single transaction
    console.log('\n--- Executing transaction ---');
    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true }
    });
    console.log(`TX: ${result.digest}`);

    // Show events
    let tierCount = 0;
    for (const event of result.events || []) {
        if (event.type.includes('GraduationTierAdded')) {
            tierCount++;
        }
    }
    console.log(`Events: ${tierCount} tiers added`);

    console.log('\n=== All Graduation Tiers Added ===');

    // Verify
    console.log('\n--- Verifying Factory State ---');
    const factory = await client.getObject({
        id: FACTORY_ID,
        options: { showContent: true }
    });
    const fields = factory.data.content.fields;
    console.log(`Total Tiers: ${fields.graduation_tiers?.length || 0}`);
}

async function showTiers() {
    console.log('=== Current Graduation Tiers ===');
    const factory = await client.getObject({
        id: FACTORY_ID,
        options: { showContent: true }
    });
    const fields = factory.data.content.fields;
    const tiers = fields.graduation_tiers || [];

    console.log(`Total Tiers: ${tiers.length}`);
    for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i].fields;
        console.log(`\nTier ${i}:`);
        console.log(`  Threshold: $${Number(tier.threshold) / 1e6}`);
        console.log(`  BC Virtual: ${Number(tier.bc_virtual) / 1e6}`);
        console.log(`  NAV Range: ${Number(tier.nav_min_mul_bps) / 100}% - ${Number(tier.nav_max_mul_bps) / 100}%`);
        console.log(`  Squared Ratio: ${Number(tier.squared_ratio_bps) / 100}%`);
    }
}

const command = process.argv[2];
if (command === 'add') {
    addGraduationTiers().catch(console.error);
} else if (command === 'show') {
    showTiers().catch(console.error);
} else {
    console.log('Usage:');
    console.log('  node add-graduation-tiers.js add   - Add graduation tiers');
    console.log('  node add-graduation-tiers.js show  - Show current tiers');
}
