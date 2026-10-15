pub fn encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn decode(hex: &str) -> Option<Vec<u8>> {
    // `from_str_radix` also accepts a leading '+', so check the digits first.
    if !hex.len().is_multiple_of(2) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..hex.len() / 2)
        .map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        assert_eq!(
            decode(&encode(&[0, 1, 0xab, 0xff])).unwrap(),
            [0, 1, 0xab, 0xff]
        );
    }

    #[test]
    fn rejects_bad_input() {
        assert!(decode("abc").is_none());
        assert!(decode("zz").is_none());
        assert!(decode("é").is_none());
        assert!(decode("+1").is_none());
        assert_eq!(decode("").unwrap(), Vec::<u8>::new());
    }
}
