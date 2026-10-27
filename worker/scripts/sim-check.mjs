// 모의투자 대회 매일 점검 — 맥 미니가 07:30 KST에 돌린다(미국장 마감·체결·07:10 일별 스냅샷 뒤).
// 읽기만 한다. 문제가 있으면 끝에 목록을 찍고 종료 코드 1로 끝나 run-with-alert가 알린다.
//
//   node scripts/sim-check.mjs [--local]
//
// 확인: 체결 Worker 실행, 시세 보류 종목, 오래 걸리는 미체결 주문, 시세·환율 신선도,
// 현금 원장(초기 자금 + 체결 + 분할 정산 = 현재 현금), 음수 잔고·보유, 일별 스냅샷, 지난 24시간 체결·거절.

import { d1 } from "./lib-local.mjs";

const now = new Date();
const ago = (min) => new Date(now.getTime() - min * 60000).toISOString();
const kst = (iso) => iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "없음";
const won = (n) => Math.round(n).toLocaleString("ko-KR") + "원";
const problems = [], lines = [];
const say = (s = "") => lines.push(s);
const bad = (s) => { problems.push(s); say("⚠️ " + s); };

const contest = d1("SELECT id,name,status,rules_version,created_at,initial_cash FROM sim_contests WHERE status='active' LIMIT 1")[0];
if (!contest) {
  console.log("모의투자 점검 " + kst(now.toISOString()) + " — 진행 중인 대회가 없습니다.");
  process.exit(0);
}
say("모의투자 점검 " + kst(now.toISOString()) + " — " + contest.name + " (규칙 v" + contest.rules_version + ", 시작 " + kst(contest.created_at) + ")");
const cid = contest.id.replace(/'/g, "");
const inContest = "(SELECT id FROM sim_accounts WHERE contest_id='" + cid + "')";

// 1. 체결 Worker: 5분 크론이 sim_state 'cron'을 갱신한다.
say("\n[체결 Worker]");
const cron = d1("SELECT value,updated_at FROM sim_state WHERE key='cron'")[0];
if (contest.rules_version === "1") say("v1 대회라 invest-api 틱이 처리합니다.");
else if (!cron) bad("체결 Worker 실행 기록이 없습니다.");
else {
  let info;
  try { info = JSON.parse(cron.value); } catch { info = { ran: [], errors: ["실행 기록을 읽지 못함: " + String(cron.value).slice(0, 80)] }; }
  say("마지막 실행 " + kst(cron.updated_at) + ", 한 일 [" + info.ran.join(", ") + "], 외부 요청 " + info.subrequests + ", D1 " + info.d1_calls);
  if (cron.updated_at < ago(20)) bad("체결 Worker가 20분 넘게 돌지 않았습니다 (마지막 " + kst(cron.updated_at) + ").");
  if (info.errors.length) bad("마지막 실행 오류: " + info.errors.join(" / "));
}

// 2. 시세 확인 상태: hold면 그 종목의 체결·평가가 멈춰 있다.
say("\n[시세 확인]");
const checks = d1("SELECT s.ysym,mc.status,mc.detail,mc.attempted_at,mc.verified_at FROM sim_market_checks mc JOIN sim_securities s ON s.id=mc.security_id ORDER BY mc.status DESC,s.ysym");
say("확인한 종목 " + checks.length + "개, 보류 " + checks.filter(c => c.status !== "ok").length + "개");
for (const c of checks.filter(c => c.status !== "ok")) bad("시세 보류 " + c.ysym + ": " + c.detail + " (시도 " + kst(c.attempted_at) + ")");
for (const c of checks.filter(c => c.status === "ok" && c.attempted_at < ago(4 * 60)))
  bad("시세 확인이 4시간 넘게 멈춤 " + c.ysym + " (마지막 " + kst(c.attempted_at) + ")");

// 3. 미체결 주문: 시세가 주문 시각보다 30분 넘게 앞서 나갔는데 체결이 안 됐으면 막힌 것이다.
// 마감 후 주문은 다음 정규장까지 기다리므로, 시세가 앞서지 않았으면 4일까지는 정상으로 본다.
say("\n[미체결 주문]");
const pending = d1("SELECT o.id,o.created_at,o.side,o.qty,s.ysym,a.name,q.price_at FROM sim_orders o JOIN sim_accounts a ON a.id=o.account_id JOIN sim_securities s ON s.id=o.security_id LEFT JOIN sim_intraday_quotes q ON q.security_id=o.security_id WHERE o.status='pending' AND o.account_id IN " + inContest + " ORDER BY o.created_at");
say("미체결 " + pending.length + "건");
for (const o of pending) {
  const label = o.name + " " + o.ysym + " " + (o.side === "buy" ? "매수" : "매도") + " " + o.qty + "주 (접수 " + kst(o.created_at) + ")";
  const passed = o.price_at && Date.parse(o.price_at) - Date.parse(o.created_at) > 45 * 60000;
  if (passed) bad("시세는 들어왔는데 체결되지 않음: " + label + ", 최신 봉 " + kst(o.price_at));
  else if (o.created_at < ago(4 * 1440)) bad("4일 넘게 미체결: " + label);
  else say("  대기 " + label);
}

// 4. 환율·평가 시세 신선도.
say("\n[환율·평가 시세]");
const fx = d1("SELECT date,close FROM sim_fx ORDER BY date DESC LIMIT 1")[0];
if (!fx) bad("USD/KRW 환율이 없습니다.");
else {
  say("최신 환율 " + fx.date + " " + fx.close);
  if (Date.parse(now.toISOString().slice(0, 10)) - Date.parse(fx.date) > 4 * 86400000) bad("환율이 4일 넘게 갱신되지 않았습니다 (" + fx.date + ").");
}
const held = d1("SELECT s.ysym,q.price_at FROM sim_positions p JOIN sim_securities s ON s.id=p.security_id LEFT JOIN sim_intraday_quotes q ON q.security_id=p.security_id WHERE p.qty>0.000001 AND p.account_id IN " + inContest + " GROUP BY s.id");
say("보유 종목 " + held.length + "개");
for (const h of held) {
  if (!h.price_at) bad("평가 시세가 없는 보유 종목: " + h.ysym);
  else if (h.price_at < ago(4 * 1440)) bad("평가 시세가 4일 넘게 오래됨: " + h.ysym + " (" + kst(h.price_at) + ")");
}

// 5. 계좌 원장: 현금 = 초기 자금 + 체결 금액 합 + 분할 정산 합. 음수 현금·보유가 없어야 한다.
say("\n[계좌]");
const accounts = d1("SELECT a.id,a.name,a.cash," +
  "(SELECT COALESCE(SUM(f.cash_delta),0) FROM sim_fills f JOIN sim_orders o ON o.id=f.order_id WHERE o.account_id=a.id) AS fills," +
  "(SELECT COALESCE(SUM(x.cash_krw),0) FROM sim_split_adjustments x WHERE x.account_id=a.id) AS splits," +
  "(SELECT COUNT(*) FROM sim_positions p WHERE p.account_id=a.id AND (p.qty<-0.000001 OR p.cost_krw<-0.01)) AS negative," +
  "(SELECT COUNT(*) FROM sim_orders o WHERE o.account_id=a.id AND o.status='filled') AS filled " +
  "FROM sim_accounts a WHERE a.contest_id='" + cid + "' ORDER BY a.name");
for (const a of accounts) {
  const expected = contest.initial_cash + a.fills + a.splits;
  say("  " + a.name + ": 현금 " + won(a.cash) + ", 체결 " + a.filled + "건");
  if (Math.abs(expected - a.cash) > 1) bad(a.name + " 현금 원장이 맞지 않습니다 (기록 " + won(a.cash) + ", 계산 " + won(expected) + ").");
  if (a.cash < -0.01) bad(a.name + " 현금이 음수입니다.");
  if (a.negative) bad(a.name + " 음수 보유가 " + a.negative + "건 있습니다.");
}

// 6. 일별 스냅샷: 07:10 KST에 저장한다. 대회 다음 날부터 매일 있어야 최대 낙폭이 맞는다.
say("\n[일별 스냅샷]");
const snap = d1("SELECT MAX(date) AS date,MAX(created_at) AS at,COUNT(DISTINCT date) AS days FROM sim_snapshots WHERE account_id IN " + inContest)[0];
say("마지막 " + (snap.date || "없음") + " (저장 " + kst(snap.at) + "), 저장한 날 " + snap.days + "일");
// 가장 최근의 22:10 UTC(07:10 KST) 저장 시각. 그보다 먼저 시작한 대회라면 그 뒤 저장이 있어야 한다.
const slot = new Date(now.getTime() - 20 * 60000); slot.setUTCHours(22, 10, 0, 0);
if (slot > now) slot.setUTCDate(slot.getUTCDate() - 1);
if (now.getTime() - slot.getTime() >= 20 * 60000 && contest.created_at < slot.toISOString() && (!snap.at || snap.at < slot.toISOString()))
  bad(kst(slot.toISOString()) + " 일별 스냅샷이 없습니다. 그 시각에 미체결 주문이 남아 있으면 그날은 건너뜁니다.");

// 7. 지난 24시간 체결·거절·분할.
say("\n[지난 24시간]");
const fills = d1("SELECT a.name,s.ysym,o.side,o.qty,f.raw_price,f.price,f.price_source,f.quote_end,f.created_at,o.created_at AS ordered FROM sim_fills f JOIN sim_orders o ON o.id=f.order_id JOIN sim_accounts a ON a.id=o.account_id JOIN sim_securities s ON s.id=o.security_id WHERE f.created_at>='" + ago(1440) + "' AND o.account_id IN " + inContest + " ORDER BY f.created_at");
say("체결 " + fills.length + "건");
for (const f of fills) {
  const wait = Math.round((Date.parse(f.created_at) - Date.parse(f.ordered)) / 60000);
  say("  " + f.name + " " + f.ysym + " " + (f.side === "buy" ? "매수" : "매도") + " " + f.qty + "주 @" + f.raw_price + " (" + (f.price_source || "") + ", 봉 끝 " + kst(f.quote_end) + ", 접수 후 " + wait + "분)");
}
const rejected = d1("SELECT a.name,s.ysym,o.status_reason,o.resolved_at FROM sim_orders o JOIN sim_accounts a ON a.id=o.account_id JOIN sim_securities s ON s.id=o.security_id WHERE o.status='rejected' AND o.resolved_at>='" + ago(1440) + "' AND o.account_id IN " + inContest);
say("거절 " + rejected.length + "건");
for (const r of rejected) say("  " + r.name + " " + r.ysym + ": " + r.status_reason);
const splits = d1("SELECT s.ysym,sp.numerator,sp.denominator,sp.recorded_at FROM sim_splits sp JOIN sim_securities s ON s.id=sp.security_id WHERE sp.recorded_at>='" + ago(1440) + "'");
for (const s of splits) bad("분할·병합 반영 " + s.ysym + " " + s.numerator + ":" + s.denominator + " — 보유·평가가 맞는지 확인하세요.");

say("\n" + (problems.length ? "확인할 것 " + problems.length + "개" : "이상 없음"));
console.log(lines.join("\n"));
process.exit(problems.length ? 1 : 0);
