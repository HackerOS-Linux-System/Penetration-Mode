import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { RefreshCw, Search, Inbox, AlertTriangle, MessageSquarePlus, MessageSquare, Send } from "lucide-solid";
import { getThreatFeed, readAuditLog, addAuditNote, getThreatFeedStatus, type ThreatEntry, type AuditRecord, type ThreatFeedStatus } from "../lib/tauri";

const SEVERITY_COLOR: Record<ThreatEntry["severity"], string> = {
  high: "border-[var(--accent)] text-red-400 bg-[#1a0000]",
  medium: "border-yellow-500 text-yellow-400 bg-[#1a1400]",
  low: "border-blue-500 text-blue-400 bg-[#00121a]",
};

const EVENT_COLOR = (event: string) => {
  if (event.startsWith("auth.")) return "text-[#00b7ff]";
  if (event.startsWith("terminal.")) return "text-[#00ff41]";
  if (event.startsWith("store.") || event.startsWith("blackarch.")) return "text-[#ffb300]";
  if (event.startsWith("logs.")) return "text-[#c084fc]";
  if (event.startsWith("settings.")) return "text-[var(--text-tertiary)]";
  return "text-[var(--text-primary)]";
};

/**
 * Pełnoekranowa wersja tego, co wcześniej było tylko małym panelem w
 * Analytics.tsx — ikona "Activity" w lewym pasku nic nie robiła, teraz
 * otwiera to jako osobny widok z filtrowaniem/wyszukiwaniem po większej
 * historii (zamiast sztywnych 8 ostatnich wpisów).
 */
