use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Window};

use crate::blackarch::CONTAINER_NAME;

/// Skąd druga konsola ("Logs") ma czerpać dane. `Container` odpala
/// `podman logs -f` na kontenerze Store (patrz blackarch.rs); `Audit`
/// robi `tail -f`-podobny odczyt lokalnego `audit.jsonl` (patrz audit.rs),
/// przydatny gdy kontener jeszcze nie istnieje albo interesują nas akcje
/// operatora, a nie stdout/stderr procesów w środku.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogSource {
    Container,
    Audit,
    System,
}

#[derive(Serialize, Clone)]
struct LogLine {
    source: LogSource,
    line: String,
}

enum Handle {
    Process(Child),
    /// Flaga zatrzymania dla wątku odczytującego plik audit.jsonl w pętli.
    FileTail(Arc<AtomicBool>),
}

static ACTIVE: Lazy<Mutex<Option<Handle>>> = Lazy::new(|| Mutex::new(None));

fn stop_active() {
    if let Some(handle) = ACTIVE.lock().unwrap().take() {
        match handle {
            Handle::Process(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            Handle::FileTail(flag) => flag.store(true, Ordering::SeqCst),
        }
    }
}

/// Tłumaczy błąd `spawn()` na czytelny komunikat dla operatora zamiast
/// surowego `std::io::Error` Display-a (np. "No such file or directory
/// (os error 2)"), który nic nie mówi komuś, kto nie zna kodów errno.
fn describe_spawn_error(cmd_name: &str, err: &std::io::Error, hint: &str) -> String {
    match err.kind() {
        std::io::ErrorKind::NotFound => {
            format!("`{cmd_name}` nie jest zainstalowane lub niedostępne w PATH. {hint}")
        }
        std::io::ErrorKind::PermissionDenied => {
            format!("Brak uprawnień do uruchomienia `{cmd_name}`. {hint}")
        }
        _ => format!("Nie udało się uruchomić `{cmd_name}`: {err}. {hint}"),
    }
}

fn spawn_process_source(window: Window, cmd_name: &str, args: &[&str], source: LogSource, hint: &str) -> Result<(), String> {
    let mut command = Command::new(cmd_name);
    command.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| describe_spawn_error(cmd_name, &e, hint))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(stdout) = stdout {
        let win = window.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if win.emit("logs://output", LogLine { source, line }).is_err() {
                    break;
                }
            }
        });
    }
    if let Some(stderr) = stderr {
        let win = window.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if win.emit("logs://output", LogLine { source, line }).is_err() {
                    break;
                }
            }
        });
    }

    *ACTIVE.lock().unwrap() = Some(Handle::Process(child));

    // Uwaga: nie ma tu osobnego "watchera" sprzątającego ACTIVE, gdy proces
    // padnie sam (np. kontener został zabity spod appki) — kolejne
    // `logs_tail_start`/`logs_tail_stop` i tak wołają `stop_active()`,
    // które bezpiecznie obsłuży już-martwe dziecko (`kill`/`wait` na
    // zakończonym procesie po prostu nic nie robią poza odczytaniem
    // statusu). Frontend i tak dowiaduje się o zaniku strumienia przez
    // brak nowych `logs://output`, nie przez osobny event.
    Ok(())
}

