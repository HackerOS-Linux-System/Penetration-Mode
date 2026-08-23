use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Snippety/makra poleceń — zapisane sekwencje do szybkiego wstawienia w
/// terminal (nie automatycznego uruchomienia, patrz komentarz przy
/// [`Snippet`] niżej). Persystencja identyczna jak `settings.rs` (mały
/// JSON w katalogu konfiguracyjnym), świadomie bez powiązania z
/// konkretnym operatorem/rolą — to lokalna appka na jedno konto systemowe
/// na raz, więc snippety są "moje na tej maszynie", jak reszta ustawień.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    pub label: String,
    /// Treść wpisywana do terminala BEZ automatycznego Entera — patrz
    /// `pty_write` we frontendzie: operator zawsze widzi co się wpisało i
    /// sam decyduje, kiedy nacisnąć Enter. Świadoma decyzja bezpieczeństwa:
    /// snippet, który sam wysyła Enter, mógłby przypadkiem odpalić
    /// destrukcyjną komendę bez świadomego potwierdzenia (np. jeśli ktoś
    /// kliknie zły snippet).
    pub command: String,
}

fn snippets_path() -> PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("penetration-mode").join("snippets.json")
}

fn default_snippets() -> Vec<Snippet> {
    vec![
        Snippet { id: "nmap-quick".to_string(), label: "nmap: szybki skan".to_string(), command: "nmap -T4 -F ".to_string() },
        Snippet {
            id: "nmap-full".to_string(),
            label: "nmap: pełny skan portów".to_string(),
            command: "nmap -p- -T4 -A -oN scan.txt ".to_string(),
        },
        Snippet { id: "python-http".to_string(), label: "prosty serwer HTTP".to_string(), command: "python3 -m http.server 8000".to_string() },
    ]
}

#[tauri::command]
pub fn get_snippets() -> Vec<Snippet> {
    std::fs::read_to_string(snippets_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(default_snippets)
}

#[tauri::command]
pub fn set_snippets(snippets: Vec<Snippet>) -> Result<(), String> {
    let path = snippets_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(&snippets).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
