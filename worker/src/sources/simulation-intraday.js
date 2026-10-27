// 모의투자 전용 15분봉 파서. 거래소 정규장 범위와 제공자의 기준 시각을 함께 보존한다.
const INTERVAL = 15 * 60;

export async function simulationIntraday(symbol, market, fetchedAt = new Date(), options = {}) {
  const zone = market === 'KR' ? 'Asia/Seoul' : market === 'US' ? 'America/New_York' : null;
  if (!zone) throw new Error('지원하지 않는 거래소입니다');
  const path = '/v8/finance/chart/' + encodeURIComponent(symbol) +
    '?interval=15m&range=5d&includePrePost=false&events=split';
  // 클라이언트 지문과 브라우저 UA가 맞지 않으면 야후가 429를 주는 경우가 있다.
  // 같은 응답 형식인 query2와 짧은 UA로 한 번 더 시도한다.
  const attempts = [
    ['https://query1.finance.yahoo.com', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'],
    ['https://query2.finance.yahoo.com', 'Mozilla/5.0'],
  ];
  let response;
  for (const [host, ua] of attempts) {
    response = await fetch(host + path, { headers: { Accept: 'application/json', 'User-Agent': ua } });
    if (response.ok || (response.status !== 429 && response.status < 500)) break;
  }
  if (!response.ok) throw new Error('야후 15분봉 조회 실패: ' + response.status);
  return parseSimulationIntraday(await response.json(), zone, fetchedAt, options);
}

export function parseSimulationIntraday(data, expectedZone, fetchedAt = new Date(), {sessionsOnly = false} = {}) {
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || meta.exchangeTimezoneName !== expectedZone || !Array.isArray(result.timestamp)) {
    throw new Error('거래소 또는 15분봉 정보를 확인하지 못했습니다');
  }
  let periods = (meta.tradingPeriods || []).flat().filter(p =>
    Number.isFinite(p?.start) && Number.isFinite(p?.end) && p.start < p.end);
  if (!periods.length) throw new Error('정규장 시간 정보를 확인하지 못했습니다');
  if (expectedZone === 'Asia/Seoul') {
    // 야후 한국 15분봉은 통상 마지막 30분을 빼고 15:00 종료로 보고한다.
    // 정상일 09:00~15:30은 KRX 시간으로 보정하되, 비정상 시간은 추측하지 않는다.
    periods = periods.map(period => {
      const a = new Date((period.start + 9 * 3600) * 1000), b = new Date((period.end + 9 * 3600) * 1000);
      const open = a.getUTCHours() * 60 + a.getUTCMinutes(), close = b.getUTCHours() * 60 + b.getUTCMinutes();
      if (open !== 9 * 60 || (close !== 15 * 60 && close !== 15 * 60 + 30)) throw new Error('한국 정규장 특별 시간 확인 필요');
      return { ...period, end: close === 15 * 60 ? period.end + 30 * 60 : period.end };
    });
  }
  const quote = result.indicators?.quote?.[0] || {};
  const marketTime = Number.isFinite(meta.regularMarketTime) ? meta.regularMarketTime : null;
  const fetched = fetchedAt.getTime() / 1000;
  // Yahoo 안내상 한국은 20분 지연. 미국도 안전 여유를 두며, 공급자가 더 큰 지연을 표시하면 따른다.
  const minimumDelay = expectedZone === 'Asia/Seoul' ? 20 : 15;
  const delay = Number.isFinite(meta.exchangeDataDelayedBy) && meta.exchangeDataDelayedBy >= 0
    ? Math.max(minimumDelay, meta.exchangeDataDelayedBy) : minimumDelay;
  const rows = [];
  if (!sessionsOnly) result.timestamp.forEach((start, i) => {
    const session = periods.find(p => start >= p.start && start < p.end && (start - p.start) % INTERVAL === 0);
    const end = session && Math.min(start + INTERVAL, session.end);
    const close = quote.close?.[i], open = quote.open?.[i], volume = quote.volume?.[i];
    if (!session || !Number.isFinite(close) || close <= 0 || !Number.isFinite(volume) || volume <= 0) return;
    // 시간 경과만으로 확정을 추정하지 않는다. 제공자 기준 시각도 봉 끝에 도달해야 한다.
    if (end + delay * 60 > fetched || marketTime == null || marketTime < end) return;
    rows.push({ start, end, open: Number.isFinite(open) && open > 0 ? open : null, close, volume,
      sessionStart: session.start, sessionEnd: session.end });
  });
  const splits = Object.values(result.events?.splits || {}).map(split => {
    if (!Number.isFinite(split.date) || !Number.isSafeInteger(split.numerator) || split.numerator <= 0 ||
        !Number.isSafeInteger(split.denominator) || split.denominator <= 0) {
      throw new Error('분할·병합 정보가 불명확합니다');
    }
    return { at: split.date, numerator: split.numerator, denominator: split.denominator };
  });
  return { rows: rows.sort((a, b) => a.start - b.start), sessions: periods.sort((a, b) => a.start - b.start),
    splits, marketTime, fetchedAt: fetchedAt.toISOString(),
    delayMinutes: Number.isFinite(meta.exchangeDataDelayedBy) ? meta.exchangeDataDelayedBy : null,
    minimumWaitMinutes: delay };
}

