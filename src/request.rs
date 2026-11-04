//! `kogen-context request`: one version 1 JSON request in, one version 1 JSON
//! packet out.

use std::io::Read;
use std::path::Path;
use std::process::ExitCode;

use crate::json::{self, Json};
use crate::{
    MAX_MATCHES, MAX_READ_LINES, MAX_TEXT_CHARS, Refusal, check_range, find_matches, json_string,
    read_lines,
};

/// A request that matches the version 1 request schema.
#[derive(Debug, PartialEq)]
enum Request {
    Search {
        root: String,
        literal: String,
        max_matches: usize,
        max_line_chars: usize,
    },
    Read {
        root: String,
        path: String,
        start: u128,
        end: u128,
        max_lines: u128,
        max_line_chars: usize,
    },
}

/// Reads the request from standard input, writes the packet to standard
/// output and returns the exit status for it.
pub fn serve_stdin() -> ExitCode {
    let mut input = Vec::new();
    // A failed read leaves a partial or empty input, which is no valid request.
    let read_ok = std::io::stdin().read_to_end(&mut input).is_ok();
    let (packet, status) = respond(if read_ok { &input } else { b"" });
    println!("{packet}");
    ExitCode::from(status)
}

/// The packet for a request and the exit status that goes with it.
fn respond(input: &[u8]) -> (String, u8) {
    match parse(input).and_then(|request| serve(&request)) {
        Ok(packet) => (packet, 0),
        Err(refusal) => {
            let packet = format!(
                "{{\"version\":1,\"error\":{{\"code\":{},\"message\":{}}}}}",
                json_string(refusal.code),
                json_string(&refusal.message)
            );
            let status = match refusal.code {
                "invalid_request" | "unsupported_version" => 2,
                _ => 1,
            };
            (packet, status)
        }
    }
}

/// Checks 1 to 3: JSON, version, then the request schema.
fn parse(input: &[u8]) -> Result<Request, Refusal> {
    let not_json = || Refusal::new("invalid_request", "request is not one valid JSON object");
    let text = std::str::from_utf8(input).map_err(|_| not_json())?;
    let Json::Object(members) = json::parse(text).map_err(|_| not_json())? else {
        return Err(not_json());
    };
    match Json::member(&members, "version") {
        Some(Json::Number(text)) if text == "1" => {}
        _ => {
            return Err(Refusal::new(
                "unsupported_version",
                "request version must be 1",
            ));
        }
    }
    matches_schema(&members).ok_or_else(|| {
        Refusal::new(
            "invalid_request",
            "request does not match the version 1 request schema",
        )
    })
}

