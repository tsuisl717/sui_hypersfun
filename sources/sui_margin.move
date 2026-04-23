/// SUI HypersFun - DeepBook Margin Integration Module
/// 整合 DeepBook Margin 進行槓桿交易和做空
///
/// 設計說明：
/// - 此模組管理 Vault 資金的保證金交易授權
/// - Leader 可以用 Vault 的 USDC 作為保證金，進行槓桿多/空交易
/// - 實際的 DeepBook Margin 調用在 PTB 層面組合（同 sui_deepbook 的設計）
/// - Leader 只能交易，不能提款到個人錢包
/// - 所有資金必須歸還到 Vault
///
/// PTB 交易流程：
/// 1. authorize_margin_deposit() → 從 Vault 提取 USDC
/// 2. [PTB] deepbook_margin::deposit() → 存入 MarginManager
/// 3. [PTB] deepbook_margin::borrow/place_order → 槓桿交易
/// 4. [PTB] deepbook_margin::withdraw() → 從 MarginManager 取出
/// 5. return_margin_funds() → 歸還 USDC 到 Vault
#[allow(lint(self_transfer))]
module sui_hypersfun::sui_margin {
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::clock::{Self, Clock};

    use sui_hypersfun::sui_vault::{Self, SuiVault, SuiLeaderCap};

    // ============ Error Codes ============

    const E_NOT_AUTHORIZED: u64 = 100;
    const E_INVALID_AMOUNT: u64 = 101;
    const E_EXCEEDED_MAX_ALLOCATION: u64 = 102;
    const E_MARGIN_EXPIRED: u64 = 103;
    const E_EXCEEDED_MAX_LEVERAGE: u64 = 104;
    const E_HAS_OUTSTANDING_ALLOCATION: u64 = 107;

    // ============ Constants ============

    /// Maximum leverage allowed (5x = 5_000, basis points style with 1000 = 1x)
    const DEFAULT_MAX_LEVERAGE: u64 = 5_000;
    /// Maximum percentage of vault USDC that can be allocated to margin (50% = 5000 bps)
    const DEFAULT_MAX_ALLOCATION_BPS: u64 = 5000;
    /// BPS denominator
    const BPS: u64 = 10_000;

    // ============ Structs ============

    /// Tracks margin trading state for a vault
    /// One per vault, shared object
    public struct MarginAccount has key {
        id: UID,
        /// Reference to main vault
        vault_id: ID,
        /// Total USDC currently allocated to margin trading
        total_allocated: u64,
        /// Maximum USDC that can be allocated (percentage of vault reserve)
        max_allocation_bps: u64,
        /// Maximum leverage allowed for this vault (1000 = 1x, 5000 = 5x)
        max_leverage: u64,
        /// Whether margin trading is enabled
        enabled: bool,
        /// Cumulative profit from margin trading
        cumulative_profit: u64,
        /// Cumulative loss from margin trading
        cumulative_loss: u64,
        /// Number of margin trades executed
        trade_count: u64,
    }

    /// Authorization to extract USDC from vault for margin deposit
    /// Created by Leader, consumed in PTB
    public struct MarginDepositAuth has key {
        id: UID,
        vault_id: ID,
        /// Amount of USDC to extract
        amount: u64,
        /// Expiration timestamp
        expires_at: u64,
    }

    /// Authorization to return funds from margin to vault
    /// Ensures funds flow back correctly
    public struct MarginReturnAuth has key {
        id: UID,
        vault_id: ID,
        /// Minimum amount that must be returned
        min_return_amount: u64,
        /// Expiration timestamp
        expires_at: u64,
    }

    // ============ Events ============

    public struct MarginAccountCreated has copy, drop {
        vault_id: ID,
        margin_account_id: ID,
        max_leverage: u64,
        max_allocation_bps: u64,
    }

    public struct MarginDepositAuthorized has copy, drop {
        vault_id: ID,
        auth_id: ID,
        amount: u64,
    }

    public struct MarginFundsExtracted has copy, drop {
        vault_id: ID,
        amount: u64,
        total_allocated: u64,
    }

    public struct MarginFundsReturned has copy, drop {
        vault_id: ID,
        amount: u64,
        total_allocated: u64,
        /// Profit or loss amount (unsigned)
        pnl_amount: u64,
        /// True if profit, false if loss
        is_profit: bool,
    }

    public struct MarginSettingsUpdated has copy, drop {
        vault_id: ID,
        max_leverage: u64,
        max_allocation_bps: u64,
        enabled: bool,
    }

    // ============ Create Margin Account ============

