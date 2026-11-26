# Rank comment markers in strings as source

Slug: rank-ignores-comment-markers-in-strings
Model: not applicable — the change is a stateless classification of one line of text
Acceptance:
- .kogen/intents/rank-ignores-comment-markers-in-strings/acceptance.feature
- features/steps/rank-ignores-comment-markers-in-strings__steps.js

In `src/rank.rs`, `line_kind` classifies a matching line as a comment whenever the comment marker (`//`, or `#` or `--` for the languages that use them) occurs anywhere before the literal, even when those characters are inside a quoted string. A Go line such as `log.Println("// spin")` therefore ranks its `spin` match in the comment tier instead of as a source call. After this change a comment marker that occurs inside a double-quoted string (a string opened by `"` and closed by an unescaped `"`) before the literal is not a comment marker, so the line is ranked as source by the remaining rules and no longer as a comment. A comment marker outside any double-quoted string before the literal still makes the line a comment, exactly as today.

Out of scope and unchanged: the set of matches returned, match columns, the ranking tiers and their order, the leading `/*` and `*` comment rule, and the packet format.

## Decisions
- A comment marker inside a double-quoted string, with backslash escaping a following character inside the string, does not count as a comment marker; this applies to every extension and marker `line_kind` handles. (constraint: a marker outside quoted strings still classifies the line as a comment) (evidence: src/rank.rs) (assumption: only double quotes are treated as string delimiters; single-quoted text such as the existing `echo '# spin'` shell case stays a comment because single quotes also appear as apostrophes and Rust lifetimes) (source: request)
- A Go line `log.Println("// spin")` ranks its `spin` match as a source call, not a comment: it leaves the comment tier and is ranked as source by the existing rules, which are not changed, so it ranks above real comment matches. (decision: D2, round 1) (constraint: ranking tiers unchanged) (evidence: src/rank.rs) (source: request)
- A line with an actual trailing comment (`x := 1 // spin`, `// spin`) stays a Comment, and comment markers are never ignored wholesale. (decision: D3, round 1) (constraint: real comments keep the comment tier) (evidence: src/rank.rs) (source: request)
- Acceptance runs the built `kogen-context request` with a ranked search over a temporary Go file and observes the order of the returned lines, because tiers are observable only through the ranked order (tier, then path, then line). (decision: D4, round 1) (evidence: src/rank.rs; features/steps/k-context-ranked-scoped-results__steps.js) (source: request)
- A comment marker inside a double-quoted string (backslash escapes) does not count as a comment marker (decision: D1, round 1) (evidence: src/rank.rs) (assumption: Only double quotes are string delimiters; single-quoted text stays as today.) (source: request)

## Source comparison
- Addressed: a Go line containing `log.Println("// spin")` no longer ranks its match as a comment but as source (scenarios 1 and 3).
- Addressed: a Go line with an actual trailing `// spin` comment remains a comment (scenarios 2 and 3).
- Out of scope and unchanged: search results, match columns and ranking tiers.

## Tests
- A comment marker inside a quoted Go string leaves the match in a source tier: add assertions to the `comments` unit test in `src/rank.rs` (unit)
- A real comment marker outside strings, also after a quoted string, remains a comment: add assertions to the `comments` unit test in `src/rank.rs` (unit)
- The ranked order of a real search reflects both rules: the acceptance scenarios run `kogen-context request` over a Go file (scenario)

## Feasibility
- none
