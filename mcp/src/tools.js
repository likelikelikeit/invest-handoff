// MCP 읽기 툴. 전부 D1 조회만 한다(쓰기 없음). 계산은 여기서(코드가) 하고, 모델에게는 결과만 준다.
// 금액은 원화 환산값과 표시통화 원값을 같이 준다. 축약하지 않는다.

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const pct = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 10); // 0.1234 → 12.3(%)

export const nowKst = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", " ") + " KST";
const todayKst = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const addDays = (d, n) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const isDate = (s) => /^\d{4}-\d\d-\d\d$/.test(String(s || ""));

class ToolError extends Error {}

/** 원/달러 최신 종가. 없으면 null (USD 자산은 원화 환산을 비운다). */
async function fxUsdKrw(env) {
  const r = await env.DB.prepare(
    "SELECT date, close FROM prices WHERE security_id = (SELECT id FROM securities WHERE ysym = 'KRW=X') ORDER BY date DESC LIMIT 1"
  ).first();
  return r ? { rate: r.close, date: r.date } : null;
}

const toKrw = (v, ccy, fx) => (v == null ? null : ccy === "USD" ? (fx ? v * fx.rate : null) : v);

/** 티커·야후심볼·이름으로 종목 하나 찾기. 못 찾으면 후보를 알려주고 멈춘다. */
export async function findSecurity(env, q) {
  const s = String(q || "").trim();
  if (!s) throw new ToolError("종목(ticker)을 지정해 주세요");
  const { results } = await env.DB.prepare(
    "SELECT * FROM securities WHERE archived_at IS NULL AND (" +
    "UPPER(ticker) = UPPER(?1) OR UPPER(ysym) = UPPER(?1) OR name = ?1 OR name LIKE '%' || ?1 || '%' OR UPPER(ticker) LIKE UPPER(?1) || '%') " +
    "ORDER BY (UPPER(ticker) = UPPER(?1)) DESC, (name = ?1) DESC, name LIMIT 5"
  ).bind(s).all();
  if (!results.length) {
    const all = await env.DB.prepare(
      "SELECT name, ticker FROM securities WHERE archived_at IS NULL AND asset_class NOT IN ('index','fx') ORDER BY name LIMIT 40"
    ).all();
    throw new ToolError(
      "'" + s + "'에 해당하는 종목이 없습니다. 등록된 종목: " + all.results.map((r) => r.name + "(" + r.ticker + ")").join(", ")
    );
  }
  return results[0];
}

const secOut = (s) => ({
  name: s.name, ticker: s.ticker, market: s.market, currency: s.currency,
  sector: s.sector, asset_class: s.asset_class || "equity",
});

