# ![Penetration Mode - For HackerOS Cybersecurity.](https://github.com/HackerOS-Linux-System/HackerOS-Updates/blob/main/HackerOS/ICONS/Penetration-Mode.png)
# Penetration Mode

Przebudowa oryginalnej makiety (React + Vite, "AI Studio" export) na natywną
aplikację desktopową: **Tauri v2** (backend Rust) + **Solid.js** (frontend).

## Struktura repo

```
cybersec-mode/
├── Makefile                     # make dev / build / lint / icons / clean
├── scripts/                     # setup.sh, dev.sh, build-release.sh
├── ipc/                         # placeholder na wspólny kontrakt frontend<->backend (patrz ipc/README.md)
└── source-code/
    ├── frontend/                # Solid.js + Vite + Tailwind
    │   ├── src/
    │   │   ├── components/      # Terminal (xterm.js), LogsTerminal (druga
    │   │   │                    # konsola — logi na żywo), ToolShop, Store,
    │   │   │                    # Analytics, Activity (pełny audit log +
    │   │   │                    # threat feed), Reports (PDF/CSV), Settings
    │   │   │                    # (terminal/logi/wygląd/allowlist/threat feed),
    │   │   │                    # NetworkMonitor, DraggableScanner, PowerButton
    │   │   ├── lib/tauri.ts     # jedyne miejsce wołające @tauri-apps/api
    │   │   ├── lib/auditCsv.ts  # czysta funkcja eksportu CSV (+ testy)
    │   │   ├── App.tsx          # 5 widoków: workspace/arsenal/activity/reports/settings
    │   │   └── main.tsx
    │   └── package.json
    └── backend/                 # src-tauri (Rust)
        ├── src/{main,lib}.rs
        ├── src/logs.rs          # druga konsola: podman logs -f / audit tail / journalctl
        ├── src/settings.rs      # preferencje UI zapisywane w settings.json
        ├── capabilities/default.json
        ├── icons/
        ├── Cargo.toml
        └── tauri.conf.json
```

## Szybki start

```bash
./scripts/setup.sh      # albo: make install
make dev                # tryb deweloperski (hot reload)
make build               # bundle produkcyjny (.deb/.AppImage/.msi/.dmg zależnie od OS)
```

Wymagania: Node.js 18+, Rust (rustup) i zależności systemowe Tauri dla Twojej
platformy — https://tauri.app/start/prerequisites/.

## Co zostało zrobione w tej przebudowie

- Migracja komponentów z React (hooks, JSX) na Solid.js (signals, `<For>`,
  `createEffect`/`onMount`/`onCleanup`), bez zmiany warstwy wizualnej.
- `framer-motion` zastąpiony natywnymi transitions CSS + Pointer Events API
  (drag okna skanera) — jedna zależność mniej, brak odpowiednika 1:1 w
  ekosystemie Solid, więc lepiej nie ciągnąć dodatkowego pakietu tylko dla
  jednego elementu.
- `lucide-react` → `lucide-solid`.
- Cały frontend spakowany jako natywna appka desktopowa przez Tauri (Rust
  webview), zamiast SPA serwowanego przez Express/Vite preview.
- Dodany przycisk zasilania (lewy dolny róg, zawsze na wierzchu, wymaga
  dwukliku w oknie 4s) — wywołuje `exit(0)` z `@tauri-apps/plugin-process`.
- Wydzielona warstwa `src/lib/tauri.ts` jako jedyny punkt styku z Tauri API,
  żeby komponenty UI nie znały nazw komend/pluginów bezpośrednio.
- Struktura repo rozdzielona na `source-code/frontend` i `source-code/backend`
  + `Makefile`, `scripts/`, `ipc/` (placeholder) zgodnie z ustaloną konwencją.

## BlackArch Store (nowość) — jak to działa

`Arsenal` w górnej nawigacji (albo ikona warstw w lewym pasku) otwiera pełny
"software center" w stylu Discover/GNOME Software, ale nad prawdziwym
pacmanem BlackArch działającym w kontenerze **podman**:

- Backend (`source-code/backend/src/blackarch.rs`) zakłada, że **podman jest
  już zainstalowany w systemie hosta** — sam go nie instaluje, tylko
  sprawdza (`podman --version`) i jasno komunikuje brak w UI.
- Przy pierwszym otwarciu Store, jeśli kontener `blackarch-redteam` nie
  istnieje, pokazuje ekran onboardingu z przyciskiem "Utwórz kontener
  BlackArch" → `podman run -d --name blackarch-redteam ... blackarch/blackarch
  tail -f /dev/null`, potem `pacman -Sy` w środku kontenera.
- Kategorie w lewej kolumnie Store to realne grupy pakietów BlackArch
  (`blackarch-recon`, `blackarch-scanner`, `blackarch-exploitation`, itd.),
  pobierane przez `pacman -Sg <grupa>` + `pacman -Si` dla opisów/wersji.
- Wyszukiwarka woła `pacman -Ss <fraza>` wewnątrz kontenera.
- Install/Usuń wołają odpowiednio `pacman -S --noconfirm <pkg>` i
  `pacman -R --noconfirm <pkg>` w kontenerze — **backend Rust jest jedynym
  miejscem, które faktycznie odpala procesy**; frontend tylko woła komendy
  Tauri (`src/lib/tauri.ts`) i renderuje wynik.
- W przeglądarce (poza Tauri, `npm run dev` bez `tauri dev`) `lib/tauri.ts`
  przełącza się na dane mockowe, żeby dało się developować UI bez podmana.

## Runda 6 — realny terminal (xterm.js), druga konsola z logami, Activity/Reports/Settings

Ten przegląd wyszedł od jednego konkretnego problemu: **`Terminal.tsx` nie
był prawdziwym terminalem**. Owszem, backend (`pty.rs`) od dawna miał
realne PTY podpięte pod `podman exec`, ale frontend traktował go jak zwykłe
pole tekstowe — wysyłał całą linię dopiero po Enterze i renderował output
jako zwykły tekst. W praktyce to oznaczało:

- brak strzałek/historii/Tab-completion/Ctrl+C (bash w PTY oczekuje
  pojedynczych bajtów klawiatury, nie gotowych linii),
- kolory, `clear`, paski postępu, `less`/`vim`/`top` pokazywały się jako
  surowe kody ANSI zamiast być interpretowane,
- brak `pty_resize` przy zmianie rozmiaru okna — sesja nie wiedziała, że
  terminal się przeskalował,
- output rósł bez końca jako jeden string w sygnale Solida (brak limitu
  scrollbacku → zużycie pamięci rośnie z czasem sesji).

### Co zostało zrobione

- **`Terminal.tsx` przepisany na [xterm.js](https://xtermjs.org/)**
  (`@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links`):
  `onData` wysyła surowe bajty klawiatury 1:1 do PTY (`ptyWrite`), `write()`
  interpretuje ANSI, `ResizeObserver` + `FitAddon` wołają `ptyResize` przy
  zmianie rozmiaru, scrollback ma sensowny limit (z Ustawień), doszedł
  przycisk restartu sesji i czyszczenia ekranu.
- **Druga konsola — `LogsTerminal.tsx`** — kolejny panel w stylu terminala
  (też xterm.js, ale `disableStdin` — tylko odczyt), pokazujący na żywo
  logi z trzech źródeł do wyboru: kontener Store (`podman logs -f`, nowy
  backend `logs.rs`), audit log operatora (tail pliku `audit.jsonl`) albo
  host (`journalctl -f`). Ma play/pause, autoscroll, eksport do pliku i
  licznik linii. Umieszczona w widoku Workspace, między terminalem a
  monitorem sieci — więc logi są zawsze "gdzieś widoczne", bez przełączania
  widoku.
- **Backend: `logs.rs`** — nowy moduł, wzorowany na streamingu z
  `blackarch.rs`: `logs_tail_start(source)` / `logs_tail_stop`, emitujące
  `logs://output` per linia. Dla źródła `audit` używa prostego pollingu
  offsetu w pliku (bez zależności od file-watchera — plik jest mały i
  dopisywany rzadko).
