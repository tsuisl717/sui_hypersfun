/// SUI HypersFun - Math Utilities Module
/// 定點數學運算，包括 Bonding Curve、NAV 計算、TWAP 平滑
module sui_hypersfun::sui_math {
    use sui_hypersfun::sui_types;

    // ============ Constants ============

    /// Maximum u64 value for overflow checks
    const MAX_U64: u64 = 18446744073709551615;



    // ============ Error Codes ============

    const E_DIVISION_BY_ZERO: u64 = 100;
    const E_OVERFLOW: u64 = 101;
    const E_UNDERFLOW: u64 = 102;

    // ============ Basic Math Functions ============

    /// Safe multiplication with u128 intermediate
    /// Returns (a * b) without overflow
    public fun safe_mul(a: u64, b: u64): u128 {
        (a as u128) * (b as u128)
    }

    /// Fixed-point multiplication: (a * b) / c
    /// Uses u128 intermediate to prevent overflow
    public fun mul_div(a: u64, b: u64, c: u64): u64 {
        assert!(c > 0, E_DIVISION_BY_ZERO);
        let result = ((a as u128) * (b as u128)) / (c as u128);
        assert!(result <= (MAX_U64 as u128), E_OVERFLOW);
        (result as u64)
    }

    /// Fixed-point multiplication with rounding up: ceil((a * b) / c)
    public fun mul_div_up(a: u64, b: u64, c: u64): u64 {
        assert!(c > 0, E_DIVISION_BY_ZERO);
        let numerator = (a as u128) * (b as u128);
        let result = (numerator + (c as u128) - 1) / (c as u128);
        assert!(result <= (MAX_U64 as u128), E_OVERFLOW);
        (result as u64)
    }

    /// Safe subtraction with underflow check
    public fun safe_sub(a: u64, b: u64): u64 {
        assert!(a >= b, E_UNDERFLOW);
        a - b
    }

    /// Safe addition with overflow check
    public fun safe_add(a: u64, b: u64): u64 {
        let result = (a as u128) + (b as u128);
        assert!(result <= (MAX_U64 as u128), E_OVERFLOW);
        (result as u64)
    }

    /// Minimum of two values
    public fun min(a: u64, b: u64): u64 {
        if (a < b) { a } else { b }
    }

    /// Maximum of two values
    public fun max(a: u64, b: u64): u64 {
        if (a > b) { a } else { b }
    }

    /// Absolute difference
    public fun abs_diff(a: u64, b: u64): u64 {
        if (a > b) { a - b } else { b - a }
    }

    // ============ Bonding Curve Functions ============

    /// Calculate tokens out from USDC input using constant product formula
    /// Formula: tokens_out = virtual_tokens * usdc_in / (virtual_base_usdc + usdc_in)
    ///
    /// @param virtual_base_usdc - Virtual base in USDC terms (virtual_base * NAV)
    /// @param virtual_tokens - Virtual token reserve
    /// @param usdc_in - USDC input amount
    /// @return tokens_out - Tokens to mint to buyer
    public fun calculate_tokens_out(
        virtual_base_usdc: u64,
        virtual_tokens: u64,
        usdc_in: u64,
    ): u64 {
        if (usdc_in == 0 || virtual_tokens == 0) {
            return 0
        };

        // tokens_out = virtual_tokens * usdc_in / (virtual_base_usdc + usdc_in)
        let denominator = (virtual_base_usdc as u128) + (usdc_in as u128);
        let numerator = (virtual_tokens as u128) * (usdc_in as u128);

        (numerator / denominator) as u64
    }