// ── 1. 보유 ─────────────────────────────────────────
async function getPortfolio(env) {
  const fx = await fxUsdKrw(env);
  const [pos, cash] = await env.DB.batch([
    env.DB.prepare(
      "SELECT s.id, s.name, s.ticker, s.market, s.currency, s.sector, s.asset_class, s.expected_return_pct, " +
      "p.qty, p.avg_price, p.avg_ccy, p.updated_at, " +
      "(SELECT close FROM prices x WHERE x.security_id = s.id ORDER BY x.date DESC LIMIT 1) AS last_price, " +
      "(SELECT date FROM prices x WHERE x.security_id = s.id ORDER BY x.date DESC LIMIT 1) AS last_price_date " +
      "FROM positions p JOIN securities s ON s.id = p.security_id ORDER BY s.name"
    ),
    env.DB.prepare("SELECT currency, amount, updated_at FROM cash ORDER BY currency"),
  ]);

  const rows = pos.results.map((r) => {
    const value = toKrw(r.last_price == null ? null : r.qty * r.last_price, r.currency, fx);
    const cost = toKrw(r.qty * r.avg_price, r.avg_ccy || r.currency, fx);
    return {
      ...secOut(r),
      qty: r.qty,
      avg_price: r.avg_price,
      avg_price_ccy: r.avg_ccy || r.currency,
      last_price: r.last_price,
      last_price_date: r.last_price_date,
      value_krw: round(value, 0),
      cost_krw: round(cost, 0),
      return_pct: cost > 0 && value != null ? pct(value / cost - 1) : null,
      expected_return_pct: r.expected_return_pct,
    };
  });

  const stock = rows.reduce((a, b) => a + (b.value_krw || 0), 0);
  const cost = rows.reduce((a, b) => a + (b.cost_krw || 0), 0);
  const cashRows = cash.results.map((c) => ({ ...c, krw: round(toKrw(c.amount, c.currency, fx), 0) }));
  const cashKrw = cashRows.reduce((a, b) => a + (b.krw || 0), 0);
  const total = stock + cashKrw;
  for (const r of rows) r.weight_pct = total > 0 && r.value_krw != null ? pct(r.value_krw / total) : null;

  const sectors = {};
  for (const r of rows) sectors[r.sector || "기타"] = round((sectors[r.sector || "기타"] || 0) + (r.value_krw || 0), 0);

  return {
    as_of: nowKst(),
    price_basis: "저장된 일별 종가(지연 시세). 종목별 기준일은 last_price_date를 보라.",
    fx_usdkrw: fx,
    total: {
      stock_krw: round(stock, 0), cash_krw: round(cashKrw, 0), total_krw: round(total, 0),
      cost_krw: round(cost, 0), pl_krw: round(stock - cost, 0), pl_pct: cost > 0 ? pct(stock / cost - 1) : null,
    },
    positions: rows,
    cash: cashRows,
    sector_krw: sectors,
  };
}

// ── 2. 투자의견 ──────────────────────────────────────
const VIEW_COLS =
  "v.id, v.created_at, v.edited_at, v.rating, v.target_price, v.target_ccy, v.horizon_months, v.thesis, v.risks, " +
  "v.price_at, v.upside_pct, v.consensus_target_at, v.per_at, v.conclusion, " +
  "v.evaluated_at, v.hit, v.hit_date, v.price_at_horizon, v.actual_return, v.target_return, v.abs_error, v.backdated, v.valuation, " +
  "s.name, s.ticker, s.market, s.currency";

/** views.valuation JSON → 사람이 읽을 근거 한 줄 */
function valuationOut(raw) {
  if (!raw) return null;
  let a;
  try {
    a = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!a || !(a.value > 0) || !(a.multiple > 0)) return null;
  const label = { per: ["EPS", "PER"], pbr: ["BPS", "PBR"], psr: ["주당매출", "PSR"], ev_ebitda: ["EBITDA", "EV/EBITDA"] }[a.metric];
  return {
    metric: a.metric, value: a.value, multiple: a.multiple,
    implied_target: round(a.value * a.multiple, 4),
    text: label ? label[0] + " " + a.value + " × " + label[1] + " " + a.multiple : null,
  };
}

function viewOut(v) {
  return {
    name: v.name, ticker: v.ticker, currency: v.currency,
    created_at: v.created_at, edited_at: v.edited_at,
    rating: v.rating, target_price: v.target_price, horizon_months: v.horizon_months,
    price_at_record: v.price_at, upside_at_record_pct: pct(v.upside_pct),
    // 사후에 과거 날짜로 넣은 기록. 예측이 아니므로 적중률을 말할 때 섞지 않는다 (SPEC §5.2.6).
    backdated: v.backdated === 1,
    consensus_target_at_record: v.consensus_target_at, per_at_record: round(v.per_at),
    thesis: v.thesis, risks: v.risks, conclusion: v.conclusion,
    // 목표가 근거 (있을 때): {metric:'per', value: EPS, multiple: 배수}. 값은 코드가 곱해 둔 것이다.
    target_basis: valuationOut(v.valuation),
    evaluation: v.evaluated_at
      ? {
          evaluated_at: v.evaluated_at,
          hit: v.hit === 1,
          hit_date: v.hit_date,
          price_at_horizon: v.price_at_horizon,
          actual_return_pct: pct(v.actual_return),
          target_return_pct: pct(v.target_return),
          abs_error_pct: pct(v.abs_error),
        }
      : null,
  };
}

