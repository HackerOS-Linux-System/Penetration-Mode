use std::env;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};

use sde_ipc::{SdeCall, SdeEvent, SdeResult, SdeWindowInfo, Subscription};

#[derive(Parser)]
#[command(name = "penetration-mode", about = "Penetration Mode session launcher")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Force plain-app mode's bare-tty fallback (`comphwde --extern-other`)
    /// even when a Wayland/X11 display is already available. Only has an
    /// effect together with `app`; ignored (with a warning) in default
    /// session mode, which never nests.
    #[arg(long = "other", global = true)]
    other: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Launch as an ordinary nested app instead of taking over the
    /// session — see module doc.
    App,
}

/// Name comphwde was published under — see `install.hl`
/// (`$PREFIX/bin/comphwde` in the `comphwde` repository). Resolved via
/// `PATH` rather than hardcoded to that one path so a locally-built
/// `target/release/comphwde` on `PATH` during development is picked up
/// too.
const COMPHWDE_BIN: &str = "comphwde";

/// The Tauri shell binary's installed name — see
/// `source-code/backend/Cargo.toml`'s `[[bin]]` / `tauri.conf.json`'s
/// `mainBinaryName` in this repository. Resolved the same way as
/// [`COMPHWDE_BIN`].
const SHELL_BIN: &str = "penetration-mode-shell";

/// The shell window's `app_id` as comphwde reports it over `ListWindows`/
/// `Subscribe` — `tauri.conf.json`'s `identifier`
/// (`com.redteam.penetrationmode`). Duplicated here (rather than
/// imported from `penetration-mode-ipc`) so this file works unchanged
/// against *either* extern name (`penetration-mode` or `other` — see
/// [`OTHER_EXTERN_NAME`]); `penetration-mode-ipc::SHELL_APP_ID` is the
/// same string, just bundled with an extern name this file doesn't always
/// want.
const SHELL_APP_ID: &str = "com.redteam.penetrationmode";

/// The curated session's extern name — matches
/// `penetration_mode_ipc::EXTERN_NAME`, kept as a plain string constant
/// here too so [`run_via_comphwde`] can stay generic over `sde-ipc`
/// directly instead of depending on the higher-level vendored crate for
/// just this one string.
const SESSION_EXTERN_NAME: &str = "penetration-mode";

/// `--extern-other`'s name — a throwaway, non-curated comphwde instance
/// for plain-app mode's bare-tty fallback (see module doc). Not
/// [`SESSION_EXTERN_NAME`] on purpose: reusing the curated session's own
/// extern name here would let `penetration-mode app` silently collide
/// with (or hijack) an already-running full session on the same socket.
const OTHER_EXTERN_NAME: &str = "other";

const READY_TIMEOUT: Duration = Duration::from_secs(10);
const WINDOW_TIMEOUT: Duration = Duration::from_secs(15);
const CALL_TIMEOUT: Duration = Duration::from_secs(2);
const READY_POLL_INTERVAL: Duration = Duration::from_millis(150);

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        None => {
            if cli.other {
                eprintln!(
                    "penetration-mode: --other tylko z 'app' (tryb session zawsze używa --extern-penetration-mode) — ignoruję"
                );
            }
            run_session_mode()
        }
        Some(Commands::App) => run_app_mode(cli.other),
    }
}

/// Default (no subcommand) invocation: always hands the whole display off
/// to `comphwde --extern-penetration-mode`, exactly like a
/// `wayland-sessions/*.desktop` entry launching it would (see
/// `desktop/penetration-mode-session.desktop`). comphwde itself (not
/// this binary) decides bare-TTY-takeover vs nested — see its own
/// `main.rs` module doc — based on whether `WAYLAND_DISPLAY`/`DISPLAY` are
/// already set in *its* environment, so this function deliberately does
/// not pre-check that itself.
fn run_session_mode() -> Result<()> {
    let mut compositor = spawn_comphwde(SESSION_EXTERN_NAME)
        .context("nie udało się uruchomić comphwde --extern-penetration-mode")?;

    if let Err(e) = wait_until_up(SESSION_EXTERN_NAME, &mut compositor) {
        let _ = compositor.kill();
        return Err(e).context("comphwde --extern-penetration-mode nie odpowiedziało na czas");
    }

    run_via_comphwde(SESSION_EXTERN_NAME, &mut compositor)
}

