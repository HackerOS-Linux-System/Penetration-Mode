import { createSignal, onMount, onCleanup, createEffect, Show, For } from "solid-js";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { RotateCcw, Eraser, Search, ChevronUp, ChevronDown, X, Sparkles } from "lucide-solid";
import { ptyStart, ptyWrite, ptyResize, ptyStop, onPtyOutput, onPtyClosed, runningInTauri, getAppSettings, getSnippets, type Snippet } from "../lib/tauri";
import { currentTheme, TERMINAL_THEMES } from "../lib/theme";

/**
 * Jeden tab terminala — PTY podpięty pod `podman exec -it blackarch-redteam
 * bash` (patrz source-code/backend/src/pty.rs). Zarządzany przez
 * `TerminalTabs.tsx`, które renderuje wiele instancji tego komponentu
 * naraz (Runda 8: wcześniej istniała dokładnie jedna sesja terminala w
 * całej appce — otwarcie "drugiego terminala" nie było w ogóle możliwe).
 *
 * Używa xterm.js jako właściwego emulatora terminala: `onData` wysyła
 * surowe bajty klawiatury 1:1 do PTY, `write()` interpretuje ANSI,
 * scrollback/resize są obsługiwane przez sam xterm. Dodatkowo (Runda 8):
 * `SerializeAddon` do zrzucania zawartości bufora (persystencja między
 * restartami appki, patrz `TerminalTabs.tsx`), `SearchAddon` (Ctrl/Cmd+F),
 * i reaktywność na `lib/theme.ts` (canvas nie czyta zmiennych CSS, więc
 * motyw trzeba przełączać ręcznie tutaj — patrz `createEffect` niżej).
 */
