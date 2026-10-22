// 국내 종목 DART 분기 재무 이력을 한 번에 채운다 (밸류에이션 밴드용 TTM 이력, SPEC §5.4·§7.3).
// 처음 한 번, 그리고 새 국내 종목을 추가했을 때 돌린다. 매일 새 분기를 잇는 건 dart-sync.mjs.
// OpenDART는 Cloudflare 서버 요청을 막아서 Worker가 아니라 맥 미니·PC에서 돌린다.
//
//   node scripts/dart-history.mjs [--local] [--dry]
//
// 필요한 것은 scripts/lib-local.mjs 첫머리 참고 (DART 키, wrangler 로그인 또는 D1 토큰).
// 여러 번 돌려도 된다(UPSERT). 결과 SQL은 .seed/(gitignore)에 둔다.

import { dartFundamentals } from "../src/sources/dart.js";
import { upsertFinancialsStmt } from "../src/lib/fundamentals.js";
import { dartKey, sqlEnv, runSql, krDartSecurities, krw, sleep, where, dry } from "./lib-local.mjs";

const key = dartKey();
if (!key) {
  console.error("DART 키가 없습니다. 환경변수 DART_API_KEY 또는 worker/.dev.vars에 DART_API_KEY=... 를 넣어 주세요.");
  process.exit(1);
}

const secs = krDartSecurities();
console.log("국내 종목 " + secs.length + "개 (" + where + (dry ? ", 시험 실행" : "") + ")");

const stmts = [];
let total = 0;
const at = new Date().toISOString();
for (const s of secs) {
  try {
    // 최근 공시 20건(5년치). DART 하루 호출 한도(2만) 안쪽이고, 천천히 부른다.
    const r = await dartFundamentals(key, s.dart_corp_code, new Date(), { offset: 0, count: 20 });
    await sleep(300);
    if (!r.financials.length) { console.log("  " + s.name + " 건너뜀: 받은 분기 없음" + (r.errors.length ? " (" + r.errors[0] + ")" : "")); continue; }
    stmts.push(upsertFinancialsStmt(sqlEnv, s.id, krw(r.financials), at));
    total += r.financials.length;
    const ends = r.financials.map((x) => x.period_end).sort();
    console.log("  " + s.name + " " + r.financials.length + "행 (" + ends[0] + " ~ " + ends[ends.length - 1] + ", 전에 DART 분기 " + s.n + "개)" +
      (r.errors.length ? " · 일부 실패 " + r.errors.length + "건" : ""));
  } catch (e) {
    console.log("  " + s.name + " 실패: " + e.message);
  }
}

// D1 쓰기 한도(하루 10만 행) 확인용: 행마다 표 + 색인으로 약 2행
if (stmts.length) console.log("총 " + total + "행, 예상 D1 쓰기 약 " + total * 2 + "행");
if (runSql("dart-history", stmts)) console.log("D1에 넣었습니다.");
