use hmac::{Hmac, Mac};
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::Value;
use sha2::Sha256;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

static LOG_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// Hash "zerowego" (nieistniejącego) poprzednika — pierwszy wpis w
/// łańcuchu ma `prev_hash` równy temu stałemu ciągowi, dokładnie jak
/// "genesis block" w prostym łańcuchu bloków.
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000000000000000";

fn audit_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("penetration-mode")
}

/// `pub(crate)` (nie tylko prywatne) tak żeby `logs.rs` mogło tailować
/// ten sam plik dla źródła `LogSource::Audit` w drugiej konsoli, bez
/// duplikowania logiki ścieżki.
pub(crate) fn log_file_path() -> PathBuf {
    audit_dir().join("audit.jsonl")
}

fn key_file_path() -> PathBuf {
    audit_dir().join("audit.key")
}

/// Klucz HMAC dla łańcucha integralności audit logu — wygenerowany raz
/// (32 losowe bajty z dwóch UUID v4) i zapisany obok `audit.jsonl` z
/// uprawnieniami ograniczonymi do bieżącego użytkownika: `chmod 0600` na
/// Uniksie, `icacls` (patrz [`restrict_key_permissions_windows`]) na
/// Windows.
///
/// **Uczciwie o granicach tego mechanizmu:** to podnosi poprzeczkę
/// (wykrywa przypadkową korupcję i naiwną edycję pliku audit.jsonl "z
/// palca"), ale NIE jest kryptograficznie odporne na kogoś, kto ma pełny
/// dostęp do tego samego konta systemowego, na którym appka działa —
/// taki ktoś może odczytać `audit.key` i przeliczyć cały łańcuch od
/// nowa. Prawdziwa odporność na manipulację wymagałaby zewnętrznego,
/// tylko-do-zapisu miejsca przechowywania (zdalny syslog/SIEM, WORM
/// storage) — poza zakresem lokalnej appki desktopowej.
static KEY: Lazy<Vec<u8>> = Lazy::new(load_or_create_key);

/// Na Windows nie ma w `std` przenośnego odpowiednika `chmod` — ACL to
/// zupełnie inny model uprawnień niż uniksowe bity rwx. Zamiast ciągnąć
/// ciężką zależność (`windows`/`windows-sys` + wywołania Win32 ACL API)
/// tylko dla tego jednego pliku, wołamy systemowe narzędzie `icacls`:
/// usuwamy dziedziczone uprawnienia (`/inheritance:r`) i nadajemy pełną
/// kontrolę wyłącznie bieżącemu użytkownikowi (`/grant:r <user>:F`).
/// Best-effort — błąd `icacls` (np. brak narzędzia na bardzo starym
/// Windows, albo appka działa jako użytkownik bez uprawnień do zmiany
/// ACL własnego pliku) jest cicho ignorowany, dokładnie jak przy
/// analogicznym `chmod` na Uniksie: to wzmocnienie obrony w głąb, a nie
/// warunek działania appki.
#[cfg(windows)]
fn restrict_key_permissions_windows(path: &std::path::Path) {
    let Ok(username) = std::env::var("USERNAME") else { return };
    if username.is_empty() {
        return;
    }
    let _ = std::process::Command::new("icacls")
        .arg(path)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(format!("{username}:F"))
        .output();
}

fn load_or_create_key() -> Vec<u8> {
    let path = key_file_path();
    if let Ok(raw) = fs::read(&path) {
        if raw.len() >= 16 {
            return raw;
        }
    }

    let mut key = Vec::with_capacity(32);
    key.extend_from_slice(Uuid::new_v4().as_bytes());
    key.extend_from_slice(Uuid::new_v4().as_bytes());

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if fs::write(&path, &key).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(&path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o600);
                let _ = fs::set_permissions(&path, perms);
            }
        }
        #[cfg(windows)]
        restrict_key_permissions_windows(&path);
    }
    key
}


