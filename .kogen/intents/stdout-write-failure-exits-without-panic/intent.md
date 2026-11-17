# Report an unwritable stdout as a refusal

Slug: stdout-write-failure-exits-without-panic
Model: not applicable — the change is a write-error path of a stateless command-line program with no state that persists between runs
Acceptance:
- .kogen/intents/stdout-write-failure-exits-without-panic/acceptance.feature
- features/steps/stdout-write-failure-exits-without-panic__steps.js

When `kogen-context` cannot write its result to standard output (a full disk, a closed or broken destination), it currently panics with `failed printing to stdout: <os error>` and exits with status 101, because `serve_stdin` in `src/request.rs` and `main` in `src/main.rs` print with `println!`. This change makes every command that prints a result (`request`, `search`, `read`, `version`) report an unwritable standard output as an ordinary refusal with exit status 1 and no panic. When the write succeeds, every output, exit status and packet stays exactly as it is.

## Current behavior being replaced

Built with `cargo build --locked --offline`, with standard output redirected to /dev/full (which fails every write with `No space left on device`), each of these panics and exits 101:

- `echo '{"version":1,"root":".","operation":"search","literal":"x"}' | kogen-context request >/dev/full`
- `kogen-context version >/dev/full`
- `kogen-context search contract/examples/checkout fn >/dev/full`

The stderr of the panic is `thread 'main' (435308) panicked at /rustc/58cf8f9c35b355199727627d07ae34a4e2846d67/library/std/src/io/stdio.rs:1168:9:`, then `failed printing to stdout: No space left on device (os error 28)`, then ``note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace``. The sources of the panic are `println!("{packet}")` in `serve_stdin` (followed by `ExitCode::from(status)`), and `println!("{}", version_line())` and `println!("{output}")` in `main`; the refusal branch of `main` already writes its JSON line with `eprintln!`. After this change none of these `println!` calls remains and none of the three commands above panics. The `request` acceptance scenario writes the request text `{"version":1,"root":"` followed by the path of the checkout root, then `","operation":"search","literal":"x"}`, as the content of a `request.json` on the standard input of `kogen-context request`.

## Required change

In `src/main.rs`, add a function that writes a text and a final `\n` to standard output, flushes, and returns whether both writes and the flush succeeded (`pub(crate) fn write_line(text: &str) -> bool`, importable from `src/request.rs`). `main` (the `version_line()` text and the output of `run`) and `serve_stdin` use it instead of `println!`; nothing in these paths can panic on a failed write.

- `request`: when the packet cannot be written, exit with status 1 and write nothing to stderr (the contract keeps stderr empty for `request`, and the packet that would carry the error cannot be written either).
- `search`, `read` and `version`: when the output cannot be written, write exactly one line to stderr, `{"error":{"code":"output_failed","message":"cannot write to standard output"}}` followed by `\n`, and exit with status 1 (the existing `Refusal::exit_status` rule for a code other than `usage`).

No new crate, setting or environment variable; everything builds and tests with `--locked --offline`. `contract/packet.schema.json` and the examples stay unchanged: `output_failed` appears only on stderr of the unversioned commands and no packet carries it. `contract/README.md` gains exactly one sentence in its Invocation section: `When standard output cannot be written, the command exits with status 1 and, for `request`, writes nothing to stderr.`

Add model-free Rust integration tests in `tests/cli.rs`, next to `search_refuses_an_empty_literal`, using the existing `Checkout` helper and `env!("CARGO_BIN_EXE_kogen-context")`. Each starts the binary with standard output set to a file opened for writing on `/dev/full` (`Stdio::from`), and returns at once, passing, when `/dev/full` does not exist (macOS). All test names start with `stdout_failure_`, so `cargo test --locked --offline --test cli stdout_failure` runs them: `stdout_failure_request_exits_1_with_empty_stderr`, `stdout_failure_search_writes_one_json_line_on_stderr`, `stdout_failure_version_writes_one_json_line_on_stderr`.

## Decisions
- A single `write_line` function in `src/main.rs` replaces every `println!` of a result, and the `search`/`read`/`version` failure reuses the existing refusal path of `main` with the code `output_failed`, so the stderr line and exit status 1 come from `Refusal::exit_status`. (evidence: src/main.rs; src/request.rs) (source: request)
- `request` exits 1 with an empty stderr on an unwritable standard output, as the contract keeps stderr empty for it. (evidence: src/request.rs; contract/README.md) (source: request)
- The acceptance scenarios drive the built binary directly with standard output on `/dev/full` instead of running the new Rust tests by name, since those tests do not exist before the Build; the Rust tests in `tests/cli.rs` are required by this Intent and run by the project's own `cargo test` check. (decision: D3, round 1) (evidence: tests/cli.rs) (assumption: acceptance on a host without /dev/full fails, as the feature targets Linux hosts) (source: request)
- `read` is covered by an acceptance scenario because it shares the output path of `search`, though the Rust tests name only request, search and version. (decision: D4, round 1) (evidence: src/main.rs) (assumption: an extra read scenario is within the request's "every command that prints a result") (source: request)
- A single write_line function in src/main.rs replaces every println! of a result; search/read/version failure reuses main's refusal path with code output_failed (exit 1 via Refusal::exit_status); request exits 1 with empty stderr. (decision: D1, round 1) (constraint: no new crate, setting or env var) (constraint: packet schema and examples unchanged) (evidence: src/main.rs; src/request.rs; contract/README.md) (assumption: A scratch copy built with cargo and run with stdout on /dev/full showed exit 1 and the expected stderr for request, search, version and read; this was not retained by Kogen.) (source: request)
- Acceptance drives the built binary with stdout on /dev/full rather than running the not-yet-existing stdout_failure_ Rust tests by name; those tests are required by the Intent text. (decision: D2, round 1) (evidence: tests/cli.rs) (assumption: Acceptance needs /dev/full, so it assumes a Linux host.) (source: request)

## Source comparison
- Addressed: `request`, `search`, `read` and `version` report an unwritable standard output with status 1 and no panic (acceptance.feature scenarios 1 to 4).
- Addressed: the `contract/README.md` Invocation sentence (acceptance.feature, last scenario).
- Unchanged by decision: `contract/packet.schema.json`, the examples, and every successful output (covered by the existing tests in `tests/cli.rs`, `tests/corpus.rs` and the contract test).

## Tests
- request packet write failure exits 1 with empty stderr: stdout_failure_request_exits_1_with_empty_stderr (integration)
- search output write failure writes one output_failed JSON line on stderr and exits 1: stdout_failure_search_writes_one_json_line_on_stderr (integration)
- version output write failure writes the same line and exits 1: stdout_failure_version_writes_one_json_line_on_stderr (integration)
- successful writes keep every output, status and packet: existing tests in tests/cli.rs and tests/corpus.rs (existing)
- the contract README sentence: the last scenario of acceptance.feature (scenario)

## Feasibility
- none
