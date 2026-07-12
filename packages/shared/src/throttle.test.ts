import { describe, expect, it } from "vitest";
import { nextThrottleMultiplier, THROTTLE_THRESHOLDS } from "./throttle.js";

describe("nextThrottleMultiplier", () => {
  it("rises one level when the run was aborted by the circuit breaker, regardless of ratio", () => {
    expect(nextThrottleMultiplier(1, { aborted: true, ratio: 0 })).toBe(2);
  });

  it("rises one level when softBlocks/rawCount exceeds 5%", () => {
    expect(nextThrottleMultiplier(1, { aborted: false, ratio: 0.06 })).toBe(2);
  });

  it("does not rise exactly at the 5% ceiling", () => {
    expect(nextThrottleMultiplier(1, { aborted: false, ratio: 0.05 })).toBe(1);
  });

  it("drops one level when softBlocks/rawCount falls below 2%", () => {
    expect(nextThrottleMultiplier(4, { aborted: false, ratio: 0.01 })).toBe(2);
  });

  it("does not drop exactly at the 2% floor", () => {
    expect(nextThrottleMultiplier(4, { aborted: false, ratio: 0.02 })).toBe(4);
  });

  it("holds steady between 2% and 5% (hysteresis band)", () => {
    expect(nextThrottleMultiplier(2, { aborted: false, ratio: 0.03 })).toBe(2);
  });

  it("caps the rise at 4 (does not overflow the ladder)", () => {
    expect(nextThrottleMultiplier(4, { aborted: true, ratio: 0 })).toBe(4);
  });

  it("floors the drop at 1 (does not underflow the ladder)", () => {
    expect(nextThrottleMultiplier(1, { aborted: false, ratio: 0.01 })).toBe(1);
  });

  it("climbs the full ladder one level per run", () => {
    expect(nextThrottleMultiplier(1, { aborted: true, ratio: 0 })).toBe(2);
    expect(nextThrottleMultiplier(2, { aborted: true, ratio: 0 })).toBe(4);
  });

  it("exposes the documented hysteresis thresholds", () => {
    expect(THROTTLE_THRESHOLDS).toEqual({ riseRatio: 0.05, fallRatio: 0.02 });
  });
});
