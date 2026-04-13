/// SUI HypersFun - Factory Module
/// 管理 Vault 創建、全域設定、Graduation Tiers
#[allow(unused_field)]
module sui_hypersfun::sui_factory {
    use sui::table::{Self, Table};
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::string::{Self, String};

    use sui_hypersfun::sui_types::{
        Self,
        GraduationTier,
        ExitFeeTier,
        GlobalSettings,
        VaultInfo,
    };

    // ============ Error Codes ============

    const E_PAUSED: u64 = 2;
    const E_FEE_TOO_HIGH: u64 = 3;
    const E_INVALID_TIER: u64 = 4;
    const E_VAULT_EXISTS: u64 = 5;
    const E_VAULT_NOT_FOUND: u64 = 6;
    const E_INVALID_PARAMS: u64 = 7;

    // ============ Structs ============

    /// Admin capability - grants full control over factory
    public struct SuiAdminCap has key, store {
        id: UID,
    }

    /// Factory - shared object managing all vaults and global settings
    public struct SuiFactory has key {
        id: UID,

        // Admin and treasury
        treasury: address,

        // Global settings
        settings: GlobalSettings,

        // Default bonding curve parameters
        default_bc_virtual_base: u64,
        default_bc_virtual_tokens: u64,
        default_initial_assets: u64,

        // Graduation tiers (sorted by threshold ascending)
        graduation_tiers: vector<GraduationTier>,

        // Exit fee tiers (sorted by days_held descending)
        exit_fee_tiers: vector<ExitFeeTier>,

        // Vault registry
        vaults: Table<ID, VaultInfo>,
        vaults_by_leader: Table<address, vector<ID>>,
        total_vaults: u64,

        // Verified leaders
        verified_leaders: Table<address, bool>,

        // Creation fee (in USDC, 6 decimals)
        creation_fee: u64,

        // Paused state
        paused: bool,

        // Protocol version
        version: u64,
    }

    // ============ Events ============

    public struct FactoryCreated has copy, drop {
        factory_id: ID,
        admin: address,
        treasury: address,
    }

    public struct VaultRegistered has copy, drop {
        vault_id: ID,
        leader: address,
        name: String,
        symbol: String,
        performance_fee_bps: u64,
    }

    public struct SettingsUpdated has copy, drop {
        factory_id: ID,
        trading_fee_bps: u64,
        min_deposit_usdc: u64,
    }

    public struct GraduationTierAdded has copy, drop {
        factory_id: ID,
        threshold: u64,
        bc_virtual: u64,
    }

    public struct LeaderVerified has copy, drop {
        leader: address,
        verified: bool,
    }

    // ============ Initialization ============

    /// One-time witness for factory initialization
    public struct SUI_FACTORY has drop {}

    /// Initialize factory - called once on package publish
    fun init(witness: SUI_FACTORY, ctx: &mut TxContext) {
        let _ = witness;

        let admin = tx_context::sender(ctx);

        // Create admin capability
        let admin_cap = SuiAdminCap {
            id: object::new(ctx),
        };

        // Create factory with default settings
        // BC Virtual values use 6-decimal precision (same as USDC)
        // 2M = 2,000,000 * 1e6 = 2,000,000,000,000 = 2e12
        let factory = SuiFactory {
            id: object::new(ctx),
            treasury: admin,
            settings: sui_types::default_global_settings(),
            default_bc_virtual_base: 2_000_000_000_000, // 2M (6 decimals) - matches EVM 2M * 1e18
            default_bc_virtual_tokens: 2_000_000_000_000, // 2M (6 decimals)
            default_initial_assets: 100_000_000_000, // 100K USDC (6 decimals)
            graduation_tiers: vector::empty(),
            exit_fee_tiers: default_exit_fee_tiers(),
            vaults: table::new(ctx),
            vaults_by_leader: table::new(ctx),
            total_vaults: 0,
            verified_leaders: table::new(ctx),
            creation_fee: 0,
            paused: false,
            version: 1,
        };

        let factory_id = object::id(&factory);

        event::emit(FactoryCreated {
            factory_id,
            admin,
            treasury: admin,
        });

        // Transfer admin cap to deployer
        transfer::transfer(admin_cap, admin);

        // Share factory as a shared object
        transfer::share_object(factory);
    }

    /// Create default exit fee tiers
    /// <7 days: 15%, 7-30 days: 8%, 30-90 days: 3%, >90 days: 0%
    fun default_exit_fee_tiers(): vector<ExitFeeTier> {
        let mut tiers = vector::empty<ExitFeeTier>();
        vector::push_back(&mut tiers, sui_types::new_exit_fee_tier(0, 1500));   // <7d: 15%
        vector::push_back(&mut tiers, sui_types::new_exit_fee_tier(7, 800));    // 7-30d: 8%
        vector::push_back(&mut tiers, sui_types::new_exit_fee_tier(30, 300));   // 30-90d: 3%
        vector::push_back(&mut tiers, sui_types::new_exit_fee_tier(90, 0));     // >90d: 0%
        tiers
    }

