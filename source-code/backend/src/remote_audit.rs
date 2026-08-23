use serde::{Deserialize, Serialize};
use std::io::Write;
use std::net::UdpSocket;
use std::path::PathBuf;

/// Eksport/replikacja audit logu na zewnątrz — Rundzie 8 opisała wprost,
/// że łańcuch HMAC "NIE jest odporne na kogoś z pełnym dostępem do tego
/// samego konta systemowego" (patrz audit.rs). Jedyny sposób na realną
/// odporność na manipulację to trzymanie kopii GDZIEŚ INDZIEJ, poza
/// zasięgiem tego samego konta/maszyny — stąd ten moduł: każdy nowy wpis
/// audytu jest (best-effort, w tle) wysyłany dalej.
///
/// Dwa niezależne, opcjonalne kanały (można włączyć jeden, oba, albo
/// żaden — puste pola wyłączają dany kanał):
/// - **syslog** (RFC 5424 po UDP) — pasuje do klasycznych kolektorów
///   (rsyslog/syslog-ng) i większości SIEM-ów, które i tak mówią syslogiem.
/// - **webhook** (HTTP POST JSON) — pasuje do nowoczesnych SIEM-ów/API
///   z własnym formatem przyjmowania zdarzeń.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct RemoteAuditConfig {
    pub syslog_host: Option<String>,
    pub syslog_port: Option<u16>,
    pub webhook_url: Option<String>,
    pub webhook_token: Option<String>,
}

fn config_path() -> PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("penetration-mode").join("remote_audit.json")
}

#[tauri::command]
pub fn get_remote_audit_config() -> RemoteAuditConfig {
    std::fs::read_to_string(config_path()).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}

/// Tylko `Lead` — to jest kanał wypływu danych operacyjnych appki na
/// zewnątrz, ten sam poziom wrażliwości co allowlist/threat feed config.
#[tauri::command]
pub fn set_remote_audit_config(config: RemoteAuditConfig) -> Result<(), String> {
    crate::auth::require_role(crate::auth::Role::Lead)?;
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Minimalny, ręcznie sformatowany komunikat RFC 5424 — nie ciągniemy
/// osobnej biblioteki syslogowej tylko dla jednego, prostego formatu
/// tekstowego. Priorytet na sztywno `<134>` (facility=local0, severity=info)
/// — appka nie ma dziś pojęcia istotności per-zdarzenie na tym poziomie
/// (to inny wymiar niż severity threat feedu), więc nie zgadujemy.
fn format_syslog5424(app_name: &str, message: &str) -> String {
    let timestamp = chrono::Utc::now().to_rfc3339();
    let hostname = std::env::var("HOSTNAME").unwrap_or_else(|_| "localhost".to_string());
    format!("<134>1 {timestamp} {hostname} {app_name} - - - {message}")
}

fn send_syslog(host: &str, port: u16, payload: &str) -> Result<(), String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.set_write_timeout(Some(std::time::Duration::from_secs(3))).map_err(|e| e.to_string())?;
    let formatted = format_syslog5424("penetration-mode", payload);
    socket.send_to(formatted.as_bytes(), (host, port)).map_err(|e| e.to_string())?;
    Ok(())
}

fn send_webhook(url: &str, token: Option<&str>, payload: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.post(url).header("Content-Type", "application/json").body(payload.to_string());
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(t);
    }
    let response = request.send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("webhook odpowiedział HTTP {}", response.status()));
    }
    Ok(())
}

/// Wołane z `audit::log_event` PO udanym lokalnym zapisie — nigdy nie
/// blokuje ani nie warunkuje lokalnego zapisu (audit log lokalny musi
/// działać niezależnie od tego, czy sieć/SIEM akurat odpowiada). Uruchamia
/// wysyłkę w osobnym wątku (fire-and-forget) właśnie po to, żeby wolna/
/// niedostępna sieć nigdy nie spowalniała akcji operatora (np. instalacji
/// pakietu), która przy okazji loguje zdarzenie audytowe.
///
/// Błędy wysyłki lądują na stderr, nie w audit.jsonl — logowanie "nie
/// udało się zalogować" do tego samego logu byłoby dziwną pętlą, a appka
/// i tak nie ma dziś UI do przeglądania historii błędów replikacji (patrz
/// limitations w README).
pub fn replicate(event_json: &str) {
    let config = get_remote_audit_config();
    if config.syslog_host.is_none() && config.webhook_url.is_none() {
        return;
    }

    let event_json = event_json.to_string();
    std::thread::spawn(move || {
        if let (Some(host), Some(port)) = (config.syslog_host.as_deref(), config.syslog_port) {
            if let Err(e) = send_syslog(host, port, &event_json) {
                eprintln!("[remote_audit] syslog do {host}:{port} nie powiodło się: {e}");
            }
        }
        if let Some(url) = config.webhook_url.as_deref() {
            if let Err(e) = send_webhook(url, config.webhook_token.as_deref(), &event_json) {
                eprintln!("[remote_audit] webhook do {url} nie powiódł się: {e}");
            }
        }
    });
}
