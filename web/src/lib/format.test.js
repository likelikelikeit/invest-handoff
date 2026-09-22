import { describe, it, expect } from "vitest";
import { textBlocks, won, pctSigned, qtyStr, slashDate } from "./format.js";

describe("textBlocks", () => {
  it("한 줄씩 쓰면 불릿", () => {
    expect(textBlocks("데이터센터 수요\n경쟁 심화는 2028년 이후")).toEqual([
      { kind: "li", text: "데이터센터 수요" },
      { kind: "li", text: "경쟁 심화는 2028년 이후" },
    ]);
  });

  it("빈 줄로 나누면 문단, 문단 안 줄바꿈은 그대로", () => {
    const t = "추론 수요가 학습을 넘어선다.\n작년 4분기부터 믹스가 바뀌었다.\n\n다만 전력이 병목이다.";
    expect(textBlocks(t)).toEqual([
      { kind: "p", text: "추론 수요가 학습을 넘어선다.\n작년 4분기부터 믹스가 바뀌었다." },
      { kind: "p", text: "다만 전력이 병목이다." },
    ]);
  });

  it("한 줄로 길게 써도 그대로 한 덩어리", () => {
    const long = "가".repeat(600);
    expect(textBlocks(long)).toEqual([{ kind: "li", text: long }]);
  });

  it("빈 값과 공백만 있는 줄은 버린다", () => {
    expect(textBlocks("")).toEqual([]);
    expect(textBlocks("   \n  \n ")).toEqual([]);
    expect(textBlocks("첫 줄\n   \n둘째 줄")).toEqual([
      { kind: "p", text: "첫 줄" },
      { kind: "p", text: "둘째 줄" },
    ]);
  });

  it("윈도 줄바꿈(CRLF)도 같은 결과", () => {
    expect(textBlocks("한 줄\r\n두 줄")).toEqual([
      { kind: "li", text: "한 줄" },
      { kind: "li", text: "두 줄" },
    ]);
  });
});

describe("기존 표기 규칙", () => {
  it("금액은 축약하지 않는다", () => {
    expect(won(15828706)).toBe("15,828,706원");
    expect(won(-3000)).toBe("−3,000원");
  });

  it("부호와 수량", () => {
    expect(pctSigned(12.5)).toBe("+12.50%");
    expect(qtyStr(4.134)).toBe("4.134");
    expect(qtyStr(16)).toBe("16");
  });
});

describe("slashDate", () => {
  it("yyyy-mm-dd를 yyyy/mm/dd로", () => {
    expect(slashDate("2027-08-26")).toBe("2027/08/26");
    expect(slashDate("2026-09-21T00:00:00+09:00")).toBe("2026/09/21");
    expect(slashDate(null)).toBe("");
  });
});
