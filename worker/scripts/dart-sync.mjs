// DART 매일 동기화 — 맥 미니가 돌린다 (SPEC §5.7·§7.3, 2026-10-22).
// OpenDART는 Cloudflare 서버 요청을 오류 페이지로 돌려보내서(302 → error1.html) Worker 대신 국내 가정 회선에서 부른다.
//
//   node scripts/dart-sync.mjs [--local] [--dry]
//
// 종목마다 (보유·관심 국내 종목, DART 고유번호가 있는 것):
//   1) 최근 정기보고서 4건 → 분기 재무 (새 분기가 나오면 들어간다)
//   2) 최근 400일 공정공시 → 실적 발표일: 오늘 잠정실적 공시면 확정, 아니면 작년 같은 분기 + 1년을 예상
//      (KIND IR 일정의 확정 날짜가 근처에 있으면 예상은 넣지 않는다 — Worker의 같은 문장 함수를 쓴다)
// 과거 이력을 처음 채우는 건 dart-history.mjs. 실행 기록은 meta 'cron:dart'.
// 맥 미니에서는 scripts/launchd/ 의 LaunchAgent로 하루 두 번(08:10, 18:10) 돌린다.

import { dartFundamentals, dartDisclosures, krEarningsFromDisclosures } from "../src/sources/dart.js";
import { upsertFinancialsStmt, replaceEarningsStmts } from "../src/lib/fundamentals.js";
import { dartKey, sqlEnv, runSql, krDartSecurities, krw, reportStmt, sleep, where, dry } from "./lib-local.mjs";

const key = dartKey();
if (!key) {
  console.error("DART 키가 없습니다. 환경변수 DART_API_KEY 또는 worker/.dev.vars에 DART_API_KEY=... 를 넣어 주세요.");
  process.exit(1);
}

const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString();
const today = kst().slice(0, 10);
const from = new Date(Date.parse(today) - 400 * 86400e3).toISOString().slice(0, 10);
const at = kst().slice(0, 19) + "+09:00";

console.log("── dart-sync 시작 " + at + " ──"); // 로그에서 실행 시각을 가르려고
const secs = krDartSecurities();
console.log("국내 종목 " + secs.length + "개 (" + where + (dry ? ", 시험 실행" : "") + ")");

const stmts = [];
const errors = [];
let fin = 0;
let earn = 0;
for (const s of secs) {
  try {
    const r = await dartFundamentals(key, s.dart_corp_code, new Date(), { offset: 0, count: 4 });
    if (r.financials.length) {
      stmts.push(upsertFinancialsStmt(sqlEnv, s.id, krw(r.financials), at));
      fin += r.financials.length;
    }
    errors.push(...r.errors.map((e) => s.ticker + ": " + e));
  } catch (e) {
    errors.push(s.ticker + " 재무: " + e.message);
  }
  await sleep(300);
  try {
    const e = krEarningsFromDisclosures(await dartDisclosures(key, s.dart_corp_code, from, today), today);
    if (e && e.date >= today) {
      stmts.push(...replaceEarningsStmts(sqlEnv, s.id, e.date, at, today, { ...e, source: "dart" }));
      earn++;
      console.log("  " + s.name + " 실적일 " + e.date + (e.confirmed ? " (확정)" : " (예상)"));
    } else console.log("  " + s.name + " 실적일 근거 없음(잠정실적 공시 이력 없음)");
  } catch (e) {
    errors.push(s.ticker + " 공시: " + e.message);
  }
  await sleep(300);
}

const report = { at, stocks: secs.length, financial_rows: fin, earnings: earn, errors };
stmts.push(reportStmt("cron:dart", report));
runSql("dart-sync", stmts);
console.log("재무 " + fin + "행 · 실적일 " + earn + "종목" + (errors.length ? " · 오류 " + errors.length + "건: " + errors.slice(0, 3).join(" / ") : ""));
