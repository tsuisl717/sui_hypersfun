/**
 * End-to-End Test Script for SUI HypersFun
 * Tests the complete flow including new modules (margin, seal, deepbook single-PTB)
 *
 * Prerequisites:
 *   - .env with SUI_PRIVATE_KEY, SUI_PACKAGE_ID, SUI_FACTORY_ID, etc.
 *   - Contract deployed to testnet (including sui_margin and sui_seal modules)
 *
 * Usage:
 *   node test-e2e.js status          - Show wallet + vault balances
 *   node test-e2e.js deploy          - Publish contracts to testnet
 *   node test-e2e.js create-vault    - Create a DBUSDC vault
 *   node test-e2e.js buy             - Buy vault shares
 *   node test-e2e.js sell            - Sell vault shares
 *   node test-e2e.js create-asset    - Create asset vault for SUI
 *   node test-e2e.js spot-swap       - Test single-PTB DeepBook swap (authorize+consume+swap)
 *   node test-e2e.js create-margin   - Create margin account
 *   node test-e2e.js seal-intent     - Create sealed trade intent
 *   node test-e2e.js full            - Run all tests sequentially
 */

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
const { execSync } = require('child_process');

require('dotenv').config();

// ============ Config ============

const NETWORK = process.env.SUI_NETWORK || 'testnet';
const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// Will be set after deploy or from .env
let PACKAGE_ID = process.env.SUI_PACKAGE_ID;
let FACTORY_ID = process.env.SUI_FACTORY_ID;
let ADMIN_CAP_ID = process.env.SUI_ADMIN_CAP_ID;
let TEST_VAULT_ID = process.env.SUI_VAULT_ID || process.env.SUI_DBUSDC_VAULT_ID || process.env.SUI_TEST_VAULT_ID;
let LEADER_CAP_ID = process.env.SUI_LEADER_CAP_ID;

// DeepBook V3 Testnet
const DEEPBOOK_PKG = '0xfb28c4cbc6865bd1c897d26aecbe1f8792d1509a20ffec692c800660cbec6982';
const DBUSDC_TYPE = '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC';
const SUI_TYPE = '0x2::sui::SUI';
const SUI_DBUSDC_POOL = '0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5';

const SUI_CLI = '/c/Users/user/Documents/SUI_HyperFun/HyperVapor-AI/sui.exe';

function getKeypair() {
  const { secretKey } = decodeSuiPrivateKey(process.env.SUI_PRIVATE_KEY);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

function getAddress() {
  return getKeypair().getPublicKey().toSuiAddress();
}

async function signAndExecute(tx) {
  const keypair = getKeypair();
  tx.setSender(getAddress());
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showObjectChanges: true, showEvents: true, showEffects: true },
  });

  if (result.effects?.status?.status === 'failure') {
    console.error('TX FAILED:', result.effects.status.error);
    throw new Error(`Transaction failed: ${result.effects.status.error}`);
  }

  return result;
}

function log(label, value) {
  console.log(`  ${label.padEnd(20)} ${value}`);
}

// ============ Tests ============

async function testStatus() {
  console.log('\n=== STATUS ===\n');
  const address = getAddress();
  log('Wallet', address);
  log('Network', NETWORK);
  log('Package ID', PACKAGE_ID || 'NOT SET');
  log('Factory ID', FACTORY_ID || 'NOT SET');
  log('Test Vault', TEST_VAULT_ID || 'NOT SET');
  log('Leader Cap', LEADER_CAP_ID || 'NOT SET');

  // Balances
  const sui = await client.getBalance({ owner: address });
  log('SUI Balance', `${(Number(sui.totalBalance) / 1e9).toFixed(4)} SUI`);

  try {
    const dbusdc = await client.getBalance({ owner: address, coinType: DBUSDC_TYPE });
    log('DBUSDC Balance', `${(Number(dbusdc.totalBalance) / 1e6).toFixed(2)} DBUSDC`);
  } catch {
    log('DBUSDC Balance', '0.00');
  }

  // Vault info
  if (TEST_VAULT_ID) {
    try {
      const obj = await client.getObject({ id: TEST_VAULT_ID, options: { showContent: true } });
      if (obj.data?.content?.dataType === 'moveObject') {
        const fields = obj.data.content.fields;
        log('Vault Name', fields.name || 'N/A');
        log('Vault Supply', fields.total_supply || '0');
        log('Vault Reserve', `${(Number(fields.usdc_reserve?.fields?.value || 0) / 1e6).toFixed(2)} USDC`);
      }
    } catch (e) {
      log('Vault Status', `Error: ${e.message}`);
    }
  }

  console.log('\n  PASS: Status check complete\n');
}

