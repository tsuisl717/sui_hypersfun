/// SUI HypersFun - Vault Core Module
/// 核心 Vault 邏輯：Bonding Curve AMM、buy/sell、NAV、績效費、退出費、TWAP
module sui_hypersfun::sui_vault {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin, TreasuryCap, CoinMetadata};
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::string::{Self, String};
    use std::option::{Self, Option};

    use sui_hypersfun::sui_types::{
        Self,
        UserPurchaseInfo,
        EntryRecord,
        PendingSell,
        ApiWalletInfo,
    };
    use sui_hypersfun::sui_math;
    use sui_hypersfun::sui_factory::{Self, SuiFactory, SuiAdminCap};

    // ============ Error Codes ============

    const E_NOT_AUTHORIZED: u64 = 1;
    const E_PAUSED: u64 = 2;
    const E_INVALID_AMOUNT: u64 = 3;
    const E_SLIPPAGE_EXCEEDED: u64 = 4;
    const E_PENDING_SELL_EXISTS: u64 = 5;
    const E_NO_PENDING_SELL: u64 = 6;
    const E_ZERO_TOKENS: u64 = 7;
    const E_INSUFFICIENT_LIQUIDITY: u64 = 8;
    const E_MIN_DEPOSIT: u64 = 9;
    const E_NOT_LEADER: u64 = 10;
    const E_NOT_ADMIN: u64 = 11;
    const E_ALREADY_INITIALIZED: u64 = 12;
    const E_FEE_TOO_HIGH: u64 = 13;

    // ============ Structs ============

    /// Leader capability - grants trading rights
    public struct SuiLeaderCap has key, store {
        id: UID,
        vault_id: ID,
    }

    /// VaultShare - represents user's share in a vault
    /// 用戶持有的 Vault 份額，可轉移
    /// Similar to ERC20 but as transferable objects
    public struct VaultShare has key, store {
        id: UID,
        /// Which vault this share belongs to
        vault_id: ID,
        /// Amount of shares (same precision as total_supply)
        amount: u64,
        /// Entry NAV when this share was acquired (for performance fee)
        entry_nav: u64,
        /// Timestamp when acquired (for exit fee)
        acquired_at: u64,
    }

    /// Main Vault struct - shared object
    public struct SuiVault<phantom USDC> has key {
        id: UID,

        // Core addresses
        leader: address,
        admin: address,
        factory_id: ID,

        // Token management (vault token)
        total_supply: u64,

        // USDC reserve
        usdc_reserve: Balance<USDC>,

        // Bonding curve parameters (6 decimals precision)
        virtual_base: u64,
        virtual_tokens: u64,
        initial_assets: u64,

        // TWAP NAV protection
        twap_nav: u64,
        twap_nav_time: u64,
        twap_half_life: u64,

        // Accounting
        total_deposits: u64,
        total_volume: u64,
        total_ps_usdc: u64, // Total pending sell USDC

        // User tracking (for weighted average calculations)
        user_purchase_info: Table<address, UserPurchaseInfo>,
        entry_records: Table<address, EntryRecord>,
        pending_sells: Table<address, PendingSell>,

        // Settings
        performance_fee_bps: u64,
        paused: bool,

        // Metadata
        name: String,
        symbol: String,
        metadata_uri: String,
    }

    // ============ Events ============

    public struct VaultCreated has copy, drop {
        vault_id: ID,
        leader: address,
        name: String,
        symbol: String,
        performance_fee_bps: u64,
    }

    public struct TokenBought has copy, drop {
        vault_id: ID,
        buyer: address,
        usdc_in: u64,
        tokens_out: u64,
        price: u64,
        nav: u64,
    }

    public struct TokenSold has copy, drop {
        vault_id: ID,
        seller: address,
        tokens_in: u64,
        usdc_out: u64,
        price: u64,
        nav: u64,
        exit_fee: u64,
        performance_fee_tokens: u64,
    }

    public struct PendingSellCreated has copy, drop {
        vault_id: ID,
        seller: address,
        usdc_amount: u64,
        fee_amount: u64,
    }

    public struct PendingSellClaimed has copy, drop {
        vault_id: ID,
        claimer: address,
        usdc_amount: u64,
    }

    public struct PerformanceFeeMinted has copy, drop {
        vault_id: ID,
        leader: address,
        fee_tokens: u64,
        seller: address,
    }

    public struct NavUpdated has copy, drop {
        vault_id: ID,
        instant_nav: u64,
        twap_nav: u64,
        total_assets: u64,
        total_supply: u64,
    }

    // ============ Vault Creation ============

    /// Create a new vault
    /// Note: This is a simplified version. In production, you'd use a proper
    /// coin creation flow with one-time witness.
    public entry fun create_vault<USDC>(
        factory: &mut SuiFactory,
        name: vector<u8>,
        symbol: vector<u8>,
        performance_fee_bps: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!sui_factory::is_paused(factory), E_PAUSED);
        assert!(performance_fee_bps <= sui_types::max_performance_fee_bps(), E_FEE_TOO_HIGH);

        let leader = tx_context::sender(ctx);
        let (default_bc_base, default_bc_tokens, default_initial) = sui_factory::default_bc_params(factory);

        // Create vault
        let vault = SuiVault<USDC> {
            id: object::new(ctx),
            leader,
            admin: sui_factory::treasury(factory),
            factory_id: sui_factory::id(factory),
            total_supply: 0,
            usdc_reserve: balance::zero<USDC>(),
            virtual_base: default_bc_base,
            virtual_tokens: default_bc_tokens,
            initial_assets: default_initial,
            twap_nav: sui_types::precision(), // Start at 1.0
            twap_nav_time: clock::timestamp_ms(clock) / 1000,
            twap_half_life: sui_types::default_twap_half_life(),
            total_deposits: 0,
            total_volume: 0,
            total_ps_usdc: 0,
            user_purchase_info: table::new(ctx),
            entry_records: table::new(ctx),
            pending_sells: table::new(ctx),
            performance_fee_bps,
            paused: false,
            name: string::utf8(name),
            symbol: string::utf8(symbol),
            metadata_uri: string::utf8(b""),
        };

        let vault_id = object::id(&vault);

        // Create leader capability
        let leader_cap = SuiLeaderCap {
            id: object::new(ctx),
            vault_id,
        };

        // Register in factory
        sui_factory::register_vault(
            factory,
            vault_id,
            leader,
            name,
            symbol,
            performance_fee_bps,
            clock,
            ctx,
        );

        event::emit(VaultCreated {
            vault_id,
            leader,
            name: string::utf8(name),
            symbol: string::utf8(symbol),
            performance_fee_bps,
        });

        // Transfer leader cap to creator
        transfer::transfer(leader_cap, leader);

        // Share vault
        transfer::share_object(vault);
    }

    // ============ Buy Function ============

    /// Buy vault tokens with USDC
    public entry fun buy<USDC>(
        vault: &mut SuiVault<USDC>,
        factory: &SuiFactory,
        usdc_coin: Coin<USDC>,
        min_tokens_out: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!vault.paused, E_PAUSED);

        let usdc_amount = coin::value(&usdc_coin);
        let settings = sui_factory::settings(factory);
        let min_deposit = sui_types::settings_min_deposit_usdc(settings);

        assert!(usdc_amount >= min_deposit, E_MIN_DEPOSIT);

        // Note: max_buy_bps is available via get_max_buy_usdc() view function
        // but not enforced in buy() - matching EVM behavior

        let buyer = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock) / 1000;

        // Get current NAV
        let total_assets = get_total_assets(vault);
        let nav = calculate_nav_internal(vault, factory, total_assets);

        // Update TWAP
        update_twap_internal(vault, nav, current_time);

        // Get smoothed NAV for buy price protection
        let smoothed_nav = get_smoothed_nav_internal(vault, nav, current_time);

        // Calculate trading fee
        let trading_fee_bps = sui_types::settings_trading_fee_bps(settings);
        let fee_amount = sui_math::mul_div(usdc_amount, trading_fee_bps, sui_types::bps());
        let net_amount = usdc_amount - fee_amount;

        // Get effective virtual reserves based on tier
        let (eff_virtual_base, eff_virtual_tokens) = get_effective_virtuals(vault, factory, total_assets);

        // Calculate virtual base in USDC terms
        let virtual_base_usdc = sui_math::calculate_virtual_base_usdc(eff_virtual_base, smoothed_nav);

        // Calculate tokens out using bonding curve
        let tokens_out = sui_math::calculate_tokens_out(
            virtual_base_usdc,
            eff_virtual_tokens,
            sui_math::usdc_to_internal(net_amount),
        );

        assert!(tokens_out > 0, E_ZERO_TOKENS);
        assert!(tokens_out >= min_tokens_out, E_SLIPPAGE_EXCEEDED);

        // Calculate buy price
        let price = sui_math::mul_div(
            sui_math::usdc_to_internal(net_amount),
            sui_types::precision(),
            tokens_out,
        );

        // Deposit USDC to reserve
        let usdc_balance = coin::into_balance(usdc_coin);
        balance::join(&mut vault.usdc_reserve, usdc_balance);

        // Update supply (tokens are conceptually minted)
        vault.total_supply = vault.total_supply + tokens_out;

        // Update accounting
        vault.total_deposits = vault.total_deposits + usdc_amount;
        vault.total_volume = vault.total_volume + usdc_amount;

        // Track purchase info for exit fee
        update_user_purchase_info(vault, buyer, tokens_out, current_time);

        // Track entry NAV for performance fee
        update_entry_record(vault, buyer, tokens_out, smoothed_nav);

        event::emit(TokenBought {
            vault_id: object::id(vault),
            buyer,
            usdc_in: usdc_amount,
            tokens_out,
            price,
            nav: smoothed_nav,
        });

        // Create VaultShare object and transfer to buyer
        let vault_share = VaultShare {
            id: object::new(ctx),
            vault_id: object::id(vault),
            amount: tokens_out,
            entry_nav: smoothed_nav,
            acquired_at: current_time,
        };
        transfer::transfer(vault_share, buyer);
    }

    // ============ Sell Function ============

    /// Sell vault tokens for USDC
    /// If insufficient liquidity, creates a pending sell
    public entry fun sell<USDC>(
        vault: &mut SuiVault<USDC>,
        factory: &SuiFactory,
        token_amount: u64,
        min_usdc_out: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!vault.paused, E_PAUSED);
        assert!(token_amount > 0, E_INVALID_AMOUNT);

        let seller = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock) / 1000;

        // Check no existing pending sell
        assert!(!table::contains(&vault.pending_sells, seller), E_PENDING_SELL_EXISTS);

        // Get current NAV
        let total_assets = get_total_assets(vault);
        let nav = calculate_nav_internal(vault, factory, total_assets);

        // Update TWAP
        update_twap_internal(vault, nav, current_time);

        // Get smoothed NAV for sell price protection
        let smoothed_nav = get_smoothed_nav_internal(vault, nav, current_time);

        // Calculate performance fee
        let performance_fee_tokens = calculate_performance_fee_internal(
            vault,
            seller,
            token_amount,
            smoothed_nav,
        );

        // Get effective virtual reserves
        let (eff_virtual_base, eff_virtual_tokens) = get_effective_virtuals(vault, factory, total_assets);

        // Calculate virtual base in USDC terms
        let virtual_base_usdc = sui_math::calculate_virtual_base_usdc(eff_virtual_base, smoothed_nav);

        // Calculate USDC out using bonding curve
        let gross_usdc_internal = sui_math::calculate_usdc_out(
            virtual_base_usdc,
            eff_virtual_tokens,
            token_amount,
        );
        let gross_usdc = sui_math::internal_to_usdc(gross_usdc_internal);

        // Calculate exit fee
        let exit_fee_bps = get_exit_fee_bps(vault, factory, seller, current_time);
        let exit_fee = sui_math::mul_div(gross_usdc, exit_fee_bps, sui_types::bps());

        // Calculate trading fee
        let settings = sui_factory::settings(factory);
        let trading_fee_bps = sui_types::settings_trading_fee_bps(settings);
        let trading_fee = sui_math::mul_div(gross_usdc, trading_fee_bps, sui_types::bps());

        let net_usdc = gross_usdc - exit_fee - trading_fee;
        assert!(net_usdc >= min_usdc_out, E_SLIPPAGE_EXCEEDED);

        // Burn seller's tokens (reduce supply)
        vault.total_supply = vault.total_supply - token_amount;

        // Update purchase info
        reduce_user_purchase_info(vault, seller, token_amount);

        // Update entry record
        reduce_entry_record(vault, seller, token_amount);

        // Mint performance fee tokens to leader
        if (performance_fee_tokens > 0) {
            // Copy leader address before mutable operations
            let leader_addr = vault.leader;

            vault.total_supply = vault.total_supply + performance_fee_tokens;

            // Track leader's entry at current NAV
            update_entry_record(vault, leader_addr, performance_fee_tokens, smoothed_nav);
            update_user_purchase_info(vault, leader_addr, performance_fee_tokens, current_time);

            event::emit(PerformanceFeeMinted {
                vault_id: object::id(vault),
                leader: leader_addr,
                fee_tokens: performance_fee_tokens,
                seller,
            });
        };

        // Update volume
        vault.total_volume = vault.total_volume + gross_usdc;

        // Calculate sell price
        let price = sui_math::mul_div(
            gross_usdc_internal,
            sui_types::precision(),
            token_amount,
        );

        // Check liquidity and payout
        let available_usdc = balance::value(&vault.usdc_reserve) - vault.total_ps_usdc;

        if (net_usdc <= available_usdc) {
            // Immediate payout
            let payout = coin::take(&mut vault.usdc_reserve, net_usdc, ctx);
            transfer::public_transfer(payout, seller);

            event::emit(TokenSold {
                vault_id: object::id(vault),
                seller,
                tokens_in: token_amount,
                usdc_out: net_usdc,
                price,
                nav: smoothed_nav,
                exit_fee,
                performance_fee_tokens,
            });
        } else {
            // Create pending sell
            let ps = sui_types::new_pending_sell(net_usdc, exit_fee + trading_fee, current_time);
            table::add(&mut vault.pending_sells, seller, ps);
            vault.total_ps_usdc = vault.total_ps_usdc + net_usdc;

            event::emit(PendingSellCreated {
                vault_id: object::id(vault),
                seller,
                usdc_amount: net_usdc,
                fee_amount: exit_fee + trading_fee,
            });

            event::emit(TokenSold {
                vault_id: object::id(vault),
                seller,
                tokens_in: token_amount,
                usdc_out: 0, // Will be claimed later
                price,
                nav: smoothed_nav,
                exit_fee,
                performance_fee_tokens,
            });
        }
    }

    // ============ Sell with VaultShare ============

    /// Sell vault shares using VaultShare object
    /// This is the preferred way to sell - requires actual ownership of VaultShare
    public entry fun sell_shares<USDC>(
        vault: &mut SuiVault<USDC>,
        factory: &SuiFactory,
        share: VaultShare,
        min_usdc_out: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!vault.paused, E_PAUSED);

        // Verify share belongs to this vault
        assert!(share.vault_id == object::id(vault), E_NOT_AUTHORIZED);

        let VaultShare { id, vault_id: _, amount: token_amount, entry_nav, acquired_at } = share;
        object::delete(id);

        assert!(token_amount > 0, E_INVALID_AMOUNT);

        let seller = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock) / 1000;

        // Check no existing pending sell
        assert!(!table::contains(&vault.pending_sells, seller), E_PENDING_SELL_EXISTS);

        // Get current NAV
        let total_assets = get_total_assets(vault);
        let nav = calculate_nav_internal(vault, factory, total_assets);

        // Update TWAP
        update_twap_internal(vault, nav, current_time);

        // Get smoothed NAV for sell price protection
        let smoothed_nav = get_smoothed_nav_internal(vault, nav, current_time);

        // Calculate performance fee using the share's entry_nav
        let performance_fee_tokens = if (smoothed_nav > entry_nav && vault.performance_fee_bps > 0) {
            let profit_per_token = smoothed_nav - entry_nav;
            let total_profit = sui_math::mul_div(token_amount, profit_per_token, sui_types::precision());
            let fee_value = sui_math::mul_div(total_profit, vault.performance_fee_bps, sui_types::bps());
            sui_math::mul_div(fee_value, sui_types::precision(), smoothed_nav)
        } else {
            0
        };

        // Get effective virtual reserves
        let (eff_virtual_base, eff_virtual_tokens) = get_effective_virtuals(vault, factory, total_assets);

        // Calculate virtual base in USDC terms
        let virtual_base_usdc = sui_math::calculate_virtual_base_usdc(eff_virtual_base, smoothed_nav);

        // Calculate USDC out using bonding curve
        let gross_usdc_internal = sui_math::calculate_usdc_out(
            virtual_base_usdc,
            eff_virtual_tokens,
            token_amount,
        );
        let gross_usdc = sui_math::internal_to_usdc(gross_usdc_internal);

        // Calculate exit fee based on holding time from share's acquired_at
        let days_held = (current_time - acquired_at) / 86400;
        let exit_fee_bps = sui_factory::get_exit_fee_bps(factory, days_held);
        let exit_fee = sui_math::mul_div(gross_usdc, exit_fee_bps, sui_types::bps());

        // Calculate trading fee
        let settings = sui_factory::settings(factory);
        let trading_fee_bps = sui_types::settings_trading_fee_bps(settings);
        let trading_fee = sui_math::mul_div(gross_usdc, trading_fee_bps, sui_types::bps());

        let net_usdc = gross_usdc - exit_fee - trading_fee;
        assert!(net_usdc >= min_usdc_out, E_SLIPPAGE_EXCEEDED);

        // Burn seller's tokens (reduce supply)
        vault.total_supply = vault.total_supply - token_amount;

        // Mint performance fee tokens to leader
        if (performance_fee_tokens > 0) {
            let leader_addr = vault.leader;
            vault.total_supply = vault.total_supply + performance_fee_tokens;

            // Create VaultShare for leader
            let leader_share = VaultShare {
                id: object::new(ctx),
                vault_id: object::id(vault),
                amount: performance_fee_tokens,
                entry_nav: smoothed_nav,
                acquired_at: current_time,
            };
            transfer::transfer(leader_share, leader_addr);

            event::emit(PerformanceFeeMinted {
                vault_id: object::id(vault),
                leader: leader_addr,
                fee_tokens: performance_fee_tokens,
                seller,
            });
        };

        // Update volume
        vault.total_volume = vault.total_volume + gross_usdc;

        // Calculate sell price
        let price = sui_math::mul_div(
            gross_usdc_internal,
            sui_types::precision(),
            token_amount,
        );

        // Check liquidity and payout
        let available_usdc = balance::value(&vault.usdc_reserve) - vault.total_ps_usdc;

        if (net_usdc <= available_usdc) {
            // Immediate payout
            let payout = coin::take(&mut vault.usdc_reserve, net_usdc, ctx);
            transfer::public_transfer(payout, seller);

            event::emit(TokenSold {
                vault_id: object::id(vault),
                seller,
                tokens_in: token_amount,
                usdc_out: net_usdc,
                price,
                nav: smoothed_nav,
                exit_fee,
                performance_fee_tokens,
            });
        } else {
            // Create pending sell
            let ps = sui_types::new_pending_sell(net_usdc, exit_fee + trading_fee, current_time);
            table::add(&mut vault.pending_sells, seller, ps);
            vault.total_ps_usdc = vault.total_ps_usdc + net_usdc;

            event::emit(PendingSellCreated {
                vault_id: object::id(vault),
                seller,
                usdc_amount: net_usdc,
                fee_amount: exit_fee + trading_fee,
            });

            event::emit(TokenSold {
                vault_id: object::id(vault),
                seller,
                tokens_in: token_amount,
                usdc_out: 0,
                price,
                nav: smoothed_nav,
                exit_fee,
                performance_fee_tokens,
            });
        }
    }

    // ============ VaultShare Utilities ============

    /// Merge multiple VaultShare objects into one
    public entry fun merge_shares(
        share1: &mut VaultShare,
        share2: VaultShare,
    ) {
        assert!(share1.vault_id == share2.vault_id, E_NOT_AUTHORIZED);

        let VaultShare { id, vault_id: _, amount, entry_nav, acquired_at } = share2;
        object::delete(id);

        // Weighted average entry_nav
        let total_amount = share1.amount + amount;
        if (total_amount > 0) {
            let numerator = (share1.entry_nav as u128) * (share1.amount as u128) +
                (entry_nav as u128) * (amount as u128);
            share1.entry_nav = ((numerator / (total_amount as u128)) as u64);
            // Use earlier acquired_at for more conservative exit fee calculation
            if (acquired_at < share1.acquired_at) {
                share1.acquired_at = acquired_at;
            };
        };
        share1.amount = total_amount;
    }

    /// Split a VaultShare into two
    public fun split_share(
        share: &mut VaultShare,
        split_amount: u64,
        ctx: &mut TxContext,
    ): VaultShare {
        assert!(share.amount >= split_amount, E_INVALID_AMOUNT);
        share.amount = share.amount - split_amount;

        VaultShare {
            id: object::new(ctx),
            vault_id: share.vault_id,
            amount: split_amount,
            entry_nav: share.entry_nav,
            acquired_at: share.acquired_at,
        }
    }

    /// Get VaultShare info
    public fun share_vault_id(share: &VaultShare): ID { share.vault_id }
    public fun share_amount(share: &VaultShare): u64 { share.amount }
    public fun share_entry_nav(share: &VaultShare): u64 { share.entry_nav }
    public fun share_acquired_at(share: &VaultShare): u64 { share.acquired_at }

    // ============ Claim Pending Sell ============

    /// Claim USDC from a pending sell
    public entry fun claim_pending_sell<USDC>(
        vault: &mut SuiVault<USDC>,
        ctx: &mut TxContext,
    ) {
        let claimer = tx_context::sender(ctx);
        assert!(table::contains(&vault.pending_sells, claimer), E_NO_PENDING_SELL);

        let ps = table::remove(&mut vault.pending_sells, claimer);
        let usdc_amount = sui_types::ps_usdc_amount(&ps);

        // Check liquidity
        let available = balance::value(&vault.usdc_reserve);
        assert!(available >= usdc_amount, E_INSUFFICIENT_LIQUIDITY);

        // Update pending sell tracking
        vault.total_ps_usdc = vault.total_ps_usdc - usdc_amount;

        // Payout
        let payout = coin::take(&mut vault.usdc_reserve, usdc_amount, ctx);
        transfer::public_transfer(payout, claimer);

        event::emit(PendingSellClaimed {
            vault_id: object::id(vault),
            claimer,
            usdc_amount,
        });
    }

    // ============ Internal Functions ============

    /// Get total assets (USDC reserve in internal format)
    fun get_total_assets<USDC>(vault: &SuiVault<USDC>): u64 {
        sui_math::usdc_to_internal(balance::value(&vault.usdc_reserve))
    }

    /// Calculate NAV using factory tiers
    fun calculate_nav_internal<USDC>(
        vault: &SuiVault<USDC>,
        factory: &SuiFactory,
        total_assets: u64,
    ): u64 {
        let (_, _, nav_min_mul, nav_max_mul, _) = sui_factory::get_tier_for_assets(factory, total_assets);

        let nav_virtual = sui_math::calculate_tiered_nav_virtual(
            total_assets,
            vault.initial_assets,
            nav_min_mul,
            nav_max_mul,
            vault.initial_assets,
        );

        sui_math::calculate_nav(total_assets, vault.total_supply, nav_virtual)
    }

    /// Update TWAP NAV
    fun update_twap_internal<USDC>(
        vault: &mut SuiVault<USDC>,
        instant_nav: u64,
        current_time: u64,
    ) {
        let elapsed = if (current_time > vault.twap_nav_time) {
            current_time - vault.twap_nav_time
        } else {
            0
        };

        // Only update if NAV increased or time passed
        if (instant_nav >= vault.twap_nav) {
            vault.twap_nav = instant_nav;
        } else if (elapsed > 0) {
            vault.twap_nav = sui_math::calculate_smoothed_nav(
                instant_nav,
                vault.twap_nav,
                elapsed,
                vault.twap_half_life,
            );
        };

        vault.twap_nav_time = current_time;

        event::emit(NavUpdated {
            vault_id: object::id(vault),
            instant_nav,
            twap_nav: vault.twap_nav,
            total_assets: get_total_assets(vault),
            total_supply: vault.total_supply,
        });
    }

    /// Get smoothed NAV for price calculations
    fun get_smoothed_nav_internal<USDC>(
        vault: &SuiVault<USDC>,
        instant_nav: u64,
        current_time: u64,
    ): u64 {
        let elapsed = if (current_time > vault.twap_nav_time) {
            current_time - vault.twap_nav_time
        } else {
            0
        };

        sui_math::calculate_smoothed_nav(
            instant_nav,
            vault.twap_nav,
            elapsed,
            vault.twap_half_life,
        )
    }

    /// Get effective virtual reserves based on graduation tier
    fun get_effective_virtuals<USDC>(
        vault: &SuiVault<USDC>,
        factory: &SuiFactory,
        total_assets: u64,
    ): (u64, u64) {
        let (threshold, bc_virtual, _, _, squared_ratio) = sui_factory::get_tier_for_assets(factory, total_assets);

        let eff_bc_virtual = sui_math::calculate_effective_bc_virtual(
            total_assets,
            bc_virtual,
            threshold,
            squared_ratio,
        );

        // Both virtual base and tokens scale together
        (eff_bc_virtual, eff_bc_virtual)
    }

    /// Calculate performance fee tokens
    fun calculate_performance_fee_internal<USDC>(
        vault: &SuiVault<USDC>,
        seller: address,
        tokens_selling: u64,
        current_nav: u64,
    ): u64 {
        if (!table::contains(&vault.entry_records, seller)) {
            return 0
        };

        let entry_record = table::borrow(&vault.entry_records, seller);
        let entry_nav = sui_types::entry_weighted_nav(entry_record);

        sui_math::calculate_performance_fee(
            tokens_selling,
            current_nav,
            entry_nav,
            vault.performance_fee_bps,
        )
    }

    /// Get exit fee for user
    fun get_exit_fee_bps<USDC>(
        vault: &SuiVault<USDC>,
        factory: &SuiFactory,
        user: address,
        current_time: u64,
    ): u64 {
        if (!table::contains(&vault.user_purchase_info, user)) {
            return 0
        };

        let purchase_info = table::borrow(&vault.user_purchase_info, user);
        let weighted_timestamp = sui_types::purchase_weighted_timestamp(purchase_info);
        let days_held = sui_math::calculate_days_held(weighted_timestamp, current_time);

        sui_factory::get_exit_fee_bps(factory, days_held)
    }

    /// Update user purchase info
    fun update_user_purchase_info<USDC>(
        vault: &mut SuiVault<USDC>,
        user: address,
        new_tokens: u64,
        current_time: u64,
    ) {
        if (table::contains(&vault.user_purchase_info, user)) {
            let info = table::borrow_mut(&mut vault.user_purchase_info, user);
            sui_types::update_purchase_info(info, new_tokens, current_time);
        } else {
            let info = sui_types::new_user_purchase_info(new_tokens, current_time, current_time);
            table::add(&mut vault.user_purchase_info, user, info);
        }
    }

    /// Reduce user purchase tokens
    fun reduce_user_purchase_info<USDC>(
        vault: &mut SuiVault<USDC>,
        user: address,
        tokens_sold: u64,
    ) {
        if (table::contains(&vault.user_purchase_info, user)) {
            let info = table::borrow_mut(&mut vault.user_purchase_info, user);
            sui_types::reduce_purchase_tokens(info, tokens_sold);
        }
    }

    /// Update entry record
    fun update_entry_record<USDC>(
        vault: &mut SuiVault<USDC>,
        user: address,
        new_tokens: u64,
        entry_nav: u64,
    ) {
        if (table::contains(&vault.entry_records, user)) {
            let record = table::borrow_mut(&mut vault.entry_records, user);
            sui_types::update_entry_record(record, new_tokens, entry_nav);
        } else {
            let record = sui_types::new_entry_record(entry_nav, new_tokens);
            table::add(&mut vault.entry_records, user, record);
        }
    }

    /// Reduce entry record tokens
    fun reduce_entry_record<USDC>(
        vault: &mut SuiVault<USDC>,
        user: address,
        tokens_sold: u64,
    ) {
        if (table::contains(&vault.entry_records, user)) {
            let record = table::borrow_mut(&mut vault.entry_records, user);
            sui_types::reduce_entry_tokens(record, tokens_sold);
        }
    }

    // ============ View Functions ============

    /// Get vault ID from leader cap
    public fun leader_cap_vault_id(cap: &SuiLeaderCap): ID {
        cap.vault_id
    }

    /// Get vault ID
    public fun id<USDC>(vault: &SuiVault<USDC>): ID {
        object::id(vault)
    }

    /// Get leader address
    public fun leader<USDC>(vault: &SuiVault<USDC>): address {
        vault.leader
    }

    /// Get admin address
    public fun admin<USDC>(vault: &SuiVault<USDC>): address {
        vault.admin
    }

    /// Get total supply
    public fun total_supply<USDC>(vault: &SuiVault<USDC>): u64 {
        vault.total_supply
    }

    /// Get USDC reserve balance
    public fun usdc_reserve<USDC>(vault: &SuiVault<USDC>): u64 {
        balance::value(&vault.usdc_reserve)
    }

    /// Get performance fee
    public fun performance_fee_bps<USDC>(vault: &SuiVault<USDC>): u64 {
        vault.performance_fee_bps
    }

    /// Get vault name
    public fun name<USDC>(vault: &SuiVault<USDC>): String {
        vault.name
    }

    /// Get vault symbol
    public fun symbol<USDC>(vault: &SuiVault<USDC>): String {
        vault.symbol
    }

    /// Check if vault is paused
    public fun is_paused<USDC>(vault: &SuiVault<USDC>): bool {
        vault.paused
    }

    /// Get current TWAP NAV
    public fun twap_nav<USDC>(vault: &SuiVault<USDC>): u64 {
        vault.twap_nav
    }

    /// Get total deposits
    public fun total_deposits<USDC>(vault: &SuiVault<USDC>): u64 {
        vault.total_deposits
    }

    /// Get total volume
    public fun total_volume<USDC>(vault: &SuiVault<USDC>): u64 {
        vault.total_volume
    }

    /// Get pending sell amount for user
    public fun pending_sell_amount<USDC>(vault: &SuiVault<USDC>, user: address): u64 {
        if (table::contains(&vault.pending_sells, user)) {
            sui_types::ps_usdc_amount(table::borrow(&vault.pending_sells, user))
        } else {
            0
        }
    }

    /// Get user's entry NAV
    public fun user_entry_nav<USDC>(vault: &SuiVault<USDC>, user: address): u64 {
        if (table::contains(&vault.entry_records, user)) {
            sui_types::entry_weighted_nav(table::borrow(&vault.entry_records, user))
        } else {
            sui_types::precision()
        }
    }

    /// Get maximum USDC that can be bought in a single transaction (view function)
    /// This is informational - not enforced in buy() to match EVM behavior
    public fun get_max_buy_usdc<USDC>(vault: &SuiVault<USDC>, factory: &SuiFactory): u64 {
        let settings = sui_factory::settings(factory);
        let min_deposit = sui_types::settings_min_deposit_usdc(settings);
        let max_buy_bps = sui_types::settings_max_buy_bps(settings);

        let total_assets = get_total_assets(vault);
        if (total_assets == 0 || max_buy_bps == 0) {
            return min_deposit
        };

        let max_buy = sui_math::mul_div(total_assets, max_buy_bps, sui_types::bps());
        let max_buy_usdc = sui_math::internal_to_usdc(max_buy);

        if (max_buy_usdc > min_deposit) { max_buy_usdc } else { min_deposit }
    }

    /// Get user's token balance in entry record
    public fun user_entry_tokens<USDC>(vault: &SuiVault<USDC>, user: address): u64 {
        if (table::contains(&vault.entry_records, user)) {
            sui_types::entry_total_tokens(table::borrow(&vault.entry_records, user))
        } else {
            0
        }
    }

    // ============ Leader Functions ============

    /// Set vault paused state (leader only)
    public entry fun set_paused<USDC>(
        leader_cap: &SuiLeaderCap,
        vault: &mut SuiVault<USDC>,
        paused: bool,
    ) {
        assert!(leader_cap.vault_id == object::id(vault), E_NOT_AUTHORIZED);
        vault.paused = paused;
    }

    /// Set metadata URI (leader only)
    public entry fun set_metadata_uri<USDC>(
        leader_cap: &SuiLeaderCap,
        vault: &mut SuiVault<USDC>,
        uri: vector<u8>,
    ) {
        assert!(leader_cap.vault_id == object::id(vault), E_NOT_AUTHORIZED);
        vault.metadata_uri = string::utf8(uri);
    }

    // ============ Admin Functions ============

    /// Set vault admin (factory admin only)
    public entry fun set_admin<USDC>(
        _admin_cap: &SuiAdminCap,
        vault: &mut SuiVault<USDC>,
        new_admin: address,
    ) {
        vault.admin = new_admin;
    }

    /// Emergency pause (factory admin only)
    public entry fun emergency_pause<USDC>(
        _admin_cap: &SuiAdminCap,
        vault: &mut SuiVault<USDC>,
    ) {
        vault.paused = true;
    }

    /// Set TWAP half-life (factory admin only)
    public entry fun set_twap_half_life<USDC>(
        _admin_cap: &SuiAdminCap,
        vault: &mut SuiVault<USDC>,
        half_life: u64,
    ) {
        vault.twap_half_life = half_life;
    }

    // ============ Trading Helper Functions ============
    // These functions are called by sui_deepbook module for Leader trading

    /// Extract USDC from vault for trading (called by sui_deepbook module)
    /// NOTE: This is a friend function - only sui_deepbook can call it
    public(package) fun extract_usdc_for_trading<USDC>(
        vault: &mut SuiVault<USDC>,
        amount: u64,
        ctx: &mut TxContext,
    ): Coin<USDC> {
        assert!(balance::value(&vault.usdc_reserve) >= amount, E_INSUFFICIENT_LIQUIDITY);

        let withdrawn = balance::split(&mut vault.usdc_reserve, amount);
        coin::from_balance(withdrawn, ctx)
    }

    /// Deposit USDC back to vault after trading (called by sui_deepbook module)
    public(package) fun deposit_usdc_from_trading<USDC>(
        vault: &mut SuiVault<USDC>,
        coin: Coin<USDC>,
    ) {
        let coin_balance = coin::into_balance(coin);
        balance::join(&mut vault.usdc_reserve, coin_balance);
    }

    /// Get available USDC for trading (excluding pending sells)
    public fun available_usdc_for_trading<USDC>(vault: &SuiVault<USDC>): u64 {
        let total = balance::value(&vault.usdc_reserve);
        if (total > vault.total_ps_usdc) {
            total - vault.total_ps_usdc
        } else {
            0
        }
    }
}
