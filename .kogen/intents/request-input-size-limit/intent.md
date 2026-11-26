# Bound request input to 1 MiB

Slug: request-input-size-limit
Model: not applicable — a single stdin invocation checks a byte count and has no persistent state.
Acceptance:
- .kogen/intents/request-input-size-limit/acceptance.feature
- features/steps/request-input-size-limit__steps.js

`kogen-context request` accepts at most 1 MiB (1048576 bytes) from standard input. Count the entire stream in bytes, including JSON whitespace. Up to and including the limit, use the entire input and keep the existing request pipeline and packet/status behavior. Larger input must not be fully buffered or parsed as a request; the size refusal takes precedence over JSON, version, schema and operation handling.

In `src/request.rs`, replace the unbounded stdin buffer fill in `serve_stdin` with a bounded read that can distinguish the limit from an excess byte. Do not truncate to the limit and then parse a prefix, or read all of an arbitrarily large stream into memory and only then check its length. A read capped at the limit plus one byte suffices; stopping at the first excess byte is not a caller-visible requirement. Keep the documented behavior when stdout cannot be written. In `contract/README.md`, replace the unconditional read-to-end statement with the inclusive input bound and oversized refusal. In `tests/contract.rs`, add the CLI boundary regression using valid JSON padded with whitespace; use a recognizable input value for the non-echo check. Use file-backed stdin or otherwise avoid requiring the child to consume all supplied input before returning a packet. The version 1 request schema and packet output limits are out of scope.

## Decisions
- A request of exactly 1 MiB (1048576 bytes) is handled according to its JSON contents. (decision: D1, round 1) (constraint: Count bytes of the entire stdin stream, including whitespace; check the bound before JSON processing.) (evidence: src/request.rs; contract/README.md) (source: request)
- Input larger than 1 MiB (1048577 bytes or more) returns one invalid_request packet, exits with status 2, and does not echo input bytes. (decision: D2, round 1) (constraint: Do not fully buffer oversized input or parse it as a request; do not assert exact refusal wording or whether reading stops at the first excess byte.) (evidence: src/request.rs; contract/README.md) (source: request)
- Ordinary valid requests, malformed JSON, and well-formed JSON that violates the existing version 1 request schema retain their current packet and exit status behavior. (decision: D3, round 1) (constraint: Do not change the version 1 request schema or limit packet output.) (evidence: src/request.rs; tests/contract.rs; contract/README.md) (source: request)
- Verify bounded buffering by human source review of the final `serve_stdin` path: the storage bound must apply before accumulating input for JSON. The required packet/status assertions cannot distinguish a bounded read from buffering all stdin and then refusing; the request deliberately does not pin early closure or the consumption point. (evidence: src/request.rs; tests/contract.rs) (source: request)
- Shaper choice: 1048575 and 2097152 are test fixture sizes (one byte below the inclusive bound and a larger oversized stream), not additional thresholds. The 10000, 15000, 30000, 40000, 90000 and 100000 millisecond deadlines and 8 MiB capture allowance are test harness settings only, not CLI response-time or output guarantees. (source: request)

## Source comparison
- Addressed: ev-92d4cea8 identifies the unbounded `serve_stdin` read and the unconditional read-to-end text in `contract/README.md`. Both are superseded by the bounded input contract above; human source review verifies the memory bound. The implementation scope is `src/request.rs`, `tests/contract.rs` and `contract/README.md`.
- Addressed: request acceptance 1 maps to the padded success checks at 1048576 bytes and one byte below in `acceptance.feature`; `controls.json` rejects an exclusive limit.
- Addressed: request acceptance 2 maps to valid JSON inputs at 1048577 bytes and above in `acceptance.feature`. It checks a single valid JSON response with `invalid_request`, status 2 and no input echo; intentionally omitted are message wording and how far stdin is consumed. `controls.json` checks oversized parsing, missing JSON and echoed data as separate wrong outcomes.
- Addressed: request acceptance 3 maps to the unpadded success, malformed JSON and version 1 schema refusal in `acceptance.feature`, with existing contract and parser cases retained. `controls.json` checks malformed-JSON and schema regressions. No request-schema change is included. The long-literal search checks that an in-bound request still returns its complete packet even when the packet is larger than the input limit; the output-cap control demonstrates that distinction.

## Tests
- Below and exactly at 1 MiB, valid JSON is handled normally: add a `tests/contract.rs` case using `kogen-context request` and compare its success status and packet to the unpadded request (integration)
- Oversized input is refused and yields one non-disclosing packet: extend that `tests/contract.rs` test to include the first excess byte and a larger input, asserting JSON validity, `invalid_request`, status 2 and no echo (regression)
- Ordinary valid requests and JSON or schema refusals keep their packet and exit status behavior: retain `every_example_runs_to_its_packet`, `schema_refusals_name_the_offending_field`, and the existing `src/request.rs` JSON and status tests (existing)
- End-to-end inclusive limit, oversized refusal, compatibility and no packet output cap: `acceptance.feature` runs the built CLI with fixture checkout inputs and checks packets and exit statuses (scenario)

## Feasibility
- On Rust 1.99.1, the offline build and the six existing `tests/contract.rs` tests passed. The baseline CLI returned search success even for padded oversized JSON; malformed and schema-invalid packets matched the compatibility expectations. A search with exactly 1048576 input bytes and an extended literal returned status 0 with a complete 1048620-byte packet. The scenario uses the configured Cucumber and Node runner, Cargo-built debug binary and `contract/examples/checkout` fixture, with no service access.
- evidence: {"id":"request-packet-observer","kind":"observer","inputs":[],"observers":["features/steps/request-input-size-limit__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/request-input-size-limit__steps.js good","exit":0,"output":"observer accepted valid packets\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/request-input-size-limit__steps.js bad","exit":1,"output":"observer rejected invalid packets\n"}]}
