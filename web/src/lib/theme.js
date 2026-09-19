// 테마: 기본은 시스템 설정, 토글로 고정 (SPEC §6.2). 기존 index.html 방식.

import { store } from "./storage.js";

const KEY = "invest.theme";

export function applySavedTheme() {
  const t = store.get(KEY);
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
}

export function isDark() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "dark";
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  } catch {
    return false;
  }
}

/** mode: "system" | "light" | "dark" */
export function setTheme(mode) {
  if (mode === "system") {
    store.remove(KEY);
    document.documentElement.removeAttribute("data-theme");
  } else {
    store.set(KEY, mode);
    document.documentElement.setAttribute("data-theme", mode);
  }
}

export function themeMode() {
  const t = store.get(KEY);
  return t === "light" || t === "dark" ? t : "system";
}
