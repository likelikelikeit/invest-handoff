import { describe, it, expect } from "vitest";
import { makeDb } from "./d1shim.js";
import { patchSecurity, pickFields } from "../src/routes/securities.js";

const H = {};
const req = (body) => ({ json: async () => body });

describe("M8 종목 가정", () => {
  it("기대수익률 범위를 검증한다", () => {
    expect(pickFields({ expected_return_pct: 8.5 }, { partial: true })).toEqual({ expected_return_pct: 8.5 });
    expect(pickFields({ expected_return_pct: null }, { partial: true })).toEqual({ expected_return_pct: null });
    expect(() => pickFields({ expected_return_pct: 101 }, { partial: true })).toThrow(/-100~100/);
  });

  it("0006 컬럼에 가정을 저장하고 API 모양으로 돌려준다", async () => {
    const env = { DB: makeDb() };
    const out = await patchSecurity(req({ expected_return_pct: 7.25, asset_class: "bond" }), env, H, { id: 1 });
    const body = await out.json();
    expect(body.security).toMatchObject({ id: 1, expected_return_pct: 7.25, asset_class: "bond" });
  });
});
