import { describe, it, expect, vi } from 'vitest';
import { makeDb } from './d1shim.js';

const calls = vi.hoisted(() => []);
vi.mock('../src/cron/weekly.js', () => ({ rotateFundamentals: async () => { calls.push('personal'); } }));
vi.mock('../src/lib/simulation.js', () => ({
  refreshSimulationPrices: async () => { calls.push('simulation'); },
  settleSimulation: async () => {}, snapshotSimulation: async () => {},
}));
import { runTick } from '../src/cron/tick.js';

describe('모의투자 틱 격리', () => {
  it('활성 대회가 있어도 개인 재무 순환을 먼저 실행한다', async () => {
    const db = makeDb();
    db.raw.prepare("INSERT INTO sim_contests(id,name,initial_cash,fee_bps,slippage_bps,created_at) VALUES('x','test',100000,10,5,'2026-10-27T00:00:00Z')").run();
    db.raw.prepare("INSERT INTO meta(key,value,updated_at) VALUES('tick:done',?,?)").run('{"kr":"2026-10-27","us":"2026-10-27","misc":"2026-10-27"}', '2026-10-27T00:00:00Z');
    calls.length = 0;
    const result = await runTick({ DB: db }, new Date('2026-10-27T10:10:00Z'));
    expect(result.errors).toEqual([]);
    expect(calls).toEqual(['personal', 'simulation']);
  });
});
