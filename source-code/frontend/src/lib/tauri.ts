const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getHostStatus(): Promise<{
  hostname: string;
  os: string;
  arch: string;
}> {
  if (!isTauri()) {
    return { hostname: "container_blackarch_alpha_01", os: "linux", arch: "x86_64" };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("get_host_status");
}

/**
 * Zamyka aplikację. Wywoływane przez przycisk zasilania.
 * Wymaga pluginu `tauri-plugin-process` (patrz src-tauri/Cargo.toml
 * oraz capabilities/default.json).
 */
export async function shutdownApp(): Promise<void> {
  if (!isTauri()) {
    console.warn("[power] shutdownApp() wywołane poza Tauri — no-op w przeglądarce.");
    return;
  }
  const { exit } = await import("@tauri-apps/plugin-process");
  await exit(0);
}

export function runningInTauri(): boolean {
  return isTauri();
}

// ---------------------------------------------------------------------------
// BlackArch Store (podman + pacman) — patrz source-code/backend/src/blackarch.rs
// ---------------------------------------------------------------------------

export interface BAPackage {
  name: string;
  version: string;
  description: string;
  category: string;
  installed: boolean;
}

export interface BACategory {
  id: string;
  label: string;
}

export type ContainerStatus = "missing" | "stopped" | "running" | "podman-not-found";

/** Mock danych do developmentu w przeglądarce (poza Tauri, bez podmana). */
const MOCK_CATEGORIES: BACategory[] = [
  { id: "blackarch-recon", label: "Rekonesans" },
  { id: "blackarch-scanner", label: "Skanery" },
  { id: "blackarch-webapp", label: "Aplikacje webowe" },
  { id: "blackarch-networking", label: "Sieć" },
  { id: "blackarch-forensic", label: "Informatyka śledcza" },
  { id: "blackarch-fuzzer", label: "Fuzzing" },
  { id: "blackarch-cracker", label: "Łamanie haseł" },
  { id: "blackarch-sniffer", label: "Podsłuch ruchu" },
  { id: "blackarch-wireless", label: "Bezprzewodowe" },
  { id: "blackarch-exploitation", label: "Eksploitacja" },
];

const MOCK_PACKAGES: BAPackage[] = [
  { name: "nmap", version: "7.93-1", description: "Network discovery i skanowanie portów.", category: "blackarch-scanner", installed: true },
  { name: "metasploit", version: "6.2.14-1", description: "Framework eksploitacji.", category: "blackarch-exploitation", installed: false },
  { name: "gowitness", version: "2.4.2-1", description: "Zrzuty ekranu stron przez Chrome Headless.", category: "blackarch-recon", installed: false },
];

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export async function checkPodman(): Promise<boolean> {
  if (!isTauri()) return true;
  return invoke<boolean>("check_podman");
}

export async function getContainerStatus(): Promise<ContainerStatus> {
  if (!isTauri()) return "running";
  return invoke<ContainerStatus>("container_status");
}

export async function ensureContainer(): Promise<ContainerStatus> {
  if (!isTauri()) {
    await new Promise((r) => setTimeout(r, 1200));
    return "running";
  }
  return invoke<ContainerStatus>("ensure_container");
}

export async function listCategories(): Promise<BACategory[]> {
  if (!isTauri()) return MOCK_CATEGORIES;
  return invoke<BACategory[]>("list_categories");
}

export async function packagesInCategory(category: string): Promise<BAPackage[]> {
  if (!isTauri()) return MOCK_PACKAGES.filter((p) => p.category === category);
  return invoke<BAPackage[]>("packages_in_category", { category });
}

export async function searchPackages(query: string): Promise<BAPackage[]> {
  if (!isTauri()) {
    const q = query.toLowerCase();
    return MOCK_PACKAGES.filter((p) => p.name.includes(q) || p.description.toLowerCase().includes(q));
  }
  return invoke<BAPackage[]>("search_packages", { query });
}

export async function installedPackages(): Promise<string[]> {
  if (!isTauri()) return MOCK_PACKAGES.filter((p) => p.installed).map((p) => p.name);
  return invoke<string[]>("installed_packages");
}

export async function installPackage(name: string): Promise<void> {
  if (!isTauri()) {
    await new Promise((r) => setTimeout(r, 1500));
    return;
  }
  return invoke<void>("install_package", { name });
}

export async function removePackage(name: string): Promise<void> {
  if (!isTauri()) {
    await new Promise((r) => setTimeout(r, 800));
    return;
  }
  return invoke<void>("remove_package", { name });
}

export interface Allowlist {
  allow_all: boolean;
  packages: string[];
}

export async function getAllowlist(): Promise<Allowlist> {
  if (!isTauri()) return { allow_all: true, packages: [] };
  return invoke<Allowlist>("get_allowlist");
}

export async function setAllowlist(allowlist: Allowlist): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("set_allowlist", { allowlist });
}

