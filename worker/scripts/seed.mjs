// portfolio.json → D1 시드 SQL.
//   node scripts/seed.mjs [../portfolio.json]      → .seed/seed.sql 생성
//   npx wrangler d1 execute invest --remote --file .seed/seed.sql
// 결과 SQL에는 실제 보유가 들어가므로 .seed/는 gitignore 대상이다. 여러 번 돌려도 같은 결과(upsert).
//
// portfolio.json은 기존 index.html 상태 그대로다. 가격·평단은 전부 원화 환산값이라 avg_ccy='KRW'.
// 보유 수량은 baseQty(실제 보유 기준)를 쓴다. qty는 시뮬 중 값일 수 있다.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] || resolve(here, "../../portfolio.json"));
const outFile = resolve(here, "../.seed/seed.sql");

const KST_MS = 9 * 60 * 60 * 1000;
const at = new Date(Date.now() + KST_MS).toISOString().slice(0, 19) + "+09:00";

const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");

export function toRows(pf) {
  return pf.holdings.map((h) => {
    const market = h.mkt === "KR" ? "KR" : "US";
    const qty = Number(h.baseQty ?? h.qty);
    const avg = Number(h.baseAvg ?? h.avg);
    if (!(qty > 0) || !(avg > 0) || !h.ysym) throw new Error("잘못된 행: " + JSON.stringify({ name: h.name, ysym: h.ysym }));
    return {
      name: h.name, ticker: h.tick, ysym: h.ysym, market,
      currency: market === "KR" ? "KRW" : "USD",
      sector: h.sec || null, qty, avg_price: avg, avg_ccy: "KRW",
    };
  });
}

function sql(pf) {
  const lines = ["-- 생성 " + at + " · 원본 " + src.split(/[\\/]/).pop()];
  for (const r of toRows(pf)) {
    lines.push(
      "INSERT INTO securities (name, ticker, ysym, market, currency, sector, created_at, updated_at) VALUES (" +
      [r.name, r.ticker, r.ysym, r.market, r.currency, r.sector, at, at].map(q).join(", ") + ") " +
      "ON CONFLICT(ysym) DO UPDATE SET sector = excluded.sector, archived_at = NULL, updated_at = excluded.updated_at;"
    );
    lines.push(
      "INSERT INTO positions (security_id, qty, avg_price, avg_ccy, source, updated_at) " +
      "SELECT id, " + [r.qty, r.avg_price, r.avg_ccy, "manual", at].map(q).join(", ") +
      " FROM securities WHERE ysym = " + q(r.ysym) + " " +
      "ON CONFLICT(security_id) DO UPDATE SET qty = excluded.qty, avg_price = excluded.avg_price, " +
      "avg_ccy = excluded.avg_ccy, source = excluded.source, updated_at = excluded.updated_at;"
    );
  }
  const deposit = Number(pf.deposit || 0);
  lines.push(
    "INSERT INTO cash (currency, amount, updated_at) VALUES ('KRW', " + deposit + ", " + q(at) + ") " +
    "ON CONFLICT(currency) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at;"
  );
  return lines.join("\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pf = JSON.parse(readFileSync(src, "utf8"));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, sql(pf));
  console.log("보유 " + pf.holdings.length + "종목, 현금 " + (pf.deposit || 0) + "원 → " + outFile);
}
