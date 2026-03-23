/// SUI HypersFun - Trading Module
/// 交易模組：Leader 只能用 Vault 資金交易，不能提款
///
/// 設計說明：
/// - 此模組管理交易授權和資金安全
/// - 實際的 DeepBook 調用在 PTB (Programmable Transaction Block) 層面組合
/// - Leader 持有 SuiLeaderTradeCap，可以授權交易
/// - Vault Admin 持有 SuiTradingVault，可以存入/提取資金
/// - 資金永遠不會直接轉到 Leader 的個人錢包
module sui_hypersfun::sui_trading {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::string::{Self, String};

    use sui_hypersfun::sui_types::{Self, ApiWalletInfo};
    use sui_hypersfun::sui_factory::{Self, SuiFactory, SuiAdminCap};
    use sui_hypersfun::sui_vault::{Self, SuiVault, SuiLeaderCap};

    // ============ Error Codes ============

    const E_NOT_AUTHORIZED: u64 = 1;
    const E_PAUSED: u64 = 2;
    const E_INVALID_AMOUNT: u64 = 3;
    const E_API_WALLET_EXPIRED: u64 = 4;
    const E_INVALID_DURATION: u64 = 5;
    const E_WALLET_NOT_FOUND: u64 = 6;
    const E_WALLET_EXISTS: u64 = 7;
    const E_INSUFFICIENT_BALANCE: u64 = 8;
    const E_VAULT_MISMATCH: u64 = 9;
    const E_INVALID_TRADE: u64 = 10;
    const E_TRADE_AMOUNT_EXCEEDS_ALLOWANCE: u64 = 11;

    // ============ Structs ============

    /// Trading vault - holds funds for trading
    /// Owned by vault admin, funds can only be used for trading not withdrawn by leader
    public struct SuiTradingVault<phantom USDC> has key {
        id: UID,
        /// Reference to the main vault
        vault_id: ID,
        /// USDC balance available for trading
        trading_balance: Balance<USDC>,
        /// Maximum single trade size (prevents large unauthorized trades)
        max_trade_size: u64,
        /// Daily trade limit
        daily_trade_limit: u64,
        /// Current day's traded volume
        daily_traded: u64,
        /// Day reset timestamp
        day_reset_time: u64,
        /// Paused flag
        paused: bool,
    }

    /// Leader's trading authorization - can authorize trades but NOT withdraw
    public struct SuiLeaderTradeCap has key, store {
        id: UID,
        vault_id: ID,
        trading_vault_id: ID,
    }

    /// Trading module state - shared object for tracking orders and API wallets
    public struct SuiTradingModule has key {
        id: UID,
        /// Reference to vault
        vault_id: ID,
        /// Trading vault ID
        trading_vault_id: ID,
        /// API wallet management (addresses authorized to trade on behalf of leader)
        api_wallets: Table<address, ApiWalletInfo>,
        /// Order tracking nonce
        order_nonce: u128,
        /// Position tracking (market_id_hash -> position info)
        positions: Table<u64, PositionInfo>,
    }

    /// Authorized trade ticket - created by leader, consumed by PTB
    /// This is the key security mechanism - leader authorizes trade,
    /// but actual execution happens via DeepBook in PTB
    public struct TradeAuthorization has key {
        id: UID,
        vault_id: ID,
        /// Base asset type hash
        base_type: u64,
        /// Quote asset type hash
        quote_type: u64,
        /// Maximum amount that can be traded
        max_amount: u64,
        /// Is buy order (true) or sell order (false)
        is_buy: bool,
        /// Minimum output amount (slippage protection)
        min_output: u64,
        /// Expiration timestamp
        expires_at: u64,
        /// Used flag
        used: bool,
    }

    /// Position information for tracking
    public struct PositionInfo has store, copy, drop {
        /// Base asset amount held
        base_amount: u64,
        /// Quote asset spent
        quote_spent: u64,
        /// Last update timestamp
        last_update: u64,
    }

    // ============ Events ============

    public struct TradingVaultCreated has copy, drop {
        vault_id: ID,
        trading_vault_id: ID,
    }

    public struct FundsDeposited has copy, drop {
        vault_id: ID,
        amount: u64,
    }

    public struct FundsWithdrawn has copy, drop {
        vault_id: ID,
        amount: u64,
    }

    public struct TradeAuthorized has copy, drop {
        vault_id: ID,
        authorization_id: ID,
        max_amount: u64,
        is_buy: bool,
        order_nonce: u128,
    }

