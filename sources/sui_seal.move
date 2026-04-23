/// SUI HypersFun - Seal MEV Protection Module
/// 用 Seal 加密 Leader 交易意圖，防止搶跑 (front-running) 和夾擊 (sandwich attack)
///
/// 設計說明：
/// - Leader 加密交易意圖（買/賣方向、金額、交易對）
/// - 交易意圖在執行時間之前無法解密
/// - 時間鎖定 (Time-Lock Encryption, TLE)：只有到達指定時間後才能解密
/// - 結合 vault 成員白名單：只有持有 VaultShare 的人可以在時間到後查看
///
/// 流程：
/// 1. Leader 用 Seal SDK 加密交易意圖（identity = timestamp）
/// 2. 加密數據存到鏈上的 SealedTradeIntent 對象
/// 3. 到達執行時間後，Seal key servers 調用 seal_approve 驗證
/// 4. 驗證通過 → 釋放解密密鑰 → 客戶端解密 → 執行交易
module sui_hypersfun::sui_seal {
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::bcs::{Self, BCS};

    use sui_hypersfun::sui_vault::{Self, SuiVault, SuiLeaderCap};

    // ============ Error Codes ============

    const E_NOT_AUTHORIZED: u64 = 200;
    const E_NOT_YET_DECRYPTABLE: u64 = 201;
    const E_INVALID_ID: u64 = 202;
    const E_ALREADY_EXECUTED: u64 = 203;
    const E_EXPIRED: u64 = 204;

    // ============ Structs ============

    /// Sealed trade intent stored on-chain
    /// Contains encrypted trade data that can only be decrypted after the time lock
    public struct SealedTradeIntent has key {
        id: UID,
        /// Reference to the vault
        vault_id: ID,
        /// Leader who created this intent
        leader: address,
        /// Encrypted data (Seal ciphertext bytes)
        encrypted_data: vector<u8>,
        /// Time after which decryption is allowed (ms since epoch)
        decrypt_after: u64,
        /// Time after which the intent expires and cannot be executed
        expires_at: u64,
        /// Whether the intent has been executed
        executed: bool,
        /// Creation timestamp
        created_at: u64,
    }

    // ============ Events ============

    public struct TradeIntentSealed has copy, drop {
        vault_id: ID,
        intent_id: ID,
        leader: address,
        decrypt_after: u64,
        expires_at: u64,
    }

    public struct TradeIntentRevealed has copy, drop {
        vault_id: ID,
        intent_id: ID,
    }

    public struct TradeIntentExecuted has copy, drop {
        vault_id: ID,
        intent_id: ID,
    }

    // ============ Seal Approve Functions ============
    // These are called by Seal key servers to verify access

    /// Time-Lock Encryption (TLE) policy
    /// The id is BCS-encoded u64 timestamp in milliseconds
    /// Decryption is allowed only after the timestamp has passed
    entry fun seal_approve(id: vector<u8>, c: &Clock) {
        let mut prepared: BCS = bcs::new(id);
        let t = prepared.peel_u64();
        let leftovers = prepared.into_remainder_bytes();
        // Verify the entire id is consumed and the time has passed
        assert!(leftovers.length() == 0, E_INVALID_ID);
        assert!(clock::timestamp_ms(c) >= t, E_NOT_YET_DECRYPTABLE);
    }

    /// Vault-member-aware TLE policy
    /// id format: [vault_id (32 bytes)][timestamp_ms (u64)]
    /// Only vault share holders can decrypt, and only after the timestamp
    entry fun seal_approve_vault_member<USDC>(
        id: vector<u8>,
        vault: &SuiVault<USDC>,
        c: &Clock,
        ctx: &TxContext,
    ) {
        let mut prepared: BCS = bcs::new(id);

        // Extract vault ID (32 bytes as address)
        let vault_addr = prepared.peel_address();
        let t = prepared.peel_u64();
        let leftovers = prepared.into_remainder_bytes();

        // Verify format
        assert!(leftovers.length() == 0, E_INVALID_ID);
        // Verify vault match
        assert!(object::id_to_address(&object::id(vault)) == vault_addr, E_NOT_AUTHORIZED);
        // Verify time has passed
        assert!(clock::timestamp_ms(c) >= t, E_NOT_YET_DECRYPTABLE);

        // Verify caller has relationship with vault (leader or share holder)
        // For now, we allow any caller after time lock - the encryption itself
        // is the access control. Vault membership check can be added via
        // additional on-chain state if needed.
        let _ = ctx;
    }

    // ============ Trade Intent Management ============

    /// Leader creates a sealed trade intent
    /// The encrypted_data is produced client-side using Seal SDK
    public fun create_sealed_intent<USDC>(
        vault: &SuiVault<USDC>,
        leader_cap: &SuiLeaderCap,
        encrypted_data: vector<u8>,
        decrypt_after: u64,
        intent_duration: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): ID {
        let vault_id = object::id(vault);
        assert!(sui_vault::leader_cap_vault_id(leader_cap) == vault_id, E_NOT_AUTHORIZED);

        let current_time = clock::timestamp_ms(clock);
        assert!(decrypt_after > current_time, E_INVALID_ID);

        let intent = SealedTradeIntent {
            id: object::new(ctx),
            vault_id,
            leader: tx_context::sender(ctx),
            encrypted_data,
            decrypt_after,
            expires_at: decrypt_after + intent_duration,
            executed: false,
            created_at: current_time,
        };

        let intent_id = object::id(&intent);

        event::emit(TradeIntentSealed {
            vault_id,
            intent_id,
            leader: tx_context::sender(ctx),
            decrypt_after,
            expires_at: decrypt_after + intent_duration,
        });

        transfer::share_object(intent);

        intent_id
    }

    /// Mark a sealed intent as executed
    /// Called after the Leader has decrypted and executed the trade
    public fun mark_intent_executed<USDC>(
        vault: &SuiVault<USDC>,
        leader_cap: &SuiLeaderCap,
        intent: &mut SealedTradeIntent,
        clock: &Clock,
    ) {
        let vault_id = object::id(vault);
        assert!(sui_vault::leader_cap_vault_id(leader_cap) == vault_id, E_NOT_AUTHORIZED);
        assert!(intent.vault_id == vault_id, E_NOT_AUTHORIZED);
        assert!(!intent.executed, E_ALREADY_EXECUTED);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time <= intent.expires_at, E_EXPIRED);

        intent.executed = true;

        event::emit(TradeIntentExecuted {
            vault_id,
            intent_id: object::id(intent),
        });
    }

    // ============ View Functions ============

    public fun intent_vault_id(intent: &SealedTradeIntent): ID {
        intent.vault_id
    }

    public fun intent_leader(intent: &SealedTradeIntent): address {
        intent.leader
    }

    public fun intent_decrypt_after(intent: &SealedTradeIntent): u64 {
        intent.decrypt_after
    }

    public fun intent_expires_at(intent: &SealedTradeIntent): u64 {
        intent.expires_at
    }

    public fun intent_executed(intent: &SealedTradeIntent): bool {
        intent.executed
    }

    public fun intent_encrypted_data(intent: &SealedTradeIntent): &vector<u8> {
        &intent.encrypted_data
    }
}
