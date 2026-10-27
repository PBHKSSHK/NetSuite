// NetSuite 停用（2026-10-30）前最後全量導出 → Supabase schema ns_archive。
// POST { part, from?, to? }，header x-archive-secret（值存 public.app_secrets.ARCHIVE_SECRET，唔入 repo）。
//   part = "gl"      逐行 GL（transactionaccountingline × transactionline × transaction），
//                    trandate ∈ [from, to)；先刪該窗口再寫，可重跑。
//   part = "txn"     交易表頭原始行（record_type = 'transaction'），同一窗口。
//   part = "master"  主檔原始行：account / accountingperiod / subsidiary / department /
//                    classification / location / currency / customer / vendor / employee。
//   part = "open"    當刻 AR / AP 未清項目 snapshot（record_type = 'ar_open' / 'ap_open'）。
// 每次寫 ns_archive.run_log，gl 部分同 NetSuite 對行數 + debit / credit 總數。
import postgres from "npm:postgres@3.4.4";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function getSecrets(names: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing = names.filter((n) => {
    const v = Deno.env.get(n);
    if (v) out[n] = v;
    return !v;
  });
  if (missing.length) {
    const { data, error } = await db.from("app_secrets").select("name, value").in("name", missing);
    if (error) throw new Error("app_secrets read: " + error.message);
    for (const r of data ?? []) out[r.name] = r.value;
  }
  for (const n of names) if (!out[n]) throw new Error(`secret ${n} not configured`);
  return out;
}

