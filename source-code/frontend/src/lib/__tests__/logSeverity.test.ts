import { describe, it, expect } from "vitest";
import { detectLogSeverity } from "../logSeverity";

describe("detectLogSeverity", () => {
  it("detects critical-tier keywords", () => {
    expect(detectLogSeverity("2026-08-20 CRITICAL: disk full")).toBe("critical");
    expect(detectLogSeverity("kernel panic in module xyz")).toBe("critical");
    expect(detectLogSeverity("FATAL error during boot")).toBe("critical");
  });

  it("detects error-tier keywords", () => {
    expect(detectLogSeverity("connection refused by remote host")).toBe("error");
    expect(detectLogSeverity("Error: could not open file")).toBe("error");
    expect(detectLogSeverity("permission denied")).toBe("error");
  });

  it("detects warning-tier keywords", () => {
    expect(detectLogSeverity("WARN: deprecated flag used")).toBe("warning");
    expect(detectLogSeverity("warning: low memory")).toBe("warning");
  });

  it("detects info-tier keywords", () => {
    expect(detectLogSeverity("INFO: service started")).toBe("info");
    expect(detectLogSeverity("debug: entering loop")).toBe("info");
  });

  it("returns null for lines with no recognizable level", () => {
    expect(detectLogSeverity("nmap scan report for 10.0.0.1")).toBeNull();
    expect(detectLogSeverity("")).toBeNull();
  });

  it("does not match substrings inside unrelated words", () => {
    // "terrorist" contains "error" as a substring but is not the word "error"
    expect(detectLogSeverity("terroristically fast scan")).toBeNull();
  });

  it("prioritizes the most severe match when multiple keywords appear", () => {
    expect(detectLogSeverity("warning escalated to critical failure")).toBe("critical");
  });
});
