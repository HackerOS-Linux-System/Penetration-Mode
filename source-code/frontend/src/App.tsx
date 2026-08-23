import { createSignal, onMount, onCleanup, lazy, Suspense, Show } from "solid-js";
import {
  Terminal as TerminalIcon,
  Layers,
  Activity as ActivityIcon,
  Settings as SettingsIcon,
  FileBarChart,
  Users,
  LogOut,
  DownloadCloud,
} from "lucide-solid";
import { TerminalTabs } from "./components/TerminalTabs";
import { LogsTerminal } from "./components/LogsTerminal";
import { NetworkMonitor } from "./components/NetworkMonitor";
import { ToolShop } from "./components/ToolShop";
import { Analytics } from "./components/Analytics";
import { DraggableScanner } from "./components/DraggableScanner";
import { PowerButton } from "./components/PowerButton";
import { Login } from "./components/Login";
import { CommandPalette } from "./components/CommandPalette";
import { Onboarding } from "./components/Onboarding";
import { ToastStack } from "./components/ToastStack";

// Code-splitting (Runda 10): dotąd Store/Reports/Settings/Activity/Team
// były importowane statycznie razem z App.tsx, mimo że w danej chwili
// widoczny jest najwyżej jeden z nich (reszta ukryta pod <Show>) — cały
// ich kod (w tym jsPDF + html2canvas + dompurify ciągnięte przez
// Reports.tsx) i tak trafiał do głównego bundla przy starcie appki.
// `lazy()` + `<Suspense>` sprawia, że kod danego widoku pobiera się
// dopiero przy pierwszym przejściu na niego.
const Activity = lazy(() => import("./components/Activity").then((m) => ({ default: m.Activity })));
const Settings = lazy(() => import("./components/Settings").then((m) => ({ default: m.Settings })));
const Reports = lazy(() => import("./components/Reports").then((m) => ({ default: m.Reports })));
const Team = lazy(() => import("./components/Team").then((m) => ({ default: m.Team })));
const Store = lazy(() => import("./components/Store").then((m) => ({ default: m.Store })));
import {
  type Session,
  currentSession,
  logout,
  checkForUpdate,
  downloadAndInstallUpdate,
  noLoginActive,
  getAppSettings,
  setAppSettings,
  sessionHeartbeat,
  ptyStopAll,
  getThreatFeed,
} from "./lib/tauri";
import { applyAccentColor } from "./lib/accent";
import { applyTheme, type Theme } from "./lib/theme";
import { attachIdleHeartbeat } from "./lib/idle";
import { pushToast } from "./lib/toast";
import { playAlertSound } from "./lib/sound";
import { findNewHighSeverityThreats } from "./lib/threatWatcher";
import type { PaletteCommand } from "./lib/commandPalette";

type View = "workspace" | "arsenal" | "activity" | "reports" | "team" | "settings";
const VIEW_ORDER: View[] = ["workspace", "arsenal", "activity", "reports", "team", "settings"];

const VIEW_TITLE: Record<View, string> = {
  workspace: "Workspace",
  arsenal: "Arsenal",
  activity: "Activity",
  reports: "Reports",
  team: "Team",
  settings: "Settings",
};

/** Skróty Ctrl/Cmd+K (paleta) i Ctrl/Cmd+1…6 (widoki) są ignorowane, gdy
 * fokus jest w terminalu albo w zwykłym polu tekstowym — inaczej np.
 * Ctrl+K w bashu (skrót readline: "wytnij do końca linii") albo pisanie
 * cyfry w polu formularza zostałoby przechwycone przez appkę zamiast
 * dotrzeć tam, gdzie operator faktycznie celował. */
