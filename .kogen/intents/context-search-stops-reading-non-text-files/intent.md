# Stop reading a file at its first non-UTF-8 block

Slug: context-search-stops-reading-non-text-files
Model: not applicable — the change is a pure function over a byte stream with no state that persists between calls
Acceptance:
- .kogen/intents/context-search-stops-reading-non-text-files/acceptance.feature
- features/steps/context-search-stops-reading-non-text-files__steps.js

`kogen-context` search, ranked search and read currently read every file they consider whole with `fs::read` and only then run `String::from_utf8`, so a large binary (a Git pack in a Bundler gem cache, `node_modules`, build output) is read byte for byte and allocated whole although it can never match. The search walks (`walk_files`) every regular file under the root except under a directory named `.git`, so ignored and untracked trees are read on every search. This change makes search, ranked search and read stop reading a file at the first block that proves it is not UTF-8 text, with exactly the same results as today.

In `src/main.rs`, add `fn read_utf8_blocks(reader: impl std::io::Read) -> Option<String>` (private to the crate root, importable by `src/rank.rs` as `crate::read_utf8_blocks`). It reads `reader` in blocks of 65,536 bytes (`const READ_BLOCK: usize = 65_536`) and gives up at the first block in which the bytes read so far cannot be valid UTF-8. It returns `Some(text)` exactly when `fs::read` followed by `String::from_utf8` would have returned that text, and `None` otherwise, including when a read returns an error (an `Interrupted` read is retried, as `fs::read` does). A multi-byte character that straddles two blocks is valid; an incomplete character at the end of the input is not. It never reads more than one block past the first invalid byte. The text of a valid input is built in one string, with no size limit.

The five cases (in-memory readers that count the bytes they hand out):
- A reader of 10,485,760 bytes whose first byte is 0xFF: the function returns nothing and the reader handed out at most 65,536 bytes.
- A reader of 196,608 bytes: 100,000 bytes of ASCII `a` followed by one byte 0xFF and then ASCII `a` to the end: the function returns nothing and the reader handed out at most 131,072 bytes.
- A reader holding 65,535 bytes of ASCII `a`, then the two-byte character `é` (bytes 0xC3 0xA9, so 0xC3 is the last byte of the first block), then `bc`: the function returns exactly the text `a` repeated 65,535 times followed by `ébc`.
- A reader holding `abc` followed by the single byte 0xC3: the function returns nothing.
- A reader that hands out 1,000 bytes of ASCII `a` and then returns an `io::Error`: the function returns nothing and does not panic.

`find_matches` (src/main.rs), `find_ranked_matches` (src/rank.rs) and `read_lines` (src/main.rs) open the file with `fs::File::open` and use `read_utf8_blocks` instead of `fs::read` plus `String::from_utf8`. A file that cannot be opened, cannot be read or is not UTF-8 text is skipped by both searches, and refused by `read` with the existing `not_text` code and message `file is not UTF-8 text: ` followed by the path. Packets, CLI outputs, error codes and messages, match order and cap, `truncated`, exit statuses, the index files and their formats, and which files are searchable are unchanged; no crate, setting or environment variable is added and the contract README is not changed. The index path reads committed blobs through Git and does not use this function.

The builder also adds model-free unit tests to the `tests` module of `src/main.rs`, next to `clips_to_500_characters`, whose names all start with `reads_text_blocks_` so that `cargo test --locked --offline reads_text_blocks` runs them, calling `read_utf8_blocks` with in-memory readers that count the bytes they hand out (the five cases above). Acceptance does not rely on those tests: its steps append their own test module to a scratch copy of the crate.