async function getViews(env, args) {
  const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 200);
  const latestOnly = args.latest_only !== false && !args.ticker;
  let where = "WHERE s.archived_at IS NULL ";
  const binds = [];
  if (args.ticker) {
    const sec = await findSecurity(env, args.ticker);
    binds.push(sec.id);
    where += "AND v.security_id = ?" + binds.length + " ";
  }
  if (latestOnly) {
    where += "AND v.id = (SELECT v2.id FROM views v2 WHERE v2.security_id = v.security_id ORDER BY v2.created_at DESC, v2.id DESC LIMIT 1) ";
  }
  binds.push(limit);
  const { results } = await env.DB.prepare(
    "SELECT " + VIEW_COLS + " FROM views v JOIN securities s ON s.id = v.security_id " + where +
    "ORDER BY v.created_at DESC, v.id DESC LIMIT ?" + binds.length
  ).bind(...binds).all();

  const summarize = (rows) => (rows.length
    ? {
        n: rows.length,
        hit_rate_pct: pct(rows.filter((v) => v.hit === 1).length / rows.length),
        mean_abs_error_pct: pct(rows.reduce((a, b) => a + (b.abs_error || 0), 0) / rows.length),
      }
    : null);
  const done = results.filter((v) => v.evaluated_at);
  return {
    as_of: nowKst(),
    scope: latestOnly ? "종목별 현재 의견(최신 행)" : args.ticker ? "이 종목의 의견 이력" : "전체 의견 이력(최신순)",
    rule: "의견은 덮어쓰지 않는 기록이다. 같은 종목의 여러 행은 시간에 따른 생각의 변화다. " +
      "backdated=true인 행은 과거 날짜로 소급 입력한 것이라 예측 성적에 섞지 않는다.",
    count: results.length,
    evaluated_summary: summarize(done.filter((v) => v.backdated !== 1)),
    backdated_summary: summarize(done.filter((v) => v.backdated === 1)),
    views: results.map(viewOut),
  };
}