/** Nasłuchuje eventów postępu instalacji/tworzenia kontenera (`store://progress`). */
export async function onStoreProgress(cb: (evt: { stage: string; line: string }) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{ stage: string; line: string }>("store://progress", (e) => cb(e.payload));
  return unlisten;
}

// ---------------------------------------------------------------------------
// Auth / sesja operatora — patrz source-code/backend/src/auth.rs
// ---------------------------------------------------------------------------

export type Role = "operator" | "lead" | "auditor";

export interface Session {
  token: string;
  username: string;
  role: Role;
}

export async function login(username: string, password: string): Promise<Session> {
  if (!isTauri()) {
    await new Promise((r) => setTimeout(r, 400));
    if (password.length < 1) throw new Error("Nieprawidłowy login lub hasło.");
    return { token: "dev-session", username, role: "lead" };
  }
  return invoke<Session>("login", { username, password });
}

export async function logout(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("logout");
}

export async function currentSession(): Promise<Session | null> {
  if (!isTauri()) return null;
  return invoke<Session | null>("current_session");
}

/**
 * Czy backend działa w trybie `.no-login` (plik-znacznik
 * `~/.config/hackeros/Penetration-Mode/.no-login` — patrz `auth.rs`).
 * W tym trybie `currentSession()` zwraca sesję z rolą `lead` bez ekranu
 * logowania; frontend używa tego wyłącznie do pokazania stałego bannera
 * ostrzegawczego (patrz `App.tsx`), nigdy do podejmowania decyzji o
 * uprawnieniach — te i tak są w 100% egzekwowane po stronie backendu.
 */
export async function noLoginActive(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("no_login_active");
}

export function canMutate(role: Role): boolean {
  return role === "operator" || role === "lead";
}

export function canManageAllowlist(role: Role): boolean {
  return role === "lead";
}

/** Odświeża znacznik "ostatniej aktywności" po stronie backendu (idle
 * timeout — patrz auth.rs). Frontend woła to throttlowane na realną
 * aktywność operatora, patrz lib/idle.ts. */
export async function sessionHeartbeat(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("session_heartbeat");
}

// ---------------------------------------------------------------------------
// Audit log — patrz source-code/backend/src/audit.rs
// ---------------------------------------------------------------------------

export interface AuditRecord {
  timestamp: string;
  event: string;
  operator: string;
  details: unknown;
  /** `null` dla wpisów sprzed wprowadzenia łańcucha integralności (Runda 8). */
  seq: number | null;
}

export async function readAuditLog(limit = 50): Promise<AuditRecord[]> {
  if (!isTauri()) return [];
  return invoke<AuditRecord[]>("read_audit_log", { limit });
}

/** Integralność audit logu — patrz backend/src/audit.rs (łańcuch HMAC-SHA256). */
export interface AuditIntegrityReport {
  total_entries: number;
  verified_entries: number;
  unchained_entries: number;
  tampered_at_seq: number | null;
  ok: boolean;
}

export async function verifyAuditLog(): Promise<AuditIntegrityReport> {
  if (!isTauri()) {
    return { total_entries: 0, verified_entries: 0, unchained_entries: 0, tampered_at_seq: null, ok: true };
  }
  return invoke<AuditIntegrityReport>("verify_audit_log");
}

/** Notatka przypięta do wpisu audytu (np. "autoryzowany test, JIRA-123") —
 * patrz backend/src/audit.rs::add_audit_note. Nie modyfikuje oryginalnego
 * wpisu (łańcuch HMAC zostaje nienaruszony); to nowe zdarzenie
 * `audit.note_added` odwołujące się do `target_seq`. */