- **Lewy pasek ikon rozbudowany z 4 do 5 pozycji, wszystkie działające** —
  wcześniej tylko "Workspace" i "Arsenal" cokolwiek robiły; "Activity" i
  "Settings" były martwymi ikonami bez `onClick`. Teraz:
  - **Activity** — pełnoekranowy widok: karty liczników zagrożeń wg
    poziomu, cała lista threat feed, i tabela audit logu (200 wpisów) z
    wyszukiwaniem/filtrem po zdarzeniu/operatorze — rozbudowana wersja
    tego, co wcześniej mieściło się w małym panelu `Analytics.tsx`
    (ten panel został w prawym sidebarze bez zmian, jako skrót).
  - **Reports** *(nowa pozycja)* — zakres dat, karty podsumowania
    (zdarzenia/operatorzy/logowania/sesje terminala/instalacje), wykres
    słupkowy najczęstszych zdarzeń, eksport do PDF (rozbudowany
    wielostronicowy raport, nie tylko lista) i eksport do CSV
    (`lib/auditCsv.ts`, czysta funkcja z testami).
  - **Settings** *(nowa pozycja)* — pięć sekcji: Terminal i logi (rozmiar
    czcionki, scrollback, domyślne źródło drugiej konsoli, autostart),
    Wygląd i powiadomienia (kolor akcentu, dźwięk, miganie bannera
    `.no-login`), Threat feed (edycja `source_url` — backendowa komenda
    już istniała w `threat_feed.rs`, ale nie była dotąd podłączona nigdzie
    we frontendzie), Allowlist pakietów Store (odczyt/zapis, wymuszane
    przez backend jako rola `Lead`) i informacje o sesji/appce. Zapisywane
    przez nowy backend `settings.rs` → `settings.json`.
  - Górna nawigacja (`Analytics`/`Reports`) była samym tekstem bez
    `onClick` — też podłączona do tych samych widoków.
- **Naprawiony `npm run test`** — brakowało `jsdom` jako `devDependency`
  (vitest się na tym wywalał przy starcie, zanim zdążył cokolwiek
  uruchomić); teraz `make test`/`npm run test` faktycznie przechodzi.
- Wszystko powyższe zweryfikowane realnie w tym repo: `npx tsc -p .`
  (0 błędów), `npm run build` (przechodzi), `npm run test` (14/14 zielone).
  Backendu (Rust/Cargo) nie dało się skompilować w tym środowisku (brak
  toolchaina) — `logs.rs`/`settings.rs` i zmiany w `lib.rs`/`audit.rs`
  zostały zweryfikowane tylko przez uważny przegląd, nie przez `cargo
  check`. **To pierwsza rzecz do zrobienia lokalnie po pobraniu tego
  archiwum: `cd source-code/backend && cargo check`.**

## Runda 7 — rebranding na Penetration Mode, kolor akcentu jako CSS var, czytelniejszy błąd journalctl

- **Zmiana nazwy produktu: Cybersecurity Mode → Penetration Mode.** Pełny
  przegląd i podmiana we wszystkich warstwach, nie tylko w UI: frontend
  (nagłówek, tytuł okna, `<title>`, eksporty PDF/CSV, `package.json`'s
  `name`), Tauri (`productName`, `mainBinaryName`, `identifier`
  `com.redteam.penetrationmode`), cały workspace Rust (`Cargo.toml`
  root, `source-code/backend` — nazwa paczki/libki/binarki, `session/`
  — CLI (`penetration-mode` / `penetration-mode app`), stała
  `SHELL_BIN`/`SHELL_APP_ID`/`SESSION_EXTERN_NAME`, wendorowany crate
  `session/vendor/cybersecurity-mode-ipc/` → `session/vendor/penetration-mode-ipc/`
  wraz z jego `Cargo.toml`/`EXTERN_NAME`/`CybersecurityModeIpcError` →
  `PenetrationModeIpcError`), `ipc/` (nazwa paczki
  `penetration-mode-ipc-types`), pliki `.desktop`
  (`desktop/cybersecurity-mode(-session).desktop` →
  `desktop/penetration-mode(-session).desktop`), oraz `README.md`/
  komentarze w kodzie. `SHELL_BIN`/`mainBinaryName`/`SHELL_APP_ID`/
  `identifier` musiały zostać zmienione **razem** (w `tauri.conf.json`,
  `source-code/backend/Cargo.toml` i `session/src/main.rs`) — to trzy
  miejsca, które muszą się literalnie zgadzać, żeby `session/` wciąż
  poprawnie wykrywało własne okno powłoki przez `ListWindows`.
  Zweryfikowane, że nic z tego się wzajemnie nie gryzie: `npx tsc`,
  `npm run build`, `npm run test` — wszystkie przechodzą po zmianie.
  **Rust nie skompilowany w tym środowisku** (jak w Rundzie 6) — literalna
  zamiana tekstu jest niskiego ryzyka, ale `cargo check` na całym
  workspace to wciąż pierwsza rzecz do zrobienia lokalnie.
