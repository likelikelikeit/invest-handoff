// 어느 화면에서든 여는 시트들의 상태 (전역 + 버튼, 종목 탭 등에서 연다).

import { api } from "./api.js";

export const ui = $state({
  fab: false, // 전역 + 메뉴
  add: null, // 종목 추가 시트: { prefill? } 또는 null
  importOpen: false, // 스크린샷 가져오기
  changes: [], // 답할 보유 변화 (변화 감지 질문)
  viewForm: null, // 의견 기록/편집 시트: { securityId?, edit? } 또는 null
  toast: "",
});

/** 서버가 돌려준 changes를 질문 시트로 */
export function askChanges(changes) {
  if (changes && changes.length) ui.changes = changes;
}

/** 앱을 열 때 답하지 않은 변화가 남아 있으면 다시 묻는다 */
export async function loadPendingChanges() {
  try {
    const r = await api("/portfolio/changes?pending=1");
    return r.changes;
  } catch {
    return [];
  }
}

let toastTimer = null;
export function toast(text) {
  ui.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast = ""), 2600);
}
