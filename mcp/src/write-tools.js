// MCP 쓰기 툴 (M10). 실제 데이터는 바꾸지 않는다: import_drafts에 '제안'만 넣고,
// 사용자가 앱에서 승인할 때 invest-api가 보유·현금·의견에 반영한다 (SPEC §7.9).
//
// 의견은 제출 시각과 그 시점의 가격·컨센서스를 여기서 얼려 둔다. 승인이 며칠 뒤여도
// 기록 시점은 대화에서 정리한 그 순간으로 남는다.

import { RATINGS, scoreOf } from "../../worker/src/lib/ratings.js";
import { perAt } from "../../worker/src/lib/valuation.js";
import { ToolError, findSecurity, nowKst } from "./tools.js";

const MAX_ROWS = 100;
const numOrNull = (v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

async function insertDraft(env, { kind, clientName, proposedAt, payload, note }) {
  const row = await env.DB.prepare(
    "INSERT INTO import_drafts (kind, source, client_name, proposed_at, payload, note) " +
    "VALUES (?1, 'mcp', ?2, ?3, ?4, ?5) RETURNING id"
  ).bind(kind, clientName || null, proposedAt, JSON.stringify(payload), note || null).first();
  return row.id;
}

// ── 보유 가져오기 ────────────────────────────────────
// 앱의 normalize(web/src/lib/calc/normalize.js)가 읽는 모양으로 맞춰 저장한다.
// 스크린샷 판독은 대화 쪽 모델이 하고, 정규화·병합·변화 감지는 앱과 서버 코드가 한다.
function toAppRow(r, i) {
  const name = String(r.name || "").trim();
  if (!name) throw new ToolError(i + 1 + "번째 줄: 종목 이름이 없습니다");
  const qty = numOrNull(r.qty);
  const mv = numOrNull(r.market_value);
  if (!(qty > 0) && !(mv > 0)) {
    throw new ToolError(i + 1 + "번째 줄(" + name + "): 수량이나 평가금액 중 하나는 있어야 합니다");
  }
  return {
    name,
    tick: r.ticker ? String(r.ticker).trim().toUpperCase() : "",
    ysym: r.ysym ? String(r.ysym).trim() : undefined,
    sec: r.sector ? String(r.sector).trim() : undefined,
    currency: r.currency === "USD" ? "USD" : r.currency === "KRW" ? "KRW" : undefined,
    qty: qty ?? undefined,
    avgPrice: numOrNull(r.avg_price) ?? undefined,
    currentPrice: numOrNull(r.price) ?? undefined,
    marketValue: mv ?? undefined,
    profit: numOrNull(r.profit) ?? undefined,
  };
}

/** 이미 등록된 종목인지 알려준다(새 종목이 몇 개인지 사용자에게 말해 주기 위한 것). */
async function matchKnown(env, rows) {
  const { results } = await env.DB.prepare(
    "SELECT name, ticker, ysym FROM securities WHERE archived_at IS NULL"
  ).all();
  const byTicker = new Map(results.map((s) => [s.ticker.toUpperCase(), s]));
  const byYsym = new Map(results.map((s) => [s.ysym.toUpperCase(), s]));
  const byName = new Map(results.map((s) => [s.name, s]));
  return rows.map((r) => {
    const hit = byTicker.get(r.tick) || byYsym.get((r.ysym || r.tick || "").toUpperCase()) || byName.get(r.name);
    return { name: r.name, ticker: r.tick || null, known: !!hit, matched_as: hit ? hit.name + "(" + hit.ticker + ")" : null };
  });
}

async function submitPortfolio(env, args, ctx) {
  const rows = Array.isArray(args.rows) ? args.rows : null;
  if (!rows || !rows.length) throw new ToolError("rows가 비어 있습니다");
  if (rows.length > MAX_ROWS) throw new ToolError("한 번에 " + MAX_ROWS + "줄까지 받습니다");
  const appRows = rows.map(toAppRow);

  const cash = (Array.isArray(args.cash) ? args.cash : []).map((c, i) => {
    const amount = numOrNull(c.amount);
    if (!["KRW", "USD"].includes(c.currency)) throw new ToolError(i + 1 + "번째 현금: currency는 KRW 또는 USD여야 합니다");
    if (!(amount >= 0)) throw new ToolError(i + 1 + "번째 현금: amount는 0 이상이어야 합니다");
    return { currency: c.currency, amount };
  });

  const matched = await matchKnown(env, appRows);
  const proposedAt = new Date().toISOString();
  const id = await insertDraft(env, {
    kind: "portfolio", clientName: ctx?.clientName, proposedAt,
    payload: { rows: appRows, cash }, note: args.note,
  });

  const fresh = matched.filter((m) => !m.known);
  return {
    draft_id: id,
    proposed_at: nowKst(),
    status: "pending",
    rows: matched.length,
    new_securities: fresh.map((m) => m.name),
    cash: cash.length,
    next: "앱(투자 노트) 홈의 '가져오기 대기'에서 확인하고 반영하면 보유에 들어갑니다. " +
      "여기서는 아직 실제 보유가 바뀌지 않았습니다.",
    note: "수량·평단을 읽지 못한 줄이 있으면 사용자에게 그 줄을 다시 확인받아라. " +
      (fresh.length ? "처음 보는 종목 " + fresh.length + "개는 앱에서 새로 등록된다." : "전부 이미 등록된 종목이다."),
  };
}

// ── 투자의견 기록 ────────────────────────────────────
/** 제출 시점 스냅샷: 앱이 아는 마지막 종가 + 그 시점 컨센서스·PER. */
async function freezeSnapshot(env, sec) {
  const px = await env.DB.prepare(
    "SELECT date, close FROM prices WHERE security_id = ?1 ORDER BY date DESC LIMIT 1"
  ).bind(sec.id).first();
  if (!px) throw new ToolError(sec.name + "의 가격이 없어 의견을 기록할 수 없습니다 (상승여력을 얼릴 수 없음)");
  const cons = await env.DB.prepare(
    "SELECT target_price FROM estimates WHERE security_id = ?1 AND source IN ('yahoo','naver') AND target_price IS NOT NULL " +
    "ORDER BY as_of DESC LIMIT 1"
  ).bind(sec.id).first();
  return {
    price: px.close,
    source: "close " + px.date,
    consensus: cons ? cons.target_price : null,
    per: await perAt(env, sec.id, px.close),
  };
}

async function addView(env, args, ctx) {
  const sec = await findSecurity(env, args.ticker);
  if (scoreOf(args.rating) == null) {
    throw new ToolError("rating은 " + RATINGS.map((r) => r.label).join(" | ") + " 중 하나여야 합니다");
  }
  const target = numOrNull(args.target_price);
  if (!(target > 0)) throw new ToolError("target_price는 0보다 큰 숫자여야 합니다 (" + sec.currency + " 기준)");
  const horizon = args.horizon_months == null ? 12 : Number(args.horizon_months);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 60) throw new ToolError("horizon_months는 1~60 사이 정수여야 합니다");

  const snapshot = await freezeSnapshot(env, sec);
  const proposedAt = new Date().toISOString();
  const payload = {
    security_id: sec.id, name: sec.name, ticker: sec.ticker, currency: sec.currency,
    rating: args.rating, target_price: target, horizon_months: horizon,
    thesis: args.thesis ? String(args.thesis).trim() : null,
    risks: args.risks ? String(args.risks).trim() : null,
    snapshot,
  };
  const id = await insertDraft(env, { kind: "view", clientName: ctx?.clientName, proposedAt, payload, note: args.note });

  return {
    draft_id: id,
    status: "pending",
    security: sec.name + "(" + sec.ticker + ")",
    rating: args.rating,
    target_price: target,
    horizon_months: horizon,
    frozen: {
      proposed_at: proposedAt,
      price_at: snapshot.price,
      price_basis: snapshot.source,
      upside_pct: Math.round((target / snapshot.price - 1) * 1000) / 10,
      consensus_target_at: snapshot.consensus,
      per_at: snapshot.per == null ? null : Math.round(snapshot.per * 100) / 100,
    },
    next: "앱 홈의 '가져오기 대기'에서 '그대로 기록'을 누르면 의견으로 저장됩니다. " +
      "기록 시각과 가격은 지금 이 시점으로 얼려 뒀으니 나중에 승인해도 시점은 밀리지 않습니다.",
    rule: "의견은 덮어쓰지 않는 기록이다. 생각이 바뀌면 지우지 말고 새 의견을 하나 더 남겨라.",
  };
}

