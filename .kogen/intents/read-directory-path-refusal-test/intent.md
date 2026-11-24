# Cover directory read refusals

Slug: read-directory-path-refusal-test
Model: not applicable — this test-only change introduces no meaningful state or transitions
Acceptance:
- .kogen/intents/read-directory-path-refusal-test/acceptance.feature
- features/steps/read-directory-path-refusal-test__steps.js
- features/steps/read-directory-path-refusal-test__driver.js

Add an integration regression check in tests/cli.rs that reading an existing directory refuses with not_a_file and names the supplied directory path. The command must return status 1, write no stdout, and report the refusal on stderr. Keep the existing successful regular-file read coverage and its requested-line assertions. Implementation scope is tests/cli.rs only; do not change path resolution, refusal codes, or read behavior for regular files. No production behavior is replaced or removed.

The original request's evidence ev-9898130f identifies the directory branch of read_lines in src/main.rs and the missing direct directory-refusal coverage in tests/cli.rs, alongside existing successful reads, invalid ranges, symlinks, and file read errors. The acceptance therefore checks the strength of the tests, not a new runtime feature: status-only coverage must not pass after the refusal code changes or the message loses the supplied path, and directory-only coverage must not hide regressed requested lines for a regular file.

## Decisions
- Reading an existing directory returns status 1, writes no stdout, and reports not_a_file with the supplied directory path in stderr. (source: request)
- Restrict implementation edits to tests/cli.rs; preserve path resolution, refusal codes, regular-file read behavior, and useful existing tests. (source: request)
- Reuse the Checkout and CLI process helpers, and retain the regular-file bounded-range test; add local-directory coverage through the built CLI rather than modifying production code. (evidence: tests/cli.rs; features/steps/README.md) (source: request)
- Verify test adequacy by running the CLI integration target unchanged and with isolated production mutations only in temporary copies. This distinguishes a missing regression check from already-correct runtime behavior. (evidence: tests/cli.rs; src/main.rs; features/steps/request-invalid-utf8-packet-test__driver.js) (source: request)

## Source comparison
- Addressed: Request evidence ev-9898130f and Expected identify a missing directory-path regression check, not an implementation defect. The outcome above confines delivery to tests/cli.rs; acceptance scenarios detect the gap by exercising the candidate tests against directory-specific mutations.
- Addressed: Request Acceptance 1 requires status 1, no stdout, not_a_file, and the supplied path on stderr. The unchanged-target scenario establishes passing real CLI tests, and the four directory mutation scenarios independently challenge status, stdout, code, and path coverage. The supplied path must be checked as supplied, not merely as a resolved path.
- Addressed: Request Acceptance 1's status-only counterexample is retained as an executable wrong-implementation control and is rejected by the changed-code scenario. The omitted-path scenario separately detects missing message coverage.
- Addressed: Request Acceptance 2 and its directory-only counterexample are covered by retaining the existing successful requested-line assertions and by the regular-file-lines mutation scenario; the corresponding wrong control removes that existing coverage.
- Addressed: Request Scope and Out of scope are preserved: only tests/cli.rs is an implementation target; src/main.rs is read for mutation anchors and changed only in disposable acceptance copies. Required non-secret literals tests/cli.rs, src/main.rs, read_lines, not_a_file, and the supplied directory path semantics are retained throughout this contract.
- Omitted: no requested behavior. Conflicting or superseded product requirements: none. The proof artifacts are not a delivered CLI implementation.

## Tests
- Directory refusal includes the supplied path and not_a_file with status 1 and no stdout: add an integration regression check using a real existing directory and the built read command, and verify it rejects isolated code, path, status, and stdout regressions (regression)
- Regular-file reads still return their requested lines: retain read_returns_bounded_range_and_refuses_bad_requests and verify the CLI integration target rejects changed returned text (existing)

## Feasibility
- The existing CLI integration target passed all 22 tests and supplied the actual Rust test-runner summary format used by the observer. (probe: cargo test --locked --offline --test cli, exit 0, 11.3 s)
- Final-byte observer controls passed with the full regression check and rejected a status-only check; the good control exercises all five mutations, including deeper assertions that missing-feature red could otherwise mask. (probes: good exit 0, 18.5 s; bad exit 1, 14.8 s)
- evidence: {"id":"cli-test-observer","kind":"observer","inputs":[".kogen/intents/read-directory-path-refusal-test/controls.json","tests/cli.rs","src/main.rs"],"observers":["features/steps/read-directory-path-refusal-test__driver.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/read-directory-path-refusal-test__driver.js good","exit":0,"output":"observer accepted all controls\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/read-directory-path-refusal-test__driver.js bad","exit":1,"output":"observer rejected control\n"}]}
