use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn raw_input_refusal() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_kogen-context"))
        .arg("request")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn().unwrap();
    child.stdin.take().unwrap().write_all(b"{\"version\":1,\"root\":\"observer-private-\xff\"}").unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stderr.is_empty());
    let text = std::str::from_utf8(&output.stdout).unwrap();
    assert_eq!(text.lines().count(), 1);
    assert!(text.starts_with("{\"version\":1,\"error\":{\"code\":\"invalid_request\",\"message\":\"request is not one valid JSON object\"}"));
}
