// 미국 종목 분기 재무 이력을 SEC EDGAR에서 한 번에 채운다 (밸류에이션 밴드용 TTM 이력).
//   SEC_USER_AGENT="이름 이메일" node scripts/sec-history.mjs [--local]
// SEC 정책상 User-Agent에 연락처가 필요하다. 코드·저장소에 넣지 않고 환경변수로만 받는다.
// 이미 있는 다른 소스 행(야후·DART)은 덮어쓰지 않고, SEC 행만 새 값으로 고친다. 여러 번 돌려도 된다.
// EPS는 야후 분할 이력으로 '제출일 뒤의 분할'만큼 나눠 오늘 기준으로 맞춘다(주가가 분할 반영이므로).
// 결과 SQL은 보유 종목이 드러나므로 .seed/(gitignore)에 둔다.

import { execSync, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEC_CONCEPTS, pickFacts, quarterlyFromFacts, secFinancialRows } from "../src/sources/sec.js";

const UA = process.env.SEC_USER_AGENT;
if (!UA || !/@/.test(UA)) {
  console.error("SEC_USER_AGENT 환경변수에 '이름 이메일'을 넣어주세요 (SEC 정책).");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(here, "..");
const where = process.argv.includes("--local") ? "--local" : "--remote";
const outFile = resolve(cwd, ".seed/sec.sql");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const YUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// 야후 분할 이력 → [{date, ratio}]. 야후는 Node fetch를 거르므로 curl (backfill.mjs와 같은 이유).
function yahooSplits(ticker) {
  const body = execFileSync("curl", ["-s", "-f", "-H", "User-Agent: " + YUA,
    "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker) + "?range=max&interval=3mo&events=split"],
    { encoding: "utf8", maxBuffer: 32 << 20 });
  const ev = JSON.parse(body)?.chart?.result?.[0]?.events?.splits || {};
  return Object.values(ev).map((x) => ({ date: new Date(x.date * 1000).toISOString().slice(0, 10), ratio: x.numerator / x.denominator }))
    .filter((x) => x.ratio > 0 && x.ratio !== 1);
}

function d1(sql) {
  if (sql.includes('"')) throw new Error("SQL에 큰따옴표를 쓰지 않는다");
  const out = execSync("npx wrangler d1 execute invest " + where + ' --json --command "' + sql + '"',
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(out)[0].results;
}

async function sec(url) {
  await sleep(150); // SEC 한도(초당 10회) 안쪽
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("SEC " + res.status + " " + url);
  return res.json();
}

const secs = d1(
  "SELECT s.id, s.ticker, s.currency, (SELECT COUNT(*) FROM financials f WHERE f.security_id = s.id AND f.period_type = 'Q') AS n " +
  "FROM securities s WHERE s.archived_at IS NULL AND s.market = 'US' AND s.asset_class = 'equity' " +
  "AND (s.id IN (SELECT security_id FROM positions) OR s.id IN (SELECT security_id FROM watchlist)) ORDER BY s.id"
);
const tickers = Object.values(await sec("https://www.sec.gov/files/company_tickers.json"));
console.log("미국 종목 " + secs.length + "개 (" + where + ")");

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const lines = [];
let total = 0;
for (const s of secs) {
  const hit = tickers.find((t) => t.ticker === s.ticker);
  if (!hit) { console.log("  " + s.ticker + " 건너뜀: SEC 제출사 아님(ETF 등)"); continue; }
  const cik = String(hit.cik_str).padStart(10, "0");
  const byField = {};
  let splits = [];
  try {
    splits = yahooSplits(s.ticker);
    for (const [field, spec] of Object.entries(SEC_CONCEPTS)) {
      const responses = {};
      for (const tag of spec.tags) {
        const r = await sec("https://data.sec.gov/api/xbrl/companyconcept/CIK" + cik + "/us-gaap/" + tag + ".json");
        if (r) { responses[tag] = r; break; }
      }
      byField[field] = quarterlyFromFacts(pickFacts(responses, spec), { splits, perShare: field === "eps" });
    }
  } catch (e) {
    console.log("  " + s.ticker + " 실패: " + e.message);
    continue;
  }
  const rows = secFinancialRows(byField);
  if (!rows.length) { console.log("  " + s.ticker + " 건너뜀: 분기 EPS 없음(20-F 해외 기업 등)"); continue; }
  const packed = JSON.stringify(rows.map((r) => [r.period_end, r.revenue, r.operating_income, r.net_income, r.eps]));
  lines.push(
    "INSERT INTO financials (security_id, period_end, period_type, revenue, operating_income, net_income, eps, source, fetched_at, currency, source_currency, adr_ratio, fx_rate, balance_fx_rate) " +
    "SELECT " + s.id + ", json_extract(value,'$[0]'), 'Q', json_extract(value,'$[1]'), json_extract(value,'$[2]'), " +
    "json_extract(value,'$[3]'), json_extract(value,'$[4]'), 'sec', " + q(new Date().toISOString()) + ", " +
    q(s.currency) + ", " + q(s.currency) + ", 1, 1, 1" +
    " FROM json_each(" + q(packed) + ") WHERE true ON CONFLICT(security_id, period_end, period_type) DO UPDATE SET " +
    "revenue = excluded.revenue, operating_income = excluded.operating_income, net_income = excluded.net_income, eps = excluded.eps, " +
    "fetched_at = excluded.fetched_at, currency = excluded.currency, source_currency = excluded.source_currency, " +
    "adr_ratio = excluded.adr_ratio, fx_rate = excluded.fx_rate, balance_fx_rate = excluded.balance_fx_rate WHERE financials.source = 'sec';"
  );
  total += rows.length;
  console.log("  " + s.ticker + " " + rows.length + "분기 (" + rows[0].period_end + " ~ " + rows[rows.length - 1].period_end + ")" +
    (splits.length ? " · 분할 보정 " + splits.map((x) => x.date + " " + x.ratio + ":1").join(", ") : ""));
}

if (!lines.length) process.exit(0);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n");
console.log("총 " + total + "분기 → " + outFile);
execSync("npx wrangler d1 execute invest " + where + ' --file "' + outFile + '" -y', { cwd, stdio: ["ignore", "ignore", "inherit"] });
console.log("D1에 넣었습니다 (다른 소스 분기는 그대로)");
