/// SUI HypersFun - DeepBook Integration Module
/// 整合 DeepBook V3 進行現貨交易
///
/// 設計說明：
/// - 此模組管理外部資產（SUI, WETH, BTC 等）
/// - Leader 可以用 USDC 交換其他資產
/// - 所有資產留在 Vault 內，影響 NAV 計算
/// - 實際 DeepBook 調用在 PTB 層面組合
#[allow(lint(self_transfer))]
module sui_hypersfun::sui_deepbook {
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::type_name::{Self, TypeName};

    use sui_hypersfun::sui_vault::{Self, SuiVault, SuiLeaderCap};

    // ============ Error Codes ============

    const E_NOT_AUTHORIZED: u64 = 1;
    const E_INSUFFICIENT_BALANCE: u64 = 2;
    const E_INVALID_AMOUNT: u64 = 3;
    const E_SWAP_EXPIRED: u64 = 4;
    const E_SLIPPAGE_EXCEEDED: u64 = 5;
    const E_ALREADY_USED: u64 = 7;

    // ============ Structs ============

    /// Multi-asset vault for holding traded assets
    /// Each vault can hold one type of external asset
    public struct AssetVault<phantom T> has key {
        id: UID,
        /// Reference to main vault
        vault_id: ID,
        /// Asset balance
        balance: Balance<T>,
        /// Asset type name for identification
        asset_type: TypeName,
        /// Total amount deposited (for tracking)
        total_deposited: u64,
        /// Total amount withdrawn
        total_withdrawn: u64,
    }

    /// Swap authorization - created by leader, consumed in PTB
    public struct SwapAuthorization has key {
        id: UID,
        vault_id: ID,
        /// Input amount (USDC)
        input_amount: u64,
        /// Minimum output amount (slippage protection)
        min_output: u64,
        /// Is buying base asset (true) or selling (false)
        is_buy: bool,
        /// Expiration timestamp
        expires_at: u64,
        /// Used flag
        used: bool,
    }

    // ============ Events ============

    public struct AssetVaultCreated has copy, drop {
        vault_id: ID,
        asset_vault_id: ID,
        asset_type: TypeName,
    }

    public struct SwapAuthorized has copy, drop {
        vault_id: ID,
        authorization_id: ID,
        input_amount: u64,
        min_output: u64,
        is_buy: bool,
    }

    public struct SwapExecuted has copy, drop {
        vault_id: ID,
        input_amount: u64,
        output_amount: u64,
        is_buy: bool,
    }

    public struct AssetDeposited has copy, drop {
        vault_id: ID,
        asset_type: TypeName,
        amount: u64,
    }

    public struct AssetWithdrawn has copy, drop {
        vault_id: ID,
        asset_type: TypeName,
        amount: u64,
    }

    // ============ Asset Vault Creation ============

    /// Create an asset vault for holding a specific token type
    /// Leader creates this to enable trading that asset
    public fun create_asset_vault<USDC, T>(
        vault: &SuiVault<USDC>,
        leader_cap: &SuiLeaderCap,
        ctx: &mut TxContext,
    ) {
        // Verify leader
        assert!(sui_vault::leader_cap_vault_id(leader_cap) == object::id(vault), E_NOT_AUTHORIZED);

        let vault_id = object::id(vault);
        let asset_type = type_name::with_defining_ids<T>();

        let asset_vault = AssetVault<T> {
            id: object::new(ctx),
            vault_id,
            balance: balance::zero<T>(),
            asset_type,
            total_deposited: 0,
            total_withdrawn: 0,
        };

        let asset_vault_id = object::id(&asset_vault);

        event::emit(AssetVaultCreated {
            vault_id,
            asset_vault_id,
            asset_type,
        });

        // Share the asset vault so it can be accessed in PTBs
        transfer::share_object(asset_vault);
    }

    // ============ Swap Authorization ============

    /// Leader authorizes a swap from USDC to another asset
    public fun authorize_swap<USDC>(
        vault: &SuiVault<USDC>,
        leader_cap: &SuiLeaderCap,
        input_amount: u64,
        min_output: u64,
        is_buy: bool,
        expiry_seconds: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Verify leader
        assert!(sui_vault::leader_cap_vault_id(leader_cap) == object::id(vault), E_NOT_AUTHORIZED);
        assert!(input_amount > 0, E_INVALID_AMOUNT);

        let vault_id = object::id(vault);
        let current_time = clock::timestamp_ms(clock) / 1000;

        let authorization = SwapAuthorization {
            id: object::new(ctx),
            vault_id,
            input_amount,
            min_output,
            is_buy,
            expires_at: current_time + expiry_seconds,
            used: false,
        };

        let auth_id = object::id(&authorization);

        event::emit(SwapAuthorized {
            vault_id,
            authorization_id: auth_id,
            input_amount,
            min_output,
            is_buy,
        });

        // Transfer to sender for use in PTB
        transfer::transfer(authorization, tx_context::sender(ctx));
    }

