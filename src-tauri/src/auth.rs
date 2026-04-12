// We use the SQL plugin from the frontend for most DB operations,
// but this command provides UUID generation for auth records.

use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "app.sustn.desktop";
const KEYCHAIN_USER: &str = "github_access_token";

fn get_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| format!("keychain init error: {e}"))
}

#[tauri::command]
pub fn generate_auth_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[tauri::command]
pub fn keychain_set_token(token: String) -> Result<(), String> {
    get_entry()?.set_password(&token).map_err(|e| format!("keychain write error: {e}"))
}

#[tauri::command]
pub fn keychain_get_token() -> Result<Option<String>, String> {
    match get_entry()?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain read error: {e}")),
    }
}

#[tauri::command]
pub fn keychain_delete_token() -> Result<(), String> {
    match get_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete error: {e}")),
    }
}