- **Kolor akcentu z Ustawień faktycznie działa teraz w całym UI.** Nowy
  `lib/accent.ts`: `applyAccentColor(hex)` liczy `--accent` i warianty
  przezroczystości (`--accent-10` … `--accent-60`, jako gotowe stringi
  `rgba(...)` — Tailwindowy modyfikator `/NN` nie działa z dowolną
  wartością CSS typu `var(...)`, tylko z literałami koloru, więc każdy
  potrzebny odcień jest osobną zmienną, nie liczony w locie w klasie).
  `index.css` ma domyślne wartości na `:root` (czerwień red-team) jako
  fallback zanim JS zdąży odczytać ustawienia. Wszystkie sztywne
  `#ff3333`/`rgba(255,51,51,...)` w komponentach (`App.tsx`, `Terminal`,
  `LogsTerminal` (poza własnym retro-motywem, patrz niżej), `Activity`,
  `Reports`, `Settings`, `Store`, `ToolShop`, `PowerButton`,
  `NetworkMonitor`, `DraggableScanner`, `Login`, `Analytics`) podmienione
  na `var(--accent...)`. `Settings.tsx` woła `applyAccentColor` od razu
  po kliknięciu swatcha (podgląd na żywo, przed zapisem), a `App.tsx` —
  raz przy starcie aplikacji, z zapisanych ustawień. **Świadomie
  pominięte:** `Terminal.tsx`'s własny zielono-czarny "hackerski" motyw
  xterm.js (`foreground`/`cursor: "#00ff41"`) został przy stałych
  kolorach — to osobna stylistyka terminala, nie element brandingu, a
  poza tym xterm.js renderuje przez `<canvas>`, którego `fillStyle` i tak
  nie rozumie zmiennych CSS (`var(--accent)`), więc te konkretne kolory
  muszą pozostać literałami niezależnie od decyzji stylistycznej. Nowy
  test `lib/__tests__/accent.test.ts` (hex→rgb, warianty alfa, hex bez
  `#`, nieprawidłowy hex nie wywala wyjątku).
- **`journalctl` jako źródło "System" ma teraz czytelny błąd zamiast
  surowego `std::io::Error`.** `logs.rs`: `describe_spawn_error()`
  rozróżnia `ErrorKind::NotFound` ("`journalctl` nie jest zainstalowane…")
  i `PermissionDenied` od pozostałych błędów, z konkretną podpowiedzią co
  zrobić (dodanie do grupy `systemd-journal`, albo przełączenie na
  Container/Audit). Ponieważ `journalctl -f` potrafi wystartować
  *poprawnie* nawet bez uprawnień (proces się uruchamia, ale nie
  produkuje żadnych linii — cisza, którą łatwo pomylić z "brakiem nowych
  logów"), dodano `preflight_journalctl()`: krótkie, synchroniczne
  `journalctl -n 1 --no-pager -q` przed odpaleniem długożyjącego `-f`,
  które od razu zwraca błąd z treścią stderr, zamiast pozwalać operatorowi
  domyślać się, czemu druga konsola świeci się na "live" i nic nie pokazuje.

## Runda 8 — skróty klawiszowe, jasny/ciemny motyw, onboarding, rollback instalacji, integralność audit logu, idle timeout, taby terminala, persystencja scrollbacku, wyszukiwanie i kolorowanie logów

Trzynaście rzeczy naraz — w skrócie, co i gdzie:

**Skróty klawiszowe.** `Ctrl/Cmd+K` otwiera command palette
(`CommandPalette.tsx` + `lib/commandPalette.ts` — filtrowanie jako czysta,
testowana funkcja), `Ctrl/Cmd+1…5` przełącza widoki bezpośrednio. Oba są
świadomie wyłączone, gdy fokus jest w terminalu albo zwykłym polu tekstowym
(`isTypingContext()` w `App.tsx`) — inaczej `Ctrl+K` w bashu (skrót
readline) albo wpisywanie cyfry w formularzu zostałoby przechwycone przez
appkę zamiast dotrzeć tam, gdzie operator faktycznie celował.

**Jasny/ciemny motyw.** Pełny system tokenów CSS (`--bg-surface`,
`--text-primary`, `--border-default`, ...) w `index.css`, niezależny od
koloru akcentu z Rundy 7 — `lib/theme.ts` przełącza `data-theme` na
`<html>`. Wszystkie sztywne szarości (`#111`, `#222`, `#e0e0e0`, `#666`...)
w 12 komponentach podmienione skryptowo na `var(--...)`. Wyjątek celowy:
xterm.js (canvas) nie czyta zmiennych CSS, więc `Terminal.tsx`/
`LogsTerminal.tsx` same dobierają literalny zestaw kolorów przez
`currentTheme()` + `TERMINAL_THEMES`/`LOGS_TERMINAL_THEMES` z `lib/theme.ts`
— "hackerski" zielony motyw terminala jest zachowany w obu wariantach,
tylko z odwróconym kontrastem w jasnym.

**Onboarding.** `Onboarding.tsx` — 5-krokowy przewodnik pokazywany raz,
gdy `settings.onboarding_completed === false` (nowe pole w
`settings.rs`). "Pomiń"/ukończenie zapisuje flagę, więc się nie powtarza.

**Historia instalacji + rollback.** `InstallHistory.tsx` (otwierana z
Arsenal → ikona zegara) czyta `store.package_installed`/
`store.package_removed` z audit logu i buduje listę z przyciskiem
"Cofnij" — cofnięcie to zwykłe wywołanie odwrotnej akcji
(`installPackage`/`removePackage`), które samo w sobie loguje się jako
nowe zdarzenie, więc historia zostaje w pełni spójna (widać oryginalną
akcję i jej cofnięcie, nie ma cichego nadpisania).

**Wyszukiwanie pełnotekstowe pakietów** — okazało się już gotowe
(`search_packages` w `blackarch.rs` + debounced input w `Store.tsx`
z wcześniejszej rundy), nie wymagało dodatkowej pracy.

**Integralność audit logu.** `audit.rs` przepisane na łańcuch
HMAC-SHA256: każdy wpis ma `seq`/`prev_hash`/`hash`, klucz generowany raz
i zapisany obok logu z uprawnieniami `0600` (Unix). Nowa komenda
`verify_audit_log()` przelicza cały łańcuch i zwraca pierwszy `seq`, przy
którym coś się nie zgadza — UI w Ustawieniach → "Integralność audit
logu". **Uczciwie o granicy tego mechanizmu** (też w komentarzu w
kodzie): to wykrywa przypadkową korupcję i naiwną edycję pliku, ale NIE
jest odporne na kogoś z pełnym dostępem do tego samego konta systemowego
— taki ktoś może odczytać klucz i przeliczyć łańcuch od nowa. Prawdziwa
odporność wymagałaby zewnętrznego, tylko-do-zapisu miejsca (zdalny
syslog/SIEM) — poza zakresem lokalnej appki desktopowej.

