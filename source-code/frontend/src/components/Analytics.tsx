import { createSignal, onMount, For, Show } from "solid-js";
import { Download, Inbox } from "lucide-solid";
import { getThreatFeed, readAuditLog, type ThreatEntry, type AuditRecord } from "../lib/tauri";

const SEVERITY_COLOR: Record<ThreatEntry["severity"], string> = {
  high: "border-[var(--accent)] text-red-400",
  medium: "border-yellow-500 text-yellow-400",
  low: "border-blue-500 text-blue-400",
};

/**
 * Runda 10: usunięty własny (uboższy) eksport PDF z bezpośrednim
 * importem `jspdf` — trzymanie go tutaj oznaczało, że jsPDF i jego
 * ciężkie zależności (html2canvas, dompurify, razem ~250KB) trafiały do
 * GŁÓWNEGO bundla appki przy każdym starcie, bo `Analytics.tsx` (prawy
 * sidebar Workspace) jest zawsze zamontowany — podczas gdy `Reports.tsx`
 * (znacznie pełniejsza wersja tego samego eksportu: zakres dat,
 * statystyki, CSV) jest teraz lazy-loadowany i tak i tak. Przycisk niżej
 * po prostu przenosi do Reports zamiast duplikować logikę PDF-a.
 */
export function Analytics(props: { onOpenReports?: () => void }) {
  const [threats, setThreats] = createSignal<ThreatEntry[]>([]);
  const [threatsError, setThreatsError] = createSignal<string | null>(null);
  const [audit, setAudit] = createSignal<AuditRecord[]>([]);

  onMount(async () => {
    try {
      setThreats(await getThreatFeed());
    } catch (e) {
      setThreatsError(String(e));
    }
    setAudit(await readAuditLog(8));
  });


  return (
    <div class="flex-1 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 flex flex-col gap-4 overflow-hidden shadow-lg">
      <h2 class="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Vulnerability Analytics</h2>
      <div class="flex-1 space-y-3 overflow-y-auto pr-1" style={{ "scrollbar-width": "thin", "scrollbar-color": "var(--border-strong) var(--bg-surface)" }}>
        <Show
          when={!threatsError()}
          fallback={
            <div class="text-[9px] text-[var(--text-muted)] flex items-start gap-2 bg-[var(--bg-inset)] p-3 rounded">
              <Inbox size={14} class="shrink-0 mt-0.5" />
              <span>{threatsError()}</span>
            </div>
          }
        >
          <Show
            when={threats().length > 0}
            fallback={
              <div class="text-[9px] text-[var(--text-faint)] flex items-start gap-2 bg-[var(--bg-inset)] p-3 rounded">
                <Inbox size={14} class="shrink-0 mt-0.5" />
                <span>Brak podpiętego źródła zagrożeń. Skonfiguruj je w threat_feed.rs / threat_feed.json.</span>
              </div>
            }
          >
            <For each={threats()}>
              {(t) => (
                <div class={`bg-[var(--bg-inset)] p-3 rounded border-l-2 hover:bg-[var(--bg-surface)] transition-colors cursor-pointer ${SEVERITY_COLOR[t.severity]}`}>
                  <div class="text-[9px] text-[var(--text-muted)] mb-1">THREAT LEVEL: {t.severity.toUpperCase()}</div>
                  <div class="text-[11px] font-mono">{t.title}</div>
                  <div class="text-[9px] text-[var(--text-faint)] italic">{t.description}</div>
                </div>
              )}
            </For>
          </Show>
        </Show>

        <Show when={audit().length > 0}>
          <div class="pt-2 border-t border-[var(--border-default)]">
            <div class="text-[9px] uppercase tracking-widest text-[var(--text-faint)] mb-2">Ostatnie działania (audit log)</div>
            <For each={audit()}>
              {(a) => (
                <div class="text-[9px] font-mono text-[var(--text-muted)] py-0.5">
                  <span class="text-[var(--text-disabled)]">{new Date(a.timestamp).toLocaleTimeString()}</span>{" "}
                  <span class="text-[var(--text-tertiary)]">{a.operator}</span> — {a.event}
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="mt-auto pt-4 border-t border-[var(--border-default)]">
        <button
          onClick={() => props.onOpenReports?.()}
          class="w-full py-2 border border-[var(--border-strong)] rounded text-[10px] font-bold uppercase tracking-widest text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white hover:border-[var(--accent)] transition-colors flex items-center justify-center gap-2"
        >
          <Download size={12} />
          Pełne raporty (PDF/CSV)
        </button>
      </div>
    </div>
  );
}