    /// Calculate USDC out from token input using constant product formula
    /// Formula: usdc_out = virtual_base_usdc * tokens_in / (virtual_tokens + tokens_in)
    ///
    /// @param virtual_base_usdc - Virtual base in USDC terms (virtual_base * NAV)
    /// @param virtual_tokens - Virtual token reserve
    /// @param tokens_in - Tokens to sell
    /// @return usdc_out - USDC to return to seller
    public fun calculate_usdc_out(
        virtual_base_usdc: u64,
        virtual_tokens: u64,
        tokens_in: u64,
    ): u64 {
        if (tokens_in == 0 || virtual_base_usdc == 0) {
            return 0
        };

        // usdc_out = virtual_base_usdc * tokens_in / (virtual_tokens + tokens_in)
        let denominator = (virtual_tokens as u128) + (tokens_in as u128);
        let numerator = (virtual_base_usdc as u128) * (tokens_in as u128);

        (numerator / denominator) as u64
    }

    /// Calculate effective virtual base in USDC terms
    /// effective_base_usdc = virtual_base * current_nav / PRECISION
    public fun calculate_virtual_base_usdc(
        virtual_base: u64,
        nav: u64,
    ): u64 {
        mul_div(virtual_base, nav, sui_types::precision())
    }

    // ============ NAV Functions ============

    /// Calculate NAV (Net Asset Value) per token
    /// Formula: NAV = (total_assets + nav_virtual) / (total_supply + nav_virtual)
    /// Returns value in PRECISION (1e18) format
    ///
    /// @param total_assets - Total vault assets (18 decimals)
    /// @param total_supply - Total token supply (18 decimals)
    /// @param nav_virtual - Virtual amount for NAV smoothing
    /// @return NAV in 1e18 precision
    public fun calculate_nav(
        total_assets: u64,
        total_supply: u64,
        nav_virtual: u64,
    ): u64 {
        let precision = sui_types::precision();

        // Handle edge cases
        if (total_supply == 0 && nav_virtual == 0) {
            return precision // 1.0 NAV when empty
        };

        let total_with_virtual = (total_assets as u128) + (nav_virtual as u128);
        let supply_with_virtual = (total_supply as u128) + (nav_virtual as u128);

        if (supply_with_virtual == 0) {
            return precision
        };

        // NAV = (assets + virtual) * PRECISION / (supply + virtual)
        let result = total_with_virtual * (precision as u128) / supply_with_virtual;
        (result as u64)
    }

    /// Calculate tiered NAV virtual based on graduation tier
    /// Interpolates between tier's min and max multipliers based on vault size
    ///
    /// @param total_assets - Current vault assets
    /// @param tier_threshold - Tier's asset threshold
    /// @param nav_min_mul_bps - Minimum NAV virtual multiplier (BPS)
    /// @param nav_max_mul_bps - Maximum NAV virtual multiplier (BPS)
    /// @param initial_assets - Vault's initial assets for scaling
    /// @return nav_virtual - Calculated NAV virtual amount
    public fun calculate_tiered_nav_virtual(
        total_assets: u64,
        tier_threshold: u64,
        nav_min_mul_bps: u64,
        nav_max_mul_bps: u64,
        initial_assets: u64,
    ): u64 {
        let bps = sui_types::bps();

        if (initial_assets == 0) {
            return 0
        };

        // If below threshold, use max multiplier (more protection)
        if (total_assets < tier_threshold) {
            return mul_div(initial_assets, nav_max_mul_bps, bps)
        };

        // If above threshold, interpolate towards min multiplier
        // ratio = how far above threshold (capped at 2x threshold)
        let cap = tier_threshold * 2;
        let effective_assets = min(total_assets, cap);
        let progress = mul_div(effective_assets - tier_threshold, bps, tier_threshold);

        // interpolated_mul = max - (max - min) * progress / BPS
        let mul_diff = nav_max_mul_bps - nav_min_mul_bps;
        let reduction = mul_div(mul_diff, progress, bps);
        let final_mul = nav_max_mul_bps - reduction;

        mul_div(initial_assets, final_mul, bps)
    }

    // ============ TWAP Functions ============

