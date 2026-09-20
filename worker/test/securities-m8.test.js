import { describe, it, expect } from "vitest";
import { makeDb } from "./d1shim.js";
import { patchSecurity, pickFields, securityOut } from "../src/routes/securities.js";

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

  it("재무 통화·ADR·환산율을 검증하고 환산 준비 상태를 직렬화한다", () => {
    expect(pickFields({ financial_currency: "twd", adr_ratio: 5, financial_to_listing_rate: 0.031 }, { partial: true }))
      .toEqual({ financial_currency: "TWD", adr_ratio: 5, financial_to_listing_rate: 0.031 });
    expect(() => pickFields({ adr_ratio: 0 }, { partial: true })).toThrow(/0보다 큰/);
    expect(securityOut({ currency: "USD", financial_currency: "TWD", adr_ratio: 5, financial_to_listing_rate: null, band_multiples: null }))
      .toMatchObject({ valuation_ready: false, valuation_block_reason: "TWD→USD 재무 환산율이 필요합니다" });
    expect(securityOut({ currency: "USD", financial_currency: "TWD", adr_ratio: 5, financial_to_listing_rate: 0.031, band_multiples: null }))
      .toMatchObject({ valuation_ready: true, valuation_block_reason: null });
  });
});