/// `penetration-mode app` invocation — see module doc for the
/// nested-vs-`--other` decision this makes.
fn run_app_mode(force_other: bool) -> Result<()> {
    let already_nested = env::var_os("WAYLAND_DISPLAY").is_some() || env::var_os("DISPLAY").is_some();

    if already_nested && !force_other {
        // Zwykła apka na już działającym pulpicie — bez comphwde/IPC w
        // ogóle, dokładnie tak jak każda inna aplikacja.
        let status = spawn_shell_direct()
            .context("nie udało się uruchomić powłoki Penetration Mode jako zwykłej aplikacji")?
            .wait()
            .context("błąd oczekiwania na powłokę")?;
        if !status.success() {
            bail!("powłoka Penetration Mode zakończyła się z błędem: {status}");
        }
        return Ok(());
    }

    // Brak istniejącego wyświetlacza (gołe tty) albo jawnie wymuszone
    // `--other`: dostajemy jednorazowy, nie-kuratorowany kompozytor pod
    // ten jeden proces zamiast pełnej sesji `--extern-penetration-mode`
    // — ta sama sekwencja co w trybie session, tylko pod innym extern name.
    let mut compositor =
        spawn_comphwde(OTHER_EXTERN_NAME).context("nie udało się uruchomić comphwde --extern-other")?;

    if let Err(e) = wait_until_up(OTHER_EXTERN_NAME, &mut compositor) {
        let _ = compositor.kill();
        return Err(e).context("comphwde --extern-other nie odpowiedziało na czas");
    }

    run_via_comphwde(OTHER_EXTERN_NAME, &mut compositor)
}

/// Shared tail end of both modes once a `comphwde --extern-<extern_name>`
/// instance is up and reachable: `LaunchApp` the shell, wait for its
/// window (push-based, see module doc), wait for it to go away again,
/// `Shutdown` comphwde, wait for that process to exit.
fn run_via_comphwde(extern_name: &str, compositor: &mut Child) -> Result<()> {
    sde_ipc::call(extern_name, SdeCall::LaunchApp { command: SHELL_BIN.to_string(), args: vec![] }, CALL_TIMEOUT)
        .context("comphwde odrzuciło LaunchApp dla powłoki Penetration Mode")?;

    if let Err(e) = wait_for_shell_window(extern_name, compositor) {
        let _ = compositor.kill();
        return Err(e);
    }

    wait_for_shell_window_gone(extern_name, compositor)?;

    let _ = sde_ipc::call(extern_name, SdeCall::Shutdown, CALL_TIMEOUT);
    let status = compositor.wait().context("błąd oczekiwania na comphwde")?;
    if !status.success() {
        bail!("comphwde zakończyło się z błędem: {status}");
    }
    Ok(())
}

fn spawn_comphwde(extern_name: &str) -> Result<Child> {
    Command::new(COMPHWDE_BIN)
        .arg(format!("--extern-{extern_name}"))
        .stdin(Stdio::null())
        .spawn()
        .with_context(|| format!("nie znaleziono '{COMPHWDE_BIN}' na PATH"))
}

/// Uruchamia powłokę bez żadnej ingerencji w jej środowisko — dziedziczy
/// `WAYLAND_DISPLAY`/`DISPLAY` tego procesu tak jak każda inna zwykła
/// aplikacja na już działającym pulpicie.
fn spawn_shell_direct() -> Result<Child> {
    Command::new(SHELL_BIN)
        .stdin(Stdio::null())
        .spawn()
        .with_context(|| format!("nie znaleziono '{SHELL_BIN}' na PATH"))
}

/// Czeka aż `comphwde --extern-<extern_name>` zacznie odpowiadać na
/// `Ping` (`sde_ipc::is_running`) — realny sygnał gotowości, nie samo
/// istnienie pliku socketu (co nie gwarantuje że listener już obsługuje
/// requesty). Sprawdza po drodze, czy sam proces comphwde jeszcze żyje,
/// żeby nie czekać pełnego timeoutu na coś, co już padło (np. brak
/// `/dev/dri` przy próbie przejęcia gołego tty).
fn wait_until_up(extern_name: &str, compositor: &mut Child) -> Result<()> {
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        if sde_ipc::is_running(extern_name) {
            return Ok(());
        }
        if let Some(status) = compositor.try_wait()? {
            bail!("comphwde zakończyło się przedwcześnie ({status}) zanim odpowiedziało na Ping");
        }
        if Instant::now() >= deadline {
            bail!("timeout ({READY_TIMEOUT:?}) czekając na comphwde --extern-{extern_name}");
        }
        std::thread::sleep(READY_POLL_INTERVAL);
    }
}

fn window_list_has_shell(windows: &[SdeWindowInfo]) -> bool {
    windows.iter().any(|w| w.app_id == SHELL_APP_ID)
}

