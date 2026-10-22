// DART를 Worker에서 부를지. 기본은 부르지 않는다 [2026-10-22].
// OpenDART는 Cloudflare 서버에서 온 요청을 오류 페이지로 돌려보낸다(302 → error1.html). 예전 코드는 그 리다이렉트를
// 따라가다 서브요청 한도(50)를 태워 "Too many subrequests"가 났다. DART는 맥 미니(국내 가정 회선)의
// scripts/dart-sync.mjs·dart-history.mjs가 맡는다. 다시 Worker에서 시험하려면 vars에 DART_IN_WORKER = "1".
export const dartInWorker = (env) => Boolean(env.DART_API_KEY) && env.DART_IN_WORKER === "1";
