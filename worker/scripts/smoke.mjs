// API 스모크 테스트. 로컬 wrangler dev에 대고 돌린다 (원격 DB를 건드리지 않게).
//   node scripts/smoke.mjs http://127.0.0.1:8787 <토큰>
// 테스트용 종목(ysym SMOKE.TEST)을 만들었다가 숨기고 끝낸다.

const [base = "http://127.0.0.1:8787", token = "local-dev-token"] = process.argv.slice(2);
let failed = 0;

async function call(method, path, body, auth = true) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? { Authorization: "Bearer " + token } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  return { status: res.status, data };
}

function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + "  " + JSON.stringify(detail).slice(0, 300)); }
}

let r = await call("GET", "/health", undefined, false);
check("/health 200 (토큰 없이)", r.status === 200 && r.data.ok, r);

r = await call("GET", "/portfolio", undefined, false);
check("토큰 없으면 401", r.status === 401, r);
r = await fetch(base + "/portfolio", { headers: { Authorization: "Bearer wrong" } });
check("틀린 토큰 401", r.status === 401, r.status);

r = await call("GET", "/portfolio");
check("GET /portfolio", r.status === 200 && Array.isArray(r.data.positions), r);
const before = r.data.positions.length;
console.log("       보유 " + before + "종목");

r = await call("POST", "/securities", { name: "스모크", ticker: "SMK", ysym: "SMOKE.TEST", market: "US", currency: "USD", sector: "기타" });
check("POST /securities", r.status === 200 && r.data.security.id, r);
const id = r.data.security.id;

r = await call("POST", "/securities", { name: "Smoke Inc", ticker: "SMK", ysym: "SMOKE.TEST", market: "US", currency: "USD" });
check("같은 ysym은 upsert, 이름 유지", r.data.security.id === id && r.data.security.name === "스모크", r);

r = await call("PATCH", "/securities/" + id, { brand_color: "#123456", band_multiples: { per: [8, 10, 12] } });
check("PATCH /securities/:id", r.data.security.brand_color === "#123456" && r.data.security.band_multiples.per[2] === 12, r);

r = await call("PATCH", "/securities/" + id, { brand_color: "blue" });
check("검증 실패 400", r.status === 400, r);

r = await call("PUT", "/portfolio/positions/" + id, { qty: 2.5, avg_price: 100 });
check("PUT position + 변화 기록(0→2.5)", r.status === 200 && r.data.changes.length === 1 && r.data.changes[0].qty_after === 2.5, r);
const changeId = r.data.changes[0] && r.data.changes[0].id;
r = await call("PUT", "/portfolio/positions/" + id, { qty: 2.5, avg_price: 101 });
check("수량 그대로면 변화 없음", r.data.changes.length === 0, r);
r = await call("GET", "/portfolio/changes?pending=1");
check("미응답 변화 목록", r.data.changes.some((c) => c.id === changeId), r);
r = await call("PATCH", "/portfolio/changes/" + changeId, { reason: "buy" });
check("변화 이유 기록", r.status === 200, r);
r = await call("GET", "/portfolio/changes?pending=1");
check("답한 변화는 미응답에서 빠짐", !r.data.changes.some((c) => c.id === changeId), r);
r = await call("PATCH", "/portfolio/changes/" + changeId, { reason: "nope" });
check("잘못된 이유 400", r.status === 400, r);
r = await call("GET", "/portfolio");
const pos = r.data.positions.find((p) => p.security_id === id);
check("position 반영 + avg_ccy 기본값=종목 통화", pos && pos.qty === 2.5 && pos.avg_ccy === "USD", pos);

r = await call("DELETE", "/securities/" + id);
check("보유 중 숨김은 409", r.status === 409, r);

r = await call("POST", "/portfolio/merge", { asOwned: true, rows: [{ name: "x", ticker: "SMK", ysym: "SMOKE.TEST", market: "US", currency: "USD", qty: 3, avg_price: 110 }] });
check("merge: 기존 ysym은 updated", r.status === 200 && r.data.updated === 1 && r.data.added === 0, r);
check("merge: 변화 2.5→3 기록", r.data.changes.length === 1 && r.data.changes[0].qty_before === 2.5 && r.data.changes[0].name === "스모크", r);
await call("PATCH", "/portfolio/changes/" + r.data.changes[0].id, { skipped: true });

r = await call("DELETE", "/portfolio/positions/" + id);
check("DELETE position + 변화 3→0", r.status === 200 && r.data.changes[0].qty_after === 0, r);
await call("PATCH", "/portfolio/changes/" + r.data.changes[0].id, { reason: "sell" });

r = await call("POST", "/portfolio/scenarios", { name: "스모크 시뮬", deposit: 1000, weights: { holdings: [{ ysym: "SMOKE.TEST", qty: 1 }] } });
check("POST /portfolio/scenarios", r.status === 200 && r.data.id, r);
const scId = r.data.id;
r = await call("GET", "/portfolio/scenarios");
check("GET /portfolio/scenarios", r.data.scenarios.some((s) => s.id === scId && s.weights.holdings[0].qty === 1), r);
r = await call("DELETE", "/portfolio/scenarios/" + scId);
check("DELETE /portfolio/scenarios/:id", r.status === 200, r);

r = await call("POST", "/watchlist", { security_id: id, note: "테스트" });
check("POST /watchlist", r.status === 200 && r.data.id, r);
const wid = r.data.id;
r = await call("GET", "/watchlist");
check("GET /watchlist", r.data.watchlist.some((w) => w.id === wid), r);
r = await call("DELETE", "/watchlist/" + wid);
check("DELETE /watchlist/:id", r.status === 200, r);

r = await call("DELETE", "/securities/" + id);
check("DELETE /securities/:id → 숨김", r.status === 200 && r.data.archived_at, r);
r = await call("GET", "/securities");
check("숨긴 종목은 목록에서 빠짐", !r.data.securities.some((s) => s.id === id), r.data.securities.length);

r = await call("GET", "/cash");
check("GET /cash", r.status === 200 && Array.isArray(r.data.cash), r);

r = await call("GET", "/nope");
check("없는 경로 404", r.status === 404, r);
r = await call("PATCH", "/portfolio");
check("메서드 틀리면 405", r.status === 405, r);

r = await call("GET", "/quotes?symbols=005930.KS,NVDA");
check("/quotes (야후, 네트워크 필요)", r.status === 200 && r.data.fx && "quotes" in r.data, r);
if (r.data && r.data.quotes) console.log("       시세 " + Object.keys(r.data.quotes).length + "개, 환율 " + r.data.fx.USDKRW);

r = await call("GET", "/search?q=" + encodeURIComponent("삼성전자"));
check("/search 응답 형태", r.status === 200 && Array.isArray(r.data.results), r);

r = await call("POST", "/import?mt=image/png", "AAAA");
check("/import: 키 없으면 501, 있으면 200", r.status === 501 || r.status === 200, r);

console.log(failed ? "\n실패 " + failed + "개" : "\n전부 통과");
process.exit(failed ? 1 : 0);
