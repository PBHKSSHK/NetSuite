# Account → report_group Mapping Draft（v0.1，待會計確認）

**來源：** 2026-08-06 由 live account 拉出全份 active CoA（306 個 accounts）。
**用法：** 會計逐行剔 ✅／改組；❓ = 需要拍板嘅位。確認後 seed 入 Supabase
`report_group` + `dim_account.report_group_id`，production admin UI 可再改
（§10.5：mapping 唔 hardcode）。

## P&L — 收入

| Acct # | Account | 建議 group | 備註 |
|--------|---------|-----------|------|
| 60000000 + 16 個子帳（Activities / Advertising / Agency Fee / Consignment / Lecture / Management Fee / Marketing & Consultation / Other Service / Photo Shooting / Social Monitoring / Social Seeding / Venue Rental / Video Shooting / Webpage Design / Customer Income） | REV_SERVICE | |
| 60000030 Rental Income of Fixed Assets | REV_SERVICE ❓ | 定性：營運收入定 OTHER_INCOME？ |
| 61000000 + 3 個子帳（Air Tickets / Accommodation / Travel Packages） | REV_TRAVEL | |
| 62000000 + 14 個子帳（Books / Camera / Group Buy 系列 / Backpack / Motorbike Accessories） | REV_GOODS | |

## P&L — 其他收入（64xx）

| Acct # | Account | 建議 group | 備註 |
|--------|---------|-----------|------|
| 64000001 Interest Income | OTHER_INCOME | |
| 64000009 Other Income | OTHER_INCOME | |
| 64000002 Gain on Bargain Purchase（Associate） | ASSOC_INCOME | blueprint 指定獨立一行 |
| 64000003 Dividend Income | ASSOC_INCOME ❓ | accttype 係 Income；確認係咪只有聯營股息行呢個帳 |
| 64000004 Gain on disposal of Investment in Associate | ASSOC_INCOME | |

## P&L — 銷售成本（70xx）

| Acct # | Account | 建議 group |
|--------|---------|-----------|
| 70000004 Cost of Sales - Purchase、70000005 Shipping fee | COS_GOODS |
| 70000008 Cost of Services + 14 個子帳（Advertisement / Commission Paid / Copywriting / Judge Fee / Make Up / Others / Social Media Mgmt / Testing / **Tour Expense** / Travel & Transportation / Tuition / Venue Rental / Photographic & Video Making） | COS_SERVICES |

❓ **AGI 定義**（§9.1）：Travel income 計唔計入 AGI？Cost - Tour Expense 係旅遊直接成本，如 Travel 剔出 AGI，佢亦應獨立。

## P&L — 營運開支（81xx Department Cost，共 47 個）

| 建議 group | Accounts |
|-----------|----------|
| OPEX_STAFF | 81000084 Staffs Salaries、81000063 MPF Contributions、81000039 Directors Remunerations、81000081 Staff Messing/Training/Welfare、81000055 Medical Insurance |
| OPEX_RENT | 81000072 Rental Expenses、81000018 Building Management Fee、81000045 Electricity Water Gas、81000049 Government rent and rates、81000073 Rental of Fixed Assets ❓（interco 租？） |
| OPEX_DEPRECIATION | 81000033 Depreciation Expense |
| OPEX_ADMIN | 81000003 Accountancy、81000015 Audit、81000078 Secretarial、81000069 Professional Fee、81000021 BR Fee、81000051 Incorporation、81000054 Insurance、81000066 Postage & Courier、81000087 Stationery & Printing、81000036 Directors Meeting、81000090 Sundry |
| OPEX_IT | 81000057 Internet、81000099 Website、81000027 Computer & Accessories、81000093 Telephone & Fax ❓（IT 定 Admin？） |
| OPEX_MARKETING | 81000009 Advertising & Marketing、81000019 Business Development、81000006 Activities Expenses ❓、81000042 Donation ❓ |
| OPEX_OTHER | 81000048 Entertainment、81000060 Motor Vehicle Running、81000096 Travelling & Transportation、81000064 Overseas Travelling、81000030 Consumable Stores、81000024 Camera Accessories、81000075 Repairs & Maintenance、81000100 Warranty、81000077 Sample Fee、81000012 Agency Fee ❓、81000017 Bad Debts、81000026 Commission ❓（銷售佣金應否入 COS？） |
| ❓ 需拍板 | 81000059 Management Fee、81000068 Production Management Fee — **懷疑係 interco 收費**，合併層面應同 60000022 Management Fee Income 抵銷；確認後標 interco flag |
| ❓ 需拍板 | 81000070 Provision for Inventories P/L → 建議 COS_GOODS |

