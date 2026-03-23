/**
 * DeepBook V3 Direct Swap Test
 *
 * This script tests swapping SUI for DBUSDC on DeepBook V3 testnet.
 * It demonstrates how the HypersFun Trading module would integrate with DeepBook.
 */

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');

require('dotenv').config();

const NETWORK = 'testnet';
const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// DeepBook V3 Testnet Constants
const DEEPBOOK = {
    PACKAGE_ID: '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c',
    REGISTRY_ID: '0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1',
    // Pool objects (need to query these)
    POOLS: {
        SUI_DBUSDC: null, // Will be queried
        DEEP_SUI: null,
    },
    // Coin types
    COINS: {
        SUI: '0x2::sui::SUI',
        DBUSDC: '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c::dbusdc::DBUSDC',
        DEEP: '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c::deep::DEEP',
    }
};

function getKeypair() {
    const privateKey = process.env.SUI_PRIVATE_KEY;
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
}

function getAddress() {
    return getKeypair().getPublicKey().toSuiAddress();
}

// Query DeepBook pools from registry
async function queryDeepBookPools() {
    console.log('\n=== Querying DeepBook V3 Pools ===');

    try {
        // Get registry object
        const registry = await client.getObject({
            id: DEEPBOOK.REGISTRY_ID,
            options: { showContent: true }
        });

        if (registry.error) {
            console.log('Registry error:', registry.error);
            return;
        }

        console.log('Registry found:', DEEPBOOK.REGISTRY_ID);

        // Query dynamic fields to find pools
        const fields = await client.getDynamicFields({
            parentId: DEEPBOOK.REGISTRY_ID,
        });

        console.log(`Found ${fields.data.length} dynamic fields`);

        for (const field of fields.data) {
            console.log(`  Field: ${field.name.value} -> ${field.objectId}`);
        }

    } catch (e) {
        console.log('Error querying pools:', e.message);
    }
}

// Get pool state
async function getPoolInfo(poolId) {
    try {
        const pool = await client.getObject({
            id: poolId,
            options: { showContent: true, showType: true }
        });

        if (pool.error) {
            return null;
        }

        return pool.data;
    } catch (e) {
        return null;
    }
}

// Get coin balances
async function getBalances(address) {
    console.log('\n=== Wallet Balances ===');

    // SUI
    const sui = await client.getBalance({ owner: address });
    console.log(`SUI: ${Number(sui.totalBalance) / 1e9}`);

    // DBUSDC
    try {
        const dbusdc = await client.getBalance({
            owner: address,
            coinType: DEEPBOOK.COINS.DBUSDC
        });
        console.log(`DBUSDC: ${Number(dbusdc.totalBalance) / 1e6}`);
    } catch (e) {
        console.log('DBUSDC: 0 (not found)');
    }

    // DEEP
    try {
        const deep = await client.getBalance({
            owner: address,
            coinType: DEEPBOOK.COINS.DEEP
        });
        console.log(`DEEP: ${Number(deep.totalBalance) / 1e6}`);
    } catch (e) {
        console.log('DEEP: 0 (not found)');
    }
}

// Attempt to swap SUI for DBUSDC using DeepBook V3
async function swapSuiForDbusdc(suiAmount) {
    console.log(`\n=== Swapping ${suiAmount} SUI for DBUSDC ===`);

    const keypair = getKeypair();
    const sender = keypair.getPublicKey().toSuiAddress();

    const tx = new Transaction();
    tx.setSender(sender);

    // Split SUI for swap
    const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(suiAmount * 1e9)]);

    // Note: DeepBook V3 swap requires:
    // 1. Pool object
    // 2. Input coin
    // 3. Amount
    // 4. min_out (slippage protection)

    // The actual swap call would be:
    // deepbook::swap_exact_base_for_quote<SUI, DBUSDC>(pool, sui_coin, min_out)

    // For now, let's try to find the pool and see the structure
    console.log('DeepBook swap requires finding the correct pool object.');
    console.log('The SDK handles this automatically via pool keys like "SUI_DBUSDC".');
    console.log('\nTo use DeepBook SDK:');
    console.log('  npm install @mysten/deepbook-v3');
    console.log('');
    console.log('Example code:');
    console.log(`
const { deepbook } = require('@mysten/deepbook-v3');

const client = new SuiGrpcClient({
    network: 'testnet',
    baseUrl: 'https://fullnode.testnet.sui.io:443',
}).$extend(deepbook({ address: sender }));

// Swap SUI for DBUSDC
const tx = new Transaction();
const [baseOut, quoteOut, deepOut] = client.deepBook.swapExactBaseForQuote({
    poolKey: 'SUI_DBUSDC',
    amount: ${suiAmount},
    deepAmount: 0.1, // DEEP fee
    minOut: 0,
})(tx);
tx.transferObjects([baseOut, quoteOut, deepOut], sender);
`);
}

// Show integration guide
async function showIntegrationGuide() {
    console.log('\n========================================');
    console.log('HypersFun Trading ↔ DeepBook 整合指南');
    console.log('========================================');

    console.log(`
【當前狀態】
✅ Trading Module 合約已部署
✅ TradingVault 可以存入 USDC
✅ Leader 可以授權交易 (TradeAuthorization)
⚠️ DeepBook 使用 DBUSDC，不是我們的 testnet USDC

【整合方案】

方案 A: 使用 DeepBook 的 DBUSDC
- 在 DeepBook 上交易 SUI ↔ DBUSDC
- 需要先獲取 DBUSDC (swap SUI 或 faucet)
- 優點: 直接使用 DeepBook 流動性
- 缺點: 需要額外的代幣轉換步驟

方案 B: 使用 Cetus 或其他 DEX
- Cetus 支援更多代幣對
- 可以交易自定義 USDC
- 優點: 更靈活的代幣支援
- 缺點: 需要整合不同協議

方案 C: 部署自己的流動池
- 在 DeepBook 上創建 SUI/OUR_USDC 池
- 需要提供初始流動性
- 優點: 完全控制
- 缺點: 需要資金和維護

【PTB 整合流程】
1. Leader 調用 authorize_trade() 獲取 TradeAuthorization
2. 在 PTB 中:
   a. consume_authorization_for_trade() 取得資金
   b. 調用 DeepBook swap
   c. return_trade_output() 返回結果
3. 所有操作在一個交易中完成

【下一步】
1. 安裝 DeepBook SDK: npm install @mysten/deepbook-v3
2. 測試 SUI → DBUSDC swap
3. 或整合 Cetus 等其他 DEX
`);
}

// Main
async function main() {
    const command = process.argv[2];
    const address = getAddress();

    console.log('=== DeepBook V3 Testnet Test ===');
    console.log(`Wallet: ${address}`);

    await getBalances(address);

    if (command === 'pools') {
        await queryDeepBookPools();
    } else if (command === 'swap') {
        const amount = parseFloat(process.argv[3]) || 0.1;
        await swapSuiForDbusdc(amount);
    } else if (command === 'guide') {
        await showIntegrationGuide();
    } else {
        console.log('\nUsage:');
        console.log('  node test-deepbook-swap.js pools   - Query DeepBook pools');
        console.log('  node test-deepbook-swap.js swap 0.1 - Attempt swap 0.1 SUI');
        console.log('  node test-deepbook-swap.js guide   - Show integration guide');
    }
}

main().catch(console.error);
