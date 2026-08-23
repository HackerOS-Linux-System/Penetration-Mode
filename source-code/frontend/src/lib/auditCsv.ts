import type { AuditRecord } from "./tauri";

/** Escapuje pojedynczą wartość CSV wg RFC 4180 (podwaja cudzysłowy, otacza cudzysłowem). */
export function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Buduje pełny CSV (z nagłówkiem) z listy wpisów audit logu — używane przez
 * przycisk "Eksport CSV" w Reports.tsx. Wydzielone do czystej funkcji, żeby
 * dało się to przetestować bez renderowania komponentu / bez Tauri. */
export function auditRecordsToCsv(records: AuditRecord[]): string {
  const header = "timestamp,operator,event,details";
  const rows = records.map((r) => {
    const details = JSON.stringify(r.details ?? null);
    return [csvField(r.timestamp), csvField(r.operator), csvField(r.event), csvField(details)].join(",");
  });
  return [header, ...rows].join("\n");
}