// 요청 시점이 들어 있는 봉의 종가를 사용한다(예: 23:07 주문 → 23:15 종료 봉).
// 기대한 봉이 누락되면 뒤의 봉을 대신 고르지 않는다.
export function firstOrderBar(rows, orderSeconds, sessionStart, sessionEnd) {
  if (!(orderSeconds >= sessionStart && orderSeconds < sessionEnd)) return null;
  const expected = sessionStart + Math.floor((orderSeconds - sessionStart) / INTERVAL) * INTERVAL;
  return rows.find(row => row.start === expected && row.sessionStart === sessionStart) || null;
}

// 독립적인 시장 대표 종목의 세션 목록으로 첫 거래일을 정한다. 이력이 부족하면 추측하지 않는다.
export function selectSimulationExecution(orderSeconds, referenceSessions, securityData, contestStartSeconds = null, openOnly = false) {
  if (contestStartSeconds != null && securityData.splits?.some(split => split.at >= contestStartSeconds)) {
    return { reason: '분할·병합 확인 필요' };
  }
  const sessions = [...referenceSessions].sort((a, b) => a.start - b.start);
  if (!sessions.length || orderSeconds < sessions[0].start) return { reason: '거래일 이력 확인 필요' };
  const session = sessions.find(p => orderSeconds < (openOnly ? p.start : p.end));
  if (!session) return { reason: '다음 정규장 대기' };
  const matching = securityData.sessions.find(p => p.start === session.start && p.end === session.end);
  if (!matching) return { reason: '종목의 정규장 확인 필요' };
  const intraday = !openOnly && orderSeconds >= session.start;
  const bar = intraday
    ? firstOrderBar(securityData.rows, orderSeconds, session.start, session.end)
    : securityData.rows.find(row => row.start === session.start && row.sessionStart === session.start);
  if (intraday && !bar) {
    // 한국 15:00~15:30 동시호가처럼 15분봉이 끝내 제공되지 않는 구간이 있다.
    // 그 정규장이 끝나고 다음 정규장 첫 봉이 확정되면, 주문 이후 처음 확보된 유효 가격인 다음 정규장 시가를 쓴다.
    const next = sessions.find(p => p.start >= session.end);
    const nextBar = next && securityData.sessions.some(p => p.start === next.start && p.end === next.end)
      && securityData.rows.find(row => row.start === next.start && row.sessionStart === next.start && row.open > 0);
    if (nextBar) return { kind: 'open', price: nextBar.open, priceTime: next.start, barStart: nextBar.start, barEnd: nextBar.end, fallback: 'missing_bar' };
    return { reason: '확정 시세 대기' };
  }
  if (!bar || (!intraday && !(bar.open > 0))) return { reason: '확정 시세 대기' };
  return { kind: intraday ? 'close' : 'open', price: intraday ? bar.close : bar.open,
    priceTime: intraday ? bar.end : session.start, barStart: bar.start, barEnd: bar.end };
}
