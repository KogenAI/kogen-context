# Allow io_error in the version 1 packet schema

Slug: packet-schema-allows-io-error
Model: not applicable — validity is a stateless predicate on one packet
Acceptance:
- .kogen/intents/packet-schema-allows-io-error/acceptance.feature
- features/steps/packet-schema-allows-io-error__steps.js

In `contract/packet.schema.json`, extend the version 1 error packet's `error.code` enum (the branch referenced by the top-level `oneOf`) to include `io_error`. A version 1 error packet with that code and a nonempty string message must validate. Keep all existing codes, reject unknown codes, and leave the rest of the packet schema unchanged. Add a regression check in `tests/contract.rs` that validates a failed-read packet against the whole packet schema. These are the only implementation paths in scope; do not change runtime error codes, read behavior, or the request schema. No codes or tests are removed.

## Decisions
- Extend only the closed error-code enum in the version 1 packet schema. Keep `invalid_request`, `unsupported_version`, `invalid_range`, `root_not_directory`, `path_outside_root`, `not_found`, `not_a_file`, and `not_text`; unknown codes remain invalid. (evidence: contract/packet.schema.json; src/main.rs; tests/cli.rs) (source: request)
- Acceptance validates the actual output of `kogen-context request` against the complete packet schema. It uses the existing Linux procfs failure trigger from `tests/cli.rs`; this scenario requires Linux with a standard `/proc/self/mem`. Compare the observed message by its stable prefix rather than pinning the OS diagnostic. The independent schema examples exercise code validation with the same nonempty message for old and unknown codes. (evidence: tests/cli.rs; contract/README.md; src/main.rs; contract/packet.schema.json) (source: request)

## Source comparison
- Addressed: ev-52ad37b6 identifies the mismatch between `src/main.rs` and `contract/packet.schema.json`, with the I/O refusal already covered by `tests/cli.rs`. The failed-read scenario validates the real version 1 stdout packet against that exact packet schema, not a different schema or an isolated branch.
- Addressed: request acceptance 2 maps to both the existing-code and unknown-code scenarios. Replacing the enum with arbitrary string acceptance would admit the `usage` packet (the existing counterexample in `tests/contract.rs`).
- Addressed: `tests/contract.rs` gains the requested regression. The implementation scope is exactly `contract/packet.schema.json` and `tests/contract.rs`; runtime codes and read behavior are preserved, not superseded. No requested behavior is omitted.

## Tests
- A version 1 failed-read packet with code `io_error` and a nonempty message validates: add a regression in `tests/contract.rs` that checks the packet against the complete packet schema; run `cargo test --locked --offline --test contract` (regression)
- The failed-read refusal emitted to stdout validates: run the failed-read request scenario and validate the resulting complete packet (scenario)
- Every previously supported code remains valid: validate the listed version 1 packets in the existing-code scenario (scenario)
- Unknown error codes remain invalid: keep `validator_rejects_a_known_bad_packet` in `tests/contract.rs` (existing)

## Feasibility
- The Linux procfs trigger produced the version 1 refusal shown in `acceptance.feature` with status 1 after `cargo build --locked --offline --bin kogen-context` on pinned Rust 1.99.1 (initial probe: exit 0, 23.1 s).
- Acceptance uses the configured Node v24.21.0 and Cucumber 13.3.0, plus local Python 3.12.3 with installed `jsonschema` 4.10.3 and `Draft202012Validator`; no build or Rust test dependency is added. Both final-byte observer checks reached validation and returned the designated outcomes (observer probe: exit 0, 12.9 s).
- Generated the scope-limited controls locally, then formatted the Rust regression after the first formatting check found a layout difference. In scratch, the final regression failed on the original schema at `assert_valid`, then all six contract tests passed with the corrected enum (final focused probe: exit 0, 13.1 s).
- evidence: {"id":"packet-observer","kind":"observer","inputs":["contract/packet.schema.json","Cargo.toml","Cargo.lock","rust-toolchain.toml","src/main.rs","src/request.rs"],"observers":["features/steps/packet-schema-allows-io-error__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/packet-schema-allows-io-error__steps.js not_found","exit":0,"output":"observer validated the packet\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/packet-schema-allows-io-error__steps.js usage","exit":1,"output":"packet with code usage: expected valid against contract/packet.schema.json, got invalid\n"}]}