    /// Create a margin account for a vault
    /// Only the Leader can create this (one-time setup)
    public fun create_margin_account<USDC>(
        vault: &SuiVault<USDC>,
        leader_cap: &SuiLeaderCap,
        ctx: &mut TxContext,
    ) {
        assert!(sui_vault::leader_cap_vault_id(leader_cap) == object::id(vault), E_NOT_AUTHORIZED);

        let vault_id = object::id(vault);

        let margin_account = MarginAccount {
            id: object::new(ctx),
            vault_id,
            total_allocated: 0,
            max_allocation_bps: DEFAULT_MAX_ALLOCATION_BPS,
            max_leverage: DEFAULT_MAX_LEVERAGE,
            enabled: true,
            cumulative_profit: 0,
            cumulative_loss: 0,
            trade_count: 0,
        };

        let margin_account_id = object::id(&margin_account);

        event::emit(MarginAccountCreated {
            vault_id,
            margin_account_id,
            max_leverage: DEFAULT_MAX_LEVERAGE,
            max_allocation_bps: DEFAULT_MAX_ALLOCATION_BPS,
        });

        transfer::share_object(margin_account);
    }

    // ============ Authorize Margin Deposit ============

    /// Leader authorizes extracting USDC from vault for margin deposit
    /// Returns the authorization to be used in the same PTB
    public fun authorize_margin_deposit<USDC>(
        vault: &SuiVault<USDC>,
        leader_cap: &SuiLeaderCap,
        margin_account: &mut MarginAccount,
        amount: u64,
        expiry_seconds: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): MarginDepositAuth {
        let vault_id = object::id(vault);
        assert!(sui_vault::leader_cap_vault_id(leader_cap) == vault_id, E_NOT_AUTHORIZED);
        assert!(margin_account.vault_id == vault_id, E_NOT_AUTHORIZED);
        assert!(margin_account.enabled, E_NOT_AUTHORIZED);
        assert!(amount > 0, E_INVALID_AMOUNT);

        // Check allocation limit
        let vault_balance = sui_vault::available_usdc_for_trading(vault);
        let max_allocation = (vault_balance as u128) * (margin_account.max_allocation_bps as u128) / (BPS as u128);
        let new_total = margin_account.total_allocated + amount;
        assert!((new_total as u128) <= max_allocation, E_EXCEEDED_MAX_ALLOCATION);

        let current_time = clock::timestamp_ms(clock) / 1000;

        let auth = MarginDepositAuth {
            id: object::new(ctx),
            vault_id,
            amount,
            expires_at: current_time + expiry_seconds,
        };

        let auth_id = object::id(&auth);

        event::emit(MarginDepositAuthorized {
            vault_id,
            auth_id,
            amount,
        });

        auth
    }

    // ============ Consume Margin Deposit Auth ============

