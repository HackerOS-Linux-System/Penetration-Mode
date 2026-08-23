import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { Search, Box, RefreshCw, AlertTriangle, Check, Loader2, History } from "lucide-solid";
import {
  type BACategory,
  type BAPackage,
  type ContainerStatus,
  type Session,
  checkPodman,
  getContainerStatus,
  ensureContainer,
  listCategories,
  packagesInCategory,
  searchPackages,
  installPackage,
  removePackage,
  onStoreProgress,
  canMutate,
} from "../lib/tauri";
import { type InstallState, installButtonLabel, isActionDisabled } from "../lib/installState";
import { InstallHistory } from "./InstallHistory";

const CONTAINER_LABEL = "blackarch-redteam (podman)";


export function Store(props: { session: Session }) {
  const [podmanOk, setPodmanOk] = createSignal<boolean | null>(null);
  const [status, setStatus] = createSignal<ContainerStatus | null>(null);
  const [settingUp, setSettingUp] = createSignal(false);
  const [setupError, setSetupError] = createSignal<string | null>(null);
  const [showHistory, setShowHistory] = createSignal(false);

  const [categories, setCategories] = createSignal<BACategory[]>([]);
  const [activeCategory, setActiveCategory] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const [packages, setPackages] = createSignal<BAPackage[]>([]);
  const [loadingPackages, setLoadingPackages] = createSignal(false);
  const [pkgActionState, setPkgActionState] = createSignal<Record<string, InstallState>>({});
  const [progressLines, setProgressLines] = createSignal<string[]>([]);

  let unlistenProgress: (() => void) | undefined;
  onMount(async () => {
    unlistenProgress = await onStoreProgress((evt) => {
      setProgressLines((prev) => [...prev.slice(-49), `[${evt.stage}] ${evt.line}`]);
    });
  });
  onCleanup(() => unlistenProgress?.());

  const bootstrap = async () => {
    const ok = await checkPodman();
    setPodmanOk(ok);
    if (!ok) return;

    const s = await getContainerStatus();
    setStatus(s);

    if (s === "running") {
      const cats = await listCategories();
      setCategories(cats);
      if (cats.length) setActiveCategory(cats[0].id);
    }
  };

  onMount(bootstrap);

  const handleInitContainer = async () => {
    setSettingUp(true);
    setSetupError(null);
    setProgressLines([]);
    try {
      const s = await ensureContainer();
      setStatus(s);
      if (s === "running") {
        const cats = await listCategories();
        setCategories(cats);
        if (cats.length) setActiveCategory(cats[0].id);
      }
    } catch (e) {
      setSetupError(String(e));
    } finally {
      setSettingUp(false);
    }
  };

  const loadCategory = async (categoryId: string) => {
    setActiveCategory(categoryId);
    setQuery("");
    setLoadingPackages(true);
    try {
      setPackages(await packagesInCategory(categoryId));
    } finally {
      setLoadingPackages(false);
    }
  };

  let searchTimeout: ReturnType<typeof setTimeout>;
  createEffect(() => {
    const q = query();
    if (status() !== "running") return;
    clearTimeout(searchTimeout);
    if (q.trim().length < 2) {
      if (activeCategory()) loadCategory(activeCategory()!);
      return;
    }
    searchTimeout = setTimeout(async () => {
      setLoadingPackages(true);
      try {
        setPackages(await searchPackages(q.trim()));
      } finally {
        setLoadingPackages(false);
      }
    }, 350);
  });

  const setPkgState = (name: string, state: InstallState) =>
    setPkgActionState((prev) => ({ ...prev, [name]: state }));

  const handleInstall = async (pkg: BAPackage) => {
    setPkgState(pkg.name, "installing");
    setProgressLines([]);
    try {
      await installPackage(pkg.name);
      setPackages((prev) => prev.map((p) => (p.name === pkg.name ? { ...p, installed: true } : p)));
    } finally {
      setPkgState(pkg.name, "idle");
    }
  };

  const handleRemove = async (pkg: BAPackage) => {
    setPkgState(pkg.name, "removing");
    try {
      await removePackage(pkg.name);
      setPackages((prev) => prev.map((p) => (p.name === pkg.name ? { ...p, installed: false } : p)));
    } finally {
      setPkgState(pkg.name, "idle");
    }
  };

  return (
    <div class="flex-1 flex flex-col min-h-0 bg-[var(--bg-surface-alt)] rounded-xl border border-[var(--border-default)] overflow-hidden shadow-lg relative">
      {/* Toolbar */}
      <div class="h-12 border-b border-[var(--border-default)] flex items-center gap-3 px-4 shrink-0 bg-[var(--bg-surface)]">
        <Box size={16} class="text-[var(--accent)]" />
        <span class="text-[11px] font-bold uppercase tracking-widest text-[var(--text-primary)]">BlackArch Store</span>
        <span class="text-[9px] text-[var(--text-faint)] font-mono">// {CONTAINER_LABEL}</span>
        <div class="flex-1" />
        <Show when={status() === "running"}>
          <div class="relative">
            <Search size={12} class="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Szukaj narzędzi (pacman -Ss)..."
              class="bg-[var(--bg-app)] border border-[var(--border-strong)] rounded pl-7 pr-3 py-1.5 text-[10px] text-[var(--text-primary)] font-mono outline-none focus:border-[var(--accent-50)] w-64"
            />
          </div>
          <button
            onClick={() => setShowHistory(true)}
            title="Historia instalacji / rollback"
            class="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[#1a1a1a] transition-colors"
          >
            <History size={13} />
          </button>
          <button
            onClick={handleInitContainer}
            title="Zresetuj / zsynchronizuj kontener"
            class="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[#1a1a1a] transition-colors"
          >
            <RefreshCw size={13} class={settingUp() ? "animate-spin" : ""} />
          </button>
        </Show>
      </div>

      <Show when={showHistory()}>
        <InstallHistory onClose={() => setShowHistory(false)} canMutate={canMutate(props.session.role)} />
      </Show>

      {/* Body */}
      <Show
        when={podmanOk() !== null}
        fallback={
          <div class="flex-1 flex items-center justify-center text-[var(--text-faint)] text-[11px] gap-2">
            <Loader2 size={14} class="animate-spin" /> Sprawdzam środowisko...
          </div>
        }
      >
        <Show
          when={podmanOk()}
          fallback={
            <div class="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
              <AlertTriangle size={28} class="text-yellow-500" />
              <p class="text-[12px] text-[var(--text-primary)] font-bold">Nie znaleziono Podmana</p>
              <p class="text-[10px] text-[var(--text-muted)] max-w-md">
                Store wymaga zainstalowanego Podmana w systemie hosta, żeby uruchomić izolowany kontener BlackArch.
                Zainstaluj Podman (np. <code class="text-[var(--text-tertiary)]">sudo pacman -S podman</code> /{" "}
                <code class="text-[var(--text-tertiary)]">apt install podman</code>) i uruchom Store ponownie.
              </p>
            </div>
          }
        >
          <Show
            when={status() === "running"}
            fallback={
              <div class="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                <Show
                  when={!settingUp()}
                  fallback={
                    <>
                      <Loader2 size={28} class="text-[var(--accent)] animate-spin" />
                      <p class="text-[12px] text-[var(--text-primary)] font-bold">Przygotowuję kontener BlackArch...</p>
                      <div class="w-full max-w-md bg-[var(--bg-app)] border border-[var(--border-default)] rounded p-2 h-32 overflow-y-auto text-left">
                        <For each={progressLines()}>
                          {(line) => <div class="text-[9px] font-mono text-[#00ff41] leading-relaxed">{line}</div>}
                        </For>
                      </div>
                    </>
                  }
                >
                  <Box size={28} class="text-[var(--accent)]" />
                  <p class="text-[12px] text-[var(--text-primary)] font-bold">
                    {status() === "missing" ? "Kontener BlackArch nie istnieje" : "Kontener BlackArch jest zatrzymany"}
                  </p>
                  <p class="text-[10px] text-[var(--text-muted)] max-w-md">
                    Pierwsze uruchomienie Store tworzy kontener podman ({CONTAINER_LABEL}) z obrazu
                    blackarch/blackarch i synchronizuje repozytorium pakietów. Wymaga to połączenia z internetem.
                  </p>
                  <button
                    onClick={handleInitContainer}
                    class="bg-[var(--accent)] hover:bg-[#ff5555] text-black text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded transition-colors"
                  >
                    {status() === "missing" ? "Utwórz kontener BlackArch" : "Uruchom kontener"}
                  </button>
                  <Show when={setupError()}>
                    <p class="text-[9px] text-[#ff5555] max-w-md font-mono">{setupError()}</p>
                  </Show>
                </Show>
              </div>
            }
          >
            <div class="flex-1 flex min-h-0">
              {/* Category sidebar */}
              <div class="w-44 border-r border-[var(--border-default)] overflow-y-auto shrink-0 py-2">
                <For each={categories()}>
                  {(cat) => (
                    <button
                      onClick={() => loadCategory(cat.id)}
                      class={`w-full text-left px-4 py-2 text-[10px] uppercase tracking-wider transition-colors ${
                        activeCategory() === cat.id && !query()
                          ? "bg-[var(--accent-10)] text-[var(--accent)] border-r-2 border-[var(--accent)]"
                          : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)]"
                      }`}
                    >
                      {cat.label}
                    </button>
                  )}
                </For>
              </div>

              {/* Package grid */}
              <div class="flex-1 overflow-y-auto p-4">
                <Show
                  when={!loadingPackages()}
                  fallback={
                    <div class="flex items-center justify-center h-full text-[var(--text-faint)] text-[10px] gap-2">
                      <Loader2 size={14} class="animate-spin" /> Ładuję pakiety...
                    </div>
                  }
                >
                  <Show
                    when={packages().length > 0}
                    fallback={<div class="text-[10px] text-[var(--text-faint)] text-center pt-10">Brak wyników.</div>}
                  >
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <For each={packages()}>
                        {(pkg) => {
                          const state = () => pkgActionState()[pkg.name] ?? "idle";
                          return (
                            <div class="p-3 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg hover:border-[var(--accent-40)] transition-colors flex flex-col gap-2">
                              <div class="flex justify-between items-start gap-2">
                                <div>
                                  <div class="text-[11px] font-bold text-[var(--text-primary)] font-mono">{pkg.name}</div>
                                  <div class="text-[9px] text-[var(--text-faint)] font-mono">{pkg.version}</div>
                                </div>
                                <Show when={pkg.installed}>
                                  <span class="flex items-center gap-1 text-[8px] text-green-500 bg-green-900/20 border border-green-500/20 rounded px-1.5 py-0.5 shrink-0">
                                    <Check size={9} /> ZAINSTALOWANO
                                  </span>
                                </Show>
                              </div>
                              <p class="text-[9px] text-[var(--text-tertiary)] leading-snug flex-1">{pkg.description || "Brak opisu."}</p>
                              <Show
                                when={pkg.installed}
                                fallback={
                                  <button
                                    onClick={() => handleInstall(pkg)}
                                    disabled={isActionDisabled(state())}
                                    class="text-[9px] font-bold uppercase tracking-wider py-1.5 rounded bg-[var(--border-default)] text-white hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
                                  >
                                    {installButtonLabel(false, state())}
                                  </button>
                                }
                              >
                                <button
                                  onClick={() => handleRemove(pkg)}
                                  disabled={isActionDisabled(state())}
                                  class="text-[9px] font-bold uppercase tracking-wider py-1.5 rounded bg-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--border-strong)] hover:text-white transition-colors disabled:opacity-50"
                                >
                                  {installButtonLabel(true, state())}
                                </button>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
            </div>

            {/* Konsola postępu instalacji/usuwania (store://progress) */}
            <Show when={Object.values(pkgActionState()).some((s) => s !== "idle") && progressLines().length > 0}>
              <div class="border-t border-[var(--border-default)] bg-[var(--bg-app)] h-24 overflow-y-auto p-2 shrink-0">
                <For each={progressLines()}>
                  {(line) => <div class="text-[9px] font-mono text-[#00ff41] leading-relaxed">{line}</div>}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
