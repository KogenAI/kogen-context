# Refuse non-UTF-8 search and read arguments

Slug: cli-refuses-arguments-that-are-not-utf-8
Model: not applicable — the change is an argument check of a stateless command-line program with no state that persists between runs
Acceptance:
- .kogen/intents/cli-refuses-arguments-that-are-not-utf-8/acceptance.feature
- features/steps/cli-refuses-arguments-that-are-not-utf-8__steps.js

The unversioned `kogen-context search ROOT LITERAL` and `kogen-context read ROOT PATH START END` commands convert their LITERAL and PATH arguments with `to_string_lossy`, so every byte that is not valid UTF-8 becomes U+FFFD and the commands run a different request from the one typed. This change makes both commands refuse such an argument as a usage error before any file is looked at.

## Current behavior being replaced

Observed with a build made by `cargo build --locked --offline`, the byte 0xFF passed with bash `$'\xff'`, in a root `t` holding `d/a.txt` with the text `café x`:
- `kogen-context search t $'\xff'` prints `{"query":"` followed by U+FFFD, then `","matches":[],"truncated":false}` and exits 0. The query echoed back is not the query that was given, and a file that held a real U+FFFD would match.
- `kogen-context read t $'d/\xff' 1 1` prints on stderr `{"error":{"code":"not_found","message":"file not found: d/` followed by U+FFFD and `"}}`, status 1, for a path the caller never wrote.

In `run` in `src/main.rs`, the search branch has `let literal = args[2].to_string_lossy();` before the empty-literal check, and the read branch passes `&args[2].to_string_lossy()` as the path (START and END, arguments 3 and 4, are converted the same way and keep that conversion: when they are not decimal digits they are refused as `invalid_range`). `Refusal::exit_status` gives status 2 to the code `usage`; the existing usage refusals of `run` are the pattern to follow. A file whose name is not UTF-8 is never listed by `walk_files` (it uses `into_string`) and file contents must be valid UTF-8 to be searched or read, so no valid request can need such an argument.

## Required change

In `run` in `src/main.rs`, replace the lossy conversion of the search LITERAL and of the read PATH by a check that the argument is valid UTF-8 (`OsStr::to_str`). The check runs in `run`, before `search` or `read` is called, so before `checkout_root` and before any other refusal that depends on the files or the root:

1. `search ROOT LITERAL` where LITERAL is not valid UTF-8: exit status 2, nothing on stdout, exactly one line on stderr, `{"error":{"code":"usage","message":"the search literal is not valid UTF-8"}}` and a newline. This check comes before the empty-literal check.
2. `read ROOT PATH START END` where PATH is not valid UTF-8: exit status 2, nothing on stdout, exactly one line on stderr, `{"error":{"code":"usage","message":"the read path is not valid UTF-8"}}` and a newline. This check comes before the range validation.
3. A non-UTF-8 literal with a ROOT that does not exist gives the refusal of rule 1 (status 2), not `root_not_directory` (status 1).

Arguments that are valid UTF-8 behave exactly as now, including the empty-literal refusal and the order of the other refusals. No change to `request`, the schemas, the examples or any packet (the `request` command takes JSON strings, which are always UTF-8); no new crate, setting or environment variable; everything builds and tests with `--locked --offline`. `contract/README.md` needs no change.

Add model-free Rust integration tests in `tests/cli.rs`, next to `search_refuses_an_empty_literal`, using the existing `Checkout` helper. The existing `run` takes `&str` arguments, so these tests call `Command::new(env!("CARGO_BIN_EXE_kogen-context"))` directly, build the argument with `std::os::unix::ffi::OsStrExt::from_bytes` and read `.output()`. All test names start with `utf8_argument_`, so `cargo test --locked --offline --test cli utf8_argument` runs them:
- `utf8_argument_search_literal_is_refused`: a `Checkout` with `a.txt` holding `bad ` followed by the bytes 0xEF 0xBF 0xBD and `\n`; `search <root>` with the literal made of the single byte 0xFF; status exactly 2, stdout empty, stderr exactly the line of rule 1 and a newline.
- `utf8_argument_read_path_is_refused`: a `Checkout` with `d/b.txt` holding `a`; `read <root>` with the path made of the bytes `d/` and 0xFF, then `1` and `1`; status exactly 2, stdout empty, stderr exactly the line of rule 2 and a newline.
- `utf8_argument_refusal_comes_before_the_root_check`: `search` with the root `Checkout` root joined with `missing` and the literal made of the byte 0xFF; status exactly 2 and stderr exactly the line of rule 1.

## Decisions
- Both checks live in `run` in `src/main.rs` and use `OsStr::to_str`, so they precede `checkout_root` (called inside `search` and `read`) and reuse the existing `usage` refusal with exit status 2. (decision: D1, round 1) (constraint: no new crate, setting or environment variable) (constraint: valid UTF-8 arguments behave exactly as now) (evidence: src/main.rs; tests/cli.rs) (source: request)
- The read path check also precedes the range validation, so a non-UTF-8 path with an invalid range is the path refusal; the request leaves this combination open. (decision: D2, round 1) (evidence: src/main.rs) (assumption: the user accepts the path refusal winning over `invalid_range` when both apply) (source: request)
- Acceptance drives the built binary through `sh` with the argument bytes built by `printf`, since Node cannot pass invalid UTF-8 arguments to a child process, and does not run the `utf8_argument_` Rust tests by name because they do not exist before the Build; those tests are required by this Intent and run by the project's own `cargo test` check. (decision: D3, round 1) (evidence: tests/cli.rs; features/steps/stdout-write-failure-exits-without-panic__steps.js) (assumption: acceptance needs a POSIX `sh` with `printf` supporting octal escapes, so it assumes a Linux or macOS host) (source: request)
- A fourth acceptance scenario pins that a valid UTF-8 literal still searches as before. (decision: D4, round 1) (evidence: src/main.rs) (assumption: the extra scenario is within the request's constraint that valid arguments behave exactly as now) (source: request)

## Source comparison
- Request expectation 1 (search literal refusal, status 2, empty stdout, exact stderr line): addressed by Required change rule 1, scenario "A non-UTF-8 search literal is refused", test `utf8_argument_search_literal_is_refused`.
- Request expectation 2 (read path refusal): addressed by rule 2, scenario "A non-UTF-8 read path is refused", test `utf8_argument_read_path_is_refused`.
- Request expectation 3 (refusal before the root check): addressed by rule 3, scenario "The refusal does not look at the root", test `utf8_argument_refusal_comes_before_the_root_check`.
- Constraint that valid UTF-8 arguments are unchanged: addressed by the scenario "A valid UTF-8 literal still searches" and the existing tests.
- `request`, schemas, examples, packets and `contract/README.md`: unchanged by this Intent.
- START and END lossy conversion: kept, as the request states.

## Tests
- A non-UTF-8 search literal is refused with the usage line and status 2: `utf8_argument_search_literal_is_refused` in tests/cli.rs (integration)
- A non-UTF-8 read path is refused with the usage line and status 2: `utf8_argument_read_path_is_refused` in tests/cli.rs (integration)
- The refusal comes before the root check: `utf8_argument_refusal_comes_before_the_root_check` in tests/cli.rs (integration)
- Valid UTF-8 arguments and the empty-literal refusal are unchanged: the existing tests in tests/cli.rs (existing)

## Feasibility
- none
