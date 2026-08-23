import { createSignal, createEffect, onMount, Show, For } from "solid-js";
import {
  Save,
  RotateCcw,
  ShieldCheck,
  Terminal as TerminalIcon,
  Palette,
  Radio,
  Info,
  Timer,
  FileCheck2,
  Volume2,
  Send,
  Sparkles,
  Plus,
  Trash2,
  Lock,
  Video,
} from "lucide-solid";
import {
  type Session,
  type AppSettings,
  type LogSource,
  type Allowlist,
  type AuditIntegrityReport,
  type ThreatFeedConfig,
  type RemoteAuditConfig,
  type Snippet,
  DEFAULT_APP_SETTINGS,
  DEFAULT_REMOTE_AUDIT_CONFIG,
  LOG_SOURCE_LABEL,
  getAppSettings,
  setAppSettings,
  getThreatFeedConfig,
  setThreatFeedConfig,
  getAllowlist,
  setAllowlist,
  canManageAllowlist,
  verifyAuditLog,
  getRemoteAuditConfig,
  setRemoteAuditConfig,
  getSnippets,
  setSnippets,
} from "../lib/tauri";
import { applyAccentColor, isValidHex, normalizeHex } from "../lib/accent";
import { applyTheme, type Theme } from "../lib/theme";
import { playNotifySound } from "../lib/sound";

const ACCENTS = ["#ff3333", "#00b7ff", "#00ff41", "#ffb300", "#c084fc"];

