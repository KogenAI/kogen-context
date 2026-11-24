# Test invalid UTF-8 refusal through the binary

Slug: request-invalid-utf8-packet-test
Model: not applicable — this adds coverage of a stateless refusal, not state transitions
Acceptance:
- .kogen/intents/request-invalid-utf8-packet-test/acceptance.feature
- features/steps/request-invalid-utf8-packet-test__steps.js
- features/steps/request-invalid-utf8-packet-test__driver.js

Add a binary-level regression in `tests/contract.rs` for raw non-UTF-8 request-mode input. Assert exit status 2, one valid JSON error packet on stdout with code `invalid_request` and the documented malformed-request message `request is not one valid JSON object`, empty stderr, and no input disclosure in the packet. This is a test-only change: request parsing and refusal behavior remain unchanged. Keep the existing tests; nothing is replaced or removed.

Original request:
> Evidence: ev-a02f19b3 src/request.rs refuses non-UTF-8 input as an invalid request, and its unit tests check the parser result. tests/contract.rs checks packet behavior through the binary but does not exercise raw non-UTF-8 input.
>
> Expected: Add a binary-level regression for the invalid UTF-8 refusal packet.
>
> Scope: tests/contract.rs. Out of scope: changes to request parsing or refusal behavior.
>
> Acceptance:
> 1. Send request mode bytes containing invalid UTF-8 and assert exit status 2, one valid JSON error packet on stdout with code invalid_request and the documented malformed-request message, and empty stderr. Wrong-implementation: checking only the parser result would miss changes to packet formatting, process status, or stderr.
> 2. Assert the error packet does not include the invalid input bytes. Wrong-implementation: echoing request data in the refusal would fail the packet-content assertion.

## Decisions
- Limit implementation changes to tests/contract.rs; preserve request parsing and refusal behavior. (decision: D1, round 1) (evidence: tests/contract.rs; src/request.rs) (source: request)
- Assert the error packet does not include the invalid input bytes. (decision: D2, round 1) (evidence: src/request.rs; contract/packet.schema.json) (source: request)
- Run the existing contract integration target against temporary binary-only mutations restricted to invalid UTF-8 input, so parser-only coverage cannot satisfy acceptance; use the existing JSON parser and schema validator where useful without adding dependencies. (decision: D3, round 1) (evidence: tests/contract.rs; src/request.rs; Cargo.toml; features/steps/utf8-four-byte-boundary-test__steps.js) (source: request)

## Source comparison
- Addressed: the Request's ev-a02f19b3 evidence describes parser-only coverage of non-UTF-8 input. `src/request.rs` confirms the parser test; `tests/contract.rs` currently sends only UTF-8 strings or JSON examples. The complete contract adds the binary regression in that file and makes parser-only coverage fail the transport-mutation scenarios.
- Addressed: Request acceptance 1 maps to the new Rust regression and the executable acceptance cases for exit status, JSON formatting, packet count, stderr, code, and message. The malformed-request literal comes from `contract/README.md` and `src/request.rs`; the expected status, stdout boundary, and empty stderr remain unchanged.
- Addressed: Request acceptance 2 maps to a whole-packet non-disclosure assertion and the input-echo mutation, including an echo outside the error message. Checking only the error code and message is insufficient.
- Addressed: the Request's exact slug, Intent paths, step prefix, and `features/steps/` ownership are preserved. Temporary mutations and the bounded correct/wrong overlays are verification artifacts, not implementation edits. No production path is in scope. No requested behavior is omitted, conflicting, or superseded.

## Tests
- Invalid UTF-8 refusal packet: add a raw-byte binary regression to tests/contract.rs asserting process status, one valid JSON error packet, documented code and message, and empty stderr; verify it rejects transport-only mutants using the existing contract integration target (regression)
- Input non-disclosure: assert the whole error packet does not include invalid request data and verify the regression rejects a binary mutant that echoes the input outside the error message (regression)

## Feasibility
- evidence: {"id":"contract-mutation-observer","kind":"observer","inputs":[".kogen/intents/request-invalid-utf8-packet-test/observer-good.rs",".kogen/intents/request-invalid-utf8-packet-test/observer-bad.rs","src/request.rs","tests/contract.rs","Cargo.toml","Cargo.lock","rust-toolchain.toml"],"observers":["features/steps/request-invalid-utf8-packet-test__driver.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/request-invalid-utf8-packet-test__driver.js .kogen/intents/request-invalid-utf8-packet-test/observer-good.rs","exit":0,"output":"observer accepted all controls\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/request-invalid-utf8-packet-test__driver.js .kogen/intents/request-invalid-utf8-packet-test/observer-bad.rs","exit":1,"output":"observer rejected control\n"}]}
