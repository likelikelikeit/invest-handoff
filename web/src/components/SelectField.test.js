import { describe, it, expect, vi } from "vitest";
import { mount, flushSync } from "svelte";
import SelectField from "./SelectField.svelte";

describe("SelectField", () => {
  it("선택 목록을 열고 값을 고른다", () => {
    const target = document.createElement("div");
    const change = vi.fn();
    mount(SelectField, { target, props: {
      value: "held", ariaLabel: "목록 종류", onchange: change,
      options: [{ value: "held", label: "보유" }, { value: "watch", label: "관심" }],
    } });
    flushSync();
    target.querySelector('[aria-haspopup="listbox"]').click();
    flushSync();
    expect(target.querySelectorAll('[role="option"]')).toHaveLength(2);
    target.querySelectorAll('[role="option"]')[1].click();
    flushSync();
    expect(change).toHaveBeenCalledWith("watch");
    expect(target.textContent).toContain("관심");
  });
});
