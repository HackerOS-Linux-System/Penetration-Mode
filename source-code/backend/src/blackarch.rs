use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{Emitter, Window};

use crate::auth::{self, Role};
// `Category`/`Package`/`Allowlist`/`ProgressEvent` used to be defined
// here directly - they now live in the workspace-shared `ipc/` crate
// (see its module doc) so `ts-rs` can generate matching TypeScript types
// for the frontend from a single source of truth instead of the two
// copies silently drifting apart.
use penetration_mode_ipc_types::{Allowlist, Category, Package, ProgressEvent};

pub const CONTAINER_NAME: &str = "blackarch-redteam";
const IMAGE: &str = "docker.io/blackarchlinux/blackarch:latest";

/// Limity zasobów kontenera Store — świadomie konserwatywne domyślne
/// wartości, dostosuj do polityki firmy. Patrz README p. "Bezpieczeństwo
/// kontenera Store".
const CONTAINER_MEMORY_LIMIT: &str = "2g";
const CONTAINER_CPU_LIMIT: &str = "2";

/// Statyczna lista grup pakietów BlackArch pokazywana jako kategorie w Store.
/// To realne nazwy grup z repozytorium BlackArch (`pacman -Sg | grep blackarch`),
/// zawężone do najbardziej typowych dla warsztatu red-teamu.
const CATEGORIES: &[(&str, &str)] = &[
    ("blackarch-recon", "Rekonesans"),
    ("blackarch-scanner", "Skanery"),
    ("blackarch-webapp", "Aplikacje webowe"),
    ("blackarch-networking", "Sieć"),
    ("blackarch-forensic", "Informatyka śledcza"),
    ("blackarch-fuzzer", "Fuzzing"),
    ("blackarch-cracker", "Łamanie haseł"),
    ("blackarch-sniffer", "Podsłuch ruchu"),
    ("blackarch-wireless", "Bezprzewodowe"),
    ("blackarch-exploitation", "Eksploitacja"),
];

fn emit_progress(window: &Window, stage: &str, line: impl Into<String>) {
    let _ = window.emit("store://progress", ProgressEvent { stage: stage.to_string(), line: line.into() });
}

fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("nie można uruchomić `{cmd}`: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Jak `run`, ale strumieniuje każdą linię stdout+stderr do frontendu jako
/// event `store://progress` w czasie rzeczywistym, i dodatkowo zbiera je,
/// żeby w razie błędu zwrócić coś więcej niż gołą liczbę kodu wyjścia —
/// (np. "manifest unknown" przy złej nazwie obrazu, "name already in use"
/// przy konflikcie kontenera) trafia teraz do komunikatu błędu, nie tylko
/// na ekran w trakcie i do audit logu.
fn run_streaming(cmd: &str, args: &[&str], window: &Window, stage: &str) -> Result<(), String> {
    let mut child = Command::new(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("nie można uruchomić `{cmd}`: {e}"))?;

    let captured: std::sync::Arc<std::sync::Mutex<Vec<String>>> = Default::default();

    let mut handles = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        let window = window.clone();
        let stage = stage.to_string();
        let captured = captured.clone();
        handles.push(std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().flatten() {
                emit_progress(&window, &stage, line.clone());
                captured.lock().unwrap().push(line);
            }
        }));
    }
    if let Some(stderr) = child.stderr.take() {
        let window = window.clone();
        let stage = stage.to_string();
        let captured = captured.clone();
        handles.push(std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().flatten() {
                emit_progress(&window, &stage, line.clone());
                captured.lock().unwrap().push(line);
            }
        }));
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    for h in handles {
        let _ = h.join();
    }

    if !status.success() {
        let lines = captured.lock().unwrap();
        let tail: Vec<&str> = lines.iter().rev().take(10).map(|s| s.as_str()).collect();
        let detail = if tail.is_empty() {
            format!("(proces nie wypisał żadnego komunikatu na stdout/stderr, kod wyjścia {:?})", status.code())
        } else {
            tail.into_iter().rev().collect::<Vec<_>>().join("\n")
        };
        return Err(format!(
            "Proces `{cmd}` zakończył się kodem {:?}:\n{detail}",
            status.code()
        ));
    }
    Ok(())
}

