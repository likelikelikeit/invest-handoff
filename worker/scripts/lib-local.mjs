// 맥 미니·PC에서 도는 스크립트 공용 (scripts/dart-*.mjs).
// D1은 wrangler로 원격 실행한다. 이 기기에서 `npx wrangler login`을 한 번 하거나 CLOUDFLARE_API_TOKEN(D1 편집 권한만)을 둔다.
// 키·토큰은 형진이 직접 넣고, 스크립트는 읽기만 하며 출력하지 않는다.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const where = process.argv.includes("--local") ? "--local" : "--remote";
export const dry = process.argv.includes("--dry");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** DART 키: 환경변수 DART_API_KEY, 없으면 worker/.dev.vars의 DART_API_KEY= 줄 */
export function dartKey() {
  if (process.env.DART_API_KEY) return process.env.DART_API_KEY.trim();
  const f = resolve(cwd, ".dev.vars");
  if (existsSync(f)) {
    const line = readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.startsWith("DART_API_KEY="));
    if (line) return line.slice("DART_API_KEY=".length).replace(/^"|"$/g, "").trim();
  }
  return "";
}

export function d1(sql) {
  if (sql.includes('"')) throw new Error("SQL에 큰따옴표를 쓰지 않는다");
  const out = execSync("npx wrangler d1 execute invest " + where + ' --json --command "' + sql + '"',
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(out)[0].results;
}

// Worker와 같은 문장 함수를 그대로 쓰려고, prepare/bind를 SQL 문자열로 바꾸는 가짜 DB.
const lit = (v) => v == null ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
export const sqlEnv = {
  DB: {
    prepare: (sql) => ({
      // 한 번에 바꿔 값 안의 '?1' 같은 글자를 다시 건드리지 않는다
      bind: (...args) => ({ sql: sql.replace(/\?(\d+)/g, (_, n) => lit(args[Number(n) - 1])) }),
    }),
  },
};

/** 문장들을 .seed/<name>.sql로 쓰고 한 번에 실행. 보유 종목이 드러나므로 .seed/는 gitignore다. */
export function runSql(name, stmts) {
  if (!stmts.length) return false;
  const file = resolve(cwd, ".seed/" + name + ".sql");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stmts.map((s) => s.sql + ";").join("\n") + "\n");
  if (dry) { console.log("시험 실행이라 넣지 않았습니다 → " + file); return false; }
  execSync("npx wrangler d1 execute invest " + where + ' --file "' + file + '" -y', { cwd, stdio: ["ignore", "ignore", "inherit"] });
  return true;
}

export function krDartSecurities() {
  return d1(
    "SELECT s.id, s.ticker, s.name, s.dart_corp_code, " +
    "(SELECT COUNT(*) FROM financials f WHERE f.security_id = s.id AND f.source = 'dart' AND f.period_type = 'Q') AS n " +
    "FROM securities s WHERE s.archived_at IS NULL AND s.market = 'KR' AND s.asset_class = 'equity' AND s.dart_corp_code IS NOT NULL " +
    "AND (s.id IN (SELECT security_id FROM positions) OR s.id IN (SELECT security_id FROM watchlist)) ORDER BY s.id"
  );
}

export const krw = (rows) => rows.map((x) => ({ ...x, currency: "KRW", source_currency: "KRW", adr_ratio: 1, fx_rate: 1, balance_fx_rate: 1 }));

/** 실행 기록을 meta에 남긴다 (앱·크론 보고와 같은 자리). */
export function reportStmt(key, report) {
  return sqlEnv.DB.prepare(
    "INSERT INTO meta (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(key, JSON.stringify(report), report.at);
}
