// 최초 5년 일봉 백필을 로컬에서 한 번에 한다 (Worker CPU 10ms·쿼리 50 제한과 무관).
//   node scripts/backfill.mjs [--local] [--range 5y]
//     1) D1에서 추적 대상 종목(보유+관심+지수·환율) 중 이력이 부족한 것을 고른다
//     2) 이 PC에서 야후 일봉을 받는다 (worker와 같은 parseChart)
//     3) .seed/prices.sql을 만들고 wrangler d1 execute로 넣는다
// 여러 번 돌려도 같은 결과(UPSERT). SQL 파일은 보유 종목 목록이 드러나므로 .seed/(gitignore)에 둔다.

import { execFileSync, execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChart } from "../src/sources/yahoo.js";
import { BACKFILL_MIN_ROWS } from "../src/lib/prices.js";

const here = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(here, "..");
const args = process.argv.slice(2);
const where = args.includes("--local") ? "--local" : "--remote";
const range = args.includes("--range") ? args[args.indexOf("--range") + 1] : "5y";
const force = args.includes("--all");
const outFile = resolve(cwd, ".seed/prices.sql");
const CHUNK = 400; // 문장 하나 100KB 제한 안쪽
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// 야후는 Node fetch(undici)의 요청을 429로 거른다(curl·Worker는 통과). 로컬 백필만 curl로 받는다.
function history(sym, range) {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) +
    "?interval=1d&range=" + range + "&includeAdjustedClose=true&events=div%2Csplit";
  const body = execFileSync("curl", ["-s", "-f", "-H", "User-Agent: " + UA, url], { encoding: "utf8", maxBuffer: 32 << 20 });
  const rows = parseChart(JSON.parse(body));
  if (!rows.length) throw new Error("일봉이 비어 있음");
  return rows;
}

// Windows에서 npx는 셸을 거쳐야 해서 인자 배열이 쪼개진다. SQL을 큰따옴표로 감싼 명령 문자열 하나로 넘긴다.
// (SQL 안에 큰따옴표를 쓰지 않는다)
function d1(sql) {
  if (sql.includes('"')) throw new Error("SQL에 큰따옴표를 쓰지 않는다");
  const out = execSync('npx wrangler d1 execute invest ' + where + ' --json --command "' + sql + '"',
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(out)[0].results;
}

const secs = d1(
  "SELECT s.id, s.ysym, (SELECT COUNT(*) FROM prices p WHERE p.security_id = s.id) AS n FROM securities s " +
  "WHERE s.archived_at IS NULL AND (s.asset_class IN ('index','fx') OR s.id IN (SELECT security_id FROM positions) " +
  "OR s.id IN (SELECT security_id FROM watchlist)) ORDER BY s.id"
).filter((s) => force || s.n < BACKFILL_MIN_ROWS);

console.log("백필 대상 " + secs.length + "종목 (" + where + ", " + range + ")");
if (!secs.length) process.exit(0);

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const lines = [];
let total = 0;
for (const s of secs) {
  try {
    const rows = history(s.ysym, range);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const packed = JSON.stringify(rows.slice(i, i + CHUNK).map((r) => [r.date, r.open, r.high, r.low, r.close, r.volume, r.adj_close]));
      lines.push(
        "INSERT INTO prices (security_id, date, open, high, low, close, volume, adj_close) SELECT " + s.id +
        ", json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), " +
        "json_extract(value,'$[4]'), json_extract(value,'$[5]'), json_extract(value,'$[6]') FROM json_each(" + q(packed) + ") WHERE true " +
        "ON CONFLICT(security_id, date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, " +
        "close=excluded.close, volume=excluded.volume, adj_close=excluded.adj_close;"
      );
    }
    total += rows.length;
    console.log("  " + s.ysym + " " + rows.length + "행 (" + rows[0].date + " ~ " + rows[rows.length - 1].date + ")");
  } catch (e) {
    console.log("  " + s.ysym + " 실패: " + e.message);
  }
  await new Promise((r) => setTimeout(r, 300)); // 야후에 예의
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n");
console.log("총 " + total + "행 → " + outFile);

execSync("npx wrangler d1 execute invest " + where + ' --file "' + outFile + '" -y',
  { cwd, stdio: ["ignore", "ignore", "inherit"] });
console.log("D1에 넣었습니다");