// ── 3. 종목 한 장 ────────────────────────────────────
async function getCompany(env, args) {
  const sec = await findSecurity(env, args.ticker);
  const fx = await fxUsdKrw(env);
  const [last, range, fin, est, views, calls, events, pos] = await env.DB.batch([
    env.DB.prepare("SELECT date, close, open, high, low, volume FROM prices WHERE security_id = ?1 ORDER BY date DESC LIMIT 2").bind(sec.id),
    env.DB.prepare(
      "SELECT MAX(high) AS high_52w, MIN(low) AS low_52w, COUNT(*) AS days FROM prices " +
      "WHERE security_id = ?1 AND date >= date('now', '-365 days')"
    ).bind(sec.id),
    env.DB.prepare(
      "SELECT period_end, period_type, revenue, operating_income, net_income, eps, bps, source, currency, source_currency, adr_ratio, fx_rate FROM financials " +
      "WHERE security_id = ?1 ORDER BY period_end DESC LIMIT 12"
    ).bind(sec.id),
    env.DB.prepare(
      "SELECT source, as_of, fiscal_year, eps, revenue, target_price, rating_mean, n_analysts FROM estimates " +
      "WHERE security_id = ?1 ORDER BY as_of DESC, fiscal_year LIMIT 8"
    ).bind(sec.id),
    env.DB.prepare(
      "SELECT " + VIEW_COLS + " FROM views v JOIN securities s ON s.id = v.security_id WHERE v.security_id = ?1 " +
      "ORDER BY v.created_at DESC LIMIT 3"
    ).bind(sec.id),
    env.DB.prepare(
      "SELECT called_at, side, label, price_at, price_1w, price_1m, action, note FROM tech_calls " +
      "WHERE security_id = ?1 ORDER BY called_at DESC LIMIT 3"
    ).bind(sec.id),
    env.DB.prepare(
      "SELECT date, time, kind, title FROM events WHERE security_id = ?1 AND date >= date('now') ORDER BY date LIMIT 5"
    ).bind(sec.id),
    env.DB.prepare("SELECT qty, avg_price, avg_ccy, updated_at FROM positions WHERE security_id = ?1").bind(sec.id),
  ]);

  const price = last.results[0] || null;
  const prev = last.results[1] || null;
  const latestQuarterRows = fin.results.filter((f) => f.period_type === "Q").slice(0, 4);
  const hasUnnormalizedFinancials = latestQuarterRows.some((f) => !f.currency || f.currency !== sec.currency);
  const quarters = fin.results.filter((f) => f.period_type === "Q" && f.currency === sec.currency).slice(0, 4);
  const quarterSpan = quarters.length === 4
    ? (Date.parse(quarters[0].period_end) - Date.parse(quarters[3].period_end)) / 86400000
    : null;
  const ttm = quarters.length === 4 && quarterSpan >= 240 && quarterSpan <= 300
    ? {
        periods: quarters.map((q) => q.period_end).reverse(),
        revenue: quarters.reduce((a, b) => a + (b.revenue || 0), 0),
        operating_income: quarters.reduce((a, b) => a + (b.operating_income || 0), 0),
        net_income: quarters.reduce((a, b) => a + (b.net_income || 0), 0),
        eps: quarters.every((q) => q.eps != null) ? round(quarters.reduce((a, b) => a + b.eps, 0), 4) : null,
      }
    : null;
  const bps = fin.results.find((f) => f.currency === sec.currency && f.bps != null)?.bps ?? null;
  const p = pos.results[0] || null;
  const valueKrw = p && price ? toKrw(p.qty * price.close, sec.currency, fx) : null;

  return {
    as_of: nowKst(),
    security: {
      ...secOut(sec), ysym: sec.ysym, band_default: sec.band_default, expected_return_pct: sec.expected_return_pct,
      financial_currency: sec.financial_currency || sec.currency, adr_ratio: sec.adr_ratio || 1,
    },
    price: price
      ? {
          close: price.close, date: price.date, currency: sec.currency,
          change_pct: prev ? pct(price.close / prev.close - 1) : null,
          high_52w: range.results[0]?.high_52w ?? null,
          low_52w: range.results[0]?.low_52w ?? null,
          position_in_52w_pct: range.results[0]?.high_52w > range.results[0]?.low_52w
            ? pct((price.close - range.results[0].low_52w) / (range.results[0].high_52w - range.results[0].low_52w))
            : null,
          basis: "저장된 일별 종가(지연 시세)",
        }
      : null,
    position: p
      ? {
          qty: p.qty, avg_price: p.avg_price, avg_price_ccy: p.avg_ccy || sec.currency,
          value_krw: round(valueKrw, 0), updated_at: p.updated_at,
          return_pct: price ? pct(price.close / p.avg_price - 1) : null,
        }
      : null,
    ttm,
    valuation: {
      per_ttm: ttm?.eps && price ? round(price.close / ttm.eps) : null,
      pbr: bps && price ? round(price.close / bps) : null,
      bps,
      ready: !hasUnnormalizedFinancials,
      note: hasUnnormalizedFinancials
        ? "재무 통화·ADR 단위가 상장 가격 통화로 환산되지 않아 밸류에이션을 비웠다."
        : "TTM은 통화 단위가 일치하는 최근 연속 4개 분기 합. 분기 데이터가 부족하면 비운다.",
    },
    financials: fin.results,
    estimates: est.results,
    views: views.results.map(viewOut),
    recent_tech_calls: calls.results.map(callOut),
    upcoming_events: events.results,
  };
}