function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".xterm")) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export default function App() {
  const [session, setSession] = createSignal<Session | null>(null);
  const [checkedSession, setCheckedSession] = createSignal(false);
  const [noLogin, setNoLogin] = createSignal(false);

  onMount(async () => {
    setSession(await currentSession());
    setNoLogin(await noLoginActive());
    setCheckedSession(true);
    try {
      const settings = await getAppSettings();
      applyAccentColor(settings.accent_color);
      applyTheme(settings.theme as Theme);
    } catch {
      // brak zapisanych ustawień jeszcze — zostają domyślne z index.css
    }
  });

  return (
    <Show when={checkedSession()} fallback={<div class="h-screen w-full bg-[var(--bg-app)]" />}>
      <Show when={noLogin()}>
        <div class="fixed top-0 left-0 right-0 z-50 bg-[var(--accent)] text-black text-[10px] font-mono font-bold tracking-widest text-center py-0.5">
          TRYB .no-login AKTYWNY — LOGOWANIE POMINIĘTE, ROLA LEAD BEZ OGRANICZEŃ
        </div>
      </Show>
      <Show when={session()} fallback={<Login onSuccess={setSession} />}>
        {(s) => <Workspace session={s()} onLogout={() => setSession(null)} />}
      </Show>
      <ToastStack />
    </Show>
  );
}

