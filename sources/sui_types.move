/// SUI HypersFun - Shared Types Module
/// 定義所有共用的類型、常數和結構
module sui_hypersfun::sui_types {
    // ============ Constants ============

    /// Basis points denominator (10000 = 100%)
    const BPS: u64 = 10000;

    /// Precision for fixed-point math (1e6 - same as USDC decimals)
    /// Changed from 1e18 to 1e6 to allow larger values within u64 limits
    /// u64 max ≈ 1.84e19, with 1e6 precision we can represent up to ~18 trillion
    const PRECISION: u64 = 1_000_000;

    /// High precision for intermediate calculations (1e12)
    /// Used for token amounts and detailed math
    const HIGH_PRECISION: u64 = 1_000_000_000_000;

    /// Maximum performance fee (30%)
    const MAX_PERFORMANCE_FEE_BPS: u64 = 3000;

    /// Maximum exit fee (50%)
    const MAX_EXIT_FEE_BPS: u64 = 5000;

    /// Minimum API wallet duration (60 days in seconds)
    const MIN_API_WALLET_DURATION: u64 = 60 * 24 * 60 * 60;

    /// Maximum API wallet duration (180 days in seconds)
    const MAX_API_WALLET_DURATION: u64 = 180 * 24 * 60 * 60;

    /// L1 initialization fee (1 USDC = 1_000_000 in 6 decimals)
    const L1_INIT_FEE: u64 = 1_000_000;

    /// Default TWAP half-life (10 minutes in seconds)
    const DEFAULT_TWAP_HALF_LIFE: u64 = 600;

    // ============ Error Codes ============

    const E_NOT_AUTHORIZED: u64 = 1;
    const E_PAUSED: u64 = 2;
    const E_FEE_TOO_HIGH: u64 = 3;
    const E_INVALID_AMOUNT: u64 = 4;
    const E_SLIPPAGE_EXCEEDED: u64 = 5;
    const E_PENDING_SELL_EXISTS: u64 = 6;
    const E_NO_PENDING_SELL: u64 = 7;
    const E_ZERO_TOKENS: u64 = 8;
    const E_INSUFFICIENT_LIQUIDITY: u64 = 9;
    const E_MIN_DEPOSIT: u64 = 10;
    const E_MAX_BUY_EXCEEDED: u64 = 11;
    const E_INVALID_TIER: u64 = 12;
    const E_API_WALLET_EXPIRED: u64 = 13;
    const E_INVALID_DURATION: u64 = 14;
    const E_VAULT_NOT_FOUND: u64 = 15;
    const E_ALREADY_INITIALIZED: u64 = 16;
    const E_NOT_LEADER: u64 = 17;
    const E_NOT_ADMIN: u64 = 18;

    // ============ Structs ============

    /// Graduation tier for bonding curve scaling
    /// 根據 vault 資產規模調整 BC virtual 參數
    public struct GraduationTier has store, copy, drop {
        /// Asset threshold to reach this tier (18 decimals)
        threshold: u64,
        /// Bonding curve virtual pool size
        bc_virtual: u64,
        /// NAV minimum multiplier (in BPS)
        nav_min_mul_bps: u64,
        /// NAV maximum multiplier (in BPS)
        nav_max_mul_bps: u64,
        /// Squared effect ratio for early investor protection (in BPS)
        squared_ratio_bps: u64,
    }

    /// Exit fee tier based on holding duration
    /// 根據持有時間計算退出費
    public struct ExitFeeTier has store, copy, drop {
        /// Minimum days held to qualify for this tier
        days_held: u64,
        /// Fee in basis points
        fee_bps: u64,
    }

    /// User purchase info for exit fee calculation
    /// 追蹤用戶購買資訊以計算時間基礎退出費
    public struct UserPurchaseInfo has store, copy, drop {
        /// Total tokens held by user
        total_tokens: u64,
        /// Weighted average timestamp of purchases
        weighted_timestamp: u64,
        /// Last purchase timestamp
        last_purchase_time: u64,
    }

    /// Entry record for performance fee calculation
    /// 追蹤用戶入場 NAV 以計算績效費
    public struct EntryRecord has store, copy, drop {
        /// Weighted average entry NAV (18 decimals)
        weighted_entry_nav: u64,
        /// Total tokens for this entry record
        total_tokens: u64,
    }

