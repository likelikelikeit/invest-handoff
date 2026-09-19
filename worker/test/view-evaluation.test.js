import { describe, it, expect, beforeEach } from "vitest";
import { makeDb } from "./d1shim.js";
import { evaluateViews, horizonEnd } from "../src/lib/view-evaluation.js";

describe("투자의견 사후평가", () => {
  let env;
  beforeEach(() => {
    env = { DB: makeDb() };
    const at = "2025-01-31T09:00:00+09:00";
    env.DB.raw.prepare("INSERT INTO securities (name,ticker,ysym,market,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("테스트", "T", "T", "US", "USD", at, at);
  });

  it("말일을 보정한다", () => expect(horizonEnd("2025-01-31T09:00:00+09:00", 1)).toBe("2025-02-28"));

  it("상향 목표의 기간 중 적중과 만기 종가 수익률을 채운다", async () => {
    env.DB.raw.exec(
      "INSERT INTO views (security_id,created_at,rating,rating_score,target_price,target_ccy,horizon_months,price_at,upside_pct) " +
      "VALUES (5,'2025-01-31T09:00:00+09:00','매수',3,120,'USD',1,100,.2);" +
      "INSERT INTO prices (security_id,date,open,high,low,close) VALUES " +
      "(5,'2025-02-03',100,110,95,105),(5,'2025-02-14',110,121,108,118),(5,'2025-02-28',118,119,112,115)"
    );
    expect(await evaluateViews(env, new Date("2025-03-01T00:00:00Z"))).toBe(1);
    const v = await env.DB.prepare("SELECT hit,hit_date,price_at_horizon,actual_return,target_return,abs_error FROM views WHERE id=1").first();
    expect(v.hit).toBe(1);
    expect(v.hit_date).toBe("2025-02-14");
    expect(v.price_at_horizon).toBe(115);
    expect(v.actual_return).toBeCloseTo(.15);
    expect(v.target_return).toBeCloseTo(.2);
    expect(v.abs_error).toBeCloseTo(.05);
  });

  it("하향 목표 미달은 hit 0, 미래 의견은 평가하지 않는다", async () => {
    env.DB.raw.exec(
      "INSERT INTO views (security_id,created_at,rating,rating_score,target_price,target_ccy,horizon_months,price_at,upside_pct) VALUES " +
      "(5,'2025-01-01T09:00:00+09:00','매도',-2,80,'USD',1,100,-.2)," +
      "(5,'2025-02-20T09:00:00+09:00','매수',3,120,'USD',12,100,.2);" +
      "INSERT INTO prices (security_id,date,open,high,low,close) VALUES (5,'2025-02-01',100,105,85,90)"
    );
    expect(await evaluateViews(env, new Date("2025-03-01T00:00:00Z"))).toBe(1);
    const { results } = await env.DB.prepare("SELECT hit,evaluated_at FROM views ORDER BY id").all();
    expect(results[0].hit).toBe(0);
    expect(results[1].evaluated_at).toBeNull();
  });
});
