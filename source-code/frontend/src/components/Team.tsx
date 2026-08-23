import { createSignal, onMount, onCleanup, createEffect, For, Show } from "solid-js";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Users, Eye, EyeOff, Video, Download, RefreshCw, Circle, TerminalSquare } from "lucide-solid";
import {
  type Session,
  type PresenceEntry,
  type SharedSessionInfo,
  type RecordingInfo,
  listActiveOperators,
  listSharedSessions,
  watchSessionStart,
  watchSessionStop,
  onWatchOutput,
  listTerminalRecordings,
  readTerminalRecording,
  canManageAllowlist,
  runningInTauri,
} from "../lib/tauri";
import { currentTheme, LOGS_TERMINAL_THEMES } from "../lib/theme";

const ROLE_COLOR: Record<string, string> = {
  lead: "text-[var(--accent)] bg-[var(--accent-10)] border-[var(--accent-30)]",
  operator: "text-[#00b7ff] bg-[#00b7ff]/10 border-[#00b7ff]/30",
  auditor: "text-[var(--text-tertiary)] bg-[var(--bg-inset)] border-[var(--border-default)]",
};

/**
 * Widok Team (Runda 10, nowa pozycja w lewym pasku) — dwie pokrewne
 * funkcje oparte na tym samym backendzie (`presence.rs`/`session_share.rs`):
 *
 * 1. Roster "kto jest teraz aktywny" — widoczny dla każdego zalogowanego.
 * 2. Podgląd na żywo cudzej sesji terminala + lista nagrań — tylko Lead
 *    (patrz `canManageAllowlist`, ten sam próg roli co reszta uprawnień
 *    Lead w appce).
 *
 * **Uczciwie o zasięgu:** appka jest per-konto-systemowe domyślnie (patrz
 * komentarz w `presence.rs`) — na jednym koncie zobaczysz kilka
 * równoległych procesów appki, ale między RÓŻNYMI kontami na
 * współdzielonym labie wymaga to `PENETRATION_MODE_SHARED_DIR` ustawionego
 * przez wdrożenie na wspólną lokalizację z odpowiednimi uprawnieniami.
 */
