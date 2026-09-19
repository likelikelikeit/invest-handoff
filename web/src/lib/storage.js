// localStorage 안전 래퍼 (기존 index.html의 safe storage 패턴).
// 사파리 사생활 보호 모드처럼 접근이 막혀도 앱이 죽지 않고 메모리에만 둔다.

const mem = new Map();

function ls() {
  try {
    const s = globalThis.localStorage;
    const k = "__probe__";
    s.setItem(k, "1");
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export const store = {
  get(key, fallback = null) {
    const s = ls();
    const v = s ? s.getItem(key) : mem.get(key);
    return v == null ? fallback : v;
  },
  set(key, value) {
    const s = ls();
    if (s) s.setItem(key, value);
    else mem.set(key, value);
  },
  remove(key) {
    const s = ls();
    if (s) s.removeItem(key);
    mem.delete(key);
  },
};
