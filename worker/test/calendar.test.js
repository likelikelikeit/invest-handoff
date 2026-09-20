import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDb } from "./d1shim.js";
import { parseFred } from "../src/sources/fred.js";
import { parseEcos, ecosDate } from "../src/sources/ecos.js";

const fake = { earnings: { NVDA: "2026-11-17" }, fredFail: false };
vi.mock("../src/sources/yahoo.js", () => ({
  yahooEarningsDate: async (env, sym) => {
    if (fake.earnings[sym] instanceof Error) throw fake.earnings[sym];
    return fake.earnings[sym] ?? null;
  },
}));
vi.mock("../src/sources/fred.js", async (orig) => ({
  ...(await orig()),
  fredSeries: async (key, id) => {
    if (fake.fredFail) throw new Error("FRED_API_KEY가 없습니다");
    const values = id === "DGS2" ? [3.61, 3.58]
      : id === "DFEDTARL" ? [3.5, 3.75]
      : id === "DFEDTARU" ? [3.75, 4.0]
      : [4.1, 4.12];
    return [{ date: "2026-09-17", value: values[0] }, { date: "2026-09-18", value: values[1] }];
  },
}));
vi.mock("../src/sources/ecos.js", async (orig) => ({
  ...(await orig()),
  ecosSeries: async () => [{ date: "2026-08-01", value: 2.5 }, { date: "2026-09-01", value: 2.5 }],
}));

const { listEvents, createEvent, deleteEvent, getMacro, saveDots } = await import("../src/routes/calendar.js");
const { runMisc, isEarningsUnavailable } = await import("../src/cron/misc.js");

const H = {};
const req = (b) => ({ json: async () => b });
const url = (q) => new URL("http://x" + q);
const body = async (r) => (await r).json();

