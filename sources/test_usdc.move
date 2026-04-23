/// Test USDC - Testnet only, anyone can mint
module sui_hypersfun::test_usdc {
    use sui::coin::{Self, TreasuryCap};

    public struct TEST_USDC has drop {}

    fun init(witness: TEST_USDC, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency(
            witness,
            6, // decimals (same as USDC)
            b"tUSDC",
            b"Test USDC",
            b"Testnet USDC for HypersFun E2E testing",
            option::none(),
            ctx,
        );
        transfer::public_share_object(treasury_cap);
        transfer::public_freeze_object(metadata);
    }

    /// Anyone can mint - testnet only!
    public fun mint(
        treasury: &mut TreasuryCap<TEST_USDC>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        let coin = coin::mint(treasury, amount, ctx);
        transfer::public_transfer(coin, recipient);
    }
}