async function testDeploy() {
  console.log('\n=== DEPLOY TO TESTNET ===\n');

  try {
    const output = execSync(
      `"${SUI_CLI}" client publish --gas-budget 500000000 --json`,
      { cwd: process.cwd(), encoding: 'utf8', timeout: 120000 }
    );

    const result = JSON.parse(output);

    if (result.effects?.status?.status === 'failure') {
      throw new Error(result.effects.status.error);
    }

    // Extract created objects
    for (const change of result.objectChanges || []) {
      if (change.type === 'published') {
        PACKAGE_ID = change.packageId;
        log('Package ID', PACKAGE_ID);
      }
      if (change.type === 'created') {
        if (change.objectType?.includes('SuiFactory')) {
          FACTORY_ID = change.objectId;
          log('Factory ID', FACTORY_ID);
        }
        if (change.objectType?.includes('SuiAdminCap')) {
          ADMIN_CAP_ID = change.objectId;
          log('Admin Cap', ADMIN_CAP_ID);
        }
        if (change.objectType?.includes('UpgradeCap')) {
          log('Upgrade Cap', change.objectId);
        }
      }
    }

    console.log('\n  PASS: Deployed successfully\n');
    console.log('  Update your .env with these values!');
  } catch (e) {
    console.error('  FAIL: Deploy failed -', e.message);
  }
}

async function testCreateVault() {
  console.log('\n=== CREATE VAULT ===\n');
  if (!PACKAGE_ID || !FACTORY_ID) {
    console.log('  SKIP: Package or Factory ID not set');
    return;
  }

  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::sui_vault::create_vault`,
    typeArguments: [DBUSDC_TYPE],
    arguments: [
      tx.object(FACTORY_ID),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode('E2E Test Vault'))),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode('E2EV'))),
      tx.pure.u64(1000),  // 10% performance fee
      tx.object('0x6'),    // Clock
    ],
  });

  const result = await signAndExecute(tx);

  for (const change of result.objectChanges || []) {
    if (change.type === 'created') {
      if (change.objectType?.includes('SuiVault')) {
        TEST_VAULT_ID = change.objectId;
        log('Vault ID', TEST_VAULT_ID);
      }
      if (change.objectType?.includes('SuiLeaderCap')) {
        LEADER_CAP_ID = change.objectId;
        log('Leader Cap', LEADER_CAP_ID);
      }
    }
  }

  console.log('\n  PASS: Vault created\n');
}

async function testBuyShares() {
  console.log('\n=== BUY VAULT SHARES ===\n');
  if (!TEST_VAULT_ID) { console.log('  SKIP: No vault'); return; }

  const address = getAddress();
  const coins = await client.getCoins({ owner: address, coinType: DBUSDC_TYPE });
  if (coins.data.length === 0) {
    console.log('  SKIP: No DBUSDC balance. Run `node setup-dbusdc-test.js swap` first');
    return;
  }

  const tx = new Transaction();
  const buyAmount = 10_000_000; // 10 DBUSDC

  // Merge coins if needed
  const [primaryCoin, ...otherCoins] = coins.data;
  if (otherCoins.length > 0) {
    tx.mergeCoins(
      tx.object(primaryCoin.coinObjectId),
      otherCoins.map(c => tx.object(c.coinObjectId))
    );
  }
  const [buyCoin] = tx.splitCoins(tx.object(primaryCoin.coinObjectId), [buyAmount]);

  tx.moveCall({
    target: `${PACKAGE_ID}::sui_vault::buy`,
    typeArguments: [DBUSDC_TYPE],
    arguments: [
      tx.object(TEST_VAULT_ID),
      tx.object(FACTORY_ID),
      buyCoin,
      tx.pure.u64(0), // min_tokens
      tx.object('0x6'),
    ],
  });

  const result = await signAndExecute(tx);

  for (const event of result.events || []) {
    if (event.type?.includes('TokenBought')) {
      const data = event.parsedJson;
      log('USDC Paid', `${(Number(data.usdc_amount) / 1e6).toFixed(2)}`);
      log('Tokens Received', `${Number(data.token_amount)}`);
      log('Price', `$${(Number(data.nav) / 1e6).toFixed(6)}`);
    }
  }

  console.log('\n  PASS: Shares bought\n');
}

async function testCreateAssetVault() {
  console.log('\n=== CREATE ASSET VAULT (SUI) ===\n');
  if (!TEST_VAULT_ID || !LEADER_CAP_ID) { console.log('  SKIP: No vault/cap'); return; }

  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::sui_deepbook::create_asset_vault`,
    typeArguments: [DBUSDC_TYPE, SUI_TYPE],
    arguments: [
      tx.object(TEST_VAULT_ID),
      tx.object(LEADER_CAP_ID),
    ],
  });

  const result = await signAndExecute(tx);

  for (const change of result.objectChanges || []) {
    if (change.type === 'created' && change.objectType?.includes('AssetVault')) {
      log('Asset Vault ID', change.objectId);
    }
  }

  console.log('\n  PASS: Asset vault created\n');
}

