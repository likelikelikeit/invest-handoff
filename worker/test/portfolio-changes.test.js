import { describe, it, expect, beforeEach } from "vitest";
import { makeDb } from "./d1shim.js";
import { qtyChanged, mergeRows } from "../src/routes/portfolio.js";

describe("수량 변화 판정", () => {
  it("역산 찌꺼기는 변화로 보지 않는다", () => {
    expect(qtyChanged(15.999968, 16)).toBe(false);
    expect(qtyChanged(6.000007, 6)).toBe(false);
    expect(qtyChanged(0.999994, 1)).toBe(false);
  });

  it("진짜 매매는 잡는다", () => {
    expect(qtyChanged(16, 17)).toBe(true);
    expect(qtyChanged(0, 1)).toBe(true);
    expect(qtyChanged(1, 0)).toBe(true);
    expect(qtyChanged(4.134, 4.2)).toBe(true);     // 소수점 추가 매수
    expect(qtyChanged(0.065, 0.066)).toBe(true);
  });
});

describe("merge 후 변화 기록", () => {
  let env;
  const row = (qty) => ({ name: "쿠팡", ticker: "CPNG", ysym: "CPNG", market: "US", currency: "USD", qty, avg_price: 25 });

  beforeEach(async () => {
    env = { DB: makeDb() };
    await mergeRows(env, [row(15.999968)], true);
    env.DB.raw.prepare("DELETE FROM position_changes").run(); // 최초 등록 기록은 지우고 시작
  });

  it("찌꺼기만큼 달라진 재등록은 질문을 만들지 않는다 (수량은 정리됨)", async () => {
    const r = await mergeRows(env, [row(16)], true);
    expect(r.changes).toHaveLength(0);
    expect(env.DB.raw.prepare("SELECT qty FROM positions").get().qty).toBe(16);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM position_changes").get().n).toBe(0);
  });

  it("한 주 늘면 질문을 만든다", async () => {
    const r = await mergeRows(env, [row(17)], true);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ qty_before: 15.999968, qty_after: 17 });
  });
});
