# Rank inline block comments as comments

Slug: rank-classifies-inline-block-comments
Model: not applicable — the change is a stateless classification of one line of text
Acceptance:
- .kogen/intents/rank-classifies-inline-block-comments/acceptance.feature
- features/steps/rank-classifies-inline-block-comments__steps.js

In `src/rank.rs`, `line_kind` recognizes a block comment only when the trimmed line starts with `/*` or `*`, so a match inside a comment that begins after code on the same line, such as `x = 1; /* target */`, is ranked as a reference or call instead of as a comment. After this change, for the extensions that already use the `/*` and `*` line-prefix rule, a match that lies inside a C-style `/* ... */` block comment opened earlier on the same line, outside a double-quoted string, is classified as a comment. A match before the opening marker, or after the comment has closed on the line, is classified from its code context exactly as today, and a line with no block comment keeps its existing classification.

Out of scope and unchanged: ranking tiers and their order, other block-comment syntaxes, the extensions that do not use the `/*` prefix rule (hash-comment languages), comments spanning several lines, match columns and the packet format. The existing `comments` unit test that expects `x /* spin` in a C file to be a reference is updated to expect a comment, because the match lies inside the opened comment.

## Decisions
- A match is in an inline block comment when, scanning the text before the match, a `/*` outside a double-quoted string has opened and no `*/` has closed it before the match; such a match is a comment. (constraint: the whole line is never treated as a comment merely because it contains an opening marker; ranking tiers unchanged) (evidence: src/rank.rs) (source: request)
- A match before an inline block comment, and a match after one that closed on the line, keep their code classification (definition, call or reference). (constraint: ordinary code lines with no block comment keep their existing classification) (evidence: src/rank.rs) (source: request)
- The inline rule applies to the same extensions as the existing prefix rule (every extension whose line-comment marker is not `#`), and a `/*` in a hash-comment extension stays ordinary text, because the request adds no other block-comment syntaxes. (evidence: src/rank.rs) (source: request)
- A `/*` inside a double-quoted string does not open a comment, with backslash escapes handled like the existing string rule; single-quoted strings are not tracked here. (evidence: src/rank.rs) (assumption: single-quoted C-style character literals such as `'"'` are not tracked, matching the existing handling for non-hash extensions; confirm this is acceptable) (source: request)
- The `x /* spin` unit assertion is superseded: an unclosed comment opened before the match contains the match, so it is a comment. (evidence: src/rank.rs) (source: request)
- Acceptance runs the built `kogen-context request` with a ranked search over a temporary `.c` file and observes the order of the returned lines, because tiers are observable only through the ranked order (tier, then path, then line). (evidence: src/rank.rs; features/steps/rank-ignores-single-quoted-comment-markers__steps.js) (source: request)
- A match is in an inline block comment when a /* outside a double-quoted string opened earlier on the line and no */ closed it before the match (decision: D1, round 1) (constraint: whole line is never a comment merely for containing an opening marker) (constraint: tiers unchanged) (evidence: src/rank.rs) (assumption: Scratch run of a correct implementation passed unit tests and a manual 4-scenario binary check in a /tmp copy; not authoritative.) (source: request)
- Inline rule applies to the same extensions as the existing prefix rule (marker != '#'); single-quoted char literals are not tracked (decision: D2, round 1) (evidence: src/rank.rs) (assumption: Single-quoted char literals like '"' not tracked; user may confirm.) (source: request)

## Source comparison
- Addressed: a match inside an inline block comment is a comment (scenario 1; request check 1).
- Addressed: a match before an inline block comment keeps its code classification (scenario 2; request check 2).
- Addressed: ordinary code with no block comment, including a `/*` inside a string, keeps its classification (scenario 3; request check 3).
- Addressed: a match after a closed inline block comment is code (scenario 4).
- Superseded: the unit assertion that `x /* spin` in a C file is a reference.
- Out of scope and unchanged: ranking tiers, other block-comment syntaxes.

## Tests
- A match inside an inline block comment is a comment, a match before or after it is classified from code, and a `/*` in a string or a hash-comment file is not a comment: update and extend the `comments` unit test in `src/rank.rs` (unit)
- The ranked order of a real search over a C file reflects these rules: the acceptance scenarios run `kogen-context request` (scenario)

## Feasibility
- none
