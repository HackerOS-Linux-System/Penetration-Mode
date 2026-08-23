import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { X, PackagePlus, PackageMinus, Undo2, RefreshCw } from "lucide-solid";
import { readAuditLog, installPackage, removePackage, type AuditRecord } from "../lib/tauri";

type Action = "installed" | "removed";

interface HistoryItem {
  seq: number | null;
  timestamp: string;
  operator: string;
  package: string;
  action: Action;
}

function toHistoryItem(r: AuditRecord): HistoryItem | null {
  const pkg = (r.details as { package?: string } | null)?.package;
  if (!pkg) return null;
  if (r.event === "store.package_installed") return { seq: r.seq, timestamp: r.timestamp, operator: r.operator, package: pkg, action: "installed" };
  if (r.event === "store.package_removed") return { seq: r.seq, timestamp: r.timestamp, operator: r.operator, package: pkg, action: "removed" };
  return null;
}

/**
 * Historia instalacji z rollbackiem (Runda 8) — dotąd `store.package_installed`/
 * `store.package_removed` trafiały do audit logu, ale nie było żadnego UI
 * do ich przejrzenia poza ogólną tabelą Activity, a już na pewno nie było
 * sposobu na jednoklikowe cofnięcie. "Rollback" to po prostu wykonanie
 * odwrotnej akcji (usuń, jeśli był zainstalowany / zainstaluj ponownie,
 * jeśli był usunięty) — backend i tak loguje to jako nowe, osobne
 * zdarzenie audytowe, więc historia zostaje w pełni spójna (widać both
 * oryginalną akcję i jej cofnięcie, nie ma "cichego" nadpisania).
 */
export function InstallHistory(props: { onClose: () => void; canMutate: boolean }) {
  const [items, setItems] = createSignal<HistoryItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [rollingBack, setRollingBack] = createSignal<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const records = await readAuditLog(500);
      const history = records.map(toHistoryItem).filter((x): x is HistoryItem => x !== null);
      setItems(history);
    } finally {
      setLoading(false);
    }
  };

  onMount(load);

  // Stan "aktualny" wg historii — ostatnia akcja na dany pakiet decyduje,
  // czy przycisk rollbacku ma zaproponować "usuń" czy "zainstaluj ponownie".
  const latestActionByPackage = createMemo(() => {
    const map = new Map<string, Action>();
    // `items` jest od najnowszych do najstarszych (patrz readAuditLog) —
    // pierwsze trafienie na dany pakiet to jego najnowszy stan.
    for (const item of items()) {
      if (!map.has(item.package)) map.set(item.package, item.action);
    }
    return map;
  });

  const rollback = async (item: HistoryItem) => {
    setRollingBack(item.package);
    try {
      if (item.action === "installed") {
        await removePackage(item.package);
      } else {
        await installPackage(item.package);
      }
      await load();
    } finally {
      setRollingBack(null);
    }
  };

  const isStale = (item: HistoryItem) => latestActionByPackage().get(item.package) !== item.action;

  return (
    <div class="absolute inset-0 z-20 bg-[var(--bg-surface)] flex flex-col">
      <div class="h-12 border-b border-[var(--border-default)] flex items-center gap-3 px-4 shrink-0">
        <Undo2 size={14} class="text-[var(--accent)]" />
        <span class="text-[11px] font-bold uppercase tracking-widest text-[var(--text-primary)]">Historia instalacji</span>
        <div class="flex-1" />
        <button onClick={load} title="Odśwież" class="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">
          <RefreshCw size={13} class={loading() ? "animate-spin" : ""} />
        </button>
        <button onClick={props.onClose} title="Zamknij" class="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">
          <X size={16} />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-4">
        <Show when={!loading()} fallback={<div class="text-[10px] text-[var(--text-faint)] text-center pt-10">Ładuję historię...</div>}>
          <Show when={items().length > 0} fallback={<div class="text-[10px] text-[var(--text-faint)] text-center pt-10">Brak historii instalacji.</div>}>
            <div class="flex flex-col gap-2">
              <For each={items()}>
                {(item) => (
                  <div
                    class={`flex items-center gap-3 p-3 rounded-lg border ${
                      isStale(item) ? "border-[var(--border-default)] opacity-50" : "border-[var(--border-default)]"
                    } bg-[var(--bg-inset)]`}
                  >
                    {item.action === "installed" ? (
                      <PackagePlus size={14} class="text-green-500 shrink-0" />
                    ) : (
                      <PackageMinus size={14} class="text-[#ff5555] shrink-0" />
                    )}
                    <div class="flex-1 min-w-0">
                      <div class="text-[11px] font-mono font-bold text-[var(--text-primary)]">{item.package}</div>
                      <div class="text-[9px] text-[var(--text-faint)]">
                        {item.action === "installed" ? "Zainstalowano" : "Usunięto"} przez {item.operator} ·{" "}
                        {new Date(item.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <Show when={props.canMutate && !isStale(item)}>
                      <button
                        onClick={() => rollback(item)}
                        disabled={rollingBack() === item.package}
                        title={item.action === "installed" ? "Cofnij (usuń pakiet)" : "Cofnij (zainstaluj ponownie)"}
                        class="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded bg-[#222] text-white hover:bg-[var(--accent)] transition-colors disabled:opacity-40 shrink-0"
                      >
                        <Undo2 size={11} />
                        {rollingBack() === item.package ? "..." : "Cofnij"}
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
