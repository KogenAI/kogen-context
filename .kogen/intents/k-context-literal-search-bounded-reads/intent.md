# Add literal search and bounded reads

Slug: k-context-literal-search-bounded-reads
Model: not applicable — each invocation is a stateless, read-only query over the files present in one checkout; nothing is stored between runs
Acceptance:
- .kogen/intents/k-context-literal-search-bounded-reads/acceptance.feature
- features/steps/k-context-literal-search-bounded-reads__cli.js

The `kogen-context` executable (the binary of the existing `kogen-context` Cargo package, `src/main.rs`) gets its first useful standalone commands: `search` finds an exact literal inside one explicitly named checkout root, and `read` returns a bounded line range of one file inside it. Both print deterministic, bounded, compact JSON with repo-relative paths and exact line evidence. There is no index, cache or initialization step: the commands work on a fresh checkout and never create, modify or delete anything in it. Nothing outside the named root is read: symlinks are never followed by `search`, and `read` refuses any path that escapes the root lexically or through a symlink. The current placeholder behavior (printing `Hello, world!`) is removed.

Use only the Rust standard library: add no crates (the build runs `--locked --offline` and no crate registry is available), so JSON is written by hand. Add no other commands, flags, options, configuration, ignore-file handling or index.

**Interface**

`kogen-context search ROOT LITERAL`
`kogen-context read ROOT PATH START END`

ROOT is the checkout root as given (absolute, or relative to the current directory). PATH is a path relative to ROOT. START and END are 1-based inclusive line numbers.

**Output format (all outputs)**

- Success: exit status 0, stderr empty, stdout is exactly one compact JSON object (no spaces or newlines between tokens), keys in the order stated below, followed by one `\n`.
- Refusal: stdout empty, stderr is exactly `{"error":{"code":"<code>","message":"<message>"}}` followed by one `\n`. Exit status 2 for code `usage`, exit status 1 for every other code.
- JSON strings escape `"` as `\"`, `\` as `\\`, U+0008 as `\b`, U+0009 as `\t`, U+000A as `\n`, U+000C as `\f`, U+000D as `\r`, other U+0000–U+001F as `\u00XX` with lowercase hex; every other character (including `/` and non-ASCII) is written as raw UTF-8. This is byte-identical to JavaScript `JSON.stringify` for these strings.
- Paths in output are relative to the canonicalized root, use `/` as separator, and never start with `./`.

**Lines**

A file's content is split on `\n`; a final `\n` does not start an extra line, and a `\r` immediately before a `\n` is not part of the line. An empty file has 0 lines; `abc` without a trailing newline has 1 line. Line `text` is the line's first 500 characters (Unicode scalar values); a longer line is cut to 500 characters, a line of exactly 500 characters is unchanged.

**search**

- Searches every regular file under ROOT, recursively. Skipped: every directory named `.git` (at any depth) and its contents; every symlink (to a file or directory; never followed, never read); every file whose content is not valid UTF-8; entries whose names are not valid UTF-8; entries that cannot be read.
- A line matches when it contains LITERAL as an exact, case-sensitive substring. A matching line yields one match, whose `column` is the 1-based character (Unicode scalar value, not byte) position of the first occurrence of LITERAL in that line.
- Matches are ordered by `path` compared bytewise as the full repo-relative string (so `app.py` comes before `app/util.py`), then by line number ascending.
- At most 100 matches are returned: the first 100 in that order. `truncated` is `true` exactly when at least one more matching line exists, otherwise `false`.
- Output: `{"query":LITERAL,"matches":[{"path":P,"line":L,"column":C,"text":T},...],"truncated":B}`. No hits: `{"query":"hello","matches":[],"truncated":false}` with exit status 0.

**read**

- Output: `{"path":P,"start":S,"end":E,"total_lines":N,"lines":[{"line":S,"text":T},...,{"line":E,"text":T}]}` where P is the resolved file's path relative to the canonicalized root (for example `./app/../app.py` is reported as `app.py`) and N is the file's line count.
- A read returns at most 200 lines (`END - START + 1 <= 200`).

**Refusals, checked in this order (the first failing check wins)**

For `search`:
1. Not exactly 2 arguments after `search`, or the first argument is not `search`/`read` (including no arguments): code `usage`, message `usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END`.
2. LITERAL is empty: code `usage`, message `the search literal must not be empty`.
3. ROOT does not exist or is not a directory: code `root_not_directory`, message `checkout root is not a directory: <ROOT as given>`.

For `read`:
1. Not exactly 4 arguments after `read`: code `usage`, same usage message as above.
2. START or END is not a positive decimal integer (for example `0` or `x`): code `invalid_range`, message `start and end must be positive integers`.
3. START > END: code `invalid_range`, message `start line <START> is after end line <END>`.
4. END - START + 1 > 200: code `invalid_range`, message `line range <START>-<END> exceeds the 200-line read limit`.
5. ROOT does not exist or is not a directory: code `root_not_directory`, message as for `search`.
6. PATH is absolute, or lexically escapes ROOT (processing components left to right, ignoring `.`, a `..` with nothing left to remove escapes; for example `../outside/secret.txt` and `internal/../../outside.txt`): code `path_outside_root`, message `path escapes the checkout root: <PATH as given>`. This check does not depend on whether the target exists.
7. The joined path does not exist (canonicalization fails): code `not_found`, message `file not found: <PATH as given>`.
8. The canonicalized path is not inside the canonicalized ROOT (a symlink in the checkout points outside it, for example `leak.go -> ../outside/secret.txt` or `linked/secret.txt` through `linked -> ../outside`): code `path_outside_root`, message `path escapes the checkout root: <PATH as given>`. The outside file is not read.
9. The target is not a regular file (for example a directory such as `internal`): code `not_a_file`, message `not a regular file: <PATH as given>`.
10. The content is not valid UTF-8: code `not_text`, message `file is not UTF-8 text: <PATH as given>`.
11. END > the file's line count N: code `invalid_range`, message `line range <START>-<END> exceeds the file's line count <N>`.