    /// Pending sell record for two-step withdrawal
    /// 當流動性不足時的待處理賣出記錄
    public struct PendingSell has store, copy, drop {
        /// USDC amount to be claimed
        usdc_amount: u64,
        /// Fee amount (already deducted)
        fee_amount: u64,
        /// Timestamp when sell was initiated
        timestamp: u64,
    }

    /// API Wallet authorization info
    /// API 錢包授權資訊
    public struct ApiWalletInfo has store, copy, drop {
        /// Whether the wallet is active
        active: bool,
        /// Expiration timestamp (0 = unlimited)
        expires_at: u64,
        /// Wallet name/label
        name: vector<u8>,
    }

    /// Global settings for the protocol
    /// 協議全域設定
    public struct GlobalSettings has store, copy, drop {
        /// Trading fee in basis points (default 100 = 1%)
        trading_fee_bps: u64,
        /// Maximum premium above NAV in basis points
        max_premium_bps: u64,
        /// Maximum discount below NAV in basis points
        max_discount_bps: u64,
        /// Minimum deposit amount (6 decimals for USDC)
        min_deposit_usdc: u64,
        /// Maximum buy per transaction in basis points of vault
        max_buy_bps: u64,
        /// Rebalance low threshold in basis points
        rebalance_low_bps: u64,
        /// Rebalance high threshold in basis points
        rebalance_high_bps: u64,
        /// Target reserve ratio in basis points
        reserve_ratio_bps: u64,
        /// Minimum reserve ratio in basis points
        min_reserve_ratio_bps: u64,
        /// Whether exit fees are enabled
        exit_fee_enabled: bool,
        /// Maximum BC ratio cap in basis points (0 = disabled)
        max_bc_ratio_bps: u64,
        /// BC virtual minimum floor in basis points
        bc_virtual_min_bps: u64,
    }

    /// Vault info stored in factory registry
    /// Factory 中存儲的 Vault 資訊
    public struct VaultInfo has store, copy, drop {
        /// Leader address who created the vault
        leader: address,
        /// Vault name
        name: vector<u8>,
        /// Vault token symbol
        symbol: vector<u8>,
        /// Performance fee in basis points
        performance_fee_bps: u64,
        /// Creation timestamp
        created_at: u64,
        /// Whether vault is verified
        verified: bool,
    }

    // ============ Getter Functions ============

    public fun bps(): u64 { BPS }
    public fun precision(): u64 { PRECISION }
    public fun high_precision(): u64 { HIGH_PRECISION }
    public fun max_performance_fee_bps(): u64 { MAX_PERFORMANCE_FEE_BPS }
    public fun max_exit_fee_bps(): u64 { MAX_EXIT_FEE_BPS }
    public fun min_api_wallet_duration(): u64 { MIN_API_WALLET_DURATION }
    public fun max_api_wallet_duration(): u64 { MAX_API_WALLET_DURATION }
    public fun l1_init_fee(): u64 { L1_INIT_FEE }
    public fun default_twap_half_life(): u64 { DEFAULT_TWAP_HALF_LIFE }

    // Error code getters
    public fun e_not_authorized(): u64 { E_NOT_AUTHORIZED }
    public fun e_paused(): u64 { E_PAUSED }
    public fun e_fee_too_high(): u64 { E_FEE_TOO_HIGH }
    public fun e_invalid_amount(): u64 { E_INVALID_AMOUNT }
    public fun e_slippage_exceeded(): u64 { E_SLIPPAGE_EXCEEDED }
    public fun e_pending_sell_exists(): u64 { E_PENDING_SELL_EXISTS }
    public fun e_no_pending_sell(): u64 { E_NO_PENDING_SELL }
    public fun e_zero_tokens(): u64 { E_ZERO_TOKENS }
    public fun e_insufficient_liquidity(): u64 { E_INSUFFICIENT_LIQUIDITY }
    public fun e_min_deposit(): u64 { E_MIN_DEPOSIT }
    public fun e_max_buy_exceeded(): u64 { E_MAX_BUY_EXCEEDED }
    public fun e_invalid_tier(): u64 { E_INVALID_TIER }
    public fun e_api_wallet_expired(): u64 { E_API_WALLET_EXPIRED }
    public fun e_invalid_duration(): u64 { E_INVALID_DURATION }
    public fun e_vault_not_found(): u64 { E_VAULT_NOT_FOUND }
    public fun e_already_initialized(): u64 { E_ALREADY_INITIALIZED }
    public fun e_not_leader(): u64 { E_NOT_LEADER }
    public fun e_not_admin(): u64 { E_NOT_ADMIN }

