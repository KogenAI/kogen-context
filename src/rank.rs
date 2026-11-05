//! The ranked order of a version 1 search: the code that owns a behaviour
//! (definitions and call sites in source files) comes before other source
//! lines, tests, generated code, comments, docs and other files.

use std::fs;
use std::path::Path;

use crate::{Refusal, checkout_root, clip, collect_files, column_of, json_string, split_lines};

/// The order of the matches of a search request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Order {
    Path,
    Ranked,
}

const SOURCE_EXTENSIONS: &[&str] = &[
    "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx", "m", "mm", "cs", "go", "rs", "zig", "py",
    "pyi", "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "java", "kt", "kts", "scala",
    "swift", "rb", "php", "lua", "pl", "pm", "sh", "bash", "zsh", "fish", "ps1", "ex", "exs",
    "erl", "hs", "ml", "mli", "dart", "r", "jl", "nim", "sql",
];
const HASH_COMMENT_EXTENSIONS: &[&str] = &[
    "py", "pyi", "rb", "sh", "bash", "zsh", "fish", "pl", "pm", "r", "jl", "ex", "exs", "nim",
    "ps1",
];
const DASH_COMMENT_EXTENSIONS: &[&str] = &["lua", "sql", "hs"];
const DEFINITION_KEYWORDS: &[&str] = &[
    "fn",
    "func",
    "def",
    "function",
    "class",
    "struct",
    "enum",
    "union",
    "interface",
    "trait",
    "type",
    "const",
    "let",
    "var",
    "val",
    "impl",
    "mod",
    "module",
    "macro",
];
/// How many leading lines of a file may carry a generated-code marker.
const GENERATED_MARKER_LINES: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FileClass {
    Other,
    Generated,
    Test,
    Source,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LineKind {
    Comment,
    Definition,
    Call,
    Reference,
}

/// The class of a file and its lowercased extension.
struct FileInfo {
    class: FileClass,
    extension: String,
}

/// The extension of the last component of `rel`: the part after its last `.`
/// when the name has a `.` after its first character.
fn extension_of(rel: &str) -> Option<String> {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    match name.rfind('.') {
        Some(dot) if dot > 0 => Some(name[dot + 1..].to_ascii_lowercase()),
        _ => None,
    }
}

fn file_info(rel: &str, lines: &[&str]) -> FileInfo {
    let extension = extension_of(rel).unwrap_or_default();
    let class = if !SOURCE_EXTENSIONS.contains(&extension.as_str()) {
        FileClass::Other
    } else {
        let (directories, name) = rel.rsplit_once('/').unwrap_or(("", rel));
        let generated = directories.split('/').any(|part| part == "generated")
            || lines
                .iter()
                .take(GENERATED_MARKER_LINES)
                .any(|line| line.contains("DO NOT EDIT") || line.contains("@generated"));
        let test = name
            .to_ascii_lowercase()
            .split(['.', '_', '-'])
            .any(|part| matches!(part, "test" | "tests" | "spec"));
        if generated {
            FileClass::Generated
        } else if test {
            FileClass::Test
        } else {
            FileClass::Source
        }
    };
    FileInfo { class, extension }
}

fn is_blank(c: char) -> bool {
    c == ' ' || c == '\t'
}

/// The kind of a line of a source, test or generated file with the extension
/// `extension`, whose first occurrence of the literal is at byte `at` and
/// spans `literal_len` bytes.
fn line_kind(extension: &str, line: &str, at: usize, literal_len: usize) -> LineKind {
    let before = &line[..at];
    let after = &line[at + literal_len..];
    let marker = if HASH_COMMENT_EXTENSIONS.contains(&extension) {
        "#"
    } else if DASH_COMMENT_EXTENSIONS.contains(&extension) {
        "--"
    } else {
        "//"
    };
    let trimmed = line.trim_start_matches(is_blank);
    if before.contains(marker)
        || (marker != "#" && (trimmed.starts_with("/*") || trimmed.starts_with('*')))
    {
        return LineKind::Comment;
    }
    if is_definition(before, after) {
        LineKind::Definition
    } else if after.trim_start_matches(is_blank).starts_with('(') {
        LineKind::Call
    } else {
        LineKind::Reference
    }
}

fn is_definition(before: &str, after: &str) -> bool {
    if !before.ends_with(is_blank) {
        return false;
    }
    let head = before.trim_end_matches(is_blank);
    let word_start = head
        .trim_end_matches(|c: char| c.is_ascii_alphabetic())
        .len();
    let stands_alone = head[..word_start].is_empty() || head[..word_start].ends_with(is_blank);
    stands_alone
        && DEFINITION_KEYWORDS.contains(&&head[word_start..])
        && !after.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
}

/// The tier of a matching line; lower tiers rank first.
fn tier(class: FileClass, kind: LineKind) -> u8 {
    match (class, kind) {
        (FileClass::Other, _) => 6,
        (_, LineKind::Comment) => 5,
        (FileClass::Source, LineKind::Definition) => 0,
        (FileClass::Source, LineKind::Call) => 1,
        (FileClass::Source, LineKind::Reference) => 2,
        (FileClass::Test, _) => 3,
        (FileClass::Generated, _) => 4,
    }
}

/// The tier of a line of a file described by `info` that contains the literal
/// at byte `at`.
fn tier_of_line(info: &FileInfo, line: &str, at: usize, literal_len: usize) -> u8 {
    let kind = if info.class == FileClass::Other {
        LineKind::Reference
    } else {
        line_kind(&info.extension, line, at, literal_len)
    };
    tier(info.class, kind)
}

struct Candidate {
    tier: u8,
    file: usize,
    line: usize,
    json: String,
}

impl Candidate {
    fn key(&self) -> (u8, usize, usize) {
        (self.tier, self.file, self.line)
    }
}

/// Sorts by tier, then path (the files are in bytewise path order), then line,
/// and keeps the first `keep`.
fn settle(candidates: &mut Vec<Candidate>, keep: usize) {
    candidates.sort_by_key(Candidate::key);
    candidates.truncate(keep);
}

/// The first `max_matches` matching lines of the whole checkout in ranked
/// order as JSON objects, and whether more matching lines exist.
pub fn find_ranked_matches(
    root: &Path,
    literal: &str,
    max_matches: usize,
    max_chars: usize,
) -> Result<(Vec<String>, bool), Refusal> {
    let root = checkout_root(root)?;
    let files = collect_files(&root);
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut total = 0usize;
    for (file, rel) in files.iter().enumerate() {
        let Ok(bytes) = fs::read(root.join(rel)) else {
            continue;
        };
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        let lines = split_lines(&content);
        let mut info = None;
        for (index, line) in lines.iter().enumerate() {
            let Some(at) = line.find(literal) else {
                continue;
            };
            total += 1;
            let info = info.get_or_insert_with(|| file_info(rel, &lines));
            let column = column_of(line, literal).unwrap_or(1);
            candidates.push(Candidate {
                tier: tier_of_line(info, line, at, literal.len()),
                file,
                line: index + 1,
                json: format!(
                    "{{\"path\":{},\"line\":{},\"column\":{},\"text\":{}}}",
                    json_string(rel),
                    index + 1,
                    column,
                    json_string(clip(line, max_chars))
                ),
            });
            if candidates.len() >= 2 * max_matches {
                settle(&mut candidates, max_matches);
            }
        }
    }
    settle(&mut candidates, max_matches);
    Ok((
        candidates.into_iter().map(|c| c.json).collect(),
        total > max_matches,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tier of the first occurrence of `literal` in `line` of the file `rel`.
    fn tier_in(rel: &str, lines: &[&str], line: &str, literal: &str) -> u8 {
        let info = file_info(rel, lines);
        let at = line.find(literal).unwrap();
        tier_of_line(&info, line, at, literal.len())
    }

    fn class(rel: &str, lines: &[&str]) -> FileClass {
        file_info(rel, lines).class
    }

    fn kind(extension: &str, line: &str, literal: &str) -> LineKind {
        line_kind(extension, line, line.find(literal).unwrap(), literal.len())
    }

    #[test]
    fn extensions() {
        assert_eq!(extension_of("a/b.TS").as_deref(), Some("ts"));
        assert_eq!(extension_of("a/b.tar.GZ").as_deref(), Some("gz"));
        assert_eq!(extension_of(".md"), None);
        assert_eq!(extension_of("a/.md"), None);
        assert_eq!(extension_of("Makefile"), None);
        assert_eq!(extension_of("a.b/Makefile"), None);
        assert_eq!(extension_of("a.").as_deref(), Some(""));
        assert_eq!(extension_of(".a.py").as_deref(), Some("py"));
    }

    #[test]
    fn file_classes() {
        for other in [
            "README.md",
            "notes.txt",
            "Makefile",
            "a.json",
            ".py",
            "x.zigg",
        ] {
            assert_eq!(class(other, &[]), FileClass::Other, "{other}");
        }
        for source in [
            "a.go",
            "a.PY",
            "tests/runner/main.zig",
            "src/contest.rs",
            "a/tester.c",
        ] {
            assert_eq!(class(source, &[]), FileClass::Source, "{source}");
        }
        for test in [
            "format_test.go",
            "test_format.py",
            "format.test.js",
            "app.spec.ts",
            "Format-Tests.java",
            "SPEC.rb",
        ] {
            assert_eq!(class(test, &[]), FileClass::Test, "{test}");
        }
        for generated in [
            "generated/a.go",
            "a/generated/b/c.py",
            "generated/a_test.go",
        ] {
            assert_eq!(class(generated, &[]), FileClass::Generated, "{generated}");
        }
        assert_eq!(class("a/generated.go", &[]), FileClass::Source);
        assert_eq!(class("a/generated_x/b.go", &[]), FileClass::Source);
        assert_eq!(class("generated.md", &[]), FileClass::Other);
    }

    #[test]
    fn generated_markers_count_in_the_first_five_lines_only() {
        let mut lines = vec!["x"; 4];
        lines.push("// DO NOT EDIT");
        assert_eq!(class("a.go", &lines), FileClass::Generated);
        lines[4] = "// @generated by tool";
        assert_eq!(class("a.go", &lines), FileClass::Generated);
        lines[4] = "x";
        lines.push("// DO NOT EDIT");
        assert_eq!(class("a.go", &lines), FileClass::Source);
        assert_eq!(
            class("a_test.go", &["// DO NOT EDIT"]),
            FileClass::Generated
        );
        assert_eq!(class("notes.md", &["// DO NOT EDIT"]), FileClass::Other);
        assert_eq!(class("a.go", &["// do not edit"]), FileClass::Source);
    }

    #[test]
    fn comments() {
        assert_eq!(kind("go", "// spin", "spin"), LineKind::Comment);
        assert_eq!(kind("go", "x := 1 // spin", "spin"), LineKind::Comment);
        assert_eq!(kind("go", "x := spin // spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "  /* spin */", "spin"), LineKind::Comment);
        assert_eq!(kind("go", "\t * spin", "spin"), LineKind::Comment);
        assert_eq!(kind("go", "x := 2 * spin(1)", "spin"), LineKind::Call);
        assert_eq!(kind("c", "x /* spin", "spin"), LineKind::Reference);
        assert_eq!(kind("py", "# spin", "spin"), LineKind::Comment);
        assert_eq!(kind("py", "x = 1  # spin", "spin"), LineKind::Comment);
        assert_eq!(
            kind("py", "print(\"// spin\")", "spin"),
            LineKind::Reference
        );
        assert_eq!(kind("py", " * spin", "spin"), LineKind::Reference);
        assert_eq!(kind("py", "/* spin", "spin"), LineKind::Reference);
        assert_eq!(kind("sh", "echo '# spin'", "spin"), LineKind::Comment);
        for hash in [
            "pyi", "rb", "sh", "bash", "zsh", "fish", "pl", "pm", "r", "jl", "ex", "exs", "nim",
            "ps1",
        ] {
            assert_eq!(kind(hash, "# spin", "spin"), LineKind::Comment, "{hash}");
            assert_eq!(kind(hash, "// spin", "spin"), LineKind::Reference, "{hash}");
        }
        for dash in ["lua", "sql", "hs"] {
            assert_eq!(kind(dash, "-- spin", "spin"), LineKind::Comment, "{dash}");
            assert_eq!(kind(dash, "# spin", "spin"), LineKind::Reference, "{dash}");
            assert_eq!(kind(dash, "// spin", "spin"), LineKind::Reference, "{dash}");
            assert_eq!(kind(dash, " /* spin", "spin"), LineKind::Comment, "{dash}");
            assert_eq!(kind(dash, "* spin", "spin"), LineKind::Comment, "{dash}");
        }
        for slash in [
            "c", "rs", "zig", "ts", "java", "php", "swift", "erl", "ml", "dart",
        ] {
            assert_eq!(kind(slash, "// spin", "spin"), LineKind::Comment, "{slash}");
            assert_eq!(
                kind(slash, "-- spin", "spin"),
                LineKind::Reference,
                "{slash}"
            );
        }
    }

    #[test]
    fn definitions_and_their_keyword_boundaries() {
        for definition in [
            "pub fn spin() void {}",
            "def spin():",
            "const spin = 1;",
            "fn spin",
            "\tfunc spin(n int)",
            "class spin:",
            "pub const fn spin()",
            "pub  \t fn spin()",
            "impl spin {",
            "type spin struct{}",
        ] {
            assert_eq!(
                kind("go", definition, "spin"),
                LineKind::Definition,
                "{definition}"
            );
        }
        for keyword in DEFINITION_KEYWORDS {
            let line = format!("{keyword} spin;");
            assert_eq!(kind("go", &line, "spin"), LineKind::Definition, "{line}");
        }
        assert_eq!(kind("go", "func spin", "spin"), LineKind::Definition);
        assert_eq!(kind("go", "fn spin_", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "fn spin1", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "fn spinning", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "fn spin(", "spin"), LineKind::Definition);
        assert_eq!(kind("go", "fn spin.x", "spin"), LineKind::Definition);
        assert_eq!(kind("go", "fn spin-x", "spin"), LineKind::Definition);
        assert_eq!(kind("go", "fn spin", "spin"), LineKind::Definition);
        assert_eq!(kind("go", "fn spinx", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "fn_spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "xfn spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "my_fn spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "fn\tspin", "spin"), LineKind::Definition);
        assert_eq!(kind("go", "fnspin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "fn  = spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "fn.spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "fn(spin", "spin"), LineKind::Reference);
        assert_eq!(
            kind("go", "var spinning = spin(4)", "spin"),
            LineKind::Reference
        );
        assert_eq!(
            kind("go", "func FormatRows(", "FormatRow"),
            LineKind::Reference
        );
        assert_eq!(kind("go", "writeAll(\"fn spin(", "spin"), LineKind::Call);
        assert_eq!(kind("go", "y := \"fn spin(6)\"", "spin"), LineKind::Call);
        assert_eq!(kind("go", "Fn spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "constant spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", " spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "// fn spin()", "spin"), LineKind::Comment);
    }

    #[test]
    fn calls() {
        assert_eq!(kind("go", "x := spin(5)", "spin"), LineKind::Call);
        assert_eq!(kind("go", "x := spin (5)", "spin"), LineKind::Call);
        assert_eq!(kind("go", "x := spin\t\t(5)", "spin"), LineKind::Call);
        assert_eq!(kind("go", "x := spin", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "x := spin.go(5)", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "x := spinner(5)", "spin"), LineKind::Reference);
        assert_eq!(kind("go", "x := spin  ", "spin"), LineKind::Reference);
    }

    #[test]
    fn tiers() {
        let plain = ["x"];
        assert_eq!(tier_in("a.go", &plain, "fn spin()", "spin"), 0);
        assert_eq!(tier_in("a.go", &plain, "x := spin()", "spin"), 1);
        assert_eq!(tier_in("a.go", &plain, "x := spin", "spin"), 2);
        for line in ["fn spin()", "x := spin()", "x := spin"] {
            assert_eq!(tier_in("a_test.go", &plain, line, "spin"), 3, "{line}");
            assert_eq!(tier_in("generated/a.go", &plain, line, "spin"), 4, "{line}");
            assert_eq!(tier_in("a.go", &["@generated"], line, "spin"), 4, "{line}");
            assert_eq!(tier_in("README.md", &plain, line, "spin"), 6, "{line}");
            assert_eq!(tier_in("Makefile", &plain, line, "spin"), 6, "{line}");
        }
        for path in ["a.go", "a_test.go", "generated/a.go"] {
            assert_eq!(tier_in(path, &plain, "// spin", "spin"), 5, "{path}");
        }
        assert_eq!(tier_in("README.md", &plain, "// spin", "spin"), 6);
        assert_eq!(tier_in("notes.txt", &plain, "# spin", "spin"), 6);
    }

    #[test]
    fn ranked_order_is_tier_then_path_then_line() {
        let dir = std::env::temp_dir().join(format!("kogen-context-rank-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let write = |rel: &str, content: &str| {
            let file = dir.join(rel);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, content).unwrap();
        };
        write("README.md", "spin\n");
        write("b.go", "x := spin(1)\nfunc spin()\nvar y = spin\n");
        write("a.go", "x := spin(2)\n// spin\nfunc spin()\n");
        write("a_test.go", "spin(3)\n");
        write(".git/c.go", "func spin()\n");
        fs::write(dir.join("bad.go"), b"func spin()\n\xff").unwrap();
        let ranked = |max: usize| {
            let (matches, truncated) = find_ranked_matches(&dir, "spin", max, 500).unwrap();
            let places: Vec<String> = matches
                .iter()
                .map(|m| {
                    let path = m.split('"').nth(3).unwrap();
                    let line = m
                        .split("\"line\":")
                        .nth(1)
                        .unwrap()
                        .split(',')
                        .next()
                        .unwrap();
                    format!("{path}:{line}")
                })
                .collect();
            (places, truncated)
        };
        let (all, truncated) = ranked(100);
        assert!(!truncated);
        assert_eq!(
            all,
            [
                "a.go:3",
                "b.go:2",
                "a.go:1",
                "b.go:1",
                "b.go:3",
                "a_test.go:1",
                "a.go:2",
                "README.md:1"
            ]
        );
        for max in 1..=8 {
            let (first, truncated) = ranked(max);
            assert_eq!(first, all[..max], "{max}");
            assert_eq!(truncated, max < 8, "{max}");
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