export function Team(props: { session: Session }) {
  const [operators, setOperators] = createSignal<PresenceEntry[]>([]);
  const [sharedSessions, setSharedSessions] = createSignal<SharedSessionInfo[]>([]);
  const [recordings, setRecordings] = createSignal<RecordingInfo[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [watchingSessionId, setWatchingSessionId] = createSignal<string | null>(null);

  const canWatch = () => canManageAllowlist(props.session.role);

  let containerRef: HTMLDivElement | undefined;
  let xterm: XTerm | undefined;
  let fitAddon: FitAddon | undefined;
  let unlistenWatch: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let refreshInterval: ReturnType<typeof setInterval> | undefined;

  const load = async () => {
    setLoading(true);
    try {
      const [ops, sessions] = await Promise.all([listActiveOperators(), listSharedSessions()]);
      setOperators(ops);
      setSharedSessions(sessions);
      if (canWatch()) setRecordings(await listTerminalRecordings());
    } finally {
      setLoading(false);
    }
  };

  const stopWatching = async () => {
    unlistenWatch?.();
    unlistenWatch = undefined;
    if (watchingSessionId()) await watchSessionStop();
    setWatchingSessionId(null);
  };

  const startWatching = async (info: SharedSessionInfo) => {
    await stopWatching();
    xterm?.clear();
    xterm?.writeln(`\x1b[90m── podgląd sesji: ${info.operator} (${info.label}) ──\x1b[0m`);
    try {
      unlistenWatch = await onWatchOutput((evt) => {
        if (evt.session_id !== info.session_id) return;
        xterm?.write(evt.chunk);
      });
      await watchSessionStart(info.session_id);
      setWatchingSessionId(info.session_id);
    } catch (e) {
      xterm?.writeln(`\x1b[31mNie udało się rozpocząć podglądu: ${String(e)}\x1b[0m`);
    }
  };

  const downloadRecording = async (filename: string) => {
    const content = await readTerminalRecording(filename);
    const blob = new Blob([content], { type: "application/x-asciicast" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  onMount(() => {
    xterm = new XTerm({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
      fontSize: 11,
      scrollback: 3000,
      theme: LOGS_TERMINAL_THEMES[currentTheme()],
    });
    fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    if (containerRef) xterm.open(containerRef);
    if (!runningInTauri()) {
      xterm.writeln("\x1b[33mPodgląd sesji wymaga aplikacji Tauri.\x1b[0m");
    } else {
      xterm.writeln("\x1b[90mWybierz sesję z listy po prawej, żeby zacząć podgląd.\x1b[0m");
    }

    resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon?.fit();
      } catch {
        // kontener może mieć chwilowo zerowy rozmiar — bezpiecznie ignorujemy
      }
    });
    if (containerRef) resizeObserver.observe(containerRef);

    void load();
    refreshInterval = setInterval(load, 15_000);
  });

  createEffect(() => {
    const theme = currentTheme();
    if (xterm) xterm.options.theme = LOGS_TERMINAL_THEMES[theme];
  });

  onCleanup(() => {
    if (refreshInterval) clearInterval(refreshInterval);
    resizeObserver?.disconnect();
    void stopWatching();
    xterm?.dispose();
  });

  return (
    <div class="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-3 min-h-0">
      <div class="lg:col-span-2 flex flex-col gap-3 min-h-0">
        <div class="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 flex flex-col gap-2 shadow-lg">
          <div class="flex items-center justify-between">
            <h2 class="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)] flex items-center gap-2">
              <Users size={13} />
              Aktywni operatorzy
            </h2>
            <button onClick={load} title="Odśwież" class="text-[var(--text-faint)] hover:text-[var(--text-primary)]">
              <RefreshCw size={12} class={loading() ? "animate-spin" : ""} />
            </button>
          </div>
          <div class="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
            <For each={operators()}>
              {(op) => (
                <div class="flex items-center gap-2 bg-[var(--bg-inset)] rounded px-2 py-1.5">
                  <Circle size={7} class="text-green-500 fill-current shrink-0" />
                  <span class="text-[10px] font-mono text-[var(--text-primary)] flex-1 truncate">{op.username}</span>
                  <span class={`text-[8px] uppercase px-1.5 py-0.5 rounded border ${ROLE_COLOR[op.role] ?? ROLE_COLOR.auditor}`}>{op.role}</span>
                </div>
              )}
            </For>
            <Show when={operators().length === 0}>
              <span class="text-[9px] text-[var(--text-faint)] italic px-1">Brak innych aktywnych operatorów widocznych stąd.</span>
            </Show>
          </div>
        </div>

        <div class="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 flex-1 flex flex-col gap-2 min-h-0 shadow-lg">
          <h2 class="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)] flex items-center gap-2">
            <TerminalSquare size={13} />
            Otwarte terminale
          </h2>
          <div class="flex-1 overflow-y-auto flex flex-col gap-1.5">
            <For each={sharedSessions()}>
              {(s) => (
                <button
                  onClick={() => canWatch() && startWatching(s)}
                  disabled={!canWatch()}
                  class={`text-left flex items-center gap-2 rounded px-2 py-1.5 border transition-colors ${
                    watchingSessionId() === s.session_id
                      ? "bg-[var(--accent-10)] border-[var(--accent-30)]"
                      : "bg-[var(--bg-inset)] border-transparent hover:border-[var(--border-strong)]"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {watchingSessionId() === s.session_id ? (
                    <Eye size={12} class="text-[var(--accent)] shrink-0" />
                  ) : (
                    <EyeOff size={12} class="text-[var(--text-faint)] shrink-0" />
                  )}
                  <div class="flex-1 min-w-0">
                    <div class="text-[9px] font-bold text-[var(--text-primary)] truncate">
                      {s.operator} · {s.label}
                    </div>
                    <div class="text-[8px] text-[var(--text-faint)]">od {new Date(s.started_at).toLocaleTimeString()}</div>
                  </div>
                </button>
              )}
            </For>
            <Show when={sharedSessions().length === 0}>
              <span class="text-[9px] text-[var(--text-faint)] italic px-1">Nikt nie ma teraz otwartego terminala.</span>
            </Show>
          </div>
          <Show when={!canWatch()}>
            <p class="text-[9px] text-yellow-600">Podgląd sesji wymaga roli Lead.</p>
          </Show>
        </div>

        <Show when={canWatch()}>
          <div class="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 flex flex-col gap-2 shadow-lg max-h-40">
            <h2 class="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)] flex items-center gap-2">
              <Video size={13} />
              Nagrania sesji
            </h2>
            <div class="overflow-y-auto flex flex-col gap-1">
              <For each={recordings()}>
                {(r) => (
                  <div class="flex items-center gap-2 bg-[var(--bg-inset)] rounded px-2 py-1">
                    <span class="text-[9px] font-mono text-[var(--text-primary)] flex-1 truncate">{r.filename}</span>
                    <span class="text-[8px] text-[var(--text-faint)]">{(r.size_bytes / 1024).toFixed(0)}KB</span>
                    <button onClick={() => downloadRecording(r.filename)} class="text-[var(--text-faint)] hover:text-[var(--accent)]">
                      <Download size={11} />
                    </button>
                  </div>
                )}
              </For>
              <Show when={recordings().length === 0}>
                <span class="text-[9px] text-[var(--text-faint)] italic px-1">
                  Brak nagrań — włącz "Nagrywaj sesje terminala" w Ustawieniach.
                </span>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      <div class="lg:col-span-3 bg-[var(--bg-surface-alt)] rounded-xl border border-[var(--border-default)] flex flex-col overflow-hidden shadow-lg">
        <div class="h-8 bg-[var(--bg-surface-raised)] border-b border-[var(--border-default)] px-3 flex items-center justify-between shrink-0">
          <span class="text-[10px] uppercase font-mono tracking-widest text-[var(--text-muted)] flex items-center gap-2">
            <Eye size={11} class={watchingSessionId() ? "text-[var(--accent)]" : "text-[var(--text-disabled)]"} />
            {watchingSessionId() ? "Podgląd na żywo" : "Brak podglądu"}
          </span>
          <Show when={watchingSessionId()}>
            <button onClick={stopWatching} class="text-[9px] uppercase tracking-widest text-[var(--text-faint)] hover:text-[#ff5555]">
              Zakończ podgląd
            </button>
          </Show>
        </div>
        <div class="flex-1 min-h-0 px-2 py-1">
          <div ref={containerRef} class="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