    // ============ Constructor Functions ============

    /// Create a new graduation tier
    public fun new_graduation_tier(
        threshold: u64,
        bc_virtual: u64,
        nav_min_mul_bps: u64,
        nav_max_mul_bps: u64,
        squared_ratio_bps: u64,
    ): GraduationTier {
        GraduationTier {
            threshold,
            bc_virtual,
            nav_min_mul_bps,
            nav_max_mul_bps,
            squared_ratio_bps,
        }
    }

    /// Create a new exit fee tier
    public fun new_exit_fee_tier(days_held: u64, fee_bps: u64): ExitFeeTier {
        ExitFeeTier { days_held, fee_bps }
    }

    /// Create a new user purchase info
    public fun new_user_purchase_info(
        total_tokens: u64,
        weighted_timestamp: u64,
        last_purchase_time: u64,
    ): UserPurchaseInfo {
        UserPurchaseInfo {
            total_tokens,
            weighted_timestamp,
            last_purchase_time,
        }
    }

    /// Create a new entry record
    public fun new_entry_record(weighted_entry_nav: u64, total_tokens: u64): EntryRecord {
        EntryRecord { weighted_entry_nav, total_tokens }
    }

    /// Create a new pending sell
    public fun new_pending_sell(usdc_amount: u64, fee_amount: u64, timestamp: u64): PendingSell {
        PendingSell { usdc_amount, fee_amount, timestamp }
    }

    /// Create a new API wallet info
    public fun new_api_wallet_info(active: bool, expires_at: u64, name: vector<u8>): ApiWalletInfo {
        ApiWalletInfo { active, expires_at, name }
    }

    /// Create default global settings
    public fun default_global_settings(): GlobalSettings {
        GlobalSettings {
            trading_fee_bps: 100,           // 1%
            max_premium_bps: 10000,         // 100%
            max_discount_bps: 5000,         // 50%
            min_deposit_usdc: 5_000_000,    // 5 USDC
            max_buy_bps: 100,               // 1% of vault per tx
            rebalance_low_bps: 4800,        // 48%
            rebalance_high_bps: 5200,       // 52%
            reserve_ratio_bps: 5000,        // 50%
            min_reserve_ratio_bps: 3000,    // 30%
            exit_fee_enabled: true,
            max_bc_ratio_bps: 0,            // Disabled
            bc_virtual_min_bps: 500,        // 5%
        }
    }

    /// Create new global settings with custom trading fee
    public fun new_global_settings_with_trading_fee(
        base: &GlobalSettings,
        trading_fee_bps: u64,
    ): GlobalSettings {
        GlobalSettings {
            trading_fee_bps,
            max_premium_bps: base.max_premium_bps,
            max_discount_bps: base.max_discount_bps,
            min_deposit_usdc: base.min_deposit_usdc,
            max_buy_bps: base.max_buy_bps,
            rebalance_low_bps: base.rebalance_low_bps,
            rebalance_high_bps: base.rebalance_high_bps,
            reserve_ratio_bps: base.reserve_ratio_bps,
            min_reserve_ratio_bps: base.min_reserve_ratio_bps,
            exit_fee_enabled: base.exit_fee_enabled,
            max_bc_ratio_bps: base.max_bc_ratio_bps,
            bc_virtual_min_bps: base.bc_virtual_min_bps,
        }
    }

    /// Create new global settings with custom min deposit
    public fun new_global_settings_with_min_deposit(
        base: &GlobalSettings,
        min_deposit_usdc: u64,
    ): GlobalSettings {
        GlobalSettings {
            trading_fee_bps: base.trading_fee_bps,
            max_premium_bps: base.max_premium_bps,
            max_discount_bps: base.max_discount_bps,
            min_deposit_usdc,
            max_buy_bps: base.max_buy_bps,
            rebalance_low_bps: base.rebalance_low_bps,
            rebalance_high_bps: base.rebalance_high_bps,
            reserve_ratio_bps: base.reserve_ratio_bps,
            min_reserve_ratio_bps: base.min_reserve_ratio_bps,
            exit_fee_enabled: base.exit_fee_enabled,
            max_bc_ratio_bps: base.max_bc_ratio_bps,
            bc_virtual_min_bps: base.bc_virtual_min_bps,
        }
    }

