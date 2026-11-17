use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

struct Checkout(PathBuf);

impl Checkout {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("kogen-context-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("checkout")).unwrap();
        Checkout(dir)
    }

    fn root(&self) -> PathBuf {
        self.0.join("checkout")
    }

    fn write(&self, rel: &str, content: &[u8]) {
        let file = self.root().join(rel);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, content).unwrap();
    }
}

impl Drop for Checkout {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_kogen-context"))
        .args(args)
        .output()
        .unwrap()
}

fn stdout(out: &Output) -> String {
    assert_eq!(out.status.code(), Some(0));
    assert!(out.stderr.is_empty());
    String::from_utf8(out.stdout.clone()).unwrap()
}

fn path_str(p: &Path) -> &str {
    p.to_str().unwrap()
}

#[test]
fn search_orders_paths_bytewise_and_skips_unreadable_content() {
    let c = Checkout::new("search");
    c.write("app/util.py", b"def parse_config(path):\r\n");
    c.write("app.py", b"x = parse_config()");
    c.write("logo.bin", b"\xff\xfe parse_config\n");
    c.write(".git/config", b"parse_config\n");
    c.write("README.md", "Café parse_config\n".as_bytes());
    let out = run(&["search", path_str(&c.root()), "parse_config"]);
    assert_eq!(
        stdout(&out),
        "{\"query\":\"parse_config\",\"matches\":[\
{\"path\":\"README.md\",\"line\":1,\"column\":6,\"text\":\"Café parse_config\"},\
{\"path\":\"app.py\",\"line\":1,\"column\":5,\"text\":\"x = parse_config()\"},\
{\"path\":\"app/util.py\",\"line\":1,\"column\":5,\"text\":\"def parse_config(path):\"}],\
\"truncated\":false}\n"
    );
}

#[test]
fn search_bounds_matches_to_100() {
    let c = Checkout::new("bound");
    c.write("many.txt", "needle\n".repeat(101).as_bytes());
    let out = stdout(&run(&["search", path_str(&c.root()), "needle"]));
    assert_eq!(out.matches("\"path\":\"many.txt\"").count(), 100);
    assert!(out.ends_with("\"truncated\":true}\n"));
    c.write("many.txt", "needle\n".repeat(100).as_bytes());
    let out = stdout(&run(&["search", path_str(&c.root()), "needle"]));
    assert!(out.ends_with("\"truncated\":false}\n"));
}

#[cfg(unix)]
#[test]
fn escaping_symlinks_are_neither_searched_nor_read() {
    let c = Checkout::new("symlink");
    c.write("main.go", b"Hello\n");
    fs::create_dir_all(c.0.join("outside")).unwrap();
    fs::write(c.0.join("outside/secret.txt"), "Hello secret\n").unwrap();
    std::os::unix::fs::symlink("../outside/secret.txt", c.root().join("leak.go")).unwrap();
    std::os::unix::fs::symlink("../outside", c.root().join("linked")).unwrap();
    let root = c.root();
    let root = path_str(&root);

    let out = stdout(&run(&["search", root, "Hello"]));
    assert!(out.contains("main.go") && !out.contains("leak.go") && !out.contains("secret"));

    for path in ["leak.go", "linked/secret.txt", "../outside/secret.txt"] {
        let out = run(&["read", root, path, "1", "1"]);
        assert_eq!(out.status.code(), Some(1));
        assert!(out.stdout.is_empty());
        assert_eq!(
            String::from_utf8(out.stderr).unwrap(),
            format!(
                "{{\"error\":{{\"code\":\"path_outside_root\",\"message\":\"path escapes the checkout root: {path}\"}}}}\n"
            )
        );
    }
}