describe("FRED / ECOS 파서", () => {
  it("FRED 결측('.')은 뺀다", () => {
    expect(parseFred({ observations: [{ date: "2026-09-17", value: "3.61" }, { date: "2026-09-18", value: "." }] }))
      .toEqual([{ date: "2026-09-17", value: 3.61 }]);
  });
  it("ECOS 날짜·오류·데이터 없음", () => {
    expect(ecosDate("20260919")).toBe("2026-09-19");
    expect(ecosDate("202609")).toBe("2026-09-01");
    expect(parseEcos({ StatisticSearch: { row: [{ TIME: "202609", DATA_VALUE: "2.50" }] } })).toEqual([{ date: "2026-09-01", value: 2.5 }]);
    expect(parseEcos({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } })).toEqual([]);
    expect(() => parseEcos({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다." } })).toThrow(/INFO-100/);
  });
});

describe("일정·거시 (실제 SQLite)", () => {
  let env;
  beforeEach(() => {
    fake.fredFail = false;
    fake.earnings = { NVDA: "2026-11-17" };
    env = { DB: makeDb(), FRED_API_KEY: "k", ECOS_API_KEY: "k" };
    const at = "2026-09-19T00:00:00+09:00";
    env.DB.raw.prepare("INSERT INTO securities (name, ticker, ysym, market, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("엔비디아", "NVDA", "NVDA", "US", "USD", at, at); // 5
    env.DB.raw.exec("INSERT INTO positions VALUES (5, 1, 1, 'KRW', 'manual', '" + at + "')");
  });

  it("거시 시드: 시리즈 6개, 일정 30개, 0005를 다시 돌려도 중복 없음", () => {
    expect(env.DB.raw.prepare("SELECT COUNT(*) n FROM macro_series").get().n).toBe(6);
    expect(env.DB.raw.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'macro'").get().n).toBe(30);
    const sql = require("node:fs").readFileSync(new URL("../migrations/0005_macro_calendar.sql", import.meta.url), "utf8");
    env.DB.raw.exec(sql);
    expect(env.DB.raw.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'macro'").get().n).toBe(30);
    const oct = env.DB.raw.prepare("SELECT date, time, title FROM events WHERE title LIKE 'FOMC%' AND date LIKE '2026-10%'").get();
    expect(oct).toEqual({ date: "2026-10-29", time: "03:00", title: "FOMC 금리 결정" }); // 10/28 14:00 EDT
  });

  it("기간 조회, 직접 추가·삭제, 자동 일정은 못 지움", async () => {
    const e = await body(createEvent(req({ date: "2026-10-05", time: "16:00", title: "삼성전자 잠정실적" }), env, H));
    expect(e.event).toMatchObject({ kind: "custom", source: "manual" });
    const list = await body(listEvents({}, env, H, {}, url("/events?from=2026-10-01&to=2026-10-31")));
    expect(list.events.map((x) => x.title)).toEqual(["미국 고용보고서 (9월)", "삼성전자 잠정실적", "미국 CPI (9월)", "금통위 기준금리 결정", "FOMC 금리 결정"]);
    await deleteEvent({}, env, H, { id: e.event.id });
    env.DB.raw.exec("INSERT INTO events (date, kind, security_id, title, source, created_at) VALUES ('2026-11-17','earnings',5,'실적 발표 예정','yahoo','x')");
    const auto = env.DB.raw.prepare("SELECT id FROM events WHERE source='yahoo'").get().id;
    await expect(deleteEvent({}, env, H, { id: auto })).rejects.toMatchObject({ status: 409 });
    await expect(createEvent(req({ date: "2026/10/05", title: "x" }), env, H)).rejects.toMatchObject({ status: 400 });
    await expect(createEvent(req({ date: "2026-10-05", title: "x", kind: "earnings" }), env, H)).rejects.toMatchObject({ status: 400 });
  });

  it("크론: 거시 저장, 어닝일은 바뀌면 옛 미래 날짜를 지우고 교체", async () => {
    env.DB.raw.exec("INSERT INTO events (date, kind, security_id, title, source, created_at) VALUES ('2026-11-10','earnings',5,'실적 발표 예정','yahoo','x')");
    const rep = await runMisc(env, new Date("2026-09-19T23:30:00Z"));
    expect(rep.macro).toEqual({
      BOK_BASE: 2, DGS10: 2, DGS2: 2, FEDFUNDS: 2,
      FED_TARGET_LOWER: 2, FED_TARGET_UPPER: 2,
    });
    expect(rep.earnings).toBe(1);
    const earn = env.DB.raw.prepare("SELECT date FROM events WHERE kind='earnings' ORDER BY date").all().map((r) => r.date);
    expect(earn).toEqual(["2026-11-17"]);
    const m = await body(getMacro({}, env, H, {}, url("/macro?from=2026-01-01")));
    expect(m.series.DGS2.points).toEqual([["2026-09-17", 3.61], ["2026-09-18", 3.58]]);
    expect(m.cron.earnings).toBe(1);
  });

  it("크론: 소스 하나가 실패해도 나머지는 저장, 이유는 보고", async () => {
    fake.fredFail = true;
    const rep = await runMisc(env, new Date("2026-09-19T23:30:00Z"));
    expect(rep.macro.BOK_BASE).toBe(2);
    expect(rep.errors.filter((e) => e.includes("FRED_API_KEY"))).toHaveLength(5);
  });

  it("어닝일이 없는 ETF의 Yahoo 404는 조용히 건너뛴다", async () => {
    const at = "2026-09-19T00:00:00+09:00";
    env.DB.raw.prepare("INSERT INTO securities (name, ticker, ysym, market, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("SOXL", "SOXL", "SOXL", "US", "USD", at, at);
    env.DB.raw.exec("INSERT INTO positions VALUES (6, 1, 1, 'KRW', 'manual', '" + at + "')");
    fake.earnings.SOXL = new Error("야후 재무가 404 응답");
    const rep = await runMisc(env, new Date("2026-09-19T23:30:00Z"));
    expect(rep.earnings).toBe(1);
    expect(rep.errors.some((e) => e.includes("SOXL"))).toBe(false);
    expect(isEarningsUnavailable(fake.earnings.SOXL)).toBe(true);
  });

  it("점도표: 저장하면 최신 것이 조회되고, 다시 저장하면 교체", async () => {
    await saveDots(req({ sep: "2026-06", medians: { 2026: 3.9, 2027: 3.4 } }), env, H);
    await saveDots(req({ sep: "2026-09", medians: { 2026: 3.625, 2027: 3.375, 2028: 3.125 }, long_run: 3 }), env, H);
    await saveDots(req({ sep: "2026-09", medians: { 2026: 3.625, 2027: 3.125 }, long_run: 3 }), env, H);
    const m = await body(getMacro({}, env, H, {}, url("/macro")));
    expect(m.dots).toEqual({ sep: "2026-09", points: [["2026-12-31", 3.625], ["2027-12-31", 3.125]], long_run: 3 });
    await expect(saveDots(req({ sep: "2026-9", medians: { 2026: 3 } }), env, H)).rejects.toMatchObject({ status: 400 });
    await expect(saveDots(req({ sep: "2026-09", medians: { 2026: "많이" } }), env, H)).rejects.toMatchObject({ status: 400 });
  });
});
