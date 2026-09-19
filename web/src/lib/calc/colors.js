// 종목 색 (SPEC §6.2). brand_color가 있으면 그것, 없으면 섹터 팔레트에서 순서대로.
// SECTORS는 기존 index.html 그대로.

export const SECTORS = {
  "반도체·AI": ["#0a4d9e", "#0f63bd", "#0071e3", "#2b8bf0", "#4b9ff5", "#68b0f8", "#85c1fa", "#9fcefb", "#b6dcfc", "#cbe7fd"],
  "헬스케어": ["#1f8f45", "#2bab55", "#34c759", "#5bd47a", "#86e09d"],
  "소비·플랫폼": ["#c2410c", "#e2560f", "#f97316", "#fb923c", "#fdba74"],
  "모빌리티": ["#6b21a8", "#8b31d1", "#a855f7", "#c084fc", "#d8b4fe"],
  "엔터·콘텐츠": ["#b8104a", "#dd1d5e", "#ff2d55", "#ff6382", "#ff92a7"],
  "금융": ["#0f6f74", "#13898f", "#17a2a9", "#43bcc2", "#77d3d7"],
  "에너지·소재": ["#7c5c10", "#9c7414", "#c0901a", "#d7ab43", "#e5c477"],
  "기타": ["#4b4b50", "#65656b", "#7f7f86", "#9a9aa0", "#b5b5ba"],
};

export const SECTOR_NAMES = Object.keys(SECTORS);

// 현금 조각: 회색 계열, 원화·달러는 명도 차이 (SPEC §6.2)
export const CASH_COLORS = {
  light: { KRW: "#c7c7cc", USD: "#aeaeb2" },
  dark: { KRW: "#48484a", USD: "#636366" },
};

/** 섹터 대표색(막대그래프 등) */
export function sectorColor(sec) {
  return (SECTORS[sec] || SECTORS["기타"])[2];
}

/**
 * holdings(평가액 큰 순서로 넘기는 게 좋다)에 색을 매긴다. 같은 섹터 안에서는 순서대로 팔레트를 내려간다.
 * → Map<id, color>
 */
export function assignColors(holdings) {
  const seen = {};
  const out = new Map();
  for (const h of holdings) {
    if (h.brandColor) {
      out.set(h.id, h.brandColor);
      continue;
    }
    const k = h.sec in SECTORS ? h.sec : "기타";
    const i = seen[k] || 0;
    const pal = SECTORS[k];
    out.set(h.id, pal[Math.min(i, pal.length - 1)]);
    seen[k] = i + 1;
  }
  return out;
}
