// 해시 라우터. GitHub Pages는 서버 폴백이 없어서 #/security/12 형태로 둔다.

/** "#/security/12" → { path: "/security/12", parts: ["security", "12"] } */
export function parseHash(hash) {
  const path = (hash || "").replace(/^#/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  return { path: path.startsWith("/") ? path : "/" + path, parts };
}

export const route = $state(parseHash(typeof location === "undefined" ? "" : location.hash));

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    Object.assign(route, parseHash(location.hash));
  });
}
