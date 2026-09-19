import { describe, it, expect } from "vitest";
import { parseHash } from "./router.svelte.js";
import { activeTab } from "./tabs.js";

describe("parseHash", () => {
  it("빈 해시는 홈", () => {
    expect(parseHash("")).toEqual({ path: "/", parts: [] });
    expect(parseHash("#/")).toEqual({ path: "/", parts: [] });
  });
  it("경로 조각을 나눈다", () => {
    expect(parseHash("#/security/12").parts).toEqual(["security", "12"]);
  });
});

describe("activeTab", () => {
  it("종목 상세는 종목 탭", () => expect(activeTab(["security", "3"])).toBe("securities"));
  it("모르는 경로는 홈", () => expect(activeTab(["nope"])).toBe("home"));
  it("탭 키 그대로", () => expect(activeTab(["views"])).toBe("views"));
});
