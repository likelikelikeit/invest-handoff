import { describe, it, expect, beforeEach } from "vitest";
import { makeDb } from "./d1shim.js";
import { listNotes, listNoteTags, createNote, patchNote, deleteNote } from "../src/routes/notes.js";

const H = {};
const req = (body) => ({ json: async () => body });
const url = (q = "") => new URL("http://x/notes" + q);
const body = async (res) => ({ status: res.status, ...(await res.json()) });

let env;
let ids;

beforeEach(() => {
  const db = makeDb();
  env = { DB: db };
  const at = "2026-09-01T00:00:00+09:00";
  const sec = (name, ticker, ysym, ccy) => db.raw.prepare(
    "INSERT INTO securities (name, ticker, ysym, market, currency, asset_class, created_at, updated_at) " +
    "VALUES (?,?,?,?,?, 'equity', ?, ?) RETURNING id"
  ).get(name, ticker, ysym, ccy === "KRW" ? "KR" : "US", ccy, at, at).id;
  ids = { amd: sec("AMD", "AMD", "AMD", "USD"), intc: sec("인텔", "INTC", "INTC", "USD") };
  const px = db.raw.prepare("INSERT INTO prices (security_id, date, close) VALUES (?, ?, ?)");
  px.run(ids.amd, "2025-05-30", 100);
  px.run(ids.amd, "2025-06-02", 110);   // 소급 기록일(6/3) 직전
  px.run(ids.amd, "2026-09-18", 150);
  px.run(ids.intc, "2025-06-02", 20);
});

describe("메모 쓰기", () => {
  it("제목·본문·태그·방향성·연결 종목을 저장한다", async () => {
    const r = await body(await createNote(req({
      title: "에이전틱 AI 확산으로 CPU 주목",
      body: "추론이 늘면 GPU만이 아니라 서버 CPU 수요도 붙는다.\n\n다만 교체 주기가 길다.",
      tags: ["AI", "반도체", "AI"],
      stance: "positive",
      securities: [ids.amd, ids.intc],
    }), env, H));

    expect(r.note.title).toBe("에이전틱 AI 확산으로 CPU 주목");
    expect(r.note.tags).toEqual(["AI", "반도체"]);       // 중복 제거
    expect(r.note.stance).toBe("positive");
    expect(r.note.backdated).toBe(0);
    expect(r.note.securities.map((s) => s.ticker).sort()).toEqual(["AMD", "INTC"]);
    // 목표가·등급 같은 칸은 아예 없다
    expect(r.note.target_price).toBeUndefined();
    expect(r.note.rating).toBeUndefined();
  });

  it("제목이 없으면 거절한다", async () => {
    await expect(createNote(req({ body: "본문만" }), env, H)).rejects.toMatchObject({ status: 400 });
  });

  it("모르는 방향성은 거절한다", async () => {
    await expect(createNote(req({ title: "x", stance: "매수" }), env, H)).rejects.toMatchObject({ status: 400 });
  });

  it("없는 종목 id는 조용히 무시한다", async () => {
    const r = await body(await createNote(req({ title: "x", securities: [ids.amd, 9999] }), env, H));
    expect(r.note.securities.map((s) => s.ticker)).toEqual(["AMD"]);
  });
});