function Workspace(props: { session: Session; onLogout: () => void }) {
  const [view, setView] = createSignal<View>("workspace");
  const [updateAvailable, setUpdateAvailable] = createSignal<string | null>(null);
  const [updating, setUpdating] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [showOnboarding, setShowOnboarding] = createSignal(false);
  const [soundEnabled, setSoundEnabled] = createSignal(false);

  let idleIntervalCheck: ReturnType<typeof setInterval> | undefined;
  let threatPollInterval: ReturnType<typeof setInterval> | undefined;
  let detachHeartbeat: (() => void) | undefined;
  const seenThreatIds = new Set<string>();

  onMount(async () => {
    try {
      const info = await checkForUpdate();
      if (info.available && info.version) setUpdateAvailable(info.version);
    } catch {
      // brak endpointu/podpisu skonfigurowanego jeszcze — patrz SIGNING.md
    }

    try {
      const settings = await getAppSettings();
      setSoundEnabled(settings.sound_enabled);
      if (!settings.onboarding_completed) setShowOnboarding(true);
    } catch {
      // brak zapisanych ustawień — brak onboardingu/dźwięku do czasu pierwszego zapisu
    }

    // Auto-wylogowanie po bezczynności (patrz auth.rs::enforce_idle_timeout) —
    // frontend tylko: (a) throttlowanie zgłasza aktywność, (b) cyklicznie
    // pyta o sesję i reaguje, gdy backend uzna ją za wygasłą.
    detachHeartbeat = attachIdleHeartbeat(() => void sessionHeartbeat());
    idleIntervalCheck = setInterval(async () => {
      const current = await currentSession();
      if (!current) {
        pushToast("warning", "Sesja wygasła", "Wylogowano po przekroczeniu czasu bezczynności.");
        props.onLogout();
      }
    }, 30_000);

    // Powiadomienia o nowych zagrożeniach wysokiego ryzyka z threat feed
    // (patrz Ustawienia → Threat feed). Brak podpiętego źródła = po prostu
    // cicho nic nie robi (getThreatFeed rzuca, łapiemy i pomijamy).
    threatPollInterval = setInterval(async () => {
      try {
        const threats = await getThreatFeed();
        const fresh = findNewHighSeverityThreats(seenThreatIds, threats);
        for (const t of threats) seenThreatIds.add(t.id);
        for (const t of fresh) {
          pushToast("danger", `Zagrożenie wysokiego ryzyka: ${t.title}`, t.description);
          if (soundEnabled()) playAlertSound();
        }
      } catch {
        // brak podpiętego źródła threat feed — nic do zrobienia
      }
    }, 60_000);
  });

  onCleanup(() => {
    detachHeartbeat?.();
    if (idleIntervalCheck) clearInterval(idleIntervalCheck);
    if (threatPollInterval) clearInterval(threatPollInterval);
  });

  const finishOnboarding = async () => {
    setShowOnboarding(false);
    try {
      const settings = await getAppSettings();
      await setAppSettings({ ...settings, onboarding_completed: true });
    } catch {
      // brak ustawień do zapisania — onboarding i tak się nie pokaże ponownie w tej sesji
    }
  };

  const toggleTheme = async () => {
    try {
      const settings = await getAppSettings();
      const next: Theme = settings.theme === "light" ? "dark" : "light";
      applyTheme(next);
      await setAppSettings({ ...settings, theme: next });
    } catch {
      // brak zapisanych ustawień — przełączenie działa tylko wizualnie do restartu
    }
  };

  const paletteCommands = (): PaletteCommand[] => [
    { id: "view:workspace", label: "Idź do: Workspace", keywords: "terminal konsola logi", shortcut: "⌘1" },
    { id: "view:arsenal", label: "Idź do: Arsenal", keywords: "store sklep pakiety", shortcut: "⌘2" },
    { id: "view:activity", label: "Idź do: Activity", keywords: "audyt log zagrożenia", shortcut: "⌘3" },
    { id: "view:reports", label: "Idź do: Reports", keywords: "raporty pdf csv", shortcut: "⌘4" },
    { id: "view:team", label: "Idź do: Team", keywords: "zespół operatorzy podgląd nagrania", shortcut: "⌘5" },
    { id: "view:settings", label: "Idź do: Ustawienia", keywords: "settings motyw theme akcent", shortcut: "⌘6" },
    { id: "action:theme", label: "Przełącz motyw jasny/ciemny", keywords: "theme dark light tryb" },
    { id: "action:logout", label: "Wyloguj się", keywords: "logout exit koniec" },
  ];

  const runCommand = (id: string) => {
    if (id.startsWith("view:")) {
      setView(id.slice("view:".length) as View);
      return;
    }
    if (id === "action:theme") void toggleTheme();
    if (id === "action:logout") void handleLogout();
  };

  const onGlobalKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (isTypingContext(e.target)) return;

    if (e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen((v) => !v);
      return;
    }
    const num = Number(e.key);
    if (num >= 1 && num <= VIEW_ORDER.length) {
      e.preventDefault();
      setView(VIEW_ORDER[num - 1]);
    }
  };

  onMount(() => window.addEventListener("keydown", onGlobalKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onGlobalKeyDown));

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      await downloadAndInstallUpdate();
    } finally {
      setUpdating(false);
    }
  };

  const handleLogout = async () => {
    await ptyStopAll();
    await logout();
    props.onLogout();
  };

  return (
    <div class="relative flex flex-col h-screen w-full bg-[var(--bg-app)] text-[var(--text-primary)] font-sans overflow-hidden">
      {/* Draggable Multi-Window Element */}
      <DraggableScanner />

      {/* Power button - always on top, bottom-left */}
      <PowerButton />

      <CommandPalette open={paletteOpen()} onClose={() => setPaletteOpen(false)} commands={paletteCommands()} onRun={runCommand} />
      <Show when={showOnboarding()}>
        <Onboarding onFinish={finishOnboarding} />
      </Show>

      {/* Header */}
      <header class="h-10 bg-[var(--bg-surface-raised)] border-b border-[var(--border-default)] flex items-center justify-between px-4 select-none shrink-0 z-10">
        <div class="flex items-center gap-6">
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 bg-[var(--accent)] rounded-full shadow-[0_0_8px_var(--accent)] animate-pulse"></div>
            <span class="font-bold tracking-tighter text-sm text-[var(--accent)]">
              PENETRATION MODE <span class="text-white font-normal opacity-50">// RED TEAM v2.5</span>
            </span>
          </div>
          <nav class="hidden md:flex gap-4 text-[11px] uppercase tracking-widest font-semibold text-[var(--text-tertiary)]">
            <span
              onClick={() => setView("workspace")}
              class={`pb-1 cursor-pointer transition-colors ${
                view() === "workspace" ? "text-[var(--accent)] border-b border-[var(--accent)]" : "hover:text-[var(--text-primary)]"
              }`}
            >
              Workspace
            </span>
            <span
              onClick={() => setView("arsenal")}
              class={`pb-1 cursor-pointer transition-colors ${
                view() === "arsenal" ? "text-[var(--accent)] border-b border-[var(--accent)]" : "hover:text-[var(--text-primary)]"
              }`}
            >
              Arsenal
            </span>
            <span
              onClick={() => setView("activity")}
              class={`pb-1 cursor-pointer transition-colors ${
                view() === "activity" ? "text-[var(--accent)] border-b border-[var(--accent)]" : "hover:text-[var(--text-primary)]"
              }`}
            >
              Analytics
            </span>
            <span
              onClick={() => setView("reports")}
              class={`pb-1 cursor-pointer transition-colors ${
                view() === "reports" ? "text-[var(--accent)] border-b border-[var(--accent)]" : "hover:text-[var(--text-primary)]"
              }`}
            >
              Reports
            </span>
          </nav>
        </div>
        <div class="flex items-center gap-4 text-[10px] font-mono">
          <button
            onClick={() => setPaletteOpen(true)}
            title="Paleta poleceń (Ctrl/Cmd+K)"
            class="hidden sm:flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-[var(--text-faint)] border border-[var(--border-default)] rounded px-2 py-1 hover:border-[var(--accent-30)] hover:text-[var(--text-primary)] transition-colors"
          >
            <kbd class="text-[9px]">⌘K</kbd>
          </button>
          <Show when={updateAvailable()}>
            <button
              onClick={handleUpdate}
              disabled={updating()}
              class="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-[var(--accent)] border border-[var(--accent-30)] rounded px-2 py-1 hover:bg-[var(--accent-10)] transition-colors disabled:opacity-50"
              title={`Dostępna wersja ${updateAvailable()}`}
            >
              <DownloadCloud size={11} />
              {updating() ? "Aktualizuję..." : `Aktualizacja ${updateAvailable()}`}
            </button>
          </Show>
          <div class="flex gap-2 items-center">
            <span class="opacity-40">AES-256</span>
            <span class="text-green-500">ENCRYPTED</span>
          </div>
          <div class="h-4 w-[1px] bg-[var(--border-default)]"></div>
          <div class="flex items-center gap-2">
            <span class="text-[var(--text-primary)]">{props.session.username}</span>
            <span class="text-[8px] uppercase bg-[var(--border-default)] text-[var(--text-tertiary)] rounded px-1.5 py-0.5">{props.session.role}</span>
            <button onClick={handleLogout} title="Wyloguj" class="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
              <LogOut size={12} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main class="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 bg-[radial-gradient(circle_at_50%_50%,var(--bg-surface)_0%,var(--bg-app)_100%)] overflow-hidden">
        {/* Left Sidebar (Icons) — dawniej tylko Workspace/Arsenal działały,
            Activity/Settings były martwymi ikonami. Teraz 5 pełnoprawnych
            widoków, każdy z tooltipem. */}
        <aside class="hidden md:flex col-span-1 flex-col items-center py-4 gap-4 bg-[var(--bg-surface-raised-80)] rounded-xl border border-[var(--border-default)]">
          <SidebarIcon
            icon={TerminalIcon}
            label={VIEW_TITLE.workspace}
            active={view() === "workspace"}
            onClick={() => setView("workspace")}
          />
          <SidebarIcon icon={Layers} label={VIEW_TITLE.arsenal} active={view() === "arsenal"} onClick={() => setView("arsenal")} />
          <SidebarIcon icon={ActivityIcon} label={VIEW_TITLE.activity} active={view() === "activity"} onClick={() => setView("activity")} />
          <SidebarIcon icon={FileBarChart} label={VIEW_TITLE.reports} active={view() === "reports"} onClick={() => setView("reports")} />
          <SidebarIcon icon={Users} label={VIEW_TITLE.team} active={view() === "team"} onClick={() => setView("team")} />
          <div class="mt-auto">
            <SidebarIcon icon={SettingsIcon} label={VIEW_TITLE.settings} active={view() === "settings"} onClick={() => setView("settings")} />
          </div>
        </aside>

        <Show when={view() === "workspace"}>
          {/* Center Workspace: taby terminala + druga konsola (logi) + I/O sieci */}
          <section class="col-span-1 md:col-span-8 flex flex-col gap-3 min-h-0">
            <TerminalTabs />
            <LogsTerminal />
            <NetworkMonitor />
          </section>

          {/* Right Sidebar (Shop & Analytics) */}
          <aside class="col-span-1 md:col-span-3 flex flex-col gap-3 min-h-0">
            <ToolShop onOpenStore={() => setView("arsenal")} />
            <Analytics onOpenReports={() => setView("reports")} />
          </aside>
        </Show>

        <Show when={view() === "arsenal"}>
          <section class="col-span-1 md:col-span-11 flex flex-col min-h-0">
            <Suspense fallback={<ViewLoading />}>
              <Store session={props.session} />
            </Suspense>
          </section>
        </Show>

        <Show when={view() === "activity"}>
          <section class="col-span-1 md:col-span-11 flex flex-col min-h-0">
            <Suspense fallback={<ViewLoading />}>
              <Activity />
            </Suspense>
          </section>
        </Show>

        <Show when={view() === "reports"}>
          <section class="col-span-1 md:col-span-11 flex flex-col min-h-0">
            <Suspense fallback={<ViewLoading />}>
              <Reports session={props.session} />
            </Suspense>
          </section>
        </Show>

        <Show when={view() === "team"}>
          <section class="col-span-1 md:col-span-11 flex flex-col min-h-0">
            <Suspense fallback={<ViewLoading />}>
              <Team session={props.session} />
            </Suspense>
          </section>
        </Show>

        <Show when={view() === "settings"}>
          <section class="col-span-1 md:col-span-11 flex flex-col min-h-0">
            <Suspense fallback={<ViewLoading />}>
              <Settings session={props.session} />
            </Suspense>
          </section>
        </Show>
      </main>

      {/* Footer */}
      <footer class="h-6 bg-[var(--accent)] flex items-center px-4 justify-between text-[9px] font-bold text-black uppercase tracking-widest shrink-0">
        <div class="flex gap-4">
          <span>Status: OPERATIONAL</span>
          <span class="opacity-50">|</span>
          <span>Operator: {props.session.username}</span>
        </div>
        <div class="flex gap-2 items-center">
          <div class="w-2 h-2 bg-black rounded-full animate-pulse"></div>
          <span>ROLE: {props.session.role.toUpperCase()}</span>
        </div>
      </footer>
    </div>
  );
}

/** Fallback dla `<Suspense>` przy lazy-loadowanych widokach (Runda 10) —
 * prosty, spójny z resztą UI wskaźnik ładowania zamiast pustego ekranu
 * przez ułamek sekundy potrzebny na pobranie chunka danego widoku. */
function ViewLoading() {
  return (
    <div class="flex-1 flex items-center justify-center text-[10px] uppercase tracking-widest text-[var(--text-faint)]">
      Ładuję...
    </div>
  );
}

/** Ikona lewego paska z tooltipem (dawniej `title` w ogóle nie było ustawione
 * na tych elementach — dla Activity/Settings nie było też żadnego onClick). */
function SidebarIcon(props: { icon: any; label: string; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={props.onClick}
      title={props.label}
      class={`w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
        props.active
          ? "bg-[var(--accent-10)] text-[var(--accent)] border border-[var(--accent-20)] shadow-[0_0_10px_var(--accent-10)]"
          : "bg-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
      }`}
    >
      <props.icon size={20} />
    </div>
  );
}