fn compute_hmac_hex(input: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(&KEY).expect("HMAC-SHA256 przyjmuje klucz dowolnej długości");
    mac.update(input.as_bytes());
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

/// Deterministyczny materiał do podpisania — kolejność/format pól musi
/// być identyczna przy zapisie i przy weryfikacji ([`verify_audit_log`]).
/// `details_json` to `serde_json::to_string` na `Value`: domyślnie (bez
/// feature'a `preserve_order`) `serde_json::Value::Object` jest oparty na
/// `BTreeMap`, więc serializacja jest deterministyczna (klucze zawsze w
/// tej samej, posortowanej kolejności) niezależnie od tego, w jakiej
/// kolejności wywołujący zbudował `serde_json::json!({...})`.
fn mac_input(seq: u64, timestamp: &str, operator: &str, event: &str, details_json: &str, prev_hash: &str) -> String {
    format!("{seq}|{timestamp}|{operator}|{event}|{details_json}|{prev_hash}")
}

struct ChainState {
    next_seq: u64,
    prev_hash: String,
}

/// Odtwarza stan łańcucha (następny numer sekwencyjny + hash ostatniego
/// wpisu) z istniejącego pliku przy starcie procesu, żeby dopisywanie po
/// restarcie appki kontynuowało ten sam łańcuch zamiast zaczynać nowy.
fn load_chain_state() -> ChainState {
    let path = log_file_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return ChainState { next_seq: 0, prev_hash: GENESIS_HASH.to_string() };
    };
    for line in raw.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if let (Some(seq), Some(hash)) = (v.get("seq").and_then(Value::as_u64), v.get("hash").and_then(Value::as_str)) {
            return ChainState { next_seq: seq + 1, prev_hash: hash.to_string() };
        }
        // Ostatnia linia jest sprzed wprowadzenia łańcucha (Runda 8, brak
        // `seq`/`hash`) — zaczynamy nowy łańcuch od zera, "wpięty" za
        // istniejącą, niepodpisaną historią (ta zostaje czytelna, tylko
        // nieobjęta weryfikacją integralności — patrz `unchained_entries`
        // w [`verify_audit_log`]).
        break;
    }
    ChainState { next_seq: 0, prev_hash: GENESIS_HASH.to_string() }
}

static CHAIN_STATE: Lazy<Mutex<ChainState>> = Lazy::new(|| Mutex::new(load_chain_state()));

#[derive(Serialize)]
struct AuditEntryOnDisk<'a> {
    seq: u64,
    timestamp: &'a str,
    event: &'a str,
    operator: &'a str,
    details: &'a Value,
    prev_hash: &'a str,
    hash: &'a str,
}

/// Dopisuje jedno zdarzenie do logu audytowego, podpisane HMAC-SHA256
/// wpiętym w łańcuch poprzednich wpisów. Nie zwraca błędu do
/// wywołującego — logowanie nie powinno nigdy blokować akcji operatora
/// (np. instalacji pakietu), ale błąd zapisu jest odnotowywany na stderr,
/// żeby nie zginął po cichu.
pub fn log_event(event: &str, operator: &str, details: Value) {
    let timestamp = chrono::Utc::now().to_rfc3339();
    let details_json = serde_json::to_string(&details).unwrap_or_else(|_| "null".to_string());

    let result = (|| -> std::io::Result<String> {
        let path = log_file_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let _guard = LOG_LOCK.lock().unwrap();
        let mut chain = CHAIN_STATE.lock().unwrap();

        let seq = chain.next_seq;
        let prev_hash = chain.prev_hash.clone();
        let hash = compute_hmac_hex(&mac_input(seq, &timestamp, operator, event, &details_json, &prev_hash));

        let entry = AuditEntryOnDisk {
            seq,
            timestamp: &timestamp,
            event,
            operator,
            details: &details,
            prev_hash: &prev_hash,
            hash: &hash,
        };
        let line = serde_json::to_string(&entry).unwrap();

        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        writeln!(file, "{line}")?;

        chain.next_seq = seq + 1;
        chain.prev_hash = hash;
        Ok(line)
    })();

    match result {
        Ok(line) => crate::remote_audit::replicate(&line),
        Err(e) => eprintln!("[audit] nie udało się zapisać wpisu ({event}): {e}"),
    }
}

/// Notatka przypięta do wpisu audytu (np. "to był autoryzowany test,
/// JIRA-123") — celowo NIE modyfikuje oryginalnego wpisu o danym `seq`
/// (to złamałoby łańcuch HMAC, patrz `verify_audit_log`). Zamiast tego
/// notatka to po prostu NOWE zdarzenie audytowe (`audit.note_added`)
/// odwołujące się do docelowego `seq` w `details` — zero nowego
/// magazynu danych, zero ryzyka naruszenia integralności przez
/// konstrukcję, a sama notatka jest tak samo podpisana/audytowalna jak
/// każde inne zdarzenie. Frontend (Activity.tsx) grupuje po
/// `details.target_seq`, żeby wyświetlić notatki pod wpisem, którego dotyczą.
#[tauri::command]
pub fn add_audit_note(target_seq: u64, note: String) -> Result<(), String> {
    let session = crate::auth::require_role(crate::auth::Role::Auditor)?; // każdy zalogowany
    let trimmed = note.trim();
    if trimmed.is_empty() {
        return Err("Notatka nie może być pusta.".to_string());
    }
    if trimmed.chars().count() > 2000 {
        return Err("Notatka jest za długa (limit 2000 znaków).".to_string());
    }
    log_event("audit.note_added", &session.username, serde_json::json!({ "target_seq": target_seq, "note": trimmed }));
    Ok(())
}