## Decisions
- The function is named `read_utf8_blocks`, takes `impl Read` by value and returns `Option<String>`; the request fixes its behavior but not its name, and acceptance calls it by this name. (evidence: src/main.rs; src/rank.rs) (source: request)
- The three call sites open the file with `fs::File::open(...).ok().and_then(read_utf8_blocks)`, so an open failure, a read failure and invalid text all mean skipped or `not_text`, as `fs::read(..)` errors and `from_utf8` errors do today. (evidence: src/main.rs; src/rank.rs) (source: request)
- Acceptance appends its own test module `reads_text_blocks_acceptance` to a scratch copy of `src/main.rs` (Cargo.toml, Cargo.lock, rust-toolchain.toml and src/ copied, nothing written in the checkout) and runs each test with `cargo test --locked --offline --bin kogen-context reads_text_blocks_acceptance::<name> -- --exact`, so it does not depend on test names the build must invent. (evidence: Cargo.toml; src/main.rs) (source: request)
- No fixture larger than 10,485,760 bytes is written to disk; the byte counting uses in-memory readers that generate bytes on demand. (decision: D4, round 1) (source: request)
- While `src/main.rs` defines no `read_utf8_blocks`, the scratch copy gets a test-only stand-in with today's behavior (read everything, then `String::from_utf8`), so the scenarios fail on the property they assert and not on a missing name. The stand-in already satisfies the boundary character, incomplete tail and read error cases, which are behavior that must stay unchanged, so those three scenarios pass before the change and guard it; the two block-count scenarios and the call-site scenario fail until the change. (decision: D5, round 1) (evidence: src/main.rs) (source: request)
- The function is named read_utf8_blocks(impl Read) -> Option<String>; call sites use fs::File::open(..).ok().and_then(read_utf8_blocks). (decision: D1, round 1) (evidence: src/main.rs; src/rank.rs) (assumption: A scratch run outside the checkout of the correct overlay with a test module compiled, passed 5 tests and was clippy clean; this session's command is not cited as evidence.) (source: request)
- Acceptance appends its own test module to a scratch copy of src/main.rs and runs tests by exact name, so it does not depend on builder-invented tests. (decision: D2, round 1) (evidence: Cargo.toml; src/main.rs) (assumption: Cargo build time in a fresh target directory inside the 115 s step timeout is unverified for acceptance's environment.) (source: request)
- While src/main.rs defines no read_utf8_blocks, the acceptance scratch copy gets a test-only stand-in with today's behavior so scenarios fail on asserted properties, not on a missing name. (decision: D3, round 1) (evidence: src/main.rs) (assumption: A scratch run outside the checkout showed the stand-in making the two block-count tests fail and the other three pass; this session's command is not cited as evidence.) (source: request)

## Source comparison
- Expected 1 (function reading in 65,536-byte blocks, stopping at the first invalid block, exact `fs::read` plus `String::from_utf8` equivalence, `None` on read error): addressed by `read_utf8_blocks` and scenarios 1 to 5.
- Expected 2 (`find_matches`, `find_ranked_matches`, `read_lines` use it; `not_text` code and message unchanged): addressed by the call-site scenario 6 and by the existing CLI, golden and contract tests that stay unchanged.
- Expected 3 (valid UTF-8 still read whole into one string, no size limit, no change to searchable files): addressed in the function contract above; guarded by scenario 3 and the existing tests.
- Constraints (no new crate, setting or environment variable; `--locked --offline`; README unchanged; index files untouched): addressed; nothing in the Intent adds them.
- The measured figures of the Bundler gem tree (631,294,602 bytes, 814 non-UTF-8 files) motivate the change and are not a contract.

## Tests
- A file invalid from its first byte is dropped after one block: reads_text_blocks_stops_at_the_first_invalid_block (unit)
- An invalid byte in a later block is still found: reads_text_blocks_finds_an_invalid_byte_in_a_later_block (unit)
- A character straddling two blocks is valid: reads_text_blocks_accepts_a_character_across_a_block_boundary (unit)
- An incomplete character at the end of the input is invalid: reads_text_blocks_refuses_an_incomplete_final_character (unit)
- A failing read gives nothing: reads_text_blocks_gives_nothing_when_the_read_fails (unit)
- Search, ranked search and read keep their packets, outputs and errors: the existing integration, contract and golden tests (existing)

## Feasibility
- none
