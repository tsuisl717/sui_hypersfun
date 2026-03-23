# Product Requirements Document (PRD)

# PRD Title: HypersFun CopyFundFi Protocol on SUI

**Author:** HypersFun Team
**Version:** 1.0
**Date:** 2026-03-20

| Role | Name |
| :---- | :---- |
| Product Manager | HypersFun PM |
| Engineering Lead | Blockchain Dev Team |
| Designer | UI/UX Team |
| Approvers/Sign-Off | Founders |

---

# Objective

**目標：** 在 SUI 區塊鏈上構建去中心化的 CopyFundFi（跟單基金）協議，讓任何人都能輕鬆創建和管理投資基金，同時讓投資者能夠安全地跟隨優秀交易員的策略獲利。

**解決的問題：**
1. 散戶投資者缺乏專業交易能力，難以在加密市場獲利
2. 優秀交易員缺乏資金槓桿，無法放大收益
3. 現有跟單平台中心化、不透明、資金安全無保障
4. 傳統基金門檻高，普通人難以參與

**核心價值：**
- **Leader（交易員）：** 用他人資金交易，賺取績效費，無需自有大量資金
- **Follower（投資者）：** 被動投資，跟隨專業交易員策略，資金鏈上安全

---

## Overview

### 產品概述

**HypersFun** 是一個部署在 SUI 區塊鏈上的去中心化 CopyFundFi 協議。透過創新的 Bonding Curve 機制和智能合約，實現：

1. **Vault 創建**：任何人都可以一鍵創建自己的投資基金（Vault）
2. **代幣化份額**：投資者透過 Bonding Curve 購買 VaultShare 代幣，代表基金份額
3. **安全交易**：Leader 只能用 Vault 資金交易，無法提取
4. **透明收益**：所有交易和績效鏈上可查

### 為什麼選擇 SUI？

| 特性 | SUI 優勢 |
|------|---------|
| 交易速度 | 亞秒級確認（~400ms） |
| Gas 費用 | 極低（~$0.001/tx） |
| 可組合性 | Move 語言的 Object Model 更安全 |
| 生態系統 | 完整的 DeFi 基礎設施（Cetus、DeepBook） |

### Voice of Customer 洞察

基於市場研究，用戶最關心：
- **安全性**：資金不會被 Leader 捲款跑路
- **透明度**：能看到 Leader 的歷史績效
- **易用性**：操作簡單，無需複雜的 DeFi 知識
- **低門檻**：小額資金也能參與

---

## Scope

### 包含範圍（MVP）

| 功能模塊 | 描述 | 優先級 |
|---------|------|--------|
| Vault 創建 | 一鍵創建投資基金 | P0 |
| Bonding Curve 購買 | 用 USDC 購買 VaultShare | P0 |
| VaultShare 出售 | 賣出份額獲得 USDC | P0 |
| Trading Module | Leader 在 DEX 交易 | P0 |
| 績效費 | Leader 賺取利潤分成 | P1 |
| 退出費 | 時間基礎的退出費用 | P1 |
| 前端界面 | Web3 DApp | P1 |

### 不包含範圍（MVP 後）

| 功能 | 計劃時間 |
|------|---------|
| ZK Shielded Pool（隱私層） | Phase 2 (Q3 2026) |
| 多鏈支持 | Phase 3 |
| 社交功能（排行榜、跟隨） | Phase 2 |
| 移動端 App | Phase 3 |

---

## Problem

### 問題陳述

> **「加密貨幣市場中，90% 的散戶投資者虧損，而專業交易員卻缺乏足夠資金。現有的跟單平台要麼中心化（有跑路風險），要麼操作複雜（門檻高），導致雙方都無法有效獲益。」**

### 痛點分析

| 用戶類型 | 痛點 | 現有解決方案的問題 |
|---------|------|-------------------|
| 散戶投資者 | 不會交易、時間有限 | 中心化平台不透明，資金風險高 |
| 專業交易員 | 資金有限、無法規模化 | 需要大量自有資金，收益受限 |
| 機構投資者 | 合規要求、資金安全 | 鏈上協議缺乏 KYC/AML 支持 |

