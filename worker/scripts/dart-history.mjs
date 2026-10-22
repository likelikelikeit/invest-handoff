// 국내 종목 DART 분기 재무 이력을 한 번에 채운다 (밸류에이션 밴드용 TTM 이력, SPEC §5.4·§7.3).
// Worker 크론은 호출당 요청 한도 때문에 하루 한 종목·4건씩만 채우므로, 처음 한 번은 이걸로 몰아서 넣는다.
//
//   node scripts/dart-history.mjs [--local] [--dry]
//
// 필요한 것 (형진이 직접 넣는다. 스크립트는 읽기만 하고 화면에 출력하지 않는다):
//   - DART 키: 환경변수 DART_API_KEY, 없으면 worker/.dev.vars의 DART_API_KEY= 줄
//   - D1 접속: `npx wrangler login`(이 기기에서 한 번) 또는 환경변수 CLOUDFLARE_API_TOKEN(D1 편집 권한만)
// 맥 미니(Node 24)든 윈도우든 같다. 여러 번 돌려도 된다(UPSERT, DART 행은 같은 값이면 그대로).
// 결과 SQL은 보유 종목이 드러나므로 .seed/(gitignore)에 둔다.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dartFundamentals } from "../src/sources/dart.js";
import { upsertFinancialsStmt } from "../src/lib/fundamentals.js";

const here = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(here, "..");
const where = process.argv.includes("--local") ? "--local" : "--remote";
const dry = process.argv.includes("--dry");
const outFile = resolve(cwd, ".seed/dart.sql");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dartKey() {
  if (process.env.DART_API_KEY) return process.env.DART_API_KEY.trim();
  const f = resolve(cwd, ".dev.vars");
  if (existsSync(f)) {
    const line = readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.startsWith("DART_API_KEY="));
    if (line) return line.slice("DART_API_KEY=".length).replace(/^"|"$/g, "").trim();
  }
  return "";
}

function d1(sql) {
  if (sql.includes('"')) throw new Error("SQL에 큰따옴표를 쓰지 않는다");
  const out = execSync("npx wrangler d1 execute invest " + where + ' --json --command "' + sql + '"',
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(out)[0].results;
}

// Worker와 같은 upsert 문을 그대로 쓰려고, prepare/bind를 SQL 문자열로 바꾸는 가짜 DB.
const lit = (v) => v == null ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const fakeEnv = {
  DB: {
    prepare: (sql) => ({
      bind: (...args) => ({
        sql: sql.replace(/\?(\d+)/g, (_, n) => lit(args[Number(n) - 1])), // 한 번에 바꿔 값 안의 '?1'을 다시 건드리지 않는다
      }),
    }),
  },
};

const key = dartKey();
if (!key) {
  console.error("DART 키가 없습니다. 환경변수 DART_API_KEY 또는 worker/.dev.vars에 DART_API_KEY=... 를 넣어 주세요.");
  process.exit(1);
}

const secs = d1(
  "SELECT s.id, s.ticker, s.name, s.dart_corp_code, " +
  "(SELECT COUNT(*) FROM financials f WHERE f.security_id = s.id AND f.source = 'dart' AND f.period_type = 'Q') AS n " +
  "FROM securities s WHERE s.archived_at IS NULL AND s.market = 'KR' AND s.asset_class = 'equity' AND s.dart_corp_code IS NOT NULL " +
  "AND (s.id IN (SELECT security_id FROM positions) OR s.id IN (SELECT security_id FROM watchlist)) ORDER BY s.id"
);
console.log("국내 종목 " + secs.length + "개 (" + where + (dry ? ", 시험 실행" : "") + ")");

const lines = [];
let total = 0;
const at = new Date().toISOString();
for (const s of secs) {
  try {
    // 최근 공시 20건(5년치). DART 하루 호출 한도(2만) 안쪽이고, 초당 몇 건으로 천천히 부른다.
    const r = await dartFundamentals(key, s.dart_corp_code, new Date(), { offset: 0, count: 20 });
    await sleep(300);
    const rows = r.financials.map((x) => ({ ...x, currency: "KRW", source_currency: "KRW", adr_ratio: 1, fx_rate: 1, balance_fx_rate: 1 }));
    if (!rows.length) { console.log("  " + s.name + " 건너뜀: 받은 분기 없음" + (r.errors.length ? " (" + r.errors[0] + ")" : "")); continue; }
    lines.push(upsertFinancialsStmt(fakeEnv, s.id, rows, at).sql + ";");
    total += rows.length;
    const ends = rows.map((x) => x.period_end).sort();
    console.log("  " + s.name + " " + rows.length + "행 (" + ends[0] + " ~ " + ends[ends.length - 1] + ", 전에 DART 분기 " + s.n + "개)" +
      (r.errors.length ? " · 일부 실패 " + r.errors.length + "건" : ""));
  } catch (e) {
    console.log("  " + s.name + " 실패: " + e.message);
  }
}

if (!lines.length) process.exit(0);
// D1 쓰기 한도(하루 10만 행) 확인용: 행마다 표 + 색인으로 약 2행
console.log("총 " + total + "행, 예상 D1 쓰기 약 " + total * 2 + "행");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n");
if (dry) { console.log("시험 실행이라 넣지 않았습니다 → " + outFile); process.exit(0); }
execSync("npx wrangler d1 execute invest " + where + ' --file "' + outFile + '" -y', { cwd, stdio: ["ignore", "ignore", "inherit"] });
console.log("D1에 넣었습니다. 이제 국내장 마감 크론은 부족한 종목만 4건씩 보강합니다.");
