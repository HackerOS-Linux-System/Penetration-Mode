import { createSignal, onCleanup, onMount, For } from "solid-js";
import { getNetworkStats } from "../lib/tauri";
import { kbpsToBarHeight } from "../lib/networkScale";

const HISTORY_LEN = 24;

/**
 * Realne I/O kontenera Store, czytane przez `podman stats` (patrz
 * source-code/backend/src/threat_feed.rs::get_network_stats), zamiast
 * losowych słupków. Pokazujemy delty między próbkami (bajty/s), nie
 * surowe skumulowane liczniki.
 */
export function NetworkMonitor() {
  const [bars, setBars] = createSignal<number[]>(Array(HISTORY_LEN).fill(4));
  const [kbps, setKbps] = createSignal(0);
  const [containerUp, setContainerUp] = createSignal(false);

  let lastRx = 0;
  let lastTx = 0;
  let hasSample = false;
  let interval: ReturnType<typeof setInterval>;

  const sample = async () => {
    const stats = await getNetworkStats();
    setContainerUp(stats.container_running);
    if (!stats.container_running) {
      setBars((prev) => [...prev.slice(1), 4]);
      return;
    }

    if (hasSample) {
      const deltaBytes = Math.max(0, stats.rx_bytes - lastRx) + Math.max(0, stats.tx_bytes - lastTx);
      const kbpsValue = deltaBytes / 1024;
      setKbps(kbpsValue);
      // skaluj do słupka 4-100% w oparciu o log, żeby pojedynczy skok nie spłaszczył reszty
      const height = kbpsToBarHeight(kbpsValue);
      setBars((prev) => [...prev.slice(1), height]);
    }
    lastRx = stats.rx_bytes;
    lastTx = stats.tx_bytes;
    hasSample = true;
  };

  onMount(() => {
    sample();
    interval = setInterval(sample, 2000);
  });
  onCleanup(() => clearInterval(interval));

  return (
    <div class="h-48 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 flex flex-col gap-3 shadow-lg">
      <div class="flex justify-between items-center">
        <h3 class="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          Network I/O — blackarch-redteam
        </h3>
        <span class={`text-[10px] ${containerUp() ? "text-[var(--text-disabled)]" : "text-yellow-600"}`}>
          {containerUp() ? `${kbps().toFixed(1)} kB/s` : "kontener nieaktywny"}
        </span>
      </div>
      <div class="flex-1 flex items-end gap-[2px] overflow-hidden">
        <For each={bars()}>
          {(height) => (
            <div
              class="w-full bg-[var(--accent)] transition-[height,opacity] duration-500 ease-out"
              style={{ height: `${height}%`, opacity: height > 40 ? 0.8 : 0.4 }}
            />
          )}
        </For>
      </div>
    </div>
  );
}
