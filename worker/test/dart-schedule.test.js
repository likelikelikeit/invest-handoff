import { describe, expect, it } from "vitest";
import { dartSyncSlot, shouldRunDartSync } from "../scripts/lib-dart-schedule.mjs";

describe("DART 맥 미니 예약 슬롯", () => {
  it("08:10 전에는 실행하지 않는다", () => {
    expect(dartSyncSlot(new Date("2026-10-23T23:09:00Z"))).toBeNull(); // KST 08:09
  });

  it("오전·오후 슬롯을 KST로 나눈다", () => {
    expect(dartSyncSlot(new Date("2026-10-23T23:10:00Z"))).toBe("2026-10-24:am");
    expect(dartSyncSlot(new Date("2026-10-24T09:09:00Z"))).toBe("2026-10-24:am");
    expect(dartSyncSlot(new Date("2026-10-24T09:10:00Z"))).toBe("2026-10-24:pm");
  });

  it("같은 슬롯은 건너뛰고 놓친 슬롯은 다음 확인 때 실행한다", () => {
    const lateMorning = new Date("2026-10-24T01:10:00Z"); // KST 10:10
    expect(shouldRunDartSync("", lateMorning)).toEqual({ slot: "2026-10-24:am", run: true });
    expect(shouldRunDartSync("2026-10-24:am", lateMorning)).toEqual({ slot: "2026-10-24:am", run: false });
  });
});
