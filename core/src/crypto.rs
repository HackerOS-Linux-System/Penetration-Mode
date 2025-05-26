use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, NewAead};

pub fn encrypt_output(data: &str) -> String {
    let key = Key::from_slice(b"an-example-very-secure-key-32-bytes!");
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(b"unique-nonce-12"); // W produkcyjnym kodzie użyj losowego nonce
    let ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();
    base64::encode(ciphertext)
}