    public struct TradeExecuted has copy, drop {
        vault_id: ID,
        authorization_id: ID,
        amount_used: u64,
        output_received: u64,
    }

    public struct ApiWalletAdded has copy, drop {
        vault_id: ID,
        wallet: address,
        expires_at: u64,
        name: String,
    }

    public struct ApiWalletRemoved has copy, drop {
        vault_id: ID,
        wallet: address,
    }

    // ============ Constants ============

    /// Max u64 value - used to disable trade limits (matches EVM behavior)
    const MAX_U64: u64 = 18_446_744_073_709_551_615;

    // ============ Initialization ============

    /// Create trading vault without trade limits (matches EVM behavior)
    /// Only callable by vault admin after vault creation
    public entry fun create_trading_vault_unlimited<USDC>(
        _admin_cap: &SuiAdminCap,
        vault_id: ID,
        leader: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        create_trading_vault_internal<USDC>(
            vault_id,
            leader,
            MAX_U64, // No max trade size limit
            MAX_U64, // No daily limit
            clock,
            ctx,
        )
    }

    /// Create trading vault with optional trade limits
    /// Only callable by vault admin after vault creation
    public entry fun create_trading_vault<USDC>(
        _admin_cap: &SuiAdminCap,
        vault_id: ID,
        leader: address,
        max_trade_size: u64,
        daily_trade_limit: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        create_trading_vault_internal<USDC>(
            vault_id,
            leader,
            max_trade_size,
            daily_trade_limit,
            clock,
            ctx,
        )
    }

    /// Internal function to create trading vault
    fun create_trading_vault_internal<USDC>(
        vault_id: ID,
        leader: address,
        max_trade_size: u64,
        daily_trade_limit: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let current_time = clock::timestamp_ms(clock) / 1000;

        let trading_vault = SuiTradingVault<USDC> {
            id: object::new(ctx),
            vault_id,
            trading_balance: balance::zero<USDC>(),
            max_trade_size,
            daily_trade_limit,
            daily_traded: 0,
            day_reset_time: current_time + 86400, // Reset tomorrow
            paused: false,
        };

        let trading_vault_id = object::id(&trading_vault);

        // Create leader trade cap
        let leader_trade_cap = SuiLeaderTradeCap {
            id: object::new(ctx),
            vault_id,
            trading_vault_id,
        };

        // Create trading module (shared)
        let trading_module = SuiTradingModule {
            id: object::new(ctx),
            vault_id,
            trading_vault_id,
            api_wallets: table::new(ctx),
            order_nonce: 0,
            positions: table::new(ctx),
        };

        event::emit(TradingVaultCreated {
            vault_id,
            trading_vault_id,
        });

        // Admin keeps trading vault (for deposits/withdrawals)
        transfer::transfer(trading_vault, tx_context::sender(ctx));
        // Leader gets trade cap
        transfer::transfer(leader_trade_cap, leader);
        // Trading module is shared for order tracking
        transfer::share_object(trading_module);
    }

    // ============ Deposit/Withdraw (Admin Only) ============

    /// Deposit USDC from main vault to trading vault
    public entry fun deposit_to_trading<USDC>(
        trading_vault: &mut SuiTradingVault<USDC>,
        coin: Coin<USDC>,
        _ctx: &mut TxContext,
    ) {
        let amount = coin::value(&coin);
        let coin_balance = coin::into_balance(coin);
        balance::join(&mut trading_vault.trading_balance, coin_balance);

        event::emit(FundsDeposited {
            vault_id: trading_vault.vault_id,
            amount,
        });
    }

    /// Withdraw USDC from trading vault back to main vault
    /// Only the owner of trading_vault (admin) can call this
    public fun withdraw_from_trading<USDC>(
        trading_vault: &mut SuiTradingVault<USDC>,
        amount: u64,
        ctx: &mut TxContext,
    ): Coin<USDC> {
        assert!(balance::value(&trading_vault.trading_balance) >= amount, E_INSUFFICIENT_BALANCE);

        let withdrawn = balance::split(&mut trading_vault.trading_balance, amount);

        event::emit(FundsWithdrawn {
            vault_id: trading_vault.vault_id,
            amount,
        });

        coin::from_balance(withdrawn, ctx)
    }

    /// Withdraw USDC and transfer to recipient (entry function version)
    public entry fun withdraw_from_trading_to<USDC>(
        trading_vault: &mut SuiTradingVault<USDC>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        let coin = withdraw_from_trading(trading_vault, amount, ctx);
        transfer::public_transfer(coin, recipient);
    }

