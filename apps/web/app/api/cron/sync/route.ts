// Daily NetSuite → Supabase sync (Vercel Cron entrypoint).
// Env needed (Vercel → Settings → Environment Variables):
//   NS_ACCOUNT, NS_CLIENT_ID, NS_CERT_ID, NS_PRIVATE_KEY  — OAuth 2.0 M2M
//   INGEST_SECRET                                          — Supabase ingest fn
//   CRON_SECRET                                            — protects this route
// Strategy: re-aggregate GL for every period touched by recent entry activity
// (covers late entry — measured avg vendor-bill lag 38d), replace AR/AP open
// snapshots, append today's bank balances (accumulates the real cash curve).
import { createSign, constants } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INGEST = "https://nlymvuwafgiudbqsyfem.supabase.co/functions/v1/ingest";

function b64u(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

async function nsToken(): Promise<string> {
  const acct = process.env.NS_ACCOUNT!;
  const tokenUrl = `https://${acct}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
  const now = Math.floor(Date.now() / 1000);
  const si = `${b64u({ alg: "PS256", typ: "JWT", kid: process.env.NS_CERT_ID })}.${b64u({
    iss: process.env.NS_CLIENT_ID,
    scope: ["rest_webservices"],
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign("sha256");
  signer.update(si);
  const sig = signer
    .sign({ key: process.env.NS_PRIVATE_KEY!, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 })
    .toString("base64url");
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: `${si}.${sig}`,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`token: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function sqAll(token: string, q: string): Promise<Record<string, string>[]> {
  const acct = process.env.NS_ACCOUNT!;
  const out: Record<string, string>[] = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(
      `https://${acct}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1000&offset=${offset}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "transient" },
        body: JSON.stringify({ q }),
      }
    );
    const j = await r.json();
    if (!r.ok) throw new Error(`suiteql: ${JSON.stringify(j).slice(0, 300)}`);
    for (const { links: _l, ...rest } of j.items) out.push(rest);
    if (!j.hasMore) break;
    offset += 1000;
  }
  return out;
}

async function ingest(table: string, rows: object[], mode?: "replace"): Promise<void> {
  for (let i = 0; i < rows.length; i += 2000) {
    const r = await fetch(INGEST, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-secret": process.env.INGEST_SECRET! },
      body: JSON.stringify({ table, rows: rows.slice(i, i + 2000), ...(i === 0 && mode ? { mode } : {}) }),
    });
    if (!r.ok) throw new Error(`ingest ${table}: ${await r.text()}`);
  }
}

