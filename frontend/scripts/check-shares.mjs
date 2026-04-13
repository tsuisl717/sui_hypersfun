// Check user's VaultShare objects
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const PACKAGE_ID = '0x342c90eee2a578c7a3e7aca6b2be6163b349870d8e0240a2b54f1bf3bb9ba23f';
const VAULT_ID = '0xd94b15b21ba57e8bfeb54d6a302b4db865a07c9c8b90c05b64416c5d8c6ab042';
const USER_ADDRESS = process.argv[2] || '0x47420';  // Default to the address from error msg

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('testnet') });

  // If partial address given, we need the full one
  if (USER_ADDRESS.length < 66) {
    console.log('Please provide full user address as argument');
    console.log('Usage: node scripts/check-shares.mjs 0x47420...full_address');
    console.log('\nSearching for all VaultShare objects instead...\n');
  }

  try {
    // Get all VaultShare objects (via type filter)
    console.log('Searching for VaultShare objects for vault:', VAULT_ID);
    console.log('Package:', PACKAGE_ID);
    console.log('---\n');

    // Try to query by type
    const objects = await client.queryEvents({
      query: {
        MoveEventType: `${PACKAGE_ID}::sui_vault::TokenBought`,
      },
      limit: 50,
    });

    console.log('Recent TokenBought events:', objects.data.length);

    for (const event of objects.data) {
      console.log('\nEvent:');
      console.log('  TX:', event.id.txDigest);
      console.log('  Data:', JSON.stringify(event.parsedJson, null, 2));
    }

    // Also check TokenSold events
    const sellEvents = await client.queryEvents({
      query: {
        MoveEventType: `${PACKAGE_ID}::sui_vault::TokenSold`,
      },
      limit: 50,
    });

    console.log('\n---\nRecent TokenSold events:', sellEvents.data.length);

    for (const event of sellEvents.data) {
      console.log('\nEvent:');
      console.log('  TX:', event.id.txDigest);
      console.log('  Data:', JSON.stringify(event.parsedJson, null, 2));
    }

  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
