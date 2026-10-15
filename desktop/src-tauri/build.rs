// The command list lives in `commands.txt` so the build, the capability file and
// `tests/capabilities.rs` all check the same set. Commands that are not listed here
// cannot be called from the webview at all.
fn main() {
    println!("cargo:rerun-if-changed=commands.txt");
    let list: &'static str = Box::leak(
        std::fs::read_to_string("commands.txt")
            .expect("commands.txt")
            .into_boxed_str(),
    );
    let commands: &'static [&'static str] = Box::leak(
        list.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .into_boxed_slice(),
    );
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("failed to run tauri-build");
}
