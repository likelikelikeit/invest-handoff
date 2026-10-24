const KST = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 오전·오후 DART 실행 슬롯. launchd가 정시를 놓쳐도 다음 매시 :10에
 * 같은 슬롯을 한 번만 실행할 수 있게 날짜까지 포함한 키를 돌려준다.
 */
export function dartSyncSlot(now = new Date()) {
  const p = Object.fromEntries(KST.formatToParts(now).map(({ type, value }) => [type, value]));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  if (minutes < 8 * 60 + 10) return null;
  const half = minutes < 18 * 60 + 10 ? "am" : "pm";
  return `${p.year}-${p.month}-${p.day}:${half}`;
}

export function shouldRunDartSync(lastSlot, now = new Date()) {
  const slot = dartSyncSlot(now);
  return { slot, run: Boolean(slot && slot !== lastSlot) };
}
