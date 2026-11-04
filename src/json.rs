//! A strict JSON parser (RFC 8259) for requests.
//!
//! It rejects what a request must not contain: lone surrogate escapes,
//! duplicate member names, content after the value and excessive nesting.

/// Deepest nesting of arrays and objects that is accepted.
const MAX_DEPTH: usize = 512;

#[derive(Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    /// The number exactly as written.
    Number(String),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    /// The member `name` of an object.
    pub fn member<'a>(members: &'a [(String, Json)], name: &str) -> Option<&'a Json> {
        members.iter().find(|(key, _)| key == name).map(|(_, v)| v)
    }

    /// The value of a number written as an integer (no fraction, no exponent).
    /// Values beyond `u128` saturate; values below zero are zero.
    pub fn integer(&self) -> Option<u128> {
        let Json::Number(text) = self else {
            return None;
        };
        if text.contains(['.', 'e', 'E']) {
            return None;
        }
        if text.starts_with('-') {
            return Some(0);
        }
        Some(text.parse::<u128>().unwrap_or(u128::MAX))
    }
}

/// Parses `text` as exactly one JSON value, optionally surrounded by JSON
/// whitespace.
pub fn parse(text: &str) -> Result<Json, ()> {
    let mut parser = Parser {
        text,
        bytes: text.as_bytes(),
        pos: 0,
    };
    let value = parser.value(0)?;
    parser.skip_whitespace();
    if parser.pos != parser.bytes.len() {
        return Err(());
    }
    Ok(value)
}