/// Odczytuje nowe linie dopisywane do `audit.jsonl` w pętli (proste
/// pollowanie zamiast inotify — plik jest mały i dopisywany rzadko, więc
/// nie warto ciągnąć dodatkowej zależności tylko po file-watcher).
fn spawn_audit_tail(window: Window) {
    let stop = Arc::new(AtomicBool::new(false));
    *ACTIVE.lock().unwrap() = Some(Handle::FileTail(stop.clone()));

    std::thread::spawn(move || {
        let path = crate::audit::log_file_path();
        let mut offset: u64 = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

        while !stop.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(700));
            let Ok(mut file) = std::fs::File::open(&path) else { continue };
            let Ok(meta) = file.metadata() else { continue };
            if meta.len() < offset {
                // Log został zrotowany/wyczyszczony — zacznij od nowa.
                offset = 0;
            }
            if meta.len() == offset {
                continue;
            }
            if file.seek(SeekFrom::Start(offset)).is_err() {
                continue;
            }
            let mut buf = String::new();
            if file.read_to_string(&mut buf).is_err() {
                continue;
            }
            offset = meta.len();
            for raw in buf.lines() {
                // Formatujemy JSONL audytu do czytelnej jednolinijkowej postaci
                // zamiast surowego JSON-a, żeby druga konsola wyglądała jak log,
                // nie jak zrzut danych.
                let pretty = format_audit_line(raw).unwrap_or_else(|| raw.to_string());
                if window.emit("logs://output", LogLine { source: LogSource::Audit, line: pretty }).is_err() {
                    return;
                }
            }
        }
    });
}

fn format_audit_line(raw: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let ts = v.get("timestamp")?.as_str()?;
    let event = v.get("event")?.as_str()?;
    let operator = v.get("operator")?.as_str()?;
    Some(format!("[{ts}] {operator} :: {event}"))
}

const PODMAN_HINT: &str = "Sprawdź, czy Podman jest zainstalowany (`podman --version`) i czy kontener `blackarch-redteam` w ogóle istnieje — patrz zakładka Arsenal.";

const JOURNALCTL_HINT: &str = "Ten host może nie używać systemd, albo operator nie ma uprawnień do dziennika. Spróbuj dodać użytkownika do grupy `systemd-journal` (`sudo usermod -aG systemd-journal $USER`, potem wyloguj się i zaloguj ponownie) albo wybierz źródło Container/Audit zamiast System.";

/// `journalctl -f` (proces długożyjący, uruchamiany przez `spawn_process_source`)
/// potrafi wystartować poprawnie nawet gdy operator nie ma dostępu do
/// dziennika — sam proces się uruchamia, ale zamiast strumienia linii
/// dostajemy tylko pojedynczy komunikat błędu na stderr i ciszę. Zamiast
/// czekać aż operator domyśli się, że "nic się nie dzieje" oznacza brak
/// uprawnień, robimy krótkie, synchroniczne sprawdzenie z góry
/// (`journalctl -n 1`) i od razu zwracamy czytelny błąd, jeśli się nie uda.
fn preflight_journalctl() -> Result<(), String> {
    let output = Command::new("journalctl").args(["-n", "1", "--no-pager", "-q"]).output();
    match output {
        Err(e) => Err(describe_spawn_error("journalctl", &e, JOURNALCTL_HINT)),
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let reason = if stderr.trim().is_empty() {
                format!("kod wyjścia {}", out.status)
            } else {
                stderr.trim().to_string()
            };
            Err(format!("journalctl odmówiło dostępu do dziennika systemowego ({reason}). {JOURNALCTL_HINT}"))
        }
    }
}

#[tauri::command]
pub fn logs_tail_start(window: Window, source: LogSource) -> Result<(), String> {
    stop_active();
    let operator = crate::auth::current_username();
    crate::audit::log_event("logs.tail_start", &operator, serde_json::json!({ "source": source }));

    match source {
        LogSource::Container => spawn_process_source(
            window,
            "podman",
            &["logs", "-f", "--tail", "200", CONTAINER_NAME],
            source,
            PODMAN_HINT,
        ),
        LogSource::Audit => {
            spawn_audit_tail(window);
            Ok(())
        }
        LogSource::System => {
            preflight_journalctl()?;
            spawn_process_source(
                window,
                "journalctl",
                &["-f", "-n", "200", "--no-hostname", "-o", "short-iso"],
                source,
                JOURNALCTL_HINT,
            )
        }
    }
}

#[tauri::command]
pub fn logs_tail_stop() {
    let operator = crate::auth::current_username();
    stop_active();
    crate::audit::log_event("logs.tail_stop", &operator, serde_json::json!({}));
}
