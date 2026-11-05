//! Benchmark: kogen-context against ripgrep on a generated Git checkout of
//! 4000 files, cold, warm and after an edit. Run it with:
//!
//! ```sh
//! cargo test --release --locked --offline --test index_bench -- --ignored --nocapture
//! ```
//!
//! It needs `git` and `rg`. When `KOGEN_CONTEXT_BENCH_REPORT` names a file,
//! the five measurement lines are written there as well.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

const FILES: usize = 4000;
const LINES: usize = 200;
const MARKER_EVERY: usize = 500;
const MARKER_LINE: usize = 100;
const LITERAL: &str = "needleIndexBench";
const EDITED: &str = "pkg12/file1234.zig";
const ADDED: &str = "added-by-benchmark.txt";
const RUNS: usize = 5;
const ORDERS: [&str; 2] = ["path", "ranked"];
/// 2020-01-01T00:00:00Z
const AGED_SECONDS: u64 = 1_577_836_800;
const RG_OPTIONS: [&str; 10] = [
    "--sort",
    "path",
    "--fixed-strings",
    "--line-number",
    "--column",
    "--no-heading",
    "--no-ignore",
    "--hidden",
    "--glob",
    "!.git",
];

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> TempDir {
        let base = fs::canonicalize(std::env::temp_dir()).expect("the temporary directory");
        let dir = base.join(format!("kogen-index-bench-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create the benchmark directory");
        TempDir(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn file_path(f: usize) -> String {
    format!("pkg{:02}/file{:04}.zig", f / 100, f)
}

fn file_content(f: usize) -> String {
    let mut text = String::new();
    for l in 1..=LINES {
        if f.is_multiple_of(MARKER_EVERY) && l == MARKER_LINE {
            text.push_str(&format!("pub const marker_{f} = \"{LITERAL}\";\n"));
        } else {
            text.push_str(&format!(
                "const value_{f}_{l} = compute({f}, {l}); // filler line of the benchmark fixture\n"
            ));
        }
    }
    text
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Kogen")
        .env("GIT_AUTHOR_EMAIL", "kogen@example.invalid")
        .env("GIT_AUTHOR_DATE", "2020-01-01T00:00:00Z")
        .env("GIT_COMMITTER_NAME", "Kogen")
        .env("GIT_COMMITTER_EMAIL", "kogen@example.invalid")
        .env("GIT_COMMITTER_DATE", "2020-01-01T00:00:00Z")
        .stdout(Stdio::null())
        .status()
        .unwrap_or_else(|e| panic!("cannot run git: {e}"));
    assert!(status.success(), "git {args:?} failed in {dir:?}");
}

/// Sets the modification time of every file under `dir` outside `.git`.
fn age_files(dir: &Path) {
    let aged = SystemTime::UNIX_EPOCH + Duration::from_secs(AGED_SECONDS);
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if entry.file_type().unwrap().is_dir() {
            if entry.file_name() != ".git" {
                age_files(&path);
            }
        } else {
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(aged)
                .unwrap();
        }
    }
}

fn copy_without_git(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap().flatten() {
        if entry.file_name() == ".git" {
            continue;
        }
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_without_git(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// The edit and the added file of the after-edit phase.
fn edit(root: &Path) {
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(root.join(EDITED))
        .unwrap();
    writeln!(file, "edited {LITERAL}").unwrap();
    fs::write(root.join(ADDED), format!("added {LITERAL}\n")).unwrap();
}

fn json_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The packet of one search request and the wall-clock milliseconds of the run.
fn kogen(root: &Path, cache: &Path, order: &str) -> (Vec<u8>, f64) {
    let request = format!(
        "{{\"version\":1,\"root\":{},\"operation\":\"search\",\"literal\":\"{LITERAL}\",\"order\":\"{order}\"}}\n",
        json_string(root.to_str().unwrap())
    );
    let start = Instant::now();
    let mut child = Command::new(env!("CARGO_BIN_EXE_kogen-context"))
        .arg("request")
        .env("XDG_CACHE_HOME", cache)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("run kogen-context");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(request.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(out.status.code(), Some(0), "kogen-context request failed");
    assert!(out.stderr.is_empty(), "kogen-context printed on stderr");
    (out.stdout, ms)
}

/// The wall-clock milliseconds of a path-sorted ripgrep scan of `root`.
fn ripgrep(root: &Path) -> f64 {
    let start = Instant::now();
    let out = Command::new("rg")
        .args(RG_OPTIONS)
        .args(["--no-messages", "-e", LITERAL, "."])
        .current_dir(root)
        .output()
        .unwrap_or_else(|e| {
            panic!("cannot run rg (ripgrep): {e}; the benchmark needs ripgrep on the PATH")
        });
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(
        out.status.code(),
        Some(0),
        "rg (ripgrep) found no match for {LITERAL} in {root:?}"
    );
    ms
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

struct Row {
    phase: &'static str,
    order: &'static str,
    kogen: f64,
    ripgrep: f64,
}

impl Row {
    fn line(&self) -> String {
        format!(
            "{}\t{}\t{:.1}\t{:.1}",
            self.phase, self.order, self.kogen, self.ripgrep
        )
    }
}

/// Times `RUNS` interleaved requests and ripgrep runs in each order and checks
/// every packet against the plain copy's.
fn measure(
    phase: &'static str,
    root: &Path,
    plain: &Path,
    cache: &Path,
    no_cache: &Path,
) -> Vec<Row> {
    ORDERS
        .iter()
        .map(|&order| {
            let (expected, _) = kogen(plain, no_cache, order);
            let (mut kogen_ms, mut rg_ms) = (Vec::new(), Vec::new());
            for _ in 0..RUNS {
                let (packet, ms) = kogen(root, cache, order);
                assert_eq!(
                    String::from_utf8_lossy(&packet),
                    String::from_utf8_lossy(&expected),
                    "{phase} {order}: the packet differs from the plain copy's"
                );
                kogen_ms.push(ms);
                rg_ms.push(ripgrep(root));
            }
            Row {
                phase,
                order,
                kogen: median(kogen_ms),
                ripgrep: median(rg_ms),
            }
        })
        .collect()
}

#[test]
#[ignore = "benchmark: cargo test --release --locked --offline --test index_bench -- --ignored --nocapture"]
fn kogen_context_is_at_most_as_slow_as_ripgrep_when_warm_and_after_an_edit() {
    if cfg!(debug_assertions) {
        panic!(
            "the benchmark must run in a release build: add --release to the cargo test command"
        );
    }
    // Fail early, before the long fixture build, when ripgrep cannot run.
    if let Err(e) = Command::new("rg")
        .arg("--version")
        .stdout(Stdio::null())
        .status()
    {
        panic!("cannot run rg (ripgrep): {e}; the benchmark needs ripgrep on the PATH");
    }
    let tmp = TempDir::new();
    let root = tmp.0.join("big");
    let plain = tmp.0.join("plain");
    let cache = tmp.0.join("cache");
    let no_cache = tmp.0.join("no-cache");

    for f in 0..FILES {
        let path = root.join(file_path(f));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, file_content(f)).unwrap();
    }
    git(&root, &["init", "-q"]);
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "-q", "-m", "fixture"]);
    age_files(&root);
    std::thread::sleep(Duration::from_secs(3));
    copy_without_git(&root, &plain);

    let (expected, cold_ms) = kogen(&root, &cache, "path");
    let (plain_packet, _) = kogen(&plain, &no_cache, "path");
    assert_eq!(
        String::from_utf8_lossy(&expected),
        String::from_utf8_lossy(&plain_packet),
        "cold path: the packet differs from the plain copy's"
    );

    let warm = measure("warm", &root, &plain, &cache, &no_cache);
    edit(&root);
    edit(&plain);
    let after = measure("after-edit", &root, &plain, &cache, &no_cache);

    let mut rows = vec![Row {
        phase: "cold",
        order: "path",
        kogen: cold_ms,
        ripgrep: warm[0].ripgrep,
    }];
    rows.extend(warm);
    rows.extend(after);
    let table: String = rows.iter().map(|r| format!("{}\n", r.line())).collect();
    print!("{table}");
    if let Some(report) = std::env::var_os("KOGEN_CONTEXT_BENCH_REPORT") {
        fs::write(&report, &table).expect("write the benchmark report");
    }
    let slow: Vec<String> = rows
        .iter()
        .filter(|r| r.phase != "cold" && r.kogen > r.ripgrep)
        .map(Row::line)
        .collect();
    assert!(
        slow.is_empty(),
        "kogen-context took longer than ripgrep in {} of 4 warm and after-edit measurements:\n{table}",
        slow.len()
    );
}
