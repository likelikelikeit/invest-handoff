// 하단 탭 5개 [확정, SPEC §4.1]
export const TABS = [
  { key: "home", label: "홈", href: "#/" },
  { key: "securities", label: "종목", href: "#/securities" },
  { key: "portfolio", label: "포트폴리오", href: "#/portfolio" },
  { key: "views", label: "의견", href: "#/views" },
  { key: "more", label: "더보기", href: "#/more" },
];

/** 해시 경로의 첫 조각으로 활성 탭을 정한다. 종목 상세(security/…)는 종목 탭 소속. */
export function activeTab(parts) {
  const head = parts[0];
  if (!head) return "home";
  if (head === "security") return "securities";
  return TABS.some((t) => t.key === head) ? head : "home";
}
