import { describe, it, expect } from "vitest";
import { parseKindIr, isEarningsIr, krEarningsFromKind } from "../src/sources/kind.js";

const R = (title, date, place = "-", time = "09:00") => ({ title, place, date, time });

describe("KIND IR 일정", () => {
  it("목록 HTML → 행 (번호·회사·제목·장소·일자·시각)", () => {
    const html = '<table><tr><th>번호</th></tr><tr><td>156</td><td><a>SK하이닉스</a></td><td>2026년 3분기 경영실적 발표</td>' +
      '<td>-</td><td>2026-10-28</td><td>09:00</td></tr><tr><td>1</td><td>x</td><td>y &amp; z</td><td>a</td><td>2026-10-01</td><td>--:--</td></tr></table>';
    expect(parseKindIr(html)).toEqual([
      { title: "2026년 3분기 경영실적 발표", place: "-", date: "2026-10-28", time: "09:00" },
      { title: "y & z", place: "a", date: "2026-10-01", time: null },
    ]);
  });

  it("실적 발표 IR만 고른다 (2026-10 실제 목록의 제목들)", () => {
    const yes = [
      R("2026년 3분기 경영실적 발표", "2026-10-28"), R("Q3 2026 Earnings Release", "2026-10-22"),
      R("To discuss FY 2026 Q3 Financial Results", "2026-10-28"), R("2026년도 3분기 경영실적 설명회", "2026-10-22"),
      R("2026 Q3 Earnings Conference call", "2026-10-19"), R("2026년 3분기 실적 설명", "2026-10-15", "컨퍼런스콜"),
      R("2026년 3분기 실적발표", "2026-11-03"),
    ];
    const no = [
      R("회사현황 및 경영실적에 대한 투자자 이해증진", "2026-10-06"), R("최근 경영실적 등 주요 관심사항 설명", "2026-10-06", "도쿄"),
      R("2026년 2분기 경영실적 및 Value-up 2.0 설명", "2026-10-13", "홍콩"), R("2026년 3분기 실적 설명", "2026-10-16", "여의도 등"),
      R("BNK 2026 K-beauty Corporate Day 참석", "2026-10-01"), R("사업 현황 및 경영 실적 업데이트", "2026-10-14"),
    ];
    expect(yes.filter(isEarningsIr)).toHaveLength(yes.length);
    expect(no.filter(isEarningsIr)).toEqual([]);
  });

  it("오늘 이후 가장 가까운 실적 IR, 같은 날 국문 제목을 남긴다", () => {
    const rows = [
      R("To discuss FY 2026 Q2 Financial Results", "2026-07-29"), R("2026년 2분기 경영실적 발표", "2026-07-29"),
      R("To discuss FY 2026 Q3 Financial Results", "2026-10-28"), R("2026년 3분기 경영실적 발표", "2026-10-28"),
    ];
    expect(krEarningsFromKind(rows, "2026-10-22")).toEqual({
      date: "2026-10-28", time: "09:00", confirmed: 1, detail: { basis: "KIND IR 일정", title: "2026년 3분기 경영실적 발표" },
    });
    expect(krEarningsFromKind(rows, "2026-10-29")).toBeNull();
  });
});
