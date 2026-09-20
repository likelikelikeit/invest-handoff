// 테스트용 데이터. worker의 D1 흉내(node:sqlite) 위에 실제 마이그레이션으로 만든 DB를 쓴다.
import { makeDb } from "../../worker/test/d1shim.js";

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
export const dayAgo = (n) => day(-n);

export function seed() {
  const db = makeDb();
  const at = "2026-09-01T00:00:00+09:00";
  const sec = (name, ticker, ysym, market, ccy, sector, cls = "equity") =>
    db.raw.prepare(
      "INSERT INTO securities (name, ticker, ysym, market, currency, sector, asset_class, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
    ).get(name, ticker, ysym, market, ccy, sector, cls, at, at).id;

  const nvda = sec("엔비디아", "NVDA", "NVDA", "US", "USD", "반도체·AI");
  const sam = sec("삼성전자", "005930", "005930.KS", "KR", "KRW", "반도체·AI");
  // 원/달러는 마이그레이션 0002가 이미 넣어 둔다.
  const fx = db.raw.prepare("SELECT id FROM securities WHERE ysym = 'KRW=X'").get().id;

  const price = db.raw.prepare("INSERT INTO prices (security_id, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)");
  // 최근 60거래일치. NVDA 100 → 120, 삼성 70000 고정, 환율 1300.
  for (let i = 59; i >= 0; i--) {
    const d = dayAgo(i);
    const c = 100 + (59 - i) * (20 / 59);
    price.run(nvda, d, c, c * 1.01, c * 0.99, c, 1000);
    price.run(sam, d, 70000, 70500, 69500, 70000, 2000);
    price.run(fx, d, 1300, 1300, 1300, 1300, 0);
  }

  db.raw.prepare("INSERT INTO positions (security_id, qty, avg_price, avg_ccy, source, updated_at) VALUES (?, ?, ?, ?, 'manual', ?)")
    .run(nvda, 10, 100, "USD", at);
  db.raw.prepare("INSERT INTO positions (security_id, qty, avg_price, avg_ccy, source, updated_at) VALUES (?, ?, ?, ?, 'manual', ?)")
    .run(sam, 100, 60000, "KRW", at);
  db.raw.prepare("INSERT INTO cash (currency, amount, updated_at) VALUES ('KRW', 1000000, ?)").run(at);

  // 의견 2건(같은 종목의 변화) + 평가된 것 1건
  const view = db.raw.prepare(
    "INSERT INTO views (security_id, created_at, rating, rating_score, target_price, target_ccy, horizon_months, thesis, " +
    "price_at, price_at_source, upside_pct, evaluated_at, hit, actual_return, target_return, abs_error) " +
    "VALUES (?, ?, ?, ?, ?, ?, 12, ?, ?, 'test', ?, ?, ?, ?, ?, ?)"
  );
  view.run(nvda, "2026-06-01T09:00:00+09:00", "매수", 2, 150, "USD", "AI 수요", 100, 0.5,
           "2026-09-01T00:00:00+09:00", 1, 0.2, 0.5, 0.3);
  view.run(nvda, "2026-09-10T09:00:00+09:00", "적극 매수", 3, 180, "USD", "데이터센터 증설", 120, 0.5, null, null, null, null, null);
  view.run(sam, "2026-09-05T09:00:00+09:00", "보유", 1, 75000, "KRW", "메모리 사이클", 70000, 0.0714, null, null, null, null, null);

  // 재무 4개 분기 + 컨센서스
  const fin = db.raw.prepare(
    "INSERT INTO financials (security_id, period_end, period_type, revenue, operating_income, net_income, eps, bps, source, fetched_at) " +
    "VALUES (?, ?, 'Q', ?, ?, ?, ?, ?, 'sec', ?)"
  );
  ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"].forEach((p, i) =>
    fin.run(nvda, p, 1000 + i * 100, 400, 300 + i * 10, 1 + i * 0.1, 20, at));
  db.raw.prepare(
    "INSERT INTO estimates (security_id, source, as_of, fiscal_year, eps, target_price, rating_mean, n_analysts) " +
    "VALUES (?, 'yahoo', '2026-09-15', 2026, 5.2, 160, 1.8, 42)"
  ).run(nvda);

  // 일정
  const ev = db.raw.prepare("INSERT INTO events (date, time, kind, security_id, title, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  ev.run(day(3), "06:00", "earnings", nvda, "엔비디아 실적 발표", "yahoo", at);
  ev.run(day(10), "03:00", "macro", null, "FOMC 결과 발표", "manual", at);
  ev.run(day(100), null, "macro", null, "먼 미래 일정", "manual", at);

  // 거시 (최신 + 1년 전) + 점도표
  // FEDFUNDS 등 시리즈 정의는 마이그레이션 0005가 이미 넣어 둔다. 값만 채운다.
  db.raw.prepare("INSERT OR IGNORE INTO macro_series (series_id, name, unit, source) VALUES ('FED_DOTS_202609', '점도표 2026-09', '%', 'manual')").run();
  const macro = db.raw.prepare("INSERT INTO macro (series_id, date, value) VALUES (?, ?, ?)");
  macro.run("FEDFUNDS", dayAgo(400), 5.0);
  macro.run("FEDFUNDS", dayAgo(1), 4.0);
  macro.run("FED_DOTS_202609", "2026-01-01", 3.6);
  macro.run("FED_DOTS_202609", "2099-01-01", 3.0);

  // 판정 기록
  const rs = db.raw.prepare("INSERT INTO tech_rule_sets (created_at, config) VALUES (?, '{}') RETURNING id").get(at).id;
  db.raw.prepare(
    "INSERT INTO tech_calls (security_id, side, called_at, rule_set_id, price_at, indicators, label, action, price_1w, price_1m) " +
    "VALUES (?, 'buy', '2026-08-01T10:00:00+09:00', ?, 100, ?, 'low', 'bought', 105, 110)"
  ).run(nvda, rs, JSON.stringify([{ key: "rsi14", value: 28.4, verdict: "low" }]));

  return { db, ids: { nvda, sam, fx } };
}

export const env = (db) => ({ DB: db, APP_TOKEN: "test-app-token" });
