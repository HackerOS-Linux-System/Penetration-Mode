import { createSignal, onMount, onCleanup, createEffect, For, Show } from "solid-js";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { ScrollText, Eraser, Play, Pause, Download, Search, ChevronUp, ChevronDown, X } from "lucide-solid";
import {
  logsTailStart,
  logsTailStop,
  onLogOutput,
  runningInTauri,
  getAppSettings,
  LOG_SOURCE_LABEL,
  type LogSource,
} from "../lib/tauri";
import { currentTheme, LOGS_TERMINAL_THEMES } from "../lib/theme";
import { detectLogSeverity, SEVERITY_ANSI } from "../lib/logSeverity";

const SOURCES: LogSource[] = ["audit", "container", "system"];

const SOURCE_COLOR: Record<LogSource, string> = {
  audit: "\x1b[36m", // cyan
  container: "\x1b[32m", // green
  system: "\x1b[33m", // yellow
};
const RESET = "\x1b[0m";

/**
 * Druga konsola: nie wpisujemy w nią komend (to nie PTY), tylko na żywo
 * pokazuje strumień logów z wybranego źródła — kontener BlackArch
 * (`podman logs -f`), akcje operatora (audit log) albo host (`journalctl`).
 * Patrz source-code/backend/src/logs.rs.
 *
 * Używa xterm.js jak Terminal.tsx (spójny wygląd, prawdziwy scrollback),
 * ale bez `onData`/PTY — to konsola tylko do odczytu. Runda 8: kolor
 * per-linia wg wykrytej istotności (`lib/logSeverity.ts`) nadpisuje kolor
 * źródła dla linii z ERROR/CRITICAL/WARNING, plus wyszukiwanie
 * (`@xterm/addon-search`) i reaktywność na jasny/ciemny motyw.
 */