    // ============ Vault Registration ============

    /// Register a new vault in the factory
    /// Called by sui_vault module after vault creation
    public fun register_vault(
        factory: &mut SuiFactory,
        vault_id: ID,
        leader: address,
        name: vector<u8>,
        symbol: vector<u8>,
        performance_fee_bps: u64,
        clock: &Clock,
        _ctx: &mut TxContext,
    ) {
        assert!(!factory.paused, E_PAUSED);
        assert!(performance_fee_bps <= sui_types::max_performance_fee_bps(), E_FEE_TOO_HIGH);
        assert!(!table::contains(&factory.vaults, vault_id), E_VAULT_EXISTS);

        let created_at = clock::timestamp_ms(clock) / 1000;
        let is_verified = table::contains(&factory.verified_leaders, leader);

        let vault_info = sui_types::new_vault_info(
            leader,
            name,
            symbol,
            performance_fee_bps,
            created_at,
            is_verified,
        );

        // Add to main registry
        table::add(&mut factory.vaults, vault_id, vault_info);

        // Add to leader's vault list
        if (!table::contains(&factory.vaults_by_leader, leader)) {
            table::add(&mut factory.vaults_by_leader, leader, vector::empty<ID>());
        };
        let leader_vaults = table::borrow_mut(&mut factory.vaults_by_leader, leader);
        vector::push_back(leader_vaults, vault_id);

        factory.total_vaults = factory.total_vaults + 1;

        event::emit(VaultRegistered {
            vault_id,
            leader,
            name: string::utf8(name),
            symbol: string::utf8(symbol),
            performance_fee_bps,
        });
    }

    // ============ Admin Functions ============

    /// Set treasury address
    public fun set_treasury(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        new_treasury: address,
    ) {
        factory.treasury = new_treasury;
    }

    /// Set creation fee
    public fun set_creation_fee(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        fee: u64,
    ) {
        factory.creation_fee = fee;
    }

    /// Pause/unpause factory
    public fun set_paused(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        paused: bool,
    ) {
        factory.paused = paused;
    }

    /// Update global trading fee
    public fun set_trading_fee(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        fee_bps: u64,
    ) {
        assert!(fee_bps <= sui_types::bps(), E_FEE_TOO_HIGH);
        factory.settings = sui_types::new_global_settings_with_trading_fee(&factory.settings, fee_bps);
    }

    /// Set minimum deposit
    public fun set_min_deposit(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        min_deposit_usdc: u64,
    ) {
        factory.settings = sui_types::new_global_settings_with_min_deposit(&factory.settings, min_deposit_usdc);
    }

    /// Set rebalance thresholds
    public fun set_rebalance_thresholds(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        low_bps: u64,
        high_bps: u64,
        target_bps: u64,
    ) {
        assert!(low_bps < high_bps, E_INVALID_PARAMS);
        assert!(target_bps >= low_bps && target_bps <= high_bps, E_INVALID_PARAMS);

        factory.settings = sui_types::new_global_settings_with_rebalance(
            &factory.settings,
            low_bps,
            high_bps,
            target_bps,
        );
    }

    /// Set max buy per transaction (% of vault assets)
    /// @param max_buy_bps: Maximum buy in basis points (100 = 1%, 0 = disabled)
    public fun set_max_buy_bps(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        max_buy_bps: u64,
    ) {
        // 0 = disabled, otherwise must be between 0.1% and 10%
        assert!(max_buy_bps == 0 || (max_buy_bps >= 10 && max_buy_bps <= 1000), E_INVALID_PARAMS);
        factory.settings = sui_types::new_global_settings_with_max_buy(&factory.settings, max_buy_bps);
    }

    /// Set default bonding curve parameters
    public fun set_default_bc_params(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        virtual_base: u64,
        virtual_tokens: u64,
        initial_assets: u64,
    ) {
        factory.default_bc_virtual_base = virtual_base;
        factory.default_bc_virtual_tokens = virtual_tokens;
        factory.default_initial_assets = initial_assets;
    }