struct Parser<'a> {
    text: &'a str,
    bytes: &'a [u8],
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn eat(&mut self, byte: u8) -> Result<(), ()> {
        if self.peek() == Some(byte) {
            self.pos += 1;
            Ok(())
        } else {
            Err(())
        }
    }

    fn literal(&mut self, word: &str, value: Json) -> Result<Json, ()> {
        if self.bytes[self.pos..].starts_with(word.as_bytes()) {
            self.pos += word.len();
            Ok(value)
        } else {
            Err(())
        }
    }

    fn value(&mut self, depth: usize) -> Result<Json, ()> {
        self.skip_whitespace();
        match self.peek().ok_or(())? {
            b'{' => self.object(depth + 1),
            b'[' => self.array(depth + 1),
            b'"' => self.string().map(Json::String),
            b't' => self.literal("true", Json::Bool(true)),
            b'f' => self.literal("false", Json::Bool(false)),
            b'n' => self.literal("null", Json::Null),
            b'-' | b'0'..=b'9' => self.number(),
            _ => Err(()),
        }
    }

    fn object(&mut self, depth: usize) -> Result<Json, ()> {
        if depth > MAX_DEPTH {
            return Err(());
        }
        self.eat(b'{')?;
        let mut members: Vec<(String, Json)> = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(Json::Object(members));
        }
        loop {
            self.skip_whitespace();
            let name = self.string()?;
            if members.iter().any(|(key, _)| *key == name) {
                return Err(());
            }
            self.skip_whitespace();
            self.eat(b':')?;
            let value = self.value(depth)?;
            members.push((name, value));
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Json::Object(members));
                }
                _ => return Err(()),
            }
        }
    }

    fn array(&mut self, depth: usize) -> Result<Json, ()> {
        if depth > MAX_DEPTH {
            return Err(());
        }
        self.eat(b'[')?;
        let mut items = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(Json::Array(items));
        }
        loop {
            items.push(self.value(depth)?);
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Json::Array(items));
                }
                _ => return Err(()),
            }
        }
    }

    fn digits(&mut self) -> Result<(), ()> {
        let start = self.pos;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        if self.pos == start { Err(()) } else { Ok(()) }
    }

    fn number(&mut self) -> Result<Json, ()> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => self.pos += 1,
            Some(b'1'..=b'9') => self.digits()?,
            _ => return Err(()),
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            self.digits()?;
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            self.digits()?;
        }
        Ok(Json::Number(self.text[start..self.pos].to_string()))
    }

    fn hex4(&mut self) -> Result<u32, ()> {
        let digits = self.bytes.get(self.pos..self.pos + 4).ok_or(())?;
        let mut value = 0;
        for &digit in digits {
            value = value * 16 + (digit as char).to_digit(16).ok_or(())?;
        }
        self.pos += 4;
        Ok(value)
    }

    fn string(&mut self) -> Result<String, ()> {
        self.eat(b'"')?;
        let mut out: Vec<u8> = Vec::new();
        loop {
            let byte = self.peek().ok_or(())?;
            self.pos += 1;
            match byte {
                b'"' => return String::from_utf8(out).map_err(|_| ()),
                0..=0x1f => return Err(()),
                b'\\' => {
                    let escape = self.peek().ok_or(())?;
                    self.pos += 1;
                    let c = match escape {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => self.unicode_escape()?,
                        _ => return Err(()),
                    };
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                }
                byte => out.push(byte),
            }
        }
    }

    /// The character of a `\u` escape whose `\u` was consumed; a surrogate
    /// pair is one character, a lone surrogate is an error.
    fn unicode_escape(&mut self) -> Result<char, ()> {
        let first = self.hex4()?;
        let code = match first {
            0xD800..=0xDBFF => {
                self.eat(b'\\')?;
                self.eat(b'u')?;
                let second = self.hex4()?;
                if !(0xDC00..=0xDFFF).contains(&second) {
                    return Err(());
                }
                0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00)
            }
            0xDC00..=0xDFFF => return Err(()),
            other => other,
        };
        char::from_u32(code).ok_or(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn string(s: &str) -> Json {
        Json::String(s.to_string())
    }

    #[test]
    fn parses_values_surrounded_by_whitespace() {
        assert_eq!(parse(" \t\r\n{ } \n").unwrap(), Json::Object(vec![]));
        assert_eq!(
            parse("[null, true,false ,\"a\"]").unwrap(),
            Json::Array(vec![
                Json::Null,
                Json::Bool(true),
                Json::Bool(false),
                string("a")
            ])
        );
        assert_eq!(
            parse("{\"a\":{\"b\":[1]}}").unwrap(),
            Json::Object(vec![(
                "a".to_string(),
                Json::Object(vec![(
                    "b".to_string(),
                    Json::Array(vec![Json::Number("1".to_string())])
                )])
            )])
        );
    }

    #[test]
    fn rejects_empty_syntax_errors_and_trailing_content() {
        for bad in [
            "",
            " ",
            "not json",
            "{} {}",
            "{}x",
            "[1,]",
            "{\"a\":1,}",
            "{\"a\" 1}",
            "{a:1}",
            "[",
            "\"abc",
            "tru",
            "\u{feff}{}",
            "\u{b}{}",
            "'a'",
        ] {
            assert!(parse(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn decodes_escapes_and_surrogate_pairs() {
        assert_eq!(
            parse(r#""a\"\\\/\b\f\n\r\tééé""#).unwrap(),
            string("a\"\\/\u{8}\u{c}\n\r\té\u{e9}é")
        );
        assert_eq!(parse(r#""😀""#).unwrap(), string("😀"));
        assert_eq!(parse(r#""\u0000""#).unwrap(), string("\u{0}"));
    }

    #[test]
    fn rejects_bad_escapes_and_control_characters() {
        for bad in [
            r#""\ud83d""#,
            r#""\ud83dx""#,
            r#""\ud83dA""#,
            r#""\ude00""#,
            r#""\ude00\ud83d""#,
            r#""\u12""#,
            r#""\u12g4""#,
            r#""\x""#,
            "\"a\nb\"",
            "\"a\u{1f}b\"",
        ] {
            assert!(parse(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn rejects_duplicate_members_anywhere() {
        assert!(parse(r#"{"a":1,"a":2}"#).is_err());
        assert!(parse(r#"{"a":{"b":1,"b":1}}"#).is_err());
        assert!(parse(r#"[{"b":1,"b":1}]"#).is_err());
        assert!(parse(r#"{"a":{"b":1},"c":{"b":1}}"#).is_ok());
    }

    #[test]
    fn numbers_follow_the_grammar() {
        for good in ["0", "-0", "1", "-12", "1.5", "1e2", "1E+2", "0.5e-3"] {
            assert_eq!(
                parse(good).unwrap(),
                Json::Number(good.to_string()),
                "{good}"
            );
        }
        for bad in ["01", "-", "+1", "1.", ".5", "1e", "1e+", "0x1", "- 1"] {
            assert!(parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn integers_have_no_fraction_or_exponent() {
        let integer = |text: &str| parse(text).unwrap().integer();
        assert_eq!(integer("1"), Some(1));
        assert_eq!(integer("200"), Some(200));
        assert_eq!(integer("-3"), Some(0));
        assert_eq!(integer("1.5"), None);
        assert_eq!(integer("1.0"), None);
        assert_eq!(integer("1e2"), None);
        assert_eq!(integer("\"1\""), None);
        assert_eq!(
            integer("99999999999999999999999999999999999999999999"),
            Some(u128::MAX)
        );
    }

    #[test]
    fn limits_nesting_instead_of_overflowing_the_stack() {
        let nested = |depth: usize| format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        assert!(parse(&nested(MAX_DEPTH)).is_ok());
        assert!(parse(&nested(MAX_DEPTH + 1)).is_err());
        assert!(parse(&"[".repeat(1_000_000)).is_err());
    }
}
