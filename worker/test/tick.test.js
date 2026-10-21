import { describe, it, expect } from "vitest";
import { planTick } from "../src/cron/tick.js";

const at = (iso, done) => planTick(new Date(iso), done);

describe("5분 틱: 시각별 할 일 (UTC 고정)", () => {
  it("국내 장중(KST 10:00 = UTC 01:00)은 국내 시세, 재무 순환은 쉰다", () => {
    expect(at("2026-10-22T01:00:00Z")).toMatchObject({ quotes: ["KR"], rotate: false, closeKr: false });
  });
  it("미국 장중은 서머타임이든 아니든 넓은 창으로 덮는다", () => {
    expect(at("2026-10-22T13:30:00Z").quotes).toEqual(["US"]);   // EDT 09:30 개장
    expect(at("2026-12-22T20:55:00Z").quotes).toEqual(["US"]);   // EST 15:55
    expect(at("2026-10-22T21:10:00Z").quotes).toEqual([]);       // 창 밖
  });
  it("장 밖 평일은 30분마다 환율만, 주말은 시세 없음", () => {
    expect(at("2026-10-22T10:30:00Z").quotes).toEqual(["FX"]);
    expect(at("2026-10-22T10:35:00Z").quotes).toEqual([]);
    expect(at("2026-10-24T01:00:00Z").quotes).toEqual([]);       // 토요일
    expect(at("2026-10-24T01:00:00Z").rotate).toBe(true);        // 주말에도 재무 순환은 돈다
  });
  it("마감·거시는 그 시각 이후 그날 처음 한 번, 놓치면 다음 틱이 잇는다", () => {
    expect(at("2026-10-22T07:00:00Z", {}).closeKr).toBe(true);
    expect(at("2026-10-22T07:20:00Z", { kr: "2026-10-21" }).closeKr).toBe(true);   // 07:00 틱이 실패했어도
    expect(at("2026-10-22T07:25:00Z", { kr: "2026-10-22" }).closeKr).toBe(false);  // 이미 함
    expect(at("2026-10-22T22:00:00Z", {}).closeUs).toBe(true);
    expect(at("2026-10-23T22:00:00Z", {}).closeUs).toBe(true);                     // 금요일 미국 마감 (예전 1-5 버그로 빠지던 날)
    expect(at("2026-10-24T22:00:00Z", {}).closeUs).toBe(false);                    // 토요일
    expect(at("2026-10-24T23:30:00Z", {}).misc).toBe(true);                        // 거시는 매일
  });
});