## Decisions
- The command line is `kogen-context search ROOT LITERAL` and `kogen-context read ROOT PATH START END`; the checkout root is always named explicitly and the exact argument form is settled here (source: request)
- Results are compact JSON on stdout; refusals are JSON on stderr with a stable `code` and a readable `message`, exit status 1, or 2 for usage errors (source: request)
- Bounds are at most 100 search matches with a `truncated` flag, at most 200 lines per read and at most 500 characters of text per line (source: request)
- `search` never follows symlinks and skips `.git` directories and non-UTF-8 files; `read` resolves symlinks inside the checkout but refuses targets outside the root (source: request)

## Source comparison
- First useful standalone command of `kogen-context`: addressed by `search` and `read` in `src/main.rs`; the `Hello, world!` placeholder is superseded and removed.
- Exact literal search inside one explicitly selected checkout: addressed (search rules; scenarios "Search a Go checkout for an exact literal", "Search is case-sensitive ...").
- Bounded source reads: addressed (read rules; scenarios "Read a bounded line range ...", "A read returns at most 200 lines").
- Nothing outside the selected root is read: addressed (symlinks not followed by search; read refusals 6 and 8; scenario "Symlinks that escape the checkout are never searched or read").
- Deterministic, bounded JSON with repo-relative paths and exact line or range evidence: addressed (output format, ordering, bounds; "running the same command again prints identical bytes"; bound scenarios for 100/101 matches, 200/201 lines and 500/501 characters).
- No index and no initialization step, works on a fresh checkout: addressed (no state is written; "the checkout contents are unchanged").
- Exercised on a Go fixture and a non-Go fixture: addressed (Go fixture `go.mod`, `main.go`, `internal/greet/greet.go`; non-Go fixture `README.md`, `app.py`, `app/util.py`, `logo.bin`; both generated in temporary directories by the step file).
- Tested refusals: path traversal (`../outside/secret.txt`, `internal/../../outside.txt`, `/etc/hostname`), escaping symlinks (`leak.go`, `linked/secret.txt`), a search with no hits, missing file (`missing.go`), out-of-range lines (`0`, `x`, `3` to `2`, `7` to `8`, `8` to `8`), directories (`internal`, `internal/greet`): addressed in the scenarios listed.
- Rust 1.99.1 per `rust-toolchain.toml` and the checks `cargo fmt --all --check`, `cargo clippy --locked --offline --all-targets -- -D warnings`, `cargo test --locked --offline`, `cargo build --locked --offline` stay green: addressed (std only, no new dependencies; `rust-toolchain.toml` unchanged).
- Keep the frozen Go benchmark candidate separate: addressed — no Go benchmark code or files are added to this repository; the Go fixture exists only in temporary directories created by the acceptance steps.
- Automatic retry cause ("no candidate/intent/shape line" in the host log): a delivery-host logging condition, not product behavior; this shaping produces a complete submitted candidate and adds no product scope for it.

## Tests
- `search` returns exact, case-sensitive literal matches with repo-relative path, line, character column and text, ordered bytewise by path then line, skipping `.git`, symlinks and non-UTF-8 files, on a Go and a non-Go checkout: acceptance scenarios "Search a Go checkout for an exact literal", "Search a non-Go checkout in bytewise path order, skipping files that are not UTF-8" (scenario)
- A search with no hits succeeds with an empty `matches` array: acceptance scenario "Search is case-sensitive and a search with no hits succeeds with no matches" (scenario)
- `search` returns at most 100 matches and sets `truncated` only when more exist: acceptance scenarios for 101 and exactly 100 matching lines (scenario)
- `read` returns the requested inclusive range with `total_lines`, the normalized repo-relative path, CRLF and missing-final-newline handling: acceptance scenarios "Read a bounded line range from a Go checkout", "Read CRLF lines from a non-Go checkout", "Read reports the normalized repo-relative path ...", "Reading the full last line of a file is accepted" (scenario)
- `read` returns at most 200 lines and refuses larger ranges: acceptance scenario "A read returns at most 200 lines" (scenario)
- Line text is cut to its first 500 characters: acceptance scenario "Line text is limited to its first 500 characters" (scenario)
- Path traversal and symlinks escaping the checkout are refused and never read, by `read` and `search`: acceptance scenario "Symlinks that escape the checkout are never searched or read" and the path rows of "Invalid reads are refused with a clear error" (scenario)
- Missing files, directories, invalid or out-of-range lines and non-UTF-8 files are refused with the stated code and message: acceptance outline "Invalid reads are refused with a clear error" and scenario "Reading a file that is not UTF-8 text is refused" (scenario)
- Usage errors and invalid checkout roots are refused with the stated code, message and exit status: acceptance outline "Usage and checkout root errors are refused with a clear error" (scenario)
- Output is deterministic and the checkout is left unchanged (no index): "running the same command again prints identical bytes" and "the checkout contents are unchanged" steps in the search and read scenarios (scenario)
- Line splitting (`\n`, `\r\n`, no final newline, empty file), 500-character truncation, character column of the first occurrence, JSON string escaping, START/END validation order and lexical path escape detection: Rust unit tests in `src/` through the functions that implement them (unit)
- `search` and `read` against a real temporary directory, including an escaping symlink and the 100-match bound: Rust integration test under `tests/` running the built binary via `env!("CARGO_BIN_EXE_kogen-context")` on temporary directories created with the standard library (integration)

## Feasibility
- none
