import { describe, it, expect } from "vitest";
import { makeDb } from "./d1shim.js";
import { deriveQ4 } from "../src/sources/dart.js";
import { dartBackfillTarget, DART_MIN_QUARTERS } from "../src/cron/daily.js";

const q = (end, type, v) => ({
  period_end: end, period_type: type, source: "dart",
  revenue: v.rev, operating_income: v.op, net_income: v.net, eps: v.eps, net_debt: v.nd ?? null,
});

describe("deriveQ4", () => {
  it("4분기 = 연간 − (1·2·3분기), 기말 잔액은 연간 값", () => {
    const rows = [
      q("2025-03-31", "Q", { rev: 10, op: 2, net: 1, eps: 100 }),
      q("2025-06-30", "Q", { rev: 11, op: 3, net: 2, eps: 200 }),
      q("2025-09-30", "Q", { rev: 12, op: 4, net: 3, eps: 300 }),
      q("2025-12-31", "FY", { rev: 50, op: 14, net: 9, eps: 950, nd: 77 }),
    ];
    const [q4] = deriveQ4(rows);
    expect(q4).toMatchObject({ period_end: "2025-12-31", period_type: "Q", revenue: 17, operating_income: 5, net_income: 3, eps: 350, net_debt: 77 });
  });
  it("분기가 하나라도 없으면 만들지 않고, 항목이 비면 그 항목만 null", () => {
    expect(deriveQ4([q("2025-12-31", "FY", { rev: 50 }), q("2025-03-31", "Q", { rev: 10 })])).toEqual([]);
    const rows = ["03-31", "06-30", "09-30"].map((d) => q("2025-" + d, "Q", { rev: 10, eps: null }))
      .concat(q("2025-12-31", "FY", { rev: 40, eps: 5 }));
    const [q4] = deriveQ4(rows);
    expect(q4.revenue).toBe(10);
    expect(q4.eps).toBeNull();
  });
});

describe("dartBackfillTarget (실제 SQLite)", () => {
  function setup() {
    const env = { DB: makeDb(), DART_API_KEY: "x" };
    const at = "2026-09-19T00:00:00+09:00";
    const ins = env.DB.raw.prepare("INSERT INTO securities (name, ticker, ysym, market, currency, dart_corp_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)");
    ins.run("하이닉스", "000660", "000660.KS", "KR", "KRW", "00164779", at, at); // 5
    ins.run("번호없음", "999999", "999999.KS", "KR", "KRW", null, at, at); // 6
    ins.run("관심만", "352820", "352820.KS", "KR", "KRW", "01204056", at, at); // 7
    env.DB.raw.exec("INSERT INTO positions VALUES (5, 1, 1, 'KRW', 'manual', '" + at + "'), (6, 1, 1, 'KRW', 'manual', '" + at + "')");
    env.DB.raw.exec("INSERT INTO watchlist (security_id, added_at) VALUES (7, '" + at + "')");
    return env;
  }
  const now = new Date("2026-09-21T07:00:00Z");

  it("고유번호 있고 DART 분기가 부족한 종목 중 가장 적은 것", async () => {
    const env = setup();
    for (let i = 0; i < 3; i++) env.DB.raw.exec(`INSERT INTO financials (security_id, period_end, period_type, source, fetched_at) VALUES (5, '202${i}-03-31', 'Q', 'dart', 'x')`);
    expect((await dartBackfillTarget(env, now)).ticker).toBe("352820");
  });
  it("충분하면 대상 아님, 키 없으면 null", async () => {
    const env = setup();
    for (const id of [5, 7]) for (let i = 0; i < DART_MIN_QUARTERS; i++) {
      env.DB.raw.exec(`INSERT INTO financials (security_id, period_end, period_type, source, fetched_at) VALUES (${id}, '20${10 + i}-03-31', 'Q', 'dart', 'x')`);
    }
    expect(await dartBackfillTarget(env, now)).toBeNull();
    expect(await dartBackfillTarget({ ...setup(), DART_API_KEY: undefined }, now)).toBeNull();
  });
  it("3일 안에 시도한 종목은 건너뛴다", async () => {
    const env = setup();
    env.DB.raw.exec("INSERT INTO meta (key, value, updated_at) VALUES ('dart:tried:5', '2026-09-20', 'x'), ('dart:tried:7', '2026-09-10', 'x')");
    expect((await dartBackfillTarget(env, now)).ticker).toBe("352820");
    env.DB.raw.exec("UPDATE meta SET value = '2026-09-20' WHERE key = 'dart:tried:7'");
    expect(await dartBackfillTarget(env, now)).toBeNull();
  });
});
