use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;
use std::time::Instant;

use crate::blackarch::CONTAINER_NAME;

#[derive(Serialize, Clone)]
pub struct NetworkSample {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub container_running: bool,
}

/// Wyjście `podman stats --format json` to tablica obiektów; interesują nas
/// pola NetInput/NetOutput (nazwy pól bywają różne między wersjami podmana —
/// stąd parsowanie przez `serde_json::Value` zamiast sztywnego structu, żeby
/// nie wywalać się na drobnej zmianie schematu).
#[tauri::command]
pub fn get_network_stats() -> NetworkSample {
    let output = Command::new("podman")
        .args(["stats", "--no-stream", "--format", "json", CONTAINER_NAME])
        .output();

    let Ok(output) = output else {
        return NetworkSample { rx_bytes: 0, tx_bytes: 0, container_running: false };
    };
    if !output.status.success() {
        return NetworkSample { rx_bytes: 0, tx_bytes: 0, container_running: false };
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let parsed: Result<Vec<Value>, _> = serde_json::from_str(&raw);

    let Ok(entries) = parsed else {
        return NetworkSample { rx_bytes: 0, tx_bytes: 0, container_running: false };
    };
    let Some(entry) = entries.first() else {
        return NetworkSample { rx_bytes: 0, tx_bytes: 0, container_running: false };
    };

    let rx = entry.get("NetInput").or_else(|| entry.get("net_input")).and_then(Value::as_u64).unwrap_or(0);
    let tx = entry.get("NetOutput").or_else(|| entry.get("net_output")).and_then(Value::as_u64).unwrap_or(0);

    NetworkSample { rx_bytes: rx, tx_bytes: tx, container_running: true }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThreatEntry {
    pub id: String,
    pub severity: String, // "high" | "medium" | "low"
    pub title: String,
    pub description: String,
}

/// Runda 10: konfigurowalny adapter kształtu odpowiedzi. Dotąd appka na
/// sztywno oczekiwała, że `source_url` zwróci JSON będący WPROST tablicą
/// `{id, severity, title, description}` — nierealistyczne założenie dla
/// prawdziwego wewnętrznego API firmy, które niemal na pewno ma inny
/// kształt (opakowanie w kopertę, inne nazwy pól, inne słownictwo
/// severity np. "P1"/"sev1" zamiast "high"). Wszystkie pola tego adaptera
/// mają sensowne domyślne wartości (patrz `map_response_to_entries`),
/// więc pusta konfiguracja wciąż działa dla API, które już zwraca nasz
/// natywny kształt — adapter trzeba świadomie wypełnić tylko wtedy, gdy
/// realne API firmy różni się.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct ThreatFeedConfig {
    /// Puste = źródło lokalne (plik obok configu). Ustaw na URL wewnętrznego
    /// API firmy (SIEM/CVE feed), żeby appka zaczęła pytać o realne dane.
    pub source_url: Option<String>,
    /// Nagłówek `Authorization: Bearer <token>` — prawie każde wewnętrzne
    /// API wymaga jakiejś autoryzacji.
    pub api_token: Option<String>,
    /// Ścieżka (kropkowa, np. `"data.items"`) do tablicy zagrożeń wewnątrz
    /// odpowiedzi JSON. Puste/`None` = odpowiedź to WPROST tablica.
    /// Obsługuje tylko klucze obiektów rozdzielone kropką (bez indeksów
    /// tablic/wildcardów) — świadomie prosty podzbiór JSONPath, nie pełny
    /// silnik, żeby nie ciągnąć kolejnej zależności dla przypadku, który w
    /// większości realnych API i tak sprowadza się do "rozpakuj kopertę".
    pub items_path: Option<String>,
    /// Nazwy pól w pojedynczym obiekcie zagrożenia w odpowiedzi API —
    /// domyślnie `"id"`/`"severity"`/`"title"`/`"description"` (czyli
    /// nasz natywny kształt), nadpisywalne gdy API firmy nazywa je inaczej.
    pub field_id: Option<String>,
    pub field_severity: Option<String>,
    pub field_title: Option<String>,
    pub field_description: Option<String>,
    /// Mapowanie wartości severity z API firmy (klucz, lowercase) na nasze
    /// słownictwo `"high"/"medium"/"low"` (wartość). Nierozpoznane wartości
    /// spoza mapy przechodzą przez wbudowane, rozsądne domyślne dopasowanie
    /// (patrz `normalize_severity`) zamiast twardego błędu.
    pub severity_map: Option<HashMap<String, String>>,
}

fn threat_feed_config_path() -> std::path::PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("penetration-mode").join("threat_feed.json")
}

