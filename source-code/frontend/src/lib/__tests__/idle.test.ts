import { describe, it, expect } from "vitest";
import { shouldSendHeartbeat } from "../idle";

describe("shouldSendHeartbeat", () => {
  it("sends immediately when nothing has been sent yet", () => {
    expect(shouldSendHeartbeat(null, 1000, 20_000)).toBe(true);
  });

  it("blocks a second send within the interval", () => {
    expect(shouldSendHeartbeat(1000, 5000, 20_000)).toBe(false);
  });

  it("allows a send once the interval has fully elapsed", () => {
    expect(shouldSendHeartbeat(1000, 21_000, 20_000)).toBe(true);
  });

  it("treats exactly-at-boundary as allowed", () => {
    expect(shouldSendHeartbeat(1000, 21_000, 20_000)).toBe(true);
    expect(shouldSendHeartbeat(0, 20_000, 20_000)).toBe(true);
  });
});