export function Terminal(props: {
  tabId: string;
  label?: string;
  initialScrollback?: string;
  visible: boolean;
  onSessionId?: (sessionId: string) => void;
  registerSerializer?: (tabId: string, fn: () => string) => void;
}) {
  let containerRef: HTMLDivElement | undefined;
  let xterm: XTerm | undefined;
  let fitAddon: FitAddon | undefined;
  let serializeAddon: SerializeAddon | undefined;
  let searchAddon: SearchAddon | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let unlistenOutput: (() => void) | undefined;
  let unlistenClosed: (() => void) | undefined;
  let sessionId: string | undefined;

  const [connected, setConnected] = createSignal(false);
  const [starting, setStarting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [browserOnly] = createSignal(!runningInTauri());
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [snippetsOpen, setSnippetsOpen] = createSignal(false);
  const [snippets, setSnippetsList] = createSignal<Snippet[]>([]);

  const fit = () => {
    if (!fitAddon || !xterm || !props.visible) return;
    try {
      fitAddon.fit();
      if (connected() && sessionId) void ptyResize(sessionId, xterm.rows, xterm.cols);
    } catch {
      // Kontener może mieć chwilowo zerowy rozmiar (np. tab w tle) —
      // fit() wtedy rzuca, bezpiecznie ignorujemy i spróbujemy przy
      // następnym resize/przełączeniu taba.
    }
  };

  const stopSession = () => {
    unlistenOutput?.();
    unlistenClosed?.();
    unlistenOutput = undefined;
    unlistenClosed = undefined;
    if (connected() && sessionId) void ptyStop(sessionId);
    setConnected(false);
  };

  const start = async () => {
    if (!xterm) return;
    if (browserOnly()) {
      xterm.writeln(
        "\x1b[33mTerminal wymaga uruchomienia w aplikacji Tauri (poza przeglądarką) — PTY łączy się z `podman exec` na hoście, którego web preview nie ma.\x1b[0m",
      );
      return;
    }
    setStarting(true);
    setError(null);
    try {
      unlistenOutput = await onPtyOutput((evt) => {
        if (evt.session_id !== sessionId) return;
        xterm?.write(evt.chunk);
      });
      unlistenClosed = await onPtyClosed((closedId) => {
        if (closedId !== sessionId) return;
        setConnected(false);
      });
      sessionId = await ptyStart(props.label);
      props.onSessionId?.(sessionId);
      setConnected(true);
      fit();
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  };

  const restart = async () => {
    xterm?.clear();
    stopSession();
    await start();
  };

  const runSearch = (direction: "next" | "prev") => {
    const q = searchQuery();
    if (!q || !searchAddon) return;
    if (direction === "next") searchAddon.findNext(q, { incremental: false });
    else searchAddon.findPrevious(q, { incremental: false });
  };

  const insertSnippet = (command: string) => {
    // Bez automatycznego Entera — operator zawsze widzi, co się wpisało,
    // zanim sam zdecyduje się nacisnąć Enter (patrz snippets.rs).
    if (connected() && sessionId) void ptyWrite(sessionId, command);
    setSnippetsOpen(false);
    xterm?.focus();
  };

  const toggleSnippets = async () => {
    if (!snippetsOpen()) {
      try {
        setSnippetsList(await getSnippets());
      } catch {
        setSnippetsList([]);
      }
    }
    setSnippetsOpen((v) => !v);
  };

  onMount(async () => {
    xterm = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
      fontSize: 12,
      scrollback: 5000,
      theme: TERMINAL_THEMES[currentTheme()],
    });
    fitAddon = new FitAddon();
    serializeAddon = new SerializeAddon();
    searchAddon = new SearchAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());
    xterm.loadAddon(serializeAddon);
    xterm.loadAddon(searchAddon);
    if (containerRef) xterm.open(containerRef);

    // Przywrócenie scrollbacku z poprzedniej sesji appki (Runda 8) — to
    // czysty strumień ANSI zserializowany przez `SerializeAddon`, więc
    // wystarczy go wypisać przed podłączeniem żywego PTY, żeby pojawił
    // się jako historia nad świeżym promptem.
    if (props.initialScrollback) {
      xterm.write(props.initialScrollback);
      xterm.write("\r\n\x1b[2m── przywrócono poprzednią sesję ──\x1b[0m\r\n");
    }

    props.registerSerializer?.(props.tabId, () => serializeAddon?.serialize() ?? "");

    // Ładujemy preferencje operatora (rozmiar czcionki/scrollback) z
    // ustawień aplikacji — patrz Settings.tsx / backend/src/settings.rs.
    try {
      const prefs = await getAppSettings();
      xterm.options.fontSize = prefs.terminal_font_size;
      xterm.options.scrollback = prefs.terminal_scrollback;
    } catch {
      // brak ustawień jeszcze zapisanych — zostają domyślne
    }

    xterm.onData((data) => {
      if (connected() && sessionId) void ptyWrite(sessionId, data);
    });

    resizeObserver = new ResizeObserver(() => fit());
    if (containerRef) resizeObserver.observe(containerRef);

    fit();
    await start();
    if (props.visible) xterm.focus();
  });

  // xterm.js renderuje przez <canvas> — nie czyta zmiennych CSS, więc
  // zmianę motywu (lib/theme.ts) trzeba tu ręcznie przełożyć na literalny
  // zestaw kolorów za każdym razem, gdy operator przełączy jasny/ciemny.
  createEffect(() => {
    const theme = currentTheme();
    if (xterm) xterm.options.theme = TERMINAL_THEMES[theme];
  });

  createEffect(() => {
    if (props.visible) {
      fit();
      xterm?.focus();
    }
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    stopSession();
    xterm?.dispose();
  });

  return (
    <div
      class="flex-1 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] relative overflow-hidden flex flex-col shadow-lg min-h-0"
      classList={{ hidden: !props.visible }}
    >
      <div class="h-8 bg-[var(--bg-surface-raised)] border-b border-[var(--border-default)] px-4 flex items-center justify-between cursor-move shrink-0">
        <span class="text-[10px] uppercase font-mono tracking-widest text-[var(--text-muted)] flex items-center gap-2">
          <span class={`w-1.5 h-1.5 rounded-full ${connected() ? "bg-green-500" : "bg-[var(--text-disabled)]"}`} />
          {connected() ? "Live Session: blackarch-redteam (podman exec)" : starting() ? "Łączę..." : "Rozłączono"}
        </span>
        <div class="flex items-center gap-3">
          <div class="relative">
            <button
              title="Snippety poleceń"
              onClick={toggleSnippets}
              class={`transition-colors ${snippetsOpen() ? "text-[var(--accent)]" : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"}`}
            >
              <Sparkles size={12} />
            </button>
            <Show when={snippetsOpen()}>
              <div class="absolute right-0 top-6 z-30 w-56 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg shadow-2xl py-1 max-h-56 overflow-y-auto">
                <For each={snippets()}>
                  {(snippet) => (
                    <button
                      onClick={() => insertSnippet(snippet.command)}
                      class="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-inset)] transition-colors"
                    >
                      <div class="text-[10px] font-bold text-[var(--text-primary)]">{snippet.label}</div>
                      <div class="text-[9px] font-mono text-[var(--text-faint)] truncate">{snippet.command}</div>
                    </button>
                  )}
                </For>
                <Show when={snippets().length === 0}>
                  <div class="px-3 py-2 text-[9px] text-[var(--text-faint)] italic">
                    Brak snippetów — dodaj je w Ustawieniach.
                  </div>
                </Show>
              </div>
            </Show>
          </div>
          <button
            title="Szukaj w terminalu (Ctrl/Cmd+F)"
            onClick={() => setSearchOpen((v) => !v)}
            class={`transition-colors ${searchOpen() ? "text-[var(--accent)]" : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"}`}
          >
            <Search size={12} />
          </button>
          <button
            title="Wyczyść ekran"
            onClick={() => xterm?.clear()}
            class="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Eraser size={12} />
          </button>
          <button
            title="Uruchom sesję ponownie"
            onClick={restart}
            disabled={starting()}
            class="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30"
          >
            <RotateCcw size={12} />
          </button>
          <div class="flex gap-1">
            <div class="w-2 h-2 rounded-full bg-[var(--border-strong)] hover:bg-yellow-500 transition-colors cursor-pointer" />
            <div class="w-2 h-2 rounded-full bg-[var(--border-strong)] hover:bg-green-500 transition-colors cursor-pointer" />
            <div
              class="w-2 h-2 rounded-full bg-[var(--border-strong)] hover:bg-red-500 transition-colors cursor-pointer"
              title="Zakończ sesję"
              onClick={stopSession}
            />
          </div>
        </div>
      </div>
      <Show when={searchOpen()}>
        <div class="h-8 bg-[var(--bg-inset)] border-b border-[var(--border-default)] px-3 flex items-center gap-2 shrink-0">
          <Search size={11} class="text-[var(--text-faint)]" />
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
            <ChevronUp size={12} />
          </button>
          <button onClick={() => runSearch("next")} class="text-[var(--text-faint)] hover:text-[var(--text-primary)]" title="Następne">
            <ChevronDown size={12} />
          </button>
          <button onClick={() => setSearchOpen(false)} class="text-[var(--text-faint)] hover:text-[var(--text-primary)]" title="Zamknij">
            <X size={12} />
          </button>
        </div>
      </Show>
      <div class="flex-1 min-h-0 px-2 py-1" onClick={() => xterm?.focus()}>
        <div ref={containerRef} class="h-full w-full" />
      </div>
      {error() && (
        <div class="px-3 py-1.5 text-[10px] font-mono text-[#ff5555] bg-[#1a0000] border-t border-[#331111] shrink-0">
          {error()}
        </div>
      )}
    </div>
  );
}
