# Rank JavaScript template text comment markers as

Slug: rank-javascript-template-string-comment-markers
Model: not applicable — the change is a stateless classification of one line of text
Acceptance:
- .kogen/intents/rank-javascript-template-string-comment-markers/acceptance.feature
- features/steps/rank-javascript-template-string-comment-markers__steps.js

In `src/rank.rs`, the scan that decides whether a matching line is a comment tracks ordinary double-quoted strings but not JavaScript template literals (backtick strings). So a line such as ``const s = `a // spin`;`` is read as code followed by a real `//` comment, and its match is lowered to the comment tier. After this change, in a JavaScript or TypeScript file (extensions `js`, `mjs`, `cjs`, `jsx`, `ts`, `mts`, `cts`, `tsx`), the text of a template literal that opens before the literal is a string: a backslash escapes the next character and an unescaped backtick closes it. A `//` inside template literal text is not a comment marker, so a line containing a matching literal after `//` inside template text is classified as a reference, not a comment (it ranks above a real comment line). A `//` outside any string, including a real `//` comment after a closed template literal, still makes the line a comment, exactly as today. A template literal still open at the literal means the literal is inside the string, so the line is a reference.

Out of scope and unchanged: ranking tiers and their order, parsing `${...}` interpolation expressions (the whole text between the backticks is treated as string text), backticks in every other language, multi-line template literals, the set of matches, match columns and the packet format.

## Decisions
- In JavaScript and TypeScript files, template literal text opened before the literal (backtick to the next unescaped backtick, backslash escaping the next character) is a string, so a `//` inside it does not make the line a comment and the line is classified as a reference. (constraint: ranking tiers unchanged) (evidence: src/rank.rs) (source: request)
- A `//` outside any string, including a real comment after a closed template literal, keeps the line a comment; comment markers are never ignored wholesale on lines that contain a template literal. (decision: D2, round 1) (constraint: real trailing comments after a closed template literal stay comments) (evidence: src/rank.rs) (source: request)
- Template interpolation is not parsed: a `//` inside `${...}` between the backticks is treated as template text. (decision: D3, round 1) (constraint: out of scope: parsing template interpolation expressions) (evidence: src/rank.rs) (source: request)
- The change is made in `in_comment`, the scan used for `//` markers, behind a flag set only for the JavaScript and TypeScript extensions listed above; other extensions (for example `go`, whose backticks are raw strings) keep their current scan. (decision: D4, round 1) (constraint: no template handling for other languages) (evidence: src/rank.rs) (assumption: the JavaScript family means the extensions js, mjs, cjs, jsx, ts, mts, cts and tsx, which the existing source extension list names; confirm) (source: request)
- Lines are classified one at a time, so a template literal that opens on an earlier line is not tracked. (decision: D5, round 1) (evidence: src/rank.rs) (assumption: multi-line template literals are left unchanged because the classifier sees one line at a time; confirm this is wanted) (source: request)
- Acceptance runs the built `kogen-context request` with a ranked search over a temporary file and observes the order of the returned lines, because the reference and comment tiers are observable only through the ranked order (tier, then path, then line). (decision: D6, round 1) (evidence: src/rank.rs; features/steps/rank-rust-raw-string-comment-markers__steps.js) (source: request)
- In JS/TS files, template literal text opened before the literal is a string; // inside it is not a comment; real // after a closed template stays a comment; interpolation not parsed; other extensions unchanged (decision: D1, round 1) (evidence: src/rank.rs; features/steps/rank-rust-raw-string-comment-markers__steps.js) (assumption: A scratch copy of the correct patch passed `cargo test --bin kogen-context rank` (8 passed); the acceptance feature itself was not run. Multi-line template literals are untracked by design.) (source: request)

## Source comparison
- Addressed: a JavaScript line with a matching literal after `//` inside template literal text is classified as a reference, not a comment (scenario 1).
- Addressed: a JavaScript line with a real `//` comment after a closed template literal is classified as a comment (scenario 2).
- Preserved: other languages keep their current scan (scenario 3).
- Out of scope and unchanged: ranking tiers, template interpolation parsing.

## Tests
- A `//` inside template literal text in a `js` line is a reference, not a comment; a `//` after a closed template literal in a `ts` line is a comment; the same backtick text in a `go` line is unchanged: extend the `comments` unit test in `src/rank.rs` (unit)
- The ranked order of a real search over JavaScript and Go files reflects these rules: the acceptance scenarios run `kogen-context request` (scenario)

## Feasibility
- none