### 商業重要性

- **市場規模**：全球跟單交易市場 2025 年預計達 $50B+
- **SUI 生態機會**：目前缺乏成熟的 CopyFi 協議
- **先發優勢**：搶占 SUI DeFi 用戶

---

## Constraints

### 限制條件

1. **技術限制**
   - SUI 測試網 DEX 流動性有限
   - Move 語言學習曲線（團隊需要適應）
   - Cetus/DeepBook SDK 穩定性

2. **時間限制**
   - MVP 需在 8 週內完成
   - 主網上線前需完成安全審計

3. **資源限制**
   - 開發團隊 2-3 人
   - 審計預算有限

4. **合規限制**
   - 部分地區可能有監管要求
   - KYC/AML 暫不在 MVP 範圍

---

## Persona

### 目標用戶畫像

| Persona | 描述 |
| :---- | :---- |
| **Alpha Hunter（散戶投資者）** | 25-45 歲，有一定加密資產，想被動投資但不會交易。期望：低門檻投入、透明績效、資金安全。 |
| **Pro Trader（專業交易員）** | 全職交易員，有穩定策略但缺乏資金。期望：用他人資金放大收益、賺取績效費、建立個人品牌。 |
| **Degen Farmer（DeFi 玩家）** | 熟悉 DeFi，尋找高收益機會。期望：創新玩法、早期進入獎勵、治理權益。 |

### Key Persona: Alpha Hunter

這是主要目標用戶，佔潛在用戶的 70%+。他們：
- 持有 $1K-$50K 加密資產
- 每天花 < 1 小時研究市場
- 之前在 CEX 跟單平台有過經驗
- 最關心資金安全和收益穩定性

---

## Use Cases

### **Scenario 1: 散戶投資者首次投資**

**用戶：** Alice（Alpha Hunter）
**背景：** Alice 有 1,000 USDC，想投資但不會交易
**流程：**
1. Alice 連接 SUI 錢包到 HypersFun DApp
2. 瀏覽 Vault 列表，查看各 Leader 的歷史績效
3. 選擇一個 30 天回報 15% 的 Vault
4. 輸入 500 USDC，點擊「Buy」
5. 通過 Bonding Curve 獲得 VaultShare 代幣
6. 查看儀表板，追蹤投資表現

**成功指標：** 完成購買 < 2 分鐘，Gas < $0.01

---

### **Scenario 2: 交易員創建並管理 Vault**

**用戶：** Bob（Pro Trader）
**背景：** Bob 是經驗豐富的交易員，想用 HypersFun 擴大收益
**流程：**
1. Bob 連接錢包，點擊「Create Vault」
2. 設置 Vault 參數（名稱、績效費率 20%）
3. 存入初始資金 100 USDC（種子資金）
4. Vault 創建成功，獲得 LeaderCap
5. 當有投資者進入時，Bob 可以在 Trading Panel 交易
6. 使用 USDC 在 Cetus/DeepBook 買入 SUI
7. 平倉後，利潤自動計入 Vault NAV
8. 投資者賣出時，Bob 獲得 20% 績效費

**成功指標：** 創建 Vault < 1 分鐘，交易執行 < 5 秒

---

### **Scenario 3: 投資者退出獲利**

**用戶：** Alice（持有 VaultShare 30 天後）
**背景：** Vault NAV 上漲 20%，Alice 想獲利了結
**流程：**
1. Alice 進入「My Portfolio」頁面
2. 看到當前 VaultShare 價值 600 USDC（原投入 500）
3. 點擊「Sell All」
4. 系統顯示：
   - 賣出價值：600 USDC
   - 績效費（20% × 100 利潤）：20 USDC
   - 退出費（0%，因持有 > 7 天）：0 USDC
   - 淨收入：580 USDC
5. 確認後，580 USDC 轉入錢包

**成功指標：** 賣出確認 < 3 秒，費用計算透明

---

## Features In

### **Feature 1: Vault 創建與管理（P0）**

**描述：** 用戶可以一鍵創建自己的投資基金（Vault），設置基本參數。