    /// Consume swap authorization and extract USDC for DeepBook swap
    /// Returns USDC coin to be used in DeepBook swap
    public fun consume_swap_for_buy<USDC>(
        authorization: SwapAuthorization,
        vault: &mut SuiVault<USDC>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Coin<USDC> {
        let SwapAuthorization {
            id,
            vault_id,
            input_amount,
            min_output: _,
            is_buy,
            expires_at,
            used,
        } = authorization;

        let current_time = clock::timestamp_ms(clock) / 1000;

        // Validate
        assert!(!used, E_ALREADY_USED);
        assert!(current_time < expires_at, E_SWAP_EXPIRED);
        assert!(vault_id == object::id(vault), E_NOT_AUTHORIZED);
        assert!(is_buy, E_INVALID_AMOUNT); // This function is for buying

        object::delete(id);

        // Extract USDC from vault reserve
        sui_vault::extract_usdc_for_trading(vault, input_amount, ctx)
    }

    /// Deposit the output asset after swap
    public fun deposit_swap_output<T>(
        asset_vault: &mut AssetVault<T>,
        coin: Coin<T>,
        min_output: u64,
    ) {
        let amount = coin::value(&coin);
        assert!(amount >= min_output, E_SLIPPAGE_EXCEEDED);

        let coin_balance = coin::into_balance(coin);
        balance::join(&mut asset_vault.balance, coin_balance);

        asset_vault.total_deposited = asset_vault.total_deposited + amount;

        event::emit(AssetDeposited {
            vault_id: asset_vault.vault_id,
            asset_type: asset_vault.asset_type,
            amount,
        });
    }

    /// Consume swap authorization for selling base asset back to USDC
    public fun consume_swap_for_sell<T>(
        authorization: SwapAuthorization,
        asset_vault: &mut AssetVault<T>,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Coin<T> {
        let SwapAuthorization {
            id,
            vault_id,
            input_amount,
            min_output: _,
            is_buy,
            expires_at,
            used,
        } = authorization;

        let current_time = clock::timestamp_ms(clock) / 1000;

        // Validate
        assert!(!used, E_ALREADY_USED);
        assert!(current_time < expires_at, E_SWAP_EXPIRED);
        assert!(vault_id == asset_vault.vault_id, E_NOT_AUTHORIZED);
        assert!(!is_buy, E_INVALID_AMOUNT); // This function is for selling
        assert!(amount <= input_amount, E_INVALID_AMOUNT);
        assert!(balance::value(&asset_vault.balance) >= amount, E_INSUFFICIENT_BALANCE);

        object::delete(id);

        // Extract asset from vault
        let withdrawn = balance::split(&mut asset_vault.balance, amount);
        asset_vault.total_withdrawn = asset_vault.total_withdrawn + amount;

        event::emit(AssetWithdrawn {
            vault_id: asset_vault.vault_id,
            asset_type: asset_vault.asset_type,
            amount,
        });

        coin::from_balance(withdrawn, ctx)
    }

    /// Deposit USDC back to vault after selling
    public fun deposit_usdc_from_sell<USDC>(
        vault: &mut SuiVault<USDC>,
        coin: Coin<USDC>,
        min_output: u64,
    ) {
        let amount = coin::value(&coin);
        assert!(amount >= min_output, E_SLIPPAGE_EXCEEDED);

        sui_vault::deposit_usdc_from_trading(vault, coin);

        event::emit(SwapExecuted {
            vault_id: object::id(vault),
            input_amount: 0, // Will be filled by caller
            output_amount: amount,
            is_buy: false,
        });
    }

    // ============ View Functions ============

    /// Get asset vault balance
    public fun asset_balance<T>(asset_vault: &AssetVault<T>): u64 {
        balance::value(&asset_vault.balance)
    }

    /// Get asset vault ID
    public fun asset_vault_id<T>(asset_vault: &AssetVault<T>): ID {
        object::id(asset_vault)
    }

    /// Get vault ID from asset vault
    public fun asset_vault_vault_id<T>(asset_vault: &AssetVault<T>): ID {
        asset_vault.vault_id
    }

    /// Get asset type
    public fun asset_type<T>(asset_vault: &AssetVault<T>): TypeName {
        asset_vault.asset_type
    }

    /// Get total deposited
    public fun total_deposited<T>(asset_vault: &AssetVault<T>): u64 {
        asset_vault.total_deposited
    }

    /// Get total withdrawn
    public fun total_withdrawn<T>(asset_vault: &AssetVault<T>): u64 {
        asset_vault.total_withdrawn
    }

    // ============ NAV Helper Functions ============

    /// Calculate asset value in USDC terms
    /// This is called off-chain to aggregate NAV
    /// price_usdc is the asset price in USDC (6 decimals, e.g., 150_000_000 = $150)
    public fun calculate_asset_value_usdc<T>(
        asset_vault: &AssetVault<T>,
        price_usdc: u64,
        asset_decimals: u8,
    ): u64 {
        let balance_val = balance::value(&asset_vault.balance);
        if (balance_val == 0) {
            return 0
        };

        // Normalize to 6 decimals (USDC precision)
        // value = balance * price / 10^asset_decimals
        let decimal_factor = pow10(asset_decimals);
        ((balance_val as u128) * (price_usdc as u128) / (decimal_factor as u128)) as u64
    }

    /// Helper: 10^n
    fun pow10(n: u8): u64 {
        let mut result = 1u64;
        let mut i = 0u8;
        while (i < n) {
            result = result * 10;
            i = i + 1;
        };
        result
    }
}
