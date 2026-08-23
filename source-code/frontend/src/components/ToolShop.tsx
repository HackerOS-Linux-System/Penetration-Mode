import { createSignal, onMount, Show } from "solid-js";
import { Box, ArrowUpRight, Circle } from "lucide-solid";
import { type ContainerStatus, checkPodman, getContainerStatus, installedPackages } from "../lib/tauri";

interface Props {
  onOpenStore: () => void;
}

const STATUS_LABEL: Record<ContainerStatus, string> = {
  running: "Kontener aktywny",
  stopped: "Kontener zatrzymany",
  missing: "Kontener nieutworzony",
  "podman-not-found": "Brak Podmana",
};

const STATUS_COLOR: Record<ContainerStatus, string> = {
  running: "text-green-500",
  stopped: "text-yellow-500",
  missing: "text-[var(--text-tertiary)]",
  "podman-not-found": "text-[var(--accent)]",
};

/**
 * Kompaktowy skrót do pełnego BlackArch Store (patrz components/Store.tsx),
 * pokazywany w prawym sidebarze zakładki "Workspace".
 */
export function ToolShop(props: Props) {
  const [status, setStatus] = createSignal<ContainerStatus | null>(null);
  const [installedCount, setInstalledCount] = createSignal<number | null>(null);

  onMount(async () => {
    const ok = await checkPodman();
    if (!ok) {
      setStatus("podman-not-found");
      return;
    }
    const s = await getContainerStatus();
    setStatus(s);
    if (s === "running") {
      setInstalledCount((await installedPackages()).length);
    }
  });

  return (
    <div class="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 flex flex-col gap-3 shadow-lg">
      <div class="flex items-center justify-between">
        <h2 class="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Tool Arsenal</h2>
        <Box size={14} class="text-[var(--text-faint)]" />
      </div>

      <Show
        when={status() !== null}
        fallback={<div class="text-[9px] text-[var(--text-faint)]">Sprawdzam środowisko...</div>}
      >
        <div class="flex items-center gap-2 text-[9px]">
          <Circle size={7} class={`${STATUS_COLOR[status()!]} fill-current`} />
          <span class={STATUS_COLOR[status()!]}>{STATUS_LABEL[status()!]}</span>
        </div>
        <Show when={installedCount() !== null}>
          <div class="text-[9px] text-[var(--text-muted)]">
            Zainstalowane pakiety: <span class="text-[var(--text-primary)] font-mono">{installedCount()}</span>
          </div>
        </Show>
      </Show>

      <button
        onClick={props.onOpenStore}
        class="w-full py-2 mt-1 text-[9px] font-bold uppercase tracking-widest rounded bg-[var(--border-default)] text-white hover:bg-[var(--accent)] transition-colors flex items-center justify-center gap-1.5"
      >
        Otwórz Store
        <ArrowUpRight size={11} />
      </button>
    </div>
  );
}
