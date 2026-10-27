import { describe, it, expect } from 'vitest';
import { adjustedSimulationPosition } from '../src/lib/simulation-split.js';

describe('모의 보유 분할 계산', () => {
  it('10대1 분할은 취득 원가를 유지하고 수량을 열 배로 늘린다', () => {
    expect(adjustedSimulationPosition({ qty: 10, cost_krw: 1000 }, 10, 1))
      .toEqual({ qty: 100, cost_krw: 1000, fractional: false });
  });
  it('1대10 병합의 소수 수량을 버리지 않고 확인 대상으로 표시한다', () => {
    expect(adjustedSimulationPosition({ qty: 13, cost_krw: 1300 }, 1, 10))
      .toEqual({ qty: 1.3, cost_krw: 1300, fractional: true });
  });
  it('비율이 불명확하면 임의로 조정하지 않는다', () => {
    expect(() => adjustedSimulationPosition({ qty: 10, cost_krw: 1000 }, 0, 1)).toThrow();
    expect(() => adjustedSimulationPosition({ qty: 10, cost_krw: 1000 }, 1, 0)).toThrow();
  });
});
