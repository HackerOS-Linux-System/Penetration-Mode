import { describe, it, expect } from "vitest";
import { findNewHighSeverityThreats } from "../threatWatcher";
import type { ThreatEntry } from "../tauri";

const make = (id: string, severity: ThreatEntry["severity"]): ThreatEntry => ({
  id,
  severity,
  title: `Threat ${id}`,
  description: "desc",
});

describe("findNewHighSeverityThreats", () => {
  it("returns high-severity entries not present in the previous set", () => {
    const result = findNewHighSeverityThreats(new Set(["a"]), [make("a", "high"), make("b", "high")]);
    expect(result.map((t) => t.id)).toEqual(["b"]);
  });

  it("ignores medium/low severity even when new", () => {
    const result = findNewHighSeverityThreats(new Set(), [make("a", "medium"), make("b", "low")]);
    expect(result).toEqual([]);
  });

  it("returns nothing when everything was already seen", () => {
    const result = findNewHighSeverityThreats(new Set(["a", "b"]), [make("a", "high"), make("b", "high")]);
    expect(result).toEqual([]);
  });

  it("returns an empty array for an empty feed", () => {
    expect(findNewHighSeverityThreats(new Set(), [])).toEqual([]);
  });
});