## P&L — 其他（82xx / 83xx / 85xx / 93xx）

| Acct # | Account | 建議 group | 備註 |
|--------|---------|-----------|------|
| 82000033 Depreciation (Group)、82000999 Reimbursement Expenses | OPEX_OTHER ❓ | 疑 interco recharge，確認性質 |
| 83000003 Gain/Loss on Disposal of FA、83000009 Loss on FA Written-Off | OTHER_EXPENSE（新組） | 建議 P&L 加一組「其他支出」放 EBITDA 之下 |
| 83000006 Exchange Difference + 系統 Realized/Unrealized/Rounding Gain-Loss | OTHER_EXPENSE（FX） | |
| 83000008 / 83000010 Impairment（subsidiaries / associate） | OTHER_EXPENSE | 合併層面注意與投資帳互動 |
| 85000002/06/08/09/10 Bank / Interest / Paypal / Convera / Airwallex Charges | OTHER_EXPENSE（finance costs） | |
| 93000003 Income Tax Expense | TAX | ❓ dashboard 純利顯示稅前定稅後（blueprint 未寫明） |
| id 58「6000 Expenses」（無 acctnumber 傳統帳） | ❓ | 查吓有冇 posting，冇就 inactivate |

## Balance Sheet（摘要 — 行項組）

| 範圍 | 建議 group | 備註 |
|------|-----------|------|
| 26xx Bank | BS_CASH | **Bank widget 只計 26xx**；27xx Cash in Hand 併入 BS_CASH 但可剔出 widget；**37004010 Control Account accttype 誤設 Bank——必須剔出**，建議 admin 改返正確 type |
| 23xx AcctRec | BS_AR | 23001016 Loan to Related Company ❓ → interco |
| 25xx Amount Due From…(To PB/SSHK) | BS_INTERCO_AR（新組） | interco 應收，合併層面應抵銷 |
| 21xx Inventory | BS_INVENTORY（新組） | demo 版未有，production 加 |
| 22xx Deposits / Prepaid | BS_OTHER_CA | |
| 11xx PPE | BS_FA | |
| 12xx Investments in Subsidiaries | 合併層面抵銷 ❓ | 單一公司 BS 顯示 |
| 13xx Investments in Associate（3 間：Jervois T / Jervois Solution / Go Asia Plus Travel） | BS_INV_ASSOC | blueprint §0.1 話 2 間——**請確認 associates 清單** |
| 14xx Investment（人壽保單） | BS_INV_OTHER（新組） | |
| 33xx AP、34xx Credit Cards | BS_AP | credit card 建議獨立一行 ❓ |
| 31xx Bank Loans（9 個帳）、31002 Shareholder Loan | BS_LOANS(新組) | demo 版未有——production BS 必須有借貸行項 |
| 35xx Amount Due To…（interco） | BS_INTERCO_AP（新組) | |
| 36xx Amount Due To Directors / Others | BS_DIRECTORS（新組）❓ | 定併入 accruals？ |
| 37xx Accrued / Tax / Received in Advance、32xx Customer Deposits | BS_ACCRUALS / BS_TAX | |
| 5xxx Equity（Share Capital / Retained Earnings / Dividends） | BS_SHARE_CAP / BS_RETAINED | 53000010 Dividends 獨立顯示 ❓ |