#[test]
fn read_returns_bounded_range_and_refuses_bad_requests() {
    let c = Checkout::new("read");
    c.write("app.py", b"a\r\nb\r\nc");
    c.write("x/y.txt", b"y");
    let root = c.root();
    let root = path_str(&root);
    assert_eq!(
        stdout(&run(&["read", root, "./x/../app.py", "2", "3"])),
        "{\"path\":\"app.py\",\"start\":2,\"end\":3,\"total_lines\":3,\"lines\":[{\"line\":2,\"text\":\"b\"},{\"line\":3,\"text\":\"c\"}]}\n"
    );
    let out = run(&["read", root, "app.py", "3", "4"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "{\"error\":{\"code\":\"invalid_range\",\"message\":\"line range 3-4 exceeds the file's line count 3\"}}\n"
    );
    let out = run(&["find"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
}

#[test]
fn version_prints_one_line_and_takes_no_argument() {
    let out = run(&["version"]);
    assert_eq!(
        stdout(&out),
        format!(
            "kogen-context {} (development build)\n",
            env!("CARGO_PKG_VERSION")
        )
    );
    let out = run(&["version", "extra"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "{\"error\":{\"code\":\"usage\",\"message\":\"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END\"}}\n"
    );
}

#[test]
fn search_refuses_an_empty_literal() {
    let c = Checkout::new("empty-literal");
    c.write("a.txt", b"x\n");
    let out = run(&["search", path_str(&c.root()), ""]);
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "{\"error\":{\"code\":\"usage\",\"message\":\"the search literal must not be empty\"}}\n"
    );
}

fn run_os(args: &[&std::ffi::OsStr]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_kogen-context"))
        .args(args)
        .output()
        .unwrap()
}

const SEARCH_LITERAL_NOT_UTF8: &str =
    "{\"error\":{\"code\":\"usage\",\"message\":\"the search literal is not valid UTF-8\"}}\n";

#[test]
fn utf8_argument_search_literal_is_refused() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let c = Checkout::new("utf8-literal");
    c.write("a.txt", b"bad \xef\xbf\xbd\n");
    let root = c.root();
    let out = run_os(&[
        OsStr::new("search"),
        root.as_os_str(),
        OsStr::from_bytes(b"\xff"),
    ]);
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        SEARCH_LITERAL_NOT_UTF8
    );
}

#[test]
fn utf8_argument_read_path_is_refused() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let c = Checkout::new("utf8-path");
    c.write("d/b.txt", b"a");
    let root = c.root();
    let out = run_os(&[
        OsStr::new("read"),
        root.as_os_str(),
        OsStr::from_bytes(b"d/\xff"),
        OsStr::new("1"),
        OsStr::new("1"),
    ]);
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "{\"error\":{\"code\":\"usage\",\"message\":\"the read path is not valid UTF-8\"}}\n"
    );
}

#[test]
fn utf8_argument_refusal_comes_before_the_root_check() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let c = Checkout::new("utf8-root");
    let missing = c.root().join("missing");
    let out = run_os(&[
        OsStr::new("search"),
        missing.as_os_str(),
        OsStr::from_bytes(b"\xff"),
    ]);
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        SEARCH_LITERAL_NOT_UTF8
    );
}

/// Runs the binary with standard output on `/dev/full`, which fails every
/// write; `None` where `/dev/full` does not exist (macOS).
fn run_with_full_stdout(args: &[&str], stdin: Option<&[u8]>) -> Option<Output> {
    use std::io::Write;
    use std::process::Stdio;
    let full = fs::OpenOptions::new().write(true).open("/dev/full").ok()?;
    let mut child = Command::new(env!("CARGO_BIN_EXE_kogen-context"))
        .args(args)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::from(full))
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(bytes) = stdin {
        child.stdin.take().unwrap().write_all(bytes).unwrap();
    }
    Some(child.wait_with_output().unwrap())
}

const OUTPUT_FAILED: &str =
    "{\"error\":{\"code\":\"output_failed\",\"message\":\"cannot write to standard output\"}}\n";

#[test]
fn stdout_failure_request_exits_1_with_empty_stderr() {
    let c = Checkout::new("stdout-failure-request");
    c.write("a.txt", b"x\n");
    let request = format!(
        "{{\"version\":1,\"root\":{},\"operation\":\"search\",\"literal\":\"x\"}}",
        crate_json(path_str(&c.root()))
    );
    let Some(out) = run_with_full_stdout(&["request"], Some(request.as_bytes())) else {
        return;
    };
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stderr.is_empty());
}

#[test]
fn stdout_failure_search_writes_one_json_line_on_stderr() {
    let c = Checkout::new("stdout-failure-search");
    c.write("a.txt", b"x\n");
    let Some(out) = run_with_full_stdout(&["search", path_str(&c.root()), "x"], None) else {
        return;
    };
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(String::from_utf8(out.stderr).unwrap(), OUTPUT_FAILED);
}

#[test]
fn stdout_failure_version_writes_one_json_line_on_stderr() {
    let Some(out) = run_with_full_stdout(&["version"], None) else {
        return;
    };
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(String::from_utf8(out.stderr).unwrap(), OUTPUT_FAILED);
}

/// A JSON string literal for a path made of plain characters.
fn crate_json(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}
