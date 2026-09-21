import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDb } from "./d1shim.js";

// 야후 시세는 가짜로. 실패 모드도 켤 수 있게.
const yahoo = { fail: false, price: 200 };
vi.mock("../src/sources/yahoo.js", () => ({
  quote: async () => {
    if (yahoo.fail) throw new Error("야후 다운");
    return { price: yahoo.price, time: "2026-09-18T20:00:00.000Z" };
  },
}));

const { createView, patchView, deleteView, latestViews, listViews } = await import("../src/routes/views.js");

const H = {};
const req = (body) => ({ json: async () => body });
const url = (q = "") => new URL("http://x/views" + q);
const body = async (res) => ({ status: res.status, ...(await res.json()) });

describe("views (실제 SQLite)", () => {
  let env;
  beforeEach(() => {
    yahoo.fail = false;
    yahoo.price = 200;
    env = { DB: makeDb() };
    const at = "2026-09-19T00:00:00+09:00";
    env.DB.raw.prepare("INSERT INTO securities (name, ticker, ysym, market, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("엔비디아", "NVDA", "NVDA", "US", "USD", at, at); // id 5
  });

  it("기록: 서버가 가격·상승여력·통화·점수를 얼린다", async () => {
    // 끝난 네 분기 (2025-09-30 ~ 2026-06-30). 아직 안 끝난 2026-09-30 추정 행은 섞여 있어도 쓰지 않는다.
    for (const [date, eps] of [["2025-09-30", 2], ["2025-12-31", 2], ["2026-03-31", 3], ["2026-06-30", 3], ["2099-09-30", 100]]) {
      env.DB.raw.prepare("INSERT INTO financials (security_id,period_end,period_type,eps,source,fetched_at,currency) VALUES (?,?,?,?,?,?,?)")
        .run(5, date, "Q", eps, "yahoo", "2026-09-19", "USD");
    }
    const r = await body(await createView(req({ security_id: 5, rating: "매수", target_price: 260, thesis: "  AI 수요\n데이터센터 " }), env, H));
    expect(r.view).toMatchObject({
      rating: "매수", rating_score: 3, target_price: 260, target_ccy: "USD", horizon_months: 12,
      price_at: 200, thesis: "AI 수요\n데이터센터", consensus_target_at: null, per_at: 20, edited_at: null, name: "엔비디아",
    });
    expect(r.view.upside_pct).toBeCloseTo(0.3);
    expect(r.view.price_at_source).toMatch(/^yahoo\(delayed\)/);
    expect(r.view.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/);
  });

  it("per_at: 빠진 분기가 있으면 null", async () => {
    for (const [date, eps] of [["2025-06-30", 2], ["2025-12-31", 2], ["2026-03-31", 3], ["2026-06-30", 3]]) {
      env.DB.raw.prepare("INSERT INTO financials (security_id,period_end,period_type,eps,source,fetched_at,currency) VALUES (?,?,?,?,?,?,?)")
        .run(5, date, "Q", eps, "yahoo", "2026-09-19", "USD");
    }
    const r = await body(await createView(req({ security_id: 5, rating: "매수", target_price: 260 }), env, H));
    expect(r.view.per_at).toBeNull();
  });

  it("야후가 죽으면 마지막 종가로, 그것도 없으면 503", async () => {
    yahoo.fail = true;
    await expect(createView(req({ security_id: 5, rating: "매수", target_price: 260 }), env, H)).rejects.toMatchObject({ status: 503 });
    env.DB.raw.exec("INSERT INTO prices (security_id, date, close) VALUES (5, '2026-09-18', 190)");
    const r = await body(await createView(req({ security_id: 5, rating: "매수", target_price: 228 }), env, H));
    expect(r.view.price_at).toBe(190);
    expect(r.view.price_at_source).toBe("close 2026-09-18");
  });

  it("검증: 등급·목표가·기간", async () => {
    await expect(createView(req({ security_id: 5, rating: "강력 매수", target_price: 1 }), env, H)).rejects.toMatchObject({ status: 400 });
    await expect(createView(req({ security_id: 5, rating: "매수", target_price: 0 }), env, H)).rejects.toMatchObject({ status: 400 });
    await expect(createView(req({ security_id: 5, rating: "매수", target_price: 1, horizon_months: 0 }), env, H)).rejects.toMatchObject({ status: 400 });
    await expect(createView(req({ security_id: 99, rating: "매수", target_price: 1 }), env, H)).rejects.toMatchObject({ status: 404 });
  });

  it("편집: edited_at, 상승여력은 기록 시점 가격 기준으로 재계산, 스냅샷은 그대로", async () => {
    const v = (await body(await createView(req({ security_id: 5, rating: "매수", target_price: 260 }), env, H))).view;
    yahoo.price = 999; // 편집 시점 시세는 쓰지 않는다
    const r = await body(await patchView(req({ target_price: 300, rating: "적극 매수", price_at: 1 }), env, H, { id: v.id }));
    expect(r.view.edited_at).toBeTruthy();
    expect(r.view.price_at).toBe(200);
    expect(r.view.rating_score).toBe(4);
    expect(r.view.upside_pct).toBeCloseTo(0.5);
  });

  it("사건 방식: 새 의견은 새 행, latest는 종목별 최신 하나", async () => {
    await createView(req({ security_id: 5, rating: "매수", target_price: 260 }), env, H);
    await new Promise((r) => setTimeout(r, 1100)); // created_at 초 단위
    await createView(req({ security_id: 5, rating: "비중 확대", target_price: 240 }), env, H);
    const all = await body(await listViews({}, env, H, {}, url("?security_id=5")));
    expect(all.views).toHaveLength(2);
    const latest = await body(await latestViews({}, env, H));
    expect(latest.views).toHaveLength(1);
    expect(latest.views[0].rating).toBe("비중 확대");
  });

  it("삭제", async () => {
    const v = (await body(await createView(req({ security_id: 5, rating: "중립", target_price: 200 }), env, H))).view;
    expect((await body(await deleteView({}, env, H, { id: v.id }))).ok).toBe(true);
    await expect(deleteView({}, env, H, { id: v.id })).rejects.toMatchObject({ status: 404 });
  });

  // ── 소급 기록 (SPEC §5.2.6) ──────────────────────────
  describe("과거 날짜로 기록", () => {
    const priceRow = env0 => env0.DB.raw.prepare("INSERT INTO prices (security_id, date, close) VALUES (?, ?, ?)");

    beforeEach(() => {
      const p = priceRow(env);
      p.run(5, "2025-06-02", 110);
      p.run(5, "2025-06-03", 120);   // 소급 기준일
      p.run(5, "2025-06-04", 130);
      p.run(5, "2026-09-18", 200);
      // 컨센서스: 소급일 이전 것만 써야 한다
      const est = env.DB.raw.prepare("INSERT INTO estimates (security_id, source, as_of, target_price) VALUES (?,?,?,?)");
      est.run(5, "yahoo", "2025-05-20", 140);
      est.run(5, "yahoo", "2026-09-15", 320);
      // 그 시점까지 끝난 네 분기 (PER 계산용). 이후 분기는 섞여도 무시돼야 한다.
      const fin = env.DB.raw.prepare("INSERT INTO financials (security_id,period_end,period_type,eps,source,fetched_at,currency) VALUES (?,?,'Q',?,'yahoo','2026-09-19','USD')");
      for (const [date, eps] of [["2024-06-30", 1], ["2024-09-30", 1], ["2024-12-31", 2], ["2025-03-31", 2], ["2026-06-30", 50]]) fin.run(5, date, eps);
    });

    it("그날 종가·그때 컨센·그때 PER로 얼리고 backdated 표시를 남긴다", async () => {
      const r = await body(await createView(req({ security_id: 5, rating: "매수", target_price: 150, as_of: "2025-06-03" }), env, H));
      expect(r.view.backdated).toBe(1);
      expect(r.view.created_at).toBe("2025-06-03T00:00:00+09:00");
      expect(r.view.price_at).toBe(120);                 // 지금 시세(200)가 아니라 그날 종가
      expect(r.view.price_at_source).toBe("close 2025-06-03");
      expect(r.view.upside_pct).toBeCloseTo(0.25, 6);    // 150 / 120 - 1
      expect(r.view.consensus_target_at).toBe(140);      // 2026년 컨센이 새어 들어오지 않는다
      expect(r.view.per_at).toBe(20);                    // 120 / (1+1+2+2)
    });

    it("휴장일은 직전 거래일 종가를 쓴다", async () => {
      const r = await body(await createView(req({ security_id: 5, rating: "보유", target_price: 130, as_of: "2025-06-07" }), env, H));
      expect(r.view.price_at).toBe(130);
      expect(r.view.price_at_source).toBe("close 2025-06-04");
    });

    it("시세가 없는 날짜는 거절한다", async () => {
      await expect(createView(req({ security_id: 5, rating: "매수", target_price: 10, as_of: "2020-01-02" }), env, H))
        .rejects.toMatchObject({ status: 400 });
    });

    it("미래 날짜는 거절한다", async () => {
      await expect(createView(req({ security_id: 5, rating: "매수", target_price: 10, as_of: "2099-01-02" }), env, H))
        .rejects.toMatchObject({ status: 400 });
    });

    it("형식이 틀리면 거절한다", async () => {
      await expect(createView(req({ security_id: 5, rating: "매수", target_price: 10, as_of: "2025/06/03" }), env, H))
        .rejects.toMatchObject({ status: 400 });
    });

    it("as_of가 없거나 오늘이면 평소대로 지금 시세로 기록한다", async () => {
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
      const r = await body(await createView(req({ security_id: 5, rating: "매수", target_price: 260, as_of: today }), env, H));
      expect(r.view.backdated).toBe(0);
      expect(r.view.price_at).toBe(200);
      expect(r.view.price_at_source).toMatch(/^yahoo\(delayed\)/);
    });
  });
});
