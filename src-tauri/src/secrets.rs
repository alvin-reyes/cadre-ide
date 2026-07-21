//! SecretsStore (§3.6): all secrets live in the OS keychain via the `keyring`
//! crate — never plaintext, never committed. v0.0 stores the Anthropic model
//! key (asked once, reused silently); DB passwords and other providers reuse
//! the same store later.
//!
//! The store logic sits behind a `SecretBackend` trait so it is testable
//! without touching (or prompting) the real OS keychain.

use keyring::{Entry, Error as KeyringError};

/// Keychain service namespace for all cadre secrets.
const SERVICE: &str = "dev.cadre.ide";

/// A place secrets are kept, keyed by name.
pub trait SecretBackend: Send + Sync {
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

/// Production backend: the OS keychain.
pub struct KeyringBackend;

impl SecretBackend for KeyringBackend {
    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        Entry::new(SERVICE, key)
            .map_err(|e| e.to_string())?
            .set_password(value)
            .map_err(|e| e.to_string())
    }

    fn get(&self, key: &str) -> Result<Option<String>, String> {
        match Entry::new(SERVICE, key)
            .map_err(|e| e.to_string())?
            .get_password()
        {
            Ok(p) => Ok(Some(p)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        match Entry::new(SERVICE, key)
            .map_err(|e| e.to_string())?
            .delete_credential()
        {
            Ok(()) => Ok(()),
            Err(KeyringError::NoEntry) => Ok(()), // idempotent
            Err(e) => Err(e.to_string()),
        }
    }
}

/// The store logic over any backend.
pub struct SecretsStore<B: SecretBackend> {
    backend: B,
}

impl<B: SecretBackend> SecretsStore<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    pub fn set_secret(&self, key: &str, value: &str) -> Result<(), String> {
        self.backend.set(key, value)
    }

    pub fn get_secret(&self, key: &str) -> Result<Option<String>, String> {
        self.backend.get(key)
    }

    pub fn has_secret(&self, key: &str) -> Result<bool, String> {
        Ok(self.get_secret(key)?.is_some())
    }

    pub fn delete_secret(&self, key: &str) -> Result<(), String> {
        self.backend.delete(key)
    }
}

fn keyring_store() -> SecretsStore<KeyringBackend> {
    SecretsStore::new(KeyringBackend)
}

// --- Tauri commands (thin wrappers over the real keychain) ---

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    keyring_store().set_secret(&key, &value)
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    keyring_store().get_secret(&key)
}

#[tauri::command]
pub fn secret_has(key: String) -> Result<bool, String> {
    keyring_store().has_secret(&key)
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    keyring_store().delete_secret(&key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// In-memory backend that behaves like a real keyed store (unlike keyring's
    /// per-Entry mock), so the store's set/get/delete semantics are testable.
    struct MemoryBackend {
        map: Mutex<HashMap<String, String>>,
    }

    impl MemoryBackend {
        fn new() -> Self {
            Self {
                map: Mutex::new(HashMap::new()),
            }
        }
    }

    impl SecretBackend for MemoryBackend {
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            self.map
                .lock()
                .unwrap()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }
        fn get(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.map.lock().unwrap().get(key).cloned())
        }
        fn delete(&self, key: &str) -> Result<(), String> {
            self.map.lock().unwrap().remove(key);
            Ok(())
        }
    }

    fn store() -> SecretsStore<MemoryBackend> {
        SecretsStore::new(MemoryBackend::new())
    }

    #[test]
    fn set_get_roundtrip() {
        let s = store();
        s.set_secret("anthropic", "sk-abc123").unwrap();
        assert_eq!(s.get_secret("anthropic").unwrap(), Some("sk-abc123".to_string()));
    }

    #[test]
    fn get_missing_returns_none() {
        let s = store();
        assert_eq!(s.get_secret("missing").unwrap(), None);
        assert!(!s.has_secret("missing").unwrap());
    }

    #[test]
    fn overwrite_updates_value() {
        let s = store();
        s.set_secret("k", "old").unwrap();
        s.set_secret("k", "new").unwrap();
        assert_eq!(s.get_secret("k").unwrap(), Some("new".to_string()));
    }

    #[test]
    fn delete_removes_secret() {
        let s = store();
        s.set_secret("k", "v").unwrap();
        assert!(s.has_secret("k").unwrap());
        s.delete_secret("k").unwrap();
        assert_eq!(s.get_secret("k").unwrap(), None);
    }

    #[test]
    fn delete_missing_is_ok() {
        let s = store();
        s.delete_secret("never_existed").unwrap();
    }
}
