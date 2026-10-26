import { describe, it, expect } from "vitest";
import { mount, flushSync } from "svelte";
import App from "./App.svelte";

describe("App 스모크", () => {
  it("모의투자를 포함한 하단 탭 6개가 뜬다", () => {
    const target = document.createElement("div");
    mount(App, { target });
    flushSync();
    const labels = [...target.querySelectorAll("nav a")].map((a) => a.textContent.trim());
    expect(labels).toEqual(["홈", "종목", "포트폴리오", "투자의견", "모의투자", "더보기"]);
  });
});
