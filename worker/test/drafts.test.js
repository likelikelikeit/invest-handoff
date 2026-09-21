import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeDb } from "./d1shim.js";

vi.mock("../src/sources/yahoo.js", () => ({ quote: async () => ({ price: 130, time: "2026-09-19T20:00:00.000Z" }) }));

const { listDrafts, applyDraft, discardDraft } = await import("../src/routes/drafts.js");

const H = {};
const req = (body) => ({ json: async () => body });
const url = (q = "") => new URL("http://x/drafts" + q);
const body = async (res) => ({ status: res.status, ...(await res.json()) });

let env;
let ids;

function insertDraft(kind, payload, proposedAt = "2026-09-20T11:00:00.000Z") {
  return env.DB.raw.prepare(
    "INSERT INTO import_drafts (kind, source, client_name, proposed_at, payload) VALUES (?, 'mcp', 'Claude', ?, ?) RETURNING id"
  ).get(kind, proposedAt, JSON.stringify(payload)).id;
}

beforeEach(() => {
  const db = makeDb();
  env = { DB: db };
  const at = "2026-09-01T00:00:00+09:00";
  ids = {
    nvda: db.raw.prepare(
      "INSERT INTO securities (name, ticker, ysym, market, currency, asset_class, created_at, updated_at) " +
      "VALUES ('엔비디아','NVDA','NVDA','US','USD','equity',?,?) RETURNING id"
    ).get(at, at).id,
  };
  db.raw.prepare("INSERT INTO positions (security_id, qty, avg_price, avg_ccy, source, updated_at) VALUES (?, 10, 100, 'USD', 'manual', ?)")
    .run(ids.nvda, at);
  db.raw.prepare("INSERT INTO prices (security_id, date, close) VALUES (?, '2026-09-18', 120)").run(ids.nvda);
});

describe("GET /drafts", () => {
  it("기본은 대기 중인 것만", async () => {
    insertDraft("view", { x: 1 });
    const applied = insertDraft("portfolio", { rows: [] });
    env.DB.raw.prepare("UPDATE import_drafts SET status = 'applied' WHERE id = ?").run(applied);
    const r = await body(await listDrafts(req(), env, H, {}, url()));
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0].kind).toBe("view");
    expect(r.drafts[0].payload).toEqual({ x: 1 });
    expect((await body(await listDrafts(req(), env, H, {}, url("?status=all")))).drafts).toHaveLength(2);
  });
});

describe("보유 초안 승인", () => {
  const payload = {
    rows: [
      { name: "엔비디아", ysym: "NVDA", ticker: "NVDA", market: "US", currency: "USD", qty: 12, avg_price: 105 },
      { name: "테슬라", ysym: "TSLA", ticker: "TSLA", market: "US", currency: "USD", qty: 5, avg_price: 300 },
    ],
    cash: [{ currency: "KRW", amount: 2500000 }],
  };

  it("보유·현금을 반영하고 변화 기록을 돌려준다", async () => {
    const id = insertDraft("portfolio", payload);
    const r = await body(await applyDraft(req({}), env, H, { id }));
    expect(r.ok).toBe(true);
    expect(r.added).toBe(1); // 테슬라
    expect(r.updated).toBe(1);
    expect(r.changes.map((c) => c.qty_after).sort((a, b) => a - b)).toEqual([5, 12]);

    const pos = env.DB.raw.prepare("SELECT qty FROM positions WHERE security_id = ?").get(ids.nvda);
    expect(pos.qty).toBe(12);
    expect(env.DB.raw.prepare("SELECT amount FROM cash WHERE currency = 'KRW'").get().amount).toBe(2500000);
    expect(env.DB.raw.prepare("SELECT status, result FROM import_drafts WHERE id = ?").get(id).status).toBe("applied");
  });

  it("시트에서 고친 rows를 보내면 그쪽이 이긴다", async () => {
    const id = insertDraft("portfolio", payload);
    await applyDraft(req({
      rows: [{ name: "엔비디아", ysym: "NVDA", ticker: "NVDA", market: "US", currency: "USD", qty: 99, avg_price: 105 }],
    }), env, H, { id });
    expect(env.DB.raw.prepare("SELECT qty FROM positions WHERE security_id = ?").get(ids.nvda).qty).toBe(99);
    expect(env.DB.raw.prepare("SELECT 1 FROM securities WHERE ysym = 'TSLA'").get()).toBeUndefined(); // 테슬라는 안 들어갔다
  });

  it("두 번 반영할 수 없다", async () => {
    const id = insertDraft("portfolio", payload);
    await applyDraft(req({}), env, H, { id });
    const again = await body(await applyDraft(req({}), env, H, { id }).catch((e) => ({ status: e.status, json: async () => ({ error: e.message }) })));
    expect(again.status).toBe(409);
  });
});

