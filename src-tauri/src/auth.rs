// We use the SQL plugin from the frontend for most DB operations,
// but this command provides UUID generation for auth records.

use keyring::Entry;

const KEYRING_SERVICE: &str = "app.sustn.desktop";
const KEYRING_ENTRY: &str = "github_access_token";

fn get_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ENTRY).map_err(|e| format!("Keychain error: {e}"))
}

#[tauri::command]
pub fn generate_auth_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[tauri::command]
pub fn keychain_set_token(token: String) -> Result<(), String> {
    let entry = get_entry()?;
    entry
        .set_password(&token)
        .map_err(|e| format!("Failed to store token in keychain: {e}"))
}

#[tauri::command]
pub fn keychain_get_token() -> Result<Option<String>, String> {
    let entry = get_entry()?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read token from keychain: {e}")),
    }
}

#[tauri::command]
pub fn keychain_delete_token() -> Result<(), String> {
    let entry = get_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete token from keychain: {e}")),
    }
}