#[derive(Serialize, Clone)]
pub struct AuditRecord {
    pub timestamp: String,
    pub event: String,
    pub operator: String,
    pub details: Value,
    /// `None` dla wpisów sprzed wprowadzenia łańcucha integralności
    /// (Runda 8) — te wciąż się wyświetlają, tylko bez numeru sekwencji.
    pub seq: Option<u64>,
}

/// Zwraca ostatnie `limit` wpisów (najnowsze pierwsze) do wyświetlenia w UI
/// (np. panel "Audit Log" w Analytics/Activity — patrz frontend).
#[tauri::command]
pub fn read_audit_log(limit: Option<usize>) -> Result<Vec<AuditRecord>, String> {
    let path = log_file_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut records: Vec<AuditRecord> = raw
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|v| {
            Some(AuditRecord {
                timestamp: v.get("timestamp")?.as_str()?.to_string(),
                event: v.get("event")?.as_str()?.to_string(),
                operator: v.get("operator")?.as_str()?.to_string(),
                details: v.get("details").cloned().unwrap_or(Value::Null),
                seq: v.get("seq").and_then(Value::as_u64),
            })
        })
        .collect();

    records.reverse();
    if let Some(n) = limit {
        records.truncate(n);
    }
    Ok(records)
}

#[derive(Serialize)]
pub struct AuditIntegrityReport {
    pub total_entries: usize,
    pub verified_entries: usize,
    /// Wpisy sprzed wprowadzenia łańcucha (Runda 8) — policzone osobno,
    /// nie liczą się ani jako "zweryfikowane", ani jako "sfałszowane".
    pub unchained_entries: usize,
    /// Numer sekwencyjny pierwszego wpisu, którego hash/prev_hash się nie
    /// zgadza z przeliczonym łańcuchem — `None` gdy wszystko się zgadza.
    pub tampered_at_seq: Option<u64>,
    pub ok: bool,
}

/// Przelicza cały łańcuch HMAC od zera i porównuje z wartościami zapisanymi
/// w pliku — wykrywa dopisane "po fakcie" zmiany treści dowolnego wpisu
/// (bo zmiana treści zmienia jego hash, co łamie `prev_hash` następnego),
/// usunięte wpisy w środku (dziura w `seq` i niezgodny `prev_hash`) oraz
/// wpisy dopisane na końcu bez przeliczenia łańcucha. Patrz ograniczenia
/// tego mechanizmu w komentarzu przy [`KEY`].
#[tauri::command]
pub fn verify_audit_log() -> Result<AuditIntegrityReport, String> {
    let path = log_file_path();
    if !path.exists() {
        return Ok(AuditIntegrityReport {
            total_entries: 0,
            verified_entries: 0,
            unchained_entries: 0,
            tampered_at_seq: None,
            ok: true,
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let mut expected_prev = GENESIS_HASH.to_string();
    let mut total = 0usize;
    let mut verified = 0usize;
    let mut unchained = 0usize;
    let mut tampered_at_seq: Option<u64> = None;

    for line in raw.lines() {
        total += 1;
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            // Linia w ogóle nie parsuje się jako JSON — jednoznaczny znak
            // uszkodzenia/manipulacji pliku. Zliczamy jako "niezgodny wpis"
            // bez numeru sekwencji (nie da się go odzyskać z zepsutej linii).
            unchained += 1;
            continue;
        };
        let (Some(seq), Some(timestamp), Some(event), Some(operator), Some(prev_hash), Some(hash)) = (
            v.get("seq").and_then(Value::as_u64),
            v.get("timestamp").and_then(Value::as_str),
            v.get("event").and_then(Value::as_str),
            v.get("operator").and_then(Value::as_str),
            v.get("prev_hash").and_then(Value::as_str),
            v.get("hash").and_then(Value::as_str),
        ) else {
            // Wpis sprzed wprowadzenia łańcucha (Runda 8) — poza zakresem
            // weryfikacji, ale sam w sobie nie jest dowodem manipulacji.
            unchained += 1;
            continue;
        };

        let details = v.get("details").cloned().unwrap_or(Value::Null);
        let details_json = serde_json::to_string(&details).unwrap_or_else(|_| "null".to_string());
        let expected_hash = compute_hmac_hex(&mac_input(seq, timestamp, operator, event, &details_json, prev_hash));

        if prev_hash != expected_prev || hash != expected_hash {
            if tampered_at_seq.is_none() {
                tampered_at_seq = Some(seq);
            }
        } else {
            verified += 1;
        }
        expected_prev = hash.to_string();
    }

    Ok(AuditIntegrityReport {
        total_entries: total,
        verified_entries: verified,
        unchained_entries: unchained,
        tampered_at_seq,
        ok: tampered_at_seq.is_none(),
    })
}
