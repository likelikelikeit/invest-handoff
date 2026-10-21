// 크론 한 번의 서브요청 계량기. 무료 플랜은 호출당 서브요청 50개까지이고,
// 외부 fetch뿐 아니라 D1 같은 Cloudflare 서비스 호출도 같은 한도에 들어간다(SPEC §7.3).
// 넘으면 그 뒤 요청이 전부 "Too many subrequests"로 죽고 같은 실행의 다른 종목까지 실패한다.
// 그래서 (1) 실제로 몇 번 불렀는지 세어 보고에 남기고, (2) 비싼 단계 앞에서 남은 예산을 보고 멈춘다.
//
// fetch 전역과 D1 문장·배치 메서드를 잠깐 감싸는 방식이다. 크론 실행은 한 isolate에서 하나씩 돌므로
// 충분하고, 끝나면 restore()로 되돌린다.

export const SUBREQUEST_LIMIT = 50;
// 소스가 재시도·세션 갱신으로 예상보다 한두 번 더 부를 수 있어 여유를 둔다.
export const SUBREQUEST_BUDGET = 44;

export function meter(env) {
  const m = {
    fetches: 0,
    d1: 0,
    left() { return SUBREQUEST_BUDGET - m.fetches - m.d1; },
  };
  const undo = [];
  const wrap = (obj, key, count) => {
    const orig = obj?.[key];
    if (typeof orig !== "function") return;
    // 바인딩이 덮어쓰기를 막아 두었으면 세지 않을 뿐, 크론은 그대로 돈다
    try {
      obj[key] = function (...args) { count(); return orig.apply(this, args); };
      undo.push(() => { obj[key] = orig; });
    } catch { /* 계량 포기 */ }
  };

  wrap(globalThis, "fetch", () => m.fetches++);
  if (env?.DB) {
    const stmtProto = Object.getPrototypeOf(env.DB.prepare("SELECT 1"));
    for (const k of ["first", "all", "run", "raw"]) wrap(stmtProto, k, () => m.d1++);
    wrap(Object.hasOwn(env.DB, "batch") ? env.DB : Object.getPrototypeOf(env.DB), "batch", () => m.d1++);
  }
  m.restore = () => { while (undo.length) undo.pop()(); };
  return m;
}
