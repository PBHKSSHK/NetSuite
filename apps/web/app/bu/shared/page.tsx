"use client";

// Cost Center / Shared Services（Blueprint §5.6 + 會計 worksheet 規則 2026-09-17）
// 官方方法：Admin / IT pool 先扣 Go Asia + JS 人頭份額（B），餘額（C）按當月 GP% 分落 BU；
// Management pool 100% 按 GP%；老闆人工（Directors Remunerations + MPF）唔入 pool，
// 按「director」worksheet 固定金額分落 BU，年結 NetSuite 先按 GP% 入 5 間公司。

import { BuFilterBar } from "@/components/bu-filter-bar";
import { AllocCompareChart, BuLinesChart } from "@/components/bu-charts";
import { Card, ExportButton, exportCsv } from "@/components/ui";
import {
  ALLOC_CATEGORIES,
  ALLOC_CATEGORY_LABEL,
  CORE_BUS,
  FM_LABEL,
  GP_SHARE_CATEGORIES,
  MGMT_LINE_LABEL,
  POOL_LABEL,
  WS_LABEL,
  allocationFor,
  associatesAdminFee,
  buLabel,
  gpShareFor,
  headcountFor,
  lastMonthWithData,
  mgmtFeeCheck,
  nsAllocation,
  periodLabelOf,
  sharedPools,
  ymOf,
  type AllocKey,
  type BuCode,
  type MgmtLine,
  type PoolCode,
} from "@/lib/bu";
import { useBuFilters } from "@/lib/bu-filters";
import { ALLOC_RULES } from "@/lib/bu-store";
import { subName } from "@/lib/bu-ui";
import { hkd, hkdCompact, pct } from "@/lib/format";

const POOLS: PoolCode[] = ["ADMIN", "IT", "MGT"];