function Section(props: { icon: any; title: string; children: any }) {
  return (
    <div class="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 flex flex-col gap-3 shadow-lg">
      <h2 class="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)] flex items-center gap-2">
        <props.icon size={13} />
        {props.title}
      </h2>
      {props.children}
    </div>
  );
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="flex items-center justify-between text-[10px] text-[var(--text-primary)] cursor-pointer py-1">
      <span>{props.label}</span>
      <button
        type="button"
        onClick={() => props.onChange(!props.checked)}
        class={`w-8 h-4 rounded-full transition-colors relative ${props.checked ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"}`}
      >
        <span
          class={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            props.checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

/**
 * Pełny panel ustawień — wcześniej ikona "Settings" w lewym pasku nie
 * robiła nic. Cztery sekcje: terminal/logi (preferencje UI, per-appka,
 * patrz backend/src/settings.rs), źródło threat feed (Lead — patrz
 * threat_feed.rs), allowlist pakietów Store (Lead — patrz blackarch.rs) i
 * informacje o sesji/appce.
 */
export function Settings(props: { session: Session }) {
  const [settings, setSettings] = createSignal<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loaded, setLoaded] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  const [threatUrl, setThreatUrl] = createSignal("");
  const [threatToken, setThreatToken] = createSignal("");
  const [threatSaving, setThreatSaving] = createSignal(false);
  const [threatSaved, setThreatSaved] = createSignal(false);
  const [threatAdapterOpen, setThreatAdapterOpen] = createSignal(false);
  const [itemsPath, setItemsPath] = createSignal("");
  const [fieldId, setFieldId] = createSignal("");
  const [fieldSeverity, setFieldSeverity] = createSignal("");
  const [fieldTitle, setFieldTitle] = createSignal("");
  const [fieldDescription, setFieldDescription] = createSignal("");
  const [severityMapText, setSeverityMapText] = createSignal("");
  const [severityMapError, setSeverityMapError] = createSignal(false);

  const [remoteAudit, setRemoteAuditState] = createSignal<RemoteAuditConfig>(DEFAULT_REMOTE_AUDIT_CONFIG);
  const [remoteAuditSaving, setRemoteAuditSaving] = createSignal(false);
  const [remoteAuditSaved, setRemoteAuditSaved] = createSignal(false);

  const [snippetList, setSnippetList] = createSignal<Snippet[]>([]);
  const [snippetsSaving, setSnippetsSaving] = createSignal(false);
  const [newSnippetLabel, setNewSnippetLabel] = createSignal("");
  const [newSnippetCommand, setNewSnippetCommand] = createSignal("");

  const [allowlist, setAllowlistState] = createSignal<Allowlist>({ allow_all: true, packages: [] });
  const [allowlistSaving, setAllowlistSaving] = createSignal(false);
  const [newPkg, setNewPkg] = createSignal("");

  const [integrity, setIntegrity] = createSignal<AuditIntegrityReport | null>(null);
  const [checkingIntegrity, setCheckingIntegrity] = createSignal(false);

  // Pole tekstowe hexa koloru akcentu — osobny sygnał od `settings().accent_color`,
  // bo podczas pisania chcemy pokazać dokładnie to, co operator wpisuje
  // (łącznie z chwilowo niepełnym/nieprawidłowym hexem), a dopiero przy
  // Enter/blur "zatwierdzić" i zastosować. Synchronizowane w drugą stronę
  // (presety, natywny picker) przez `createEffect` niżej.
  const [hexInput, setHexInputValue] = createSignal(DEFAULT_APP_SETTINGS.accent_color);
  const [hexError, setHexError] = createSignal(false);

  const canEditAllowlist = () => canManageAllowlist(props.session.role);

  onMount(async () => {
    const [s, tf, al, ra, sn] = await Promise.all([
      getAppSettings(),
      getThreatFeedConfig(),
      getAllowlist(),
      getRemoteAuditConfig(),
      getSnippets(),
    ]);
    setSettings(s);
    setHexInputValue(s.accent_color);
    setThreatUrl(tf.source_url ?? "");
    setThreatToken(tf.api_token ?? "");
    setItemsPath(tf.items_path ?? "");
    setFieldId(tf.field_id ?? "");
    setFieldSeverity(tf.field_severity ?? "");
    setFieldTitle(tf.field_title ?? "");
    setFieldDescription(tf.field_description ?? "");
    setSeverityMapText(tf.severity_map ? JSON.stringify(tf.severity_map, null, 2) : "");
    setAllowlistState(al);
    setRemoteAuditState(ra);
    setSnippetList(sn);
    setLoaded(true);
  });

  const applyAndSetAccent = (hex: string) => {
    const normalized = normalizeHex(hex);
    if (!normalized) return;
    update("accent_color", normalized);
    setHexInputValue(normalized);
    setHexError(false);
    applyAccentColor(normalized); // podgląd na żywo, zanim operator kliknie "Zapisz"
  };

  const commitHexInput = () => {
    const normalized = normalizeHex(hexInput());
    if (!normalized) {
      setHexError(true);
      return;
    }
    applyAndSetAccent(normalized);
  };

  // Gdy kolor zmienia się z innego źródła niż samo pole tekstowe (presety,
  // natywny `<input type="color">`, "Przywróć domyślne"), trzymamy pole
  // tekstowe w zgodzie z aktualną wartością — inaczej operator zobaczyłby
  // stary hex mimo że kolor UI już się zmienił.
  createEffect(() => {
    setHexInputValue(settings().accent_color);
    setHexError(false);
  });

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await setAppSettings(settings());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    setSettings(DEFAULT_APP_SETTINGS);
    applyAccentColor(DEFAULT_APP_SETTINGS.accent_color); // podgląd — "Zapisz" wciąż wymagane, żeby przetrwało restart
  };

  const saveThreatFeed = async () => {
    let severityMap: Record<string, string> | null = null;
    if (severityMapText().trim() !== "") {
      try {
        severityMap = JSON.parse(severityMapText());
        setSeverityMapError(false);
      } catch {
        setSeverityMapError(true);
        return;
      }
    }
    const config: ThreatFeedConfig = {
      source_url: threatUrl().trim() === "" ? null : threatUrl().trim(),
      api_token: threatToken().trim() === "" ? null : threatToken().trim(),
      items_path: itemsPath().trim() === "" ? null : itemsPath().trim(),
      field_id: fieldId().trim() === "" ? null : fieldId().trim(),
      field_severity: fieldSeverity().trim() === "" ? null : fieldSeverity().trim(),
      field_title: fieldTitle().trim() === "" ? null : fieldTitle().trim(),
      field_description: fieldDescription().trim() === "" ? null : fieldDescription().trim(),
      severity_map: severityMap,
    };
    setThreatSaving(true);
    try {
      await setThreatFeedConfig(config);
      setThreatSaved(true);
      setTimeout(() => setThreatSaved(false), 2000);
    } finally {
      setThreatSaving(false);
    }
  };

  const saveRemoteAudit = async () => {
    setRemoteAuditSaving(true);
    try {
      await setRemoteAuditConfig(remoteAudit());
      setRemoteAuditSaved(true);
      setTimeout(() => setRemoteAuditSaved(false), 2000);
    } finally {
      setRemoteAuditSaving(false);
    }
  };

  const updateRemoteAudit = <K extends keyof RemoteAuditConfig>(key: K, value: RemoteAuditConfig[K]) => {
    setRemoteAuditState((prev) => ({ ...prev, [key]: value }));
  };

  const saveSnippetsList = async () => {
    setSnippetsSaving(true);
    try {
      await setSnippets(snippetList());
    } finally {
      setSnippetsSaving(false);
    }
  };

  const addSnippet = () => {
    const label = newSnippetLabel().trim();
    const command = newSnippetCommand().trim();
    if (!label || !command) return;
    setSnippetList((prev) => [...prev, { id: `snip-${Date.now()}`, label, command }]);
    setNewSnippetLabel("");
    setNewSnippetCommand("");
  };

  const removeSnippet = (id: string) => {
    setSnippetList((prev) => prev.filter((s) => s.id !== id));
  };

  const saveAllowlist = async () => {
    setAllowlistSaving(true);
    try {
      await setAllowlist(allowlist());
    } finally {
      setAllowlistSaving(false);
    }
  };

  const addPackage = () => {
    const name = newPkg().trim();
    if (!name) return;
    setAllowlistState((prev) => ({ ...prev, packages: [...new Set([...prev.packages, name])] }));
    setNewPkg("");
  };

  const removePackage = (name: string) => {
    setAllowlistState((prev) => ({ ...prev, packages: prev.packages.filter((p) => p !== name) }));
  };

  const toggleTheme = (theme: Theme) => {
    update("theme", theme);
    applyTheme(theme); // podgląd na żywo, jak przy kolorze akcentu
  };

  const runIntegrityCheck = async () => {
    setCheckingIntegrity(true);
    try {
      setIntegrity(await verifyAuditLog());
    } finally {
      setCheckingIntegrity(false);
    }
  };

  return (
    <div class="flex-1 flex flex-col min-h-0 overflow-y-auto pr-1" style={{ "scrollbar-width": "thin", "scrollbar-color": "var(--border-strong) var(--bg-surface)" }}>
      <Show when={loaded()} fallback={<div class="text-[10px] text-[var(--text-faint)] p-4">Wczytuję ustawienia...</div>}>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 pb-4">
          <Section icon={TerminalIcon} title="Terminal i logi">
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                Rozmiar czcionki terminala ({settings().terminal_font_size}px)
              </label>
              <input
                type="range"
                min="9"
                max="20"
                value={settings().terminal_font_size}
                onInput={(e) => update("terminal_font_size", Number(e.currentTarget.value))}
                class="accent-[var(--accent)]"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                Scrollback ({settings().terminal_scrollback.toLocaleString()} linii)
              </label>
              <input
                type="range"
                min="500"
                max="20000"
                step="500"
                value={settings().terminal_scrollback}
                onInput={(e) => update("terminal_scrollback", Number(e.currentTarget.value))}
                class="accent-[var(--accent)]"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Domyślne źródło drugiej konsoli</label>
              <div class="flex gap-1">
                <For each={["audit", "container", "system"] as LogSource[]}>
                  {(s) => (
                    <button
                      onClick={() => update("logs_default_source", s)}
                      class={`flex-1 py-1.5 text-[9px] uppercase tracking-wider rounded border transition-colors ${
                        settings().logs_default_source === s
                          ? "bg-[var(--accent-10)] border-[var(--accent-40)] text-[var(--accent)]"
                          : "border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {LOG_SOURCE_LABEL[s]}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <Toggle
              label="Auto-start podglądu logów po zalogowaniu"
              checked={settings().logs_autostart}
              onChange={(v) => update("logs_autostart", v)}
            />
          </Section>

          <Section icon={Palette} title="Wygląd i powiadomienia">
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Motyw</label>
              <div class="flex gap-1">
                <For each={["dark", "light"] as Theme[]}>
                  {(t) => (
                    <button
                      onClick={() => toggleTheme(t)}
                      class={`flex-1 py-1.5 text-[9px] uppercase tracking-wider rounded border transition-colors ${
                        settings().theme === t
                          ? "bg-[var(--accent-10)] border-[var(--accent-40)] text-[var(--accent)]"
                          : "border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {t === "dark" ? "Ciemny" : "Jasny"}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Kolor akcentu</label>
              <div class="flex items-center gap-2 flex-wrap">
                <For each={ACCENTS}>
                  {(color) => (
                    <button
                      onClick={() => applyAndSetAccent(color)}
                      style={{ background: color }}
                      class={`w-6 h-6 rounded-full border-2 transition-transform ${
                        settings().accent_color.toLowerCase() === color ? "border-white scale-110" : "border-transparent"
                      }`}
                      title={color}
                    />
                  )}
                </For>
                <div class="w-px h-5 bg-[var(--border-default)] mx-1" />
                {/* Prawdziwy color picker (dowolny hex) — dotąd paleta była
                    zamkniętą listą 5 gotowych kolorów. `<input type="color">`
                    to natywny picker przeglądarki/systemu (koło barw, nie
                    tylko presety), a pole tekstowe obok pozwala wpisać hex
                    wprost (np. skopiowany z brandbooka firmy). */}
                <label
                  title="Dowolny kolor (natywny picker systemu)"
                  class="relative w-6 h-6 rounded-full border-2 border-[var(--border-strong)] overflow-hidden cursor-pointer shrink-0"
                  style={{ background: isValidHex(settings().accent_color) ? settings().accent_color : "transparent" }}
                >
                  <input
                    type="color"
                    value={isValidHex(settings().accent_color) ? (normalizeHex(settings().accent_color) ?? "#ff3333") : "#ff3333"}
                    onInput={(e) => applyAndSetAccent(e.currentTarget.value)}
                    class="absolute -top-1 -left-1 w-8 h-8 cursor-pointer opacity-0"
                  />
                </label>
                <input
                  type="text"
                  value={hexInput()}
                  onInput={(e) => setHexInputValue(e.currentTarget.value)}
                  onBlur={() => commitHexInput()}
                  onKeyDown={(e) => e.key === "Enter" && commitHexInput()}
                  placeholder="#rrggbb"
                  maxLength={7}
                  class={`w-24 bg-[var(--bg-inset)] border rounded px-2 py-1 text-[10px] font-mono outline-none transition-colors ${
                    hexError() ? "border-[#ff3333]/60 text-[#ff5555]" : "border-[var(--border-default)] text-[var(--text-primary)] focus:border-[var(--accent-40)]"
                  }`}
                />
              </div>
              <Show when={hexError()}>
                <p class="text-[9px] text-[#ff5555]">Nieprawidłowy hex — oczekiwany format #rrggbb.</p>
              </Show>
              <p class="text-[9px] text-[var(--text-faint)] mt-1">
                Zmiana koloru i motywu działa od razu w całym UI (podgląd na żywo) — kliknij "Zapisz ustawienia"
                poniżej, żeby przetrwała restart aplikacji.
              </p>
            </div>
            <div class="flex items-center justify-between">
              <Toggle label="Dźwięk przy zdarzeniach wysokiego ryzyka" checked={settings().sound_enabled} onChange={(v) => update("sound_enabled", v)} />
            </div>
            <button
              onClick={playNotifySound}
              class="self-start flex items-center gap-1.5 px-2.5 py-1 text-[9px] uppercase tracking-widest rounded border border-[var(--border-strong)] text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:border-[var(--accent-30)] transition-colors"
            >
              <Volume2 size={11} />
              Testuj dźwięk
            </button>
            <Toggle
              label="Migający banner trybu .no-login"
              checked={settings().no_login_banner_blink}
              onChange={(v) => update("no_login_banner_blink", v)}
            />
          </Section>

          <Section icon={Timer} title="Sesja">
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                Auto-wylogowanie po bezczynności ({settings().idle_timeout_minutes === 0 ? "wyłączone" : `${settings().idle_timeout_minutes} min`})
              </label>
              <input
                type="range"
                min="0"
                max="120"
                step="5"
                value={settings().idle_timeout_minutes}
                onInput={(e) => update("idle_timeout_minutes", Number(e.currentTarget.value))}
                class="accent-[var(--accent)]"
              />
              <p class="text-[9px] text-[var(--text-faint)]">
                0 = wyłączone. Ignorowane w trybie `.no-login` (zaufana sesja lokalna bez logowania hasłem).
              </p>
            </div>
            <Toggle
              label="Przywracaj scrollback terminala po restarcie appki"
              checked={settings().terminal_restore_scrollback}
              onChange={(v) => update("terminal_restore_scrollback", v)}
            />
            <div class="flex flex-col gap-1 border-t border-[var(--border-default)] pt-2">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                Limit prób logowania przed blokadą (
                {settings().max_login_attempts === 0 ? "rate limiting wyłączony" : settings().max_login_attempts})
              </label>
              <input
                type="range"
                min="0"
                max="10"
                value={settings().max_login_attempts}
                onInput={(e) => update("max_login_attempts", Number(e.currentTarget.value))}
                class="accent-[var(--accent)]"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                Długość blokady ({settings().lockout_minutes} min)
              </label>
              <input
                type="range"
                min="1"
                max="60"
                value={settings().lockout_minutes}
                onInput={(e) => update("lockout_minutes", Number(e.currentTarget.value))}
                class="accent-[var(--accent)]"
              />
              <p class="text-[9px] text-[var(--text-faint)]">Blokada jest zapisywana na dysku — restart appki jej nie zeruje.</p>
            </div>
          </Section>

          <Section icon={Video} title="Nagrywanie i podpisy pakietów">
            <Toggle
              label="Nagrywaj sesje terminala (asciinema .cast)"
              checked={settings().terminal_recording_enabled}
              onChange={(v) => update("terminal_recording_enabled", v)}
            />
            <p class="text-[9px] text-[var(--text-faint)]">
              Domyślnie wyłączone — to decyzja prywatności operatora, nie coś appka powinna robić po cichu. Nagrania
              (Lead) dostępne do pobrania z widoku Team.
            </p>
            <Toggle
              label="Blokuj instalację niepodpisanych pakietów"
              checked={settings().block_unsigned_packages}
              onChange={(v) => update("block_unsigned_packages", v)}
            />
            <p class="text-[9px] text-[var(--text-faint)]">
              Każda instalacja zapisuje do audytu, jak pacman zweryfikował pakiet ("Validated By"). Włączenie tej
              opcji cofa instalację, gdy weryfikacja to nie "Signature".
            </p>
          </Section>

          <Section icon={FileCheck2} title="Integralność audit logu">
            <p class="text-[9px] text-[var(--text-faint)]">
              Każdy wpis w audit.jsonl jest podpisany łańcuchem HMAC-SHA256 (patrz backend/src/audit.rs) — edycja lub
              usunięcie wpisu po fakcie łamie łańcuch i jest wykrywalne poniższym sprawdzeniem.
            </p>
            <button
              onClick={runIntegrityCheck}
              disabled={checkingIntegrity()}
              class="self-start flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest rounded bg-[var(--border-default)] text-white hover:bg-[var(--accent)] transition-colors disabled:opacity-40"
            >
              <FileCheck2 size={11} />
              {checkingIntegrity() ? "Sprawdzam..." : "Sprawdź integralność"}
            </button>
            <Show when={integrity()}>
              {(report) => (
                <div
                  class={`text-[9px] font-mono rounded p-2 border ${
                    report().ok ? "border-green-600/40 text-green-400 bg-green-950/20" : "border-[#ff3333]/50 text-[#ff5555] bg-[#1a0000]"
                  }`}
                >
                  <Show when={report().ok} fallback={<div>⚠ NARUSZENIE ŁAŃCUCHA przy seq={report().tampered_at_seq}</div>}>
                    <div>✓ Łańcuch nienaruszony</div>
                  </Show>
                  <div class="opacity-70 mt-1">
                    {report().verified_entries} zweryfikowanych / {report().total_entries} łącznie
                    {report().unchained_entries > 0 && ` (${report().unchained_entries} sprzed wprowadzenia łańcucha)`}
                  </div>
                </div>
              )}
            </Show>
          </Section>

          <Section icon={Radio} title="Threat feed">
            <p class="text-[9px] text-[var(--text-faint)]">
              Puste = brak źródła (panel Analytics pokazuje pusty stan). Ustaw URL wewnętrznego API (SIEM/CVE) —
              odpytywany przez HTTP GET, oczekiwana odpowiedź to JSON: tablica obiektów
              {" "}<code class="text-[var(--text-tertiary)]">{"{id, severity, title, description}"}</code>.
            </p>
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">URL źródła</label>
              <input
                type="text"
                value={threatUrl()}
                onInput={(e) => setThreatUrl(e.currentTarget.value)}
                placeholder="https://siem.wewnetrzny.firma/api/threats"
                disabled={!canEditAllowlist()}
                class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1.5 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                Token API (nagłówek <code>Authorization: Bearer …</code>, opcjonalnie)
              </label>
              <input
                type="password"
                value={threatToken()}
                onInput={(e) => setThreatToken(e.currentTarget.value)}
                placeholder="••••••••"
                disabled={!canEditAllowlist()}
                autocomplete="off"
                class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1.5 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
              />
            </div>
            <Show when={!canEditAllowlist()}>
              <p class="text-[9px] text-yellow-600">Wymaga roli Lead.</p>
            </Show>
            <button
              onClick={() => setThreatAdapterOpen((v) => !v)}
              class="self-start text-[9px] uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent)] underline decoration-dotted"
            >
              {threatAdapterOpen() ? "Ukryj" : "Pokaż"} adapter kształtu odpowiedzi (zaawansowane)
            </button>
            <Show when={threatAdapterOpen()}>
              <div class="flex flex-col gap-2 border-t border-[var(--border-default)] pt-2">
                <p class="text-[9px] text-[var(--text-faint)]">
                  Gdy API firmy zwraca inny kształt niż nasz natywny (opakowanie w kopertę, inne nazwy pól, inne
                  słownictwo severity) — bez wypełniania niczego tutaj appka zakłada odpowiedź wprost w naszym kształcie.
                </p>
                <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                  Ścieżka do tablicy (np. <code>data.items</code>)
                </label>
                <input
                  type="text"
                  value={itemsPath()}
                  onInput={(e) => setItemsPath(e.currentTarget.value)}
                  placeholder="puste = odpowiedź to wprost tablica"
                  disabled={!canEditAllowlist()}
                  class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1.5 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
                />
                <div class="grid grid-cols-2 gap-2">
                  <div class="flex flex-col gap-1">
                    <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Pole: id</label>
                    <input
                      type="text"
                      value={fieldId()}
                      onInput={(e) => setFieldId(e.currentTarget.value)}
                      placeholder="id"
                      disabled={!canEditAllowlist()}
                      class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Pole: severity</label>
                    <input
                      type="text"
                      value={fieldSeverity()}
                      onInput={(e) => setFieldSeverity(e.currentTarget.value)}
                      placeholder="severity"
                      disabled={!canEditAllowlist()}
                      class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Pole: title</label>
                    <input
                      type="text"
                      value={fieldTitle()}
                      onInput={(e) => setFieldTitle(e.currentTarget.value)}
                      placeholder="title"
                      disabled={!canEditAllowlist()}
                      class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Pole: description</label>
                    <input
                      type="text"
                      value={fieldDescription()}
                      onInput={(e) => setFieldDescription(e.currentTarget.value)}
                      placeholder="description"
                      disabled={!canEditAllowlist()}
                      class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
                    />
                  </div>
                </div>
                <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                  Mapa severity (JSON, np. <code>{'{"p1": "high"}'}</code>)
                </label>
                <textarea
                  value={severityMapText()}
                  onInput={(e) => {
                    setSeverityMapText(e.currentTarget.value);
                    setSeverityMapError(false);
                  }}
                  placeholder='{"p1": "high", "p2": "medium", "p3": "low"}'
                  disabled={!canEditAllowlist()}
                  rows={3}
                  class={`bg-[var(--bg-inset)] border rounded px-2 py-1.5 text-[10px] font-mono text-[var(--text-primary)] outline-none disabled:opacity-40 ${
                    severityMapError() ? "border-[#ff3333]/60" : "border-[var(--border-default)] focus:border-[var(--accent-50)]"
                  }`}
                />
                <Show when={severityMapError()}>
                  <p class="text-[9px] text-[#ff5555]">Nieprawidłowy JSON.</p>
                </Show>
              </div>
            </Show>
            <button
              onClick={saveThreatFeed}
              disabled={threatSaving() || !canEditAllowlist()}
              class="self-start px-3 py-1.5 text-[9px] uppercase tracking-widest rounded bg-[var(--border-default)] text-white hover:bg-[var(--accent)] transition-colors disabled:opacity-40"
            >
              {threatSaving() ? "Zapisuję..." : threatSaved() ? "Zapisano ✓" : "Zapisz źródło"}
            </button>
          </Section>

          <Section icon={ShieldCheck} title="Allowlist pakietów (Store)">
            <p class="text-[9px] text-[var(--text-faint)]">
              Gdy wyłączone "zezwól na wszystko", tylko pakiety z listy poniżej można zainstalować przez Arsenal.
            </p>
            <Toggle
              label="Zezwól na wszystkie pakiety BlackArch"
              checked={allowlist().allow_all}
              onChange={(v) => canEditAllowlist() && setAllowlistState((prev) => ({ ...prev, allow_all: v }))}
            />
            <Show when={!allowlist().allow_all}>
              <div class="flex gap-1">
                <input
                  type="text"
                  value={newPkg()}
                  onInput={(e) => setNewPkg(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPackage()}
                  placeholder="np. nmap"
                  disabled={!canEditAllowlist()}
                  class="flex-1 bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
                />
                <button
                  onClick={addPackage}
                  disabled={!canEditAllowlist()}
                  class="px-2 text-[9px] uppercase rounded bg-[var(--border-default)] text-white hover:bg-[var(--accent)] transition-colors disabled:opacity-40"
                >
                  Dodaj
                </button>
              </div>
              <div class="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                <For each={allowlist().packages}>
                  {(pkg) => (
                    <span class="text-[9px] font-mono bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1 flex items-center gap-1.5">
                      {pkg}
                      <Show when={canEditAllowlist()}>
                        <button onClick={() => removePackage(pkg)} class="text-[var(--text-muted)] hover:text-[var(--accent)]">
                          ×
                        </button>
                      </Show>
                    </span>
                  )}
                </For>
                <Show when={allowlist().packages.length === 0}>
                  <span class="text-[9px] text-[var(--text-faint)] italic">Brak pakietów na liście.</span>
                </Show>
              </div>
            </Show>
            <Show when={!canEditAllowlist()}>
              <p class="text-[9px] text-yellow-600">Wymaga roli Lead — Twoja rola: {props.session.role}.</p>
            </Show>
            <button
              onClick={saveAllowlist}
              disabled={allowlistSaving() || !canEditAllowlist()}
              class="self-start px-3 py-1.5 text-[9px] uppercase tracking-widest rounded bg-[var(--border-default)] text-white hover:bg-[var(--accent)] transition-colors disabled:opacity-40"
            >
              {allowlistSaving() ? "Zapisuję..." : "Zapisz allowlistę"}
            </button>
          </Section>

          <Section icon={Send} title="Eksport audytu (syslog / SIEM)">
            <p class="text-[9px] text-[var(--text-faint)]">
              Każdy nowy wpis audytu jest (best-effort, w tle) wysyłany dalej — jedyny sposób na realną odporność na
              manipulację poza tym, co daje sam łańcuch HMAC (patrz sekcja wyżej: ten działa tylko lokalnie).
            </p>
            <div class="grid grid-cols-2 gap-2">
              <div class="flex flex-col gap-1">
                <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Syslog: host</label>
                <input
                  type="text"
                  value={remoteAudit().syslog_host ?? ""}
                  onInput={(e) => updateRemoteAudit("syslog_host", e.currentTarget.value || null)}
                  placeholder="syslog.wewnetrzny.firma"
                  disabled={!canEditAllowlist()}
                  class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1.5 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Syslog: port</label>
                <input
                  type="number"
                  value={remoteAudit().syslog_port ?? ""}
                  onInput={(e) => updateRemoteAudit("syslog_port", e.currentTarget.value ? Number(e.currentTarget.value) : null)}
                  placeholder="514"
                  disabled={!canEditAllowlist()}
                  class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1.5 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
                />
              </div>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Webhook URL (HTTP POST JSON)</label>
              <input
                type="text"
                value={remoteAudit().webhook_url ?? ""}
                onInput={(e) => updateRemoteAudit("webhook_url", e.currentTarget.value || null)}
                placeholder="https://siem.wewnetrzny.firma/api/ingest"
                disabled={!canEditAllowlist()}
                class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1.5 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Webhook token (opcjonalnie)</label>
              <input
                type="password"
                value={remoteAudit().webhook_token ?? ""}
                onInput={(e) => updateRemoteAudit("webhook_token", e.currentTarget.value || null)}
                placeholder="••••••••"
                disabled={!canEditAllowlist()}
                autocomplete="off"
                class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1.5 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)] disabled:opacity-40"
              />
            </div>
            <Show when={!canEditAllowlist()}>
              <p class="text-[9px] text-yellow-600">Wymaga roli Lead.</p>
            </Show>
            <button
              onClick={saveRemoteAudit}
              disabled={remoteAuditSaving() || !canEditAllowlist()}
              class="self-start px-3 py-1.5 text-[9px] uppercase tracking-widest rounded bg-[var(--border-default)] text-white hover:bg-[var(--accent)] transition-colors disabled:opacity-40"
            >
              <Lock size={11} class="inline mr-1 -mt-0.5" />
              {remoteAuditSaving() ? "Zapisuję..." : remoteAuditSaved() ? "Zapisano ✓" : "Zapisz eksport"}
            </button>
          </Section>

          <Section icon={Sparkles} title="Snippety terminala">
            <p class="text-[9px] text-[var(--text-faint)]">
              Wstawiają tekst do aktywnego terminala BEZ automatycznego Entera — zawsze widzisz, co się wpisało, zanim
              odpalisz komendę.
            </p>
            <div class="flex flex-col gap-1.5 max-h-32 overflow-y-auto">
              <For each={snippetList()}>
                {(snippet) => (
                  <div class="flex items-center gap-2 bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1.5">
                    <div class="flex-1 min-w-0">
                      <div class="text-[9px] font-bold text-[var(--text-primary)] truncate">{snippet.label}</div>
                      <div class="text-[9px] font-mono text-[var(--text-faint)] truncate">{snippet.command}</div>
                    </div>
                    <button onClick={() => removeSnippet(snippet.id)} class="text-[var(--text-faint)] hover:text-[#ff5555] shrink-0">
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </For>
              <Show when={snippetList().length === 0}>
                <span class="text-[9px] text-[var(--text-faint)] italic">Brak snippetów.</span>
              </Show>
            </div>
            <div class="grid grid-cols-2 gap-1.5">
              <input
                type="text"
                value={newSnippetLabel()}
                onInput={(e) => setNewSnippetLabel(e.currentTarget.value)}
                placeholder="Nazwa"
                class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)]"
              />
              <input
                type="text"
                value={newSnippetCommand()}
                onInput={(e) => setNewSnippetCommand(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && addSnippet()}
                placeholder="Komenda"
                class="bg-[var(--bg-inset)] border border-[var(--border-default)] rounded px-2 py-1 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent-50)]"
              />
            </div>
            <div class="flex gap-2">
              <button
                onClick={addSnippet}
                class="flex items-center gap-1.5 px-2.5 py-1 text-[9px] uppercase tracking-widest rounded border border-[var(--border-strong)] text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:border-[var(--accent-30)] transition-colors"
              >
                <Plus size={11} />
                Dodaj
              </button>
              <button
                onClick={saveSnippetsList}
                disabled={snippetsSaving()}
                class="px-3 py-1 text-[9px] uppercase tracking-widest rounded bg-[var(--border-default)] text-white hover:bg-[var(--accent)] transition-colors disabled:opacity-40"
              >
                {snippetsSaving() ? "Zapisuję..." : "Zapisz snippety"}
              </button>
            </div>
          </Section>

          <Section icon={Info} title="O aplikacji i sesji">
            <div class="text-[10px] text-[var(--text-secondary)] flex flex-col gap-1 font-mono">
              <div>Operator: <span class="text-[var(--text-primary)]">{props.session.username}</span></div>
              <div>Rola: <span class="text-[var(--text-primary)]">{props.session.role}</span></div>
              <div>Wersja: <span class="text-[var(--text-primary)]">Penetration Mode // Red Team v2.5</span></div>
              <div>Silnik: <span class="text-[var(--text-primary)]">Tauri v2 + Solid.js</span></div>
            </div>
          </Section>
        </div>

        <div class="sticky bottom-0 bg-[var(--bg-app-95)] backdrop-blur pt-3 pb-1 flex items-center gap-2 border-t border-[var(--border-default)] mt-1">
          <button
            onClick={save}
            disabled={saving()}
            class="flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded bg-[var(--accent)] text-black hover:bg-[#ff5555] transition-colors disabled:opacity-50"
          >
            <Save size={12} />
            {saving() ? "Zapisuję..." : saved() ? "Zapisano ✓" : "Zapisz ustawienia"}
          </button>
          <button
            onClick={resetDefaults}
            class="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-widest rounded border border-[var(--border-strong)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <RotateCcw size={12} />
            Przywróć domyślne
          </button>
        </div>
      </Show>
    </div>
  );
}
