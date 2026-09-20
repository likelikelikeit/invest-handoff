import { describe, it, expect, beforeEach } from "vitest";
import { TOOL_BY_NAME } from "../src/mcp.js";
import { seed, env as makeEnv, dayAgo } from "./seed.js";

let env;
const ctx = { clientId: "mcp_x", clientName: "Claude" };
const run = (name, args = {}) => TOOL_BY_NAME.get(name).run(env, args, ctx);
const drafts = () => env.DB.raw.prepare("SELECT * FROM import_drafts ORDER BY id").all();

beforeEach(() => {
  env = makeEnv(seed().db);
});

describe("submit_portfolio_import", () => {
  it("초안만 만들고 실제 보유는 건드리지 않는다", async () => {
    const before = env.DB.raw.prepare("SELECT security_id, qty FROM positions ORDER BY security_id").all();
    const r = await run("submit_portfolio_import", {
      rows: [
        { name: "엔비디아", ticker: "NVDA", currency: "USD", qty: 12, avg_price: 105 },
        { name: "테슬라", ticker: "TSLA", currency: "USD", market_value: 3000000 },
      ],
      cash: [{ currency: "KRW", amount: 2500000 }],
      note: "카카오페이증권 보유 화면",
    });

    expect(r.status).toBe("pending");
    expect(r.rows).toBe(2);
    expect(r.new_securities).toEqual(["테슬라"]); // 엔비디아는 이미 등록돼 있다
    expect(r.cash).toBe(1);
    expect(r.next).toContain("앱");

    const after = env.DB.raw.prepare("SELECT security_id, qty FROM positions ORDER BY security_id").all();
    expect(after).toEqual(before);

    const [d] = drafts();
    expect(d.kind).toBe("portfolio");
    expect(d.status).toBe("pending");
    expect(d.client_name).toBe("Claude");
    expect(d.note).toBe("카카오페이증권 보유 화면");
    // 앱의 normalize가 읽는 모양으로 저장한다
    const payload = JSON.parse(d.payload);
    expect(payload.rows[0]).toMatchObject({ name: "엔비디아", tick: "NVDA", qty: 12, avgPrice: 105 });
    expect(payload.rows[1].marketValue).toBe(3000000);
    expect(payload.cash).toEqual([{ currency: "KRW", amount: 2500000 }]);
  });

  it("수량도 평가금액도 없는 줄은 막는다", async () => {
    await expect(run("submit_portfolio_import", { rows: [{ name: "이름만" }] })).rejects.toThrow(/평가금액/);
    expect(drafts()).toHaveLength(0);
  });

  it("빈 rows는 막는다", async () => {
    await expect(run("submit_portfolio_import", { rows: [] })).rejects.toThrow(/비어/);
  });

  it("문자열로 온 숫자도 받아 준다(콤마·단위 제거)", async () => {
    await run("submit_portfolio_import", { rows: [{ name: "삼성전자", ticker: "005930", qty: "1,234", avg_price: "60,500원" }] });
    const payload = JSON.parse(drafts()[0].payload);
    expect(payload.rows[0].qty).toBe(1234);
    expect(payload.rows[0].avgPrice).toBe(60500);
  });
});

describe("add_investment_view", () => {
  it("제출 시점의 가격·컨센서스를 얼려서 초안으로 넣는다", async () => {
    const r = await run("add_investment_view", {
      ticker: "NVDA", rating: "매수", target_price: 150, horizon_months: 6,
      thesis: "추론 수요", risks: "경쟁 심화",
    });

    expect(r.status).toBe("pending");
    expect(r.security).toBe("엔비디아(NVDA)");
    expect(r.frozen.price_at).toBeCloseTo(120, 6);
    expect(r.frozen.price_basis).toBe("close " + dayAgo(0));
    expect(r.frozen.upside_pct).toBe(25); // 150 / 120 - 1
    expect(r.frozen.consensus_target_at).toBe(160);
    expect(r.frozen.per_at).toBeCloseTo(26.09, 2);
    expect(Date.parse(r.frozen.proposed_at)).toBeLessThanOrEqual(Date.now());

    // 의견 테이블은 아직 그대로
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM views").get().n).toBe(3);
    const [d] = drafts();
    expect(d.kind).toBe("view");
    expect(JSON.parse(d.payload)).toMatchObject({
      ticker: "NVDA", rating: "매수", target_price: 150, horizon_months: 6, thesis: "추론 수요",
      snapshot: { source: "close " + dayAgo(0) },
    });
  });

  it("등급·목표가·기간을 검증한다", async () => {
    await expect(run("add_investment_view", { ticker: "NVDA", rating: "강추", target_price: 150 })).rejects.toThrow(/적극 매수/);
    await expect(run("add_investment_view", { ticker: "NVDA", rating: "매수", target_price: 0 })).rejects.toThrow(/0보다/);
    await expect(run("add_investment_view", { ticker: "NVDA", rating: "매수", target_price: 1, horizon_months: 99 }))
      .rejects.toThrow(/1~60/);
    expect(drafts()).toHaveLength(0);
  });

  it("가격이 없는 종목은 상승여력을 얼릴 수 없어 거부한다", async () => {
    env.DB.raw.prepare(
      "INSERT INTO securities (name, ticker, ysym, market, currency, asset_class, created_at, updated_at) " +
      "VALUES ('신규상장', 'NEW', 'NEW', 'US', 'USD', 'equity', '2026-09-01', '2026-09-01')"
    ).run();
    await expect(run("add_investment_view", { ticker: "NEW", rating: "매수", target_price: 10 })).rejects.toThrow(/가격이 없어/);
  });
});

describe("get_pending_drafts", () => {
  it("대기 중인 제안만 요약해서 보여준다", async () => {
    await run("submit_portfolio_import", { rows: [{ name: "엔비디아", qty: 1 }] });
    await run("add_investment_view", { ticker: "005930", rating: "보유", target_price: 80000 });
    env.DB.raw.prepare("UPDATE import_drafts SET status = 'applied' WHERE id = 1").run();

    const r = await run("get_pending_drafts");
    expect(r.count).toBe(1);
    expect(r.drafts[0].kind).toBe("view");
    expect(r.drafts[0].summary).toBe("삼성전자 보유 목표가 80000");
    expect(r.drafts[0].from).toBe("Claude");
  });
});