// ── 테마·섹터 메모 제안 ────────────────────────────────
const STANCES = ["positive", "neutral", "negative"];

async function addNote(env, args, ctx) {
  const title = String(args.title || "").trim();
  if (!title) throw new ToolError("제목이 필요합니다");
  if (title.length > 200) throw new ToolError("제목은 200자까지입니다");
  if (args.stance != null && args.stance !== "" && !STANCES.includes(args.stance)) {
    throw new ToolError("stance는 " + STANCES.join(" | ") + " 중 하나여야 합니다");
  }
  const tags = (Array.isArray(args.tags) ? args.tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 12);

  // 종목 연결: 못 찾은 이름은 버리지 않고 사용자에게 알린다
  const securities = [];
  const unknown = [];
  for (const t of (Array.isArray(args.tickers) ? args.tickers : []).slice(0, 20)) {
    try {
      const sec = await findSecurity(env, t);
      if (!securities.some((s) => s.id === sec.id)) securities.push({ id: sec.id, name: sec.name, ticker: sec.ticker });
    } catch {
      unknown.push(String(t));
    }
  }

  const proposedAt = new Date().toISOString();
  const id = await insertDraft(env, {
    kind: "note", clientName: ctx?.clientName, proposedAt,
    payload: {
      title,
      body: args.body ? String(args.body).trim() : null,
      tags,
      stance: args.stance || null,
      securities: securities.map((s) => s.id),
      security_names: securities.map((s) => s.name),
    },
    note: args.note,
  });

  return {
    draft_id: id,
    status: "pending",
    title,
    tags,
    stance: args.stance || null,
    securities: securities.map((s) => s.name + "(" + s.ticker + ")"),
    unknown_tickers: unknown,
    proposed_at: proposedAt,
    next: "앱 홈의 '가져오기 대기'에서 확인하면 종합 의견으로 저장됩니다. 기록 시각은 지금으로 얼려 뒀습니다.",
    rule: "종합 의견은 채점하지 않는 기록이다. 목표가나 적중 여부를 지어내지 마라. " +
      "과거 날짜로 남기고 싶다면 앱에서 직접 써야 한다(대화에서는 지금 시각으로만 들어간다).",
  };
}

