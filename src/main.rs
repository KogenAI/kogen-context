//! `kogen-context`: exact literal search and bounded reads inside one checkout.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str =
    "usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END";
const MAX_MATCHES: usize = 100;
const MAX_READ_LINES: u128 = 200;
const MAX_TEXT_CHARS: usize = 500;

struct Refusal {
    code: &'static str,
    message: String,
}

impl Refusal {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Refusal {
            code,
            message: message.into(),
        }
    }

    fn exit_status(&self) -> u8 {
        if self.code == "usage" { 2 } else { 1 }
    }
}

fn main() -> ExitCode {
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    match run(&args) {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(refusal) => {
            eprintln!(
                "{{\"error\":{{\"code\":{},\"message\":{}}}}}",
                json_string(refusal.code),
                json_string(&refusal.message)
            );
            ExitCode::from(refusal.exit_status())
        }
    }
}

fn run(args: &[std::ffi::OsString]) -> Result<String, Refusal> {
    let usage = || Refusal::new("usage", USAGE);
    match args.first().and_then(|a| a.to_str()) {
        Some("search") if args.len() == 3 => {
            let literal = args[2].to_string_lossy();
            if literal.is_empty() {
                return Err(Refusal::new(
                    "usage",
                    "the search literal must not be empty",
                ));
            }
            search(Path::new(&args[1]), &literal)
        }
        Some("read") if args.len() == 5 => read(
            Path::new(&args[1]),
            &args[2].to_string_lossy(),
            &args[3].to_string_lossy(),
            &args[4].to_string_lossy(),
        ),
        _ => Err(usage()),
    }
}

/// JSON string literal, byte-identical to JavaScript `JSON.stringify`.
fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Splits content into lines: on `\n`, without a `\r` before it and without
/// an extra line after a final `\n`.
fn split_lines(content: &str) -> Vec<&str> {
    content
        .split_inclusive('\n')
        .map(|line| match line.strip_suffix('\n') {
            Some(line) => line.strip_suffix('\r').unwrap_or(line),
            None => line,
        })
        .collect()
}

/// The first 500 characters of a line.
fn clip(line: &str) -> &str {
    match line.char_indices().nth(MAX_TEXT_CHARS) {
        Some((end, _)) => &line[..end],
        None => line,
    }
}

/// 1-based character column of the first occurrence of `literal` in `line`.
fn column_of(line: &str, literal: &str) -> Option<usize> {
    line.find(literal)
        .map(|byte| line[..byte].chars().count() + 1)
}

fn checkout_root(root: &Path) -> Result<PathBuf, Refusal> {
    let not_directory = || {
        Refusal::new(
            "root_not_directory",
            format!("checkout root is not a directory: {}", root.display()),
        )
    };
    if !fs::metadata(root).map(|m| m.is_dir()).unwrap_or(false) {
        return Err(not_directory());
    }
    fs::canonicalize(root).map_err(|_| not_directory())
}

fn relative_string(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// Repo-relative paths of every regular file that `search` considers.
fn collect_files(root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    let mut pending: Vec<(PathBuf, String)> = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if kind.is_dir() {
                if name != ".git" {
                    pending.push((entry.path(), rel));
                }
            } else if kind.is_file() {
                files.push(rel);
            }
        }
    }
    files.sort();
    files
}

fn search(root: &Path, literal: &str) -> Result<String, Refusal> {
    let root = checkout_root(root)?;
    let mut matches = Vec::new();
    let mut truncated = false;
    'files: for rel in collect_files(&root) {
        let Ok(bytes) = fs::read(root.join(&rel)) else {
            continue;
        };
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        for (index, line) in split_lines(&content).into_iter().enumerate() {
            let Some(column) = column_of(line, literal) else {
                continue;
            };
            if matches.len() == MAX_MATCHES {
                truncated = true;
                break 'files;
            }
            matches.push(format!(
                "{{\"path\":{},\"line\":{},\"column\":{},\"text\":{}}}",
                json_string(&rel),
                index + 1,
                column,
                json_string(clip(line))
            ));
        }
    }
    Ok(format!(
        "{{\"query\":{},\"matches\":[{}],\"truncated\":{}}}",
        json_string(literal),
        matches.join(","),
        truncated
    ))
}

/// A positive decimal integer; values beyond `u128` saturate.
fn parse_line_number(s: &str) -> Option<u128> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n = s.parse::<u128>().unwrap_or(u128::MAX);
    (n > 0).then_some(n)
}

fn validate_range(start: &str, end: &str) -> Result<(u128, u128), Refusal> {
    let (Some(start_n), Some(end_n)) = (parse_line_number(start), parse_line_number(end)) else {
        return Err(Refusal::new(
            "invalid_range",
            "start and end must be positive integers",
        ));
    };
    if start_n > end_n {
        return Err(Refusal::new(
            "invalid_range",
            format!("start line {start_n} is after end line {end_n}"),
        ));
    }
    if end_n - start_n >= MAX_READ_LINES {
        return Err(Refusal::new(
            "invalid_range",
            format!("line range {start_n}-{end_n} exceeds the 200-line read limit"),
        ));
    }
    Ok((start_n, end_n))
}

