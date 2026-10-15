//! Tauri glue: owns the vault, exposes commands, emits the `locked` event.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

use crate::clipboard::{ClipboardGuard, ClipboardSettings, CopyKind, CopyOutcome};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, AddOutcome, KeyInfo, KeySource};
use crate::vault::{Vault, VaultStatus};
use crate::workbench::{self, DecryptItem};

/// Event the UI must handle by clearing every text field (message-workbench spec).
pub const LOCKED_EVENT: &str = "locked";
const SWEEP_EVERY: Duration = Duration::from_secs(5);

pub struct AppState {
    pub vault: Arc<Vault>,
    pub clipboard: Arc<ClipboardGuard>,
}

/// Periodic housekeeping: lock if idle (clearing our clipboard entry and telling the
/// UI), and clear the clipboard when its timeout is due. Returns true if it locked.
pub fn sweep(vault: &Vault, clipboard: &ClipboardGuard, notify: &dyn Fn()) -> bool {
    clipboard.tick();
    let locked = vault.check_inactivity();
    if locked {
        clipboard.clear_pending();
        notify();
    }
    locked
}

pub fn spawn_inactivity_timer(app: AppHandle, vault: Arc<Vault>, clipboard: Arc<ClipboardGuard>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(SWEEP_EVERY);
        sweep(&vault, &clipboard, &|| {
            let _ = app.emit(LOCKED_EVENT, ());
        });
    });
}

/// Run blocking work (Argon2, file I/O) off the UI thread.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| AppError::new(ErrorCode::Internal))?
}

#[derive(Serialize)]
pub struct Empty {}

#[tauri::command]
pub async fn status(state: State<'_, AppState>) -> Result<VaultStatus, AppError> {
    let vault = state.vault.clone();
    blocking(move || vault.status()).await
}

#[tauri::command]
pub async fn create_vault(
    state: State<'_, AppState>,
    passphrase: String,
) -> Result<Empty, AppError> {
    let passphrase = Zeroizing::new(passphrase);
    let vault = state.vault.clone();
    blocking(move || vault.create(&passphrase).map(|_| Empty {})).await
}

#[tauri::command]
pub async fn unlock(state: State<'_, AppState>, passphrase: String) -> Result<Empty, AppError> {
    let passphrase = Zeroizing::new(passphrase);
    let vault = state.vault.clone();
    blocking(move || vault.unlock(&passphrase).map(|_| Empty {})).await
}

/// Reports user activity (typing, clicking) so the inactivity lock does not fire while
/// someone is composing a message. Fails with `Locked` once the vault is locked.
#[tauri::command]
pub async fn touch(state: State<'_, AppState>) -> Result<Empty, AppError> {
    state.vault.read(|_| Ok(())).map(|_| Empty {})
}

#[tauri::command]
pub async fn lock(app: AppHandle, state: State<'_, AppState>) -> Result<Empty, AppError> {
    state.vault.lock();
    state.clipboard.clear_pending();
    let _ = app.emit(LOCKED_EVENT, ());
    Ok(Empty {})
}

#[tauri::command]
pub async fn list_keys(state: State<'_, AppState>) -> Result<Vec<KeyInfo>, AppError> {
    let vault = state.vault.clone();
    blocking(move || keys::list(&vault)).await
}

#[tauri::command]
pub async fn add_key(
    state: State<'_, AppState>,
    label: String,
    source: KeySource,
) -> Result<AddOutcome, AppError> {
    let vault = state.vault.clone();
    blocking(move || keys::add(&vault, &label, source)).await
}

#[tauri::command]
pub async fn rename_key(
    state: State<'_, AppState>,
    id: String,
    label: String,
) -> Result<KeyInfo, AppError> {
    let vault = state.vault.clone();
    blocking(move || keys::rename(&vault, &id, &label)).await
}

#[tauri::command]
pub async fn delete_key(state: State<'_, AppState>, id: String) -> Result<Empty, AppError> {
    let vault = state.vault.clone();
    blocking(move || keys::delete(&vault, &id).map(|_| Empty {})).await
}

/// The only command that returns raw key material (as a `ck1-` string).
#[tauri::command]
pub async fn export_key(state: State<'_, AppState>, id: String) -> Result<String, AppError> {
    let vault = state.vault.clone();
    blocking(move || keys::export(&vault, &id).map(|s| (*s).clone())).await
}

