# Test four-byte UTF-8 characters across block

Slug: utf8-four-byte-boundary-test
Model: not applicable — the change adds a unit test of a stateless function and changes no behavior
Acceptance:
- .kogen/intents/utf8-four-byte-boundary-test/acceptance.feature
- features/steps/utf8-four-byte-boundary-test__steps.js

In `src/main.rs`, `read_utf8_blocks` keeps the incomplete bytes of a UTF-8 character across 65,536-byte blocks. Its unit tests cover a two-byte character crossing a block boundary but not a four-byte one. Add a regression test in the `tests` module of `src/main.rs`, next to the other `reads_text_blocks_` tests, proving that a valid four-byte character split across a block boundary after each of its first three bytes is returned intact. Only the test is added: production code, the block size, search behavior and UTF-8 refusal behavior (including the refusal of an incomplete final character) do not change.

Acceptance judges the tests by mutation: it copies the Rust sources, makes one wrong change to the retained-bytes handling in the copy, runs the unit tests there and requires a failing test. The wrong changes drop or shorten the retained bytes of a split four-byte character (one mutant per split position) and accept an incomplete final character as complete text.

## Decisions
- The test is a unit test inside `src/main.rs` because `read_utf8_blocks` is private to the binary crate and the request scopes the change to that file. (decision: D1, round 1) (constraint: only src/main.rs changes) (evidence: src/main.rs) (source: request)
- The three split positions of the four-byte character (after the first, second and third byte) must each be covered, so one wrong change per position is rejected. (decision: D2, round 1) (constraint: each of the first three split positions is covered) (evidence: src/main.rs) (source: request)
- Existing incomplete-final-character behavior stays a refusal and its existing unit test is kept. (decision: D3, round 1) (constraint: incomplete final character is refused) (evidence: src/main.rs) (source: request)
- Acceptance observes the tests through mutation of a temporary copy of the sources, run with `cargo test --locked --offline --bin kogen-context`, because the function is not reachable from the CLI and acceptance may not depend on test names the Build invents; the checkout is never modified by acceptance. (decision: D4, round 1) (evidence: Cargo.toml; src/main.rs) (assumption: a scratch run, not retained by Kogen, showed the unit tests pass on the unchanged sources and each mutant survives them except the incomplete-final-character one, and that every mutant is rejected once a test covering all three splits is added) (source: request)

## Source comparison
- Addressed: a four-byte character split after each of its first three bytes is returned intact (acceptance scenarios 1 to 3; mutants that drop or shorten retained bytes).
- Addressed: an incomplete final character stays a refusal (scenario 4; mutant that accepts it).
- Out of scope and unchanged: block size, search behavior, UTF-8 refusal behavior.

## Tests
- A four-byte character split after each of its first three bytes at a block boundary is returned intact: add a unit test in `src/main.rs` calling `read_utf8_blocks` with each split (unit)
- An incomplete final character remains a refusal: the existing `reads_text_blocks_refuses_an_incomplete_final_character` unit test (existing)

## Feasibility
- none
