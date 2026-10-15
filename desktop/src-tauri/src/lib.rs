pub mod app;
pub mod clipboard;
pub mod clock;
pub mod error;
pub mod hex;
pub mod keys;
pub mod storage;
pub mod vault;
pub mod workbench;

use std::sync::Arc;

use tauri::{Manager, RunEvent};

use crate::app::{
    add_key, copy_to_clipboard, create_vault, decrypt, delete_key, encrypt, export_key,
    get_clipboard_settings, list_keys, lock, paste_and_decrypt, rename_key, set_clipboard_settings,
    status, touch, unlock, AppState,
};
use crate::clipboard::{ClipboardGuard, SystemClipboard};
use crate::clock::SystemClock;
use crate::storage::FsStorage;
use crate::vault::Vault;

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let dir = app::data_dir(app.handle())?;
            let clock = Arc::new(SystemClock);
            let vault = Arc::new(Vault::new(
                Box::new(FsStorage::new(dir.clone())?),
                clock.clone(),
            ));
            let clipboard = Arc::new(ClipboardGuard::new(
                Box::new(SystemClipboard::new()),
                clock,
                Box::new(FsStorage::new(dir)?),
            ));
            app::spawn_inactivity_timer(app.handle().clone(), vault.clone(), clipboard.clone());
            app.manage(AppState { vault, clipboard });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            status,
            create_vault,
            unlock,
            lock,
            touch,
            list_keys,
            add_key,
            rename_key,
            delete_key,
            export_key,
            encrypt,
            decrypt,
            copy_to_clipboard,
            get_clipboard_settings,
            set_clipboard_settings,
            paste_and_decrypt
        ])
        .build(tauri::generate_context!())
        .expect("error while building CipherChat");

    app.run(|handle, event| {
        // Do not leave an exported key or plaintext on the clipboard after quitting.
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                state.clipboard.clear_pending();
            }
        }
    });
}
