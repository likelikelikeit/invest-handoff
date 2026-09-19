// 최소 서비스 워커: 설치 가능 조건만 채운다. fetch 핸들러가 없어 모든 요청은 평소처럼 네트워크로 간다.
// 오프라인에서 마지막 데이터를 보여주는 캐시는 마일스톤 8에서 붙인다 (SPEC §7.6).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
