"use client";

// 客戶 Clients — 第一層 section 已換真數（dim_client_info × fact_client_revenue ×
// fact_ar_open）：收入榜、新客 vs 舊客、流失/保留、信用風險、cross-sell。
// 找數行為、Pitch 勝率未有數據源，維持 demo（header 有 DEMO badge），
// 數據層見 lib/agency.ts。

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/charts";
import { Card, ExportButton, StatTile, exportCsv } from "@/components/ui";
import { paymentBehaviour, pitchStats } from "@/lib/agency";
import { chaseList } from "@/lib/advisor";
import { subsidiaryById } from "@/lib/dims";
import { hkd, hkdCompact } from "@/lib/format";
import { ACTUAL_MONTHS, CURRENT_FY_START_YEAR, fyMonthFull, fyMonthLabel } from "@/lib/fy";
import { AR_BY_CUSTOMER, CLIENT_INFO, CLIENT_REVENUE } from "@/lib/store";
import { usePalette } from "@/lib/theme";

const AXIS_FONT = { fontSize: 11 };

// ── 真數 helpers（讀 hydration store — DataBoot 保證 hydrate 完先 render）────

/** FY2026/27 YTD 窗口 = 2026-04..2026-07（2026-08 未關帳唔計） */
const YTD_START = fyMonthFull(1);
const YTD_END = fyMonthFull(ACTUAL_MONTHS);
/** FY2025/26 全年 = 2025-04..2026-03 */
const PRIOR_START = fyMonthFull(1, CURRENT_FY_START_YEAR - 1);
const PRIOR_END = fyMonthFull(12, CURRENT_FY_START_YEAR - 1);

/** 流失判定門檻：上年收入 > 10K 先算活躍客 */
const CHURN_MIN_PRIOR = 10_000;

/** dims.ts 未列、但 dim_subsidiary / fact_client_revenue 有嘅公司 */
const EXTRA_SUB_SHORT: Record<number, string> = { 3: "CLS Prod", 6: "Go Asia" };

function subShort(id: number): string {
  return subsidiaryById(id)?.short ?? EXTRA_SUB_SHORT[id] ?? `#${id}`;
}

interface ClientAgg {
  customerId: number;
  name: string;
  sector: string | null;
  isRelated: boolean;
  isRetainer: boolean;
  retainerMonthly: number | null;
  creditLimit: number | null;
  firstYm: string | null;
  confirmed: boolean;
  /** FY26/27 YTD 收入（HKD 淨額） */
  ytd: number;
  /** FY25/26 全年收入 */
  prior: number;
  /** 有收入嘅開票公司（YTD 優先；YTD 冇就用上年） */
  subs: number[];
}

/** dim_client_info × fact_client_revenue 併成每客 aggregate。
 *  fact 有啲舊 customer_id 唔喺 dim（非活躍名單）——唔入榜。 */
function clientAggs(): ClientAgg[] {
  const byId = new Map<
    number,
    { info: (typeof CLIENT_INFO)[number]; ytd: number; prior: number; subsYtd: Set<number>; subsPrior: Set<number> }
  >();
  for (const c of CLIENT_INFO) {
    byId.set(c.customerId, { info: c, ytd: 0, prior: 0, subsYtd: new Set(), subsPrior: new Set() });
  }
  for (const r of CLIENT_REVENUE) {
    const a = byId.get(r.customerId);
    if (!a) continue;
    if (r.ym >= YTD_START && r.ym <= YTD_END) {
      a.ytd += r.amount;
      if (r.amount !== 0) a.subsYtd.add(r.subsidiaryId);
    } else if (r.ym >= PRIOR_START && r.ym <= PRIOR_END) {
      a.prior += r.amount;
      if (r.amount !== 0) a.subsPrior.add(r.subsidiaryId);
    }
  }
  return [...byId.values()].map((a) => ({
    customerId: a.info.customerId,
    name: a.info.name,
    sector: a.info.sector,
    isRelated: a.info.isRelated,
    isRetainer: a.info.isRetainer,
    retainerMonthly: a.info.retainerMonthly,
    creditLimit: a.info.creditLimit,
    firstYm: a.info.firstYm,
    confirmed: a.info.confirmed,
    ytd: Math.round(a.ytd),
    prior: Math.round(a.prior),
    subs: [...(a.subsYtd.size ? a.subsYtd : a.subsPrior)].sort((x, y) => x - y),
  }));
}