#[tauri::command]
pub fn get_threat_feed_config() -> ThreatFeedConfig {
    std::fs::read_to_string(threat_feed_config_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_threat_feed_config(config: ThreatFeedConfig) -> Result<(), String> {
    crate::auth::require_role(crate::auth::Role::Lead)?;
    let path = threat_feed_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);
const RETRY_ATTEMPTS: u32 = 3;

/// Odpytuje `source_url` przez HTTP GET raz i zwraca surowy JSON — parsowanie
/// do `ThreatEntry` jest teraz osobnym krokiem ([`map_response_to_entries`]),
/// bo adapter kształtu odpowiedzi (Runda 10) musi najpierw zobaczyć pełną
/// strukturę odpowiedzi, zanim wie, gdzie w niej szukać tablicy zagrożeń.
fn fetch_raw_json(url: &str, api_token: Option<&str>) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| format!("Nie udało się zbudować klienta HTTP: {e}"))?;

    let mut request = client.get(url).header("Accept", "application/json");
    if let Some(token) = api_token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }

    let response = request.send().map_err(|e| {
        if e.is_timeout() {
            format!("Threat feed ({url}) nie odpowiedział w ciągu {}s (timeout).", HTTP_TIMEOUT.as_secs())
        } else if e.is_connect() {
            format!("Nie udało się połączyć z threat feedem ({url}): {e}")
        } else {
            format!("Błąd zapytania do threat feedu ({url}): {e}")
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        let body_preview: String = response.text().unwrap_or_default().chars().take(200).collect();
        return Err(format!("Threat feed ({url}) odpowiedział błędem HTTP {status}: {body_preview}"));
    }

    response.json::<Value>().map_err(|e| format!("Odpowiedź z threat feedu ({url}) nie jest poprawnym JSON-em: {e}"))
}

/// Do trzech prób z rosnącym opóźnieniem (0s / 1s / 2s) — przejściowe błędy
/// sieci (chwilowy blip, restart load balancera po drugiej stronie) nie
/// powinny od razu psuć powiadomień o zagrożeniach wysokiego ryzyka, skoro
/// kolejna próba sekundę później najpewniej by się powiodła.
fn fetch_with_retry(url: &str, api_token: Option<&str>) -> Result<Value, String> {
    let mut last_err = String::new();
    for attempt in 0..RETRY_ATTEMPTS {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_secs(u64::from(attempt)));
        }
        match fetch_raw_json(url, api_token) {
            Ok(v) => return Ok(v),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

fn navigate_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    if path.is_empty() {
        return Some(value);
    }
    path.split('.').try_fold(value, |current, segment| current.get(segment))
}

/// Rozpoznaje severity z dowolnego słownictwa API firmy. Kolejność: (1)
/// jawna mapa operatora (`severity_map`), (2) wbudowane rozsądne aliasy
/// najczęstszych konwencji (P1-P3, sevN, critical/warning/info), (3)
/// bezpieczny środek ("medium") dla czegokolwiek nierozpoznanego —
/// świadomie NIE eskalujemy nieznanej wartości do "high" (fałszywy alarm
/// budzący dźwiękiem o 3 w nocy) ani nie chowamy do "low" (przeoczone
/// realne zagrożenie); "medium" jest neutralnym środkiem.
fn normalize_severity(raw: &str, map: &Option<HashMap<String, String>>) -> String {
    let lower = raw.to_lowercase();
    if let Some(m) = map {
        if let Some(mapped) = m.get(&lower).or_else(|| m.get(raw)) {
            return mapped.to_lowercase();
        }
    }
    match lower.as_str() {
        "high" | "critical" | "p1" | "sev1" | "severe" => "high".to_string(),
        "medium" | "warning" | "p2" | "sev2" | "moderate" => "medium".to_string(),
        "low" | "info" | "informational" | "p3" | "sev3" | "p4" | "sev4" => "low".to_string(),
        _ => "medium".to_string(),
    }
}

fn map_response_to_entries(raw: &Value, config: &ThreatFeedConfig) -> Result<Vec<ThreatEntry>, String> {
    let items_path = config.items_path.as_deref().unwrap_or("");
    let items = navigate_path(raw, items_path)
        .ok_or_else(|| format!("Nie znaleziono ścieżki '{items_path}' w odpowiedzi threat feedu — sprawdź 'items_path' w konfiguracji."))?;
    let array = items
        .as_array()
        .ok_or_else(|| format!("Wartość pod ścieżką '{items_path}' nie jest tablicą JSON — sprawdź 'items_path' w konfiguracji."))?;

    let field_id = config.field_id.as_deref().unwrap_or("id");
    let field_severity = config.field_severity.as_deref().unwrap_or("severity");
    let field_title = config.field_title.as_deref().unwrap_or("title");
    let field_description = config.field_description.as_deref().unwrap_or("description");

    Ok(array
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let id = item.get(field_id).and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("item-{i}"));
            let severity_raw = item.get(field_severity).and_then(Value::as_str).unwrap_or("medium");
            let severity = normalize_severity(severity_raw, &config.severity_map);
            let title = item.get(field_title).and_then(Value::as_str).unwrap_or("(brak tytułu)").to_string();
            let description = item.get(field_description).and_then(Value::as_str).unwrap_or("").to_string();
            ThreatEntry { id, severity, title, description }
        })
        .collect())
}