async function testSpotSwap() {
  console.log('\n=== SINGLE-PTB SPOT SWAP (authorize → consume → DeepBook → deposit) ===\n');
  if (!TEST_VAULT_ID || !LEADER_CAP_ID) { console.log('  SKIP: No vault/cap'); return; }

  // Find asset vault for SUI
  const events = await client.queryEvents({
    query: { MoveEventType: `${PACKAGE_ID}::sui_deepbook::AssetVaultCreated` },
    limit: 50,
  });

  let assetVaultId = null;
  for (const event of events.data) {
    const parsed = event.parsedJson;
    if (parsed.vault_id === TEST_VAULT_ID) {
      assetVaultId = parsed.asset_vault_id;
    }
  }

  if (!assetVaultId) {
    console.log('  SKIP: No asset vault. Run create-asset first');
    return;
  }

  const swapAmount = 1_000_000; // 1 DBUSDC
  const tx = new Transaction();

  // Step 1: authorize_swap (returns SwapAuthorization)
  const [swapAuth] = tx.moveCall({
    target: `${PACKAGE_ID}::sui_deepbook::authorize_swap`,
    typeArguments: [DBUSDC_TYPE],
    arguments: [
      tx.object(TEST_VAULT_ID),
      tx.object(LEADER_CAP_ID),
      tx.pure.u64(swapAmount),
      tx.pure.u64(0),
      tx.pure.bool(true), // is_buy
      tx.pure.u64(300),
      tx.object('0x6'),
    ],
  });

  // Step 2: consume_swap_for_buy
  const [usdcCoin] = tx.moveCall({
    target: `${PACKAGE_ID}::sui_deepbook::consume_swap_for_buy`,
    typeArguments: [DBUSDC_TYPE],
    arguments: [
      swapAuth,
      tx.object(TEST_VAULT_ID),
      tx.object('0x6'),
    ],
  });

  // Step 3: Create zero DEEP coin for fees
  const [deepCoin] = tx.moveCall({
    target: '0x2::coin::zero',
    typeArguments: ['0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP'],
  });

  // Step 4: DeepBook swap
  const [baseOut, quoteOut, deepOut] = tx.moveCall({
    target: `${DEEPBOOK_PKG}::pool::swap_exact_quote_for_base`,
    typeArguments: [SUI_TYPE, DBUSDC_TYPE],
    arguments: [
      tx.object(SUI_DBUSDC_POOL),
      usdcCoin,
      deepCoin,
      tx.pure.u64(0),
      tx.object('0x6'),
    ],
  });

  // Step 5: Deposit SUI output to AssetVault
  tx.moveCall({
    target: `${PACKAGE_ID}::sui_deepbook::deposit_swap_output`,
    typeArguments: [SUI_TYPE],
    arguments: [
      tx.object(assetVaultId),
      baseOut,
      tx.pure.u64(0),
    ],
  });

  // Step 6: Return leftover
  tx.transferObjects([quoteOut, deepOut], getAddress());

  try {
    const result = await signAndExecute(tx);
    log('TX Digest', result.digest);
    log('Status', 'SUCCESS');

    for (const event of result.events || []) {
      if (event.type?.includes('AssetDeposited')) {
        const data = event.parsedJson;
        log('SUI Deposited', `${(Number(data.amount) / 1e9).toFixed(4)} SUI`);
      }
    }

    console.log('\n  PASS: Single-PTB spot swap executed\n');
  } catch (e) {
    console.error('  FAIL:', e.message);
  }
}

