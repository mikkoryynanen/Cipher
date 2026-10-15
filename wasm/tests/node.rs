use cipherchat_wasm::*;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

/// Error code (the JS `Error.message`) thrown by a failing call.
fn code<T: std::fmt::Debug>(r: Result<T, wasm_bindgen::JsError>) -> String {
    let v: JsValue = r.unwrap_err().into();
    js_sys::Reflect::get(&v, &"message".into()).unwrap().as_string().unwrap()
}

#[wasm_bindgen_test]
fn round_trip_with_emoji_and_newlines() {
    let key = generate_key();
    assert_eq!(key.len(), 32);
    let text = "hi 🔒🎉\nsecond line";
    let wire = encrypt(&key, text).unwrap();
    assert!(is_encrypted(&wire));
    assert_eq!(decrypt(&key, &wire).unwrap(), text);
    assert_eq!(key_id_of(&wire).unwrap(), key_id(&key).unwrap());
}

#[wasm_bindgen_test]
fn passphrase_derivation_is_deterministic() {
    let salt = random_salt();
    let a = derive_key("correct horse", &salt).unwrap();
    let b = derive_key("correct horse", &salt).unwrap();
    assert_eq!(a, b);
    assert_eq!(fingerprint(&a).unwrap(), fingerprint(&b).unwrap());
    assert_eq!(code(derive_key("x", &[1, 2, 3])), "KeyDerivation");
}

#[wasm_bindgen_test]
fn error_codes_reach_js() {
    let key = generate_key();
    let other = generate_key();
    let wire = encrypt(&key, "secret").unwrap();

    assert_eq!(code(decrypt(&key, "hello")), "NotOurFormat");
    assert_eq!(code(decrypt(&other, &wire)), "WrongKey");
    assert_eq!(code(decrypt(&[0u8; 5], &wire)), "InvalidKey");

    // Change one character in the middle (last chars may hold only padding bits).
    let mut chars: Vec<char> = wire.chars().collect();
    let i = "🔒1.".chars().count() + 30;
    chars[i] = if chars[i] == 'A' { 'B' } else { 'A' };
    let tampered: String = chars.into_iter().collect();
    assert_eq!(code(decrypt(&key, &tampered)), "Tampered");
}
