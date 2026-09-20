import { describe, it, expect } from "vitest";
import { addDays, dayLabel, dday, eventTitle, fedTargetRanges, groupByMonth, latestFedTarget, latestWithChange, ratePath } from "./calendar.js";

describe("일정 표시", () => {
  it("날짜 계산과 표기", () => {
    expect(addDays("2026-09-19", 30)).toBe("2026-10-19");
    expect(dayLabel("2026-10-29")).toBe("10/29(목)");
    expect(dday("2026-09-19", "2026-09-19")).toBe("오늘");
    expect(dday("2026-09-20", "2026-09-19")).toBe("내일");
    expect(dday("2026-10-29", "2026-09-19")).toBe("D-40");
  });
  it("제목: 실적은 종목 이름으로", () => {
    expect(eventTitle({ kind: "earnings", title: "실적 발표 예정", security_name: "엔비디아" })).toBe("엔비디아 실적 발표");
    expect(eventTitle({ kind: "macro", title: "FOMC 금리 결정" })).toBe("FOMC 금리 결정");
    expect(eventTitle({ kind: "corporate", title: "삼성전자 3분기 실적", security_name: "삼성전자" })).toBe("삼성전자 3분기 실적");
    expect(eventTitle({ kind: "corporate", title: "주주총회", security_name: "하이브" })).toBe("하이브 · 주주총회");
  });
  it("월별 묶기", () => {
    const g = groupByMonth([{ date: "2026-10-02" }, { date: "2026-10-14" }, { date: "2026-11-06" }]);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([["2026년 10월", 2], ["2026년 11월", 1]]);
  });
});

describe("거시", () => {
  it("최신 값과 직전과 다른 값", () => {
    expect(latestWithChange([["2026-07-01", 2.75], ["2026-08-01", 2.5], ["2026-09-01", 2.5]]))
      .toEqual({ date: "2026-09-01", value: 2.5, prev: { date: "2026-07-01", value: 2.75 } });
    expect(latestWithChange([])).toBeNull();
  });
  it("Fed 목표범위: 하단·상단을 합치고 직전 범위와 비교", () => {
    const series = {
      FED_TARGET_LOWER: { points: [["2026-07-01", 3.5], ["2026-09-17", 3.75]] },
      FED_TARGET_UPPER: { points: [["2026-07-01", 3.75], ["2026-09-17", 4.0]] },
    };
    expect(fedTargetRanges(series)).toEqual([
      { date: "2026-07-01", lower: 3.5, upper: 3.75, value: 3.625 },
      { date: "2026-09-17", lower: 3.75, upper: 4, value: 3.875 },
    ]);
    expect(latestFedTarget(series)).toEqual({
      date: "2026-09-17", lower: 3.75, upper: 4, value: 3.875,
      prev: { date: "2026-07-01", lower: 3.5, upper: 3.75, value: 3.625 },
    });
    expect(latestFedTarget({})).toBeNull();
  });
  it("금리 경로: 점도표는 마지막 Fed 목표범위 중간값에서 시작", () => {
    const p = ratePath({
      series: {
        FED_TARGET_LOWER: { points: [["2026-09-17", 3.75]] },
        FED_TARGET_UPPER: { points: [["2026-09-17", 4.0]] },
        DGS2: { points: [["2026-09-18", 3.58]] },
      },
      dots: { points: [["2026-12-31", 3.625], ["2027-12-31", 3.375]] },
    });
    expect(p.fed).toEqual([{ time: "2026-09-17", value: 3.875 }]);
    expect(p.dots).toEqual([{ time: "2026-09-17", value: 3.875 }, { time: "2026-12-31", value: 3.625 }, { time: "2027-12-31", value: 3.375 }]);
    expect(p.two).toHaveLength(1);
    expect(ratePath({ series: {} }).dots).toEqual([]);
  });
});
