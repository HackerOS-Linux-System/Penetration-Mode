import { describe, it, expect } from "vitest";
import { csvField, auditRecordsToCsv } from "../auditCsv";

describe("csvField", () => {
  it("wraps plain values in quotes", () => {
    expect(csvField("nmap")).toBe('"nmap"');
  });

  it("doubles internal quotes per RFC 4180", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });
});

describe("auditRecordsToCsv", () => {
  it("emits a header row even for an empty list", () => {
    expect(auditRecordsToCsv([])).toBe("timestamp,operator,event,details");
  });

  it("serializes one row per record with escaped details", () => {
    const csv = auditRecordsToCsv([
      { timestamp: "2026-08-18T00:00:00Z", operator: "root", event: "auth.login", details: { role: "lead" }, seq: 1 },
    ]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("timestamp,operator,event,details");
    expect(lines[1]).toContain('"auth.login"');
    expect(lines[1]).toContain('""role"":""lead""');
  });
});
