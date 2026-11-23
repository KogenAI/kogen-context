# Report read I/O failures apart from non-text files

Slug: read-distinguishes-io-errors-from-non-text
Model: not applicable — the change is an error-mapping path of a stateless command-line read with no state that persists between runs
Acceptance:
- .kogen/intents/read-distinguishes-io-errors-from-non-text/acceptance.feature
- features/steps/read-distinguishes-io-errors-from-non-text__steps.js

In `src/main.rs`, `read_lines` (used by `kogen-context read ROOT PATH START END`) maps both a failure to open or read the file and invalid UTF-8 content to the same `not_text` refusal, whose message is `file is not UTF-8 text: <path>`. After this change `not_text` is reserved for content that is not valid UTF-8. A failure to open the file, or an I/O error while reading it, is refused as an I/O error: a refusal whose code is not `not_text` and whose message names the affected path (the path as given to `read`) and the operating-system error. Like every refusal other than `usage`, both kinds exit with status 1 and write one JSON line `{"error":{"code":...,"message":...}}` to stderr.

Out of scope: search behavior (including how `search` and ranking skip unreadable or non-text files, which keep using `read_utf8_blocks` unchanged in behavior) and the request and packet schemas. A successful read keeps returning exactly the same packet: the requested lines and `total_lines`.

Add `tests/cli.rs` integration tests next to the other `read_` tests, using its `Checkout` helper and `env!("CARGO_BIN_EXE_kogen-context")`: invalid UTF-8 content gives `not_text` naming the path; a file the user cannot read (mode 000, skipped when the process can still read it, for example as root) gives the I/O refusal naming the path; a read error after opening (`read /proc/self mem`, Linux only, returns at once elsewhere) gives the I/O refusal; and the successful packet is unchanged.

## Decisions
- The I/O refusal uses the code `io_error` and the message `cannot read file: <path>: <os error>`; `not_text` keeps its code and message for invalid UTF-8 only, and an incomplete UTF-8 sequence at end of file is still invalid content. Acceptance asserts only that the code is not `not_text` and that the message names the path, so the exact code name is the Builder's recommended default, not a tested literal. (constraint: not_text only for invalid UTF-8 content) (constraint: the I/O refusal message names the path) (evidence: src/main.rs; tests/cli.rs) (assumption: the code name io_error and the message wording are chosen here, the request only asks for an I/O error naming the path) (source: request)
- `read_utf8_blocks` keeps its `Option<String>` signature for `search` and ranking callers; a new function returning `Result<String, ReadFailure>` carries the distinction for `read_lines`, so only `src/main.rs` and `tests/cli.rs` change. (constraint: search behavior unchanged) (evidence: src/main.rs; src/rank.rs) (source: request)
- Acceptance drives the built binary and injects failures with real filesystem conditions: a mode-000 file for an open failure and `read /proc/self mem` (EIO on first read, as a scratch run showed) for a read failure after opening; it assumes a Linux host and a non-root user for the open failure. (evidence: src/main.rs; features/steps/stdout-write-failure-exits-without-panic__steps.js) (assumption: acceptance runs on Linux as a non-root user; a scratch run showed the unchanged tree reports not_text for both injections and the corrected tree reports an I/O refusal; this was not retained by Kogen) (source: request)
- Open and read failures in read_lines are refused with code io_error and message 'cannot read file: <path>: <os error>'; not_text is kept for invalid UTF-8 only. (decision: D1, round 1) (constraint: not_text only for invalid UTF-8) (constraint: io_error names the path) (evidence: src/main.rs; tests/cli.rs) (assumption: The code name io_error and message wording are chosen by the shaper.) (source: request)
- read_utf8_blocks keeps its Option signature for search and ranking; a new Result-returning function serves read_lines. (decision: D2, round 1) (constraint: search behavior unchanged) (evidence: src/main.rs; src/rank.rs) (source: request)
- Acceptance injects failures with a mode-000 file (open) and read /proc/self mem (read EIO), on Linux as non-root. (decision: D3, round 1) (evidence: features/steps/stdout-write-failure-exits-without-panic__steps.js) (assumption: A scratch run (not retained by Kogen) showed io_error for both with the corrected code and not_text on the unchanged tree; assumes Linux and non-root.) (source: request)
- The I/O refusal uses io_error with message 'cannot read file: <path>: <os error>' as the recommended default, but acceptance asserts only that the code is not not_text and the message names the path. (decision: D4, round 1) (constraint: not_text only for invalid UTF-8) (constraint: I/O refusal message names the path) (evidence: src/main.rs; tests/cli.rs) (assumption: The code name io_error is chosen by the shaper and not asserted.) (source: request)
- Acceptance injects failures with a mode-000 file (open) and read /proc/self mem (read EIO), on Linux as non-root. (decision: D5, round 1) (evidence: features/steps/stdout-write-failure-exits-without-panic__steps.js) (assumption: A scratch run (not retained by Kogen) showed an I/O refusal for both with the corrected code and not_text on the unchanged tree; assumes Linux and non-root.) (source: request)

## Source comparison
- Addressed: invalid UTF-8 content still gives `not_text` naming the path (acceptance.feature scenario 1).
- Addressed: file-open and read failures give an I/O refusal naming the path, never `not_text` (scenarios 2 and 3).
- Addressed: a successful read returns the same lines and `total_lines` (scenario 4).
- Out of scope and unchanged: search behavior, request and packet schemas.

## Tests
- invalid UTF-8 content is refused as not_text naming the path: read_refuses_invalid_utf8_as_not_text in tests/cli.rs (integration)
- an unreadable file is refused as an I/O error naming the path: read_refuses_unreadable_file_as_io_error in tests/cli.rs (integration)
- a read error after opening is refused as an I/O error naming the path: read_refuses_read_failure_as_io_error in tests/cli.rs (integration)
- a successful read returns the requested lines and total line count: existing read_returns_bounded_range_and_refuses_bad_requests in tests/cli.rs, plus the last scenario of acceptance.feature (existing)

## Feasibility
- none
