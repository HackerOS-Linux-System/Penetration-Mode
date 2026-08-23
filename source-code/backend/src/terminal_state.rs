use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Migawka jednego taba terminala do zachowania między restartami appki.
/// `scrollback` to output `SerializeAddon.serialize()` z xterm.js po
/// stronie frontendu (patrz `components/TerminalTabs.tsx`) — czysty
/// strumień ANSI, który po prostu wypisujemy z powrotem do świeżego
/// xterm-a przy starcie, żeby odtworzyć wygląd bufora sprzed zamknięcia.
/// Backend traktuje tę treść jako nieprzezroczysty tekst — nie próbuje
/// jej parsować/rozumieć, tylko zapisuje i oddaje z powrotem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalTabSnapshot {
    pub id: String,
    pub label: String,
    pub scrollback: String,
}

/// Twardy limit na tab, żeby jeden zapomniany `cat bigfile.bin` w
/// terminalu nie rozdął pliku stanu do setek megabajtów — przycinamy do
/// ostatnich N bajtów (koniec strumienia = najnowsza, najbardziej
/// przydatna historia).
const MAX_SCROLLBACK_BYTES: usize = 2_000_000;
const MAX_TABS: usize = 12;

fn terminal_state_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("penetration-mode")
        .join("terminal_tabs.json")
}

fn truncate_to_tail(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    // Cięcie po granicy znaku UTF-8 (nie bajtu), żeby nie rozerwać
    // wielobajtowego znaku w połowie i nie wywalić się na from_utf8.
    let start = s.len() - max_bytes;
    let safe_start = (start..s.len()).find(|&i| s.is_char_boundary(i)).unwrap_or(s.len());
    s[safe_start..].to_string()
}

#[tauri::command]
pub fn save_terminal_tabs(tabs: Vec<TerminalTabSnapshot>) -> Result<(), String> {
    let path = terminal_state_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let trimmed: Vec<TerminalTabSnapshot> = tabs
        .into_iter()
        .take(MAX_TABS)
        .map(|t| TerminalTabSnapshot {
            id: t.id,
            label: t.label,
            scrollback: truncate_to_tail(&t.scrollback, MAX_SCROLLBACK_BYTES),
        })
        .collect();

    std::fs::write(&path, serde_json::to_vec(&trimmed).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_terminal_tabs() -> Vec<TerminalTabSnapshot> {
    let path = terminal_state_path();
    std::fs::read_to_string(&path).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}
