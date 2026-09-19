import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDb } from "./d1shim.js";

const yahoo = { price: 130, time: "2026-09-18T20:00:00.000Z", fail: false };
vi.mock("../src/sources/yahoo.js", () => ({
  quote: async () => {
    if (yahoo.fail) throw new Error("down");
    return { price: yahoo.price, time: yahoo.time };
  },
}));

const { getRules, saveRules, listRules, getTech, createCall, patchCall, listCalls, fillCallPricesStmts, exchangeDate } =
  await import("../src/routes/tech.js");

const H = {};
const req = (body) => ({ json: async () => body });
const url = (q) => new URL("http://x/tech" + q);
const body = async (res) => (await res).json();

function setup() {
  const env = { DB: makeDb() };
  const at = "2026-09-19T00:00:00+09:00";
  env.DB.raw.prepare("INSERT INTO securities (name, ticker, ysym, market, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("엔비디아", "NVDA", "NVDA", "US", "USD", at, at); // 5
  // 2026-06-01부터 평일 90개 봉, 마지막 봉 2026-09-18(금)
  const ins = env.DB.raw.prepare("INSERT INTO prices (security_id, date, open, high, low, close, volume) VALUES (5, ?, ?, ?, ?, ?, 1000)");
  const days = [];
  for (let d = new Date("2026-09-18T00:00:00Z"); days.length < 90; d = new Date(d.getTime() - 86400000)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.unshift(d.toISOString().slice(0, 10));
  }
  days.forEach((date) => ins.run(date, 100, 100, 100, 100));
  return { env, days };
}

describe("exchangeDate", () => {
  it("미국 장 마감(UTC 20시)은 뉴욕 날짜로 그날", () => {
    expect(exchangeDate(new Date("2026-09-18T20:00:00Z"), "US")).toBe("2026-09-18");
    expect(exchangeDate(new Date("2026-09-18T20:00:00Z"), "KR")).toBe("2026-09-19");
  });
});

describe("tech routes (실제 SQLite)", () => {
  let env, days;
  beforeEach(() => {
    ({ env, days } = setup());
    yahoo.fail = false;
    yahoo.price = 130;
    yahoo.time = "2026-09-18T20:00:00.000Z";
  });

  it("규칙이 없으면 기본값으로 첫 버전, 저장하면 새 버전", async () => {
    const r1 = await body(getRules({}, env, H));
    expect(r1.rules.id).toBe(1);
    expect(r1.rules.config.indicators.rsi14.overheat).toBe(70);
    const cfg = structuredClone(r1.rules.config);
    cfg.indicators.rsi14.overheat = 75;
    const r2 = await body(saveRules(req({ config: cfg, note: "RSI 완화" }), env, H));
    expect(r2.rules.id).toBe(2);
    expect((await body(getRules({}, env, H))).rules.config.indicators.rsi14.overheat).toBe(75);
    expect((await body(listRules({}, env, H))).versions.map((v) => v.id)).toEqual([2, 1]);
    cfg.indicators.dev20.oversold = 1;
    await expect(saveRules(req({ config: cfg }), env, H)).rejects.toMatchObject({ status: 400 });
  });

  it("마감 후 현재가가 마지막 봉과 같은 날이면 새 봉으로 붙이지 않는다", async () => {
    const r = await body(getTech({}, env, H, { id: 5 }, url("?side=buy")));
    expect(r.intraday).toBe(false);
    expect(r.as_of).toBe("2026-09-18");
    expect(r.price).toBe(100);
  });

  it("장중(다음 거래일) 현재가는 오늘 봉으로: 급등이면 매수 과열 쪽", async () => {
    yahoo.time = "2026-09-21T15:00:00.000Z"; // 월요일 장중
    const r = await body(getTech({}, env, H, { id: 5 }, url("?side=buy")));
    expect(r.intraday).toBe(true);
    expect(r.price).toBe(130);
    expect(r.indicators.find((x) => x.key === "dev20").verdict).toBe("과열");
    expect(r.rule_set_id).toBe(1);
  });

  it("현재가 실패해도 마지막 종가로 판정, 이력 부족이면 안내", async () => {
    yahoo.fail = true;
    const r = await body(getTech({}, env, H, { id: 5 }, url("")));
    expect(r.ok).toBe(true);
    expect(r.intraday).toBe(false);
    env.DB.raw.exec("DELETE FROM prices WHERE date < '2026-08-01'");
    const r2 = await body(getTech({}, env, H, { id: 5 }, url("")));
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/이력이 부족/);
  });

  it("기록 → 행동 수정 → 목록, 검증", async () => {
    const t = await body(getTech({}, env, H, { id: 5 }, url("?side=sell")));
    const c = await body(createCall(req({ side: "sell", rule_set_id: t.rule_set_id, price_at: t.price, label: t.label, indicators: t.indicators }), env, H, { id: 5 }));
    expect(c.call).toMatchObject({ side: "sell", label: t.label, action: null, price_at: 100 });
    await patchCall(req({ action: "waited" }), env, H, { id: c.call.id });
    const list = await body(listCalls({}, env, H, {}, url("?security_id=5")));
    expect(list.calls[0].action).toBe("waited");
    expect(list.calls[0].indicators).toHaveLength(5);
    await expect(createCall(req({ side: "hold", rule_set_id: 1, price_at: 1, label: "low", indicators: [] }), env, H, { id: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(createCall(req({ side: "buy", rule_set_id: 99, price_at: 1, label: "low", indicators: [] }), env, H, { id: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(patchCall(req({ action: "sold" }), env, H, { id: c.call.id })).rejects.toMatchObject({ status: 400 });
  });

  it("크론: 기록일 +7일·+30일 이후 첫 거래일 종가를 채우고, 봉이 없으면 비워 둔다", async () => {
    await getRules({}, env, H);
    env.DB.raw.exec(
      "INSERT INTO tech_calls (security_id, side, called_at, rule_set_id, price_at, indicators, label) VALUES " +
      "(5, 'buy', '2026-08-01T10:00:00+09:00', 1, 100, '[]', 'neutral'), (5, 'buy', '2026-09-15T10:00:00+09:00', 1, 100, '[]', 'neutral')"
    );
    env.DB.raw.exec("UPDATE prices SET close = 111 WHERE date = '2026-08-10'"); // 8/8(토) 이후 첫 거래일
    await env.DB.batch(fillCallPricesStmts(env));
    const rows = env.DB.raw.prepare("SELECT called_at, price_1w, price_1m FROM tech_calls ORDER BY id").all();
    expect(rows[0].price_1w).toBe(111);
    expect(rows[0].price_1m).toBe(100);
    expect(rows[1].price_1w).toBeNull(); // 9/22 봉이 아직 없음
  });
});
