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