**Capabilities:**
- 設定 Vault 名稱和描述
- 設定績效費率（0-30%）
- 存入初始種子資金
- 獲得 LeaderCap（管理憑證）

**驗收標準：**
- [ ] 用戶能在 60 秒內完成 Vault 創建
- [ ] Vault 在 Factory 正確註冊
- [ ] LeaderCap 正確授予創建者
- [ ] 初始資金正確存入 Vault

**技術複雜度：** 中
**優先級：** P0

---

### **Feature 2: Bonding Curve 購買（P0）**

**描述：** 投資者通過 Bonding Curve 機制購買 VaultShare 代幣。

**Capabilities:**
- 輸入 USDC 金額，自動計算獲得的 VaultShare 數量
- 滑點保護（用戶可設定最大滑點）
- TWAP NAV 保護（防止價格操縱）
- 實時價格預覽

**驗收標準：**
- [ ] 購買計算公式正確（符合 Bonding Curve 數學）
- [ ] 滑點超出設定時交易失敗
- [ ] VaultShare 正確鑄造並轉給用戶
- [ ] USDC 正確存入 Vault

**技術複雜度：** 高
**優先級：** P0

---

### **Feature 3: VaultShare 出售（P0）**

**描述：** 用戶可以隨時賣出 VaultShare，獲得 USDC。

**Capabilities:**
- 賣出時按當前 NAV 計算價值
- 自動扣除績效費（如有利潤）
- 自動扣除退出費（基於持有時間）
- Pending Sell 機制（大額賣出可能需要等待流動性）

**驗收標準：**
- [ ] NAV 計算正確（含 Tiered Virtual Assets）
- [ ] 績效費正確計算並轉給 Leader
- [ ] 退出費正確計算（依時間階梯）
- [ ] Pending Sell 正確建立和領取

**技術複雜度：** 高
**優先級：** P0

---

### **Feature 4: Trading Module（P0）**

**描述：** Leader 可以使用 Vault 資金在 SUI DEX 進行交易。

**Capabilities:**
- 授權交易（TradeAuthorization）
- 在 Cetus/DeepBook 執行 Swap
- 支持現貨交易（未來支持永續合約）
- 資金始終在 Vault 內，Leader 無法提取

**驗收標準：**
- [ ] TradeAuthorization 正確創建和消費
- [ ] PTB 原子交易執行成功
- [ ] 交易輸出正確返回 Vault
- [ ] 每日限額和單筆限額正確執行

**技術複雜度：** 高
**優先級：** P0

---

### **Feature 5: 績效費系統（P1）**

**描述：** Leader 在投資者獲利時賺取績效費。

**Capabilities:**
- 追蹤每個用戶的入場 NAV
- 賣出時計算實際利潤
- 按設定比例扣除績效費
- 績效費自動鑄造為 Leader 的 VaultShare

**驗收標準：**
- [ ] 入場 NAV 正確記錄（加權平均）
- [ ] 利潤計算準確
- [ ] 績效費正確鑄造
- [ ] 無利潤時不收績效費

**技術複雜度：** 中
**優先級：** P1

---

### **Feature 6: 退出費系統（P1）**

**描述：** 根據持有時間收取階梯式退出費，鼓勵長期持有。

**Capabilities:**
- 追蹤用戶購買時間
- 階梯式費率：
  - 0-3 天：3%
  - 3-7 天：1.5%
  - 7+ 天：0%
- 退出費進入 Vault（提升 NAV）

**驗收標準：**
- [ ] 購買時間正確記錄
- [ ] 費率計算正確
- [ ] 退出費正確處理

**技術複雜度：** 低
**優先級：** P1

---

## Features Out

### **Feature 1: ZK Shielded Pool（隱私層）**

**原因：** MVP 聚焦核心功能，ZK 電路開發和審計需要大量時間和資源。

**計劃：** Phase 2 (Q3 2026)

---

### **Feature 2: 永續合約交易**

**原因：** 需要整合 Aftermath Finance 或其他 Perps 協議，增加複雜度。

