// CFO 助手 — 規則引擎（第一層，確定性）。
// 由真數（store/queries）計出「發現 + 建議行動」，數字全部可追溯；
// 第二層（Claude API 每週 CFO 週評）由 edge function 生成後存 cfo_notes，
// 本 module 只負責 deterministic findings。
import { AR_OPEN, AP_OPEN, BANK_TODAY } from "./store";
import { OPERATING_SUBS, subsidiaryById } from "./dims";
import { sumFacts, REV_CODES, COS_CODES, OPEX_CODES } from "./queries";
import { ACTUAL_MONTHS, CURRENT_FY, TODAY } from "./fy";

export type Severity = "red" | "amber" | "info";

export interface Finding {
  area: string;
  severity: Severity;
  headline: string;
  detail: string;
  action: string;
}

const DAY = 86400000;

function daysOverdue(dueDate: string): number {
  return Math.floor((TODAY.getTime() - new Date(dueDate).getTime()) / DAY);
}

// ── 追數 ─────────────────────────────────────────────────────────────────────

export interface ChaseRow {
  entityName: string;
  totalOpen: number;
  overdue30: number;
  overdue60: number;
  oldestDays: number;
  invoices: { txnId: string; subsidiaryId: number; dueDate: string; days: number; amount: number }[];
}

/** 追數清單：按客戶合併逾期應收，逾期最耐排先。 */
export function chaseList(): ChaseRow[] {
  const byClient = new Map<string, ChaseRow>();
  for (const it of AR_OPEN) {
    const days = daysOverdue(it.dueDate);
    if (days <= 0) continue;
    let row = byClient.get(it.entityName);
    if (!row) {
      row = { entityName: it.entityName, totalOpen: 0, overdue30: 0, overdue60: 0, oldestDays: 0, invoices: [] };
      byClient.set(it.entityName, row);
    }
    row.totalOpen += it.amountOpen;
    if (days > 30) row.overdue30 += it.amountOpen;
    if (days > 60) row.overdue60 += it.amountOpen;
    row.oldestDays = Math.max(row.oldestDays, days);
    row.invoices.push({ txnId: it.txnId, subsidiaryId: it.subsidiaryId, dueDate: it.dueDate, days, amount: it.amountOpen });
  }
  const rows = [...byClient.values()];
  for (const r of rows) r.invoices.sort((a, b) => b.days - a.days);
  return rows.sort((a, b) => b.overdue60 - a.overdue60 || b.overdue30 - a.overdue30 || b.totalOpen - a.totalOpen);
}

/** 追數 WhatsApp/email 文字（copy 用） */
export function chaseReportText(): string {
  const rows = chaseList().filter((r) => r.overdue30 > 0).slice(0, 15);
  const lines = ["追數清單（逾期 >30 日，截至最新 sync）：", ""];
  for (const r of rows) {
    lines.push(`${r.entityName} — 逾期 $${Math.round(r.overdue30).toLocaleString()}（最耐 ${r.oldestDays} 日）`);
    for (const inv of r.invoices.filter((i) => i.days > 30).slice(0, 5)) {
      lines.push(`  ${inv.txnId}  到期 ${inv.dueDate}  $${Math.round(inv.amount).toLocaleString()}`);
    }
  }
  lines.push("", `合計逾期>30日：$${Math.round(rows.reduce((a, r) => a + r.overdue30, 0)).toLocaleString()}`);
  return lines.join("\n");
}

// ── 流動性／借貸 ─────────────────────────────────────────────────────────────

/** 近 N 個月每月純利（現金流 proxy——P&L 淨額；未扣 CapEx/還款）。
 *  facts 係「收入正、成本正」，所以 NP = 收入類 − 成本類。 */
function monthlyNet(subId: number, lookback = 3): number {
  const months = Array.from({ length: Math.min(lookback, ACTUAL_MONTHS) }, (_, i) => ACTUAL_MONTHS - i);
  const f = (groups: string[]) => sumFacts({ fy: CURRENT_FY, kind: "actual", subIds: [subId], months, groups });
  const income = f([...REV_CODES, "OTHER_INCOME", "ASSOC_INCOME"]);
  const costs = f([...COS_CODES, ...OPEX_CODES]);
  return (income - costs) / months.length;
}

export interface LiquidityRow {
  subsidiaryId: number;
  cash: number;
  floor: number;
  belowFloor: boolean;
  monthlyNet: number;
  runwayMonths: number | null;
  arOpen: number;
  apOpen: number;
}

export function liquidity(): LiquidityRow[] {
  return OPERATING_SUBS.map((s) => {
    const cash = BANK_TODAY[s.id] ?? 0;
    const net = monthlyNet(s.id);
    const ar = AR_OPEN.filter((x) => x.subsidiaryId === s.id).reduce((a, x) => a + x.amountOpen, 0);
    const ap = AP_OPEN.filter((x) => x.subsidiaryId === s.id).reduce((a, x) => a + x.amountOpen, 0);
    return {
      subsidiaryId: s.id,
      cash,
      floor: s.cashFloor,
      belowFloor: cash < s.cashFloor,
      monthlyNet: net,
      runwayMonths: net < 0 ? Math.round((cash / -net) * 10) / 10 : null,
      arOpen: ar,
      apOpen: ap,
    };
  });
}

