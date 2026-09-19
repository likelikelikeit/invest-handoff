// invest-api 라우터. /health 말고는 전부 Bearer 토큰이 필요하다 (SPEC §7.2).

import { corsHeaders, json, checkAuth, HttpError } from "./lib/http.js";
import { handleQuotes, handleSearch, handleImport } from "./routes/market.js";
import {
  listSecurities, getSecurityRoute, createSecurity, patchSecurity, archiveSecurity,
  listWatchlist, addWatch, removeWatch, listCash, putCash,
} from "./routes/securities.js";
import {
  getPortfolio, putPosition, deletePosition, mergePortfolio,
  listChanges, patchChange, listScenarios, createScenario, deleteScenario,
} from "./routes/portfolio.js";
import { getPrices, backfillPrices, getStatus } from "./routes/prices.js";
import { runDaily, CRON_KR, CRON_US } from "./cron/daily.js";
import { listViews, latestViews, createView, patchView, deleteView } from "./routes/views.js";

const ID = "(?<id>\\d+)";

// [method, 경로 정규식, handler(request, env, headers, params, url)]
const ROUTES = [
  ["GET", "/quotes", (req, env, h, p, url) => handleQuotes(url, env, h)],
  ["GET", "/search", (req, env, h, p, url) => handleSearch(url, env, h)],
  ["POST", "/import", (req, env, h, p, url) => handleImport(req, url, env, h)],

  ["GET", "/portfolio", getPortfolio],
  ["POST", "/portfolio/merge", mergePortfolio],
  ["PUT", "/portfolio/positions/" + ID, putPosition],
  ["DELETE", "/portfolio/positions/" + ID, deletePosition],
  ["GET", "/portfolio/changes", listChanges],
  ["PATCH", "/portfolio/changes/" + ID, patchChange],
  ["GET", "/portfolio/scenarios", listScenarios],
  ["POST", "/portfolio/scenarios", createScenario],
  ["DELETE", "/portfolio/scenarios/" + ID, deleteScenario],

  ["GET", "/securities", listSecurities],
  ["POST", "/securities", createSecurity],
  ["GET", "/securities/" + ID, getSecurityRoute],
  ["PATCH", "/securities/" + ID, patchSecurity],
  ["DELETE", "/securities/" + ID, archiveSecurity],

  ["GET", "/watchlist", listWatchlist],
  ["POST", "/watchlist", addWatch],
  ["DELETE", "/watchlist/" + ID, removeWatch],

  ["GET", "/views", listViews],
  ["GET", "/views/latest", latestViews],
  ["POST", "/views", createView],
  ["PATCH", "/views/" + ID, patchView],
  ["DELETE", "/views/" + ID, deleteView],

  ["GET", "/prices/" + ID, getPrices],
  ["POST", "/prices/" + ID + "/backfill", backfillPrices],
  ["GET", "/status", getStatus],

  ["GET", "/cash", listCash],
  ["PUT", "/cash/(?<currency>KRW|USD)", putCash],
].map(([method, path, handler]) => [method, new RegExp("^" + path + "/?$"), handler]);

export function matchRoute(method, pathname) {
  let pathMatched = false;
  for (const [m, re, handler] of ROUTES) {
    const hit = re.exec(pathname);
    if (!hit) continue;
    pathMatched = true;
    if (m !== method) continue;
    const params = { ...(hit.groups || {}) };
    if (params.id) params.id = Number(params.id);
    return { handler, params };
  }
  return { pathMatched };
}

async function handleHealth(env, headers) {
  let db = "없음";
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").first();
      db = "ok (테이블 " + row.n + "개)";
    } catch (e) {
      db = "오류: " + String(e.message || e);
    }
  }
  return json({ ok: true, at: new Date().toISOString(), db }, 200, headers);
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    try {
      if (url.pathname === "/health") return await handleHealth(env, headers);

      checkAuth(request, env);
      const r = matchRoute(request.method, url.pathname);
      if (r.handler) return await r.handler(request, env, headers, r.params, url);
      if (r.pathMatched) throw new HttpError(405, request.method + "는 이 경로에서 받지 않습니다");
      throw new HttpError(404, "없는 경로입니다");
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ ok: false, error: String(e.message || e) }, status, headers);
    }
  },

  // 크론 (SPEC §7.3). 어떤 크론인지는 event.cron 문자열로 가른다.
  async scheduled(event, env, ctx) {
    const which = event.cron === CRON_KR ? "kr" : event.cron === CRON_US ? "us" : null;
    if (which) ctx.waitUntil(runDaily(env, which, new Date(event.scheduledTime)));
  },
};
