/**
 * Full Leader E2E Test with tUSDC (self-mintable test token)
 * V6 Package: 0xd2e920ef17bde30f2a3ec7a89c3ab26d7fa8c9010074776e1d2c0e0d9fdf6c05
 */
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
require('dotenv').config();

const client = new SuiClient({ url: getFullnodeUrl('testnet') });
const { secretKey } = decodeSuiPrivateKey(process.env.SUI_PRIVATE_KEY);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const address = keypair.getPublicKey().toSuiAddress();

const PKG = '0xd2e920ef17bde30f2a3ec7a89c3ab26d7fa8c9010074776e1d2c0e0d9fdf6c05';
const TUSDC = PKG + '::test_usdc::TEST_USDC';
const TREASURY = '0xaaf7c19379f463427a9572c3536b2be002e8067b8505cdb5f041a91441974cbd';

async function exec(tx) {
  const r = await client.signAndExecuteTransaction({
    transaction: tx, signer: keypair,
    options: { showObjectChanges: true, showEvents: true, showEffects: true },
  });
  if (r.effects?.status?.status === 'failure') throw new Error(r.effects.status.error);
  return r;
}

function find(r, t) {
  for (const c of r.objectChanges || [])
    if (c.type === 'created' && c.objectType?.includes(t)) return c.objectId;
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n=== Full Leader E2E with tUSDC ===\n');

  // Find factory + admin cap from recent publish
  let factoryId, adminCapId;
  const txns = await client.queryTransactionBlocks({
    filter: { FromAddress: address },
    options: { showObjectChanges: true },
    limit: 5, order: 'descending',
  });
  for (const txn of txns.data) {
    for (const c of txn.objectChanges || []) {
      if (c.type === 'created' && c.objectType?.includes('SuiFactory')) factoryId = c.objectId;
      if (c.type === 'created' && c.objectType?.includes('SuiAdminCap')) adminCapId = c.objectId;
    }
  }
  console.log('Factory:', factoryId);
  console.log('AdminCap:', adminCapId);

  // Set min deposit
  const txMin = new Transaction();
  txMin.moveCall({
    target: `${PKG}::sui_factory::set_min_deposit`,
    arguments: [txMin.object(adminCapId), txMin.object(factoryId), txMin.pure.u64(100_000)],
  });
  await exec(txMin);
  console.log('min_deposit = 0.1 tUSDC\n');
  await sleep(1500);

  // STEP 1: Create vault
  console.log('STEP 1: Create Vault');
  const tx1 = new Transaction();
  tx1.moveCall({
    target: `${PKG}::sui_vault::create_vault`,
    typeArguments: [TUSDC],
    arguments: [
      tx1.object(factoryId),
      tx1.pure.vector('u8', Array.from(new TextEncoder().encode('tUSDC Fund'))),
      tx1.pure.vector('u8', Array.from(new TextEncoder().encode('tFUND'))),
      tx1.pure.u64(1000),
      tx1.object('0x6'),
    ],
  });
  const r1 = await exec(tx1);
  const vaultId = find(r1, 'SuiVault');
  const capId = find(r1, 'SuiLeaderCap');
  console.log('  Vault:', vaultId);
  console.log('  Cap:', capId, '\n');
  await sleep(2000);

  // STEP 2: Buy shares (100 tUSDC)
  console.log('STEP 2: Buy 100 tUSDC shares');
  const coins = await client.getCoins({ owner: address, coinType: TUSDC });
  const tx2 = new Transaction();
  const [p, ...rest] = coins.data;
  if (rest.length > 0) tx2.mergeCoins(tx2.object(p.coinObjectId), rest.map(c => tx2.object(c.coinObjectId)));
  const [buy] = tx2.splitCoins(tx2.object(p.coinObjectId), [100_000_000]);
  tx2.moveCall({
    target: `${PKG}::sui_vault::buy`,
    typeArguments: [TUSDC],
    arguments: [tx2.object(vaultId), tx2.object(factoryId), buy, tx2.pure.u64(0), tx2.object('0x6')],
  });
  const r2 = await exec(tx2);
  for (const ev of r2.events || []) {
    if (ev.type?.includes('TokenBought')) {
      console.log('  Paid:', (Number(ev.parsedJson.usdc_amount) / 1e6).toFixed(2), 'tUSDC');
      console.log('  Tokens:', ev.parsedJson.token_amount);
      console.log('  NAV: $' + (Number(ev.parsedJson.nav) / 1e6).toFixed(6));
    }
  }
  console.log('  PASS\n');
  await sleep(1500);

  // STEP 3: Spot swap auth round-trip
  console.log('STEP 3: Spot Swap Auth (10 tUSDC round-trip)');
  const tx3 = new Transaction();
  const [auth3] = tx3.moveCall({
    target: `${PKG}::sui_deepbook::authorize_swap`,
    typeArguments: [TUSDC],
    arguments: [tx3.object(vaultId), tx3.object(capId), tx3.pure.u64(10_000_000), tx3.pure.u64(0), tx3.pure.bool(true), tx3.pure.u64(300), tx3.object('0x6')],
  });
  const [coin3] = tx3.moveCall({
    target: `${PKG}::sui_deepbook::consume_swap_for_buy`,
    typeArguments: [TUSDC],
    arguments: [auth3, tx3.object(vaultId), tx3.object('0x6')],
  });
  tx3.moveCall({
    target: `${PKG}::sui_deepbook::deposit_usdc_from_sell`,
    typeArguments: [TUSDC],
    arguments: [tx3.object(vaultId), coin3, tx3.pure.u64(0)],
  });
  await exec(tx3);
  console.log('  authorize -> consume -> return_to_vault');
  console.log('  PASS\n');
  await sleep(1500);

  // STEP 4: Create margin account
  console.log('STEP 4: Create Margin Account');
  const tx4 = new Transaction();
  tx4.moveCall({
    target: `${PKG}::sui_margin::create_margin_account`,
    typeArguments: [TUSDC],
    arguments: [tx4.object(vaultId), tx4.object(capId)],
  });
  const r4 = await exec(tx4);
  const maId = find(r4, 'MarginAccount');
  console.log('  MarginAccount:', maId);
  console.log('  PASS\n');
  await sleep(2000);

  // STEP 5: Margin deposit -> return
  console.log('STEP 5: Margin Cycle (20 tUSDC extract -> return)');
  const tx5 = new Transaction();
  const [a5] = tx5.moveCall({
    target: `${PKG}::sui_margin::authorize_margin_deposit`,
    typeArguments: [TUSDC],
    arguments: [tx5.object(vaultId), tx5.object(capId), tx5.object(maId), tx5.pure.u64(20_000_000), tx5.pure.u64(600), tx5.object('0x6')],
  });
  const [c5] = tx5.moveCall({
    target: `${PKG}::sui_margin::consume_margin_deposit`,
    typeArguments: [TUSDC],
    arguments: [a5, tx5.object(vaultId), tx5.object(maId), tx5.object('0x6')],
  });
  const [ra5] = tx5.moveCall({
    target: `${PKG}::sui_margin::authorize_margin_return`,
    typeArguments: [TUSDC],
    arguments: [tx5.object(vaultId), tx5.object(capId), tx5.pure.u64(0), tx5.pure.u64(600), tx5.object('0x6')],
  });
  tx5.moveCall({
    target: `${PKG}::sui_margin::return_margin_funds`,
    typeArguments: [TUSDC],
    arguments: [ra5, tx5.object(vaultId), tx5.object(maId), c5, tx5.pure.u64(20_000_000), tx5.object('0x6')],
  });
  const r5 = await exec(tx5);
  for (const ev of r5.events || []) {
    if (ev.type?.includes('MarginFundsExtracted'))
      console.log('  Extracted:', (Number(ev.parsedJson.amount) / 1e6).toFixed(2), 'tUSDC');
    if (ev.type?.includes('MarginFundsReturned')) {
      console.log('  Returned:', (Number(ev.parsedJson.amount) / 1e6).toFixed(2), 'tUSDC');
      console.log('  P&L:', (ev.parsedJson.is_profit ? '+' : '-') + '$' + (Number(ev.parsedJson.pnl_amount) / 1e6).toFixed(2));
    }
  }
  console.log('  PASS\n');
  await sleep(2000);

  // STEP 6: Sealed trade intent
  console.log('STEP 6: Sealed Trade Intent');
  const tx6 = new Transaction();
  const intent = new TextEncoder().encode(JSON.stringify({
    action: 'margin_long', pair: 'SUI/USDC', amount: 50_000_000, leverage: 3,
  }));
  const da = Date.now() + 30000;
  tx6.moveCall({
    target: `${PKG}::sui_seal::create_sealed_intent`,
    typeArguments: [TUSDC],
    arguments: [
      tx6.object(vaultId), tx6.object(capId),
      tx6.pure.vector('u8', Array.from(intent)),
      tx6.pure.u64(da), tx6.pure.u64(300000), tx6.object('0x6'),
    ],
  });
  const r6 = await exec(tx6);
  console.log('  Intent:', find(r6, 'SealedTradeIntent'));
  console.log('  Decrypt at:', new Date(da).toLocaleTimeString());
  console.log('  PASS\n');

  // Final state
  await sleep(1000);
  const vo = await client.getObject({ id: vaultId, options: { showContent: true } });
  const f = vo.data.content.fields;
  console.log('=== FINAL STATE ===');
  console.log('  Reserve:', (Number(f.usdc_reserve?.fields?.value || 0) / 1e6).toFixed(2), 'tUSDC');
  console.log('  Supply:', f.total_supply);
  console.log('\n=== ALL 6 TESTS PASSED ===\n');
})().catch(e => { console.error('\nFAIL:', e.message); process.exit(1); });
