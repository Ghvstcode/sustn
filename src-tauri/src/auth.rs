// We use the SQL plugin from the frontend for most DB operations,
// but this module also provides keyring-backed credential storage
// for the GitHub access token and UUID generation for auth records.

use std::path::Path;

use keyring::Entry;
use rusqlite::Connection;

const KEYRING_SERVICE: &str = "dev.sustn.app";
const KEYRING_USER: &str = "github_access_token";

fn token_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("keyring error: {e}"))
}

/// Migrate an existing GitHub access token from the SQLite `auth` table
/// into the OS credential store. Must run **before** the SQL migration that
/// runs `ALTER TABLE auth DROP COLUMN github_access_token` (migration 13 in
/// `migrations.rs`), otherwise the token is lost.
///
/// This is intentionally lenient: if the DB doesn't exist, the column is
/// already gone, or the table is empty, it simply returns Ok(()).
pub fn migrate_token_to_keyring(db_path: &Path) {
    if !db_path.exists() {
        return;
    }

    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[auth] migrate_token_to_keyring — failed to open DB: {e}");
            return;
        }
    };

    // Check whether the column still exists (idempotent).
    let has_column: bool = conn
        .prepare("SELECT github_access_token FROM auth LIMIT 0")
        .is_ok();

    if !has_column {
        return; // Column already dropped — nothing to migrate.
    }

    let token: Option<String> = conn
        .query_row(
            "SELECT github_access_token FROM auth LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(ref token) = token {
        if !token.is_empty() {
            match token_entry().and_then(|e| {
                e.set_password(token)
                    .map_err(|e| format!("failed to store token: {e}"))
            }) {
                Ok(()) => {
                    println!("[auth] migrated GitHub token to OS credential store");
                }
                Err(e) => {
                    eprintln!("[auth] migrate_token_to_keyring — keyring error: {e}");
                    // Don't proceed — keep the token in the DB so we can retry.
                    return;
                }
            }
        }
    }
}

#[tauri::command]
pub fn generate_auth_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[tauri::command]
pub fn set_github_token(token: String) -> Result<(), String> {
    token_entry()?.set_password(&token).map_err(|e| format!("failed to store token: {e}"))
}

#[tauri::command]
pub fn get_github_token() -> Result<Option<String>, String> {
    match token_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("failed to retrieve token: {e}")),
    }
}

#[tauri::command]
pub fn clear_github_token() -> Result<(), String> {
    match token_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone — not an error
        Err(e) => Err(format!("failed to clear token: {e}")),
    }
}