/// Whether `path` stays inside its root when resolved lexically.
fn escapes_lexically(path: &Path) -> bool {
    if path.is_absolute() {
        return true;
    }
    let mut depth = 0usize;
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if depth == 0 {
                    return true;
                }
                depth -= 1;
            }
            Component::Normal(_) => depth += 1,
            Component::RootDir | Component::Prefix(_) => return true,
        }
    }
    false
}

fn read(root: &Path, path: &str, start: &str, end: &str) -> Result<String, Refusal> {
    let (start, end) = validate_range(start, end)?;
    let root = checkout_root(root)?;
    let outside = || {
        Refusal::new(
            "path_outside_root",
            format!("path escapes the checkout root: {path}"),
        )
    };
    if escapes_lexically(Path::new(path)) {
        return Err(outside());
    }
    let resolved = fs::canonicalize(root.join(path))
        .map_err(|_| Refusal::new("not_found", format!("file not found: {path}")))?;
    let Ok(relative) = resolved.strip_prefix(&root) else {
        return Err(outside());
    };
    if !fs::metadata(&resolved)
        .map(|m| m.is_file())
        .unwrap_or(false)
    {
        return Err(Refusal::new(
            "not_a_file",
            format!("not a regular file: {path}"),
        ));
    }
    let not_text = || Refusal::new("not_text", format!("file is not UTF-8 text: {path}"));
    let bytes = fs::read(&resolved).map_err(|_| not_text())?;
    let content = String::from_utf8(bytes).map_err(|_| not_text())?;
    let lines = split_lines(&content);
    let total = lines.len();
    if end > total as u128 {
        return Err(Refusal::new(
            "invalid_range",
            format!("line range {start}-{end} exceeds the file's line count {total}"),
        ));
    }
    let (start_index, end_index) = (start as usize, end as usize);
    let selected: Vec<String> = (start_index..=end_index)
        .map(|number| {
            format!(
                "{{\"line\":{},\"text\":{}}}",
                number,
                json_string(clip(lines[number - 1]))
            )
        })
        .collect();
    Ok(format!(
        "{{\"path\":{},\"start\":{},\"end\":{},\"total_lines\":{},\"lines\":[{}]}}",
        json_string(&relative_string(relative)),
        start,
        end,
        total,
        selected.join(",")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_lines() {
        assert!(split_lines("").is_empty());
        assert_eq!(split_lines("abc"), ["abc"]);
        assert_eq!(split_lines("abc\n"), ["abc"]);
        assert_eq!(split_lines("a\r\nb\r\n"), ["a", "b"]);
        assert_eq!(split_lines("a\n\nb"), ["a", "", "b"]);
        assert_eq!(split_lines("\n"), [""]);
        assert_eq!(split_lines("a\r"), ["a\r"]);
        assert_eq!(split_lines("a\r\nb\r"), ["a", "b\r"]);
        assert_eq!(split_lines("a\r\r\n"), ["a\r"]);
    }

    #[test]
    fn clips_to_500_characters() {
        let exact = "y".repeat(500);
        assert_eq!(clip(&exact), exact);
        let wide = "é".repeat(501);
        assert_eq!(clip(&wide), "é".repeat(500));
    }

    #[test]
    fn column_counts_characters() {
        assert_eq!(column_of("Café: call x, x", "x"), Some(12));
        assert_eq!(column_of("abc", "d"), None);
    }

    #[test]
    fn escapes_json_like_javascript() {
        assert_eq!(
            json_string("a\"b\\c/é\u{8}\t\n\u{c}\r\u{1}\u{1f}"),
            "\"a\\\"b\\\\c/é\\b\\t\\n\\f\\r\\u0001\\u001f\""
        );
    }

    #[test]
    fn validates_ranges_in_order() {
        let message = |s: &str, e: &str| validate_range(s, e).err().map(|r| r.message);
        assert_eq!(validate_range("1", "200").ok(), Some((1, 200)));
        assert_eq!(
            message("0", "2").as_deref(),
            Some("start and end must be positive integers")
        );
        assert_eq!(
            message("x", "2").as_deref(),
            Some("start and end must be positive integers")
        );
        assert_eq!(
            message("3", "2").as_deref(),
            Some("start line 3 is after end line 2")
        );
        assert_eq!(
            message("1", "201").as_deref(),
            Some("line range 1-201 exceeds the 200-line read limit")
        );
        assert!(validate_range("51", "250").is_ok());
    }

    #[test]
    fn detects_lexical_escape() {
        for escaping in ["../a", "a/../../b", "/etc/hostname", ".."] {
            assert!(escapes_lexically(Path::new(escaping)), "{escaping}");
        }
        for inside in ["a", "./a/../b", "a/b/../c", "", "."] {
            assert!(!escapes_lexically(Path::new(inside)), "{inside}");
        }
    }
}