    /// Add a graduation tier
    public fun add_graduation_tier(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        threshold: u64,
        bc_virtual: u64,
        nav_min_mul_bps: u64,
        nav_max_mul_bps: u64,
        squared_ratio_bps: u64,
    ) {
        assert!(nav_min_mul_bps <= nav_max_mul_bps, E_INVALID_TIER);

        let tier = sui_types::new_graduation_tier(
            threshold,
            bc_virtual,
            nav_min_mul_bps,
            nav_max_mul_bps,
            squared_ratio_bps,
        );

        // Insert in sorted order by threshold
        let len = vector::length(&factory.graduation_tiers);
        let mut i = 0;
        while (i < len) {
            let existing = vector::borrow(&factory.graduation_tiers, i);
            if (threshold < sui_types::tier_threshold(existing)) {
                break
            };
            i = i + 1;
        };

        vector::insert(&mut factory.graduation_tiers, tier, i);

        event::emit(GraduationTierAdded {
            factory_id: object::id(factory),
            threshold,
            bc_virtual,
        });
    }

    /// Clear all graduation tiers
    public fun clear_graduation_tiers(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
    ) {
        factory.graduation_tiers = vector::empty();
    }

    /// Set exit fee tiers
    public fun set_exit_fee_tiers(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        days: vector<u64>,
        fees_bps: vector<u64>,
    ) {
        let len = vector::length(&days);
        assert!(len == vector::length(&fees_bps), E_INVALID_PARAMS);

        let mut tiers = vector::empty<ExitFeeTier>();
        let mut i = 0;
        while (i < len) {
            let d = *vector::borrow(&days, i);
            let f = *vector::borrow(&fees_bps, i);
            assert!(f <= sui_types::max_exit_fee_bps(), E_FEE_TOO_HIGH);
            vector::push_back(&mut tiers, sui_types::new_exit_fee_tier(d, f));
            i = i + 1;
        };

        factory.exit_fee_tiers = tiers;
    }

    /// Verify/unverify a leader
    public fun set_leader_verified(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        leader: address,
        verified: bool,
    ) {
        if (verified) {
            if (!table::contains(&factory.verified_leaders, leader)) {
                table::add(&mut factory.verified_leaders, leader, true);
            };
        } else {
            if (table::contains(&factory.verified_leaders, leader)) {
                table::remove(&mut factory.verified_leaders, leader);
            };
        };

        event::emit(LeaderVerified { leader, verified });
    }

    /// Set vault verified status
    public fun set_vault_verified(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
        vault_id: ID,
        verified: bool,
    ) {
        assert!(table::contains(&factory.vaults, vault_id), E_VAULT_NOT_FOUND);
        let vault_info = table::borrow_mut(&mut factory.vaults, vault_id);
        sui_types::set_vault_verified(vault_info, verified);
    }

    // ============ View Functions ============

    /// Get factory ID
    public fun id(factory: &SuiFactory): ID {
        object::id(factory)
    }

    /// Get treasury address
    public fun treasury(factory: &SuiFactory): address {
        factory.treasury
    }

    /// Get global settings
    public fun settings(factory: &SuiFactory): &GlobalSettings {
        &factory.settings
    }

    /// Get creation fee
    public fun creation_fee(factory: &SuiFactory): u64 {
        factory.creation_fee
    }

    /// Check if factory is paused
    public fun is_paused(factory: &SuiFactory): bool {
        factory.paused
    }

    /// Get total vault count
    public fun total_vaults(factory: &SuiFactory): u64 {
        factory.total_vaults
    }

    /// Get vault info by ID
    public fun get_vault_info(factory: &SuiFactory, vault_id: ID): &VaultInfo {
        assert!(table::contains(&factory.vaults, vault_id), E_VAULT_NOT_FOUND);
        table::borrow(&factory.vaults, vault_id)
    }

    /// Check if vault exists
    public fun vault_exists(factory: &SuiFactory, vault_id: ID): bool {
        table::contains(&factory.vaults, vault_id)
    }

    /// Get vaults by leader
    public fun get_leader_vaults(factory: &SuiFactory, leader: address): vector<ID> {
        if (table::contains(&factory.vaults_by_leader, leader)) {
            *table::borrow(&factory.vaults_by_leader, leader)
        } else {
            vector::empty()
        }
    }

    /// Check if leader is verified
    public fun is_leader_verified(factory: &SuiFactory, leader: address): bool {
        table::contains(&factory.verified_leaders, leader)
    }

    /// Get default BC parameters
    public fun default_bc_params(factory: &SuiFactory): (u64, u64, u64) {
        (
            factory.default_bc_virtual_base,
            factory.default_bc_virtual_tokens,
            factory.default_initial_assets,
        )
    }

    /// Get graduation tiers
    public fun graduation_tiers(factory: &SuiFactory): &vector<GraduationTier> {
        &factory.graduation_tiers
    }

    /// Get exit fee tiers
    public fun exit_fee_tiers(factory: &SuiFactory): &vector<ExitFeeTier> {
        &factory.exit_fee_tiers
    }