/// Czeka aż okno powłoki (`SHELL_APP_ID`) się zmapuje, przez
/// `SdeCall::Subscribe`/`SdeEvent::Windows` zamiast pollingu na
/// `ListWindows`.
///
/// Kolejność ma znaczenie: najpierw jeden zwykły `ListWindows`
/// (`call`, nie subskrypcja) *po* `LaunchApp` już wysłanym przez wołający
/// [`run_via_comphwde`] — na wypadek gdyby okno zmapowało się w tym samym
/// mgnieniu, zanim ten proces zdąży w ogóle otworzyć subskrypcję. Dopiero
/// gdy ten pierwszy strzał nic nie znajdzie, otwieramy `Subscription` i
/// czekamy na pierwszy pasujący `Windows` event — subskrypcja nie dostaje
/// żadnego "stanu początkowego" przy otwarciu (patrz `sde-ipc`'s moduł
/// doc), więc bez tego pierwszego `ListWindows` byłaby tu luka wyścigu.
///
/// `Subscription::recv` sama w sobie blokuje bez timeoutu (patrz jej doc
/// w `sde-ipc`) — [`spawn_event_reader`] czyta ją na osobnym wątku i
/// przekazuje eventy przez kanał, żeby ten wątek główny mógł nałożyć
/// realny timeout (`recv_timeout`) zamiast utknąć na zawsze, gdyby okno
/// nigdy się nie pojawiło i comphwde nigdy więcej nic nie wysłało.
fn wait_for_shell_window(extern_name: &str, compositor: &mut Child) -> Result<()> {
    if shell_window_now(extern_name)? {
        return Ok(());
    }

    let sub = open_subscription(extern_name, compositor)?;
    let rx = spawn_event_reader(sub);
    let deadline = Instant::now() + WINDOW_TIMEOUT;

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            bail!("okno powłoki Penetration Mode nie pojawiło się w ciągu {WINDOW_TIMEOUT:?} od LaunchApp");
        }
        match rx.recv_timeout(remaining) {
            Ok(Ok(SdeEvent::Windows(windows))) if window_list_has_shell(&windows) => return Ok(()),
            Ok(Ok(_)) => continue,
            Ok(Err(e)) => {
                if let Some(status) = compositor.try_wait()? {
                    bail!("comphwde zakończyło się nieoczekiwanie ({status}) zanim okno powłoki się pojawiło");
                }
                bail!("subskrypcja sde-ipc padła zanim okno powłoki się pojawiło: {e}");
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(status) = compositor.try_wait()? {
                    bail!("comphwde zakończyło się nieoczekiwanie ({status}) zanim okno powłoki się pojawiło");
                }
                // Pętla wróci na górę i trafi na deadline check powyżej.
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                bail!("wątek subskrypcji sde-ipc padł nieoczekiwanie zanim okno powłoki się pojawiło")
            }
        }
    }
}

/// Czeka aż okno powłoki zniknie (zamknięte przez operatora, crash, albo
/// przycisk zasilania w UI) — ten launcher traktuje to jako koniec
/// sesji. Bez timeoutu z rozmysłem: to normalny stan "operator dalej
/// pracuje", nie coś do czego pasuje limit czasu — stąd zwykłe
/// (blokujące bez końca) `rx.recv()`, nie `recv_timeout` jak w
/// [`wait_for_shell_window`]. Zamknięcie procesu comphwde zamyka też ten
/// socket, więc `recv()` i tak odblokuje się (z błędem) najpóźniej wtedy.
fn wait_for_shell_window_gone(extern_name: &str, compositor: &mut Child) -> Result<()> {
    if !shell_window_now(extern_name)? {
        return Ok(());
    }

    let sub = open_subscription(extern_name, compositor)?;
    let rx = spawn_event_reader(sub);

    loop {
        match rx.recv() {
            Ok(Ok(SdeEvent::Windows(windows))) if !window_list_has_shell(&windows) => return Ok(()),
            Ok(Ok(_)) => continue,
            Ok(Err(_)) | Err(_) => {
                // Zerwane połączenie zwykle znaczy, że comphwde właśnie
                // się zamknęło (patrz `SdeEvent::CompositorShuttingDown`'s
                // doc w sde-ipc: dziś jeszcze nie wysyłane explicite,
                // zamknięcie socketu jest tym sygnałem) — a skoro
                // comphwde już nie działa, to i powłoka jako jego klient
                // na pewno już nie działa. Traktujemy to jako "okno
                // zniknęło", nie jako błąd, żeby normalne zamknięcie
                // sesji przez `Shutdown` gdzie indziej nie kończyło się
                // tu przekłamanym błędem.
                return Ok(());
            }
        }
    }
}

fn shell_window_now(extern_name: &str) -> Result<bool> {
    match sde_ipc::call(extern_name, SdeCall::ListWindows, CALL_TIMEOUT)? {
        SdeResult::Windows(windows) => Ok(window_list_has_shell(&windows)),
        _ => Ok(false),
    }
}

fn open_subscription(extern_name: &str, compositor: &mut Child) -> Result<Subscription> {
    if let Some(status) = compositor.try_wait()? {
        bail!("comphwde już nie działa ({status}), nie ma do czego subskrybować");
    }
    sde_ipc::subscribe(extern_name).context("nie udało się otworzyć subskrypcji sde-ipc")
}

/// Czyta `sub` na osobnym wątku (bo `Subscription::recv` blokuje bez
/// timeoutu) i przekazuje każdy event/błąd przez kanał, żeby wątek
/// główny mógł czekać z `recv_timeout` zamiast ryzykować zawiśnięcie na
/// zawsze. Wątek kończy się po pierwszym błędzie (połączenie i tak jest
/// wtedy martwe) albo gdy odbiorca zniknie (koniec `Receiver` po stronie
/// wołającego, np. bo `wait_for_shell_window` już zwróciło wynik).
fn spawn_event_reader(mut sub: Subscription) -> mpsc::Receiver<Result<SdeEvent, String>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || loop {
        let msg = sub.recv().map_err(|e| e.to_string());
        let was_err = msg.is_err();
        if tx.send(msg).is_err() || was_err {
            break;
        }
    });
    rx
}