const b64u = (buf: ArrayBuffer | string): string => {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function nsToken(s: Record<string, string>): Promise<{ token: string; base: string }> {
  const base = `https://${s.NS_ACCOUNT}.suitetalk.api.netsuite.com`;
  const tokenUrl = `${base}/services/rest/auth/oauth2/v1/token`;
  const now = Math.floor(Date.now() / 1000);
  const si = `${b64u(JSON.stringify({ alg: "PS256", typ: "JWT", kid: s.NS_CERT_ID }))}.${b64u(
    JSON.stringify({ iss: s.NS_CLIENT_ID, scope: ["rest_webservices"], aud: tokenUrl, iat: now, exp: now + 3600 }),
  )}`;
  const body = s.NS_PRIVATE_KEY.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSA-PSS", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, key, new TextEncoder().encode(si));
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: `${si}.${b64u(sig)}`,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error("token: " + JSON.stringify(j).slice(0, 200));
  return { token: j.access_token, base };
}

type Row = Record<string, string | number | null>;

async function sqAll(base: string, token: string, q: string): Promise<Row[]> {
  const out: Row[] = [];
  let offset = 0;
  for (;;) {
    let j: { items: Row[]; hasMore: boolean } | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(`${base}/services/rest/query/v1/suiteql?limit=1000&offset=${offset}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "transient" },
        body: JSON.stringify({ q }),
      });
      if (r.ok) {
        j = await r.json();
        break;
      }
      const txt = await r.text();
      if (r.status !== 429 && r.status < 500) throw new Error("suiteql: " + txt.slice(0, 250));
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
    }
    if (!j) throw new Error("suiteql: retries exhausted");
    for (const { links: _l, ...rest } of j.items as (Row & { links?: unknown })[]) out.push(rest);
    if (!j.hasMore) break;
    offset += 1000;
  }
  return out;
}

// SuiteQL REST 會略去值為 null 嘅欄位（→ undefined）；postgres.js 唔收 undefined。
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const win = (from: string, to: string) =>
  `t.trandate >= TO_DATE('${from}','YYYY-MM-DD') AND t.trandate < TO_DATE('${to}','YYYY-MM-DD')`;

const GL_FROM = `FROM transactionaccountingline tal
  JOIN transaction t ON t.id = tal.transaction
  JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
  WHERE tal.posting = 'T'`;

async function archiveGl(base: string, token: string, from: string, to: string) {
  const rows = await sqAll(
    base,
    token,
    `SELECT t.id AS txn_id, tl.id AS line_id, NVL(tal.accountingbook, 1) AS book, t.tranid, t.type,
       TO_CHAR(t.trandate,'YYYY-MM-DD') AS td, t.postingperiod AS pid, tl.subsidiary AS sub, tal.account AS acct,
       tl.department AS dept, tl.class AS cls, tl.location AS loc, tl.entity AS lent, t.entity AS hent,
       tl.memo AS lmemo, t.memo AS hmemo, tal.debit, tal.credit, tal.amount, tl.foreignamount AS famt,
       t.currency AS cur, t.exchangerate AS fx, t.status, TO_CHAR(t.createddate,'YYYY-MM-DD') AS cd,
       TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD') AS lmd
     ${GL_FROM} AND ${win(from, to)}
     ORDER BY t.id, tl.id, tal.accountingbook`,
  );
  const [chk] = await sqAll(
    base,
    token,
    `SELECT COUNT(*) AS n, SUM(NVL(tal.debit,0)) AS d, SUM(NVL(tal.credit,0)) AS c ${GL_FROM} AND ${win(from, to)}`,
  );
  const recs = rows.map((r) => ({
    txn_id: num(r.txn_id), line_id: num(r.line_id), book: num(r.book) ?? 1, tranid: str(r.tranid), txn_type: str(r.type),
    trandate: str(r.td), period_id: num(r.pid), subsidiary_id: num(r.sub), account_id: num(r.acct),
    department_id: num(r.dept), class_id: num(r.cls), location_id: num(r.loc), line_entity_id: num(r.lent),
    header_entity_id: num(r.hent), line_memo: str(r.lmemo), header_memo: str(r.hmemo),
    debit: num(r.debit), credit: num(r.credit), amount: num(r.amount), foreign_amount: num(r.famt),
    currency_id: num(r.cur), exchange_rate: num(r.fx), status: str(r.status), created_date: str(r.cd),
    last_modified: str(r.lmd),
  }));
  await sql.begin(async (tx) => {
    await tx`delete from ns_archive.gl_line where trandate >= ${from} and trandate < ${to}`;
    for (let i = 0; i < recs.length; i += 1000) {
      await tx`insert into ns_archive.gl_line ${tx(recs.slice(i, i + 1000))}
        on conflict (txn_id, line_id, book) do update set extracted_at = now()`;
    }
  });
  const [loaded] = await sql`select count(*)::int n, coalesce(sum(debit),0) d, coalesce(sum(credit),0) c
    from ns_archive.gl_line where trandate >= ${from} and trandate < ${to}`;
  const ns = { n: Number(chk.n), d: Number(chk.d ?? 0), c: Number(chk.c ?? 0) };
  const ok = loaded.n === ns.n && Math.abs(Number(loaded.d) - ns.d) < 0.01 && Math.abs(Number(loaded.c) - ns.c) < 0.01;
  return { rows: loaded.n, debit: Number(loaded.d), credit: Number(loaded.c), netsuite: ns, match: ok };
}

async function putRecords(type: string, rows: Row[], idOf: (r: Row) => string, replace: boolean) {
  const recs = rows.map((r) => ({ record_type: type, id: idOf(r), data: r }));
  await sql.begin(async (tx) => {
    if (replace) await tx`delete from ns_archive.record where record_type = ${type}`;
    for (let i = 0; i < recs.length; i += 1000) {
      await tx`insert into ns_archive.record ${tx(recs.slice(i, i + 1000), "record_type", "id", "data")}
        on conflict (record_type, id) do update set data = excluded.data, extracted_at = now()`;
    }
  });
  return recs.length;
}

const MASTER: Record<string, string> = {
  account: "SELECT * FROM account",
  accountingperiod: "SELECT * FROM accountingperiod",
  subsidiary: "SELECT * FROM subsidiary",
  department: "SELECT * FROM department",
  classification: "SELECT * FROM classification",
  location: "SELECT * FROM location",
  currency: "SELECT * FROM currency",
  customer: "SELECT * FROM customer",
  vendor: "SELECT * FROM vendor",
  employee: "SELECT * FROM employee",
};

Deno.serve(async (req: Request) => {
  const { ARCHIVE_SECRET } = await getSecrets(["ARCHIVE_SECRET"]);
  if (!req.headers.get("x-archive-secret") || req.headers.get("x-archive-secret") !== ARCHIVE_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  const { part, from, to, types } = await req.json();
  const [log] = await sql`insert into ns_archive.run_log (part, window_from, window_to, status)
    values (${part}, ${from ?? null}, ${to ?? null}, 'running') returning id`;
  try {
    const s = await getSecrets(["NS_ACCOUNT", "NS_CLIENT_ID", "NS_CERT_ID", "NS_PRIVATE_KEY"]);
    const { token, base } = await nsToken(s);
    let result: Record<string, unknown>;
    if (part === "gl") {
      result = await archiveGl(base, token, from, to);
    } else if (part === "txn") {
      const rows = await sqAll(base, token, `SELECT t.* FROM transaction t WHERE ${win(from, to)} ORDER BY t.id`);
      const recs = rows.map((r) => ({ record_type: "transaction", id: String(r.id), data: r }));
      await sql.begin(async (tx) => {
        for (let i = 0; i < recs.length; i += 1000) {
          await tx`insert into ns_archive.record ${tx(recs.slice(i, i + 1000), "record_type", "id", "data")}
            on conflict (record_type, id) do update set data = excluded.data, extracted_at = now()`;
        }
      });
      result = { rows: recs.length };
    } else if (part === "master") {
      const out: Record<string, number> = {};
      for (const t of (types as string[] | undefined) ?? Object.keys(MASTER)) {
        out[t] = await putRecords(t, await sqAll(base, token, MASTER[t]), (r) => String(r.id), true);
      }
      result = out;
    } else if (part === "open") {
      const q = (types: string) =>
        `SELECT t.id, t.tranid, TO_CHAR(t.trandate,'YYYY-MM-DD') AS trandate, TO_CHAR(t.duedate,'YYYY-MM-DD') AS duedate,
           t.type, t.entity, tl.subsidiary, t.currency, t.exchangerate, t.foreigntotal, t.foreignamountunpaid,
           t.foreignamountunpaid * NVL(t.exchangerate,1) AS amount_open_base, t.memo
         FROM transaction t JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T'
         WHERE t.type IN (${types}) AND NVL(t.foreignamountunpaid, 0) <> 0`;
      result = {
        ar_open: await putRecords("ar_open", await sqAll(base, token, q("'CustInvc','CustCred'")), (r) => String(r.id), true),
        ap_open: await putRecords("ap_open", await sqAll(base, token, q("'VendBill','VendCred'")), (r) => String(r.id), true),
      };
    } else {
      throw new Error("unknown part " + part);
    }
    await sql`update ns_archive.run_log set status = ${result.match === false ? "mismatch" : "ok"},
      rows = ${Number(result.rows ?? 0)}, debit = ${(result.debit as number) ?? null}, credit = ${(result.credit as number) ?? null},
      finished_at = now(), error = ${JSON.stringify(result).slice(0, 1000)} where id = ${log.id}`;
    return Response.json({ ok: true, ...result });
  } catch (e) {
    await sql`update ns_archive.run_log set status = 'error', error = ${String(e).slice(0, 1000)}, finished_at = now()
      where id = ${log.id}`;
    return Response.json({ ok: false, error: String(e).slice(0, 500) }, { status: 500 });
  }
});
