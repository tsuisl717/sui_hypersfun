// Check vault details from SUI testnet
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const VAULT_ID = process.argv[2] || '0xd94b15b21ba57e8bfeb54d6a302b4db865a07c9c8b90c05b64416c5d8c6ab042';

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('testnet') });

  console.log('Fetching vault:', VAULT_ID);
  console.log('---');

  try {
    const vault = await client.getObject({
      id: VAULT_ID,
      options: { showContent: true },
    });

    if (vault.data?.content && vault.data.content.dataType === 'moveObject') {
      const fields = vault.data.content.fields;

      console.log('Vault Name:', fields.name);
      console.log('Symbol:', fields.symbol);
      console.log('Leader:', fields.leader);
      console.log('Performance Fee BPS:', fields.performance_fee_bps);
      console.log('Performance Fee %:', Number(fields.performance_fee_bps) / 100);
      console.log('Total Supply:', fields.total_supply);
      console.log('Total Volume:', fields.total_volume);
      console.log('Paused:', fields.paused);

      // USDC Reserve
      if (fields.usdc_reserve?.fields?.value) {
        const reserve = Number(fields.usdc_reserve.fields.value) / 1_000_000;
        console.log('USDC Reserve:', reserve, 'USDC');
      }

      // BC State
      if (fields.bc_state?.fields) {
        const bc = fields.bc_state.fields;
        console.log('\nBonding Curve State:');
        console.log('  Virtual Base:', Number(bc.virtual_base) / 1_000_000);
        console.log('  Virtual Tokens:', Number(bc.virtual_tokens) / 1_000_000);
        console.log('  Real Base:', Number(bc.real_base) / 1_000_000);
        console.log('  Real Tokens:', Number(bc.real_tokens) / 1_000_000);
      }

      console.log('\n--- Raw Fields ---');
      console.log(JSON.stringify(fields, null, 2));
    } else {
      console.log('Vault not found or invalid');
      console.log(vault);
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