export async function addAuditNote(targetSeq: number, note: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("add_audit_note", { targetSeq, note });
}

// ---------------------------------------------------------------------------
// Eksport/replikacja audit logu na zewnątrz (syslog/webhook) —
// patrz source-code/backend/src/remote_audit.rs
// ---------------------------------------------------------------------------

export interface RemoteAuditConfig {
  syslog_host: string | null;
  syslog_port: number | null;
  webhook_url: string | null;
  webhook_token: string | null;
}

export const DEFAULT_REMOTE_AUDIT_CONFIG: RemoteAuditConfig = {
  syslog_host: null,
  syslog_port: null,
  webhook_url: null,
  webhook_token: null,
};

export async function getRemoteAuditConfig(): Promise<RemoteAuditConfig> {
  if (!isTauri()) return DEFAULT_REMOTE_AUDIT_CONFIG;
  return invoke<RemoteAuditConfig>("get_remote_audit_config");
}

export async function setRemoteAuditConfig(config: RemoteAuditConfig): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("set_remote_audit_config", { config });
}

// ---------------------------------------------------------------------------
// Terminal (PTY realny, w kontenerze Store) — patrz source-code/backend/src/pty.rs
// Runda 8: wiele równoległych sesji (taby) — każda komenda odtąd bierze
// `sessionId` zwrócony przez `ptyStart()`, a eventy niosą go w payloadzie.
// ---------------------------------------------------------------------------

let mockSessionCounter = 0;

/** Zwraca nowy `session_id`. W trybie przeglądarki (poza Tauri) generuje
 * lokalny fałszywy id, żeby TerminalTabs.tsx dawało się przeglądać/testować
 * bez backendu (patrz Terminal.tsx, które i tak w tym trybie tylko
 * wypisuje komunikat zamiast łączyć PTY). `label` trafia do rejestru
 * współdzielonych sesji (widok Team / podgląd przez Lead — patrz
 * backend/src/session_share.rs), żeby inni operatorzy widzieli sensowną
 * nazwę taba, nie tylko surowy `session_id`. */
export async function ptyStart(label?: string): Promise<string> {
  if (!isTauri()) return `mock-term-${++mockSessionCounter}`;
  return invoke<string>("pty_start", { label: label ?? null });
}

export async function ptyWrite(sessionId: string, data: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("pty_write", { sessionId, data });
}

export async function ptyResize(sessionId: string, rows: number, cols: number): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("pty_resize", { sessionId, rows, cols });
}

export async function ptyStop(sessionId: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("pty_stop", { sessionId });
}

/** Zamyka wszystkie otwarte sesje terminala naraz — wołane przy wylogowaniu. */
export async function ptyStopAll(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("pty_stop_all");
}

export interface PtyOutputEvent {
  session_id: string;
  chunk: string;
}

export async function onPtyOutput(cb: (evt: PtyOutputEvent) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<PtyOutputEvent>("pty://output", (e) => cb(e.payload));
  return unlisten;
}

export async function onPtyClosed(cb: (sessionId: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{ session_id: string }>("pty://closed", (e) => cb(e.payload.session_id));
  return unlisten;
}

// ---------------------------------------------------------------------------
// Trwały stan tabów terminala (scrollback między restartami appki) —
// patrz source-code/backend/src/terminal_state.rs
// ---------------------------------------------------------------------------

export interface TerminalTabSnapshot {
  id: string;
  label: string;
  scrollback: string;
}

export async function saveTerminalTabs(tabs: TerminalTabSnapshot[]): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("save_terminal_tabs", { tabs });
}

export async function loadTerminalTabs(): Promise<TerminalTabSnapshot[]> {
  if (!isTauri()) return [];
  return invoke<TerminalTabSnapshot[]>("load_terminal_tabs");
}

// ---------------------------------------------------------------------------
// Źródła danych (sieć + threat feed) — patrz source-code/backend/src/threat_feed.rs
// ---------------------------------------------------------------------------

export interface NetworkSample {
  rx_bytes: number;
  tx_bytes: number;
  container_running: boolean;
}

export async function getNetworkStats(): Promise<NetworkSample> {
  if (!isTauri()) {
    return { rx_bytes: Math.random() * 1e6, tx_bytes: Math.random() * 1e6, container_running: true };
  }
  return invoke<NetworkSample>("get_network_stats");
}