fn podman(args: &[&str]) -> Result<String, String> {
    run("podman", args)
}

fn exec_in_container(args: &[&str]) -> Result<String, String> {
    let mut full = vec!["exec", CONTAINER_NAME];
    full.extend_from_slice(args);
    podman(&full)
}

fn exec_in_container_streaming(args: &[&str], window: &Window, stage: &str) -> Result<(), String> {
    let mut full = vec!["exec", CONTAINER_NAME];
    full.extend_from_slice(args);
    run_streaming("podman", &full, window, stage)
}

// ---------------------------------------------------------------------------
// Allowlist pakietów (zarządzana przez rolę Lead)
// ---------------------------------------------------------------------------

fn allowlist_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("penetration-mode")
        .join("allowlist.json")
}

fn load_allowlist() -> Allowlist {
    let path = allowlist_path();
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_allowlist() -> Allowlist {
    load_allowlist()
}

#[tauri::command]
pub fn set_allowlist(allowlist: Allowlist) -> Result<(), String> {
    let session = auth::require_role(Role::Lead)?;
    let path = allowlist_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_vec_pretty(&allowlist).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    crate::audit::log_event(
        "store.allowlist_updated",
        &session.username,
        serde_json::json!({ "allow_all": allowlist.allow_all, "count": allowlist.packages.len() }),
    );
    Ok(())
}

fn check_allowlist(name: &str) -> Result<(), String> {
    let allowlist = load_allowlist();
    if allowlist.allow_all || allowlist.packages.iter().any(|p| p == name) {
        Ok(())
    } else {
        Err(format!("Pakiet '{name}' nie jest na allowliście Store. Poproś Lead o dodanie go."))
    }
}

// ---------------------------------------------------------------------------
// Komendy Tauri
// ---------------------------------------------------------------------------

/// Czy `podman` jest w ogóle dostępny w PATH hosta.
#[tauri::command]
pub fn check_podman() -> bool {
    Command::new("podman")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// "missing" | "stopped" | "running" | "podman-not-found"
#[tauri::command]
pub fn container_status() -> String {
    if !check_podman() {
        return "podman-not-found".into();
    }

    let exists = podman(&["container", "exists", CONTAINER_NAME]).is_ok();
    if !exists {
        return "missing".into();
    }

    match podman(&["container", "inspect", "-f", "{{.State.Running}}", CONTAINER_NAME]) {
        Ok(out) if out.trim() == "true" => "running".into(),
        _ => "stopped".into(),
    }
}

/// Tworzy (jeśli nie istnieje) i uruchamia kontener BlackArch, synchronizuje
/// bazę pakietów pacmana. Wywoływane raz, przy pierwszym otwarciu Store,
/// albo ręcznie przyciskiem "Napraw / zresetuj kontener". Strumieniuje
/// postęp do frontendu przez event `store://progress`.
///
/// Twardnienie kontenera (patrz README p. "Bezpieczeństwo kontenera Store"
/// po więcej kontekstu i co jeszcze warto dodać — np. rootless podman,
/// ograniczenie sieci do firmowego egress proxy zamiast pełnego internetu):
/// - `--security-opt no-new-privileges` — proces w kontenerze nie może
///   eskalować uprawnień przez setuid/setgid binarki.
/// - `--memory` / `--cpus` — twardy limit zasobów, żeby jeden kontener nie
///   zjadł całego hosta (np. przy fuzzingu).
/// - `--cap-drop=ALL` — zrzucamy wszystkie capability Linuksa; część
///   narzędzi sieciowych (nmap raw sockets) może wymagać `--cap-add=NET_RAW`
///   z powrotem — to świadomy kompromis do ustawienia per-organizacja.
#[tauri::command]
pub async fn ensure_container(window: Window) -> Result<String, String> {
    let session = auth::require_role(Role::Operator)?;

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        if !check_podman() {
            return Err("Podman nie jest zainstalowany w systemie hosta.".into());
        }

        let exists = podman(&["container", "exists", CONTAINER_NAME]).is_ok();

        if !exists {
            emit_progress(&window, "create", "Tworzę kontener blackarch-redteam...");
            run_streaming(
                "podman",
                &[
                    "run",
                    "-d",
                    "--replace",
                    "--name",
                    CONTAINER_NAME,
                    "--security-opt",
                    "no-new-privileges",
                    "--cap-drop=ALL",
                    "--memory",
                    CONTAINER_MEMORY_LIMIT,
                    "--cpus",
                    CONTAINER_CPU_LIMIT,
                    IMAGE,
                    "tail",
                    "-f",
                    "/dev/null",
                ],
                &window,
                "create",
            )?;
        } else {
            let running = podman(&["container", "inspect", "-f", "{{.State.Running}}", CONTAINER_NAME])
                .map(|o| o.trim() == "true")
                .unwrap_or(false);
            if !running {
                emit_progress(&window, "start", "Uruchamiam istniejący kontener...");
                run_streaming("podman", &["start", CONTAINER_NAME], &window, "start")?;
            }
        }

        emit_progress(&window, "sync", "Synchronizuję bazę pakietów (pacman -Sy)...");
        exec_in_container_streaming(&["pacman", "-Sy", "--noconfirm"], &window, "sync")?;

        Ok("running".to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    match &result {
        Ok(_) => crate::audit::log_event(
            "store.container_ready",
            &session.username,
            serde_json::json!({ "container": CONTAINER_NAME }),
        ),
        Err(e) => crate::audit::log_event(
            "store.container_setup_failed",
            &session.username,
            serde_json::json!({ "error": e }),
        ),
    }

    result
}

#[tauri::command]
pub fn list_categories() -> Vec<Category> {
    CATEGORIES
        .iter()
        .map(|(id, label)| Category { id: id.to_string(), label: label.to_string() })
        .collect()
}

fn parse_installed() -> Vec<String> {
    exec_in_container(&["pacman", "-Qq"])
        .map(|out| out.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn installed_packages() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(parse_installed).await.map_err(|e| e.to_string())
}

/// `pacman -Ss <query>` — wyszukiwanie pełnotekstowe w repo BlackArch.
/// Format wyjścia to pary linii: nagłówek `repo/nazwa wersja (grupy)` +
/// linia opisu z wcięciem.
#[tauri::command]
pub async fn search_packages(query: String) -> Result<Vec<Package>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<Package>, String> {
        let raw = exec_in_container(&["pacman", "-Ss", &query])?;
        let installed = parse_installed();
        Ok(parse_ss_output(&raw, &installed))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lista pakietów należących do danej grupy/kategorii (`pacman -Sg <group>`),
/// dociągnięta o wersję/opis batchowym `pacman -Si`.
#[tauri::command]
pub async fn packages_in_category(category: String) -> Result<Vec<Package>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<Package>, String> {
        let group_out = exec_in_container(&["pacman", "-Sg", &category])?;
        let names: Vec<String> = group_out
            .lines()
            .filter_map(|l| l.split_whitespace().nth(1))
            .map(|s| s.to_string())
            .collect();

        if names.is_empty() {
            return Ok(vec![]);
        }

        let mut si_args: Vec<&str> = vec!["pacman", "-Si"];
        si_args.extend(names.iter().map(|s| s.as_str()));
        let si_out = exec_in_container(&si_args)?;
        let installed = parse_installed();

        Ok(parse_si_output(&si_out, &category, &installed))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Odczytuje pole `Validated By` z `pacman -Qi <pkg>` po instalacji — to
/// pacmanowa własna informacja o tym, jak pakiet został zweryfikowany
/// (`Signature`, `MD5 Sum`, `None`, ...). Runda 10: appka nie reimplementuje
/// własnej kryptografii weryfikacji pakietów (pacman już to robi zgodnie z
/// `SigLevel` skonfigurowanym w kontenerze) — zamiast tego czyni ten wynik
/// WIDOCZNYM i AUDYTOWALNYM, czego dotąd appka w ogóle nie robiła (ufaliśmy
/// repo BlackArch bez zapisywania, jak konkretny pakiet został zweryfikowany).
fn query_validation_method(name: &str) -> String {
    match exec_in_container(&["pacman", "-Qi", name]) {
        Ok(out) => out
            .lines()
            .find(|l| l.trim_start().starts_with("Validated By"))
            .and_then(|l| l.split(':').nth(1))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Unknown".to_string()),
        Err(_) => "Unknown".to_string(),
    }
}

#[tauri::command]
pub async fn install_package(window: Window, name: String) -> Result<(), String> {
    let session = auth::require_role(Role::Operator)?;

    if let Err(e) = check_allowlist(&name) {
        crate::audit::log_event(
            "store.install_denied",
            &session.username,
            serde_json::json!({ "package": name, "reason": &e }),
        );
        return Err(e);
    }

    let name_for_thread = name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        exec_in_container_streaming(&["pacman", "-S", "--noconfirm", &name_for_thread], &window, "install")
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Err(e) = result {
        crate::audit::log_event(
            "store.package_install_failed",
            &session.username,
            serde_json::json!({ "package": name, "error": &e }),
        );
        return Err(e);
    }

    // Pakiet jest już zainstalowany w tym miejscu — sprawdzamy JAK został
    // zweryfikowany (patrz `query_validation_method`) i zapisujemy to do
    // audytu niezależnie od ustawienia `block_unsigned_packages`. Dopiero
    // gdy operator/Lead świadomie włączył blokowanie niepodpisanych
    // pakietów, cofamy instalację przy negatywnym wyniku — pacman nie daje
    // niedestrukcyjnego sposobu sprawdzenia tego z góry (SigLevel jest
    // egzekwowany DOPIERO w trakcie samej instalacji), więc "zainstaluj,
    // sprawdź, ewentualnie cofnij" to jedyna praktyczna ścieżka bez
    // reimplementowania weryfikacji sygnatur pakietów samodzielnie.
    let name_for_check = name.clone();
    let validated_by = tauri::async_runtime::spawn_blocking(move || query_validation_method(&name_for_check))
        .await
        .unwrap_or_else(|_| "Unknown".to_string());

    let block_unsigned = crate::settings::get_app_settings().block_unsigned_packages;
    if block_unsigned && validated_by != "Signature" {
        let name_for_rollback = name.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            exec_in_container(&["pacman", "-R", "--noconfirm", &name_for_rollback])
        })
        .await;

        let reason = format!("Pakiet zweryfikowany jako '{validated_by}' (nie 'Signature') — zablokowano przez ustawienie 'Blokuj niepodpisane pakiety'.");
        crate::audit::log_event(
            "blackarch.install_blocked_unsigned",
            &session.username,
            serde_json::json!({ "package": name, "validated_by": validated_by }),
        );
        return Err(reason);
    }

    crate::audit::log_event(
        "store.package_installed",
        &session.username,
        serde_json::json!({ "package": name, "validated_by": validated_by }),
    );
    Ok(())
}

#[tauri::command]
pub async fn remove_package(window: Window, name: String) -> Result<(), String> {
    let session = auth::require_role(Role::Operator)?;

    let name_for_thread = name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        exec_in_container_streaming(&["pacman", "-R", "--noconfirm", &name_for_thread], &window, "remove")
    })
    .await
    .map_err(|e| e.to_string())?;

    match &result {
        Ok(_) => crate::audit::log_event(
            "store.package_removed",
            &session.username,
            serde_json::json!({ "package": name }),
        ),
        Err(e) => crate::audit::log_event(
            "store.package_remove_failed",
            &session.username,
            serde_json::json!({ "package": name, "error": e }),
        ),
    }

    result
}

// ---------------------------------------------------------------------------
// Parsery wyjścia pacmana
// ---------------------------------------------------------------------------

fn parse_ss_output(raw: &str, installed: &[String]) -> Vec<Package> {
    let mut out = Vec::new();
    let lines: Vec<&str> = raw.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let header = lines[i];
        if header.contains('/') {
            // repo/name version (group1 group2)
            let repo_name = header.split_whitespace().next().unwrap_or("");
            let name = repo_name.split('/').nth(1).unwrap_or(repo_name).to_string();
            let version = header.split_whitespace().nth(1).unwrap_or("").to_string();
            let category = repo_name.split('/').next().unwrap_or("").to_string();
            let description = lines.get(i + 1).map(|d| d.trim().to_string()).unwrap_or_default();

            out.push(Package {
                installed: installed.contains(&name),
                name,
                version,
                description,
                category,
            });
            i += 2;
        } else {
            i += 1;
        }
    }
    out
}

fn parse_si_output(raw: &str, category: &str, installed: &[String]) -> Vec<Package> {
    let mut out = Vec::new();
    let mut name = String::new();
    let mut version = String::new();
    let mut description = String::new();

    let flush = |name: &str, version: &str, description: &str, out: &mut Vec<Package>, installed: &[String]| {
        if !name.is_empty() {
            out.push(Package {
                name: name.to_string(),
                version: version.to_string(),
                description: description.to_string(),
                category: category.to_string(),
                installed: installed.contains(&name.to_string()),
            });
        }
    };

    for line in raw.lines() {
        if let Some(v) = line.strip_prefix("Name") {
            flush(&name, &version, &description, &mut out, installed);
            name = v.trim_start_matches([':', ' ']).trim().to_string();
            version.clear();
            description.clear();
        } else if let Some(v) = line.strip_prefix("Version") {
            version = v.trim_start_matches([':', ' ']).trim().to_string();
        } else if let Some(v) = line.strip_prefix("Description") {
            description = v.trim_start_matches([':', ' ']).trim().to_string();
        }
    }
    flush(&name, &version, &description, &mut out, installed);

    out
}

// ---------------------------------------------------------------------------
// Testy — parsery są kruche na zmiany formatu pacmana między wersjami,
// dlatego mają dedykowane testy jednostkowe z przykładowym wyjściem.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_SS_OUTPUT: &str = "\
blackarch-scanner/nmap 7.93-1 (blackarch-scanner)
    Free and open source utility for network discovery and security auditing
blackarch-exploitation/metasploit 6.2.14-1
    Advanced open-source platform for developing, testing, and using exploit code
";

    const SAMPLE_SI_OUTPUT: &str = "\
Repository      : blackarch-scanner
Name             : nmap
Version          : 7.93-1
Description      : Free and open source utility for network discovery
Architecture     : x86_64

Repository      : blackarch-scanner
Name             : gowitness
Version          : 2.4.2-1
Description      : Web screenshot utility using Chrome Headless
Architecture     : x86_64
";

    #[test]
    fn parses_ss_output_into_packages() {
        let installed = vec!["nmap".to_string()];
        let packages = parse_ss_output(SAMPLE_SS_OUTPUT, &installed);

        assert_eq!(packages.len(), 2);

        assert_eq!(packages[0].name, "nmap");
        assert_eq!(packages[0].version, "7.93-1");
        assert_eq!(packages[0].category, "blackarch-scanner");
        assert!(packages[0].description.starts_with("Free and open source"));
        assert!(packages[0].installed);

        assert_eq!(packages[1].name, "metasploit");
        assert_eq!(packages[1].category, "blackarch-exploitation");
        assert!(!packages[1].installed);
    }

    #[test]
    fn parses_ss_output_ignores_malformed_lines() {
        let packages = parse_ss_output("not a valid header\nrandom text\n", &[]);
        assert!(packages.is_empty());
    }

    #[test]
    fn parses_si_output_into_multiple_records() {
        let installed = vec!["gowitness".to_string()];
        let packages = parse_si_output(SAMPLE_SI_OUTPUT, "blackarch-scanner", &installed);

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "nmap");
        assert_eq!(packages[0].version, "7.93-1");
        assert!(!packages[0].installed);

        assert_eq!(packages[1].name, "gowitness");
        assert_eq!(packages[1].version, "2.4.2-1");
        assert_eq!(packages[1].category, "blackarch-scanner");
        assert!(packages[1].installed);
    }

    #[test]
    fn parses_si_output_empty_input() {
        assert!(parse_si_output("", "x", &[]).is_empty());
    }

    #[test]
    fn allowlist_default_allows_everything() {
        let allowlist = Allowlist::default();
        assert!(allowlist.allow_all);
        assert!(allowlist.packages.is_empty());
    }
}