    /// Withdraw all USDC from trading vault
    public fun withdraw_all_from_trading<USDC>(
        trading_vault: &mut SuiTradingVault<USDC>,
        ctx: &mut TxContext,
    ): Coin<USDC> {
        let amount = balance::value(&trading_vault.trading_balance);
        withdraw_from_trading(trading_vault, amount, ctx)
    }

    /// Withdraw all USDC and transfer to recipient (entry function version)
    public entry fun withdraw_all_from_trading_to<USDC>(
        trading_vault: &mut SuiTradingVault<USDC>,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        let coin = withdraw_all_from_trading(trading_vault, ctx);
        transfer::public_transfer(coin, recipient);
    }

    // ============ Trade Authorization (Leader Only) ============

    /// Leader authorizes a trade - creates a TradeAuthorization ticket
    /// This ticket is then used in a PTB to execute the actual DeepBook trade
    public entry fun authorize_trade<USDC>(
        trading_module: &mut SuiTradingModule,
        trading_vault: &mut SuiTradingVault<USDC>,
        leader_cap: &SuiLeaderTradeCap,
        base_type: u64,
        quote_type: u64,
        amount: u64,
        is_buy: bool,
        min_output: u64,
        expiry_seconds: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Verify leader cap
        assert!(leader_cap.vault_id == trading_module.vault_id, E_NOT_AUTHORIZED);
        assert!(!trading_vault.paused, E_PAUSED);

        let current_time = clock::timestamp_ms(clock) / 1000;

        // Reset daily limit if needed
        if (current_time >= trading_vault.day_reset_time) {
            trading_vault.daily_traded = 0;
            trading_vault.day_reset_time = current_time + 86400;
        };

        // Check trade limits
        assert!(amount <= trading_vault.max_trade_size, E_TRADE_AMOUNT_EXCEEDS_ALLOWANCE);
        assert!(trading_vault.daily_traded + amount <= trading_vault.daily_trade_limit, E_TRADE_AMOUNT_EXCEEDS_ALLOWANCE);

        // Ensure we have enough balance
        assert!(balance::value(&trading_vault.trading_balance) >= amount, E_INSUFFICIENT_BALANCE);

        // Update daily traded
        trading_vault.daily_traded = trading_vault.daily_traded + amount;

        // Increment order nonce
        trading_module.order_nonce = trading_module.order_nonce + 1;

        let authorization = TradeAuthorization {
            id: object::new(ctx),
            vault_id: trading_module.vault_id,
            base_type,
            quote_type,
            max_amount: amount,
            is_buy,
            min_output,
            expires_at: current_time + expiry_seconds,
            used: false,
        };

        let auth_id = object::id(&authorization);

        event::emit(TradeAuthorized {
            vault_id: trading_module.vault_id,
            authorization_id: auth_id,
            max_amount: amount,
            is_buy,
            order_nonce: trading_module.order_nonce,
        });

        // Transfer authorization to sender (leader) for use in PTB
        transfer::transfer(authorization, tx_context::sender(ctx));
    }