    /// Consume authorization and extract USDC from vault
    /// The returned coin should be deposited to MarginManager in the same PTB
    public fun consume_margin_deposit<USDC>(
        auth: MarginDepositAuth,
        vault: &mut SuiVault<USDC>,
        margin_account: &mut MarginAccount,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Coin<USDC> {
        let MarginDepositAuth {
            id,
            vault_id,
            amount,
            expires_at,
        } = auth;

        let current_time = clock::timestamp_ms(clock) / 1000;
        assert!(current_time < expires_at, E_MARGIN_EXPIRED);
        assert!(vault_id == object::id(vault), E_NOT_AUTHORIZED);
        assert!(vault_id == margin_account.vault_id, E_NOT_AUTHORIZED);

        object::delete(id);

        // Update allocation tracking
        margin_account.total_allocated = margin_account.total_allocated + amount;

        event::emit(MarginFundsExtracted {
            vault_id,
            amount,
            total_allocated: margin_account.total_allocated,
        });

        // Extract USDC from vault
        sui_vault::extract_usdc_for_trading(vault, amount, ctx)
    }

    // ============ Return Margin Funds ============

    /// Authorize return of funds from margin trading back to vault
    /// Returns auth to be used in the same PTB
    public fun authorize_margin_return<USDC>(
        vault: &SuiVault<USDC>,
        leader_cap: &SuiLeaderCap,
        min_return_amount: u64,
        expiry_seconds: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): MarginReturnAuth {
        let vault_id = object::id(vault);
        assert!(sui_vault::leader_cap_vault_id(leader_cap) == vault_id, E_NOT_AUTHORIZED);

        let current_time = clock::timestamp_ms(clock) / 1000;

        let auth = MarginReturnAuth {
            id: object::new(ctx),
            vault_id,
            min_return_amount,
            expires_at: current_time + expiry_seconds,
        };

        auth
    }

    /// Return USDC from margin trading back to vault
    /// The coin comes from MarginManager withdrawal in the PTB
    public fun return_margin_funds<USDC>(
        auth: MarginReturnAuth,
        vault: &mut SuiVault<USDC>,
        margin_account: &mut MarginAccount,
        coin: Coin<USDC>,
        original_amount: u64,
        clock: &Clock,
    ) {
        let MarginReturnAuth {
            id,
            vault_id,
            min_return_amount,
            expires_at,
        } = auth;

        let current_time = clock::timestamp_ms(clock) / 1000;
        assert!(current_time < expires_at, E_MARGIN_EXPIRED);
        assert!(vault_id == object::id(vault), E_NOT_AUTHORIZED);
        assert!(vault_id == margin_account.vault_id, E_NOT_AUTHORIZED);

        let return_amount = coin::value(&coin);
        assert!(return_amount >= min_return_amount, E_INVALID_AMOUNT);

        object::delete(id);

        // Calculate P&L
        if (return_amount >= original_amount) {
            let profit = return_amount - original_amount;
            margin_account.cumulative_profit = margin_account.cumulative_profit + profit;
        } else {
            let loss = original_amount - return_amount;
            margin_account.cumulative_loss = margin_account.cumulative_loss + loss;
        };

        // Update allocation tracking
        if (margin_account.total_allocated >= original_amount) {
            margin_account.total_allocated = margin_account.total_allocated - original_amount;
        } else {
            margin_account.total_allocated = 0;
        };

        margin_account.trade_count = margin_account.trade_count + 1;

        // Calculate PnL for event
        let (is_profit, pnl_amount) = if (return_amount >= original_amount) {
            (true, return_amount - original_amount)
        } else {
            (false, original_amount - return_amount)
        };

        event::emit(MarginFundsReturned {
            vault_id,
            amount: return_amount,
            total_allocated: margin_account.total_allocated,
            pnl_amount,
            is_profit,
        });

        // Deposit back to vault
        sui_vault::deposit_usdc_from_trading(vault, coin);
    }

    // ============ Admin Functions ============

    /// Update margin trading settings
    /// Only Leader can update
    public fun update_margin_settings<USDC>(
        vault: &SuiVault<USDC>,
        leader_cap: &SuiLeaderCap,
        margin_account: &mut MarginAccount,
        max_leverage: u64,
        max_allocation_bps: u64,
        enabled: bool,
    ) {
        let vault_id = object::id(vault);
        assert!(sui_vault::leader_cap_vault_id(leader_cap) == vault_id, E_NOT_AUTHORIZED);
        assert!(margin_account.vault_id == vault_id, E_NOT_AUTHORIZED);

        // Validate leverage (1x to 20x)
        assert!(max_leverage >= 1_000 && max_leverage <= 20_000, E_EXCEEDED_MAX_LEVERAGE);
        // Validate allocation (max 80%)
        assert!(max_allocation_bps <= 8_000, E_EXCEEDED_MAX_ALLOCATION);

        // Don't allow disabling if there are outstanding allocations
        if (!enabled) {
            assert!(margin_account.total_allocated == 0, E_HAS_OUTSTANDING_ALLOCATION);
        };

        margin_account.max_leverage = max_leverage;
        margin_account.max_allocation_bps = max_allocation_bps;
        margin_account.enabled = enabled;

        event::emit(MarginSettingsUpdated {
            vault_id,
            max_leverage,
            max_allocation_bps,
            enabled,
        });
    }

    // ============ View Functions ============

    /// Get margin account vault ID
    public fun margin_vault_id(account: &MarginAccount): ID {
        account.vault_id
    }

    /// Get total allocated to margin
    public fun total_allocated(account: &MarginAccount): u64 {
        account.total_allocated
    }

    /// Get max leverage
    public fun max_leverage(account: &MarginAccount): u64 {
        account.max_leverage
    }

    /// Get max allocation in bps
    public fun max_allocation_bps(account: &MarginAccount): u64 {
        account.max_allocation_bps
    }

    /// Check if margin trading is enabled
    public fun is_enabled(account: &MarginAccount): bool {
        account.enabled
    }

    /// Get cumulative profit
    public fun cumulative_profit(account: &MarginAccount): u64 {
        account.cumulative_profit
    }

    /// Get cumulative loss
    public fun cumulative_loss(account: &MarginAccount): u64 {
        account.cumulative_loss
    }

    /// Get trade count
    public fun trade_count(account: &MarginAccount): u64 {
        account.trade_count
    }

    /// Calculate net PnL
    public fun net_pnl(account: &MarginAccount): (bool, u64) {
        if (account.cumulative_profit >= account.cumulative_loss) {
            (true, account.cumulative_profit - account.cumulative_loss)
        } else {
            (false, account.cumulative_loss - account.cumulative_profit)
        }
    }
}