#[tauri::command]
pub async fn encrypt(
    state: State<'_, AppState>,
    key_id: Option<String>,
    text: String,
) -> Result<String, AppError> {
    let text = Zeroizing::new(text);
    let vault = state.vault.clone();
    blocking(move || workbench::encrypt(&vault, key_id.as_deref(), &text)).await
}

#[tauri::command]
pub async fn decrypt(
    state: State<'_, AppState>,
    text: String,
) -> Result<Vec<DecryptItem>, AppError> {
    let text = Zeroizing::new(text);
    let vault = state.vault.clone();
    blocking(move || workbench::decrypt(&vault, &text)).await
}

#[tauri::command]
pub async fn copy_to_clipboard(
    state: State<'_, AppState>,
    kind: CopyKind,
    text: String,
) -> Result<CopyOutcome, AppError> {
    let text = Zeroizing::new(text);
    let clipboard = state.clipboard.clone();
    blocking(move || clipboard.copy(kind, &text)).await
}

#[tauri::command]
pub async fn get_clipboard_settings(
    state: State<'_, AppState>,
) -> Result<ClipboardSettings, AppError> {
    Ok(state.clipboard.settings())
}

#[tauri::command]
pub async fn set_clipboard_settings(
    state: State<'_, AppState>,
    settings: ClipboardSettings,
) -> Result<ClipboardSettings, AppError> {
    let clipboard = state.clipboard.clone();
    blocking(move || clipboard.set_settings(settings)).await
}

/// One-click paste-and-decrypt. Reading the clipboard happens here, on the user's
/// explicit action, and nowhere else.
#[tauri::command]
pub async fn paste_and_decrypt(state: State<'_, AppState>) -> Result<Vec<DecryptItem>, AppError> {
    let vault = state.vault.clone();
    let clipboard = state.clipboard.clone();
    blocking(move || {
        // Locked first, so a locked app never even reads the clipboard.
        vault.read(|_| Ok(()))?;
        let text = clipboard.paste()?.ok_or(ErrorCode::NotOurFormat)?;
        workbench::decrypt(&vault, &text)
    })
    .await
}

pub fn data_dir(app: &AppHandle) -> std::io::Result<std::path::PathBuf> {
    app.path().app_data_dir().map_err(std::io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clipboard::fake::FakeClipboard;
    use crate::storage::mem::MemStorage;
    use crate::vault::tests::{rig, DEFAULT_AUTO_LOCK_SECS_FOR_TESTS, PASS};
    use std::cell::Cell;

    fn guard(r: &crate::vault::tests::Rig, cb: &FakeClipboard) -> ClipboardGuard {
        ClipboardGuard::new(
            Box::new(cb.clone()),
            r.clock.clone(),
            Box::new(MemStorage::default()),
        )
    }

    #[test]
    fn sweep_notifies_once_when_the_timeout_locks_the_vault() {
        let r = rig();
        let cb = FakeClipboard::default();
        let g = guard(&r, &cb);
        r.vault.create(PASS).unwrap();
        let fired = Cell::new(0);
        assert!(!sweep(&r.vault, &g, &|| fired.set(fired.get() + 1)));
        r.clock.advance(DEFAULT_AUTO_LOCK_SECS_FOR_TESTS);
        assert!(sweep(&r.vault, &g, &|| fired.set(fired.get() + 1)));
        assert!(!sweep(&r.vault, &g, &|| fired.set(fired.get() + 1)));
        assert_eq!(fired.get(), 1);
    }

    #[test]
    fn auto_lock_clears_our_clipboard_entry_at_once() {
        let r = rig();
        let cb = FakeClipboard::default();
        let g = guard(&r, &cb);
        r.vault.create(PASS).unwrap();
        // Copied late in the idle period, so the 30 s clipboard timer would outlast the lock.
        r.clock.advance(DEFAULT_AUTO_LOCK_SECS_FOR_TESTS - 5);
        g.copy(CopyKind::Key, "ck1-abc").unwrap();
        r.clock.advance(5);
        assert!(sweep(&r.vault, &g, &|| {}));
        assert_eq!(cb.get(), None);
    }

    #[test]
    fn sweep_clears_the_clipboard_when_its_timeout_is_due() {
        let r = rig();
        let cb = FakeClipboard::default();
        let g = guard(&r, &cb);
        r.vault.create(PASS).unwrap();
        g.copy(CopyKind::Plaintext, "secret").unwrap();
        r.clock.advance(30);
        assert!(!sweep(&r.vault, &g, &|| {}), "still unlocked");
        assert_eq!(cb.get(), None);
    }
}