export function Activity() {
  const [threats, setThreats] = createSignal<ThreatEntry[]>([]);
  const [threatsError, setThreatsError] = createSignal<string | null>(null);
  const [audit, setAudit] = createSignal<AuditRecord[]>([]);
  const [query, setQuery] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [addingNoteFor, setAddingNoteFor] = createSignal<number | null>(null);
  const [noteText, setNoteText] = createSignal("");
  const [savingNote, setSavingNote] = createSignal(false);
  const [feedStatus, setFeedStatus] = createSignal<ThreatFeedStatus | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setThreats(await getThreatFeed());
      setThreatsError(null);
    } catch (e) {
      setThreatsError(String(e));
    }
    setAudit(await readAuditLog(200));
    try {
      setFeedStatus(await getThreatFeedStatus());
    } catch {
      setFeedStatus(null);
    }
    setLoading(false);
  };

  onMount(load);

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    // "audit.note_added" nie ma własnego wiersza w tabeli — renderuje się
    // tylko jako notatka pod wpisem, do którego się odnosi (patrz
    // `notesBySeq` niżej), więc pokazywanie go tu drugi raz jako zwykłe
    // zdarzenie byłoby mylącym duplikatem.
    const base = audit().filter((a) => a.event !== "audit.note_added");
    if (!q) return base;
    return base.filter(
      (a) => a.event.toLowerCase().includes(q) || a.operator.toLowerCase().includes(q) || JSON.stringify(a.details).toLowerCase().includes(q),
    );
  });

  // Notatki (Runda 10) — celowo NIE mutują oryginalnego wpisu (patrz
  // backend/src/audit.rs::add_audit_note): to osobne zdarzenia
  // `audit.note_added` odwołujące się do `target_seq`. Tutaj tylko je
  // grupujemy po docelowym seq, żeby wyrenderować pod właściwym wierszem.
  const notesBySeq = createMemo(() => {
    const map = new Map<number, { operator: string; timestamp: string; note: string }[]>();
    for (const a of audit()) {
      if (a.event !== "audit.note_added") continue;
      const details = a.details as { target_seq?: number; note?: string } | null;
      if (!details || typeof details.target_seq !== "number" || typeof details.note !== "string") continue;
      const list = map.get(details.target_seq) ?? [];
      list.push({ operator: a.operator, timestamp: a.timestamp, note: details.note });
      map.set(details.target_seq, list);
    }
    return map;
  });

  const submitNote = async (seq: number) => {
    const text = noteText().trim();
    if (!text) return;
    setSavingNote(true);
    try {
      await addAuditNote(seq, text);
      setNoteText("");
      setAddingNoteFor(null);
      await load();
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div class="flex-1 flex flex-col min-h-0 gap-3">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <For each={["high", "medium", "low"] as ThreatEntry["severity"][]}>
          {(sev) => {
            const count = () => threats().filter((t) => t.severity === sev).length;
            return (
              <div class={`rounded-xl border p-3 flex items-center gap-3 ${SEVERITY_COLOR[sev]}`}>
                <AlertTriangle size={18} />
                <div>
                  <div class="text-lg font-bold font-mono">{count()}</div>
                  <div class="text-[9px] uppercase tracking-widest opacity-80">Zagrożenia: {sev}</div>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <div class="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-3 min-h-0">
        <div class="lg:col-span-2 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 flex flex-col gap-3 min-h-0 shadow-lg">
          <h2 class="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Threat Feed</h2>
          <Show when={feedStatus()?.configured}>
            <div class="text-[8px] font-mono">
              <Show
                when={!feedStatus()?.last_error}
                fallback={<span class="text-[#ff5555]">błąd: {feedStatus()?.last_error}</span>}
              >
                <span class="text-[var(--text-disabled)]">
                  {feedStatus()?.cached_age_secs !== null ? `dane sprzed ${feedStatus()?.cached_age_secs}s` : "świeże dane"}
                </span>
              </Show>
            </div>
          </Show>
          <div class="flex-1 overflow-y-auto space-y-2 pr-1" style={{ "scrollbar-width": "thin", "scrollbar-color": "var(--border-strong) var(--bg-surface)" }}>
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
                    <span>Brak podpiętego źródła zagrożeń. Skonfiguruj je w Ustawieniach.</span>
                  </div>
                }
              >
                <For each={threats()}>
                  {(t) => (
                    <div class={`bg-[var(--bg-inset)] p-3 rounded border-l-2 hover:bg-[var(--bg-surface-raised)] transition-colors ${SEVERITY_COLOR[t.severity]}`}>
                      <div class="text-[9px] opacity-70 mb-1">THREAT LEVEL: {t.severity.toUpperCase()}</div>
                      <div class="text-[11px] font-mono">{t.title}</div>
                      <div class="text-[9px] opacity-70 italic">{t.description}</div>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>

        <div class="lg:col-span-3 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 flex flex-col gap-3 min-h-0 shadow-lg">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Audit Log</h2>
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1.5 bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1">
                <Search size={11} class="text-[var(--text-faint)]" />
                <input
                  type="text"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  placeholder="filtruj po zdarzeniu/operatorze..."
                  class="bg-transparent outline-none text-[9px] text-[var(--text-primary)] w-40"
                />
              </div>
              <button onClick={load} disabled={loading()} title="Odśwież" class="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">
                <RefreshCw size={13} class={loading() ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto pr-1" style={{ "scrollbar-width": "thin", "scrollbar-color": "var(--border-strong) var(--bg-surface)" }}>
            <table class="w-full text-[9px] font-mono">
              <tbody>
                <For each={filtered()}>
                  {(a) => (
                    <>
                      <tr class="border-b border-[var(--bg-surface-raised)] hover:bg-[var(--bg-surface-raised)]">
                        <td class="py-1 pr-3 text-[var(--text-disabled)] whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</td>
                        <td class="py-1 pr-3 text-[var(--text-tertiary)] whitespace-nowrap">{a.operator}</td>
                        <td class={`py-1 pr-3 whitespace-nowrap ${EVENT_COLOR(a.event)}`}>{a.event}</td>
                        <td class="py-1 text-[var(--text-faint)] truncate max-w-[1px]">
                          {a.details && Object.keys(a.details as object).length > 0 ? JSON.stringify(a.details) : ""}
                        </td>
                        <td class="py-1 pl-2 text-right whitespace-nowrap">
                          <Show when={a.seq !== null}>
                            <button
                              onClick={() => {
                                setAddingNoteFor(addingNoteFor() === a.seq ? null : a.seq);
                                setNoteText("");
                              }}
                              title="Dodaj notatkę"
                              class="text-[var(--text-disabled)] hover:text-[var(--accent)] transition-colors"
                            >
                              <MessageSquarePlus size={11} />
                            </button>
                          </Show>
                        </td>
                      </tr>
                      <Show when={a.seq !== null && (notesBySeq().get(a.seq!)?.length ?? 0) > 0}>
                        <For each={notesBySeq().get(a.seq!)}>
                          {(n) => (
                            <tr class="bg-[var(--bg-inset)]">
                              <td />
                              <td class="py-1 pl-3 text-[var(--text-disabled)]" colSpan={3}>
                                <span class="inline-flex items-start gap-1.5">
                                  <MessageSquare size={10} class="mt-0.5 shrink-0 text-[var(--accent)]" />
                                  <span>
                                    <span class="text-[var(--text-tertiary)]">{n.operator}:</span> {n.note}
                                  </span>
                                </span>
                              </td>
                              <td />
                            </tr>
                          )}
                        </For>
                      </Show>
                      <Show when={addingNoteFor() === a.seq && a.seq !== null}>
                        <tr class="bg-[var(--bg-inset)]">
                          <td />
                          <td class="py-1.5 pl-3" colSpan={4}>
                            <div class="flex items-center gap-1.5">
                              <input
                                type="text"
                                autofocus
                                value={noteText()}
                                onInput={(e) => setNoteText(e.currentTarget.value)}
                                onKeyDown={(e) => e.key === "Enter" && submitNote(a.seq!)}
                                placeholder="np. autoryzowany test, JIRA-123"
                                class="flex-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded px-2 py-1 text-[9px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)]"
                              />
                              <button
                                onClick={() => submitNote(a.seq!)}
                                disabled={savingNote()}
                                class="text-[var(--accent)] hover:opacity-80 disabled:opacity-40"
                              >
                                <Send size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      </Show>
                    </>
                  )}
                </For>
              </tbody>
            </table>
            <Show when={filtered().length === 0}>
              <div class="text-[9px] text-[var(--text-faint)] italic py-4 text-center">Brak wpisów pasujących do filtra.</div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
