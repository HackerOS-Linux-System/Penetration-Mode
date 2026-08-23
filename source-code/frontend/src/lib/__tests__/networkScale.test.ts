import { describe, it, expect } from "vitest";
import { kbpsToBarHeight } from "../networkScale";

describe("kbpsToBarHeight", () => {
  it("returns the floor for zero or negative throughput", () => {
    expect(kbpsToBarHeight(0)).toBe(4);
    expect(kbpsToBarHeight(-5)).toBe(4);
  });

  it("grows with throughput but stays within 4-100", () => {
    const low = kbpsToBarHeight(1);
    const mid = kbpsToBarHeight(50);
    const high = kbpsToBarHeight(100_000);

    expect(low).toBeGreaterThanOrEqual(4);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(100);
  });

  it("never exceeds 100 even for extreme throughput", () => {
    expect(kbpsToBarHeight(1e9)).toBe(100);
  });
});
