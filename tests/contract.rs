//! Runs the binary on every example of `contract/examples/` and checks that
//! its real output validates against `contract/packet.schema.json`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

// A small JSON parser and JSON Schema validator, written by hand: the
// validator implements exactly the keywords the contract schemas use and
// fails on any other keyword.

#[derive(Debug, PartialEq)]
enum Value {
    Null,
    Bool(bool),
    Number(String),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    fn member(&self, name: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().find(|(k, _)| k == name).map(|(_, v)| v),
            _ => None,
        }
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

fn parse_json(text: &str) -> Result<Value, String> {
    let mut parser = Parser {
        bytes: text.as_bytes(),
        pos: 0,
    };
    let value = parser.value()?;
    parser.space();
    if parser.pos != parser.bytes.len() {
        return Err(format!("content after the value at byte {}", parser.pos));
    }
    Ok(value)
}

impl Parser<'_> {
    fn space(&mut self) {
        while matches!(self.bytes.get(self.pos), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn expect(&mut self, byte: u8) -> Result<(), String> {
        if self.bytes.get(self.pos) == Some(&byte) {
            self.pos += 1;
            Ok(())
        } else {
            Err(format!("expected {:?} at byte {}", byte as char, self.pos))
        }
    }

    fn word(&mut self, word: &str, value: Value) -> Result<Value, String> {
        if self.bytes[self.pos..].starts_with(word.as_bytes()) {
            self.pos += word.len();
            Ok(value)
        } else {
            Err(format!("unexpected input at byte {}", self.pos))
        }
    }

    fn value(&mut self) -> Result<Value, String> {
        self.space();
        match self.bytes.get(self.pos) {
            Some(b'{') => {
                self.pos += 1;
                let mut members: Vec<(String, Value)> = Vec::new();
                self.space();
                if self.bytes.get(self.pos) == Some(&b'}') {
                    self.pos += 1;
                    return Ok(Value::Object(members));
                }
                loop {
                    self.space();
                    let name = self.string()?;
                    if members.iter().any(|(k, _)| *k == name) {
                        return Err(format!("duplicate member {name:?}"));
                    }
                    self.space();
                    self.expect(b':')?;
                    members.push((name, self.value()?));
                    self.space();
                    match self.bytes.get(self.pos) {
                        Some(b',') => self.pos += 1,
                        Some(b'}') => {
                            self.pos += 1;
                            return Ok(Value::Object(members));
                        }
                        _ => return Err(format!("expected ',' or '}}' at byte {}", self.pos)),
                    }
                }
            }
            Some(b'[') => {
                self.pos += 1;
                let mut items = Vec::new();
                self.space();
                if self.bytes.get(self.pos) == Some(&b']') {
                    self.pos += 1;
                    return Ok(Value::Array(items));
                }
                loop {
                    items.push(self.value()?);
                    self.space();
                    match self.bytes.get(self.pos) {
                        Some(b',') => self.pos += 1,
                        Some(b']') => {
                            self.pos += 1;
                            return Ok(Value::Array(items));
                        }
                        _ => return Err(format!("expected ',' or ']' at byte {}", self.pos)),
                    }
                }
            }
            Some(b'"') => self.string().map(Value::String),
            Some(b't') => self.word("true", Value::Bool(true)),
            Some(b'f') => self.word("false", Value::Bool(false)),
            Some(b'n') => self.word("null", Value::Null),
            Some(b'-' | b'0'..=b'9') => {
                let start = self.pos;
                while matches!(
                    self.bytes.get(self.pos),
                    Some(b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
                ) {
                    self.pos += 1;
                }
                let text = std::str::from_utf8(&self.bytes[start..self.pos]).unwrap();
                text.parse::<f64>()
                    .map_err(|_| format!("bad number {text:?}"))?;
                Ok(Value::Number(text.to_string()))
            }
            _ => Err(format!("unexpected input at byte {}", self.pos)),
        }
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let digits = self
            .bytes
            .get(self.pos..self.pos + 4)
            .ok_or("short \\u escape")?;
        self.pos += 4;
        digits.iter().try_fold(0, |acc, &d| {
            (d as char)
                .to_digit(16)
                .map(|n| acc * 16 + n)
                .ok_or_else(|| "bad \\u escape".to_string())
        })
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out = Vec::new();
        loop {
            let byte = *self.bytes.get(self.pos).ok_or("unterminated string")?;
            self.pos += 1;
            match byte {
                b'"' => return String::from_utf8(out).map_err(|e| e.to_string()),
                0..=0x1f => return Err("control character in string".to_string()),
                b'\\' => {
                    let escape = *self.bytes.get(self.pos).ok_or("unterminated escape")?;
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
                        b'u' => {
                            let first = self.hex4()?;
                            let code = if (0xD800..0xDC00).contains(&first) {
                                self.expect(b'\\')?;
                                self.expect(b'u')?;
                                let second = self.hex4()?;
                                if !(0xDC00..0xE000).contains(&second) {
                                    return Err("lone surrogate".to_string());
                                }
                                0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00)
                            } else {
                                first
                            };
                            char::from_u32(code).ok_or("lone surrogate")?
                        }
                        other => return Err(format!("bad escape \\{}", other as char)),
                    };
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                }
                byte => out.push(byte),
            }
        }
    }
}

const KEYWORDS: [&str; 19] = [
    "$schema",
    "$id",
    "title",
    "description",
    "$defs",
    "$ref",
    "type",
    "const",
    "enum",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "maxItems",
    "oneOf",
];

/// Whether `value` is a number written without fraction or exponent.
fn is_integer(text: &str) -> bool {
    !text.contains(['.', 'e', 'E'])
}

fn number(value: &Value, keyword: &str) -> Result<f64, String> {
    match value {
        Value::Number(text) => text
            .parse::<f64>()
            .map_err(|_| format!("{keyword} is not a number")),
        _ => Err(format!("{keyword} is not a number")),
    }
}

/// Errors of `value` against `schema`; an `Err` means the schema itself uses
/// something outside the supported subset.
fn check(root: &Value, schema: &Value, value: &Value, at: &str) -> Result<Vec<String>, String> {
    let Value::Object(keywords) = schema else {
        return Err(format!("schema at {at} is not an object"));
    };
    if let Some((unsupported, _)) = keywords
        .iter()
        .find(|(name, _)| !KEYWORDS.contains(&name.as_str()))
    {
        return Err(format!("unsupported schema keyword {unsupported:?}"));
    }
    let mut errors = Vec::new();
    for (keyword, argument) in keywords {
        match keyword.as_str() {
            "$schema" | "$id" | "title" | "description" | "$defs" => {}
            "$ref" => {
                let Value::String(reference) = argument else {
                    return Err("$ref is not a string".to_string());
                };
                let name = reference
                    .strip_prefix("#/$defs/")
                    .ok_or_else(|| format!("unsupported $ref {reference:?}"))?;
                let target = root
                    .member("$defs")
                    .and_then(|defs| defs.member(name))
                    .ok_or_else(|| format!("unresolved $ref {reference:?}"))?;
                errors.extend(check(root, target, value, at)?);
            }
            "type" => {
                let Value::String(kind) = argument else {
                    return Err("type is not a string".to_string());
                };
                let ok = match (kind.as_str(), value) {
                    ("object", Value::Object(_))
                    | ("array", Value::Array(_))
                    | ("string", Value::String(_))
                    | ("boolean", Value::Bool(_))
                    | ("null", Value::Null)
                    | ("number", Value::Number(_)) => true,
                    ("integer", Value::Number(text)) => is_integer(text),
                    (
                        "object" | "array" | "string" | "boolean" | "null" | "number" | "integer",
                        _,
                    ) => false,
                    (other, _) => return Err(format!("unsupported type {other:?}")),
                };
                if !ok {
                    errors.push(format!("{at}: is not of type {kind}"));
                }
            }
            "const" => {
                if value != argument {
                    errors.push(format!("{at}: is not the constant {argument:?}"));
                }
            }
            "enum" => {
                let Value::Array(options) = argument else {
                    return Err("enum is not an array".to_string());
                };
                if !options.contains(value) {
                    errors.push(format!("{at}: is not one of the enum values"));
                }
            }
            "properties" => {
                let Value::Object(properties) = argument else {
                    return Err("properties is not an object".to_string());
                };
                if let Value::Object(members) = value {
                    for (name, member) in members {
                        if let Some((_, sub)) = properties.iter().find(|(k, _)| k == name) {
                            errors.extend(check(root, sub, member, &format!("{at}/{name}"))?);
                        }
                    }
                }
            }
            "required" => {
                let Value::Array(names) = argument else {
                    return Err("required is not an array".to_string());
                };
                if let Value::Object(_) = value {
                    for name in names {
                        let Value::String(name) = name else {
                            return Err("required holds a non-string".to_string());
                        };
                        if value.member(name).is_none() {
                            errors.push(format!("{at}: missing member {name:?}"));
                        }
                    }
                }
            }
            "additionalProperties" => {
                let Value::Bool(allowed) = argument else {
                    return Err("additionalProperties is not a boolean".to_string());
                };
                if let (false, Value::Object(members)) = (allowed, value) {
                    let declared = keywords.iter().find(|(k, _)| k == "properties");
                    for (name, _) in members {
                        let known = declared
                            .map(|(_, p)| p.member(name).is_some())
                            .unwrap_or(false);
                        if !known {
                            errors.push(format!("{at}: member {name:?} is not allowed"));
                        }
                    }
                }
            }
            "items" => {
                if let Value::Array(items) = value {
                    for (index, item) in items.iter().enumerate() {
                        errors.extend(check(root, argument, item, &format!("{at}/{index}"))?);
                    }
                }
            }
            "minimum" | "maximum" => {
                let bound = number(argument, keyword)?;
                if let Value::Number(_) = value {
                    let actual = number(value, "value")?;
                    if (keyword == "minimum" && actual < bound)
                        || (keyword == "maximum" && actual > bound)
                    {
                        errors.push(format!("{at}: violates {keyword} {bound}"));
                    }
                }
            }
            "minLength" | "maxLength" => {
                let bound = number(argument, keyword)?;
                if let Value::String(s) = value {
                    let length = s.chars().count() as f64;
                    if (keyword == "minLength" && length < bound)
                        || (keyword == "maxLength" && length > bound)
                    {
                        errors.push(format!("{at}: violates {keyword} {bound}"));
                    }
                }
            }
            "maxItems" => {
                let bound = number(argument, keyword)?;
                if let Value::Array(items) = value
                    && items.len() as f64 > bound
                {
                    errors.push(format!("{at}: has more than {bound} items"));
                }
            }
            "oneOf" => {
                let Value::Array(branches) = argument else {
                    return Err("oneOf is not an array".to_string());
                };
                let mut matching = 0;
                for branch in branches {
                    if check(root, branch, value, at)?.is_empty() {
                        matching += 1;
                    }
                }
                if matching != 1 {
                    errors.push(format!(
                        "{at}: matches {matching} of {} oneOf branches, not exactly 1",
                        branches.len()
                    ));
                }
            }
            other => return Err(format!("unsupported schema keyword {other:?}")),
        }
    }
    Ok(errors)
}

fn validate(schema: &Value, value: &Value) -> Result<Vec<String>, String> {
    check(schema, schema, value, "")
}

// The test.

fn repo() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn read_text(rel: impl AsRef<Path>) -> String {
    let file = repo().join(rel);
    fs::read_to_string(&file).unwrap_or_else(|e| panic!("{}: {e}", file.display()))
}

fn load(rel: &str) -> Value {
    parse_json(&read_text(rel)).unwrap_or_else(|e| panic!("{rel}: not valid JSON: {e}"))
}

fn assert_valid(label: &str, schema_file: &str, schema: &Value, value: &Value) {
    match validate(schema, value) {
        Ok(errors) if errors.is_empty() => {}
        Ok(errors) => panic!(
            "{label}: does not validate against {schema_file}:\n{}",
            errors.join("\n")
        ),
        Err(e) => panic!("{label}: {schema_file} cannot be applied: {e}"),
    }
}

#[test]
fn validator_rejects_a_known_bad_packet() {
    let schema = load("contract/packet.schema.json");
    let bad = parse_json(r#"{"version":1,"error":{"code":"usage","message":"x"}}"#).unwrap();
    let errors = validate(&schema, &bad).unwrap();
    assert!(
        !errors.is_empty(),
        "an error packet with code usage validated"
    );
    let good = parse_json(r#"{"version":1,"error":{"code":"not_found","message":"x"}}"#).unwrap();
    assert_eq!(validate(&schema, &good).unwrap(), Vec::<String>::new());
}

#[test]
fn validator_fails_on_unsupported_keywords() {
    let schema = parse_json(r#"{"type":"string","pattern":"^a"}"#).unwrap();
    let value = Value::String("b".to_string());
    assert!(validate(&schema, &value).is_err());
    let nested = parse_json(r#"{"properties":{"a":{"format":"uri"}}}"#).unwrap();
    let object = parse_json(r#"{"a":"x"}"#).unwrap();
    assert!(validate(&nested, &object).is_err());
}

#[test]
fn every_example_runs_to_its_packet() {
    let request_schema = load("contract/request.schema.json");
    let packet_schema = load("contract/packet.schema.json");
    let dir = repo().join("contract/examples");
    let mut requests: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".request.json"))
        })
        .collect();
    requests.sort();
    assert!(
        !requests.is_empty(),
        "contract/examples has no *.request.json"
    );
    for request_file in requests {
        let name = request_file
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let stem = name.strip_suffix(".request.json").unwrap();
        let request_label = format!("contract/examples/{name}");
        let packet_label = format!("contract/examples/{stem}.packet.json");
        let packet_file = dir.join(format!("{stem}.packet.json"));
        assert!(
            packet_file.is_file(),
            "{request_label}: {packet_label} is missing"
        );

        let request_bytes = fs::read(&request_file).unwrap();
        let expected = fs::read(&packet_file).unwrap();
        let request_text = String::from_utf8(request_bytes.clone())
            .unwrap_or_else(|_| panic!("{request_label}: not UTF-8"));
        let request = parse_json(&request_text)
            .unwrap_or_else(|e| panic!("{request_label}: not valid JSON: {e}"));
        assert_valid(
            &request_label,
            "contract/request.schema.json",
            &request_schema,
            &request,
        );
        let expected_text = String::from_utf8(expected.clone())
            .unwrap_or_else(|_| panic!("{packet_label}: not UTF-8"));
        let example_packet = parse_json(&expected_text)
            .unwrap_or_else(|e| panic!("{packet_label}: not valid JSON: {e}"));
        assert_valid(
            &packet_label,
            "contract/packet.schema.json",
            &packet_schema,
            &example_packet,
        );

        let mut child = Command::new(env!("CARGO_BIN_EXE_kogen-context"))
            .arg("request")
            .current_dir(repo())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("{request_label}: cannot run kogen-context: {e}"));
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&request_bytes)
            .unwrap_or_else(|e| panic!("{request_label}: cannot write the request: {e}"));
        let output = child.wait_with_output().unwrap();

        assert!(
            output.stderr.is_empty(),
            "{request_label}: stderr is not empty: {:?}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            expected_text,
            "{request_label}: stdout is not byte-identical to {packet_label}"
        );
        assert_eq!(
            output.stdout, expected,
            "{request_label}: stdout bytes differ from {packet_label}"
        );

        let code = example_packet
            .member("error")
            .and_then(|error| error.member("code"));
        let expected_status = match code {
            None => 0,
            Some(Value::String(code))
                if code == "invalid_request" || code == "unsupported_version" =>
            {
                2
            }
            Some(_) => 1,
        };
        assert_eq!(
            output.status.code(),
            Some(expected_status),
            "{request_label}: unexpected exit status"
        );

        let real = parse_json(std::str::from_utf8(&output.stdout).unwrap())
            .unwrap_or_else(|e| panic!("{request_label}: stdout is not valid JSON: {e}"));
        assert_valid(
            &format!("{request_label} (real stdout)"),
            "contract/packet.schema.json",
            &packet_schema,
            &real,
        );
    }
}
