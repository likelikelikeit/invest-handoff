// /quotes /search /import — 기존 worker.js 경로를 옮겼다.

import { json, HttpError } from "../lib/http.js";
import { nowIso, todayKst } from "../lib/time.js";
import { quote, quoteBatch, search, FX_SYMBOL } from "../sources/yahoo.js";
import { importProvider, parseRows } from "../sources/llm.js";

// 묶음 시세(50종목/요청)라 서브요청은 몇 개 안 든다. 묶음이 실패하면 종목별로 받되 그건 40개까지.
const MAX_SYMBOLS = 200;
const FALLBACK_SYMBOLS = 40;
const IMPORT_DAILY_LIMIT = 30; // SPEC §7.2 [제안]

export async function handleQuotes(url, env, headers) {
  const raw = (url.searchParams.get("symbols") || "").trim();
  if (!raw) throw new HttpError(400, "symbols 파라미터가 필요합니다");

  const symbols = [];
  for (const s of raw.split(",")) {
    const t = s.trim();
    if (t && !symbols.includes(t) && symbols.length < MAX_SYMBOLS) symbols.push(t);
  }

  // 환율은 항상 받는다. 명시적으로 요청했으면(시장 띠) quotes에도 넣는다.
  const askedFx = symbols.includes(FX_SYMBOL);
  const wanted = askedFx ? symbols : symbols.concat([FX_SYMBOL]);
  const got = new Map();
  const errors = [];
  try {
    for (const [sym, q] of await quoteBatch(env, wanted)) {
      const { bar, ...rest } = q; // 앱에는 봉이 필요 없다
      void bar;
      got.set(sym, rest);
    }
  } catch (e) {
    errors.push("묶음 시세 실패, 종목별로 받음: " + String(e?.message || e));
  }
  // 묶음에서 빠진 종목(심볼 오타·묶음 실패)은 종목별로 다시 본다
  const rest = wanted.filter((s) => !got.has(s)).slice(0, FALLBACK_SYMBOLS);
  const settled = await Promise.allSettled(rest.map(quote));
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") got.set(rest[i], r.value);
    else errors.push(String(r.reason && r.reason.message ? r.reason.message : r.reason));
  });

  const quotes = {};
  let fx = null;
  let fxTime = null;
  for (const [sym, q] of got) {
    if (sym === FX_SYMBOL) {
      fx = q.price;
      fxTime = q.time;
      if (askedFx) quotes[FX_SYMBOL] = q;
    } else quotes[sym] = q;
  }

  return json({ ok: Object.keys(quotes).length > 0, at: new Date().toISOString(),
                source: "yahoo(delayed)", fx: { USDKRW: fx, time: fxTime }, quotes, errors }, 200, headers);
}

export async function handleSearch(url, env, headers) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) throw new HttpError(400, "q 파라미터가 필요합니다");
  try {
    return json({ ok: true, results: await search(q) }, 200, headers);
  } catch (e) {
    // 외부 소스 실패는 앱을 죽이지 않는다. 빈 결과 + 이유.
    return json({ ok: false, error: String(e.message || e), results: [] }, 200, headers);
  }
}

/** meta에 날짜별 카운터를 두고 하루 상한을 넘으면 막는다. */
async function bumpImportCounter(env) {
  const key = "import_count:" + todayKst();
  const row = await env.DB.prepare(
    "INSERT INTO meta (key, value, updated_at) VALUES (?1, '1', ?2) " +
    "ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1, updated_at = ?2 RETURNING value"
  ).bind(key, nowIso()).first();
  return Number(row.value);
}

export async function handleImport(request, url, env, headers) {
  const provider = importProvider(env);
  if (provider.error) throw new HttpError(501, provider.error);

  const mediaType = url.searchParams.get("mt") || "image/png";
  const b64 = (await request.text()).trim();
  if (!b64) throw new HttpError(400, "이미지가 비어 있습니다");

  const n = await bumpImportCounter(env);
  if (n > IMPORT_DAILY_LIMIT) throw new HttpError(429, "오늘 스크린샷 가져오기 상한(" + IMPORT_DAILY_LIMIT + "회)을 넘었습니다");

  let out;
  try {
    out = await provider.call({ env, model: provider.model, mediaType, b64 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 200, headers);
  }
  try {
    return json({ ok: true, rows: parseRows(out.text), usage: out.usage, provider: provider.name }, 200, headers);
  } catch {
    return json({ ok: false, error: "읽은 결과를 해석하지 못했습니다", raw: String(out.text).slice(0, 400) }, 200, headers);
  }
}
