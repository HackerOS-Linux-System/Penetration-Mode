import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { Search, CornerDownLeft } from "lucide-solid";
import { filterCommands, type PaletteCommand } from "../lib/commandPalette";

/**
 * Command palette (Ctrl/Cmd+K) — Runda 8. Lista poleceń jest budowana i
 * przekazana przez `App.tsx` (bo tylko ono zna `setView`/`logout`/rolę
 * operatora); ten komponent to czysto prezentacja + nawigacja
 * klawiaturą + filtrowanie (delegowane do `lib/commandPalette.ts`).
 */
export function CommandPalette(props: { open: boolean; onClose: () => void; commands: PaletteCommand[]; onRun: (id: string) => void }) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const filtered = createMemo(() => filterCommands(props.commands, query()));

  createEffect(() => {
    if (props.open) {
      setQuery("");
      setSelected(0);
      queueMicrotask(() => inputRef?.focus());
    }
  });

  const run = (id: string) => {
    props.onRun(id);
    props.onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((n) => Math.min(n + 1, filtered().length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((n) => Math.max(n - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered()[selected()];
      if (cmd) run(cmd.id);
    }
  };

  // Zamknięcie kliknięciem w tło (overlay) — dodane jako listener na
  // dokument tylko gdy paleta jest otwarta, żeby nie łapać kliknięć w
  // resztę appki kiedy jest zamknięta.
  let overlayRef: HTMLDivElement | undefined;
  const onOverlayClick = (e: MouseEvent) => {
    if (e.target === overlayRef) props.onClose();
  };

  onMount(() => document.addEventListener("mousedown", onOverlayClick));
  onCleanup(() => document.removeEventListener("mousedown", onOverlayClick));

  return (
    <Show when={props.open}>
      <div ref={overlayRef} class="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh]">
        <div class="w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-xl shadow-2xl overflow-hidden">
          <div class="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
            <Search size={14} class="text-[var(--text-faint)]" />
            <input
              ref={inputRef}
              type="text"
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setSelected(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Wpisz komendę lub nazwę widoku..."
              class="flex-1 bg-transparent outline-none text-[12px] text-[var(--text-primary)] font-mono"
            />
            <kbd class="text-[9px] text-[var(--text-faint)] border border-[var(--border-default)] rounded px-1.5 py-0.5">ESC</kbd>
          </div>
          <div class="max-h-80 overflow-y-auto py-1.5">
            <For each={filtered()}>
              {(cmd, i) => (
                <button
                  onClick={() => run(cmd.id)}
                  onMouseEnter={() => setSelected(i())}
                  class={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-[11px] transition-colors ${
                    selected() === i() ? "bg-[var(--accent-10)] text-[var(--accent)]" : "text-[var(--text-primary)] hover:bg-[var(--bg-inset)]"
                  }`}
                >
                  <span class="flex items-center gap-2">
                    {selected() === i() && <CornerDownLeft size={11} />}
                    {cmd.label}
                  </span>
                  <span class="flex items-center gap-2">
                    {cmd.hint && <span class="text-[9px] text-[var(--text-faint)]">{cmd.hint}</span>}
                    {cmd.shortcut && (
                      <kbd class="text-[9px] text-[var(--text-faint)] border border-[var(--border-default)] rounded px-1.5 py-0.5">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </span>
                </button>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <div class="px-4 py-6 text-center text-[10px] text-[var(--text-faint)]">Brak pasujących poleceń.</div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
