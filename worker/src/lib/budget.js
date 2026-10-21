// 크론 한 번의 호출 계량기 (SPEC §7.3). 무료 플랜은 호출당
//   - 외부 fetch(서브요청) 50개
//   - D1 쿼리 50개 (batch 안의 문장도 하나씩 센다)
// 가 따로따로 한도다. 매일 도는 거시 크론이 fetch ~23 + D1 ~42로 오류 없이 도는 게 둘이 별개라는 근거다.
// 넘으면 그 뒤 호출이 전부 "Too many subrequests"로 죽고 같은 실행의 다른 종목까지 실패한다.
// 그래서 (1) 실제로 몇 번 불렀는지 세어 보고에 남기고, (2) 비싼 단계 앞에서 남은 예산을 보고 멈춘다.
//
// fetch 전역과 D1 문장·배치 메서드를 잠깐 감싸는 방식이다. 크론 실행은 한 isolate에서 하나씩 돌므로
// 충분하고, 끝나면 restore()로 되돌린다.

export const SUBREQUEST_LIMIT = 50;
// 소스가 재시도·세션 갱신으로 예상보다 몇 번 더 부를 수 있어 여유를 둔다.
export const FETCH_BUDGET = 44;
export const D1_BUDGET = 44;

export function meter(env) {
  const m = {
    fetches: 0,
    d1: 0,
    fetchLeft() { return FETCH_BUDGET - m.fetches; },
    d1Left() { return D1_BUDGET - m.d1; },
  };
  const undo = [];
  const wrap = (obj, key, count) => {
    const orig = obj?.[key];
    if (typeof orig !== "function") return;
    // 바인딩이 덮어쓰기를 막아 두었으면 세지 않을 뿐, 크론은 그대로 돈다
    try {
      obj[key] = function (...args) { count(...args); return orig.apply(this, args); };
      undo.push(() => { obj[key] = orig; });
    } catch { /* 계량 포기 */ }
  };

  wrap(globalThis, "fetch", () => m.fetches++);
  if (env?.DB) {
    const stmtProto = Object.getPrototypeOf(env.DB.prepare("SELECT 1"));
    for (const k of ["first", "all", "run", "raw"]) wrap(stmtProto, k, () => m.d1++);
    wrap(Object.hasOwn(env.DB, "batch") ? env.DB : Object.getPrototypeOf(env.DB), "batch",
      (stmts) => { m.d1 += Array.isArray(stmts) ? stmts.length : 1; });
  }
  m.restore = () => { while (undo.length) undo.pop()(); };
  return m;
}