const mdy = (s: string | null): string | null => {
  if (!s) return null;
  const [m, d, y] = s.split("/").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const started = new Date().toISOString();
  try {
    const token = await nsToken();

    const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    const gl = await sqAll(
      token,
      `SELECT t.postingperiod AS pid, tl.subsidiary AS sub, tal.account AS acct, NVL(tl.department, 0) AS dept, SUM(NVL(tal.debit,0)) AS d, SUM(NVL(tal.credit,0)) AS c FROM transactionaccountingline tal JOIN transaction t ON t.id = tal.transaction JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline WHERE tal.posting = 'T' AND t.postingperiod IN (SELECT DISTINCT t2.postingperiod FROM transaction t2 WHERE t2.posting = 'T' AND t2.createddate >= TO_DATE('${since}','YYYY-MM-DD')) GROUP BY t.postingperiod, tl.subsidiary, tal.account, NVL(tl.department, 0)`
    );
    await ingest(
      "fact_gl",
      gl.map((r) => ({
        period_id: Number(r.pid),
        subsidiary_id: Number(r.sub),
        account_id: Number(r.acct),
        department_id: Number(r.dept),
        entity_id: 0,
        project_id: 0,
        debit: Number(r.d),
        credit: Number(r.c),
      }))
    );

    for (const [table, types, entityCol] of [
      ["fact_ar_open", "'CustInvc','CustCred'", "customer_id"],
      ["fact_ap_open", "'VendBill','VendCred'", "vendor_id"],
    ] as const) {
      const rows = await sqAll(
        token,
        `SELECT t.id, t.tranid, t.trandate, t.duedate, t.entity, tl.subsidiary AS sub, t.foreignamountunpaid AS amt, NVL(t.exchangerate, 1) AS fx, t.currency FROM transaction t JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T' WHERE t.type IN (${types}) AND NVL(t.foreignamountunpaid, 0) <> 0`
      );
      await ingest(
        table,
        rows.map((r) => ({
          txn_id: Number(r.id),
          subsidiary_id: Number(r.sub),
          [entityCol]: r.entity ? Number(r.entity) : null,
          tranid: r.tranid,
          trandate: mdy(r.trandate),
          duedate: mdy(r.duedate),
          amount_open: Math.round(Number(r.amt) * Number(r.fx) * 100) / 100,
          currency: String(r.currency),
        })),
        "replace"
      );
    }

    // collections: payment → applied invoices (last 60 days, upsert)
    const colSince = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const cols = await sqAll(
      token,
      `SELECT p.id AS payid, TO_CHAR(p.trandate,'MM/DD/YYYY') AS pdate, ntll.previousdoc AS invid, inv.tranid AS invnum, inv.memo AS invmemo, ntll.foreignamount AS applied, NVL(p.exchangerate, 1) AS fx, tl.subsidiary AS sub, COALESCE(c.companyname, c.entityid) AS cust FROM transaction p JOIN nexttransactionlinelink ntll ON ntll.nextdoc = p.id AND ntll.linktype = 'Payment' JOIN transaction inv ON inv.id = ntll.previousdoc AND inv.type IN ('CustInvc') JOIN transactionline tl ON tl.transaction = p.id AND tl.mainline = 'T' LEFT JOIN customer c ON c.id = p.entity WHERE p.type = 'CustPymt' AND p.trandate >= TO_DATE('${colSince}','YYYY-MM-DD') AND NVL(ntll.foreignamount, 0) <> 0`
    );
    await ingest(
      "fact_collections",
      cols.map((r) => ({
        payment_id: Number(r.payid),
        invoice_txn_id: Number(r.invid),
        payment_date: mdy(r.pdate),
        subsidiary_id: Number(r.sub),
        customer_name: r.cust ?? null,
        invoice_tranid: r.invnum,
        invoice_memo: r.invmemo ?? null,
        amount_applied: Math.round(Number(r.applied) * Number(r.fx) * 100) / 100,
      }))
    );

    // disbursements: vendor payments (last 60 days, upsert)
    const disb = await sqAll(
      token,
      `SELECT p.id, p.tranid, TO_CHAR(p.trandate,'MM/DD/YYYY') AS pdate, tl.subsidiary AS sub, ABS(NVL(p.foreigntotal,0)) * NVL(p.exchangerate,1) AS amt, COALESCE(v.companyname, v.entityid) AS vend FROM transaction p JOIN transactionline tl ON tl.transaction = p.id AND tl.mainline = 'T' LEFT JOIN vendor v ON v.id = p.entity WHERE p.type = 'VendPymt' AND p.trandate >= TO_DATE('${colSince}','YYYY-MM-DD')`
    );
    await ingest(
      "fact_disbursements",
      disb.map((r) => ({
        payment_id: Number(r.id),
        payment_date: mdy(r.pdate),
        subsidiary_id: Number(r.sub),
        vendor_name: r.vend ?? null,
        tranid: r.tranid,
        amount: Math.round(Number(r.amt) * 100) / 100,
      }))
    );

    // ── BU 還原 facts（blueprint v0.1 §3.1）：重抽最近 4 個月（防 back-dated 入帳）──
    //    query 拆兩條（IC journal 用 correlated EXISTS），避免 SuiteQL 全表子查詢 timeout。
    //    entity 清單 = ic_entity_map 全部（group + related_external）；新增 entity 要同步更新。
    const IC_ENT = "1447,1488,1489,2674,2762,2763,2792,2907,3201,3207,3958,4468,4576,1517,1518,1521,1522,1767,863,1027,2714,2873,3106,3328,2568,1524,1525,1526,1527,1545,2930,3245,3584,4113,1402,2432,2789,3511,3634,4087,4126,4399,762,3626,4623";
    const IC_CUST = "1447,1488,1489,2674,2762,2763,2792,2907,3201,3207,3245,3584,3958,4468,4576,4113";
    const IC_VEND = "863,1027,2714,2873,3106,3328,2568";
    // IC 分攤 / management fee journal：同一 journal 內有 60000022 或 81000059 行（PB 側 Share of expenses + mgmt fee income；子公司側 mgmt fee + Share of PBHK expenses + 年結 DN）
    const ICJ = "EXISTS (SELECT 1 FROM transactionaccountingline x JOIN account ax ON ax.id = x.account WHERE x.transaction = t.id AND ax.acctnumber IN ('60000022','81000059'))";
    const monthStart = (offset: number) => {
      const d = new Date();
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1)).toISOString().slice(0, 10);
    };
    const buFrom = monthStart(3);
    const buTo = monthStart(-1);
    const buWindow = `t.trandate >= TO_DATE('${buFrom}','YYYY-MM-DD') AND t.trandate < TO_DATE('${buTo}','YYYY-MM-DD')`;
    const buPlBase = `FROM transactionaccountingline tal JOIN transaction t ON t.id = tal.transaction JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline JOIN account a ON a.id = tal.account WHERE tal.posting = 'T' AND t.posting = 'T' AND a.accttype IN ('Income','COGS','Expense','OthIncome','OthExpense') AND ${buWindow}`;
    const buA = await sqAll(
      token,
      `SELECT TO_CHAR(t.trandate,'YYYY-MM') AS ym, tl.subsidiary AS sub, NVL(tl.department,0) AS dept, tal.account AS acct, t.type AS ttype, CASE WHEN t.entity IN (${IC_ENT}) THEN t.entity ELSE 0 END AS ic_entity, SUM(NVL(tal.debit,0)) AS d, SUM(NVL(tal.credit,0)) AS c, COUNT(*) AS n ${buPlBase} AND NOT (t.type = 'Journal' AND ${ICJ}) GROUP BY TO_CHAR(t.trandate,'YYYY-MM'), tl.subsidiary, NVL(tl.department,0), tal.account, t.type, CASE WHEN t.entity IN (${IC_ENT}) THEN t.entity ELSE 0 END`
    );
    const buB = await sqAll(
      token,
      `SELECT TO_CHAR(t.trandate,'YYYY-MM') AS ym, tl.subsidiary AS sub, NVL(tl.department,0) AS dept, tal.account AS acct, SUM(NVL(tal.debit,0)) AS d, SUM(NVL(tal.credit,0)) AS c, COUNT(*) AS n ${buPlBase} AND t.type = 'Journal' AND ${ICJ} GROUP BY TO_CHAR(t.trandate,'YYYY-MM'), tl.subsidiary, NVL(tl.department,0), tal.account`
    );
    await ingest("fact_bu_pl", [
      ...buA.map((r) => ({
        ym: r.ym,
        subsidiary_id: Number(r.sub),
        department_id: Number(r.dept),
        account_id: Number(r.acct),
        txn_type: r.ttype,
        ic_entity_id: Number(r.ic_entity),
        ic_journal: false,
        debit: Number(r.d),
        credit: Number(r.c),
        lines: Number(r.n),
      })),
      ...buB.map((r) => ({
        ym: r.ym,
        subsidiary_id: Number(r.sub),
        department_id: Number(r.dept),
        account_id: Number(r.acct),
        txn_type: "Journal",
        ic_entity_id: 0,
        ic_journal: true,
        debit: Number(r.d),
        credit: Number(r.c),
        lines: Number(r.n),
      })),
    ]);

    const pWindow = `p.trandate >= TO_DATE('${buFrom}','YYYY-MM-DD') AND p.trandate < TO_DATE('${buTo}','YYYY-MM-DD')`;
    const cashIn = await sqAll(
      token,
      `SELECT TO_CHAR(p.trandate,'YYYY-MM') AS ym, tl.subsidiary AS sub, NVL(il.department,0) AS dept, CASE WHEN inv.entity IN (${IC_CUST}) THEN inv.entity ELSE 0 END AS ic_entity, SUM(ABS(NVL(il.foreignamount,0)) / ABS(inv.foreigntotal) * NVL(ntll.foreignamount,0) * NVL(p.exchangerate,1)) AS amt, COUNT(DISTINCT p.id) AS pays FROM transaction p JOIN nexttransactionlinelink ntll ON ntll.nextdoc = p.id AND ntll.linktype = 'Payment' JOIN transaction inv ON inv.id = ntll.previousdoc AND inv.type = 'CustInvc' JOIN transactionline tl ON tl.transaction = p.id AND tl.mainline = 'T' JOIN transactionline il ON il.transaction = inv.id AND il.mainline = 'F' AND il.taxline = 'F' AND il.iscogs = 'F' WHERE p.type = 'CustPymt' AND NVL(inv.foreigntotal,0) <> 0 AND ${pWindow} GROUP BY TO_CHAR(p.trandate,'YYYY-MM'), tl.subsidiary, NVL(il.department,0), CASE WHEN inv.entity IN (${IC_CUST}) THEN inv.entity ELSE 0 END`
    );
    const cashOut = await sqAll(
      token,
      `SELECT TO_CHAR(p.trandate,'YYYY-MM') AS ym, tl.subsidiary AS sub, NVL(bl.department,0) AS dept, CASE WHEN b.entity IN (${IC_VEND}) THEN b.entity ELSE 0 END AS ic_entity, SUM(ABS(NVL(bl.foreignamount,0)) / ABS(b.foreigntotal) * ABS(NVL(ntll.foreignamount,0)) * NVL(p.exchangerate,1)) AS amt, COUNT(DISTINCT p.id) AS pays FROM transaction p JOIN nexttransactionlinelink ntll ON ntll.nextdoc = p.id AND ntll.linktype = 'Payment' JOIN transaction b ON b.id = ntll.previousdoc AND b.type = 'VendBill' JOIN transactionline tl ON tl.transaction = p.id AND tl.mainline = 'T' JOIN transactionline bl ON bl.transaction = b.id AND bl.mainline = 'F' AND bl.taxline = 'F' WHERE p.type = 'VendPymt' AND NVL(b.foreigntotal,0) <> 0 AND ${pWindow} GROUP BY TO_CHAR(p.trandate,'YYYY-MM'), tl.subsidiary, NVL(bl.department,0), CASE WHEN b.entity IN (${IC_VEND}) THEN b.entity ELSE 0 END`
    );
    const cashRow = (direction: "in" | "out") => (r: Record<string, string>) => ({
      ym: r.ym,
      subsidiary_id: Number(r.sub),
      department_id: Number(r.dept),
      direction,
      ic_entity_id: Number(r.ic_entity),
      amount: Math.round(Number(r.amt) * 100) / 100,
      payments: Number(r.pays),
    });
    await ingest("fact_bu_cash", [...cashIn.map(cashRow("in")), ...cashOut.map(cashRow("out"))]);

    const bank = await sqAll(
      token,
      `SELECT tl.subsidiary AS sub, tal.account AS acct, SUM(NVL(tal.debit,0) - NVL(tal.credit,0)) AS bal FROM transactionaccountingline tal JOIN transaction t ON t.id = tal.transaction JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline JOIN account a ON a.id = tal.account WHERE tal.posting = 'T' AND a.accttype = 'Bank' GROUP BY tl.subsidiary, tal.account`
    );
    const today = new Date().toISOString().slice(0, 10);
    await ingest(
      "fact_bank_balance_daily",
      bank.map((r) => ({ as_of_date: today, subsidiary_id: Number(r.sub), account_id: Number(r.acct), balance: Number(r.bal) }))
    );

    await ingest("sync_log", [
      { job: "daily-sync", started_at: started, finished_at: new Date().toISOString(), rows: gl.length + bank.length + buA.length + buB.length, status: "ok" },
    ]);
    return Response.json({ ok: true, gl: gl.length, bank: bank.length, bu_pl: buA.length + buB.length, bu_cash: cashIn.length + cashOut.length });
  } catch (e) {
    await ingest("sync_log", [
      { job: "daily-sync", started_at: started, finished_at: new Date().toISOString(), rows: 0, status: "error", error: String(e).slice(0, 500) },
    ]).catch(() => {});
    return Response.json({ ok: false, error: String(e).slice(0, 500) }, { status: 500 });
  }
}
