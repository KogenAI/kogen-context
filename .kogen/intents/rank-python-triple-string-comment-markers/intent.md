# Rank Python triple-quoted string markers as source

Slug: rank-python-triple-string-comment-markers
Model: not applicable — the change is a stateless classification of the lines of one file's text
Acceptance:
- .kogen/intents/rank-python-triple-string-comment-markers/acceptance.feature
- features/steps/rank-python-triple-string-comment-markers__steps.js

In `src/rank.rs`, `has_marker_outside_string` tracks quotes only within one line, and the ranked search classifies each matching line on its own. So in a Python file, a matching line that begins with `#` inside a triple-quoted string (`"""..."""` or `'''...'''`) that opened on an earlier line is classified as a comment and ranks in the comment tier. After this change, in a Python file (extensions `py` and `pyi`), a matching line that lies inside a triple-quoted string is classified like any other non-comment line (a reference, a call or a definition by the existing rules), so a `#` there is not a comment marker. The string state is tracked across the lines of the file from its start: a triple-quoted string opens at three identical quote characters outside every string and comment and ends at the next three of the same quote character, and backslash escapes the next character inside it. Once the string closes, a `#` outside any string, including later on the line that holds the closing delimiter, makes the line a comment again, exactly as today.

Out of scope and unchanged: ranking tiers and their order, multi-line strings in every other language (Ruby, shell and the other `#` languages keep the current one-line scan), block comments, the set of matches, match columns and the packet format.

## Decisions
- In `py` and `pyi` files, a matching line that lies inside a triple-quoted string opened on an earlier line or earlier on the same line is not a comment, so a `#` inside the string is not a marker. (decision: D1, round 1) (constraint: ranking tiers unchanged) (evidence: src/rank.rs) (source: request)
- Once the triple-quoted string has closed, a `#` outside any string makes the line a comment again, including a `#` after the closing delimiter on the same line; the string state is not kept active past the closing delimiter. (decision: D2, round 1) (constraint: a real comment after a closed triple-quoted string stays a comment) (evidence: src/rank.rs) (source: request)
- Both triple delimiters `"""` and `'''` are recognised; a closing delimiter must use the same quote character as the opener. The file is scanned in order from its start, skipping `#` comments and ordinary single-line quoted strings, so quotes in them do not open triple strings. (decision: D3, round 1) (evidence: src/rank.rs) (assumption: prefixes such as `r`, `b` and `f` on a string are ignored, and a backslash always escapes the next character, which matches Python for non-raw strings and is a close approximation for raw ones) (source: request)
- Only the Python extensions `py` and `pyi` get this handling; `has_marker_outside_string` and the scan of every other `#` language are unchanged. (decision: D4, round 1) (constraint: no multiline string handling for other languages) (evidence: src/rank.rs) (source: request)
- Acceptance runs the built `kogen-context request` with a ranked search over a temporary file and observes the order of the returned lines, because the reference and comment tiers are observable only through the ranked order (tier, then path, then line). A literal line that is a plain reference is placed beside the matching comment line so the two tiers are told apart. (decision: D5, round 1) (evidence: src/rank.rs; features/steps/rank-rust-raw-string-comment-markers__steps.js) (source: request)

## Source comparison
- Addressed: a matching Python line beginning with `#` inside a triple-quoted string is classified as a reference, not a comment (scenarios 1 and 4, for `"""` and `'''`).
- Addressed: a matching Python line beginning with `#` after the triple-quoted string closes is classified as a comment (scenarios 2 and 3; scenario 3 is a `#` after the closing delimiter on the same line).
- Out of scope and unchanged: ranking tiers, multiline strings in other languages (scenario 5 keeps the Ruby scan).

## Tests
- A `#` inside a triple-quoted string is not a comment in a `py` line, a `#` after the closing delimiter is, and the `rb` extension ignores the open-string state: extend the `comments` unit test in `src/rank.rs` (unit)
- The ranked order of a real search over a Python file (and a Ruby file) reflects these rules: the acceptance scenarios run `kogen-context request` (scenario)

## Feasibility
- none