    /// Calculate smoothed NAV using TWAP with half-life decay
    /// Protects against sudden NAV drops (e.g., from liquidations)
    ///
    /// @param instant_nav - Current calculated NAV
    /// @param twap_nav - Previous TWAP NAV
    /// @param elapsed_seconds - Time since last TWAP update
    /// @param half_life - Half-life for decay (default 600 seconds = 10 min)
    /// @return smoothed_nav - Smoothed NAV value
    public fun calculate_smoothed_nav(
        instant_nav: u64,
        twap_nav: u64,
        elapsed_seconds: u64,
        half_life: u64,
    ): u64 {
        // If instant NAV >= TWAP, use instant (NAV going up)
        if (instant_nav >= twap_nav) {
            return instant_nav
        };

        // If TWAP is higher, smoothly decay towards instant
        // Each half_life period, the gap reduces by half
        let gap = twap_nav - instant_nav;

        // Calculate how many half-life periods have passed
        // Cap at 10 periods to avoid excessive computation
        let periods = min(elapsed_seconds / half_life, 10);

        // Decay the gap by half for each period: gap * 2^(-periods)
        // We implement this as gap >> periods (right shift)
        let remaining_gap = if (periods >= 64) {
            0
        } else {
            gap >> (periods as u8)
        };

        instant_nav + remaining_gap
    }

    /// Update TWAP NAV incrementally
    /// Uses exponential moving average approach
    ///
    /// @param current_twap - Current TWAP value
    /// @param instant_nav - New instant NAV
    /// @param alpha_bps - Smoothing factor in BPS (higher = more weight to new value)
    /// @return new_twap - Updated TWAP value
    public fun update_twap_ema(
        current_twap: u64,
        instant_nav: u64,
        alpha_bps: u64,
    ): u64 {
        let bps = sui_types::bps();

        // new_twap = current_twap * (1 - alpha) + instant_nav * alpha
        let weight_old = bps - alpha_bps;
        let weighted_old = mul_div(current_twap, weight_old, bps);
        let weighted_new = mul_div(instant_nav, alpha_bps, bps);

        weighted_old + weighted_new
    }

    // ============ Fee Calculation Functions ============

    /// Calculate performance fee tokens to mint to leader
    /// Fee is based on profit since entry: fee = tokens * (current_nav - entry_nav) * fee_bps
    ///
    /// @param tokens_selling - Number of tokens being sold
    /// @param current_nav - Current NAV (1e18)
    /// @param entry_nav - User's weighted entry NAV (1e18)
    /// @param performance_fee_bps - Performance fee in BPS
    /// @return fee_tokens - Tokens to mint to leader as fee
    public fun calculate_performance_fee(
        tokens_selling: u64,
        current_nav: u64,
        entry_nav: u64,
        performance_fee_bps: u64,
    ): u64 {
        // No fee if NAV hasn't increased
        if (current_nav <= entry_nav) {
            return 0
        };

        let precision = sui_types::precision();
        let bps = sui_types::bps();

        // profit_per_token = current_nav - entry_nav
        let profit_per_token = current_nav - entry_nav;

        // total_profit = tokens * profit_per_token / PRECISION
        let total_profit = mul_div(tokens_selling, profit_per_token, precision);

        // fee_value = total_profit * fee_bps / BPS
        let fee_value = mul_div(total_profit, performance_fee_bps, bps);

        // fee_tokens = fee_value * PRECISION / current_nav
        mul_div(fee_value, precision, current_nav)
    }

