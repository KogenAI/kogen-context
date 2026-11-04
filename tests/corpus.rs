//! Runs the binary on every golden request of `tests/goldens/` against the
//! fixture corpus of `tests/corpus/`, compares its stdout to the golden packet
//! byte for byte and checks that no run changes the corpus. It runs the binary
//! that `KOGEN_CONTEXT_BIN` names, or else the binary Cargo built. With
//! `KOGEN_CONTEXT_UPDATE_GOLDENS=1` it writes the packets instead.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;

const UPDATE_VARIABLE: &str = "KOGEN_CONTEXT_UPDATE_GOLDENS";
const BINARY_VARIABLE: &str = "KOGEN_CONTEXT_BIN";
const CORPUS: &str = "tests/corpus";
const GOLDENS: &str = "tests/goldens";
const ERROR_PREFIX: &str = "{\"version\":1,\"error\":{\"code\":\"";

#[derive(Debug, PartialEq)]
struct Entry {
    kind: &'static str,
    modified: Option<SystemTime>,
    detail: Vec<u8>,
}

/// Every entry under `dir` by repo-relative path, without following symlinks.
fn snapshot(root: &Path, dir: &str) -> BTreeMap<String, Entry> {
    let mut entries = BTreeMap::new();
    record(&root.join(dir), dir, &mut entries);
    entries
}

fn record(path: &Path, rel: &str, entries: &mut BTreeMap<String, Entry>) {
    let meta = fs::symlink_metadata(path).unwrap_or_else(|e| panic!("cannot stat {rel}: {e}"));
    let file_type = meta.file_type();
    let (kind, detail) = if file_type.is_symlink() {
        let target = fs::read_link(path).unwrap_or_else(|e| panic!("cannot read link {rel}: {e}"));
        (
            "symlink",
            target.to_string_lossy().into_owned().into_bytes(),
        )
    } else if file_type.is_dir() {
        ("directory", Vec::new())
    } else if file_type.is_file() {
        (
            "file",
            fs::read(path).unwrap_or_else(|e| panic!("cannot read {rel}: {e}")),
        )
    } else {
        ("other", Vec::new())
    };
    entries.insert(
        rel.to_string(),
        Entry {
            kind,
            modified: meta.modified().ok(),
            detail,
        },
    );
    if file_type.is_dir() {
        let mut names: Vec<_> = fs::read_dir(path)
            .unwrap_or_else(|e| panic!("cannot list {rel}: {e}"))
            .map(|e| e.unwrap().file_name())
            .collect();
        names.sort();
        for name in names {
            let name = name.to_string_lossy();
            record(&path.join(&*name), &format!("{rel}/{name}"), entries);
        }
    }
}

/// The first difference between two snapshots, or `None` if they are equal.
fn first_change(
    before: &BTreeMap<String, Entry>,
    after: &BTreeMap<String, Entry>,
) -> Option<String> {
    for (rel, old) in before {
        match after.get(rel) {
            None => return Some(format!("{rel} was removed")),
            Some(new) if new.kind != old.kind => {
                return Some(format!(
                    "{rel} changed from a {} to a {}",
                    old.kind, new.kind
                ));
            }
            Some(new) if new.detail != old.detail => {
                return Some(format!("{rel} changed its content or link target"));
            }
            Some(new) if new.modified != old.modified => {
                return Some(format!("{rel} changed its modification time"));
            }
            Some(_) => {}
        }
    }
    after
        .keys()
        .find(|rel| !before.contains_key(*rel))
        .map(|rel| format!("{rel} was added"))
}

/// The exit status that the version 1 contract gives a packet.
fn expected_status(stdout: &str) -> i32 {
    match stdout.strip_prefix(ERROR_PREFIX) {
        None => 0,
        Some(rest) => match rest.split('"').next() {
            Some("invalid_request" | "unsupported_version") => 2,
            _ => 1,
        },
    }
}

fn run_request(root: &Path, request: &[u8]) -> std::process::Output {
    let binary = std::env::var_os(BINARY_VARIABLE)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| env!("CARGO_BIN_EXE_kogen-context").into());
    let mut child = Command::new(&binary)
        .arg("request")
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| panic!("cannot start {}: {e}", Path::new(&binary).display()));
    child
        .stdin
        .take()
        .unwrap()
        .write_all(request)
        .expect("cannot write the request");
    child
        .wait_with_output()
        .expect("cannot wait for kogen-context")
}

fn requests(root: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(root.join(GOLDENS))
        .unwrap_or_else(|e| panic!("cannot list {GOLDENS}: {e}"))
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".request.json"))
        })
        .collect();
    files.sort();
    files
}

#[test]
fn golden_packets_match_and_the_corpus_is_unchanged() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let update = std::env::var(UPDATE_VARIABLE).is_ok_and(|v| v == "1");
    let requests = requests(root);
    assert!(!requests.is_empty(), "{GOLDENS} holds no golden request");
    let mut failures = Vec::new();
    for request_path in requests {
        let file = request_path
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let name = file.strip_suffix(".request.json").unwrap();
        let request_rel = format!("{GOLDENS}/{file}");
        let packet_rel = format!("{GOLDENS}/{name}.packet.json");
        let request = fs::read(&request_path).unwrap();

        let before = snapshot(root, CORPUS);
        let output = run_request(root, &request);
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();

        if !output.stderr.is_empty() {
            failures.push(format!(
                "{request_rel}: stderr is not empty: {:?}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        let status = expected_status(&stdout);
        if output.status.code() != Some(status) {
            failures.push(format!(
                "{request_rel}: exit status is {:?}, expected {status}; stdout: {stdout:?}",
                output.status.code()
            ));
        }
        let packet_path = root.join(&packet_rel);
        if update {
            fs::write(&packet_path, &output.stdout)
                .unwrap_or_else(|e| panic!("cannot write {packet_rel}: {e}"));
        } else {
            match fs::read(&packet_path) {
                Err(e) => failures.push(format!("{packet_rel}: cannot read the golden packet: {e}")),
                Ok(golden) if golden != output.stdout => failures.push(format!(
                    "{packet_rel}: stdout of {request_rel} differs from the golden packet\nexpected: {:?}\nactual:   {:?}",
                    String::from_utf8_lossy(&golden),
                    stdout
                )),
                Ok(_) => {}
            }
        }
        if let Some(change) = first_change(&before, &snapshot(root, CORPUS)) {
            failures.push(format!("{request_rel}: the corpus changed: {change}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
