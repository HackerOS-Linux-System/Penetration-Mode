use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit, Nonce};
use base64::engine::general_purpose;
use rand::rngs::OsRng;

pub fn encrypt_output(data: &str, session_id: &str) -> String {
    // Generowanie klucza na podstawie session_id (musi mieć 32 bajty dla Aes256Gcm)
    let key_str = format!("penmode-key-{}", session_id);
    let key_bytes = key_str.as_bytes();
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes[0..32]); // Klucz musi mieć dokładnie 32 bajty
    let cipher = Aes256Gcm::new(&key);

    // Generowanie losowego nonce (12 bajtów dla Aes256Gcm)
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    // Szyfrowanie danych
    let ciphertext = cipher
        .encrypt(&nonce, data.as_bytes())
        .expect("Szyfrowanie nie powiodło się");

    // Łączenie nonce i ciphertext
    let mut result = nonce.to_vec();
    result.extend(ciphertext);

    // Kodowanie do base64
    general_purpose::STANDARD.encode(&result)
}
