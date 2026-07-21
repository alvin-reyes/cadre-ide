//! SecretsStore (§3.6): all secrets live in the OS keychain via the `keyring`
//! crate — never plaintext, never committed. v0.0 stores the Anthropic model
//! key (asked once, reused silently); DB passwords and other providers reuse
//! the same store later.

use keyring::{Entry, Error as KeyringError};

/// Keychain service namespace for all cadre secrets.
const SERVICE: &str = "dev.cadre.ide";

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Store (or overwrite) a secret under `key`.
pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    entry(key)?.set_password(value).map_err(|e| e.to_string())
}

/// Read a secret, or `None` if it hasn't been set.
pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    match entry(key)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// True if a secret exists for `key`.
pub fn has_secret(key: &str) -> Result<bool, String> {
    Ok(get_secret(key)?.is_some())
}

/// Delete a secret. Missing keys are treated as success (idempotent).
pub fn delete_secret(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// --- Tauri commands (thin wrappers) ---

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    set_secret(&key, &value)
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    get_secret(&key)
}

#[tauri::command]
pub fn secret_has(key: String) -> Result<bool, String> {
    has_secret(&key)
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    delete_secret(&key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    static INIT: Once = Once::new();

    // Route the keyring through an in-memory mock so tests never touch (or
    // prompt) the real OS keychain.
    fn mock() {
        INIT.call_once(|| {
            keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        });
    }

    #[test]
    fn set_get_roundtrip() {
        mock();
        set_secret("test_rt", "sk-abc123").unwrap();
        assert_eq!(get_secret("test_rt").unwrap(), Some("sk-abc123".to_string()));
    }

    #[test]
    fn get_missing_returns_none() {
        mock();
        assert_eq!(get_secret("test_missing").unwrap(), None);
        assert!(!has_secret("test_missing").unwrap());
    }

    #[test]
    fn overwrite_updates_value() {
        mock();
        set_secret("test_ow", "old").unwrap();
        set_secret("test_ow", "new").unwrap();
        assert_eq!(get_secret("test_ow").unwrap(), Some("new".to_string()));
    }

    #[test]
    fn delete_removes_secret() {
        mock();
        set_secret("test_del", "v").unwrap();
        assert!(has_secret("test_del").unwrap());
        delete_secret("test_del").unwrap();
        assert_eq!(get_secret("test_del").unwrap(), None);
    }

    #[test]
    fn delete_missing_is_ok() {
        mock();
        delete_secret("test_never_existed").unwrap();
    }
}