    /// Calculate exit fee based on holding duration
    /// Searches through exit fee tiers to find applicable fee
    ///
    /// @param days_held - Number of days tokens were held
    /// @param tiers - Vector of exit fee tiers (sorted by days_held ascending)
    /// @return fee_bps - Applicable exit fee in BPS
    public fun calculate_exit_fee_bps(
        days_held: u64,
        tiers: &vector<sui_types::ExitFeeTier>,
    ): u64 {
        let len = std::vector::length(tiers);
        if (len == 0) {
            return 0
        };

        // Tiers are sorted by days_held ascending
        // Find the first tier where days_held >= tier.days_held
        let mut i = len;
        while (i > 0) {
            i = i - 1;
            let tier = std::vector::borrow(tiers, i);
            if (days_held >= sui_types::exit_tier_days_held(tier)) {
                return sui_types::exit_tier_fee_bps(tier)
            };
        };

        // If no tier matches, return highest fee (first tier)
        let first_tier = std::vector::borrow(tiers, 0);
        sui_types::exit_tier_fee_bps(first_tier)
    }

    /// Calculate days held from weighted timestamp
    /// @param weighted_timestamp - Weighted average timestamp of purchases
    /// @param current_time - Current timestamp
    /// @return days - Number of days held
    public fun calculate_days_held(
        weighted_timestamp: u64,
        current_time: u64,
    ): u64 {
        if (current_time <= weighted_timestamp) {
            return 0
        };

        let seconds_held = current_time - weighted_timestamp;
        seconds_held / (24 * 60 * 60) // Convert to days
    }

    // ============ Bonding Curve Tier Functions ============

    /// Get effective BC virtual based on graduation tier and squared ratio
    /// Implements progressive squared effect decay for early investor protection
    ///
    /// @param total_assets - Current vault assets
    /// @param tier_bc_virtual - Tier's base BC virtual
    /// @param tier_threshold - Tier's threshold
    /// @param squared_ratio_bps - How much squared effect to apply (decays as vault grows)
    /// @return effective_bc_virtual - Adjusted BC virtual value
    public fun calculate_effective_bc_virtual(
        total_assets: u64,
        tier_bc_virtual: u64,
        tier_threshold: u64,
        squared_ratio_bps: u64,
    ): u64 {
        let bps = sui_types::bps();

        if (tier_threshold == 0 || total_assets == 0) {
            return tier_bc_virtual
        };

        // Calculate progress through tier (0 to BPS)
        let progress = if (total_assets >= tier_threshold * 2) {
            bps // Max progress
        } else if (total_assets <= tier_threshold) {
            0
        } else {
            mul_div(total_assets - tier_threshold, bps, tier_threshold)
        };

        // Interpolate squared ratio based on progress
        // At start: use full squared_ratio_bps
        // At end: use 0 (pure linear)
        let current_squared_ratio = mul_div(squared_ratio_bps, bps - progress, bps);

        // Apply squared effect: bc_virtual * (1 + squared_adjustment)
        // squared_adjustment = (total_assets / tier_threshold)^2 * squared_ratio
        if (current_squared_ratio == 0) {
            return tier_bc_virtual
        };

        let ratio = mul_div(total_assets, bps, tier_threshold);
        let ratio_squared = mul_div(ratio, ratio, bps);
        let adjustment = mul_div(ratio_squared, current_squared_ratio, bps);

        // Apply adjustment (capped to prevent excessive values)
        let max_adjustment = bps * 2; // Max 2x adjustment
        let capped_adjustment = min(adjustment, max_adjustment);

        mul_div(tier_bc_virtual, bps + capped_adjustment, bps)
    }

    // ============ Rebalance Functions ============