export interface ThreatEntry {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
}

/** Zwraca listę zagrożeń z podpiętego źródła, albo pustą listę / błąd jeśli
 * nic jeszcze nie skonfigurowano — patrz threat_feed.rs, celowo nie zmyślamy
 * danych po stronie frontendu. */
export async function getThreatFeed(): Promise<ThreatEntry[]> {
  if (!isTauri()) return [];
  return invoke<ThreatEntry[]>("get_threat_feed");
}

// ---------------------------------------------------------------------------
// Threat feed config — patrz source-code/backend/src/threat_feed.rs
// (komendy istniały w backendzie, ale nie były jeszcze podłączone tutaj —
// patrz sekcja "co wymaga rozbudowy"; teraz używane przez Settings.tsx)
// ---------------------------------------------------------------------------

export interface ThreatFeedConfig {
  source_url: string | null;
  /** Nagłówek `Authorization: Bearer <token>` przy odpytywaniu `source_url`
   * (patrz backend/src/threat_feed.rs) — większość wewnętrznych API
   * (SIEM/CVE feed) wymaga jakiejś autoryzacji. */
  api_token: string | null;
  /** Ścieżka kropkowa do tablicy zagrożeń wewnątrz odpowiedzi JSON (np.
   * `"data.items"`). Puste = odpowiedź to wprost tablica. */
  items_path: string | null;
  field_id: string | null;
  field_severity: string | null;
  field_title: string | null;
  field_description: string | null;
  /** Mapowanie wartości severity z API firmy (klucz, dowolna wielkość liter)
   * na nasze słownictwo "high"/"medium"/"low" (wartość). */
  severity_map: Record<string, string> | null;
}

export const DEFAULT_THREAT_FEED_CONFIG: ThreatFeedConfig = {
  source_url: null,
  api_token: null,
  items_path: null,
  field_id: null,
  field_severity: null,
  field_title: null,
  field_description: null,
  severity_map: null,
};

export async function getThreatFeedConfig(): Promise<ThreatFeedConfig> {
  if (!isTauri()) return DEFAULT_THREAT_FEED_CONFIG;
  return invoke<ThreatFeedConfig>("get_threat_feed_config");
}

export async function setThreatFeedConfig(config: ThreatFeedConfig): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("set_threat_feed_config", { config });
}

/** Status ostatniego pobrania threat feedu — do wskaźnika "dane sprzed
 * Ns"/"błąd: ..." w UI, żeby fallback na cache (patrz backend) nie był
 * niewidoczny/mylący dla operatora. */
export interface ThreatFeedStatus {
  configured: boolean;
  cached_age_secs: number | null;
  last_error: string | null;
}

export async function getThreatFeedStatus(): Promise<ThreatFeedStatus> {
  if (!isTauri()) return { configured: false, cached_age_secs: null, last_error: null };
  return invoke<ThreatFeedStatus>("get_threat_feed_status");
}

// ---------------------------------------------------------------------------
// Druga konsola: live tail logów — patrz source-code/backend/src/logs.rs
// ---------------------------------------------------------------------------

export type LogSource = "container" | "audit" | "system";

export const LOG_SOURCE_LABEL: Record<LogSource, string> = {
  container: "Kontener (podman logs -f)",
  audit: "Audit log (operator)",
  system: "System (journalctl)",
};

export interface LogLine {
  source: LogSource;
  line: string;
}

/** Uruchamia w backendzie strumień logów z wybranego źródła. Poprzedni
 * strumień (jeśli był) jest zatrzymywany automatycznie po stronie backendu. */
export async function logsTailStart(source: LogSource): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("logs_tail_start", { source });
}

export async function logsTailStop(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("logs_tail_stop");
}

export async function onLogOutput(cb: (line: LogLine) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<LogLine>("logs://output", (e) => cb(e.payload));
  return unlisten;
}

// ---------------------------------------------------------------------------
// Ustawienia aplikacji — patrz source-code/backend/src/settings.rs
// ---------------------------------------------------------------------------

