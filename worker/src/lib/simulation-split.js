import { marketDate } from './simulation.js';

// 원장은 수정하지 않는다. 분할 후 보유 수량을 계산할 때 취득 원가는 보존한다.
export function adjustedSimulationPosition(position, numerator, denominator) {
  const qty = Number(position.qty), cost = Number(position.cost_krw);
  if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(cost) || cost < 0 ||
      !Number.isSafeInteger(numerator) || numerator <= 0 ||
      !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('분할·병합 비율 또는 보유 내역을 확인할 수 없습니다');
  }
  const adjustedQty = qty * numerator / denominator;
  if (!Number.isFinite(adjustedQty) || adjustedQty > 1e12) throw new Error('조정 후 수량을 확인할 수 없습니다');
  return { qty: adjustedQty, cost_krw: cost, fractional: !Number.isInteger(adjustedQty) };
}

// 이미 기록된 사건은 내용이 같은 경우에만 재전송으로 취급한다.
export async function recordSimulationSplit(env, event, now = new Date()) {
  const { security_id: securityId, effective_at: effectiveAt, market_date: date, numerator, denominator,
    cash_price: price, fx, fx_date: fxDate, source } = event;
  if (!Number.isSafeInteger(securityId) || securityId <= 0 || !Number.isSafeInteger(numerator) || numerator <= 0 ||
      !Number.isSafeInteger(denominator) || denominator <= 0 || !Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(fx) || fx <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fxDate || '') || !Number.isFinite(Date.parse(date)) ||
      !Number.isFinite(Date.parse(fxDate)) || !Number.isFinite(Date.parse(effectiveAt)) ||
      Date.parse(effectiveAt) > now.getTime() || !source) throw new Error('분할·병합의 시각·비율·정산 가격을 확인하세요');
  const sec = await env.DB.prepare('SELECT currency,market FROM sim_securities WHERE id=?').bind(securityId).first();
  if (!sec || marketDate(new Date(effectiveAt), sec.market) !== date || (sec.currency === 'KRW' && fx !== 1) || (sec.currency === 'USD' &&
      (fxDate >= date || Date.parse(date) - Date.parse(fxDate) > 7 * 86400000))) throw new Error('정산 환율을 확인하세요');
  const find = () => env.DB.prepare('SELECT * FROM sim_splits WHERE security_id=? AND effective_at=?').bind(securityId,effectiveAt).first();
  const matches = row => row.numerator === numerator && row.denominator === denominator && row.market_date === date;
  const prior = await find();
  if (prior) {
    if (!matches(prior)) throw new Error('이미 기록된 분할·병합 정보가 달라 확인이 필요합니다');
    return { id: prior.id, replayed: true };
  }
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`INSERT INTO sim_splits(id,security_id,effective_at,market_date,numerator,denominator,cash_price,fx,fx_date,source,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id,securityId,effectiveAt,date,numerator,denominator,price,fx,fxDate,source,now.toISOString()).run();
  } catch (error) {
    if (!/UNIQUE/.test(String(error.message))) throw error;
    const row = await find();
    if (!row || !matches(row)) throw error;
    return { id: row.id, replayed: true };
  }
  return { id, replayed: false };
}