    /// Calculate rebalance amounts
    /// Returns (to_perp, to_evm) - amounts to transfer
    ///
    /// @param evm_balance - Current EVM USDC balance
    /// @param perp_balance - Current Perp balance
    /// @param target_ratio_bps - Target EVM ratio in BPS (e.g., 5000 = 50%)
    /// @param low_threshold_bps - Low threshold to trigger rebalance
    /// @param high_threshold_bps - High threshold to trigger rebalance
    /// @return (to_perp, to_evm) - Amounts to transfer in each direction
    public fun calculate_rebalance(
        evm_balance: u64,
        perp_balance: u64,
        target_ratio_bps: u64,
        low_threshold_bps: u64,
        high_threshold_bps: u64,
    ): (u64, u64) {
        let bps = sui_types::bps();
        let total = evm_balance + perp_balance;

        if (total == 0) {
            return (0, 0)
        };

        // Calculate current EVM ratio
        let current_ratio_bps = mul_div(evm_balance, bps, total);

        // Check if rebalance is needed
        if (current_ratio_bps >= low_threshold_bps && current_ratio_bps <= high_threshold_bps) {
            return (0, 0) // Within threshold, no rebalance needed
        };

        // Calculate target EVM balance
        let target_evm = mul_div(total, target_ratio_bps, bps);

        if (evm_balance > target_evm) {
            // EVM too high, send to perp
            let to_perp = evm_balance - target_evm;
            (to_perp, 0)
        } else {
            // EVM too low, withdraw from perp
            let to_evm = target_evm - evm_balance;
            (0, to_evm)
        }
    }

    // ============ Price Bound Functions ============

    /// Check if price is within acceptable bounds
    /// @param price - Current price
    /// @param nav - Current NAV
    /// @param max_premium_bps - Maximum premium above NAV
    /// @param max_discount_bps - Maximum discount below NAV
    /// @return is_valid - Whether price is within bounds
    public fun is_price_within_bounds(
        price: u64,
        nav: u64,
        max_premium_bps: u64,
        max_discount_bps: u64,
    ): bool {
        let bps = sui_types::bps();

        // Calculate bounds
        let max_price = mul_div(nav, bps + max_premium_bps, bps);
        let min_price = mul_div(nav, bps - max_discount_bps, bps);

        price >= min_price && price <= max_price
    }

    /// Calculate buy price with premium cap
    public fun calculate_buy_price_capped(
        base_price: u64,
        nav: u64,
        max_premium_bps: u64,
    ): u64 {
        let bps = sui_types::bps();
        let max_price = mul_div(nav, bps + max_premium_bps, bps);
        min(base_price, max_price)
    }

    /// Calculate sell price with discount floor
    public fun calculate_sell_price_floored(
        base_price: u64,
        nav: u64,
        max_discount_bps: u64,
    ): u64 {
        let bps = sui_types::bps();
        let min_price = mul_div(nav, bps - max_discount_bps, bps);
        max(base_price, min_price)
    }

    // ============ Utility Functions ============

    /// Convert USDC amount (6 decimals) to internal representation
    /// With PRECISION = 1e6, USDC is already in the correct format
    public fun usdc_to_internal(usdc_amount: u64): u64 {
        usdc_amount // No conversion needed - both use 6 decimals
    }

    /// Convert internal representation to USDC amount (6 decimals)
    /// With PRECISION = 1e6, no conversion needed
    public fun internal_to_usdc(internal_amount: u64): u64 {
        internal_amount // No conversion needed - both use 6 decimals
    }

    /// Convert to high precision (for detailed token math)
    public fun to_high_precision(amount: u64): u64 {
        amount * 1_000_000 // 6 decimals to 12 decimals
    }

    /// Convert from high precision
    public fun from_high_precision(amount: u64): u64 {
        amount / 1_000_000 // 12 decimals to 6 decimals
    }

    /// Calculate percentage in BPS
    public fun percentage_bps(amount: u64, total: u64): u64 {
        if (total == 0) {
            return 0
        };
        mul_div(amount, sui_types::bps(), total)
    }
}

// ============ Tests ============

#[test_only]
module sui_hypersfun::sui_math_tests {
    use sui_hypersfun::sui_math;
    use sui_hypersfun::sui_types;

    #[test]
    fun test_mul_div() {
        // Basic test: 100 * 200 / 50 = 400
        assert!(sui_math::mul_div(100, 200, 50) == 400, 0);

        // Test with precision: 1e18 * 1e18 / 1e18 = 1e18
        let precision = sui_types::precision();
        assert!(sui_math::mul_div(precision, precision, precision) == precision, 1);
    }