**Powiadomienia (toast + dźwięk).** `lib/toast.ts` (store) +
`ToastStack.tsx` (UI, prawy dolny róg) + `lib/sound.ts` (Web Audio API,
bez pliku dźwiękowego — dwuton generowany oscylatorem). `Workspace` w
`App.tsx` odpytuje `getThreatFeed()` co 60s, `lib/threatWatcher.ts`
(czysta, testowana funkcja) wyłapuje nowe wpisy `severity: "high"` i
odpala toast + `sound_enabled` → dźwięk.

**Auto-wylogowanie po bezczynności.** `auth.rs`: `session_heartbeat()` +
`enforce_idle_timeout()` (zerowany licznik przy realnej aktywności,
throttlowany po stronie frontendu przez `lib/idle.ts` — nie wołamy
backendu na każdy `mousemove`). Ignorowane w trybie `.no-login`. Nowe
pole `idle_timeout_minutes` w Ustawieniach (0 = wyłączone).

**Wiele sesji terminala (taby).** `pty.rs` przepisane z pojedynczego
`Option<PtySession>` na `HashMap<session_id, PtySession>` — to było
źródłowe ograniczenie: wcześniej fizycznie nie dało się mieć dwóch
terminali naraz, bo drugi `pty_start` ubijał pierwszy. `TerminalTabs.tsx`
zarządza paskiem tabów; nieaktywne taby zostają zamontowane
(`display:none`), nie odmontowywane, więc przełączanie nie zrywa sesji.

**Persystencja scrollbacku.** `terminal_state.rs` (nowy moduł) zapisuje
`{id, label, scrollback}` per tab do `terminal_tabs.json`, z twardym
limitem 2MB/tab i 12 tabów. `Terminal.tsx` używa `@xterm/addon-serialize`
do zrzutu bufora (czysty strumień ANSI, wypisywany z powrotem przy
starcie jako historia nad świeżym promptem). Zapis co 30s +
best-effort przy `onCloseRequested` okna Tauri.

**Wyszukiwanie w terminalu/logach.** `@xterm/addon-search` w obu
konsolach — mała belka wyszukiwania (ikona lupy w headerze), Enter/Shift+Enter
nawiguje next/prev.

**Kolorowanie logów wg severity.** `lib/logSeverity.ts` (czysta,
testowana funkcja) wykrywa `CRITICAL`/`ERROR`/`WARNING`/`INFO` po słowach
kluczowych (case-insensitive, na granicach słów) i nadpisuje kolor
źródła dla tej konkretnej linii — wcześniej cała linia miała jeden kolor
zależny wyłącznie od źródła (kontener/audit/system), niezależnie od
treści.

Wszystko zweryfikowane w tym repo: `npx tsc -p .` (0 błędów), `npm run
build` (przechodzi), `npm run test` (39/39 zielone, w tym 5 nowych plików
testów: `idle`, `commandPalette`, `threatWatcher`, `logSeverity`, plus
rozszerzony `auditCsv`). **Backend (Rust) znów nie skompilowany w tym
środowisku** (brak toolchaina) — `pty.rs` (przepisane od zera na
multi-session), `audit.rs` (przepisane na łańcuch HMAC), `terminal_state.rs`
(nowy), `auth.rs`/`settings.rs` (rozszerzone) zweryfikowane wyłącznie
przez uważny, ręczny przegląd (w tym świadome sprawdzenie wzorców
partial-move/borrow-checkera w `pty.rs`), nie przez kompilator. To
zdecydowanie największa, najbardziej ryzykowna zmiana w backendzie ze
wszystkich dotychczasowych rund — **`cargo check` na całym workspace
jest tym razem szczególnie ważne jako pierwszy krok lokalnie.**

## Runda 9 — prawdziwy color picker, klient HTTP dla threat feedu, uprawnienia klucza HMAC na Windows

1. **Color picker.** Paleta 5 gotowych kolorów w Ustawieniach zostaje
   (szybki wybór), ale doszedł natywny `<input type="color">` (koło barw
   systemu/przeglądarki — nie tylko presety) oraz pole tekstowe na hex
   wpisywany wprost (np. skopiowany z brandbooka firmy), z walidacją
   na żywo. Nowe `isValidHex()`/`normalizeHex()` w `lib/accent.ts`
   (8 nowych testów) — normalizacja ujednolica `"ff3333"`/`"#FF3333"`/
   `"#ff3333"` do jednej postaci przed zapisem/porównaniem.

2. **Klient HTTP dla threat feedu.** `threat_feed.rs`: `get_threat_feed()`
   faktycznie odpytuje `source_url` (gdy ustawiony) przez
   `reqwest::blocking` z 8-sekundowym timeoutem i osobnymi komunikatami
   błędu dla timeoutu / błędu połączenia / złego statusu HTTP / kształtu
   odpowiedzi niepasującego do `Vec<ThreatEntry>`. Dodano też
   `api_token` w `ThreatFeedConfig` (nagłówek `Authorization: Bearer`) —
   bez tego pole `source_url` samo w sobie było użyteczne tylko dla w
   pełni otwartych endpointów, a prawie żadne wewnętrzne API takie nie
   jest. `reqwest` skonfigurowany z `rustls-tls` zamiast domyślnego
   `native-tls`, żeby budowanie appki nie wymagało nagłówków systemowego
   OpenSSL na maszynie budującej. Kontrakt odpowiedzi jest świadomie
   wąski i udokumentowany w kodzie: appka oczekuje wprost tablicy JSON
   `{id, severity, title, description}` — nie zgadujemy nieznanego
   kształtu API firmy na siłę; jeśli realne API zwraca coś innego (np.
   opakowane w `{"items": [...]}`), potrzebny będzie mały adapter w tym
   samym miejscu. To odblokowuje też powiadomienia o zagrożeniach
   wysokiego ryzyka z Rundy 8 — miały mechanizm, ale nie miały skąd
   realnie wziąć danych bez tego kroku.

3. **Uprawnienia `audit.key` na Windows.** `audit.rs`: nowa funkcja
   `restrict_key_permissions_windows()` (za `#[cfg(windows)]`) woła
   systemowe `icacls` (`/inheritance:r /grant:r <user>:F`), żeby
   ograniczyć dostęp do klucza HMAC do bieżącego użytkownika — dotąd
   robione tylko na Uniksie (`chmod 0600`), na Windows plik zostawał z
   domyślnymi, dziedziczonymi ACL. Best-effort przez zewnętrzne
   narzędzie zamiast ciągnięcia zależności `windows-rs` + wywołań Win32
   ACL API tylko dla jednego pliku — świadomy kompromis, opisany wprost
   w komentarzu w kodzie.