    /// Consume trade authorization and extract funds for DeepBook trade
    /// This is called in a PTB right before the DeepBook swap
    public fun consume_authorization_for_trade<USDC>(
        authorization: TradeAuthorization,
        trading_vault: &mut SuiTradingVault<USDC>,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Coin<USDC> {
        let TradeAuthorization {
            id,
            vault_id: _,
            base_type: _,
            quote_type: _,
            max_amount,
            is_buy: _,
            min_output: _,
            expires_at,
            used,
        } = authorization;

        let current_time = clock::timestamp_ms(clock) / 1000;

        // Validate authorization
        assert!(!used, E_INVALID_TRADE);
        assert!(current_time < expires_at, E_API_WALLET_EXPIRED);
        assert!(amount <= max_amount, E_TRADE_AMOUNT_EXCEEDS_ALLOWANCE);
        assert!(balance::value(&trading_vault.trading_balance) >= amount, E_INSUFFICIENT_BALANCE);

        object::delete(id);

        // Extract funds for trade
        let trade_balance = balance::split(&mut trading_vault.trading_balance, amount);
        coin::from_balance(trade_balance, ctx)
    }

    /// Return funds after trade (the output coins go back to trading vault)
    public fun return_trade_output<T>(
        trading_vault: &mut SuiTradingVault<T>,
        coin: Coin<T>,
    ) {
        let coin_balance = coin::into_balance(coin);
        balance::join(&mut trading_vault.trading_balance, coin_balance);
    }

    // ============ API Wallet Management ============

    /// Add an API wallet (leader only)
    public entry fun add_api_wallet(
        trading_module: &mut SuiTradingModule,
        leader_cap: &SuiLeaderTradeCap,
        wallet: address,
        duration_days: u64,
        name: vector<u8>,
        clock: &Clock,
        _ctx: &mut TxContext,
    ) {
        assert!(leader_cap.vault_id == trading_module.vault_id, E_NOT_AUTHORIZED);
        assert!(!table::contains(&trading_module.api_wallets, wallet), E_WALLET_EXISTS);

        let min_days = sui_types::min_api_wallet_duration() / (24 * 60 * 60);
        let max_days = sui_types::max_api_wallet_duration() / (24 * 60 * 60);

        let expires_at = if (duration_days == 0) {
            0 // Unlimited
        } else {
            assert!(duration_days >= min_days && duration_days <= max_days, E_INVALID_DURATION);
            let current_time = clock::timestamp_ms(clock) / 1000;
            current_time + (duration_days * 24 * 60 * 60)
        };

        let wallet_info = sui_types::new_api_wallet_info(true, expires_at, name);
        table::add(&mut trading_module.api_wallets, wallet, wallet_info);

        event::emit(ApiWalletAdded {
            vault_id: trading_module.vault_id,
            wallet,
            expires_at,
            name: string::utf8(name),
        });
    }

    /// Remove an API wallet
    public entry fun remove_api_wallet(
        trading_module: &mut SuiTradingModule,
        leader_cap: &SuiLeaderTradeCap,
        wallet: address,
        _ctx: &mut TxContext,
    ) {
        assert!(leader_cap.vault_id == trading_module.vault_id, E_NOT_AUTHORIZED);
        assert!(table::contains(&trading_module.api_wallets, wallet), E_WALLET_NOT_FOUND);

        let _ = table::remove(&mut trading_module.api_wallets, wallet);

        event::emit(ApiWalletRemoved {
            vault_id: trading_module.vault_id,
            wallet,
        });
    }

    // ============ View Functions ============

    /// Get trading vault balance
    public fun trading_balance<USDC>(trading_vault: &SuiTradingVault<USDC>): u64 {
        balance::value(&trading_vault.trading_balance)
    }

    /// Get trading vault ID
    public fun trading_vault_id<USDC>(trading_vault: &SuiTradingVault<USDC>): ID {
        object::id(trading_vault)
    }

    /// Get vault ID from trading vault
    public fun trading_vault_vault_id<USDC>(trading_vault: &SuiTradingVault<USDC>): ID {
        trading_vault.vault_id
    }

    /// Get max trade size
    public fun max_trade_size<USDC>(trading_vault: &SuiTradingVault<USDC>): u64 {
        trading_vault.max_trade_size
    }

    /// Get daily trade limit
    public fun daily_trade_limit<USDC>(trading_vault: &SuiTradingVault<USDC>): u64 {
        trading_vault.daily_trade_limit
    }

    /// Get daily traded amount
    public fun daily_traded<USDC>(trading_vault: &SuiTradingVault<USDC>): u64 {
        trading_vault.daily_traded
    }

    /// Check if trading is paused
    public fun is_paused<USDC>(trading_vault: &SuiTradingVault<USDC>): bool {
        trading_vault.paused
    }

    /// Get order nonce
    public fun order_nonce(trading_module: &SuiTradingModule): u128 {
        trading_module.order_nonce
    }

    /// Check if API wallet exists
    public fun has_api_wallet(trading_module: &SuiTradingModule, wallet: address): bool {
        table::contains(&trading_module.api_wallets, wallet)
    }

    /// Get leader trade cap vault ID
    public fun leader_trade_cap_vault_id(cap: &SuiLeaderTradeCap): ID {
        cap.vault_id
    }

    // ============ Admin Functions ============

    /// Pause trading (admin only - owner of trading vault)
    public entry fun set_paused<USDC>(
        trading_vault: &mut SuiTradingVault<USDC>,
        paused: bool,
    ) {
        trading_vault.paused = paused;
    }

    /// Update max trade size (admin only)
    public entry fun set_max_trade_size<USDC>(
        trading_vault: &mut SuiTradingVault<USDC>,
        max_trade_size: u64,
    ) {
        trading_vault.max_trade_size = max_trade_size;
    }

    /// Update daily trade limit (admin only)
    public entry fun set_daily_trade_limit<USDC>(
        trading_vault: &mut SuiTradingVault<USDC>,
        daily_trade_limit: u64,
    ) {
        trading_vault.daily_trade_limit = daily_trade_limit;
    }
}
