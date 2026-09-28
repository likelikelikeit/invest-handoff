import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDb } from "./d1shim.js";

vi.mock("../src/sources/yahoo.js", () => ({ quote: async () => ({ price: 90, time: "2026-09-28T20:00:00.000Z" }) }));

const { createSuspension, deleteSuspension, listSuspensions, suspendCoverage } = await import("../src/routes/coverage.js");
const { latestViews, listViews, deleteView } = await import("../src/routes/views.js");
const { evaluateViews } = await import("../src/lib/view-evaluation.js");
const { applyDraft } = await import("../src/routes/drafts.js");

const H = {};
const req = (body) => ({ json: async () => body });
const body = async (res) => ({ status: res.status, ...(await res.json()) });
const url = (q = "") => new URL("http://x/coverage/suspensions" + q);

let env;
let sid;

function view(createdAt, target, priceAt = 100, extra = "") {
  return env.DB.raw.prepare(
    "INSERT INTO views (security_id, created_at, rating, rating_score, target_price, target_ccy, horizon_months, price_at, upside_pct" + (extra ? ", " + extra : "") + ") " +
    "VALUES (?, ?, '매수', 3, ?, 'USD', 12, ?, ?" + (extra ? ", 1" : "") + ") RETURNING id"
  ).get(sid, createdAt, target, priceAt, target / priceAt - 1).id;
}
const row = (id) => env.DB.raw.prepare("SELECT * FROM views WHERE id = ?").get(id);
const price = (date, close, high = close, low = close) =>
  env.DB.raw.prepare("INSERT INTO prices (security_id, date, close, high, low) VALUES (?, ?, ?, ?, ?)").run(sid, date, close, high, low);

beforeEach(() => {
  env = { DB: makeDb() };
  const at = "2026-01-01T00:00:00+09:00";
  sid = env.DB.raw.prepare(
    "INSERT INTO securities (name, ticker, ysym, market, currency, asset_class, created_at, updated_at) VALUES ('AMD','AMD','AMD','US','USD','equity',?,?) RETURNING id"
  ).get(at, at).id;
});

