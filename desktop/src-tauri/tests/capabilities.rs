//! Guards the webview's privilege surface (design decision 9). Adding a command or a
//! permission must be done in all of the places below, on purpose.

use std::collections::BTreeSet;

fn read(path: &str) -> String {
    std::fs::read_to_string(format!("{}/{path}", env!("CARGO_MANIFEST_DIR")))
        .unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn json(path: &str) -> serde_json::Value {
    serde_json::from_str(&read(path)).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn commands() -> BTreeSet<String> {
    read("commands.txt")
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

/// Names inside `tauri::generate_handler![ ... ]` in `src/lib.rs`.
fn registered_handlers() -> BTreeSet<String> {
    let src = read("src/lib.rs");
    let start = src
        .find("generate_handler![")
        .expect("generate_handler! in lib.rs");
    let rest = &src[start + "generate_handler![".len()..];
    let body = &rest[..rest.find(']').expect("closing ]")];
    body.split(',')
        .map(|s| s.trim().rsplit("::").next().unwrap().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[test]
fn registered_handlers_match_command_list() {
    assert_eq!(
        registered_handlers(),
        commands(),
        "commands.txt and generate_handler! in src/lib.rs must list the same commands"
    );
}

#[test]
fn capability_allows_exactly_the_command_list_plus_event_listening() {
    let cap = json("capabilities/default.json");
    let granted: BTreeSet<String> = cap["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .map(|p| p.as_str().expect("permission strings only").to_string())
        .collect();
    let mut expected: BTreeSet<String> = commands()
        .iter()
        .map(|c| format!("allow-{}", c.replace('_', "-")))
        .collect();
    expected.insert("core:event:allow-listen".into());
    expected.insert("core:event:allow-unlisten".into());
    assert_eq!(
        granted, expected,
        "capabilities/default.json must grant only the listed commands and event listening"
    );
}

#[test]
fn only_one_capability_file_and_one_window() {
    let dir = format!("{}/capabilities", env!("CARGO_MANIFEST_DIR"));
    let files: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(files.len(), 1, "unexpected capability files: {files:?}");
    assert_eq!(
        json("capabilities/default.json")["windows"],
        serde_json::json!(["main"])
    );
}

#[test]
fn no_plugins_in_dependencies_or_config() {
    let cargo = read("Cargo.toml");
    assert!(
        !cargo.contains("tauri-plugin"),
        "tauri plugins widen the webview's privileges"
    );
    let conf = json("tauri.conf.json");
    assert!(conf
        .get("plugins")
        .is_none_or(|p| p.as_object().is_none_or(|o| o.is_empty())));
    assert_eq!(conf["app"]["withGlobalTauri"], false);
}

#[test]
fn csp_is_locked_to_self() {
    let conf = json("tauri.conf.json");
    let csp = conf["app"]["security"]["csp"].as_str().expect("csp string");
    assert!(csp.contains("default-src 'self'"));
    assert!(csp.contains("object-src 'none'"));
    assert!(!csp.contains("unsafe-"), "no unsafe-inline/eval: {csp}");
    assert!(!csp.contains('*'), "no wildcards: {csp}");
    // Only Tauri's own IPC channel may be a connect target; no other network origin.
    let connect = csp
        .split(';')
        .map(str::trim)
        .find(|d| d.starts_with("connect-src"))
        .expect("connect-src");
    let sources: Vec<&str> = connect.split_whitespace().skip(1).collect();
    assert_eq!(
        sources,
        ["ipc:", "http://ipc.localhost"],
        "connect-src: {connect}"
    );
    for directive in csp
        .split(';')
        .map(str::trim)
        .filter(|d| !d.starts_with("connect-src"))
    {
        assert!(
            !directive.contains("http:") && !directive.contains("https:"),
            "remote origin in: {directive}"
        );
    }
}

#[test]
fn devtools_feature_is_not_enabled() {
    // Devtools are compiled out of release builds unless the `devtools` feature is on.
    assert!(!read("Cargo.toml").contains("devtools"));
}

#[test]
fn app_has_no_network_code_or_dependencies() {
    // The app never makes network connections (message-workbench spec). Tauri itself is
    // the only crate allowed to carry networking code, for its local IPC and dev server.
    let cargo = read("Cargo.toml");
    let deps: Vec<&str> = cargo
        .lines()
        .filter_map(|l| l.split('=').next().map(str::trim))
        .filter(|n| !n.is_empty() && !n.starts_with('[') && !n.starts_with('#'))
        .collect();
    for banned in [
        "reqwest",
        "hyper",
        "ureq",
        "curl",
        "isahc",
        "surf",
        "attohttpc",
        "tungstenite",
        "websocket",
        "tokio-tungstenite",
        "native-tls",
        "rustls",
        "openssl",
        "mio",
        "socket2",
        "tauri-plugin-http",
        "tauri-plugin-websocket",
        "tauri-plugin-updater",
        "tauri-plugin-shell",
        "tauri-plugin-opener",
        "tauri-plugin-fs",
        "tauri-plugin-process",
    ] {
        assert!(!deps.contains(&banned), "Cargo.toml depends on {banned}");
    }
    for entry in std::fs::read_dir(format!("{}/src", env!("CARGO_MANIFEST_DIR"))).unwrap() {
        let path = entry.unwrap().path();
        let text = std::fs::read_to_string(&path).unwrap();
        let production = text.split("#[cfg(test)]").next().unwrap();
        for banned in [
            "std::net",
            "TcpStream",
            "UdpSocket",
            "TcpListener",
            "tokio::net",
            "Command::new",
        ] {
            assert!(
                !production.contains(banned),
                "{} uses {banned}",
                path.display()
            );
        }
    }
}