    #[test]
    fun test_calculate_tokens_out() {
        // Setup: 1K virtual base USDC, 1K virtual tokens (scaled down for u64)
        let virtual_base_usdc = 1_000_000_000_000; // 1M USDC (6 decimals scaled)
        let virtual_tokens = 1_000_000_000_000_000_000; // 1 token (18 decimals)

        // Buy with 1000 USDC
        let usdc_in = 1_000_000_000; // 1000 USDC

        let tokens_out = sui_math::calculate_tokens_out(virtual_base_usdc, virtual_tokens, usdc_in);

        // Should get approximately 999 tokens (slight slippage)
        assert!(tokens_out > 0, 0);
        assert!(tokens_out < virtual_tokens, 1); // Less than full pool
    }

    #[test]
    fun test_calculate_nav() {
        let precision = sui_types::precision();

        // Test: 100 assets, 100 supply, 0 virtual = 1.0 NAV
        let nav = sui_math::calculate_nav(
            100 * precision, // 100 assets
            100 * precision, // 100 supply
            0                // no virtual
        );
        assert!(nav == precision, 0); // NAV should be 1.0

        // Test: 200 assets, 100 supply = 2.0 NAV
        let nav2 = sui_math::calculate_nav(
            200 * precision,
            100 * precision,
            0
        );
        assert!(nav2 == 2 * precision, 1); // NAV should be 2.0
    }

    #[test]
    fun test_smoothed_nav() {
        let precision = sui_types::precision();
        let half_life = 600; // 10 minutes

        // Test: instant NAV higher than TWAP - should return instant
        let smoothed = sui_math::calculate_smoothed_nav(
            2 * precision,  // instant = 2.0
            1 * precision,  // twap = 1.0
            300,            // 5 minutes elapsed
            half_life
        );
        assert!(smoothed == 2 * precision, 0);

        // Test: instant NAV lower than TWAP - should smooth
        let smoothed2 = sui_math::calculate_smoothed_nav(
            1 * precision,  // instant = 1.0
            2 * precision,  // twap = 2.0
            600,            // 1 half-life elapsed
            half_life
        );
        // After 1 half-life, gap should be halved: 1.0 + (2.0-1.0)/2 = 1.5
        assert!(smoothed2 == precision + precision / 2, 1);
    }

    #[test]
    fun test_performance_fee() {
        let precision = sui_types::precision();

        // Test: 100 tokens, NAV went from 1.0 to 1.5, 20% fee
        let fee_tokens = sui_math::calculate_performance_fee(
            100 * precision,      // tokens selling
            150 * precision / 100, // current NAV = 1.5
            precision,            // entry NAV = 1.0
            2000                  // 20% performance fee
        );

        // Profit = 100 * 0.5 = 50
        // Fee value = 50 * 0.2 = 10
        // Fee tokens = 10 / 1.5 ≈ 6.67 tokens
        assert!(fee_tokens > 0, 0);
    }

    #[test]
    fun test_rebalance_calculation() {
        // Test: 600 EVM, 400 perp, target 50%, thresholds 48-52%
        let (to_perp, to_evm) = sui_math::calculate_rebalance(
            600_000_000, // 600 USDC EVM
            400_000_000, // 400 USDC perp
            5000,        // 50% target
            4800,        // 48% low
            5200         // 52% high
        );

        // EVM is at 60%, above threshold, should send 100 to perp
        assert!(to_perp == 100_000_000, 0);
        assert!(to_evm == 0, 1);
    }

    #[test]
    fun test_days_held() {
        let one_day = 24 * 60 * 60;

        // Test: 10 days held
        let days = sui_math::calculate_days_held(
            1000,           // weighted timestamp
            1000 + 10 * one_day  // current time (10 days later)
        );
        assert!(days == 10, 0);
    }
}
