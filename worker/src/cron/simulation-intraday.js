// 모의투자 전용 수집기. 운영 틱에는 아직 연결하지 않았다.
import { simulationIntraday } from '../sources/simulation-intraday.js';
import { processSimulationSymbol } from '../lib/simulation-market-cycle.js';

export async function runSimulationIntraday(env, now = new Date(), budget = null, fetchIntraday = simulationIntraday) {
  if (budget && (budget.d1Left() < 30 || budget.fetchLeft() < 3)) return { deferred: '실행 예산 부족' };
  const contest = await env.DB.prepare("SELECT id,created_at FROM sim_contests WHERE status='active' AND rules_version IN ('2','3') LIMIT 1").first();
  if (!contest) return { deferred: '진행 중인 대회 없음' };
  // 평가용 시세는 15분마다, 체결 대기 주문이 있는 종목은 5분 틱마다 다시 확인한다.
  // 대기 주문 종목을 먼저 고르고, 같은 종목은 여러 계좌가 한 번의 조회를 공유한다.
  const stale = new Date(now.getTime() - 15 * 60000).toISOString();
  const pendingStale = new Date(now.getTime() - 4 * 60000).toISOString();
  const security = await env.DB.prepare(`SELECT * FROM (SELECT s.*,mc.attempted_at,
      EXISTS(SELECT 1 FROM sim_orders o JOIN sim_accounts a ON a.id=o.account_id
        WHERE o.security_id=s.id AND a.contest_id=? AND o.status='pending') AS pending
    FROM sim_securities s LEFT JOIN sim_market_checks mc ON mc.security_id=s.id
    WHERE s.id IN (SELECT t.security_id FROM sim_theses t JOIN sim_accounts a ON a.id=t.account_id WHERE a.contest_id=?))
    WHERE attempted_at IS NULL OR attempted_at<=? OR (pending AND attempted_at<=?)
    ORDER BY pending DESC,CASE WHEN attempted_at IS NULL THEN 0 ELSE 1 END,attempted_at,id LIMIT 1`)
    .bind(contest.id,contest.id,stale,pendingStale).first();
  if (!security) return { deferred: '갱신 대상 없음' };
  try {
    let reference,data;
    if (env.SIM_FEED) {
      if(budget) budget.fetches++;
      const response=await env.SIM_FEED.fetch('https://simulation-feed.internal/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:security.ysym,market:security.market,at:now.toISOString()})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||'모의 시세 조회 실패');
      ({reference,data}=result);
    } else if (fetchIntraday !== simulationIntraday) {
      // 테스트에서만 가상 소스를 주입한다. 운영에서 바인딩이 빠지면 안전하게 보류한다.
      const benchmark = security.market === 'KR' ? '^KS11' : '^GSPC';
      [reference,data]=await Promise.all([fetchIntraday(benchmark,security.market,now),fetchIntraday(security.ysym,security.market,now)]);
    } else throw new Error('모의 시세 Worker 연결이 없습니다');
    return { security_id: security.id, ...(await processSimulationSymbol(env,security,contest,reference,data,now)) };
  } catch (error) {
    const detail = String(error.message || error).slice(0,300);
    await env.DB.prepare(`INSERT INTO sim_market_checks(security_id,attempted_at,status,detail) VALUES(?,?,'hold',?)
      ON CONFLICT(security_id) DO UPDATE SET attempted_at=excluded.attempted_at,status='hold',detail=excluded.detail`)
      .bind(security.id,now.toISOString(),detail).run();
    return { security_id: security.id, error: detail };
  }
}