// ── 4. 일정 ─────────────────────────────────────────
async function getCalendar(env, args) {
  const from = isDate(args.from) ? args.from : todayKst();
  const to = isDate(args.to) ? args.to : addDays(from, 30);
  if (to < from) throw new ToolError("to가 from보다 빠릅니다");
  const { results } = await env.DB.prepare(
    "SELECT e.date, e.time, e.kind, e.title, e.detail, e.source, s.name AS security_name, s.ticker " +
    "FROM events e LEFT JOIN securities s ON s.id = e.security_id " +
    "WHERE e.date BETWEEN ?1 AND ?2 AND (e.security_id IS NULL OR s.archived_at IS NULL) " +
    "ORDER BY e.date, COALESCE(e.time, '00:00') LIMIT 120"
  ).bind(from, to).all();
  return {
    from, to,
    timezone: "시간은 KST",
    count: results.length,
    events: results.map((e) => ({
      date: e.date, time: e.time, kind: e.kind, title: e.title,
      security: e.security_name ? { name: e.security_name, ticker: e.ticker } : null,
      detail: e.detail ? JSON.parse(e.detail) : null,
      source: e.source,
    })),
  };
}

// ── 5. 거시 ─────────────────────────────────────────
async function getMacro(env) {
  const [defs, latest, year, dots] = await env.DB.batch([
    env.DB.prepare("SELECT series_id, name, unit, source FROM macro_series WHERE series_id NOT LIKE 'FED_DOTS_%' ORDER BY series_id"),
    env.DB.prepare(
      "SELECT m.series_id, m.date, m.value FROM macro m JOIN " +
      "(SELECT series_id, MAX(date) AS d FROM macro WHERE series_id NOT LIKE 'FED_DOTS_%' GROUP BY series_id) t " +
      "ON t.series_id = m.series_id AND t.d = m.date"
    ),
    env.DB.prepare(
      "SELECT m.series_id, m.date, m.value FROM macro m JOIN " +
      "(SELECT series_id, MAX(date) AS d FROM macro WHERE series_id NOT LIKE 'FED_DOTS_%' AND date <= date('now', '-1 year') GROUP BY series_id) t " +
      "ON t.series_id = m.series_id AND t.d = m.date"
    ),
    env.DB.prepare(
      "SELECT series_id, date, value FROM macro WHERE series_id = " +
      "(SELECT series_id FROM macro_series WHERE series_id LIKE 'FED_DOTS_%' ORDER BY series_id DESC LIMIT 1) ORDER BY date"
    ),
  ]);
  const byId = new Map(latest.results.map((r) => [r.series_id, r]));
  const yearAgo = new Map(year.results.map((r) => [r.series_id, r]));
  const dr = dots.results;
  const LONG_RUN = "2099-01-01";
  return {
    as_of: nowKst(),
    series: defs.results.map((d) => {
      const cur = byId.get(d.series_id);
      const old = yearAgo.get(d.series_id);
      return {
        series_id: d.series_id, name: d.name, unit: d.unit, source: d.source,
        latest: cur ? { date: cur.date, value: cur.value } : null,
        year_ago: old ? { date: old.date, value: old.value } : null,
        change_1y: cur && old ? round(cur.value - old.value, 3) : null,
      };
    }),
    fed_dots: dr.length
      ? {
          meeting: dr[0].series_id.slice(-6, -2) + "-" + dr[0].series_id.slice(-2),
          median_by_year: Object.fromEntries(dr.filter((r) => r.date !== LONG_RUN).map((r) => [r.date.slice(0, 4), r.value])),
          long_run: dr.find((r) => r.date === LONG_RUN)?.value ?? null,
          note: "점도표 중간값(수동 입력). 예측이 아니라 연준 위원들의 전망치다.",
        }
      : null,
  };
}

// ── 6. 기술적 판정 기록 ────────────────────────────────
function callOut(c) {
  return {
    called_at: c.called_at, side: c.side, label: c.label, price_at: c.price_at,
    price_1w: c.price_1w, price_1m: c.price_1m,
    change_1w_pct: c.price_1w ? pct(c.price_1w / c.price_at - 1) : null,
    change_1m_pct: c.price_1m ? pct(c.price_1m / c.price_at - 1) : null,
    action: c.action, note: c.note,
    indicators: c.indicators ? JSON.parse(c.indicators) : undefined,
  };
}

