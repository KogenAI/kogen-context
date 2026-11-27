# Rank Rust raw string comment markers as source

Slug: rank-rust-raw-string-comment-markers
Model: not applicable — the change is a stateless classification of one line of text
Acceptance:
- .kogen/intents/rank-rust-raw-string-comment-markers/acceptance.feature
- features/steps/rank-rust-raw-string-comment-markers__steps.js

In `src/rank.rs`, the scan that decides whether a matching line is a comment tracks ordinary double-quoted strings with backslash escapes but does not know Rust raw strings. The Rust comment marker is `//`, which is scanned by `in_comment` (`has_marker_outside_string` serves only the `#` languages). So a raw string such as `r#"a" // spin"#` is read as the string `r#"a"` followed by a real `//` comment, and a raw string that ends in a backslash such as `r"C:\"` is read as still open. After this change, in a Rust file (extension `rs`), a raw string before the literal (`r"..."`, `r#"..."#` with any number of hashes, with an optional `b` or `c` prefix) has no escapes and ends at the first `"` followed by as many `#` as opened it; a `//` inside it is not a comment marker, so a Rust line containing a matching literal after `//` inside a raw string is classified as a reference, not a comment (the line then gets the source tier of a reference, so it ranks above a real comment line). A `//` outside any string, including a real `//` comment after a closed raw string, still makes the line a comment, exactly as today. A raw string that is still open at the literal means the literal is inside the string, so the line is a reference, not a comment.

Out of scope and unchanged: ranking tiers and their order, raw-string-like text in every other language, block comments, multi-line raw strings, the set of matches, match columns and the packet format.

## Decisions
- In `rs` files, a raw string opened before the literal (`r`, `br` or `cr`, zero or more `#`, then `"`, not preceded by an identifier character) runs to the first `"` followed by the same number of `#`; backslashes are ordinary inside it, and a `//` inside it is not a comment marker, so the line is classified as a reference, not a comment. (decision: D1, round 1) (constraint: ranking tiers unchanged) (evidence: src/rank.rs) (source: request)
- A `//` outside any string, including after a closed raw string, keeps the line a comment; markers are never ignored wholesale on lines that contain a raw string. (decision: D2, round 1) (constraint: real trailing comments after a closed raw string stay comments) (evidence: src/rank.rs) (source: request)
- The change is made in `in_comment`, the scan used for `//` markers, behind an `rs`-only flag, because `has_marker_outside_string` is only used for `#` markers and never sees Rust lines. Other extensions keep their current scan, so `r#"a" // spin"#` in a Go file is still a comment. (decision: D3, round 1) (constraint: no raw string handling for other languages) (evidence: src/rank.rs) (source: request)
- Rust lines are classified one at a time, so a raw string that opens on an earlier line is not tracked. (decision: D4, round 1) (evidence: src/rank.rs) (assumption: multi-line raw strings are left unchanged because the ranking classifier sees one line at a time; confirm this is wanted) (source: request)
- Acceptance runs the built `kogen-context request` with a ranked search over a temporary file and observes the order of the returned lines, because the reference and comment tiers are observable only through the ranked order (tier, then path, then line). (decision: D5, round 1) (evidence: src/rank.rs; features/steps/rank-ignores-single-quoted-comment-markers__steps.js) (source: request)

## Source comparison
- Addressed: a matching literal after `//` inside a raw string is classified as a reference, not a comment (scenario 1, hashed raw string containing a quote; scenario 3 covers a raw string ending in a backslash).
- Addressed: a real `//` comment after a closed raw string is still classified as a comment (scenarios 2 and 3).
- Preserved: other languages keep their current scan (scenario 4).
- Out of scope and unchanged: ranking tiers, other languages' raw strings.

## Tests
- A `//` inside a raw string (plain, hashed, byte-prefixed) in an `rs` line is a reference, not a comment; a `//` after a closed raw string is a comment; the same text in a `go` line is unchanged: extend the `comments` unit test in `src/rank.rs` (unit)
- The ranked order of a real search over a Rust file and a Go file reflects these rules: the acceptance scenarios run `kogen-context request` (scenario)

## Feasibility
- none