#[derive(Clone)]
struct CachedFeed {
    entries: Vec<ThreatEntry>,
    fetched_at: Instant,
}

/// Cache ostatniego udanego pobrania — dwie role: (1) throttling, żeby
/// tło i ewentualne równoległe zapytania frontendu nie waliły w API
/// firmy częściej niż potrzeba, (2) fallback "stary, ale jest" gdy świeże
/// pobranie akurat zawiedzie (przejściowy błąd sieci nie powinien
/// wyczyścić panelu Analytics/Activity do zera).
static CACHE: Lazy<Mutex<Option<CachedFeed>>> = Lazy::new(|| Mutex::new(None));
static LAST_ERROR: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

fn refresh_now(config: &ThreatFeedConfig) -> Result<Vec<ThreatEntry>, String> {
    let Some(url) = config.source_url.as_deref() else { return Ok(vec![]) };

    match fetch_with_retry(url, config.api_token.as_deref()).and_then(|raw| map_response_to_entries(&raw, config)) {
        Ok(entries) => {
            *CACHE.lock().unwrap() = Some(CachedFeed { entries: entries.clone(), fetched_at: Instant::now() });
            *LAST_ERROR.lock().unwrap() = None;
            Ok(entries)
        }
        Err(e) => {
            *LAST_ERROR.lock().unwrap() = Some(e.clone());
            if let Some(cached) = CACHE.lock().unwrap().clone() {
                eprintln!("[threat_feed] odświeżenie nie powiodło się ({e}) — zwracam dane z cache sprzed {}s", cached.fetched_at.elapsed().as_secs());
                return Ok(cached.entries);
            }
            Err(e)
        }
    }
}

/// Pętla w tle odświeżająca cache co 60s niezależnie od tego, czy/kiedy
/// frontend akurat odpytuje `get_threat_feed()` — uruchamiana raz przy
/// starcie appki (patrz `lib.rs`'s `.setup()`). Dzięki temu powiadomienia
/// o zagrożeniach wysokiego ryzyka (`lib/threatWatcher.ts`) mają świeże
/// dane niezależnie od tego, czy operator akurat patrzy na Workspace, czy
/// na inny widok.
pub fn spawn_background_refresh() {
    std::thread::spawn(|| loop {
        let config = get_threat_feed_config();
        if config.source_url.is_some() {
            let _ = refresh_now(&config);
        }
        std::thread::sleep(std::time::Duration::from_secs(60));
    });
}

/// Zwraca listę "zagrożeń" do panelu Analytics/Activity oraz do
/// powiadomień o zdarzeniach wysokiego ryzyka. Gdy `source_url` jest
/// ustawiony, preferuje cache (świeżony w tle — patrz
/// `spawn_background_refresh`) i odpytuje synchronicznie tylko gdy cache
/// jest jeszcze zupełnie pusty (np. appka właśnie wystartowała). Gdy brak
/// `source_url`, czyta z lokalnego pliku — jeśli plik nie istnieje, zwraca
/// pustą listę zamiast danych zmyślonych w kodzie.
#[tauri::command]
pub fn get_threat_feed() -> Result<Vec<ThreatEntry>, String> {
    let config = get_threat_feed_config();

    if config.source_url.is_none() {
        let path = dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("penetration-mode").join("threats.json");
        return match std::fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("threats.json jest uszkodzony: {e}")),
            Err(_) => Ok(vec![]),
        };
    }

    if let Some(cached) = CACHE.lock().unwrap().clone() {
        return Ok(cached.entries);
    }
    refresh_now(&config)
}

#[derive(Serialize)]
pub struct ThreatFeedStatus {
    pub configured: bool,
    pub cached_age_secs: Option<u64>,
    pub last_error: Option<String>,
}

/// Do małego wskaźnika w UI ("dane sprzed 42s" / "błąd: ..."), żeby
/// operator wiedział, czy panel Activity/toasty pokazują świeże dane, czy
/// ostatnie znane (bo threat feed akurat nie odpowiada) — bez tego
/// fallback na cache w `get_threat_feed()` byłby niewidoczny/mylący.
#[tauri::command]
pub fn get_threat_feed_status() -> ThreatFeedStatus {
    let cached = CACHE.lock().unwrap().clone();
    ThreatFeedStatus {
        configured: get_threat_feed_config().source_url.is_some(),
        cached_age_secs: cached.map(|c| c.fetched_at.elapsed().as_secs()),
        last_error: LAST_ERROR.lock().unwrap().clone(),
    }
}