// ── 대기 목록 ───────────────────────────────────────
async function getPending(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, kind, client_name, proposed_at, payload, note, status FROM import_drafts " +
    "WHERE status = 'pending' ORDER BY proposed_at DESC LIMIT 20"
  ).all();
  return {
    as_of: nowKst(),
    count: results.length,
    drafts: results.map((d) => {
      const p = JSON.parse(d.payload);
      return {
        draft_id: d.id, kind: d.kind, from: d.client_name, proposed_at: d.proposed_at, note: d.note,
        summary: d.kind === "portfolio"
          ? "보유 " + p.rows.length + "줄" + (p.cash?.length ? " + 현금 " + p.cash.length + "건" : "")
          : d.kind === "note"
            ? "종합 의견: " + p.title
            : p.name + " " + p.rating + " 목표가 " + p.target_price,
      };
    }),
    next: results.length ? "앱 홈의 '가져오기 대기'에서 반영하거나 버릴 수 있습니다." : "대기 중인 제안이 없습니다.",
  };
}

const TICKER = { type: "string", description: "종목 티커·야후 심볼·한글 이름 (예: NVDA, 005930, 삼성전자)" };

export const WRITE_TOOLS = [
  {
    name: "submit_portfolio_import",
    title: "보유 가져오기 제안",
    description:
      "증권사 화면 스크린샷에서 읽은 보유 목록을 앱에 제안한다. 사진에서 종목명·수량·평단·평가금액을 읽어 rows로 넘기면 된다. " +
      "숫자를 만들어내지 말고 화면에 보이는 값만 넣어라. 실제 보유는 바뀌지 않고, 사용자가 앱에서 확인·수정한 뒤 반영한다.",
    inputSchema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          description: "보유 줄 목록 (최대 100)",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "화면에 보이는 종목 이름" },
              ticker: { type: "string", description: "티커나 종목코드 (보이면)" },
              currency: { type: "string", enum: ["KRW", "USD"], description: "화면 금액의 통화" },
              qty: { type: "number", description: "보유 수량" },
              avg_price: { type: "number", description: "평균 매입가" },
              price: { type: "number", description: "현재가" },
              market_value: { type: "number", description: "평가금액 (수량이 안 보일 때 특히 중요)" },
              profit: { type: "number", description: "평가손익" },
              sector: { type: "string", description: "분류 (알 때만)" },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
        cash: {
          type: "array",
          description: "예수금 (화면에 보일 때만)",
          items: {
            type: "object",
            properties: { currency: { type: "string", enum: ["KRW", "USD"] }, amount: { type: "number" } },
            required: ["currency", "amount"],
            additionalProperties: false,
          },
        },
        note: { type: "string", description: "어떤 화면을 읽었는지 같은 메모 (선택)" },
      },
      required: ["rows"],
      additionalProperties: false,
    },
    run: (env, args, ctx) => submitPortfolio(env, args, ctx),
  },
  {
    name: "add_investment_view",
    title: "투자의견 기록 제안",
    description:
      "대화에서 정리한 투자의견(등급·목표주가·근거·리스크)을 기록하겠다고 제안한다. 제출 시각과 그 시점 가격·컨센서스를 얼려 두므로, " +
      "사용자가 나중에 앱에서 승인해도 기록 시점은 지금이다. 목표주가는 종목의 표시통화 기준으로 넣어라. " +
      "사용자가 직접 말한 판단만 넣고, 모델이 대신 판단을 지어내지 마라.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: TICKER,
        rating: { type: "string", enum: RATINGS.map((r) => r.label), description: "8단계 등급" },
        target_price: { type: "number", description: "목표주가 (종목 표시통화 기준)" },
        horizon_months: { type: "integer", description: "목표 기간(개월). 기본 12" },
        thesis: { type: "string", description: "근거" },
        risks: { type: "string", description: "리스크" },
        note: { type: "string", description: "메모 (선택)" },
      },
      required: ["ticker", "rating", "target_price"],
      additionalProperties: false,
    },
    run: (env, args, ctx) => addView(env, args, ctx),
  },
  {
    name: "add_note",
    title: "종합 의견 제안",
    description:
      "종목이 아니라 테마·섹터·매크로에 대해 정리한 생각을 종합 의견으로 제안한다(예: '에이전틱 AI 확산으로 CPU 주목'). " +
      "목표가·등급이 없는 자유 기록이고 성과 평가에 들어가지 않는다. 사용자가 실제로 한 판단만 적고, 모델이 대신 지어내지 마라.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "한 줄 제목" },
        body: { type: "string", description: "본문. 줄바꿈은 불릿, 빈 줄은 문단으로 보인다" },
        tags: { type: "array", items: { type: "string" }, description: "자유 태그 (예: AI, 매크로, 반도체)" },
        stance: { type: "string", enum: STANCES, description: "방향성 (긍정/중립/부정). 등급이 아니다" },
        tickers: { type: "array", items: { type: "string" }, description: "관련 종목 (티커·한글 이름)" },
        note: { type: "string", description: "메모에 대한 메모 (선택)" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    run: (env, args, ctx) => addNote(env, args, ctx),
  },
  {
    name: "get_pending_drafts",
    title: "대기 중인 제안",
    description: "아직 앱에서 승인되지 않은 제안(보유 가져오기·투자의견)을 보여준다.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (env) => getPending(env),
  },
];