// ── findings 引擎 ────────────────────────────────────────────────────────────

const fmtM = (v: number) => `$${(Math.abs(v) / 1_000_000).toFixed(2)}M`;
const fmtK = (v: number) => `$${Math.round(Math.abs(v) / 1000).toLocaleString()}K`;

export function findings(): Finding[] {
  const out: Finding[] = [];
  const liq = liquidity();
  const chase = chaseList();

  // 1. 追數
  const od60 = chase.reduce((a, r) => a + r.overdue60, 0);
  const od30 = chase.reduce((a, r) => a + r.overdue30, 0);
  if (od60 > 200_000) {
    const top = chase.filter((r) => r.overdue60 > 0).slice(0, 3).map((r) => r.entityName).join("、");
    out.push({
      area: "追數",
      severity: "red",
      headline: `逾期 60 日以上應收 ${fmtM(od60)}`,
      detail: `最大欠款：${top}。逾期 30 日以上合共 ${fmtM(od30)}。`,
      action: "用下面「追數清單」逐個跟進；逾期 >90 日兼仲有新工開緊嘅客，考慮暫停服務先收數。",
    });
  } else if (od30 > 100_000) {
    out.push({ area: "追數", severity: "amber", headline: `逾期 30 日以上應收 ${fmtM(od30)}`, detail: "整體受控，但要保持每週跟進節奏。", action: "每週一用追數清單過一次數。" });
  }

  // 2. 警戒線 / runway / 借貸
  for (const l of liq) {
    const name = subsidiaryById(l.subsidiaryId)?.short ?? String(l.subsidiaryId);
    if (l.belowFloor && l.runwayMonths != null && l.runwayMonths < 6) {
      const rich = liq.filter((x) => x.cash > x.floor * 1.5).sort((a, b) => b.cash - a.cash)[0];
      const richName = rich ? subsidiaryById(rich.subsidiaryId)?.short : null;
      out.push({
        area: "流動性",
        severity: "red",
        headline: `${name} 現金低於警戒線兼燒緊錢（runway ~${l.runwayMonths} 個月）`,
        detail: `現金 ${fmtK(l.cash)}，警戒線 ${fmtK(l.floor)}，近月平均淨流出 ${fmtK(l.monthlyNet)}；未收 A/R ${fmtK(l.arOpen)}。`,
        action: richName
          ? `即時：收返 A/R（追數清單有 ${name} 嘅逾期客）。次選：由 ${richName} 做 interco 貸款（記得立借據入帳）。借外債係最後手段——呢個規模嘅缺口未必值得孭利息。`
          : "即時：追收 A/R；同時檢視成本結構。",
      });
    } else if (l.belowFloor) {
      out.push({ area: "流動性", severity: "amber", headline: `${name} 現金貼近/低於警戒線`, detail: `現金 ${fmtK(l.cash)} vs 警戒線 ${fmtK(l.floor)}，但近月有淨流入。`, action: "暫時觀察；收數正常嘅話會自然回升。" });
    }
  }

  // 3. 集團層面借貸判斷
  const totalCash = liq.reduce((a, l) => a + l.cash, 0);
  const totalAp = liq.reduce((a, l) => a + l.apOpen, 0);
  const totalAr = liq.reduce((a, l) => a + l.arOpen, 0);
  if (totalCash > totalAp && totalAr > totalAp) {
    out.push({
      area: "借貸",
      severity: "info",
      headline: "集團層面暫時唔需要新借貸",
      detail: `集團現金 ${fmtM(totalCash)}＋未收 A/R ${fmtM(totalAr)}，冚得住未付 A/P ${fmtM(totalAp)}。問題係「錢喺邊間公司」，唔係「夠唔夠」。`,
      action: "優先用 interco 調配 + 追數解決個別公司緊張；想備而不用嘅話，趁業績好同銀行傾 standby credit line（唔用唔使息）。",
    });
  } else if (totalCash < totalAp * 0.8) {
    out.push({
      area: "借貸",
      severity: "red",
      headline: "集團現金唔夠冚短期應付",
      detail: `現金 ${fmtM(totalCash)} vs 未付 A/P ${fmtM(totalAp)}。`,
      action: "加速收數＋同主要供應商傾分期；並開始同銀行傾 working capital line。",
    });
  }

  // 4. 數據衞生（影響上面所有判斷嘅可信度）
  out.push({
    area: "數據質素",
    severity: "amber",
    headline: "收款/入單有時差，以上判斷或滯後",
    detail: "實測：供應商單平均遲 38 日入系統；收款批量遲入（最近一批 7月30日）。即係 A/R 可能偏大、近月成本偏細。",
    action: "會計改為收到錢當日入 CustPymt（dashboard 收數週報可直接 copy 俾老闆，慳返人手砌報告）。",
  });

  const order: Record<Severity, number> = { red: 0, amber: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