Zweryfikowane w tym repo: `npx tsc -p .` (0 błędów), `npm run build`
(przechodzi), `npm run test` (47/47 zielone, +8 nowych testów w
`accent.test.ts`). **Backend znów niekompilowany w tym środowisku** (brak
toolchaina) — `reqwest` to pierwsza zależność w tym projekcie ciągnąca
sieć (TLS, async runtime pod spodem mimo synchronicznego API blocking
clienta) i jedyny sposób na pewność, że się to poprawnie linkuje, to
`cargo check` lokalnie.

## Runda 10 — eksport audytu, rate limiting logowania, podpisy pakietów, odporność threat feedu, współdzielenie/nagrywanie terminala, snippety, widok Team, notatki audytu, testy komponentów, code-splitting

Dwanaście rzeczy naraz — backend najpierw, potem frontend:

**Bezpieczeństwo i audyt.**
- `remote_audit.rs` (nowy) — każdy wpis audytu jest teraz (best-effort, w
  tle, osobny wątek) replikowany dalej: syslog RFC 5424 po UDP i/lub
  webhook (HTTP POST JSON + opcjonalny Bearer token). To jedyny sposób
  na realną odporność na manipulację poza samym łańcuchem HMAC (który —
  jak Runda 8 uczciwie przyznała — nie chroni przed kimś z dostępem do
  tego samego konta systemowego). Konfiguracja w Ustawieniach → "Eksport
  audytu" (Lead).
- `lockout.rs` (nowy) — rate limiting logowania: `max_login_attempts` w
  oknie `lockout_minutes` (oba w Ustawieniach, 0 = wyłączone), **persystowane
  do pliku**, nie tylko w pamięci procesu — restart appki nie zeruje
  blokady. Dotąd appka polegała wyłącznie na tym, co (jeśli cokolwiek)
  egzekwuje sam PAM.
- `blackarch.rs::install_package` — po każdej instalacji odczytuje
  `pacman -Qi <pkg>`'s pole `Validated By` i zapisuje je do audytu.
  Appka nie reimplementuje kryptografii weryfikacji pakietów (pacman już
  to robi wg `SigLevel` kontenera) — czyni ten wynik WIDOCZNYM i
  AUDYTOWALNYM, czego dotąd appka w ogóle nie robiła. Opcjonalny
  `block_unsigned_packages` w Ustawieniach cofa instalację, gdy
  weryfikacja to nie `Signature` (pacman nie daje niedestrukcyjnego
  sposobu sprawdzenia tego z góry — `SigLevel` jest egzekwowany DOPIERO
  w trakcie instalacji, więc "zainstaluj, sprawdź, ewentualnie cofnij"
  to jedyna praktyczna ścieżka).
- `audit.rs::add_audit_note` — notatki przypięte do wpisów audytu (np.
  "autoryzowany test, JIRA-123"). Celowo NIE modyfikują oryginalnego
  wpisu (to złamałoby łańcuch HMAC) — notatka to po prostu NOWE zdarzenie
  `audit.note_added` odwołujące się do `target_seq`. Zero nowego
  magazynu danych, zero ryzyka naruszenia integralności przez
  konstrukcję. `Activity.tsx` grupuje je i renderuje pod właściwym
  wierszem, z małym formularzem dodawania inline.