async function getTechCalls(env, args) {
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const binds = [];
  let where = "";
  if (args.ticker) {
    const sec = await findSecurity(env, args.ticker);
    binds.push(sec.id);
    where = "WHERE c.security_id = ?" + binds.length + " ";
  }
  binds.push(limit);
  const { results } = await env.DB.prepare(
    "SELECT c.*, s.name, s.ticker FROM tech_calls c JOIN securities s ON s.id = c.security_id " + where +
    "ORDER BY c.called_at DESC, c.id DESC LIMIT ?" + binds.length
  ).bind(...binds).all();
  return {
    as_of: nowKst(),
    rule: "판정은 매수·매도 직전의 단기 과열/침체 점검 기록이다. 투자의견이나 예측력 평가와 섞지 말고, " +
      "여기서 '며칠 뒤에 사라' 같은 예측형 조언을 만들지 않는다. 1주·1개월 뒤 가격은 사실 기록일 뿐이다.",
    count: results.length,
    calls: results.map((c) => ({ name: c.name, ticker: c.ticker, ...callOut(c) })),
  };
}

// ── 7. 테마·섹터 메모 ──────────────────────────────────
// 종목 의견과 다른 기록이다. 목표가·등급이 없고 성과를 채점하지 않는다 (SPEC §5.9).
async function getNotes(env, args) {
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const where = [];
  const binds = [];
  if (args.tag) {
    binds.push(String(args.tag));
    where.push("EXISTS (SELECT 1 FROM json_each(n.tags) WHERE json_each.value = ?" + binds.length + ")");
  }
  if (args.ticker) {
    const sec = await findSecurity(env, args.ticker);
    binds.push(sec.id);
    where.push("EXISTS (SELECT 1 FROM note_securities ns WHERE ns.note_id = n.id AND ns.security_id = ?" + binds.length + ")");
  }
  binds.push(limit);
  const { results } = await env.DB.prepare(
    "SELECT n.* FROM notes n " + (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
    "ORDER BY n.created_at DESC, n.id DESC LIMIT ?" + binds.length
  ).bind(...binds).all();
  if (!results.length) return { as_of: nowKst(), count: 0, notes: [] };

  const ids = results.map((r) => r.id);
  const { results: links } = await env.DB.prepare(
    "SELECT ns.note_id, s.name, s.ticker, s.currency, " +
    "(SELECT p.close FROM prices p WHERE p.security_id = s.id AND p.date <= substr(n.created_at, 1, 10) ORDER BY p.date DESC LIMIT 1) AS price_at_note, " +
    "(SELECT p.close FROM prices p WHERE p.security_id = s.id ORDER BY p.date DESC LIMIT 1) AS last_price " +
    "FROM note_securities ns JOIN securities s ON s.id = ns.security_id JOIN notes n ON n.id = ns.note_id " +
    "WHERE ns.note_id IN (" + ids.map((_, i) => "?" + (i + 1)).join(",") + ") ORDER BY s.name"
  ).bind(...ids).all();

  return {
    as_of: nowKst(),
    rule: "메모는 채점하지 않는 기록이다. 연결 종목의 이후 수익률은 사실일 뿐 적중·실패 판정이 아니다. " +
      "투자의견(views)의 적중률과 섞지 마라.",
    count: results.length,
    notes: results.map((n) => ({
      id: n.id,
      created_at: n.created_at,
      backdated: n.backdated === 1,
      title: n.title,
      body: n.body,
      tags: n.tags ? JSON.parse(n.tags) : [],
      stance: n.stance,
      edited_at: n.edited_at,
      securities: links.filter((l) => l.note_id === n.id).map((l) => ({
        name: l.name, ticker: l.ticker,
        price_at_note: l.price_at_note,
        last_price: l.last_price,
        since_note_pct: l.price_at_note > 0 && l.last_price > 0 ? pct(l.last_price / l.price_at_note - 1) : null,
      })),
    })),
  };
}

// ── 툴 정의 ─────────────────────────────────────────
const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };
const TICKER = { type: "string", description: "종목 티커·야후 심볼·한글 이름 (예: NVDA, 005930, 삼성전자)" };