    /// Create new global settings with custom rebalance thresholds
    public fun new_global_settings_with_rebalance(
        base: &GlobalSettings,
        rebalance_low_bps: u64,
        rebalance_high_bps: u64,
        reserve_ratio_bps: u64,
    ): GlobalSettings {
        GlobalSettings {
            trading_fee_bps: base.trading_fee_bps,
            max_premium_bps: base.max_premium_bps,
            max_discount_bps: base.max_discount_bps,
            min_deposit_usdc: base.min_deposit_usdc,
            max_buy_bps: base.max_buy_bps,
            rebalance_low_bps,
            rebalance_high_bps,
            reserve_ratio_bps,
            min_reserve_ratio_bps: base.min_reserve_ratio_bps,
            exit_fee_enabled: base.exit_fee_enabled,
            max_bc_ratio_bps: base.max_bc_ratio_bps,
            bc_virtual_min_bps: base.bc_virtual_min_bps,
        }
    }

    /// Create new global settings with custom max buy bps
    public fun new_global_settings_with_max_buy(
        base: &GlobalSettings,
        max_buy_bps: u64,
    ): GlobalSettings {
        GlobalSettings {
            trading_fee_bps: base.trading_fee_bps,
            max_premium_bps: base.max_premium_bps,
            max_discount_bps: base.max_discount_bps,
            min_deposit_usdc: base.min_deposit_usdc,
            max_buy_bps,
            rebalance_low_bps: base.rebalance_low_bps,
            rebalance_high_bps: base.rebalance_high_bps,
            reserve_ratio_bps: base.reserve_ratio_bps,
            min_reserve_ratio_bps: base.min_reserve_ratio_bps,
            exit_fee_enabled: base.exit_fee_enabled,
            max_bc_ratio_bps: base.max_bc_ratio_bps,
            bc_virtual_min_bps: base.bc_virtual_min_bps,
        }
    }

    /// Create vault info
    public fun new_vault_info(
        leader: address,
        name: vector<u8>,
        symbol: vector<u8>,
        performance_fee_bps: u64,
        created_at: u64,
        verified: bool,
    ): VaultInfo {
        VaultInfo {
            leader,
            name,
            symbol,
            performance_fee_bps,
            created_at,
            verified,
        }
    }

    // ============ Accessor Functions ============

    // GraduationTier accessors
    public fun tier_threshold(tier: &GraduationTier): u64 { tier.threshold }
    public fun tier_bc_virtual(tier: &GraduationTier): u64 { tier.bc_virtual }
    public fun tier_nav_min_mul_bps(tier: &GraduationTier): u64 { tier.nav_min_mul_bps }
    public fun tier_nav_max_mul_bps(tier: &GraduationTier): u64 { tier.nav_max_mul_bps }
    public fun tier_squared_ratio_bps(tier: &GraduationTier): u64 { tier.squared_ratio_bps }

    // ExitFeeTier accessors
    public fun exit_tier_days_held(tier: &ExitFeeTier): u64 { tier.days_held }
    public fun exit_tier_fee_bps(tier: &ExitFeeTier): u64 { tier.fee_bps }

    // UserPurchaseInfo accessors
    public fun purchase_total_tokens(info: &UserPurchaseInfo): u64 { info.total_tokens }
    public fun purchase_weighted_timestamp(info: &UserPurchaseInfo): u64 { info.weighted_timestamp }
    public fun purchase_last_time(info: &UserPurchaseInfo): u64 { info.last_purchase_time }

    // EntryRecord accessors
    public fun entry_weighted_nav(record: &EntryRecord): u64 { record.weighted_entry_nav }
    public fun entry_total_tokens(record: &EntryRecord): u64 { record.total_tokens }

    // PendingSell accessors
    public fun ps_usdc_amount(ps: &PendingSell): u64 { ps.usdc_amount }
    public fun ps_fee_amount(ps: &PendingSell): u64 { ps.fee_amount }
    public fun ps_timestamp(ps: &PendingSell): u64 { ps.timestamp }

    // ApiWalletInfo accessors
    public fun api_wallet_active(info: &ApiWalletInfo): bool { info.active }
    public fun api_wallet_expires_at(info: &ApiWalletInfo): u64 { info.expires_at }
    public fun api_wallet_name(info: &ApiWalletInfo): vector<u8> { info.name }

