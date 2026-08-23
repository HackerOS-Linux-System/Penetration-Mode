import { describe, it, expect, beforeEach } from "vitest";
import { applyAccentColor, isValidHex, normalizeHex } from "../accent";

describe("applyAccentColor", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("sets --accent to the given hex", () => {
    applyAccentColor("#00b7ff");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#00b7ff");
  });

  it("derives --accent-rgb as comma-separated channels", () => {
    applyAccentColor("#ff3333");
    expect(document.documentElement.style.getPropertyValue("--accent-rgb")).toBe("255, 51, 51");
  });

  it("derives alpha variants as rgba() strings", () => {
    applyAccentColor("#ff3333");
    expect(document.documentElement.style.getPropertyValue("--accent-20")).toBe("rgba(255, 51, 51, 0.2)");
    expect(document.documentElement.style.getPropertyValue("--accent-60")).toBe("rgba(255, 51, 51, 0.6)");
  });

  it("accepts hex without a leading #", () => {
    applyAccentColor("00ff41");
    expect(document.documentElement.style.getPropertyValue("--accent-rgb")).toBe("0, 255, 65");
  });

  it("silently ignores an invalid hex instead of throwing", () => {
    applyAccentColor("not-a-color");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
  });
});

describe("isValidHex", () => {
  it("accepts 6-digit hex with a leading #", () => {
    expect(isValidHex("#ff3333")).toBe(true);
  });

  it("accepts 6-digit hex without a leading #", () => {
    expect(isValidHex("ff3333")).toBe(true);
  });

  it("accepts uppercase hex digits", () => {
    expect(isValidHex("#FF3333")).toBe(true);
  });

  it("rejects 3-digit shorthand hex", () => {
    expect(isValidHex("#f33")).toBe(false);
  });

  it("rejects non-hex text", () => {
    expect(isValidHex("red")).toBe(false);
    expect(isValidHex("")).toBe(false);
  });
});

describe("normalizeHex", () => {
  it("lowercases and adds a leading # when missing", () => {
    expect(normalizeHex("FF3333")).toBe("#ff3333");
  });

  it("returns null for an invalid hex", () => {
    expect(normalizeHex("not-a-color")).toBeNull();
  });

  it("is idempotent on an already-normalized value", () => {
    expect(normalizeHex("#00b7ff")).toBe("#00b7ff");
  });
});
