import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDb } from "./d1shim.js";
import { parseChart } from "../src/sources/yahoo.js";
import { upsertPricesStmt, snapshotStmt, rangeStart, trackedSecurities } from "../src/lib/prices.js";

// 야후 chart 응답 모양 (필요한 부분만)
function chart({ ts, close, off = 32400, adj }) {
  return { chart: { result: [{
    meta: { gmtoffset: off },
    timestamp: ts,
    indicators: {
      quote: [{ open: close, high: close.map((c) => c && c + 1), low: close.map((c) => c && c - 1), close, volume: close.map(() => 100) }],
      adjclose: [{ adjclose: adj || close }],
    },
  }] } };
}

describe("parseChart", () => {
  it("국내 봉(KST 00:00)은 현지 날짜로", () => {
    // 2026-09-17 15:00 UTC = 2026-09-18 00:00 KST
    const rows = parseChart(chart({ ts: [Date.UTC(2026, 8, 17, 15) / 1000], close: [100] }));
    expect(rows[0].date).toBe("2026-09-18");
  });
  it("미국 봉(ET 09:30)은 현지 날짜로", () => {
    // 2026-09-18 13:30 UTC = 09:30 EDT, gmtoffset -14400
    const rows = parseChart(chart({ ts: [Date.UTC(2026, 8, 18, 13, 30) / 1000], close: [5], off: -14400 }));
    expect(rows[0].date).toBe("2026-09-18");
  });
  it("close 없는 행은 버리고, 같은 날짜는 뒤의 것", () => {
    const t = Date.UTC(2026, 8, 17, 15) / 1000;
    const rows = parseChart(chart({ ts: [t, t + 60, t + 86400], close: [1, 2, null] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].close).toBe(2);
  });
  it("빈 응답은 빈 배열", () => expect(parseChart({})).toEqual([]));
});

describe("rangeStart", () => {
  it("기간 → 시작일", () => {
    expect(rangeStart("1y", "2026-09-19")).toBe("2025-09-19");
    expect(rangeStart("5y", "2026-09-19")).toBe("2021-09-19");
    expect(rangeStart("nope", "2026-09-19")).toBeNull();
  });
});

describe("D1 쿼리 (실제 SQLite)", () => {
  let env;
  const at = "2026-09-19T00:00:00+09:00";
  beforeEach(() => {
    env = { DB: makeDb() };
    const ins = env.DB.raw.prepare(
      "INSERT INTO securities (name, ticker, ysym, market, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    ins.run("삼성전자", "005930", "005930.KS", "KR", "KRW", at, at); // id 5 (지수 4개 다음)
    ins.run("엔비디아", "NVDA", "NVDA", "US", "USD", at, at); // id 6
    ins.run("관심만", "MSFT", "MSFT", "US", "USD", at, at); // id 7
    ins.run("숨김", "OLD", "OLD", "US", "USD", at, at); // id 8
    env.DB.raw.exec("UPDATE securities SET archived_at = '" + at + "' WHERE ysym = 'OLD'");
    env.DB.raw.exec(
      "INSERT INTO positions VALUES (5, 10, 50000, 'KRW', 'manual', '" + at + "'), (6, 2, 200000, 'KRW', 'manual', '" + at + "');" +
      "INSERT INTO positions VALUES (8, 1, 1, 'KRW', 'manual', '" + at + "');" +
      "INSERT INTO watchlist (security_id, added_at) VALUES (7, '" + at + "')"
    );
  });

  it("0002가 지수·환율을 등록했다", async () => {
    const r = await env.DB.prepare("SELECT ysym, asset_class FROM securities WHERE asset_class IN ('index','fx') ORDER BY id").all();
    expect(r.results.map((x) => x.ysym)).toEqual(["^KS11", "^GSPC", "KRW=X", "^TNX"]);
  });

  it("json_each upsert: 한 쿼리로 여러 행, 다시 넣으면 갱신", async () => {
    const rows = [
      { date: "2026-09-17", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, adj_close: 1.5 },
      { date: "2026-09-18", open: 2, high: 3, low: 1.5, close: 2.5, volume: 20, adj_close: 2.5 },
    ];
    await upsertPricesStmt(env, 5, rows).run();
    await upsertPricesStmt(env, 5, [{ ...rows[1], close: 9 }]).run();
    const r = await env.DB.prepare("SELECT date, close, volume FROM prices WHERE security_id = 5 ORDER BY date").all();
    expect(r.results).toEqual([{ date: "2026-09-17", close: 1.5, volume: 10 }, { date: "2026-09-18", close: 9, volume: 20 }]);
  });

  it("추적 대상: 보유+관심+지수·환율, 숨김 제외", async () => {
    const t = await trackedSecurities(env);
    expect(t.map((x) => x.ysym).sort()).toEqual(["005930.KS", "KRW=X", "MSFT", "NVDA", "^GSPC", "^KS11", "^TNX"].sort());
  });

  it("스냅샷: 날짜 이하 최신 종가 × 환율, 시장 필터", async () => {
    const p = (date, close) => ({ date, open: close, high: close, low: close, close, volume: 1, adj_close: close });
    await upsertPricesStmt(env, 5, [p("2026-09-17", 60000), p("2026-09-18", 61000)]).run();
    await upsertPricesStmt(env, 6, [p("2026-09-17", 200)]).run(); // 18일 봉 없음 → 17일 종가
    await upsertPricesStmt(env, 3, [p("2026-09-18", 1400)]).run(); // KRW=X (id 3)

    const kr = await snapshotStmt(env, "2026-09-18", "KR").run();
    expect(kr.meta.changes).toBe(1);
    await snapshotStmt(env, "2026-09-18", "ALL").run();
    const r = await env.DB.prepare("SELECT security_id, price, fx_usdkrw, value_krw FROM position_snapshots ORDER BY security_id").all();
    expect(r.results).toEqual([
      { security_id: 5, price: 61000, fx_usdkrw: 1400, value_krw: 610000 },
      { security_id: 6, price: 200, fx_usdkrw: 1400, value_krw: 560000 },
    ]);
  });

  it("환율이 없으면 달러 종목 스냅샷은 건너뛴다(0원으로 찍지 않는다)", async () => {
    const p = (date, close) => ({ date, open: close, high: close, low: close, close, volume: 1, adj_close: close });
    await upsertPricesStmt(env, 6, [p("2026-09-17", 200)]).run();
    const r = await snapshotStmt(env, "2026-09-18", "ALL").run();
    expect(r.meta.changes).toBe(0);
  });
});

describe("runDaily (야후는 가짜)", () => {
  it("국내 크론: 국내+환율만 갱신, 비어 있는 종목은 백필, 국내 스냅샷, meta 보고", async () => {
    const env = { DB: makeDb() };
    const at = "2026-09-19T00:00:00+09:00";
    env.DB.raw.prepare("INSERT INTO securities (name, ticker, ysym, market, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("삼성전자", "005930", "005930.KS", "KR", "KRW", at, at);
    env.DB.raw.exec("INSERT INTO positions VALUES (5, 10, 50000, 'KRW', 'manual', '" + at + "')");

    const calls = [];
    vi.resetModules();
    vi.doMock("../src/sources/yahoo.js", () => ({
      history: async (sym, range) => {
        calls.push(sym + ":" + range);
        return [{ date: "2026-09-18", open: 1, high: 1, low: 1, close: sym === "KRW=X" ? 1400 : 61000, volume: 1, adj_close: 1 }];
      },
    }));
    const { runDaily } = await import("../src/cron/daily.js");
    const rep = await runDaily(env, "kr", new Date("2026-09-18T07:00:00Z"));
    vi.doUnmock("../src/sources/yahoo.js");

    // 모든 종목이 이력 0행이라 앞의 2개는 5y 백필, 나머지 국내·환율은 5d
    expect(calls.filter((c) => c.endsWith(":5y"))).toHaveLength(2);
    expect(calls.some((c) => c.startsWith("^GSPC:5d"))).toBe(false);
    expect(rep.date).toBe("2026-09-18");
    expect(rep.snapshots).toBe(1);
    const meta = await env.DB.prepare("SELECT value FROM meta WHERE key = 'cron:kr'").first();
    expect(JSON.parse(meta.value).updated + JSON.parse(meta.value).backfilled).toBe(calls.length);
  });
});
