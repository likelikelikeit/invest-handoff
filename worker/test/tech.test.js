import { describe, it, expect } from "vitest";
import { wilderRsi, sma, stdev, computeIndicators, judge, validateRules, DEFAULT_RULES } from "../src/lib/tech.js";

describe("wilderRsi", () => {
  // StockCharts의 Wilder RSI 예시. 그 표는 평균 상승·하락(0.2386, 0.0996)을 0.24, 0.10으로 반올림해 70.53·66.32를 낸다.
  // 반올림 없이 계산하면 70.46·66.25다.
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  it("첫 RSI는 단순 평균", () => expect(wilderRsi(closes)).toBeCloseTo(70.464, 2));
  it("이후는 Wilder 평활", () => expect(wilderRsi(closes.concat(46.0))).toBeCloseTo(66.250, 2));
  it("데이터가 모자라면 null, 한 방향이면 100", () => {
    expect(wilderRsi(closes.slice(0, 10))).toBeNull();
    expect(wilderRsi(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(100);
  });
});

describe("sma / stdev", () => {
  it("최근 n개", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9], 8)).toBe(2);
    expect(sma([1], 2)).toBeNull();
  });
});

// 100일: 평탄하다가 마지막에 급등 → 과열 쪽
function bars(n, f, vol = () => 1000) {
  return Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10), close: c, high: c, low: c, volume: vol(i) };
  });
}

describe("computeIndicators", () => {
  it("장중 가격은 오늘 봉으로, 거래량은 직전 완결 봉 기준", () => {
    const b = bars(80, () => 100);
    const r = computeIndicators(b, { price: 110, date: "2026-12-31" });
    expect(r.intraday).toBe(true);
    expect(r.price).toBe(110);
    expect(r.as_of).toBe("2026-12-31");
    expect(r.values.dev20).toBeCloseTo(110 / ((19 * 100 + 110) / 20) - 1);
    expect(r.vol.date).toBe(b[79].date);
  });
  it("장중 가격 날짜가 마지막 봉과 같거나 이르면 무시", () => {
    const b = bars(80, () => 100);
    expect(computeIndicators(b, { price: 999, date: b[79].date }).intraday).toBe(false);
  });
});

describe("judge", () => {
  const hot = bars(100, (i) => (i < 80 ? 100 : 100 + (i - 79) * 3), (i) => (i === 99 ? 5000 : 1000));

  it("매수: 과열 3개 이상이면 단기 과열(high)", () => {
    const j = judge(computeIndicators(hot), DEFAULT_RULES, "buy");
    expect(j.overheat_sum).toBeGreaterThanOrEqual(3);
    expect(j.label).toBe("high");
    expect(j.label_text).toBe("단기 과열");
    expect(j.indicators.find((x) => x.key === "vol_ratio").verdict).toBe("과열"); // 상승일 급증
  });
  it("매도: 같은 지표, 라벨 의미가 뒤집힌다 (청산 부담 낮음)", () => {
    const j = judge(computeIndicators(hot), DEFAULT_RULES, "sell");
    expect(j.label).toBe("low");
    expect(j.label_text).toBe("청산 부담 낮음");
  });
  it("침체 쪽: 진입 부담 낮음 / 단기 침체", () => {
    const cold = bars(100, (i) => (i < 80 ? 100 : 100 - (i - 79) * 2));
    expect(judge(computeIndicators(cold), DEFAULT_RULES, "buy").label).toBe("low");
    expect(judge(computeIndicators(cold), DEFAULT_RULES, "sell").label_text).toBe("단기 침체");
  });
  it("하락일 거래량 급증은 판정에 넣지 않고 참고로", () => {
    const down = bars(100, (i) => (i < 99 ? 100 : 95), (i) => (i === 99 ? 5000 : 1000));
    const j = judge(computeIndicators(down), DEFAULT_RULES, "buy");
    expect(j.indicators.find((x) => x.key === "vol_ratio").verdict).toBe("보통");
    expect(j.refs.some((r) => r.key === "down_volume_spike")).toBe(true);
  });
  it("꺼진 지표·데이터 없음은 세지 않는다", () => {
    const rules = structuredClone(DEFAULT_RULES);
    rules.indicators.rsi14.enabled = false;
    const j = judge(computeIndicators(bars(30, () => 100)), rules, "buy");
    expect(j.indicators.find((x) => x.key === "rsi14").verdict).toBe("꺼짐");
    expect(j.indicators.find((x) => x.key === "dev60").verdict).toBe("데이터 없음");
    expect(j.label).toBe("neutral");
  });
});

describe("validateRules", () => {
  it("기본 규칙은 통과", () => expect(validateRules(DEFAULT_RULES)).toEqual(DEFAULT_RULES));
  it("숫자 아님·역전·0 이하 기준은 거부", () => {
    const bad = structuredClone(DEFAULT_RULES);
    bad.indicators.rsi14.overheat = "많이";
    expect(() => validateRules(bad)).toThrow(/숫자/);
    const inv = structuredClone(DEFAULT_RULES);
    inv.indicators.dev20.oversold = 0.1;
    expect(() => validateRules(inv)).toThrow(/침체 기준/);
    const agg = structuredClone(DEFAULT_RULES);
    agg.aggregate.high_threshold = 0;
    expect(() => validateRules(agg)).toThrow(/집계/);
  });
});