**計劃：** MVP 後根據用戶需求評估

---

### **Feature 3: 社交功能（排行榜、跟隨、評論）**

**原因：** 非核心功能，可後續迭代。

**計劃：** Phase 2

---

### **Feature 4: 治理代幣**

**原因：** 需要成熟的用戶基礎和清晰的代幣經濟模型。

**計劃：** Phase 3

---

## Design

### UI/UX 原則

1. **簡潔優先**：首頁只顯示最重要的信息
2. **一鍵操作**：主要功能不超過 3 次點擊
3. **透明展示**：費用、風險清晰可見
4. **移動友好**：響應式設計

### 關鍵頁面

| 頁面 | 功能 |
|------|------|
| Home | Vault 列表、績效排行、TVL 統計 |
| Vault Detail | NAV 圖表、交易歷史、Buy/Sell 面板 |
| Create Vault | 創建表單、參數設置 |
| My Portfolio | 持倉概覽、PnL 統計 |
| Trading Panel | Leader 交易界面 |

### 設計參考

- Uniswap（簡潔的交易界面）
- GMX（永續合約 UI）
- Zapper（投資組合展示）

---

## Technical Considerations

### 技術架構

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                   │
│                   @mysten/dapp-kit                       │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                   SUI Blockchain                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ sui_factory │  │  sui_vault  │  │ sui_trading │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                         │                               │
│                         ▼                               │
│  ┌─────────────────────────────────────────────┐       │
│  │         DEX Integration (PTB)                │       │
│  │    Cetus Aggregator / DeepBook V3            │       │
│  └─────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### 智能合約模塊

| 模塊 | 功能 | 狀態 |
|------|------|------|
| sui_factory.move | Factory + Admin | ✅ 完成 |
| sui_vault.move | Vault + Bonding Curve | ✅ 完成 |
| sui_trading.move | Trading Module | ✅ 完成 |
| sui_types.move | 類型定義 | ✅ 完成 |
| sui_math.move | 數學工具 | ✅ 完成 |

### 關鍵技術決策

1. **Object Model**：Vault 為 Shared Object，VaultShare 為 Owned Object
2. **代幣標準**：使用 SUI 原生 Coin<T> + TreasuryCap
3. **DEX 整合**：PTB（Programmable Transaction Block）實現原子操作
4. **升級策略**：Move Package Upgrade

---

## Success Metrics

### 核心 KPI

| 指標 | MVP 目標 | 測量方法 |
|------|---------|---------|
| TVL（總鎖定價值） | $100K+ | 鏈上數據 |
| 活躍 Vault 數量 | 20+ | Factory 創建數 |
| 日活用戶（DAU） | 100+ | 前端 Analytics |
| 平均交易成功率 | > 99% | 智能合約事件 |
| 用戶留存（7日） | > 30% | 錢包追蹤 |

### 技術 KPI

| 指標 | 目標 |
|------|------|
| 交易確認時間 | < 2 秒 |
| 合約錯誤率 | < 0.1% |
| 前端載入時間 | < 3 秒 |
| 安全審計發現 | 0 Critical, 0 High |

### 用戶滿意度

- NPS（淨推薦值）> 30
- 用戶反饋處理時間 < 24 小時

---

## GTM Approach

### 產品定位

> **「HypersFun - 讓每個人都能成為基金經理或投資人」**

### 目標市場

1. **Primary**：SUI 生態 DeFi 用戶
2. **Secondary**：其他鏈的跟單交易用戶
3. **Tertiary**：傳統金融投資者（進入加密）

### 上線策略

| 階段 | 時間 | 活動 |
|------|------|------|
| Testnet Beta | Week 1-4 | 邀請制測試、Bug Bounty |
| Mainnet Soft Launch | Week 5-6 | 限額開放、早期用戶獎勵 |
| Public Launch | Week 7+ | 全面開放、營銷推廣 |

### 營銷渠道

- Twitter/X 社群
- Discord 社群
- SUI 生態合作
- KOL 合作推廣
- 內容營銷（教程、分析）

---

## Open Issues

### 待解決問題

