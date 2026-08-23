import { createSignal, Show } from "solid-js";
import { Power } from "lucide-solid";
import { shutdownApp } from "../lib/tauri";

/**
 * Przycisk zasilania — lewy dolny róg, zawsze na wierzchu.
 * Wymaga potwierdzenia (klik = pytanie, drugi klik w oknie 4s = wyłączenie),
 * żeby przypadkowe kliknięcie nie zamykało aplikacji operatorowi w trakcie pracy.
 */
export function PowerButton() {
  const [confirming, setConfirming] = createSignal(false);
  const [shuttingDown, setShuttingDown] = createSignal(false);
  let timeout: ReturnType<typeof setTimeout>;

  const handleClick = async () => {
    if (!confirming()) {
      setConfirming(true);
      timeout = setTimeout(() => setConfirming(false), 4000);
      return;
    }
    clearTimeout(timeout);
    setShuttingDown(true);
    await shutdownApp();
  };

  return (
    <div class="fixed bottom-4 left-4 z-[100] flex items-center gap-2">
      <Show when={confirming() && !shuttingDown()}>
        <span class="text-[9px] uppercase tracking-widest font-bold text-[var(--accent)] bg-[var(--bg-surface)] border border-[var(--accent-40)] rounded px-2 py-1 shadow-lg animate-pulse">
          Kliknij ponownie, aby wyłączyć
        </span>
      </Show>
      <button
        onClick={handleClick}
        disabled={shuttingDown()}
        title={confirming() ? "Potwierdź wyłączenie" : "Wyłącz aplikację"}
        class={`w-11 h-11 rounded-full flex items-center justify-center border shadow-[0_0_12px_var(--accent-15)] transition-colors ${
          confirming()
            ? "bg-[var(--accent)] border-[var(--accent)] text-black"
            : "bg-[var(--bg-surface)] border-[var(--border-default)] text-[var(--accent)] hover:bg-[var(--accent-10)] hover:border-[var(--accent-50)]"
        } ${shuttingDown() ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
      >
        <Power size={18} />
      </button>
    </div>
  );
}
