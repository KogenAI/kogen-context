//! Runs the binary on every golden request of `tests/ranking/goldens/` from the
//! repository root and compares its stdout to the golden packet byte for byte.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

const GOLDENS: &str = "tests/ranking/goldens";
const REQUEST_SUFFIX: &str = ".request.json";

#[test]
fn ranking_goldens_match_the_binary_output() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut names: Vec<String> = fs::read_dir(manifest.join(GOLDENS))
        .unwrap()
        .filter_map(|entry| {
            let name = entry.unwrap().file_name().into_string().unwrap();
            name.strip_suffix(REQUEST_SUFFIX).map(str::to_string)
        })
        .collect();
    names.sort();
    assert!(!names.is_empty(), "no golden requests in {GOLDENS}");
    for name in names {
        let request = fs::read(manifest.join(format!("{GOLDENS}/{name}{REQUEST_SUFFIX}"))).unwrap();
        let packet_path = format!("{GOLDENS}/{name}.packet.json");
        let expected = fs::read(manifest.join(&packet_path))
            .unwrap_or_else(|e| panic!("cannot read {packet_path}: {e}"));
        let mut child = Command::new(env!("CARGO_BIN_EXE_kogen-context"))
            .arg("request")
            .current_dir(manifest)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(&request).unwrap();
        let output = child.wait_with_output().unwrap();
        assert_eq!(output.status.code(), Some(0), "{name}: exit status");
        assert!(
            output.stderr.is_empty(),
            "{name}: stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            output.stdout == expected,
            "{packet_path} differs\nexpected: {}\nactual:   {}",
            String::from_utf8_lossy(&expected),
            String::from_utf8_lossy(&output.stdout)
        );
    }
}
