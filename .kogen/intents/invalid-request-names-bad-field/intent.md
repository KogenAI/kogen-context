# Name the bad field in invalid-request refusals

Slug: invalid-request-names-bad-field
Model: not applicable — the change only rewrites the message of a stateless request refusal; no state persists between runs
Acceptance:
- .kogen/intents/invalid-request-names-bad-field/acceptance.feature
- features/steps/invalid-request-names-bad-field__steps.js

`kogen-context request` answers every request that fails the version 1 request schema with the same message, `request does not match the version 1 request schema`. This change makes that message identify the first offending field and its problem, so a caller can tell an unknown operation, an unknown member and an out-of-range limit apart. The whole request is never put in the message.

The refusal code `invalid_request`, exit status 2, the packet shape, the validation precedence (invalid JSON first, then the version, then the schema) and the set of accepted requests do not change. No request field is added. Search and read behavior do not change. The message of a malformed-JSON refusal (`request is not one valid JSON object`) and of an unsupported version (`request version must be 1`) stay as they are.

## Required change

In `src/request.rs`, `matches_schema` reports the first offending field and its problem instead of `None`, and `parse` builds the `invalid_request` message from it. The message names the offending field and its problem; its exact wording is the builder's choice. The first offending field is the first one that the current checks reach, in this order:

1. `operation`: missing, not a string, or a string other than `search` or `read`. For an unsupported string the message names `operation` and the unsupported value.
2. A top-level member that the operation does not allow, in request order. The message names that member.
3. `limits` that is not an object.
4. A member of `limits` that the operation does not allow. The message names that limit member.
5. The value checks: `root`, then `limits.max_line_chars`, then for a search `order`, `literal`, `limits.max_matches`, and for a read `path`, `start`, `end`, `limits.max_lines`. For an out-of-range limit the message names the limit and its accepted bound (the default maximum of that limit: 100 `max_matches`, 500 `max_line_chars`, 200 `max_lines`; the minimum is 1).

The same set of requests is refused as before. The unit tests of `src/request.rs` that compared the refusal message with the generic text are updated to expect the new messages. `contract/README.md` documents the message behavior in the request contract: an `invalid_request` refusal for a schema mismatch names the first offending field and its problem, in the order above, and never echoes the request. `tests/contract.rs` gets an integration check that runs the binary on an unknown operation, an unknown member and an out-of-range limit and checks the code, the status 2 and that the message names the field. `tests/goldens/` is changed only if an existing golden packet holds a schema refusal.

## Decisions
- A schema refusal keeps the code `invalid_request` and exit status 2; only its message changes. (decision: D1, round 1) (constraint: code invalid_request and exit status 2 unchanged) (evidence: src/request.rs; contract/README.md) (source: request)
- The first offending field follows the order of the checks that `matches_schema` already runs: operation, top-level members, `limits` shape, `limits` members, then the value checks. (decision: D2, round 1) (constraint: the set of accepted requests does not change) (evidence: src/request.rs) (source: request)
- Messages carry only the field name, the unsupported operation value or the accepted bound; the request is never echoed. (decision: D3, round 1) (constraint: the whole request is not included in the message) (evidence: src/request.rs) (source: request)
- The wording of the problem text is the builder's choice; acceptance checks only that the message names the field and the unsupported value or bound. (decision: D4, round 1) (evidence: src/request.rs; tests/contract.rs) (assumption: the user accepts the builder choosing the problem wording) (source: request)
- Malformed JSON and unsupported version refusals are not routed through the schema diagnostics. (decision: D5, round 1) (constraint: validation precedence unchanged: JSON, then version, then schema) (evidence: src/request.rs) (source: request)

## Source comparison
- Request acceptance 1 (unknown operation names `operation` and the value): scenario "An unknown operation is named with its unsupported value".
- Request acceptance 2 (unknown top-level member named): scenario "An unknown top-level member is named".
- Request acceptance 3 (limit and accepted bound): scenario outline "An out-of-range limit is named with its accepted bound" over `max_matches`, `max_line_chars` and `max_lines`.
- Request acceptance 4 (malformed JSON and unsupported version unchanged): scenarios "Malformed JSON keeps its refusal" and "An unsupported version wins over schema problems".
- First offending field and no echo of the request: scenarios "The first offending field is the one named", "An unknown operation wins over a later offending field" and the marker-root checks.
- Unchanged accepted requests: scenario "A valid request is still accepted".
- Earlier Intents' acceptance (for example `k-context-ranked-scoped-results`) still quote the generic message; they describe the superseded message and are not rerun by this Intent.
- Out of scope and untouched: accepted requests, request fields, version precedence, search and read behavior.

## Tests
- The schema refusal message names the first offending field and its problem: update the schema-violation unit tests in src/request.rs (unit)
- Unknown operation, unknown member and out-of-range limit refusals name the field through the binary: an integration check in tests/contract.rs (integration)
- Malformed JSON, unsupported version, precedence and accepted requests are unchanged: the existing tests in src/request.rs and tests/contract.rs plus the acceptance scenarios (existing)
- End-to-end through `kogen-context request`: the scenarios of acceptance.feature (scenario)

## Feasibility
- none