export const READ_TOOLS = [
  {
    name: "get_portfolio",
    title: "보유 포트폴리오",
    description: "지금 보유 중인 종목, 수량, 평단, 최신 종가, 원화 평가금액, 비중, 손익과 현금을 준다. " +
      "금액은 원화 환산이고 시세는 저장된 일별 종가(지연)다.",
    inputSchema: NO_ARGS,
    run: (env) => getPortfolio(env),
  },
  {
    name: "get_investment_views",
    title: "투자의견",
    description: "기록해 둔 투자의견(등급·목표주가·기간·근거·리스크)과 지난 의견의 성과 평가를 준다. " +
      "ticker를 주면 그 종목의 이력 전부, 안 주면 종목별 현재 의견.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: TICKER,
        limit: { type: "integer", description: "최대 행 수 (기본 30, 최대 200)" },
        latest_only: { type: "boolean", description: "종목별 최신 의견만 (기본 true, ticker를 주면 무시)" },
      },
      additionalProperties: false,
    },
    run: (env, args) => getViews(env, args),
  },
  {
    name: "get_company_view",
    title: "종목 한 장",
    description: "한 종목의 현재가·52주 범위·보유 상태·재무(분기/연간, TTM)·컨센서스·내 투자의견·최근 기술적 판정·다가오는 일정을 한 번에 준다.",
    inputSchema: { type: "object", properties: { ticker: TICKER }, required: ["ticker"], additionalProperties: false },
    run: (env, args) => getCompany(env, args),
  },
  {
    name: "get_calendar",
    title: "일정",
    description: "실적 발표일, FOMC·금통위, CPI·고용 같은 거시 일정과 직접 넣은 일정을 기간으로 준다. 기본은 오늘부터 30일.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "시작일 YYYY-MM-DD (기본 오늘)" },
        to: { type: "string", description: "종료일 YYYY-MM-DD (기본 시작일 + 30일)" },
      },
      additionalProperties: false,
    },
    run: (env, args) => getCalendar(env, args),
  },
  {
    name: "get_macro",
    title: "거시 지표",
    description: "한·미 기준금리, 국채금리, 물가 등 저장된 거시 시계열의 최신값과 1년 전 대비 변화, 최신 점도표 중간값을 준다.",
    inputSchema: NO_ARGS,
    run: (env) => getMacro(env),
  },
  {
    name: "get_notes",
    title: "테마·섹터 메모",
    description:
      "종목이 아니라 테마·섹터·매크로에 대해 적어 둔 자유 메모를 준다(예: '에이전틱 AI 확산으로 CPU 주목'). " +
      "목표가·등급이 없는 기록이고, 연결 종목의 기록 이후 수익률은 사실로만 붙는다. 투자의견의 적중률과 섞지 마라.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "태그로 거르기 (예: AI, 매크로)" },
        ticker: TICKER,
        limit: { type: "integer", description: "최대 건수 (기본 20, 최대 100)" },
      },
      additionalProperties: false,
    },
    run: (env, args) => getNotes(env, args),
  },
  {
    name: "get_tech_calls",
    title: "기술적 판정 기록",
    description: "매수·매도 직전에 남긴 단기 과열/침체 판정 기록과 그 뒤 1주·1개월 가격을 준다. 투자의견과는 별개의 기록이다.",
    inputSchema: {
      type: "object",
      properties: { ticker: TICKER, limit: { type: "integer", description: "최대 행 수 (기본 20, 최대 100)" } },
      additionalProperties: false,
    },
    run: (env, args) => getTechCalls(env, args),
  },
];

export { ToolError };