| 問題 | 狀態 | 計劃 |
|------|------|------|
| Testnet DEX 流動性不足 | 進行中 | 主網測試或 Mock DEX |
| 安全審計供應商選擇 | 待定 | 評估 OtterSec, MoveBit |
| 績效費計算邊界情況 | 待確認 | 補充測試用例 |
| 大額賣出流動性不足 | 設計中 | Pending Sell 機制 |

### 風險評估

| 風險 | 概率 | 影響 | 緩解措施 |
|------|------|------|---------|
| 智能合約漏洞 | 中 | 高 | 多輪審計 + Bug Bounty |
| DEX 整合失敗 | 低 | 中 | 多 DEX 支持 |
| 用戶採用不足 | 中 | 中 | 早期激勵計劃 |
| 監管風險 | 低 | 高 | 法律諮詢 + KYC 準備 |

---

## Q&A

| Asked by | Question | Answer |
| ----- | ----- | ----- |
| 投資者 | 我的資金安全嗎？ | Vault 資金由智能合約管理，Leader 只能交易不能提取。合約經過審計。 |
| Leader | 我能賺多少？ | 根據設定的績效費率，投資者獲利的 X% 歸你。例如 20% 績效費，1000 USDC 利潤你賺 200。 |
| 技術 | 為什麼用 SUI 不用 ETH？ | SUI 更快（~400ms）、更便宜（~$0.001）、Move 語言更安全。 |
| 投資者 | 可以隨時退出嗎？ | 可以，但持有時間短會有退出費（0-3天 3%，3-7天 1.5%，7天+ 0%）。 |
| 監管 | 需要 KYC 嗎？ | MVP 不需要，但我們預留了 ZK-KYC 接口供未來合規需求。 |

---

## Feature Timeline and Phasing

| Feature | Status | Target Date |
| ----- | ----- | ----- |
| Move 合約開發 | ✅ Shipped | 2026-03 |
| Trading Module | ✅ Shipped | 2026-03 |
| DEX 整合（Cetus/DeepBook） | 🟡 In Progress | 2026-03 |
| 前端開發 | Backlog | 2026-04 |
| Testnet 測試 | Backlog | 2026-04 |
| 安全審計 | Backlog | 2026-05 |
| Mainnet 上線 | Backlog | 2026-06 |
| ZK Shielded Pool | Backlog | 2026-Q3 |

---

# PRD Checklist

| Order | Topic | Status |
| ----- | ----- | ----- |
| 1. | Title | ✅ Done |
| 2. | Author | ✅ Done |
| 3. | Decision Log | ✅ Done |
| 4. | Change History | ✅ Done |
| 5. | Overview | ✅ Done |
| 6. | Success Metrics | ✅ Done |
| 7. | Messaging | ✅ Done |
| 8. | Timeline/Release Planning | ✅ Done |
| 9. | Personas | ✅ Done |
| 10. | User Scenarios | ✅ Done |
| 11. | User Stories/Features/Requirements | ✅ Done |
| 12. | Features In | ✅ Done |
| 13. | Features Out | ✅ Done |
| 14. | Design | ✅ Done |
| 15. | Open Issues | ✅ Done |
| 16. | Q&A | ✅ Done |
| 17. | Other Considerations | ✅ Done |

---

# Appendix

## A. Bonding Curve 數學公式

```
購買公式：tokens_out = supply × ((1 + usdc_in / reserve)^(1/n) - 1)
出售公式：usdc_out = reserve × (1 - (1 - tokens_in / supply)^n)

其中 n = 曲線斜率參數（默認 = 2）
```

## B. NAV 計算

```
NAV = (EVM資產 + 永續合約價值 + 虛擬資產) / 總供應量
TWAP_NAV = 平滑後的 NAV（防止短期價格操縱）
```

## C. 退出費階梯

| 持有時間 | 退出費率 |
|---------|---------|
| 0-3 天 | 3.0% |
| 3-7 天 | 1.5% |
| 7-14 天 | 0.5% |
| 14+ 天 | 0% |

---

*Document Version: 1.0*
*Last Updated: 2026-03-20*