describe("의견 초안 승인", () => {
  const payload = (over = {}) => ({
    security_id: null, name: "엔비디아", ticker: "NVDA", currency: "USD",
    rating: "매수", target_price: 150, horizon_months: 6, thesis: "추론 수요", risks: null,
    snapshot: { price: 120, source: "close 2026-09-18", consensus: 160, per: 26.09 },
    ...over,
  });

  it("제출 시각과 얼린 가격 그대로 기록한다", async () => {
    const id = insertDraft("view", payload({ security_id: ids.nvda }), "2026-09-20T11:00:00.000Z");
    const r = await body(await applyDraft(req({}), env, H, { id }));

    expect(r.view.created_at).toBe("2026-09-20T11:00:00.000Z"); // 승인 시각이 아니라 제출 시각
    expect(r.view.price_at).toBe(120);
    expect(r.view.price_at_source).toBe("close 2026-09-18");
    expect(r.view.upside_pct).toBeCloseTo(0.25, 6); // 얼린 가격 기준
    expect(r.view.consensus_target_at).toBe(160);
    expect(r.view.rating).toBe("매수");
    expect(r.view.rating_score).toBe(3);
    expect(r.view.target_ccy).toBe("USD");

    const d = env.DB.raw.prepare("SELECT status, result FROM import_drafts WHERE id = ?").get(id);
    expect(d.status).toBe("applied");
    expect(JSON.parse(d.result).view_id).toBe(r.view.id);
  });

  it("종목이 사라졌으면 404", async () => {
    const id = insertDraft("view", payload({ security_id: 9999 }));
    await expect(applyDraft(req({}), env, H, { id })).rejects.toMatchObject({ status: 404 });
  });
});

describe("메모 초안 승인", () => {
  it("제출 시각으로 메모를 만들고 종목을 잇는다", async () => {
    const id = insertDraft("note", {
      title: "에이전틱 AI 확산으로 CPU 주목",
      body: "추론이 늘면 서버 CPU 수요도 붙는다.",
      tags: ["AI"], stance: "positive", securities: [ids.nvda],
    }, "2026-09-21T09:30:00.000Z");

    const r = await body(await applyDraft(req({}), env, H, { id }));
    expect(r.note.title).toBe("에이전틱 AI 확산으로 CPU 주목");
    expect(r.note.created_at).toBe("2026-09-21T09:30:00.000Z");
    expect(r.note.tags).toEqual(["AI"]);
    expect(r.note.securities.map((s) => s.ticker)).toEqual(["NVDA"]);
    expect(JSON.parse(env.DB.raw.prepare("SELECT result FROM import_drafts WHERE id = ?").get(id).result).note_id).toBe(r.note.id);
  });

  it("제목 없는 초안은 400", async () => {
    const id = insertDraft("note", { body: "본문만" });
    await expect(applyDraft(req({}), env, H, { id })).rejects.toMatchObject({ status: 400 });
  });
});

describe("버리기", () => {
  it("상태만 바꾸고 기록은 남긴다", async () => {
    const id = insertDraft("view", { a: 1 });
    expect((await body(await discardDraft(req(), env, H, { id }))).ok).toBe(true);
    const d = env.DB.raw.prepare("SELECT status, resolved_at FROM import_drafts WHERE id = ?").get(id);
    expect(d.status).toBe("discarded");
    expect(d.resolved_at).toBeTruthy();
    await expect(discardDraft(req(), env, H, { id })).rejects.toMatchObject({ status: 409 });
  });
});