    /// Get graduation tier for given assets
    public fun get_tier_for_assets(
        factory: &SuiFactory,
        total_assets: u64,
    ): (u64, u64, u64, u64, u64) {
        let tiers = &factory.graduation_tiers;
        let len = vector::length(tiers);

        if (len == 0) {
            // Return defaults
            return (
                0, // threshold
                factory.default_bc_virtual_base,
                10000, // nav_min = 100%
                10000, // nav_max = 100%
                0,     // squared_ratio
            )
        };

        // Find applicable tier (largest threshold <= total_assets)
        let mut i = len;
        while (i > 0) {
            i = i - 1;
            let tier = vector::borrow(tiers, i);
            if (total_assets >= sui_types::tier_threshold(tier)) {
                return (
                    sui_types::tier_threshold(tier),
                    sui_types::tier_bc_virtual(tier),
                    sui_types::tier_nav_min_mul_bps(tier),
                    sui_types::tier_nav_max_mul_bps(tier),
                    sui_types::tier_squared_ratio_bps(tier),
                )
            };
        };

        // If below all tiers, use first tier
        let first = vector::borrow(tiers, 0);
        (
            sui_types::tier_threshold(first),
            sui_types::tier_bc_virtual(first),
            sui_types::tier_nav_min_mul_bps(first),
            sui_types::tier_nav_max_mul_bps(first),
            sui_types::tier_squared_ratio_bps(first),
        )
    }

    /// Get exit fee for given days held
    public fun get_exit_fee_bps(factory: &SuiFactory, days_held: u64): u64 {
        if (!sui_types::settings_exit_fee_enabled(&factory.settings)) {
            return 0
        };

        sui_hypersfun::sui_math::calculate_exit_fee_bps(days_held, &factory.exit_fee_tiers)
    }

    /// Get protocol version
    public fun version(factory: &SuiFactory): u64 {
        factory.version
    }

    // ============ Friend Functions ============

    /// Internal: Update factory version (for upgrades)
    public fun increment_version(
        _admin_cap: &SuiAdminCap,
        factory: &mut SuiFactory,
    ) {
        factory.version = factory.version + 1;
    }
}

// ============ Tests ============

#[test_only]
module sui_hypersfun::sui_factory_tests {
    use sui::test_scenario::{Self, Scenario};
    use sui::clock;
    use sui_hypersfun::sui_factory::{Self, SuiFactory, SuiAdminCap};
    use sui_hypersfun::sui_types;

    #[test]
    fun test_factory_creation() {
        let admin = @0x1;
        let mut scenario = test_scenario::begin(admin);

        // Init should create factory and admin cap
        test_scenario::next_tx(&mut scenario, admin);
        {
            sui_factory::init(sui_factory::SUI_FACTORY {}, test_scenario::ctx(&mut scenario));
        };

        // Check admin cap was transferred
        test_scenario::next_tx(&mut scenario, admin);
        {
            assert!(test_scenario::has_most_recent_for_sender<SuiAdminCap>(&scenario), 0);
        };

        // Check factory is shared
        test_scenario::next_tx(&mut scenario, admin);
        {
            let factory = test_scenario::take_shared<SuiFactory>(&scenario);
            assert!(!sui_factory::is_paused(&factory), 1);
            assert!(sui_factory::total_vaults(&factory) == 0, 2);
            test_scenario::return_shared(factory);
        };

        test_scenario::end(scenario);
    }

    #[test]
    fun test_add_graduation_tier() {
        let admin = @0x1;
        let mut scenario = test_scenario::begin(admin);

        test_scenario::next_tx(&mut scenario, admin);
        {
            sui_factory::init(sui_factory::SUI_FACTORY {}, test_scenario::ctx(&mut scenario));
        };

        test_scenario::next_tx(&mut scenario, admin);
        {
            let mut factory = test_scenario::take_shared<SuiFactory>(&scenario);
            let admin_cap = test_scenario::take_from_sender<SuiAdminCap>(&scenario);

            // Add a graduation tier
            sui_factory::add_graduation_tier(
                &admin_cap,
                &mut factory,
                1_000_000_000_000_000_000_000_000, // 1M threshold
                500_000_000_000_000_000_000_000,   // 500K bc_virtual
                5000,  // nav_min = 50%
                10000, // nav_max = 100%
                2000,  // squared_ratio = 20%
            );

            // Check tier was added
            let tiers = sui_factory::graduation_tiers(&factory);
            assert!(std::vector::length(tiers) == 1, 0);

            test_scenario::return_shared(factory);
            test_scenario::return_to_sender(&scenario, admin_cap);
        };

        test_scenario::end(scenario);
    }
}