/** FY26/27 逐月新客 vs 舊客收入（外部客 only；新客 = first_ym >= 2026-04） */
function newVsExistingMonthly(): { label: string; existingRev: number; newRev: number }[] {
  const info = new Map(CLIENT_INFO.map((c) => [c.customerId, c]));
  const slots = Array.from({ length: ACTUAL_MONTHS }, (_, i) => ({
    ym: fyMonthFull(i + 1),
    label: fyMonthLabel(i + 1),
    existingRev: 0,
    newRev: 0,
  }));
  const byYm = new Map(slots.map((s) => [s.ym, s]));
  for (const r of CLIENT_REVENUE) {
    const slot = byYm.get(r.ym);
    if (!slot) continue;
    const c = info.get(r.customerId);
    if (c?.isRelated) continue; // 只計外部客（唔喺 dim 嘅舊 record 當舊客）
    if (c?.firstYm != null && c.firstYm >= YTD_START) slot.newRev += r.amount;
    else slot.existingRev += r.amount;
  }
  return slots.map((s) => ({ label: s.label, existingRev: Math.round(s.existingRev), newRev: Math.round(s.newRev) }));
}

const CS_SUBS = [1, 2, 5, 7, 8];

interface CrossSellRow {
  name: string;
  sector: string | null;
  revBySub: Record<number, number>;
  subCount: number;
  totalRev: number;
}

/** Cross-sell：名稱相同（trim + lowercase）嘅 customer records 合併為一個品牌，
 *  同一 record 跨 sub 開票亦自然入矩陣。FY26/27 YTD、只計 5 間主要公司。 */
function crossSellRows(): CrossSellRow[] {
  const info = new Map(CLIENT_INFO.map((c) => [c.customerId, c]));
  const byBrand = new Map<string, { name: string; sector: string | null; rev: Record<number, number> }>();
  for (const r of CLIENT_REVENUE) {
    if (r.ym < YTD_START || r.ym > YTD_END) continue;
    if (!CS_SUBS.includes(r.subsidiaryId)) continue;
    const c = info.get(r.customerId);
    if (!c || c.isRelated) continue;
    const key = c.name.trim().toLowerCase();
    let b = byBrand.get(key);
    if (!b) {
      b = { name: c.name.trim(), sector: c.sector, rev: {} };
      byBrand.set(key, b);
    }
    if (!b.sector && c.sector) b.sector = c.sector;
    b.rev[r.subsidiaryId] = (b.rev[r.subsidiaryId] ?? 0) + r.amount;
  }
  return [...byBrand.values()]
    .map((b) => {
      const revBySub: Record<number, number> = {};
      for (const s of CS_SUBS) revBySub[s] = Math.round(b.rev[s] ?? 0);
      return {
        name: b.name,
        sector: b.sector,
        revBySub,
        subCount: CS_SUBS.filter((s) => revBySub[s] > 0).length,
        totalRev: CS_SUBS.reduce((a, s) => a + revBySub[s], 0),
      };
    })
    .filter((b) => b.totalRev > 100_000)
    .sort((a, b) => b.totalRev - a.totalRev)
    .slice(0, 15);
}

// ── 小組件 ───────────────────────────────────────────────────────────────────

function RetainerBadge() {
  return (
    <span className="text-[10px] text-accent border border-accent/40 rounded px-1 py-px whitespace-nowrap">
      Retainer
    </span>
  );
}

function DemoBadge() {
  return (
    <span className="text-[10px] font-medium text-warn bg-warn/10 border border-warn/40 rounded px-1.5 py-px shrink-0">
      DEMO
    </span>
  );
}

function SourceNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-ink3 mt-2">真數來源：{children}</p>;
}

function DemoNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-ink3 mt-2">{children}</p>;
}

function MiniTile({ label, value, note, bad }: { label: string; value: string; note?: string; bad?: boolean }) {
  return (
    <div className="rounded-lg border border-ringc px-3 py-2.5">
      <div className="text-[11px] text-ink3">{label}</div>
      <div className={`text-xl font-semibold num ${bad ? "text-critical" : ""}`}>{value}</div>
      {note && <div className="text-[10px] text-ink3 mt-0.5">{note}</div>}
    </div>
  );
}

function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  const p = usePalette();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1 px-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: p.inkSecondary }}>
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── 圖表（跟 charts.tsx 寫法：2px 線、≤24px bar、4px 圓角 data-end、ink 字色）──

