import { describe, it, expect } from "vitest";
import { horizonEnd, status, elapsed, upsideNow, returnSince, progressToTarget, performance, homeRows } from "./views.js";

const v = (o) => ({ created_at: "2026-01-31T10:00:00+09:00", horizon_months: 12, target_price: 150, price_at: 100, ...o });

describe("horizonEnd", () => {
  it("n개월 뒤, 말일 보정", () => {
    expect(horizonEnd("2026-01-31T10:00:00+09:00", 1)).toBe("2026-02-28");
    expect(horizonEnd("2026-09-19T16:00:00+09:00", 12)).toBe("2027-09-19");
    expect(horizonEnd("2027-11-30T00:00:00+09:00", 3)).toBe("2028-02-29");
  });
});

describe("status / elapsed", () => {
  it("진행 중 → 평가 대기 → 평가됨", () => {
    expect(status(v(), "2026-06-01")).toBe("in_progress");
    expect(status(v(), "2027-01-31")).toBe("awaiting");
    expect(status(v({ evaluated_at: "x" }), "2026-06-01")).toBe("evaluated");
  });
  it("경과 비율", () => {
    expect(elapsed(v(), "2026-01-31")).toBe(0);
    expect(elapsed(v(), "2030-01-01")).toBe(1);
    expect(elapsed(v({ created_at: "2026-01-01T00:00:00+09:00" }), "2026-07-02")).toBeCloseTo(0.5, 1);
  });
});

describe("가격 관련", () => {
  it("지금 상승여력, 기록 후 수익률", () => {
    expect(upsideNow(v(), 120)).toBeCloseTo(0.25);
    expect(returnSince(v(), 120)).toBeCloseTo(0.2);
    expect(upsideNow(v(), 0)).toBeNull();
  });
  it("목표까지 진행: 상향·하향 모두", () => {
    expect(progressToTarget(v(), 125)).toBeCloseTo(0.5);
    expect(progressToTarget(v({ target_price: 80 }), 90)).toBeCloseTo(0.5);
    expect(progressToTarget(v({ target_price: 80 }), 110)).toBeCloseTo(-0.5);
  });
});

describe("performance", () => {
  it("평가된 것만 지표, 진행 중·대기는 따로", () => {
    const views = [
      v({ evaluated_at: "x", hit: 1, target_return: 0.3, actual_return: 0.1, abs_error: 0.2 }),
      v({ evaluated_at: "x", hit: 0, target_return: 0.1, actual_return: -0.1, abs_error: 0.2 }),
      v({ created_at: "2026-09-01T00:00:00+09:00" }),
      v({ created_at: "2024-01-01T00:00:00+09:00" }),
    ];
    const p = performance(views, "2026-09-19");
    expect(p).toMatchObject({ n: 2, hitRate: 0.5, inProgress: 1, awaiting: 1 });
    expect(p.avgTarget).toBeCloseTo(0.2);
    expect(p.avgActual).toBeCloseTo(0);
    expect(p.mae).toBeCloseTo(0.2);
  });
  it("아무것도 없으면 null", () => {
    expect(performance([], "2026-09-19")).toMatchObject({ n: 0, hitRate: null, inProgress: 0 });
  });
});

describe("homeRows", () => {
  it("상승여력 큰 순, 의견 없는 보유는 뒤에", () => {
    const latest = [
      { security_id: 1, ysym: "A", target_price: 110, price_at: 100 },
      { security_id: 2, ysym: "B", target_price: 200, price_at: 100 },
      { security_id: 3, ysym: "C", target_price: 50, price_at: 100 },
    ];
    const held = [{ id: 2 }, { id: 9, name: "없음" }];
    const px = { A: 100, B: 100, C: 100 };
    const rows = homeRows(latest, held, (s) => px[s]);
    expect(rows.map((r) => (r.kind === "view" ? r.view.security_id : "n" + r.holding.id))).toEqual([2, 1, 3, "n9"]);
    expect(rows[0].upside).toBeCloseTo(1);
  });
  it("가격 모르는 의견은 의견 있는 것 중 맨 뒤", () => {
    const rows = homeRows([{ security_id: 1, ysym: "A", target_price: 1 }, { security_id: 2, ysym: "B", target_price: 1 }], [], (s) => (s === "B" ? 2 : null));
    expect(rows.map((r) => r.view.security_id)).toEqual([2, 1]);
  });

  it("사후 입력도 같은 성적에 센다", () => {
    const base = { horizon_months: 12, evaluated_at: "2026-09-01", hit: 1, target_return: 0.3, actual_return: 0.2, abs_error: 0.1 };
    const p = performance([
      { ...base, created_at: "2025-06-01T00:00:00+09:00" },
      { ...base, created_at: "2025-07-01T00:00:00+09:00", hit: 0, backdated: 1 },
      { created_at: "2026-09-01T00:00:00+09:00", horizon_months: 12, backdated: 1 },
    ], "2026-09-19");
    expect(p.n).toBe(2);
    expect(p.hitRate).toBe(0.5);
    expect(p.inProgress).toBe(1);     // 소급 기록도 진행 중으로 센다
    expect(p.backdated).toBeUndefined();
  });

  it("기간 중 목표가에 닿은 의견은 적중률에 바로 들어가고, 수익률·MAE는 만기 것만", () => {
    const matured = { created_at: "2025-01-01T00:00:00+09:00", horizon_months: 6, evaluated_at: "2025-07-02", hit: 0,
      target_return: 0.3, actual_return: -0.1, abs_error: 0.4 };
    const early = { created_at: "2026-08-26T00:00:00+09:00", horizon_months: 12, hit: 1, hit_date: "2026-09-21" };
    const open = { created_at: "2026-09-01T00:00:00+09:00", horizon_months: 12 };
    const p = performance([matured, early, open], "2026-09-23");
    expect(p.n).toBe(2);             // 판정 끝난 것 = 만기 1 + 조기 적중 1
    expect(p.early).toBe(1);
    expect(p.hitRate).toBe(0.5);
    expect(p.matured).toBe(1);       // 수익률·MAE 표본은 만기 것만
    expect(p.mae).toBeCloseTo(0.4);
    expect(p.inProgress).toBe(1);    // 조기 적중은 '진행 중'에서 빠진다
  });
});