export default function SharedPage() {
  const f = useBuFilters();
  const p = f.period;
  const chosen = allocationFor(p, f.allocKey, f.netAssocFee);
  const { pools } = sharedPools(p);
  const keys = ALLOC_RULES.map((r) => r.keyType as AllocKey);
  const allocs = keys.map((k) => allocationFor(p, k, f.netAssocFee));
  const mf = mgmtFeeCheck(p);
  const assocBilled = associatesAdminFee(p);
  const lastYm = ymOf(p.fy, p.months[p.months.length - 1]);
  const gs = gpShareFor(lastYm);
  const hc = headcountFor(lastYm);
  const last = lastMonthWithData(f.fy);
  const trend = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const row: { label: string } & Partial<Record<BuCode, number | null>> = { label: FM_LABEL[m - 1] };
    if (m <= last) {
      const { pools: mp } = sharedPools({ fy: f.fy, months: [m] });
      row.SHARED = Math.round(mp.ADMIN.gross + mp.IT.gross + mp.MGT.gross);
      row.OTHER = Math.round(mp.ADMIN.assocB + mp.IT.assocB);
    }
    return row;
  });
  const compare = CORE_BUS.map((b) => {
    const row: { label: string; [k: string]: number | string } = { label: buLabel(b) };
    allocs.forEach((a) => (row[a.key] = a.amount[b]));
    return row;
  });
  const grossAll = POOLS.reduce((a, k) => a + pools[k].gross, 0);
  const assocAll = POOLS.reduce((a, k) => a + pools[k].assocB, 0);
  const lineKeys = (Object.keys(MGMT_LINE_LABEL) as MgmtLine[]).filter((k) => POOLS.some((pk) => Math.abs(pools[pk].byLine[k]) >= 1));
  const d = chosen.director;
  const ns = nsAllocation(p, f.allocKey, f.netAssocFee);
  const nsCats = ALLOC_CATEGORIES.filter((c) => Math.abs(ns.total.byCat[c]) >= 1 || Math.abs(ns.pbSide[c]) >= 1);
  const pbGpShare = GP_SHARE_CATEGORIES.reduce((a, c) => a + ns.pbSide[c], 0);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Shared cost 分攤 · PB 平台</h1>
      <BuFilterBar showAlloc />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">(A) Admin + IT + Mgt 外部淨成本</div>
          <div className="text-2xl font-semibold mt-1 num">{hkdCompact(grossAll)}</div>
          <div className="text-[11px] text-ink3 mt-1">已扣老闆人工 ledger {hkdCompact(d.ledgerTotal)}（另按 worksheet 分）</div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">(B) Go Asia + JS 人頭份額（Admin / IT）</div>
          <div className="text-2xl font-semibold mt-1 num">{hkdCompact(assocAll)}</div>
          <div className="text-[11px] text-ink3 mt-1">
            headcount {hc.ym ?? "—"}：associates {hc.assoc} / 全體 {hc.total} · 實際向 associates 收 mgmt fee {hkdCompact(assocBilled)}
          </div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">(C) 分攤落 4 個 BU</div>
          <div className="text-2xl font-semibold mt-1 num">{hkdCompact(chosen.pool)}</div>
          <div className="text-[11px] text-ink3 mt-1">key：{chosen.label}</div>
        </div>
        <div className="bg-surface rounded-xl border border-ringc px-4 py-3.5">
          <div className="text-[12px] text-ink2">老闆人工（BU 報表口徑）</div>
          <div className="text-2xl font-semibold mt-1 num">{hkdCompact(d.sheetTotal)}</div>
          <div className={`text-[11px] mt-1 ${Math.abs(d.variance) > 1 ? "text-serious" : "text-ink3"}`}>
            帳面 {hkdCompact(d.ledgerTotal)} · 差異 {hkdCompact(d.variance)}
          </div>
        </div>
      </div>

      <Card
        title={`官方分攤表 — ${periodLabelOf(p)}`}
        subtitle="會計 worksheet 方法：Admin / IT：A − B = C，C 按 GP% 分；Management：100% 按 GP%（老闆人工另計）。GP% / headcount 逐月取 worksheet 當月值。"
        right={
          <ExportButton
            onClick={() =>
              exportCsv(
                `shared_alloc_${p.fy}.csv`,
                ["Pool", "(A) 淨成本", "(B) Go Asia+JS", "(C) 分攤", ...CORE_BUS.map(buLabel)],
                POOLS.map((k) => [POOL_LABEL[k], Math.round(pools[k].gross), Math.round(pools[k].assocB), Math.round(pools[k].net), ...CORE_BUS.map((b) => Math.round(pools[k].net * gs.share[b]))])
              )
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">Pool（PBHK dept）</th>
                <th className="num">(A) 外部淨成本</th>
                <th className="num">(B) Go Asia + JS 人頭</th>
                <th className="num">(C) = A − B</th>
                {CORE_BUS.map((b) => (
                  <th key={b} className="num">
                    {buLabel(b)}
                    <span className="block text-[10px] font-normal">{pct(gs.share[b])}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {POOLS.map((k) => (
                <tr key={k}>
                  <td className="text-left">{POOL_LABEL[k]}</td>
                  <td className="num">{hkd(pools[k].gross)}</td>
                  <td className="num text-ink2">{k === "MGT" ? "—" : hkd(pools[k].assocB)}</td>
                  <td className="num">{hkd(pools[k].net)}</td>
                  {CORE_BUS.map((b) => (
                    <td key={b} className="num">
                      {hkd(pools[k].net * gs.share[b])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">合計</td>
                <td className="num">{hkd(grossAll)}</td>
                <td className="num">{hkd(assocAll)}</td>
                <td className="num">{hkd(grossAll - assocAll)}</td>
                {CORE_BUS.map((b) => (
                  <td key={b} className="num">
                    {hkd(chosen.key === "workbook" ? chosen.amount[b] : (grossAll - assocAll) * gs.share[b])}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-left">老闆人工（director worksheet）</td>
                <td className="num">{hkd(d.ledgerTotal)}</td>
                <td className="num">—</td>
                <td className="num">{hkd(d.sheetTotal)}</td>
                {CORE_BUS.map((b) => (
                  <td key={b} className="num">
                    {hkd(d.byBu[b])}
                  </td>
                ))}
              </tr>
              <tr className="subtotal">
                <td className="text-left">BU 承擔合計</td>
                <td className="num">{hkd(grossAll + d.ledgerTotal)}</td>
                <td className="num">{hkd(assocAll)}</td>
                <td className="num">{hkd(grossAll - assocAll + d.sheetTotal)}</td>
                {CORE_BUS.map((b) => (
                  <td key={b} className="num">
                    {hkd((chosen.key === "workbook" ? chosen.amount[b] : (grossAll - assocAll) * gs.share[b]) + d.byBu[b])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink3 mt-2">
          表內各 BU 欄用期末月份 GP%（{gs.ym ?? "—"}）示意；「合計」行係逐月按當月 GP% 計嘅實際分攤（多月期間兩者會有少量差異）。worksheet 欄：
          {gs.raw.map((r) => ` ${WS_LABEL[r.code] ?? r.code} ${r.pct}%`).join(" ·")}。PBHK Youtube 喺 NetSuite 同 Production 同一 department，已併入 Production BU。
        </p>
      </Card>

      <Card
        title={`NetSuite 實際分攤（會計 GP% workbook）vs BU 還原 — ${periodLabelOf(p)}`}
        subtitle="會計「BU gross profit share」清單：NetSuite 內按 GP% 分入各公司嘅 Share of Admin / IT / Mgt、management fee，另列 DN 同 tax planning 開單。GP% 機制合計 vs 本系統 Layer 2 還原（pool C + 老闆人工）；差異 = 法定帳同管理帳嘅分攤口徑差（人頭扣減、老闆人工固定額、GP% 取數月份）。"
        right={
          <ExportButton
            onClick={() =>
              exportCsv(
                `ns_allocation_${p.fy}.csv`,
                ["BU", ...nsCats.map((c) => ALLOC_CATEGORY_LABEL[c]), "GP% 機制合計", "BU 還原分攤", "差異"],
                [...ns.rows, ns.total].map((r) => [r.bu === "SHARED" ? "合計" : buLabel(r.bu), ...nsCats.map((c) => Math.round(r.byCat[c])), Math.round(r.gpShare), Math.round(r.restored), Math.round(r.diff)])
              )
            }
          />
        }
      >
        {!ns.hasData ? (
          <p className="text-[12px] text-ink3">本期 workbook 冇分攤交易（清單覆蓋 2020-04 → 2026-03）。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="report-table w-full text-[12px]">
              <thead>
                <tr>
                  <th className="text-left">BU（公司）</th>
                  {nsCats.map((c) => (
                    <th key={c} className={`num ${GP_SHARE_CATEGORIES.includes(c) ? "" : "text-ink2"}`}>
                      {ALLOC_CATEGORY_LABEL[c]}
                    </th>
                  ))}
                  <th className="num">GP% 機制合計</th>
                  <th className="num">BU 還原分攤</th>
                  <th className="num">差異</th>
                </tr>
              </thead>
              <tbody>
                {ns.rows.map((r) => (
                  <tr key={r.bu}>
                    <td className="text-left">
                      {buLabel(r.bu)} <span className="text-ink3">({subName(r.sub)})</span>
                    </td>
                    {nsCats.map((c) => (
                      <td key={c} className={`num ${GP_SHARE_CATEGORIES.includes(c) ? "" : "text-ink2"}`}>
                        {Math.abs(r.byCat[c]) < 1 ? <span className="text-ink3">—</span> : hkd(r.byCat[c])}
                      </td>
                    ))}
                    <td className="num font-medium">{hkd(r.gpShare)}</td>
                    <td className="num">{hkd(r.restored)}</td>
                    <td className={`num ${Math.abs(r.diff) > 1 ? (r.diff > 0 ? "text-serious" : "text-ok") : ""}`}>{hkd(r.diff)}</td>
                  </tr>
                ))}
                <tr className="subtotal">
                  <td className="text-left">子公司合計</td>
                  {nsCats.map((c) => (
                    <td key={c} className="num">
                      {hkd(ns.total.byCat[c])}
                    </td>
                  ))}
                  <td className="num">{hkd(ns.total.gpShare)}</td>
                  <td className="num">{hkd(ns.total.restored)}</td>
                  <td className={`num ${Math.abs(ns.total.diff) > 1 ? "text-serious" : ""}`}>{hkd(ns.total.diff)}</td>
                </tr>
                <tr>
                  <td className="text-left text-ink2">PB 平台側（credit：收入 / 費用抵減）</td>
                  {nsCats.map((c) => (
                    <td key={c} className="num text-ink2">
                      {Math.abs(ns.pbSide[c]) < 1 ? <span className="text-ink3">—</span> : hkd(ns.pbSide[c])}
                    </td>
                  ))}
                  <td className="num text-ink2">{hkd(pbGpShare)}</td>
                  <td className="num text-ink2">—</td>
                  <td className={`num ${Math.abs(pbGpShare - ns.total.gpShare) > 1 ? "text-serious" : "text-ink2"}`}>{hkd(pbGpShare - ns.total.gpShare)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-ink3 mt-2">
          「PB 平台側」行嘅差異 = PB 記嘅分攤收入減子公司記嘅費用（正 = 向 Go Asia / JS / Travel 等 associates 收取、或 CLS Production 側唔喺清單內）。DN 同 tax planning 開單只作參考，唔入 GP% 機制合計。
        </p>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Pool 明細 — by 行次" subtitle="三個 pool 嘅外部行（收入正、成本負；含 Venue Rental Income 等抵減）">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">行次</th>
                {POOLS.map((k) => (
                  <th key={k} className="num">
                    {POOL_LABEL[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineKeys.map((k) => (
                <tr key={k}>
                  <td className="text-left">{MGMT_LINE_LABEL[k]}</td>
                  {POOLS.map((pk) => (
                    <td key={pk} className="num">
                      {Math.abs(pools[pk].byLine[k]) < 1 ? <span className="text-ink3">—</span> : hkd(pools[pk].byLine[k])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">淨額（= −A）</td>
                {POOLS.map((pk) => (
                  <td key={pk} className="num">
                    {hkd(-pools[pk].gross)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="老闆人工 by BU（worksheet 口徑）" subtitle="Directors Remunerations + MPF；年結 NetSuite 按 GP% 分入 5 間公司，BU 報表用固定金額">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">BU</th>
                <th className="num">本期金額</th>
              </tr>
            </thead>
            <tbody>
              {CORE_BUS.map((b) => (
                <tr key={b}>
                  <td className="text-left">{buLabel(b)}</td>
                  <td className="num">{hkd(d.byBu[b])}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">worksheet 合計</td>
                <td className="num">{hkd(d.sheetTotal)}</td>
              </tr>
              <tr>
                <td className="text-left text-ink2">帳面（PBHK Management dept 81000039 + MPF）</td>
                <td className="num text-ink2">{hkd(d.ledgerTotal)}</td>
              </tr>
              <tr>
                <td className="text-left text-ink2">差異（留喺 PB 平台）</td>
                <td className={`num ${Math.abs(d.variance) > 1 ? "text-serious" : "text-ink2"}`}>{hkd(d.variance)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={`Pool 月度 trend — ${f.fy}`} subtitle="Admin + IT + Mgt 外部淨成本（A）vs Go Asia / JS 人頭份額（B）">
        <BuLinesChart data={trend} bus={["SHARED", "OTHER"]} />
        <p className="text-[11px] text-ink3 mt-1">圖例：「PB 平台」= A；「其他」= B。</p>
      </Card>

      <Card
        title="分攤方法對比"
        subtitle={`同一 pool 用唔同 key 分俾 4 個 BU（老闆人工另計，唔受 key 影響）`}
        right={<ExportButton onClick={() => exportCsv(`allocation_compare_${p.fy}.csv`, ["BU", ...allocs.map((a) => a.label)], CORE_BUS.map((b) => [buLabel(b), ...allocs.map((a) => a.amount[b])]))} />}
      >
        <AllocCompareChart data={compare} series={allocs.map((a) => ({ key: a.key, label: a.label }))} />
        <div className="overflow-x-auto mt-2">
          <table className="report-table w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left">BU</th>
                {allocs.map((a) => (
                  <th key={a.key} className="num">
                    {a.label}
                    {a.key === f.allocKey ? " ★" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CORE_BUS.map((b) => (
                <tr key={b}>
                  <td className="text-left">{buLabel(b)}</td>
                  {allocs.map((a) => (
                    <td key={a.key} className="num">
                      {hkd(a.amount[b])} <span className="text-ink3">({(a.share[b] * 100).toFixed(1)}%)</span>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="text-left text-ink3">基準</td>
                {allocs.map((a) => (
                  <td key={a.key} className="num text-ink3 text-[11px]">
                    {a.basisLabel}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={`Headcount（worksheet，${hc.ym ?? "—"}）`} subtitle="headcount_monthly：逐月 by worksheet 欄；JS / Go Asia 只分 Admin / IT pool">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">欄</th>
                <th className="num">人數</th>
              </tr>
            </thead>
            <tbody>
              {hc.raw.map((r) => (
                <tr key={r.code}>
                  <td className="text-left">{WS_LABEL[r.code] ?? r.code}</td>
                  <td className="num">{r.hc}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">合計</td>
                <td className="num">{hc.total}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="Management fee 對照（法定帳）" subtitle="PB 60000022 收入 vs 各公司 81000059 / 81000068 費用；差額 = 向 Go Asia / JS 實際收取">
          <table className="report-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">公司</th>
                <th className="num">Mgmt fee 費用</th>
              </tr>
            </thead>
            <tbody>
              {mf.bySub.map((r) => (
                <tr key={r.sub}>
                  <td className="text-left">{subName(r.sub)}</td>
                  <td className="num">{hkd(r.expense)}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td className="text-left">子公司合計</td>
                <td className="num">{hkd(mf.subTotal)}</td>
              </tr>
              <tr>
                <td className="text-left">PB Management Fee Income</td>
                <td className="num">{hkd(mf.pbIncome)}</td>
              </tr>
              <tr className="subtotal">
                <td className="text-left">差額（associates 實收）vs 人頭份額 (B) {hkdCompact(assocAll)}</td>
                <td className={`num ${mf.assoc < 0 ? "text-critical" : ""}`}>{hkd(mf.assoc)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