describe("커버리지 중단", () => {
  it("최신 의견을 철회하고 그때 가격을 얼린다. 현재 의견 목록에서 빠지고 suspended로 온다", async () => {
    const old = view("2026-01-10T09:00:00+09:00", 150);
    const cur = view("2026-03-10T09:00:00+09:00", 160);
    price("2026-03-11", 100, 110, 95);

    const r = await body(await createSuspension(req({ security_id: sid, reasons: ["사업구조 변화"], memo: "M&A 이후 판단 유보" }), env, H));
    expect(r.suspension).toMatchObject({ view_id: cur, price_at: 90, reasons: ["사업구조 변화"], memo: "M&A 이후 판단 유보", target_price: 160 });
    expect(row(cur).withdrawn_at).toBeTruthy();
    expect(row(old).withdrawn_at).toBeNull();            // 업데이트로 밀려난 의견은 그대로 만기 평가

    const latest = await body(await latestViews({}, env, H));
    expect(latest.views).toHaveLength(0);
    expect(latest.suspended.map((c) => c.security_id)).toEqual([sid]);

    const all = await body(await listViews({}, env, H, {}, new URL("http://x/views")));
    expect(all.views.find((v) => v.id === cur).withdrawn_price).toBe(90);
  });

  it("중단일까지 목표가에 닿았으면 적중으로 확정하고 철회하지 않는다", async () => {
    const id = view("2026-03-10T09:00:00+09:00", 120);
    price("2026-04-01", 118, 121, 110);
    const r = await body(await createSuspension(req({ security_id: sid }), env, H));
    expect(r.suspension.view_id).toBeNull();
    expect(row(id)).toMatchObject({ hit: 1, hit_date: "2026-04-01", withdrawn_at: null });
  });

  it("목표 기간이 끝난 의견은 철회하지 않는다", async () => {
    const id = view("2024-01-10T09:00:00+09:00", 200);
    const r = await body(await createSuspension(req({ security_id: sid }), env, H));
    expect(r.suspension.view_id).toBeNull();
    expect(row(id).withdrawn_at).toBeNull();
  });

  it("의견이 없거나 이미 중단했으면 거절, 새 의견을 쓰면 재개", async () => {
    await expect(createSuspension(req({ security_id: sid }), env, H)).rejects.toMatchObject({ status: 400 });
    view("2026-03-10T09:00:00+09:00", 160);
    await createSuspension(req({ security_id: sid }), env, H);
    await expect(createSuspension(req({ security_id: sid }), env, H)).rejects.toMatchObject({ status: 409 });

    view("2099-01-01T09:00:00+09:00", 170);              // 재개 = 새 의견
    const latest = await body(await latestViews({}, env, H));
    expect(latest.views).toHaveLength(1);
    expect(latest.suspended).toHaveLength(0);
  });

  it("사유는 고정 태그만", async () => {
    view("2026-03-10T09:00:00+09:00", 160);
    await expect(createSuspension(req({ security_id: sid, reasons: ["그냥"] }), env, H)).rejects.toMatchObject({ status: 400 });
  });

  it("중단을 지우면 철회도 풀린다", async () => {
    const id = view("2026-03-10T09:00:00+09:00", 160);
    const r = await body(await createSuspension(req({ security_id: sid }), env, H));
    await deleteSuspension({}, env, H, { id: r.suspension.id });
    expect(row(id).withdrawn_at).toBeNull();
    expect((await body(await listSuspensions({}, env, H, {}, url("?security_id=" + sid)))).suspensions).toHaveLength(0);
  });

  it("철회된 의견은 크론이 평가하지 않는다", async () => {
    const id = view("2025-01-10T09:00:00+09:00", 300);
    await suspendCoverage(env, { securityId: sid, createdAt: "2025-06-01T09:00:00+09:00", reasons: [], memo: null, snapshot: null });
    price("2025-12-30", 100);
    await evaluateViews(env, new Date("2026-09-28T00:00:00Z"));
    expect(row(id).evaluated_at).toBeNull();
  });

  it("의견을 지우면 중단 기록은 남고 연결만 끊긴다", async () => {
    const id = view("2026-03-10T09:00:00+09:00", 160);
    const r = await body(await createSuspension(req({ security_id: sid }), env, H));
    await deleteView({}, env, H, { id });
    const list = (await body(await listSuspensions({}, env, H, {}, url()))).suspensions;
    expect(list.map((c) => [c.id, c.view_id])).toEqual([[r.suspension.id, null]]);
  });

  it("MCP 초안: 제출 시각과 그때 종가로 중단한다. 그 뒤에 새 의견이 있으면 거절", async () => {
    const cur = view("2026-03-10T09:00:00+09:00", 160);
    const draft = (at) => env.DB.raw.prepare(
      "INSERT INTO import_drafts (kind, source, client_name, proposed_at, payload) VALUES ('suspend','mcp','Claude',?,?) RETURNING id"
    ).get(at, JSON.stringify({ security_id: sid, reasons: ["정보 부족"], memo: "가이던스 철회", snapshot: { price: 95, source: "close 2026-05-01" } })).id;

    const r = await body(await applyDraft(req({}), env, H, { id: draft("2026-05-02T01:00:00.000Z") }));
    expect(r.suspension).toMatchObject({ created_at: "2026-05-02T10:00:00+09:00", price_at: 95, view_id: cur, reasons: ["정보 부족"] });
    expect(row(cur).withdrawn_at).toBe("2026-05-02T10:00:00+09:00");

    view("2026-06-01T09:00:00+09:00", 170);
    await expect(applyDraft(req({}), env, H, { id: draft("2026-05-20T01:00:00.000Z") })).rejects.toMatchObject({ status: 409 });
  });
});