**Threat feed.**
- `threat_feed.rs` przepisany: retry z rosnącym opóźnieniem (0s/1s/2s)
  przy przejściowych błędach sieci, cache ostatniego udanego pobrania
  jako fallback gdy świeże pobranie akurat zawiedzie (panel
  Analytics/Activity nie czyści się do zera przy chwilowym blipie
  sieci), i pętla w tle (`spawn_background_refresh`, uruchamiana raz w
  `lib.rs`'s `.setup()`) odświeżająca co 60s niezależnie od tego,
  kiedy/czy frontend akurat odpytuje.
- Konfigurowalny adapter kształtu odpowiedzi: `items_path` (ścieżka
  kropkowa do tablicy w odpowiedzi), nadpisywalne nazwy pól
  (`field_id`/`field_severity`/`field_title`/`field_description`) i
  `severity_map` (mapowanie dowolnego słownictwa API firmy — "P1",
  "sev1" — na nasze "high"/"medium"/"low"). Dotąd appka na sztywno
  zakładała jeden konkretny kształt odpowiedzi; teraz to konfiguracja w
  Ustawieniach (rozwijana sekcja "adapter zaawansowany"), nie zmiana kodu.
  Nowa komenda `get_threat_feed_status()` (+ wskaźnik w Activity.tsx)
  pokazuje wiek danych z cache albo ostatni błąd, żeby fallback nie był
  niewidoczny/mylący.

**Terminal i workspace.**
- `session_share.rs` (nowy) — współdzielenie sesji terminala: każda
  żywa sesja dopisuje output do rotującego pliku live-tail w katalogu
  (potencjalnie) współdzielonym między operatorami; Lead może "obejrzeć"
  cudzą sesję (`watch_session_start`, ten sam wzorzec pollingu co
  audit-tail w `logs.rs`). **Świadomie o zgodzie:** podgląd sam w sobie
  jest audytowany (`terminal.session_watch_start`) — obserwowany
  operator widzi w swoim Activity logu, że ktoś oglądał jego sesję. To
  nie ukryta inwigilacja.
- Nagrywanie sesji terminala w formacie asciinema v2 (`.cast`) — opt-in
  przez `terminal_recording_enabled` w Ustawieniach (domyślnie
  wyłączone: to decyzja prywatności operatora). Nagrania dostępne do
  pobrania z widoku Team (Lead) i odtwarzalne w dowolnym odtwarzaczu
  asciinema — appka sama go nie ma wbudowanego (patrz punkt niżej w
  "co jeszcze").
- `snippets.rs` (nowy) — zapisane sekwencje poleceń wstawiane do
  terminala BEZ automatycznego Entera (świadoma decyzja: operator zawsze
  widzi, co się wpisało, zanim sam zdecyduje się odpalić). Ikonka
  gwiazdki w headerze każdego taba terminala, zarządzanie w Ustawieniach.
- **Nowy widok Team** (6. ikona w lewym pasku) — roster "kto jest teraz
  aktywny" (`presence.rs`, każdy zalogowany), lista otwartych terminali z
  możliwością podglądu (Lead) i archiwum nagrań (Lead). **Uczciwie o
  zasięgu** (opisane wprost w `presence.rs`): appka jest domyślnie
  per-konto-systemowe — zobaczysz kilka równoległych procesów NA JEDNYM
  koncie, ale widoczność MIĘDZY różnymi kontami na współdzielonym labie
  wymaga ustawienia `PENETRATION_MODE_SHARED_DIR` przez wdrożenie na
  lokalizację współdzieloną z odpowiednimi uprawnieniami grupy.

**Jakość/DX.**
- **Testy renderowania komponentów** — dodano `@solidjs/testing-library`
  + `@testing-library/jest-dom` + `@testing-library/user-event`, jawna
  konfiguracja `test: { environment: "jsdom" }` w `vite.config.ts`
  (dotąd niejawna/nieudokumentowana). 16 nowych testów: `CommandPalette`
  (filtrowanie, klik, Enter, Escape), `ToastStack` (renderowanie,
  zamykanie, wiele naraz), `Onboarding` (kroki, "Pomiń", "Zaczynamy").
  Napotkany po drodze prawdziwy gotcha: `@solidjs/testing-library` NIE
  sprząta DOM-u między testami automatycznie (w przeciwieństwie do
  niektórych innych bindingów) — bez jawnego `afterEach(cleanup)` w
  `test-setup.ts` drugi `render()` w tym samym pliku nakłada się na
  pierwszy, dając mylące błędy "Found multiple elements" zamiast
  wskazywać na realny problem w komponencie.
- **Code-splitting** — `Store`/`Reports`/`Settings`/`Activity`/`Team`
  są teraz lazy-loadowane (`solid-js`'s `lazy()` + `<Suspense>`) zamiast
  ładowane eagerly razem z `App.tsx`, mimo że w danej chwili widoczny
  jest najwyżej jeden z nich. Po drodze znaleziony i naprawiony
  prawdziwy bug: `Analytics.tsx` (zawsze zamontowany w prawym sidebarze
  Workspace) miał WŁASNY, uboższy eksport PDF z bezpośrednim importem
  `jspdf` — to samo w sobie ciągnęło jsPDF + html2canvas + dompurify
  (~250KB) do głównego bundla przy KAŻDYM starcie appki, niezależnie od
  lazy-loadingu Reports.tsx. Usunięty na rzecz linku do pełnego Reports.
  **Wynik zmierzony w tym repo:** główny chunk spadł z 849KB do 425KB
  (poniżej progu ostrzeżenia Vite o 500KB), reszta ładuje się na żądanie.

Zweryfikowane w tym repo: `npx tsc -p .` (0 błędów), `npm run build`
(przechodzi, bez ostrzeżeń o rozmiarze chunków), `npm run test` (63/63
zielone — 47 z poprzednich rund + 16 nowych testów komponentów).
**Backend (Rust) znów niekompilowany w tym środowisku** (brak
toolchaina) — to była największa, najbardziej rozgałęziona zmiana
backendu ze wszystkich dotychczasowych rund (5 nowych modułów, głębokie
zmiany w `pty.rs`/`audit.rs`/`threat_feed.rs`/`blackarch.rs`) —
`cargo check` na całym workspace jest tym razem absolutnie pierwszym
krokiem do zrobienia lokalnie, przed czymkolwiek innym.

## Co jeszcze wymaga rozbudowy

1. **Backend nie przeszedł `cargo check`** (patrz Runda 10 wyżej — dotyczy
   też Rund 6-9). To jedyny sposób na 100% pewność, że `session_share.rs`,
   `presence.rs`, `lockout.rs`, `remote_audit.rs`, `snippets.rs` i głębokie
   zmiany w `pty.rs`/`audit.rs`/`threat_feed.rs`/`blackarch.rs` faktycznie
   kompilują się na docelowym hoście.
2. **Appka nie ma wbudowanego odtwarzacza nagrań asciinema** — pliki
   `.cast` (Runda 10) można pobrać i odtworzyć w zewnętrznym odtwarzaczu
   (albo wgrać na asciinema.org), ale brak podglądu "na miejscu" w UI —
   wymagałoby wbudowania (lub napisania) odtwarzacza opartego na tym
   samym `xterm.js`, który appka już ma.
3. **Widok Team pollinguje co 15s zamiast używać eventów** — prostsze niż
   dodawanie kolejnego kanału zdarzeń Tauri, ale mniej responsywne niż
   mogłoby być; podgląd sesji (`watch://output`) już jest event-driven,
   tylko sama LISTA aktywnych operatorów/sesji nie.
4. **`ipc/` → frontend nie jest jeszcze przełączony na wygenerowane typy** —
   patrz opis w poprzednich rundach, bez zmian w tej.
5. **`session/`'s `--other`/bare-tty ścieżka jest nietestowana na realnym
   sprzęcie** — bez zmian względem poprzednich rund.
6. **Podpisywanie i dystrybucja buildów** — placeholder klucza w
   `tauri.conf.json`, brak `signingIdentity`; bez zmian.
7. **`icacls` na Windows to zewnętrzne narzędzie, nie natywne Win32 ACL
   API** — bez zmian (patrz Runda 9).
8. **CI/CD** — build/lint/test jest dziś tylko lokalny. Brak pipeline'u
   budującego + podpisującego binarki dla wszystkich platform.

Chętnie wejdę głębiej w którykolwiek z powyższych punktów — powiedz, od
którego zacząć.

## Runda 2 — zrobione w tej iteracji

Wszystkie 9 punktów z listy wyżej zaadresowane. **Tauri v2** (bez zmian —
`tauri = "2"` w Cargo.toml, `@tauri-apps/api` v2 we frontendzie).

1. **Terminal → prawdziwy PTY** (`source-code/backend/src/pty.rs`) —
   `portable-pty` spawnuje `podman exec -it blackarch-redteam bash`,
   stdout/stderr strumieniowane do frontendu eventem `pty://output`,
   wejście operatora idzie przez komendę `pty_write`. `Terminal.tsx`
   przepisany na konsumenta tego strumienia zamiast zaszytych odpowiedzi.
2. **Audit log** (`src/audit.rs`) — append-only JSONL w katalogu danych
   appki (`~/.local/share/penetration-mode/audit.jsonl` na Linuksie).
   Każda mutująca akcja (login/logout, tworzenie kontenera, instalacja/
   usunięcie/odrzucenie pakietu, zmiana allowlisty) loguje operatora,
   timestamp i szczegóły. Podgląd ostatnich wpisów w panelu Analytics.
3. **Code-signing i dystrybucja** — `tauri.conf.json` ma teraz sekcje
   `bundle.macOS`/`bundle.windows` z polami na certyfikat oraz
   `plugins.updater` z endpointem i kluczem publicznym (placeholdery do
   podmiany). Pełny przepis krok-po-kroku (generowanie klucza, notarization,
   Authenticode) w **`SIGNING.md`**. Szkielet pipeline'u w
   `.github/workflows/release.yml`.
4. **Aktualizacje** — `tauri-plugin-updater` dodany po stronie Rust
   (`lib.rs`) i JS (`@tauri-apps/plugin-updater`). `lib/tauri.ts` eksportuje
   `checkForUpdate()`/`downloadAndInstallUpdate()`; header appki pokazuje
   przycisk "Aktualizacja X.Y.Z", gdy nowa wersja jest dostępna.
5. **Testy** — Rust: `#[cfg(test)]` w `blackarch.rs` z przykładowym wyjściem
   `pacman -Ss`/`-Si` (w tym przypadek pustego/uszkodzonego wejścia) —
   `cargo test`. Frontend: vitest skonfigurowany (`npm run test`), przykład
   na wyodrębnionej czystej funkcji (`lib/networkScale.ts` +
   `lib/__tests__/networkScale.test.ts`).
6. **Auth / role** (`src/auth.rs`) — appka nie startuje już w trybie "root",
   tylko pokazuje ekran logowania (`Login.tsx`), dopóki `current_session()`
   nie zwróci sesji. **Logowanie idzie przez systemowy PAM** — dokładnie to
   samo konto i hasło co do `su`/konsoli na tym hoście (moduł `pam_unix`,
   weryfikacja hasła przez setuid-root `unix_chkpwd`, appka NIE musi być
   rootem). Jeśli host ma PAM/NSS podpięte pod firmowe LDAP/SSSD/Kerberos,
   appka loguje przez to źródło automatycznie — nie ma już własnej bazy
   loginów do zarządzania. Rola (`Operator`/`Lead`/`Auditor`) wynika z
   przynależności do grup uniksowych (`redteam-lead`/`redteam-operator`,
   nazwy nadpisywalne zmiennymi środowiskowymi — patrz komentarz modułu).
7. **Bezpieczeństwo kontenera Store** — `ensure_container` tworzy teraz
   kontener z `--cap-drop=ALL`, `--security-opt no-new-privileges`, twardym
   limitem `--memory 2g --cpus 2`. Dodana **allowlist pakietów**
   (`get_allowlist`/`set_allowlist`, zarządzana przez rolę Lead) — domyślnie
   `allow_all: true` (żeby Store działał od razu), ale gotowa do zawężenia
   do zatwierdzonego zestawu narzędzi. Rootless podman i ograniczenie sieci
   do firmowego egress proxy zostają jako kolejny krok — patrz pkt niżej.
8. **Progres instalacji w czasie rzeczywistym** — `install_package`,
   `remove_package` i `ensure_container` strumieniują teraz stdout/stderr
   procesu przez event `store://progress` zamiast czekać w ciszy;
   `Store.tsx` renderuje log na żywo (ekran onboardingu + pasek podczas
   instalacji/usuwania).
9. **Prawdziwe źródła danych** (`src/threat_feed.rs`) — `NetworkMonitor`
   czyta teraz realne I/O kontenera przez `podman stats --format json`
   zamiast losowych słupków. `Analytics` woła `get_threat_feed()`, które
   uczciwie zwraca pustą listę / błąd zamiast zmyślonych CVE, dopóki nikt
   nie skonfiguruje `threat_feed.json`/`source_url` — podpięcie realnego
   SIEM/CVE API to świadomie zostawiony, oznaczony `TODO` krok (wymaga
   dodania klienta HTTP, np. `reqwest`).

### Ważne przed pierwszym uruchomieniem

- **Uruchamiaj `tauri` (CLI) tylko przez `npm run tauri ...` z
  `source-code/frontend`** — skrypt w `package.json` sam robi `cd
  ../backend` przed odpaleniem CLI. Jeśli wywołasz `tauri`/`npx tauri`
  bezpośrednio z innego katalogu, dostaniesz błąd "Couldn't recognize the
  current folder as a Tauri project" — to ograniczenie samego Tauri CLI
  (szuka configu tylko w podkatalogach bieżącego katalogu), nie bug w tym
  repo. `make dev` / `make build` używają tej samej ścieżki.
- **`beforeDevCommand`/`beforeBuildCommand` używają jawnej formy obiektowej
  `{ "cwd": "../frontend", "script": "..." }`, nie samego stringa z
  `--prefix`.** Tauri CLI ma udokumentowaną, mylącą zasadę ustalania cwd
  dla wersji string-owej (liczy je względem najbliższego `package.json` od
  strony CLI, nie względem `tauri.conf.json`) — patrz
  [tauri-apps/tauri#3551](https://github.com/tauri-apps/tauri/issues/3551).
  Efekt uboczny: `npm run build --prefix ../frontend` potrafi rozwiązać się
  o katalog za wysoko (np. `cybersec-mode/frontend` zamiast
  `cybersec-mode/source-code/frontend`) i wywalić się z ENOENT. Forma
  obiektowa z `cwd` jest liczona względem lokalizacji `tauri.conf.json`
  (czyli `source-code/backend`), więc `"cwd": "../frontend"` jednoznacznie
  wskazuje `source-code/frontend` — bez zgadywania.
- **Logowanie = konto systemowe tego hosta (PAM), nie osobna baza.** Zaloguj
  się loginem/hasłem dowolnego użytkownika Linuksa, który już istnieje na
  maszynie uruchamiającej appkę. Domyślnie appka odwołuje się do usługi PAM
  `login` (nadpisywalne zmienną `CYBERSEC_MODE_PAM_SERVICE`, np. na Fedorze
  warto ustawić `system-auth`). Żeby ktoś dostał rolę `Operator` albo `Lead`
  zamiast domyślnego `Auditor` (tylko podgląd), dodaj go do grupy:
  `sudo usermod -aG redteam-operator <użytkownik>` (albo `redteam-lead`) —
  nazwy grup też nadpisywalne (`CYBERSEC_MODE_OPERATOR_GROUP`,
  `CYBERSEC_MODE_LEAD_GROUP`). Kompilacja wymaga nagłówków PAM w systemie:
  Debian/Ubuntu `sudo apt install libpam0g-dev`, Fedora/RHEL
  `sudo dnf install pam-devel`, Arch zwykle ma je już z pakietu `pam`.
- `plugins.updater.pubkey` i `endpoints` w `tauri.conf.json` to
  placeholdery — appka nie znajdzie aktualizacji, dopóki nie wygenerujesz
  klucza i nie podepniesz prawdziwego endpointu (patrz `SIGNING.md`).
- `threat_feed.json` nie istnieje domyślnie — panel Analytics uczciwie
  pokaże "brak podpiętego źródła", dopóki go nie skonfigurujesz.

### Co dalej (nowe punkty po tej rundzie)

- Rootless podman + ograniczenie sieci kontenera do firmowego egress proxy.
- Realny klient HTTP w `threat_feed.rs` (dziś tylko kontrakt + `TODO`).
- Pełne nagrywanie sesji terminala do audit logu (dziś logujemy tylko
  start/koniec sesji, nie treść — to świadoma decyzja do podjęcia osobno,
  bo dotyczy prywatności operatora i wolumenu logów).
- Realna integracja OIDC/LDAP na poziomie appki, jeśli PAM+SSSD na hoście
  kiedyś przestanie wystarczać (dziś: PAM już pośrednio to ogarnia, jeśli
  host ma SSSD/LDAP skonfigurowane — patrz punkt 6 wyżej).
- Kontrakt w `ipc/` — wciąż pusty, a komend Tauri przybyło (auth, audit,
  pty, threat_feed) — coraz bardziej warto to ustandaryzować.

## Runda 3 — poprawki po pierwszym realnym buildzie

- **Zła nazwa obrazu kontenera** — `blackarch/blackarch` nie istnieje;
  poprawny, oficjalny obraz to `blackarchlinux/blackarch` (publikowany przez
  [BlackArch/blackarch-docker](https://github.com/BlackArch/blackarch-docker)).
  To był najpewniejszy powód błędu "Proces `podman` zakończył się kodem
  Some(125)" przy pierwszym tworzeniu kontenera (`manifest unknown` przy
  próbie ściągnięcia nieistniejącego obrazu).
- `ensure_container` używa teraz `podman run --replace`, więc nieudana
  poprzednia próba (zawieszony/martwy kontener o tej samej nazwie) już nie
  blokuje kolejnej próby błędem "name already in use".
- `run_streaming` zbiera teraz ostatnie linie stdout/stderr i dołącza je do
  zwracanego błędu — kolejne awarie tego typu pokażą realny komunikat
  podmana/pacmana, nie tylko gołą liczbę kodu wyjścia.
- **Auth przepisany na PAM** (`src/auth.rs`) — appka nie ma już własnej bazy
  loginów (`operators.json`, Argon2, seed `admin`/`changeme` — to wszystko
  usunięte). Logowanie idzie przez systemowy PAM, czyli realne konto
  systemowe tego hosta; patrz punkt 6 w "Runda 2" wyżej (zaktualizowany) po
  szczegóły i zmienne środowiskowe do konfiguracji grup/usługi PAM.

## Runda 4 — session launcher, tryb `.no-login`, porządek w workspace

- **Tryb `.no-login`** (`src/auth.rs`) — obecność
  `~/.config/hackeros/Penetration-Mode/.no-login` pomija PAM całkowicie:
  `current_session`/`login` zwracają sesję z rolą `Lead` bez ekranu
  logowania. Zawsze widoczne w UI (stały czerwony banner, `App.tsx`) i
  zawsze audytowane (`auth.no_login_bypass`) — nie jest to cichy backdoor,
  tylko jawny, śledzalny tryb zaufany dla właściciela konta/hosta.
- **`session/`** (nowy katalog) — binarz `penetration-mode`, osobny od
  powłoki GUI (przemianowanej na `penetration-mode-shell`, patrz
  `source-code/backend/Cargo.toml`'s `[[bin]]` i `tauri.conf.json`'s
  `mainBinaryName`, żeby nazwy nie kolidowały). Bez podkomendy: hand-off
  do `comphwde --extern-penetration-mode` + realne `sde-ipc`
  (`LaunchApp`/`ListWindows`/`Shutdown`, wektorowane, nie samo
  spawn+polling na plik socketu). `penetration-mode app`: zwykła
  aplikacja na już działającym pulpicie, albo (`--other`/gołe tty)
  jednorazowy `comphwde --extern-other`. `session/vendor/` ma
  zwendorowane kopie `sde-ipc` i `penetration-mode-ipc` (ta druga to
  ten sam reference-client, który wcześniej siedział wyłącznie jako
  dokumentacja w repo `comphwde`).
- **Root `Cargo.toml`** — poprzednia wersja (binarz `cm`, `compositor/`,
  `cm-bg/`) wskazywała na katalogi, których w tym repo nie ma (zostałość
  starej generacji Slint). Usunięta; nowy root to czysty virtual
  workspace z `session/` + `source-code/backend` + `ipc/` jako members.
  `install.hl`/`build.hl`/`remove.hl` i `desktop/*.desktop` (nowy katalog
  — wcześniej też nie istniał mimo że `install.hl` go zakładał)
  przepisane pod rzeczywiste nazwy binarek.
- **`ipc/`** — przestał być pustym placeholderem: `Category`/`Package`/
  `Allowlist`/`ProgressEvent` (Store) mają teraz jedno źródło prawdy z
  `#[derive(TS)]` (`ts-rs`), `blackarch.rs` importuje je zamiast
  duplikować. Generowanie TS-owych odpowiedników i przełączenie
  `tauri.ts` na nie to jeszcze nie zrobione — patrz "Co jeszcze wymaga
  rozbudowy" niżej.

## Runda 5 — event-driven `session/`, testy `Store.tsx`

- **`session/`'s window-wait przepisany na `SdeCall::Subscribe`** —
  zamiast odpytywać `ListWindows` co 150ms, `main.rs` otwiera raz
  subskrypcję (`sde_ipc::subscribe`) i czyta ją na osobnym wątku
  (`spawn_event_reader`), przekazując eventy do wątku głównego przez
  kanał — co pozwala nałożyć realny timeout (`recv_timeout`) na
  pojawienie się okna, zamiast ryzykować zawiśnięcie na zawsze, skoro
  `Subscription::recv` sama w sobie blokuje bez limitu czasu. Jeden
  `ListWindows` tuż po `LaunchApp` został — zamyka lukę wyścigu między
  wysłaniem `LaunchApp` a otwarciem subskrypcji. Ta sama ścieżka obsługuje
  teraz oba extern name'y (`penetration-mode` i `other`), więc
  `session/vendor/penetration-mode-ipc` zostało w workspace jako
  gotowy, ale niepodłączony jeszcze budulec pod przyszły "wrapper mode"
  (patrz jego moduł doc), nie jako aktywna zależność `session/`.
- **Testy `Store.tsx`'s stanów instalacji** — wyciągnięte do
  `lib/installState.ts` (`installButtonLabel`/`isActionDisabled`) razem z
  testami (`lib/__tests__/installState.test.ts`), tym samym wzorcem co
  `lib/__tests__/networkScale.test.ts`).