async function testCreateMarginAccount() {
  console.log('\n=== CREATE MARGIN ACCOUNT ===\n');
  if (!TEST_VAULT_ID || !LEADER_CAP_ID) { console.log('  SKIP: No vault/cap'); return; }

  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::sui_margin::create_margin_account`,
    typeArguments: [DBUSDC_TYPE],
    arguments: [
      tx.object(TEST_VAULT_ID),
      tx.object(LEADER_CAP_ID),
    ],
  });

  try {
    const result = await signAndExecute(tx);

    for (const change of result.objectChanges || []) {
      if (change.type === 'created' && change.objectType?.includes('MarginAccount')) {
        log('Margin Account', change.objectId);
      }
    }

    console.log('\n  PASS: Margin account created\n');
  } catch (e) {
    console.error('  FAIL:', e.message);
  }
}

async function testSealIntent() {
  console.log('\n=== CREATE SEALED TRADE INTENT ===\n');
  if (!TEST_VAULT_ID || !LEADER_CAP_ID) { console.log('  SKIP: No vault/cap'); return; }

  const tx = new Transaction();

  // Simulate encrypted data (in production, this comes from Seal SDK)
  const fakeEncryptedData = new TextEncoder().encode(JSON.stringify({
    action: 'spot_buy',
    pair: 'SUI/DBUSDC',
    amount: 5_000_000,
    timestamp: Date.now(),
  }));

  const decryptAfter = Date.now() + 30_000; // 30 seconds from now
  const intentDuration = 300_000; // 5 minutes

  tx.moveCall({
    target: `${PACKAGE_ID}::sui_seal::create_sealed_intent`,
    typeArguments: [DBUSDC_TYPE],
    arguments: [
      tx.object(TEST_VAULT_ID),
      tx.object(LEADER_CAP_ID),
      tx.pure.vector('u8', Array.from(fakeEncryptedData)),
      tx.pure.u64(decryptAfter),
      tx.pure.u64(intentDuration),
      tx.object('0x6'),
    ],
  });

  try {
    const result = await signAndExecute(tx);

    for (const change of result.objectChanges || []) {
      if (change.type === 'created' && change.objectType?.includes('SealedTradeIntent')) {
        log('Intent ID', change.objectId);
        log('Decrypt After', new Date(decryptAfter).toLocaleString());
        log('Expires At', new Date(decryptAfter + intentDuration).toLocaleString());
      }
    }

    console.log('\n  PASS: Sealed trade intent created\n');
  } catch (e) {
    console.error('  FAIL:', e.message);
  }
}

async function testFull() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   SUI HypersFun E2E Test Suite           ║');
  console.log('╚══════════════════════════════════════════╝\n');

  await testStatus();

  if (!PACKAGE_ID) {
    console.log('\n--- Package not deployed. Run: node test-e2e.js deploy ---\n');
    return;
  }

  if (!TEST_VAULT_ID) {
    await testCreateVault();
  }

  if (TEST_VAULT_ID) {
    await testBuyShares();
    await testCreateAssetVault();
    await testSpotSwap();
    await testCreateMarginAccount();
    await testSealIntent();
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   E2E Test Suite Complete                 ║');
  console.log('╚══════════════════════════════════════════╝\n');
}

// ============ CLI ============

const cmd = process.argv[2] || 'status';

const commands = {
  status: testStatus,
  deploy: testDeploy,
  'create-vault': testCreateVault,
  buy: testBuyShares,
  sell: async () => console.log('TODO: sell test'),
  'create-asset': testCreateAssetVault,
  'spot-swap': testSpotSwap,
  'create-margin': testCreateMarginAccount,
  'seal-intent': testSealIntent,
  full: testFull,
};

if (commands[cmd]) {
  commands[cmd]().catch(e => {
    console.error('\nFATAL:', e.message);
    process.exit(1);
  });
} else {
  console.log(`Unknown command: ${cmd}`);
  console.log('Available:', Object.keys(commands).join(', '));
}