    // GlobalSettings accessors
    public fun settings_trading_fee_bps(s: &GlobalSettings): u64 { s.trading_fee_bps }
    public fun settings_max_premium_bps(s: &GlobalSettings): u64 { s.max_premium_bps }
    public fun settings_max_discount_bps(s: &GlobalSettings): u64 { s.max_discount_bps }
    public fun settings_min_deposit_usdc(s: &GlobalSettings): u64 { s.min_deposit_usdc }
    public fun settings_max_buy_bps(s: &GlobalSettings): u64 { s.max_buy_bps }
    public fun settings_rebalance_low_bps(s: &GlobalSettings): u64 { s.rebalance_low_bps }
    public fun settings_rebalance_high_bps(s: &GlobalSettings): u64 { s.rebalance_high_bps }
    public fun settings_reserve_ratio_bps(s: &GlobalSettings): u64 { s.reserve_ratio_bps }
    public fun settings_min_reserve_ratio_bps(s: &GlobalSettings): u64 { s.min_reserve_ratio_bps }
    public fun settings_exit_fee_enabled(s: &GlobalSettings): bool { s.exit_fee_enabled }
    public fun settings_max_bc_ratio_bps(s: &GlobalSettings): u64 { s.max_bc_ratio_bps }
    public fun settings_bc_virtual_min_bps(s: &GlobalSettings): u64 { s.bc_virtual_min_bps }

    // VaultInfo accessors
    public fun vault_info_leader(info: &VaultInfo): address { info.leader }
    public fun vault_info_name(info: &VaultInfo): vector<u8> { info.name }
    public fun vault_info_symbol(info: &VaultInfo): vector<u8> { info.symbol }
    public fun vault_info_performance_fee_bps(info: &VaultInfo): u64 { info.performance_fee_bps }
    public fun vault_info_created_at(info: &VaultInfo): u64 { info.created_at }
    public fun vault_info_verified(info: &VaultInfo): bool { info.verified }

    // ============ Mutator Functions ============

    /// Update user purchase info with new purchase
    public fun update_purchase_info(
        info: &mut UserPurchaseInfo,
        new_tokens: u64,
        current_time: u64,
    ) {
        let old_total = info.total_tokens;
        let new_total = old_total + new_tokens;

        if (new_total > 0) {
            // Weighted average timestamp
            let numerator = (info.weighted_timestamp as u128) * (old_total as u128) +
                (current_time as u128) * (new_tokens as u128);
            info.weighted_timestamp = ((numerator / (new_total as u128)) as u64);
        };

        info.total_tokens = new_total;
        info.last_purchase_time = current_time;
    }

    /// Reduce tokens in purchase info (for selling)
    public fun reduce_purchase_tokens(info: &mut UserPurchaseInfo, tokens_sold: u64) {
        assert!(info.total_tokens >= tokens_sold, E_INVALID_AMOUNT);
        info.total_tokens = info.total_tokens - tokens_sold;
    }

    /// Update entry record with new entry
    public fun update_entry_record(
        record: &mut EntryRecord,
        new_tokens: u64,
        entry_nav: u64,
    ) {
        let old_total = record.total_tokens;
        let new_total = old_total + new_tokens;

        if (new_total > 0) {
            // Weighted average entry NAV
            let numerator = (record.weighted_entry_nav as u128) * (old_total as u128) +
                (entry_nav as u128) * (new_tokens as u128);
            record.weighted_entry_nav = ((numerator / (new_total as u128)) as u64);
        };

        record.total_tokens = new_total;
    }

    /// Reduce tokens in entry record (for selling)
    public fun reduce_entry_tokens(record: &mut EntryRecord, tokens_sold: u64) {
        assert!(record.total_tokens >= tokens_sold, E_INVALID_AMOUNT);
        record.total_tokens = record.total_tokens - tokens_sold;
    }

    /// Set vault as verified
    public fun set_vault_verified(info: &mut VaultInfo, verified: bool) {
        info.verified = verified;
    }

    /// Update API wallet info
    public fun set_api_wallet_active(info: &mut ApiWalletInfo, active: bool) {
        info.active = active;
    }

    public fun set_api_wallet_expires(info: &mut ApiWalletInfo, expires_at: u64) {
        info.expires_at = expires_at;
    }
}