function NewVsExistingChart({
  data,
  height = 230,
}: {
  data: { label: string; existingRev: number; newRev: number }[];
  height?: number;
}) {
  const p = usePalette();
  return (
    <div>
      <ChartLegend
        items={[
          { label: "舊客收入", color: p.series[0] },
          { label: "新客收入", color: p.series[1] },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis tickFormatter={(v: number) => hkdCompact(v)} tick={AXIS_FONT} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: p.grid, opacity: 0.4 }} />
          {/* stacked：段與段之間用 surface stroke 造 2px 間隔 */}
          <Bar name="舊客收入" dataKey="existingRev" stackId="rev" fill={p.series[0]} barSize={22} stroke={p.surface} strokeWidth={1} />
          <Bar name="新客收入" dataKey="newRev" stackId="rev" fill={p.series[1]} barSize={22} radius={[4, 4, 0, 0]} stroke={p.surface} strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function PitchBars({
  data,
  height = 190,
}: {
  data: { label: string; pitches: number; won: number }[];
  height?: number;
}) {
  const p = usePalette();
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Pitch 數", color: p.series[0] },
          { label: "贏單", color: p.series[1] },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={p.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_FONT} tickLine={false} axisLine={{ stroke: p.axis }} />
          <YAxis allowDecimals={false} tick={AXIS_FONT} tickLine={false} axisLine={false} width={30} />
          <Tooltip
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                label={label}
                payload={payload?.map((r) => ({ ...r, value: `${r.value} 次` }))}
              />
            )}
            cursor={{ fill: p.grid, opacity: 0.4 }}
          />
          <Bar name="Pitch 數" dataKey="pitches" fill={p.series[0]} barSize={14} radius={[4, 4, 0, 0]} />
          <Bar name="贏單" dataKey="won" fill={p.series[1]} barSize={14} radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 頁面 ─────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const aggs = clientAggs();
  const external = aggs.filter((a) => !a.isRelated);
  const related = aggs
    .filter((a) => a.isRelated && (a.ytd !== 0 || a.prior !== 0))
    .sort((x, y) => y.ytd - x.ytd || y.prior - x.prior);

  // 1) 收入榜：外部客按 FY26/27 YTD 排
  const ranking = external.filter((a) => a.ytd !== 0).sort((x, y) => y.ytd - x.ytd);
  const groupYtd = external.reduce((s, a) => s + a.ytd, 0);
  const activeCount = external.filter((a) => a.ytd > 0).length;
  const top1 = ranking[0];
  const top1Pct = groupYtd && top1 ? (100 * top1.ytd) / groupYtd : 0;
  const top5Pct = groupYtd ? (100 * ranking.slice(0, 5).reduce((s, a) => s + a.ytd, 0)) / groupYtd : 0;

  // 2) 新客 vs 舊客
  const nveData = newVsExistingMonthly();
  const newYtd = nveData.reduce((a, d) => a + d.newRev, 0);
  const totalNve = nveData.reduce((a, d) => a + d.newRev + d.existingRev, 0);
  const newSharePct = totalNve ? (100 * newYtd) / totalNve : 0;

  // 3) 流失／保留：上年 >10K、今年 YTD 零收入
  const priorActive = external.filter((a) => a.prior > CHURN_MIN_PRIOR);
  const lost = priorActive.filter((a) => a.ytd <= 0).sort((x, y) => y.prior - x.prior);
  const priorTotal = priorActive.reduce((s, a) => s + a.prior, 0);
  const retainedPrior = priorActive.filter((a) => a.ytd > 0).reduce((s, a) => s + a.prior, 0);
  const clientRetentionPct = priorActive.length ? (100 * (priorActive.length - lost.length)) / priorActive.length : 0;
  const revenueRetentionPct = priorTotal ? (100 * retainedPrior) / priorTotal : 0;

  // 4) AR Alert：due date 後 30 日未收（公司規則，2026-08-09 確認；唔設信用額度）
  const arAlertRows = chaseList();
  const alertCount = arAlertRows.filter((r) => r.overdue30 > 0).length;

  // 5) Pitch（demo）
  const pitch = pitchStats();
  const pitchCost = pitch.rows.reduce((a, r) => a + r.hoursCost, 0);
  const pitchData = pitch.rows.map((r) => ({ label: fyMonthLabel(r.month), pitches: r.pitches, won: r.won }));

  // 7) Cross-sell
  const cs = crossSellRows();
  const csSingle = cs.filter((r) => r.subCount === 1);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">客戶 Clients</h1>
        <p className="text-[12px] text-ink3">客戶收入・留存・AR Alert・Pitch 效益 · FY2026/27 YTD（4–7 月）· HKD</p>
      </div>

      <div className="text-[11px] text-ink2 bg-warn/10 border border-warn/30 rounded-lg px-3 py-2">
        客戶標記（關聯/retainer/行業）已由公司確認（2026-08-09）；需要修改可再交確認表或經管理員更新。
      </div>

      {/* ── 1. 客戶收入榜 ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile
          label="活躍外部客數"
          value={`${activeCount} 個`}
          note={`FY26/27 YTD 有開票（外部客共 ${external.length} 個）`}
        />
        <StatTile
          label="Top 1 佔比"
          value={`${top1Pct.toFixed(1)}%`}
          note={top1 ? `${top1.name} · ${hkdCompact(top1.ytd)}` : "—"}
        />
        <StatTile
          label="Top 5 佔比"
          value={`${top5Pct.toFixed(1)}%`}
          note="佔外部客 YTD 收入"
        />
      </div>

      <Card
        title="客戶收入榜 Client Revenue Ranking"
        subtitle="外部客 · 按 FY26/27 YTD 收入排序 · 收入 = invoice − credit memo 淨額"
        right={
          <ExportButton
            onClick={() =>
              exportCsv(
                "client_revenue_ranking.csv",
                ["客戶", "行業", "開票公司", "FY26/27 YTD", "FY25/26 全年", "佔集團%", "Retainer"],
                ranking.map((r) => [
                  r.name,
                  r.sector ?? "",
                  r.subs.map(subShort).join(" / "),
                  r.ytd,
                  r.prior,
                  groupYtd ? `${((100 * r.ytd) / groupYtd).toFixed(1)}%` : "",
                  r.isRetainer ? "Y" : "",
                ])
              )
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">客戶</th>
                <th className="text-left">行業</th>
                <th className="text-left">開票公司</th>
                <th className="num">FY26/27 YTD</th>
                <th className="num">FY25/26 全年</th>
                <th className="num">佔集團%</th>
                <th className="text-left">Retainer</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r) => (
                <tr key={r.customerId}>
                  <td className="text-left">{r.name}</td>
                  <td className="text-left text-ink3">{r.sector ?? "—"}</td>
                  <td className="text-left text-ink2">{r.subs.map(subShort).join(" / ")}</td>
                  <td className="num">{hkd(r.ytd)}</td>
                  <td className="num text-ink2">{hkd(r.prior)}</td>
                  <td className="num">{groupYtd ? `${((100 * r.ytd) / groupYtd).toFixed(1)}%` : "—"}</td>
                  <td className="text-left">
                    {r.isRetainer ? <RetainerBadge /> : <span className="text-ink3/40">·</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {related.length > 0 && (
          <div className="mt-4">
            <div className="text-[12px] font-medium text-ink2 mb-1">集團內開票（關聯客戶 — 合併時 elimination 沖銷）</div>
            <div className="overflow-x-auto">
              <table className="report-table w-full text-[13px]">
                <thead>
                  <tr>
                    <th className="text-left">關聯客戶</th>
                    <th className="text-left">開票公司</th>
                    <th className="num">FY26/27 YTD</th>
                    <th className="num">FY25/26 全年</th>
                  </tr>
                </thead>
                <tbody>
                  {related.map((r) => (
                    <tr key={r.customerId}>
                      <td className="text-left">{r.name}</td>
                      <td className="text-left text-ink2">{r.subs.map(subShort).join(" / ")}</td>
                      <td className="num">{hkd(r.ytd)}</td>
                      <td className="num text-ink2">{hkd(r.prior)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <SourceNote>fact_client_revenue × dim_client_info（NetSuite invoice/credit memo 逐月淨額）</SourceNote>
        <p className="text-[11px] text-ink3 mt-1">利潤欄（−直接成本−人力分攤）待會計 allocation sheet 接通——下一階段。</p>
      </Card>

      {/* ── 2 + 3. 新舊客／流失保留 ─────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="新客 vs 舊客收入" subtitle="FY2026/27 逐月 · 外部客 · 新客 = 首次開票於 2026-04 之後（first_ym）">
          <div className="flex items-baseline justify-between border-b border-grid pb-2 mb-3">
            <span className="text-[12px] text-ink2">新客貢獻（YTD）</span>
            <span className="text-[15px] font-semibold num">
              {newSharePct.toFixed(1)}%
              <span className="text-[11px] text-ink3 font-normal ml-1.5">{hkdCompact(newYtd)}</span>
            </span>
          </div>
          <NewVsExistingChart data={nveData} />
          <SourceNote>fact_client_revenue · 以 dim_client_info.first_ym 判別新舊</SourceNote>
        </Card>

        <Card title="客戶流失／保留" subtitle={`對上財年（FY2025/26）比較 · 流失 = 上年收入 >$10K 但本年 YTD 零開票`}>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <MiniTile
              label="客戶保留率"
              value={`${clientRetentionPct.toFixed(1)}%`}
              note={`上年活躍 ${priorActive.length} 個 · 流失 ${lost.length} 個`}
            />
            <MiniTile
              label="收入保留率"
              value={`${revenueRetentionPct.toFixed(1)}%`}
              note="留存客上年收入 ÷ 上年活躍客收入"
            />
          </div>
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="report-table w-full text-[13px]">
              <thead>
                <tr>
                  <th className="text-left">流失客</th>
                  <th className="num">上年收入</th>
                </tr>
              </thead>
              <tbody>
                {lost.map((l) => (
                  <tr key={l.customerId}>
                    <td className="text-left">
                      {l.name}
                      <span className="text-[11px] text-ink3 ml-1.5">{l.subs.map(subShort).join(" / ")}</span>
                    </td>
                    <td className="num">{hkd(l.prior)}</td>
                  </tr>
                ))}
                <tr className="subtotal">
                  <td className="text-left">合計 {lost.length} 個</td>
                  <td className="num">{hkd(lost.reduce((a, l) => a + l.prior, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <SourceNote>fact_client_revenue — 對比兩個財年嘅開票客戶集合</SourceNote>
          <p className="text-[11px] text-ink3 mt-1">以 4 個月窗口計——半年結算類客戶可能誤標，確認名單後會準確。</p>
        </Card>
      </div>

      {/* ── 4. AR Alert（due date 後 30 日未收）─────────────────────────── */}
      <Card
        title="AR Alert"
        subtitle="公司規則：invoice 過咗 due date 30 日仍未收 → 出 alert（唔設信用額度）"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 max-w-xl">
          <MiniTile label="觸發 AR Alert 客戶" value={`${alertCount} 個`} note="逾期 >30 日" bad={alertCount > 0} />
          <MiniTile
            label="Alert 金額合計"
            value={hkdCompact(arAlertRows.reduce((a, r) => a + r.overdue30, 0))}
            note="due date 後 30 日仍未收"
            bad={alertCount > 0}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">客戶</th>
                <th className="num">未收總額</th>
                <th className="num">逾期 &gt;30 日</th>
                <th className="num">最耐（日）</th>
                <th className="text-left">狀態</th>
              </tr>
            </thead>
            <tbody>
              {arAlertRows.slice(0, 20).map((r) => (
                <tr key={r.entityName}>
                  <td className="text-left">{r.entityName}</td>
                  <td className="num">{hkd(r.totalOpen)}</td>
                  <td className={`num ${r.overdue30 > 0 ? "text-critical font-semibold" : "text-ink3"}`}>
                    {r.overdue30 > 0 ? hkd(r.overdue30) : "—"}
                  </td>
                  <td className={`num ${r.oldestDays > 90 ? "text-critical" : ""}`}>{r.oldestDays}</td>
                  <td className="text-left">
                    {r.overdue30 > 0 ? (
                      <span className="text-[11px] text-critical font-medium">⚠ AR Alert</span>
                    ) : (
                      <span className="text-[11px] text-ink3">逾期未滿 30 日</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SourceNote>fact_ar_open（每日 sync）· 逐張 invoice 明細＋一鍵複製追數 report 喺 CFO 助手頁</SourceNote>
      </Card>

      {/* ── 5. Pitch 勝率（demo）────────────────────────────────────────── */}
      <Card title="Pitch 勝率" subtitle="YTD（4–7 月）· 成本 = 內部工時成本估算" right={<DemoBadge />}>
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2 content-start">
            <MiniTile label="Win rate" value={`${pitch.winRatePct.toFixed(1)}%`} note={`${pitch.rows.reduce((a, r) => a + r.won, 0)} 贏 ÷ ${pitch.rows.reduce((a, r) => a + r.pitches, 0)} pitch`} />
            <MiniTile label="Pitch 總成本" value={hkdCompact(pitchCost)} note="4 個月合計工時成本" />
            <MiniTile label="Cost per win" value={hkdCompact(pitch.costPerWin)} note="總成本 ÷ 贏單數" />
          </div>
          <div>
            <PitchBars data={pitchData} />
          </div>
        </div>
        <DemoNote>需人手輸入（NetSuite opportunities 未啟用）</DemoNote>
      </Card>

      {/* ── 6. 找數行為（demo）──────────────────────────────────────────── */}
      <PaymentBehaviourCard />

      {/* ── 7. Cross-sell 滲透 ──────────────────────────────────────────── */}
      <Card
        title="Cross-sell 滲透 Cross-sell Matrix"
        subtitle="品牌（同名 customer records 跨公司合併）× 5 間公司 · FY26/27 YTD · 只列合計 >$100K 頭 15 個"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 max-w-xl">
          <MiniTile
            label="只用 1 間公司嘅大客"
            value={`${csSingle.length} / ${cs.length}`}
            note="全部係 cross-sell 機會"
          />
          <MiniTile
            label="單一公司大客收入"
            value={hkdCompact(csSingle.reduce((a, r) => a + r.totalRev, 0))}
            note="YTD — 介紹俾兄弟公司嘅本錢"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">品牌</th>
                <th className="text-left">行業</th>
                {CS_SUBS.map((id) => (
                  <th key={id} className="num">{subShort(id)}</th>
                ))}
                <th className="num">用咗</th>
                <th className="num">YTD 合計</th>
              </tr>
            </thead>
            <tbody>
              {cs.map((r) => (
                <tr key={r.name}>
                  <td className="text-left">{r.name}</td>
                  <td className="text-left text-ink3">{r.sector ?? "—"}</td>
                  {CS_SUBS.map((id) => {
                    const v = r.revBySub[id] ?? 0;
                    return (
                      <td key={id} className={`num ${v ? "" : "text-ink3/40"}`}>
                        {v ? hkdCompact(v) : "·"}
                      </td>
                    );
                  })}
                  <td className={`num font-medium ${r.subCount >= 2 ? "text-deltagood" : "text-ink3"}`}>
                    {r.subCount}/5
                  </td>
                  <td className="num">{hkd(r.totalRev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SourceNote>fact_client_revenue — 跨公司 customer 名對照合併（brand_key 待確認表覆核）</SourceNote>
      </Card>
    </div>
  );
}

function PaymentBehaviourCard() {
  const rows = paymentBehaviour();
  const worsening = rows.filter((r) => r.deltaDays >= 8);
  return (
    <Card
      title="找數行為 Payment Behaviour"
      subtitle="每客實際找數日數趨勢 — aging 話你知邊個已經遲，呢度話你知邊個開始遲"
      right={<DemoBadge />}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 max-w-xl">
        <MiniTile
          label="惡化中客戶"
          value={`${worsening.length} 個`}
          note="近 3 個月比之前慢 ≥8 日"
          bad={worsening.length > 0}
        />
        <MiniTile
          label="惡化客戶未收數"
          value={hkdCompact(worsening.reduce((a, r) => a + r.arOpen, 0))}
          note="提早跟收，好過遲啲追"
          bad
        />
      </div>
      <div className="overflow-x-auto">
        <table className="report-table w-full text-[13px]">
          <thead>
            <tr>
              <th className="text-left">客戶</th>
              <th className="num">賬期</th>
              <th className="num">之前平均</th>
              <th className="num">近 3 個月</th>
              <th className="num">變化</th>
              <th className="num">未收 A/R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bad = r.deltaDays >= 8;
              const good = r.deltaDays <= -3;
              return (
                <tr key={r.client.id}>
                  <td className={`text-left ${bad ? "text-critical font-medium" : ""}`}>{r.client.name}</td>
                  <td className="num text-ink3">{r.termsDays} 日</td>
                  <td className="num text-ink2">{r.avgDaysPrior} 日</td>
                  <td className={`num ${bad ? "text-critical font-semibold" : ""}`}>{r.avgDaysRecent} 日</td>
                  <td className={`num ${bad ? "text-critical" : good ? "text-deltagood" : "text-ink3"}`}>
                    {r.deltaDays > 0 ? `+${r.deltaDays}` : r.deltaDays} 日
                  </td>
                  <td className="num">{hkd(r.arOpen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DemoNote>駁通 NetSuite 即有（invoice → payment 配對歷史）</DemoNote>
    </Card>
  );
}
