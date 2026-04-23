/**
 * Full Leader Trading E2E Test
 * Tests: create vault → buy shares → spot swap auth → margin cycle → seal intent
 * Uses existing custom USDC (2.86 available)
 */

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
require('dotenv').config();

const NETWORK = 'testnet';
const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });
const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const FACTORY_ID = process.env.SUI_FACTORY_ID;
const USDC_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

function getKeypair() {
  const { secretKey } = decodeSuiPrivateKey(process.env.SUI_PRIVATE_KEY);
  return Ed25519Keypair.fromSecretKey(secretKey);
}
const keypair = getKeypair();
const address = keypair.getPublicKey().toSuiAddress();

async function exec(tx) {
  const result = await client.signAndExecuteTransaction({
    transaction: tx, signer: keypair,
    options: { showObjectChanges: true, showEvents: true, showEffects: true },
  });
  if (result.effects?.status?.status === 'failure') {
    throw new Error(result.effects.status.error);
  }
  return result;
}

function findCreated(result, typeName) {
  for (const c of result.objectChanges || []) {
    if (c.type === 'created' && c.objectType?.includes(typeName)) return c.objectId;
  }
  return null;
}

(async () => {
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║   Leader Trading E2E Test                      ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  // Check balance
  const bal = await client.getBalance({ owner: address, coinType: USDC_TYPE });
  console.log(`Wallet USDC: ${(Number(bal.totalBalance) / 1e6).toFixed(2)}\n`);

  if (Number(bal.totalBalance) < 1_000_000) {
    console.log('ERROR: Need at least 1 USDC. Aborting.');
    return;
  }

  // ========== STEP 1: Create Vault ==========
  console.log('--- STEP 1: Create Vault ---');
  const tx1 = new Transaction();
  tx1.moveCall({
    target: `${PACKAGE_ID}::sui_vault::create_vault`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx1.object(FACTORY_ID),
      tx1.pure.vector('u8', Array.from(new TextEncoder().encode('Leader E2E'))),
      tx1.pure.vector('u8', Array.from(new TextEncoder().encode('LE2E'))),
      tx1.pure.u64(1000),
      tx1.object('0x6'),
    ],
  });
  const r1 = await exec(tx1);
  const vaultId = findCreated(r1, 'SuiVault');
  const leaderCapId = findCreated(r1, 'SuiLeaderCap');
  console.log(`  Vault:     ${vaultId}`);
  console.log(`  LeaderCap: ${leaderCapId}`);
  console.log('  PASS\n');
  await new Promise(r => setTimeout(r, 2000)); // wait for indexer

  // ========== STEP 2: Buy Shares (1 USDC) ==========
  console.log('--- STEP 2: Buy Vault Shares (1 USDC) ---');
  const coins = await client.getCoins({ owner: address, coinType: USDC_TYPE });
  const tx2 = new Transaction();
  const [primary, ...rest] = coins.data;
  if (rest.length > 0) {
    tx2.mergeCoins(tx2.object(primary.coinObjectId), rest.map(c => tx2.object(c.coinObjectId)));
  }
  const [buyCoin] = tx2.splitCoins(tx2.object(primary.coinObjectId), [1_000_000]);
  tx2.moveCall({
    target: `${PACKAGE_ID}::sui_vault::buy`,
    typeArguments: [USDC_TYPE],
    arguments: [tx2.object(vaultId), tx2.object(FACTORY_ID), buyCoin, tx2.pure.u64(0), tx2.object('0x6')],
  });
  const r2 = await exec(tx2);
  for (const ev of r2.events || []) {
    if (ev.type?.includes('TokenBought')) {
      const d = ev.parsedJson;
      console.log(`  Paid:   ${(Number(d.usdc_amount) / 1e6).toFixed(2)} USDC`);
      console.log(`  Tokens: ${d.token_amount}`);
      console.log(`  NAV:    $${(Number(d.nav) / 1e6).toFixed(6)}`);
    }
  }
  console.log('  PASS\n');
  await new Promise(r => setTimeout(r, 2000));

  // ========== STEP 3: Leader Spot Swap Auth (single PTB) ==========
  console.log('--- STEP 3: Spot Swap Authorization (single PTB) ---');
  const tx3 = new Transaction();
  const swapAmt = 200_000; // 0.2 USDC

  // authorize → consume → return (round-trip test)
  const [swapAuth] = tx3.moveCall({
    target: `${PACKAGE_ID}::sui_deepbook::authorize_swap`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx3.object(vaultId), tx3.object(leaderCapId),
      tx3.pure.u64(swapAmt), tx3.pure.u64(0), tx3.pure.bool(true),
      tx3.pure.u64(300), tx3.object('0x6'),
    ],
  });
  const [extractedCoin] = tx3.moveCall({
    target: `${PACKAGE_ID}::sui_deepbook::consume_swap_for_buy`,
    typeArguments: [USDC_TYPE],
    arguments: [swapAuth, tx3.object(vaultId), tx3.object('0x6')],
  });
  // Return to vault (simulating completed swap)
  tx3.moveCall({
    target: `${PACKAGE_ID}::sui_deepbook::deposit_usdc_from_sell`,
    typeArguments: [USDC_TYPE],
    arguments: [tx3.object(vaultId), extractedCoin, tx3.pure.u64(0)],
  });
  await exec(tx3);
  console.log(`  authorize → consume → return: 0.20 USDC round-trip`);
  console.log('  PASS\n');
  await new Promise(r => setTimeout(r, 1000));

  // ========== STEP 4: Create Margin Account ==========
  console.log('--- STEP 4: Create Margin Account ---');
  const tx4 = new Transaction();
  tx4.moveCall({
    target: `${PACKAGE_ID}::sui_margin::create_margin_account`,
    typeArguments: [USDC_TYPE],
    arguments: [tx4.object(vaultId), tx4.object(leaderCapId)],
  });
  const r4 = await exec(tx4);
  const marginAccId = findCreated(r4, 'MarginAccount');
  console.log(`  MarginAccount: ${marginAccId}`);
  console.log('  PASS\n');
  await new Promise(r => setTimeout(r, 2000));

  // ========== STEP 5: Margin Deposit → Return Cycle ==========
  console.log('--- STEP 5: Margin Deposit → Return Cycle (0.3 USDC) ---');
  const tx5 = new Transaction();
  const mAmt = 300_000;

  // Authorize deposit
  const [mAuth] = tx5.moveCall({
    target: `${PACKAGE_ID}::sui_margin::authorize_margin_deposit`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx5.object(vaultId), tx5.object(leaderCapId), tx5.object(marginAccId),
      tx5.pure.u64(mAmt), tx5.pure.u64(600), tx5.object('0x6'),
    ],
  });
  // Consume → extract USDC
  const [mCoin] = tx5.moveCall({
    target: `${PACKAGE_ID}::sui_margin::consume_margin_deposit`,
    typeArguments: [USDC_TYPE],
    arguments: [mAuth, tx5.object(vaultId), tx5.object(marginAccId), tx5.object('0x6')],
  });
  // Return margin funds
  const [retAuth] = tx5.moveCall({
    target: `${PACKAGE_ID}::sui_margin::authorize_margin_return`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx5.object(vaultId), tx5.object(leaderCapId),
      tx5.pure.u64(0), tx5.pure.u64(600), tx5.object('0x6'),
    ],
  });
  tx5.moveCall({
    target: `${PACKAGE_ID}::sui_margin::return_margin_funds`,
    typeArguments: [USDC_TYPE],
    arguments: [
      retAuth, tx5.object(vaultId), tx5.object(marginAccId),
      mCoin, tx5.pure.u64(mAmt), tx5.object('0x6'),
    ],
  });
  const r5 = await exec(tx5);
  for (const ev of r5.events || []) {
    if (ev.type?.includes('MarginFundsExtracted')) {
      console.log(`  Extracted: ${(Number(ev.parsedJson.amount) / 1e6).toFixed(2)} USDC`);
      console.log(`  Allocated: ${(Number(ev.parsedJson.total_allocated) / 1e6).toFixed(2)} USDC`);
    }
    if (ev.type?.includes('MarginFundsReturned')) {
      console.log(`  Returned:  ${(Number(ev.parsedJson.amount) / 1e6).toFixed(2)} USDC`);
      console.log(`  P&L:       ${ev.parsedJson.is_profit ? '+' : '-'}$${(Number(ev.parsedJson.pnl_amount) / 1e6).toFixed(2)}`);
    }
  }
  console.log('  PASS\n');
  await new Promise(r => setTimeout(r, 3000));

  // ========== STEP 6: Sealed Trade Intent ==========
  console.log('--- STEP 6: Create Sealed Trade Intent ---');
  const tx6 = new Transaction();
  const intentData = new TextEncoder().encode(JSON.stringify({
    action: 'margin_long', pair: 'SUI/USDC', amount: 500000, leverage: 3,
  }));
  const decryptAfter = Date.now() + 30000;
  tx6.moveCall({
    target: `${PACKAGE_ID}::sui_seal::create_sealed_intent`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx6.object(vaultId), tx6.object(leaderCapId),
      tx6.pure.vector('u8', Array.from(intentData)),
      tx6.pure.u64(decryptAfter), tx6.pure.u64(300000), tx6.object('0x6'),
    ],
  });
  const r6 = await exec(tx6);
  const intentId = findCreated(r6, 'SealedTradeIntent');
  console.log(`  Intent:       ${intentId}`);
  console.log(`  Decrypt at:   ${new Date(decryptAfter).toLocaleTimeString()}`);
  console.log('  PASS\n');

  // ========== FINAL: Check Vault State ==========
  console.log('--- FINAL: Vault State ---');
  const vObj = await client.getObject({ id: vaultId, options: { showContent: true } });
  const f = vObj.data.content.fields;
  const reserve = Number(f.usdc_reserve?.fields?.value || 0) / 1e6;
  console.log(`  Name:      ${Buffer.from(f.name).toString()}`);
  console.log(`  Reserve:   ${reserve.toFixed(2)} USDC`);
  console.log(`  Supply:    ${f.total_supply}`);

  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║   ALL 6 TESTS PASSED ✓                        ║');
  console.log('╚═══════════════════════════════════════════════╝\n');
})().catch(e => {
  console.error('\nFAIL:', e.message);
  process.exit(1);
});