describe("과거 날짜로 기록", () => {
  it("그날로 기록하고 backdated를 남긴다. 연결 종목의 그때 종가도 같이 준다", async () => {
    const r = await body(await createNote(req({
      title: "CPU 사이클 바닥", securities: [ids.amd, ids.intc], as_of: "2025-06-03",
    }), env, H));

    expect(r.note.backdated).toBe(1);
    expect(r.note.created_at).toBe("2025-06-03T00:00:00+09:00");
    const amd = r.note.securities.find((s) => s.ticker === "AMD");
    expect(amd.price_at_note).toBe(110);     // 6/3 이전 마지막 종가 (휴장 보정)
    expect(r.note.securities.find((s) => s.ticker === "INTC").price_at_note).toBe(20);
  });

  it("시세가 아예 없어도 기록은 된다 (메모는 상승여력을 얼리지 않는다)", async () => {
    const at = "2026-09-01T00:00:00+09:00";
    env.DB.raw.prepare(
      "INSERT INTO securities (name, ticker, ysym, market, currency, asset_class, created_at, updated_at) " +
      "VALUES ('신규','NEW','NEW','US','USD','equity',?,?)"
    ).run(at, at);
    const newId = env.DB.raw.prepare("SELECT id FROM securities WHERE ysym='NEW'").get().id;
    const r = await body(await createNote(req({ title: "옛날 생각", securities: [newId], as_of: "2015-01-05" }), env, H));
    expect(r.note.created_at).toBe("2015-01-05T00:00:00+09:00");
    expect(r.note.securities[0].price_at_note).toBeNull();
  });

  it("미래 날짜는 거절한다", async () => {
    await expect(createNote(req({ title: "x", as_of: "2099-01-01" }), env, H)).rejects.toMatchObject({ status: 400 });
  });
});

describe("조회", () => {
  beforeEach(async () => {
    await createNote(req({ title: "AI 인프라", tags: ["AI"], stance: "positive", securities: [ids.amd] }), env, H);
    await createNote(req({ title: "금리 경로", tags: ["매크로"], stance: "negative", as_of: "2026-01-05" }), env, H);
  });

  it("최신순으로 준다", async () => {
    const r = await body(await listNotes(req(), env, H, {}, url()));
    expect(r.notes.map((n) => n.title)).toEqual(["AI 인프라", "금리 경로"]);
  });

  it("태그·종목·방향성으로 거른다", async () => {
    expect((await body(await listNotes(req(), env, H, {}, url("?tag=매크로")))).notes.map((n) => n.title)).toEqual(["금리 경로"]);
    expect((await body(await listNotes(req(), env, H, {}, url("?security_id=" + ids.amd)))).notes.map((n) => n.title)).toEqual(["AI 인프라"]);
    expect((await body(await listNotes(req(), env, H, {}, url("?stance=negative")))).notes.map((n) => n.title)).toEqual(["금리 경로"]);
  });

  it("쓴 태그를 많이 쓴 순으로 모아 준다", async () => {
    await createNote(req({ title: "또 AI", tags: ["AI"] }), env, H);
    const r = await body(await listNoteTags(req(), env, H));
    expect(r.tags[0]).toMatchObject({ tag: "AI", n: 2 });
    expect(r.tags.map((t) => t.tag)).toContain("매크로");
  });
});

describe("편집·삭제", () => {
  let id;
  beforeEach(async () => {
    const r = await body(await createNote(req({ title: "처음", tags: ["AI"], securities: [ids.amd] }), env, H));
    id = r.note.id;
  });

  it("편집하면 edited_at이 붙고 기록 시각은 그대로", async () => {
    const before = await body(await listNotes(req(), env, H, {}, url()));
    const r = await body(await patchNote(req({ title: "고침", stance: "neutral" }), env, H, { id }));
    expect(r.note.title).toBe("고침");
    expect(r.note.stance).toBe("neutral");
    expect(r.note.edited_at).toBeTruthy();
    expect(r.note.created_at).toBe(before.notes[0].created_at);
  });

  it("연결 종목만 바꿀 수도 있다", async () => {
    const r = await body(await patchNote(req({ securities: [ids.intc] }), env, H, { id }));
    expect(r.note.securities.map((s) => s.ticker)).toEqual(["INTC"]);
  });

  it("삭제하면 연결도 같이 지운다", async () => {
    await deleteNote(req(), env, H, { id });
    expect((await body(await listNotes(req(), env, H, {}, url()))).notes).toHaveLength(0);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM note_securities").get().n).toBe(0);
  });

  it("없는 메모는 404", async () => {
    await expect(patchNote(req({ title: "x" }), env, H, { id: 9999 })).rejects.toMatchObject({ status: 404 });
  });
});
