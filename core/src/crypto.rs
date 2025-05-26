use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, NewAead};
use rand::Rng;

pub fn encrypt_output(data: &str, session_id: &str) -> String {
    let key = Key::from_slice(format!("penmode-key-{}", session_id)[..32].as_bytes());
    let cipher = Aes256Gcm::new(key);
    let nonce_bytes = rand::thread_rng().gen::<[u8; 12]>();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();
    let mut result = nonce_bytes.to_vec();
    result.extend(ciphertext);
    base64::encode(result)
}
