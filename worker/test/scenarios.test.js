import { describe, it, expect, beforeEach } from "vitest";
import { makeDb } from "./d1shim.js";
import { impliedTarget, perAt } from "../src/lib/valuation.js";
import { listValuationScenarios, saveValuationScenario, deleteValuationScenario } from "../src/routes/scenarios.js";

const H = {};
const req = (body) => ({ json: async () => body });
const body = async (res) => ({ status: res.status, ...(await res.json()) });

describe("밸류에이션 계산", () => {
  it("주당 지표와 EV/EBITDA 목표가를 계산한다", () => {
    expect(impliedTarget({ metric: "per", value: 10, multiple: 20 })).toBe(200);
    expect(impliedTarget({ metric: "pbr", value: 80, multiple: 1.5 })).toBe(120);
    expect(impliedTarget({ metric: "ev_ebitda", value: 1000, multiple: 8, net_debt: 2000, shares: 100 })).toBe(60);
  });
});

describe("종목 시나리오 (실제 SQLite)", () => {
  let env;
  beforeEach(() => {
    env = { DB: makeDb() };
    const at = "2026-09-19T00:00:00+09:00";
    env.DB.raw.prepare("INSERT INTO securities (name,ticker,ysym,market,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("엔비디아", "NVDA", "NVDA", "US", "USD", at, at);
  });

  it("bear/base/bull을 저장하고 같은 이름은 갱신한다", async () => {
    const one = await body(await saveValuationScenario(req({
      security_id: 5, name: "base", assumptions: { metric: "per", value: 10, multiple: 20, growth_pct: 25, horizon_years: 1 },
    }), env, H));
    expect(one.scenario.implied_target).toBe(200);
    expect(one.scenario.assumptions.growth_pct).toBe(25);

    const two = await body(await saveValuationScenario(req({
      security_id: 5, name: "base", assumptions: { metric: "per", value: 12, multiple: 22, growth_pct: 30, horizon_years: 1 },
    }), env, H));
    expect(two.scenario.id).toBe(one.scenario.id);
    expect(two.scenario.implied_target).toBe(264);

    const listed = await body(await listValuationScenarios({}, env, H, {}, new URL("http://x/scenarios?security_id=5")));
    expect(listed.scenarios).toHaveLength(1);
    expect(listed.scenarios[0].assumptions.value).toBe(12);
    expect((await body(await deleteValuationScenario({}, env, H, { id: one.scenario.id }))).ok).toBe(true);
  });

  it("잘못된 지표·배수·미래 구간을 거부한다", async () => {
    await expect(saveValuationScenario(req({ security_id: 5, name: "base", assumptions: { metric: "pe", value: 1, multiple: 2 } }), env, H))
      .rejects.toMatchObject({ status: 400 });
    await expect(saveValuationScenario(req({ security_id: 5, name: "base", assumptions: { metric: "per", value: 1, multiple: 0 } }), env, H))
      .rejects.toMatchObject({ status: 400 });
    await expect(saveValuationScenario(req({ security_id: 5, name: "base", assumptions: { metric: "per", value: 1, multiple: 2, horizon_years: 3 } }), env, H))
      .rejects.toMatchObject({ status: 400 });
  });

  it("최근 네 분기 EPS로 의견 시점 PER를 계산한다", async () => {
    for (const [date, eps] of [["2025-12-31", 1], ["2026-03-31", 2], ["2026-06-30", 3], ["2026-09-30", 4]]) {
      env.DB.raw.prepare("INSERT INTO financials (security_id,period_end,period_type,eps,source,fetched_at) VALUES (?,?,?,?,?,?)")
        .run(5, date, "Q", eps, "yahoo", "2026-09-19");
    }
    // 2026-09-30 분기가 끝난 뒤의 날짜로 고정 (실행 날짜에 따라 결과가 바뀌지 않게)
    expect(await perAt(env, 5, 200, "2026-10-15")).toBe(20);
    expect(await perAt(env, 5, 200, "2026-09-19")).toBeNull(); // 그날엔 아직 세 분기뿐
  });
});