/// The request if the object matches `contract/request.schema.json`.
fn matches_schema(members: &[(String, Json)]) -> Option<Request> {
    let member = |name: &str| Json::member(members, name);
    let string = |name: &str| match member(name) {
        Some(Json::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    };
    let bounded = |value: &Json, max: u128| value.integer().filter(|n| (1..=max).contains(n));
    let Some(Json::String(operation)) = member("operation") else {
        return None;
    };
    let (allowed, limit_names): (&[&str], &[&str]) = match operation.as_str() {
        "search" => (
            &["version", "root", "operation", "literal", "limits"],
            &["max_matches", "max_line_chars"],
        ),
        "read" => (
            &[
                "version",
                "root",
                "operation",
                "path",
                "start",
                "end",
                "limits",
            ],
            &["max_lines", "max_line_chars"],
        ),
        _ => return None,
    };
    if members
        .iter()
        .any(|(name, _)| !allowed.contains(&name.as_str()))
    {
        return None;
    }
    let limits: &[(String, Json)] = match member("limits") {
        None => &[],
        Some(Json::Object(limits)) => limits,
        Some(_) => return None,
    };
    if limits
        .iter()
        .any(|(name, _)| !limit_names.contains(&name.as_str()))
    {
        return None;
    }
    // The applied value of a limit: the request's, or the default when absent.
    let limit = |name: &str, max: usize| -> Option<usize> {
        match Json::member(limits, name) {
            None => Some(max),
            Some(value) => bounded(value, max as u128).map(|n| n as usize),
        }
    };
    let root = string("root")?;
    let max_line_chars = limit("max_line_chars", MAX_TEXT_CHARS)?;
    if operation == "search" {
        Some(Request::Search {
            root,
            literal: string("literal")?,
            max_matches: limit("max_matches", MAX_MATCHES)?,
            max_line_chars,
        })
    } else {
        Some(Request::Read {
            root,
            path: string("path")?,
            start: bounded(member("start")?, u128::MAX)?,
            end: bounded(member("end")?, u128::MAX)?,
            max_lines: limit("max_lines", MAX_READ_LINES as usize)? as u128,
            max_line_chars,
        })
    }
}

/// Checks 4 and 5, then the packet of a successful request.
fn serve(request: &Request) -> Result<String, Refusal> {
    match request {
        Request::Search {
            root,
            literal,
            max_matches,
            max_line_chars,
        } => {
            let (matches, truncated) =
                find_matches(Path::new(root), literal, *max_matches, *max_line_chars)?;
            Ok(format!(
                "{{\"version\":1,\"operation\":\"search\",\"query\":{},\"matches\":[{}],\"truncated\":{},\"limits\":{{\"max_matches\":{},\"max_line_chars\":{}}}}}",
                json_string(literal),
                matches.join(","),
                truncated,
                max_matches,
                max_line_chars
            ))
        }
        Request::Read {
            root,
            path,
            start,
            end,
            max_lines,
            max_line_chars,
        } => {
            check_range(*start, *end, *max_lines)?;
            let read = read_lines(Path::new(root), path, *start, *end, *max_line_chars)?;
            Ok(format!(
                "{{\"version\":1,\"operation\":\"read\",\"path\":{},\"start\":{},\"end\":{},\"total_lines\":{},\"lines\":[{}],\"limits\":{{\"max_lines\":{},\"max_line_chars\":{}}}}}",
                json_string(&read.path),
                start,
                end,
                read.total,
                read.lines.join(","),
                max_lines,
                max_line_chars
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOT_JSON: &str = "request is not one valid JSON object";
    const BAD_VERSION: &str = "request version must be 1";
    const BAD_SCHEMA: &str = "request does not match the version 1 request schema";

    fn refusal(input: &str) -> (&'static str, String) {
        let r = parse(input.as_bytes()).unwrap_err();
        (r.code, r.message)
    }

    fn search(extra: &str) -> String {
        format!(
            "{{\"version\":1,\"root\":\"r\",\"operation\":\"search\",\"literal\":\"x\"{extra}}}"
        )
    }

    fn read(extra: &str) -> String {
        format!(
            "{{\"version\":1,\"root\":\"r\",\"operation\":\"read\",\"path\":\"p\",\"start\":1,\"end\":2{extra}}}"
        )
    }

    #[test]
    fn parses_search_and_read_with_defaults_and_any_member_order() {
        assert_eq!(
            parse(search("").as_bytes()).unwrap(),
            Request::Search {
                root: "r".into(),
                literal: "x".into(),
                max_matches: 100,
                max_line_chars: 500
            }
        );
        assert_eq!(
            parse(br#" {"literal":"x","operation":"search","root":"r","limits":{"max_line_chars":7,"max_matches":2},"version":1} "#)
                .unwrap(),
            Request::Search {
                root: "r".into(),
                literal: "x".into(),
                max_matches: 2,
                max_line_chars: 7
            }
        );
        assert_eq!(
            parse(read("").as_bytes()).unwrap(),
            Request::Read {
                root: "r".into(),
                path: "p".into(),
                start: 1,
                end: 2,
                max_lines: 200,
                max_line_chars: 500
            }
        );
        assert_eq!(
            parse(read(r#","limits":{"max_lines":1,"max_line_chars":500}"#).as_bytes()).unwrap(),
            Request::Read {
                root: "r".into(),
                path: "p".into(),
                start: 1,
                end: 2,
                max_lines: 1,
                max_line_chars: 500
            }
        );
    }

    #[test]
    fn read_line_numbers_saturate() {
        let big = "9".repeat(60);
        let request = format!(
            "{{\"version\":1,\"root\":\"r\",\"operation\":\"read\",\"path\":\"p\",\"start\":{big},\"end\":{big}}}"
        );
        let Request::Read { start, end, .. } = parse(request.as_bytes()).unwrap() else {
            panic!("not a read request");
        };
        assert_eq!((start, end), (u128::MAX, u128::MAX));
    }

    #[test]
    fn invalid_json_is_refused_first() {
        for bad in [
            "",
            "not json",
            "[]",
            "\"1\"",
            "1",
            "null",
            "{} {}",
            &format!("{} {{}}", search("")),
            r#"{"version":2,"version":2}"#,
            r#"{"version":1,"root":"\ud800","operation":"search","literal":"x"}"#,
            r#"{"version":1,"root":"r","operation":"search","literal":"x","limits":{"max_matches":1,"max_matches":1}}"#,
        ] {
            assert_eq!(refusal(bad), ("invalid_request", NOT_JSON.into()), "{bad}");
        }
        let invalid_utf8 = b"{\"version\":1,\"root\":\"\xff\"}";
        assert_eq!(
            parse(invalid_utf8).unwrap_err().message,
            NOT_JSON,
            "invalid UTF-8"
        );
        // JSON problems win over a bad version.
        assert_eq!(refusal("{\"version\":2,}").1, NOT_JSON);
    }

    #[test]
    fn version_must_be_the_number_one() {
        for bad in [
            "{}",
            r#"{"version":2}"#,
            r#"{"version":"1"}"#,
            r#"{"version":1.0}"#,
            r#"{"version":1e0}"#,
            r#"{"version":true}"#,
            r#"{"version":null}"#,
            r#"{"version":[1]}"#,
            // The version wins over schema violations.
            r#"{"version":3,"operation":"find"}"#,
        ] {
            assert_eq!(
                refusal(bad),
                ("unsupported_version", BAD_VERSION.into()),
                "{bad}"
            );
        }
    }

    #[test]
    fn schema_violations_are_refused() {
        let big_limit = |name: &str, n: u32| format!(r#","limits":{{"{name}":{n}}}"#);
        let mut bad: Vec<String> = vec![
            r#"{"version":1}"#.into(),
            search("").replace(r#""literal":"x""#, r#""literal":"""#),
            search("").replace(r#""literal":"x""#, r#""literal":1"#),
            search("").replace(r#","literal":"x""#, ""),
            search("").replace(r#""root":"r""#, r#""root":"""#),
            search("").replace(r#""root":"r""#, r#""root":1"#),
            search("").replace("search", "find"),
            search("").replace(r#""operation":"search""#, r#""operation":1"#),
            search("").replace(r#""operation":"search","#, ""),
            search(r#","extra":true"#),
            search(r#","limits":null"#),
            search(r#","limits":[]"#),
            search(r#","limits":{"max_matches":0}"#),
            search(r#","limits":{"max_matches":101}"#),
            search(r#","limits":{"max_matches":1.5}"#),
            search(r#","limits":{"max_matches":1.0}"#),
            search(r#","limits":{"max_matches":1e2}"#),
            search(r#","limits":{"max_matches":"1"}"#),
            search(r#","limits":{"max_matches":-1}"#),
            search(r#","limits":{"max_line_chars":0}"#),
            search(r#","limits":{"max_lines":5}"#),
            search(r#","limits":{"extra":5}"#),
            search(&big_limit("max_line_chars", 501)),
            read("").replace(r#""start":1"#, r#""start":0"#),
            read("").replace(r#""start":1"#, r#""start":"1""#),
            read("").replace(r#""start":1"#, r#""start":1.5"#),
            read("").replace(r#""end":2"#, r#""end":-2"#),
            read("").replace(r#""end":2"#, r#""end":2e0"#),
            read("").replace(r#","end":2"#, ""),
            read("").replace(r#""path":"p""#, r#""path":"""#),
            read("").replace(r#""path":"p","#, ""),
            read(r#","literal":"x""#),
            read(&big_limit("max_lines", 201)),
            read(&big_limit("max_lines", 0)),
            read(&big_limit("max_line_chars", 501)),
            read(&big_limit("max_matches", 5)),
        ];
        bad.push(read("").replace(r#""operation":"read""#, r#""operation":"search""#));
        for request in bad {
            assert_eq!(
                refusal(&request),
                ("invalid_request", BAD_SCHEMA.into()),
                "{request}"
            );
        }
    }

    #[test]
    fn limits_at_their_bounds_are_accepted() {
        for ok in [
            search(r#","limits":{"max_matches":1,"max_line_chars":1}"#),
            search(r#","limits":{"max_matches":100,"max_line_chars":500}"#),
            search(r#","limits":{}"#),
            read(r#","limits":{"max_lines":1}"#),
            read(r#","limits":{"max_lines":200}"#),
        ] {
            assert!(parse(ok.as_bytes()).is_ok(), "{ok}");
        }
    }

    #[test]
    fn packets_and_exit_statuses() {
        let code_and_status = |input: &str| {
            let (packet, status) = respond(input.as_bytes());
            (packet, status)
        };
        assert_eq!(
            code_and_status(""),
            (
                format!(
                    "{{\"version\":1,\"error\":{{\"code\":\"invalid_request\",\"message\":\"{NOT_JSON}\"}}}}"
                ),
                2
            )
        );
        assert_eq!(
            code_and_status("{}"),
            (
                format!(
                    "{{\"version\":1,\"error\":{{\"code\":\"unsupported_version\",\"message\":\"{BAD_VERSION}\"}}}}"
                ),
                2
            )
        );
        let (packet, status) = code_and_status(&search("").replace("\"r\"", "\"/no/such/root\""));
        assert_eq!(status, 1);
        assert_eq!(
            packet,
            "{\"version\":1,\"error\":{\"code\":\"root_not_directory\",\"message\":\"checkout root is not a directory: /no/such/root\"}}"
        );
    }

    #[test]
    fn read_checks_the_range_before_the_root() {
        let request = |end: &str, extra: &str| {
            read(extra)
                .replace("\"r\"", "\"/no/such/root\"")
                .replace("\"end\":2", &format!("\"end\":{end}"))
        };
        let message = |input: String| {
            let (packet, status) = respond(input.as_bytes());
            (status, packet)
        };
        let (status, packet) = message(request("2", "").replace("\"start\":1", "\"start\":3"));
        assert_eq!(status, 1);
        assert!(
            packet.contains("start line 3 is after end line 2"),
            "{packet}"
        );
        let (_, packet) = message(request("3", r#","limits":{"max_lines":2}"#));
        assert!(
            packet.contains("line range 1-3 exceeds the 2-line read limit"),
            "{packet}"
        );
        let (_, packet) = message(request("201", ""));
        assert!(
            packet.contains("line range 1-201 exceeds the 200-line read limit"),
            "{packet}"
        );
        let (_, packet) = message(request("2", ""));
        assert!(packet.contains("root_not_directory"), "{packet}");
    }
}
