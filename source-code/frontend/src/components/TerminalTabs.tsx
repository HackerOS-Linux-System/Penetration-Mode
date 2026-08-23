import { createSignal, onMount, onCleanup, For } from "solid-js";
import { Plus, X, TerminalSquare } from "lucide-solid";
import { Terminal } from "./Terminal";
import { loadTerminalTabs, saveTerminalTabs, ptyStop, getAppSettings, type TerminalTabSnapshot } from "../lib/tauri";

interface TabState {
  id: string;
  label: string;
  initialScrollback?: string;
  sessionId?: string;
}

let tabCounter = 0;
const newTabId = () => `tab-${Date.now()}-${++tabCounter}`;

/**
 * Pasek tabów terminala (Runda 8) — wcześniej appka miała dokładnie jedną
 * sesję terminala w całym UI; teraz operator może otworzyć kilka
 * równoległych, każdy ze swoim `podman exec` (patrz backend/src/pty.rs,
 * przepisane z pojedynczego `Option<PtySession>` na
 * `HashMap<session_id, PtySession>`).
 *
 * Nieaktywne taby zostają zamontowane (`display:none` przez `visible`
 * prop w `Terminal.tsx`), nie odmontowywane — dzięki temu przełączanie
 * tabów nie zrywa działających sesji PTY.
 *
 * Scrollback każdego taba jest okresowo serializowany (xterm.js
 * `SerializeAddon`) i zapisywany przez `terminal_state.rs`, żeby
 * przetrwał restart appki — patrz `persist()` niżej.
 */
export function TerminalTabs() {
  const [tabs, setTabs] = createSignal<TabState[]>([{ id: newTabId(), label: "bash 1" }]);
  const [activeId, setActiveId] = createSignal<string>(tabs()[0].id);
  const [restoreEnabled, setRestoreEnabled] = createSignal(true);

  const serializers = new Map<string, () => string>();

  const registerSerializer = (tabId: string, fn: () => string) => {
    serializers.set(tabId, fn);
  };

  const registerSessionId = (tabId: string) => (sessionId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, sessionId } : t)));
  };

  const addTab = () => {
    const n = tabs().length + 1;
    const id = newTabId();
    setTabs((prev) => [...prev, { id, label: `bash ${n}` }]);
    setActiveId(id);
  };

  const closeTab = (id: string) => {
    const tab = tabs().find((t) => t.id === id);
    if (tab?.sessionId) void ptyStop(tab.sessionId);
    serializers.delete(id);

    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      // Nigdy nie zostajemy z zerem tabów — od razu otwieramy nowy pusty,
      // zamiast pokazywać workspace bez żadnego terminala.
      return remaining.length > 0 ? remaining : [{ id: newTabId(), label: "bash 1" }];
    });

    if (activeId() === id) {
      const remaining = tabs();
      setActiveId(remaining[0]?.id ?? tabs()[0].id);
    }
  };

  const renameTab = (id: string) => {
    const tab = tabs().find((t) => t.id === id);
    const next = window.prompt("Nazwa taba:", tab?.label ?? "");
    if (next && next.trim()) {
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, label: next.trim().slice(0, 24) } : t)));
    }
  };

  const persist = async () => {
    if (!restoreEnabled()) return;
    const snapshots: TerminalTabSnapshot[] = tabs().map((t) => ({
      id: t.id,
      label: t.label,
      scrollback: serializers.get(t.id)?.() ?? "",
    }));
    try {
      await saveTerminalTabs(snapshots);
    } catch {
      // best-effort — brak zapisanego stanu przy następnym starcie nie jest krytyczne
    }
  };

  let persistInterval: ReturnType<typeof setInterval> | undefined;

  onMount(async () => {
    try {
      const prefs = await getAppSettings();
      setRestoreEnabled(prefs.terminal_restore_scrollback);
      if (prefs.terminal_restore_scrollback) {
        const saved = await loadTerminalTabs();
        if (saved.length > 0) {
          setTabs(saved.map((s) => ({ id: s.id, label: s.label, initialScrollback: s.scrollback || undefined })));
          setActiveId(saved[0].id);
          tabCounter = saved.length;
        }
      }
    } catch {
      // brak zapisanego stanu — zostaje jeden świeży tab z domyślnego sygnału
    }

    // Zapis okresowy (best-effort — restart "na twardo"/awaria procesu
    // między zapisami po prostu straci scrollback od ostatniego zapisu,
    // zamiast zawsze mieć 100% aktualny stan, co wymagałoby blokującego
    // zapisu przy każdym keystroke'u).
    persistInterval = setInterval(persist, 30_000);

    // Tauri v2: najlepszy dostępny moment na zapis "przy zamknięciu" —
    // nie blokujemy zamknięcia oknem czekania na zapis (best-effort).
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const unlisten = await getCurrentWindow().onCloseRequested(() => {
        void persist();
      });
      onCleanup(unlisten);
    } catch {
      // Poza Tauri (przeglądarka) — nie ma czego nasłuchiwać.
    }
  });

  onCleanup(() => {
    if (persistInterval) clearInterval(persistInterval);
    void persist();
  });

  return (
    <div class="flex-1 flex flex-col gap-2 min-h-0">
      <div class="flex items-center gap-1 shrink-0 overflow-x-auto">
        <For each={tabs()}>
          {(tab) => (
            <button
              onClick={() => setActiveId(tab.id)}
              onDblClick={() => renameTab(tab.id)}
              title="Dwuklik, żeby zmienić nazwę"
              class={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-[10px] font-mono whitespace-nowrap transition-colors border-b-2 ${
                activeId() === tab.id
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--accent)]"
                  : "bg-transparent text-[var(--text-faint)] border-transparent hover:text-[var(--text-primary)]"
              }`}
            >
              <TerminalSquare size={11} />
              {tab.label}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                class="hover:text-[#ff5555] transition-colors"
              >
                <X size={11} />
              </span>
            </button>
          )}
        </For>
        <button
          onClick={addTab}
          title="Nowy tab terminala"
          class="flex items-center justify-center w-7 h-7 rounded text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--bg-inset)] transition-colors shrink-0"
        >
          <Plus size={14} />
        </button>
      </div>

      <div class="flex-1 flex min-h-0">
        <For each={tabs()}>
          {(tab) => (
            <Terminal
              tabId={tab.id}
              label={tab.label}
              visible={activeId() === tab.id}
              initialScrollback={tab.initialScrollback}
              onSessionId={registerSessionId(tab.id)}
              registerSerializer={registerSerializer}
            />
          )}
        </For>
      </div>
    </div>
  );
}