export interface AppSettings {
  terminal_font_size: number;
  terminal_scrollback: number;
  logs_default_source: LogSource;
  logs_autostart: boolean;
  accent_color: string;
  theme: "dark" | "light";
  sound_enabled: boolean;
  no_login_banner_blink: boolean;
  idle_timeout_minutes: number;
  onboarding_completed: boolean;
  terminal_restore_scrollback: boolean;
  max_login_attempts: number;
  lockout_minutes: number;
  terminal_recording_enabled: boolean;
  block_unsigned_packages: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  terminal_font_size: 12,
  terminal_scrollback: 5000,
  logs_default_source: "audit",
  logs_autostart: true,
  accent_color: "#ff3333",
  theme: "dark",
  sound_enabled: false,
  no_login_banner_blink: false,
  idle_timeout_minutes: 0,
  onboarding_completed: false,
  terminal_restore_scrollback: true,
  max_login_attempts: 5,
  lockout_minutes: 15,
  terminal_recording_enabled: false,
  block_unsigned_packages: false,
};

export async function getAppSettings(): Promise<AppSettings> {
  if (!isTauri()) return DEFAULT_APP_SETTINGS;
  return invoke<AppSettings>("get_app_settings");
}

export async function setAppSettings(settings: AppSettings): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("set_app_settings", { settings });
}

// ---------------------------------------------------------------------------
// Aktualizacje — @tauri-apps/plugin-updater
// ---------------------------------------------------------------------------

export interface UpdateInfo {
  available: boolean;
  version?: string;
  notes?: string;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  if (!isTauri()) return { available: false };
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return { available: false };
  return { available: true, version: update.version, notes: update.body };
}

/** Pobiera i instaluje zaktualizowaną wersję, potem restartuje appkę. */
export async function downloadAndInstallUpdate(onProgress?: (pct: number) => void): Promise<void> {
  if (!isTauri()) return;
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const update = await check();
  if (!update) return;

  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      if (total > 0) onProgress?.(Math.min(100, Math.round((downloaded / total) * 100)));
    }
  });
  await relaunch();
}

// ---------------------------------------------------------------------------
// Kto jest teraz aktywny (widok Team) — patrz source-code/backend/src/presence.rs
// ---------------------------------------------------------------------------

export interface PresenceEntry {
  instance_id: string;
  username: string;
  role: Role;
  started_at: string;
  last_heartbeat_ms: number;
}

export async function listActiveOperators(): Promise<PresenceEntry[]> {
  if (!isTauri()) return [];
  return invoke<PresenceEntry[]>("list_active_operators");
}

// ---------------------------------------------------------------------------
// Współdzielenie sesji terminala (podgląd przez Lead) i nagrywanie —
// patrz source-code/backend/src/session_share.rs
// ---------------------------------------------------------------------------

export interface SharedSessionInfo {
  session_id: string;
  operator: string;
  label: string;
  started_at: string;
}

export async function listSharedSessions(): Promise<SharedSessionInfo[]> {
  if (!isTauri()) return [];
  return invoke<SharedSessionInfo[]>("list_shared_sessions");
}

export async function watchSessionStart(sessionId: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("watch_session_start", { sessionId });
}

export async function watchSessionStop(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("watch_session_stop");
}

export interface WatchOutputEvent {
  session_id: string;
  chunk: string;
}

export async function onWatchOutput(cb: (evt: WatchOutputEvent) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<WatchOutputEvent>("watch://output", (e) => cb(e.payload));
  return unlisten;
}

export interface RecordingInfo {
  filename: string;
  size_bytes: number;
  modified: string | null;
}

export async function listTerminalRecordings(): Promise<RecordingInfo[]> {
  if (!isTauri()) return [];
  return invoke<RecordingInfo[]>("list_terminal_recordings");
}

export async function readTerminalRecording(filename: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("read_terminal_recording", { filename });
}

// ---------------------------------------------------------------------------
// Snippety/makra poleceń terminala — patrz source-code/backend/src/snippets.rs
// ---------------------------------------------------------------------------

export interface Snippet {
  id: string;
  label: string;
  command: string;
}

export async function getSnippets(): Promise<Snippet[]> {
  if (!isTauri()) return [];
  return invoke<Snippet[]>("get_snippets");
}

export async function setSnippets(snippets: Snippet[]): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("set_snippets", { snippets });
}