export function LogsTerminal() {
  let containerRef: HTMLDivElement | undefined;
  let xterm: XTerm | undefined;
  let fitAddon: FitAddon | undefined;
  let searchAddon: SearchAddon | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let unlisten: (() => void) | undefined;

  const [source, setSource] = createSignal<LogSource>("audit");
  const [running, setRunning] = createSignal(false);
  const [autoscroll, setAutoscroll] = createSignal(true);
  const [linesSeen, setLinesSeen] = createSignal(0);
  const [browserOnly] = createSignal(!runningInTauri());
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const buffer: string[] = [];

  const fit = () => {
    try {
      fitAddon?.fit();
    } catch {
      // patrz komentarz analogiczny w Terminal.tsx
    }
  };

  const stop = async () => {
    unlisten?.();
    unlisten = undefined;
    if (!browserOnly()) await logsTailStop();
    setRunning(false);
  };

  const colorForLine = (evt: { source: LogSource; line: string }): string => {
    const severity = detectLogSeverity(evt.line);
    return severity ? SEVERITY_ANSI[severity] : SOURCE_COLOR[evt.source];
  };

  const start = async (src: LogSource) => {
    if (!xterm) return;
    await stop();
    xterm.clear();
    buffer.length = 0;
    setLinesSeen(0);

    if (browserOnly()) {
      xterm.writeln(
        `\x1b[33mPodgląd logów (${LOG_SOURCE_LABEL[src]}) wymaga aplikacji Tauri — brak dostępu do procesów hosta w przeglądarce.\x1b[0m`,
      );
      return;
    }

    unlisten = await onLogOutput((evt) => {
      if (evt.source !== src) return; // ignoruj zdarzenia z poprzedniego (już zatrzymanego) źródła
      const colored = `${colorForLine(evt)}${evt.line}${RESET}`;
      xterm?.writeln(colored);
      setLinesSeen((n) => n + 1);
      buffer.push(evt.line);
      if (buffer.length > 5000) buffer.shift();
      if (autoscroll()) xterm?.scrollToBottom();
    });

    try {
      await logsTailStart(src);
      setRunning(true);
    } catch (e) {
      xterm.writeln(`\x1b[31mNie udało się uruchomić podglądu: ${String(e)}\x1b[0m`);
    }
  };

  const switchSource = async (src: LogSource) => {
    setSource(src);
    await start(src);
  };

  const runSearch = (direction: "next" | "prev") => {
    const q = searchQuery();
    if (!q || !searchAddon) return;
    if (direction === "next") searchAddon.findNext(q, { incremental: false });
    else searchAddon.findPrevious(q, { incremental: false });
  };

  const downloadLog = () => {
    const blob = new Blob([buffer.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `penetration-mode-logs-${source()}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  onMount(async () => {
    xterm = new XTerm({
      convertEol: true,
      cursorStyle: "underline",
      cursorBlink: false,
      disableStdin: true,
      fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
      fontSize: 11,
      scrollback: 5000,
      theme: LOGS_TERMINAL_THEMES[currentTheme()],
    });
    fitAddon = new FitAddon();
    searchAddon = new SearchAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(searchAddon);
    if (containerRef) xterm.open(containerRef);

    try {
      const prefs = await getAppSettings();
      setSource(prefs.logs_default_source);
      xterm.options.fontSize = Math.max(9, prefs.terminal_font_size - 1);
      if (prefs.logs_autostart) await start(prefs.logs_default_source);
    } catch {
      // brak zapisanych ustawień — zostaje "audit" bez autostartu
    }

    resizeObserver = new ResizeObserver(() => fit());
    if (containerRef) resizeObserver.observe(containerRef);
    fit();
  });

  // xterm.js renderuje przez <canvas> — patrz identyczny komentarz w Terminal.tsx.
  createEffect(() => {
    const theme = currentTheme();
    if (xterm) xterm.options.theme = LOGS_TERMINAL_THEMES[theme];
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    void stop();
    xterm?.dispose();
  });

  return (
    <div class="h-56 bg-[var(--bg-surface-alt)] rounded-xl border border-[var(--border-default)] relative overflow-hidden flex flex-col shadow-lg shrink-0">
      <div class="h-8 bg-[var(--bg-surface-raised)] border-b border-[var(--border-default)] px-3 flex items-center justify-between shrink-0">
        <span class="text-[10px] uppercase font-mono tracking-widest text-[var(--text-muted)] flex items-center gap-2">
          <ScrollText size={11} class={running() ? "text-[#00b7ff]" : "text-[var(--text-disabled)]"} />
          Logs {running() && <span class="text-[#00b7ff]">● live</span>}
          <span class="text-[var(--text-disabled)] normal-case tracking-normal">({linesSeen()})</span>
        </span>
        <div class="flex items-center gap-2">
          <div class="flex bg-[var(--bg-surface)] rounded border border-[var(--border-default)] overflow-hidden">
            <For each={SOURCES}>
              {(s) => (
                <button
                  onClick={() => switchSource(s)}
                  title={LOG_SOURCE_LABEL[s]}
                  class={`px-2 py-0.5 text-[9px] uppercase tracking-wider transition-colors ${
                    source() === s ? "bg-[#00b7ff]/20 text-[#00b7ff]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {s}
                </button>
              )}
            </For>
          </div>
          <button
            title="Szukaj w logach (Ctrl/Cmd+F)"
            onClick={() => setSearchOpen((v) => !v)}
            class={`transition-colors ${searchOpen() ? "text-[var(--accent)]" : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"}`}
          >
            <Search size={12} />
          </button>
          <button
            title={running() ? "Zatrzymaj podgląd" : "Wznów podgląd"}
            onClick={() => (running() ? stop() : start(source()))}
            class="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors"
          >
            {running() ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            title={autoscroll() ? "Wyłącz autoscroll" : "Włącz autoscroll"}
            onClick={() => setAutoscroll((v) => !v)}
            class={`text-[9px] uppercase tracking-wider transition-colors ${
              autoscroll() ? "text-[#00b7ff]" : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"
            }`}
          >
            auto
          </button>
          <button title="Pobierz log" onClick={downloadLog} class="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">
            <Download size={12} />
          </button>
          <button
            title="Wyczyść"
            onClick={() => {
              xterm?.clear();
              buffer.length = 0;
              setLinesSeen(0);
            }}
            class="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Eraser size={12} />
          </button>
        </div>
      </div>
      <Show when={searchOpen()}>
        <div class="h-7 bg-[var(--bg-inset)] border-b border-[var(--border-default)] px-3 flex items-center gap-2 shrink-0">
          <Search size={10} class="text-[var(--text-faint)]" />
          <input
            type="text"
            autofocus
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(e.shiftKey ? "prev" : "next");
              if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder="Szukaj..."
            class="flex-1 bg-transparent outline-none text-[10px] font-mono text-[var(--text-primary)]"
          />
          <button onClick={() => runSearch("prev")} class="text-[var(--text-faint)] hover:text-[var(--text-primary)]" title="Poprzednie">
            <ChevronUp size={11} />
          </button>
          <button onClick={() => runSearch("next")} class="text-[var(--text-faint)] hover:text-[var(--text-primary)]" title="Następne">
            <ChevronDown size={11} />
          </button>
          <button onClick={() => setSearchOpen(false)} class="text-[var(--text-faint)] hover:text-[var(--text-primary)]" title="Zamknij">
            <X size={11} />
          </button>
        </div>
      </Show>
      <div class="flex-1 min-h-0 px-2 py-1">
        <div ref={containerRef} class="h-full w-full" />
      </div>
    </div>
  );
}
