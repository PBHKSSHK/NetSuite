# Dashboard 功能總覽 + 真數接通時間表

**Live site：** https://pbhk-group-dashboard-pbhk.vercel.app
**Repo branch：** [`claude/markdown-dashboard-vercel-xxzmt3`](https://github.com/PBHKSSHK/NetSuite/tree/claude/markdown-dashboard-vercel-xxzmt3)

## 「駁通後幾時有真數」三個級別

| 級別 | 意思 | 條件 |
|------|------|------|
| 🟢 **駁通即有** | OAuth credentials 到手 → 我起 Supabase + sync worker（1–2 個工作天）→ 呢啲功能自動轉真數，頁面唔使改 | 只需 NetSuite GL/AR/AP |
| 🟡 **需少量人手 input** | 接通後仲要一份人手維護嘅清單/檔案（一次過 setup + 定期更新） | retainer 清單、headcount、預算檔、評稅單等 |
| 🔴 **需新數據紀律** | 要開始收集而家未入系統嘅數據 | timesheet、project tagging（而家 19–26%）、opportunities |

## 頁面功能一覽

### [集團總覽 /](https://pbhk-group-dashboard-pbhk.vercel.app/)
| 功能 | 級別 |
|------|------|
| 每公司銀行結餘 + 警戒線 | 🟢（§10.4 已對數） |
| 集團現金 30 日走勢 | 🟢 |
| 合併純利逐月（實際 vs 預算 vs 去年） | 🟢 實際／去年；🟡 預算（NetSuite 冇 budget，要 import） |
| Agency 三大比率：Staff÷AGI、Overhead÷AGI、EBITDA margin on AGI | 🟢 |
| AGI per fee earner（年化） | 🟡（AGI 即有；fee earner 人數要人手） |
| 客戶集中度 | 🟢 |
| 例外警示中心 | 🟢 |

### [損益表 /pnl](https://pbhk-group-dashboard-pbhk.vercel.app/pnl)
| 功能 | 級別 |
|------|------|
| Report group 行項 P&L（實際/預算/差異/去年）+ AGI/EBITDA | 🟢（mapping 會計確認後；P&L 對數已證一仙不差） |
| 12 個月 trend | 🟢 |
| 分攤後 pro-forma toggle | 🟡（分攤 rules 已解通見 `allocation-rules.md`；要每月 headcount + 現行 GP%） |

### [資產負債表 /balance-sheet](https://pbhk-group-dashboard-pbhk.vercel.app/balance-sheet)
| 功能 | 級別 |
|------|------|
| As-of BS、銀行同源、A/R 對數檢查、合併含 Elimination | 🟢 |

### [預算 /budget](https://pbhk-group-dashboard-pbhk.vercel.app/budget)
| 功能 | 級別 |
|------|------|
| BvA 逐月、達成率、全年 outlook | 🟡（預算檔要 import——NetSuite 內冇 budget 數據） |
| **收入覆蓋率 Backlog Coverage**（新） | 🟡（要 retainer／已簽 SOW 清單，之後每月維護） |

### [現金流 /cashflow](https://pbhk-group-dashboard-pbhk.vercel.app/cashflow)
| 功能 | 級別 |
|------|------|
| 月度實際、每週客戶收支、13 週 rolling forecast | 🟢 |
| **稅務時間表入 forecast**（新） | 🟡（會計提供評稅單／繳稅日期） |
| A/R・A/P aging + DSO/DPO | 🟢 |
| **Interco vs 外部客 A/R 拆分**（新） | 🟢（真帳已見 SSHK 應收 PB 2.58M——呢個拆分好緊要） |
| **Intercompany 結欠 aging**（新） | 🟢 |
| **供應商集中度**（新) | 🟢 |

### [成本中心 /cost-center](https://pbhk-group-dashboard-pbhk.vercel.app/cost-center)
| 功能 | 級別 |
|------|------|
| Department 成本矩陣 + Untagged bucket + tagging hygiene | 🟢 |
| Photoblog Admin/IT/Mgt 分攤明細 | 🟡（rules 已完整解通 + NetSuite 驗證；要 headcount input） |

### 客戶 /clients（新頁）
| 功能 | 級別 |
|------|------|
| **客戶盈利能力 Client P&L** ⭐（收入−直接成本−分攤人力→邊個客蝕錢） | 🔴 收入/直接成本 🟢，人力分攤要 timesheet（PL by team workbook 已有雛形，可先用佢） |
| **新客 vs 舊客收入** | 🟢（以首次開票日期判別） |
| **客戶流失／保留率** | 🟢 |
| **信用風險 exposure**（A/R + 已承諾媒體投放 vs 額度） | 🟡（A/R 🟢；信用額度要人手設定） |
| **Pitch 勝率／成本** | 🔴（要開始用 opportunities 或 pitch log） |

### 營運 /operations（新頁）
| 功能 | 級別 |
|------|------|
| **Agency 三大比率**（大版） | 🟢 |
| **人手使用率 Utilisation**（per team） | 🔴（timesheet） |
| **實效時薪 Effective Rate**（AGI ÷ billable hours） | 🔴（timesheet） |
| **超服務 Over-servicing**（retainer 客 fee vs 投入時間成本） | 🔴（timesheet） |
| **Freelance／外判比率** | 🟢（外判成本 GL 有） |
| **人均產能 + headcount trend** | 🟡（headcount 每月人手入） |

### 業務線 /business-lines（新頁）
| 功能 | 級別 |
|------|------|
| **Jervois M 旅遊線**：bookings、take rate | 🟢 金額；🟡 booking 單數 |
| **CLS 商品線**：存貨周轉、sell-through | 🟢 |
| **704 製作線**：器材/shoot day 使用率、day-rate 回收 vs 折舊 | 🟡（shoot days 要記錄） |
| **聯營公司**：投資成本 vs 累計股息（3 間） | 🟢 |

## 一句總結

**🟢 佔大多數**——credentials 一到手、sync 起好（1–2 個工作天）就自動轉真數。
**🟡** 係一次過 setup（幾份清單 + 每月 5 分鐘維護）。
**🔴** 三個最有價值嘅指標（客戶盈利、utilisation、超服務）全部卡喺同一樣嘢：**timesheet**——
好消息係會計份 *PL by team* workbook 已經有 client-level 時間分攤雛形（YT time cost、
cost allocations on client sheets），Phase 1 可以直接攞佢做數據源，唔使等全公司改流程。

## 相關文件

- [接數前置驗證報告](netsuite-verification-2026-08-06.md) — SuiteQL 對數結果（P&L 一仙不差、TB 平衡）
- [CoA mapping draft](account-mapping-draft.md) — 等會計剔
- [分攤 rules](allocation-rules.md) — Photoblog Admin/IT/Mgt 分攤完整機制（已同真帳核對）
- [Blueprint](blueprint.md) — 成個項目藍圖
