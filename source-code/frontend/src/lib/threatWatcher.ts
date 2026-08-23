import type { ThreatEntry } from "./tauri";

/**
 * Które wpisy z najnowszego odczytu threat feed są (a) severity "high" i
 * (b) jeszcze nie widziane w poprzednim odczycie — czyli warte toasta +
 * dźwięku. Wydzielone jako czysta funkcja (bez `setInterval`/Tauri), żeby
 * dało się to przetestować bez mockowania backendu.
 */
export function findNewHighSeverityThreats(previouslySeenIds: ReadonlySet<string>, current: ThreatEntry[]): ThreatEntry[] {
  return current.filter((t) => t.severity === "high" && !previouslySeenIds.has(t.id));
}
