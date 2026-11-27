# Rank single-quoted comment markers as source

Slug: rank-ignores-single-quoted-comment-markers
Model: not applicable — the change is a stateless classification of one line of text
Acceptance:
- .kogen/intents/rank-ignores-single-quoted-comment-markers/acceptance.feature
- features/steps/rank-ignores-single-quoted-comment-markers__steps.js

In `src/rank.rs`, `has_marker_outside_string` tracks double-quoted strings only, so a shell line such as `echo '# spin'` or a Python line such as `x = '# spin'` is classified as a comment because the hash sits inside a single-quoted string. After this change, for the extensions in `HASH_COMMENT_EXTENSIONS` (shell, Python and the other hash-comment languages), a comment marker that occurs before the literal inside a single-quoted string is not a comment marker, so the line is ranked as source by the remaining rules. A comment marker outside any quoted string still makes the line a comment, exactly as today. The existing `comments` unit test that expects `echo '# spin'` in a shell file to be a comment is updated to expect a source reference.

Out of scope and unchanged: ranking tiers and their order, source extensions, full language parsers, the set of matches, match columns and the packet format, and the comment rules of every extension outside `HASH_COMMENT_EXTENSIONS` (a `'` there stays an ordinary character, because it is an apostrophe, a Rust lifetime or a character literal).

## Decisions
- A comment marker inside a single-quoted string (opened by `'`, closed by the next unescaped `'`) before the literal is not a comment marker; the line is then ranked as source by the existing definition, call and reference rules. (constraint: a marker outside quoted strings still classifies the line as a comment; ranking tiers unchanged) (evidence: src/rank.rs) (source: request)
- Single quotes are string delimiters only for extensions in `HASH_COMMENT_EXTENSIONS`, which covers both the shell and the Python cases of the request; other extensions keep double-quote-only tracking, so a Rust lifetime such as `&'a str` before a `// spin` comment does not hide the comment. (constraint: `'` stays an ordinary character for `//` and `--` extensions and for PHP) (evidence: src/rank.rs; .kogen/intents/rank-ignores-comment-markers-in-strings/intent.md) (assumption: PHP single-quoted strings and `//`-language single-quoted strings are left unchanged because the request names only shell and Python; confirm this narrower scope is wanted) (source: request)
- Inside a quoted string, a double quote is an ordinary character in a single-quoted string and a single quote is an ordinary character in a double-quoted string; a backslash escapes the next character in both kinds of string, the existing double-quote rule. (evidence: src/rank.rs) (assumption: backslash escaping also applies in single-quoted shell strings, where a real shell has no escapes; this simple shared rule is accepted) (source: request)
- A real comment, whether the line starts with the marker or the marker follows a closed single-quoted string (`echo 'a' # spin`), stays a comment; hash markers are never ignored wholesale. (constraint: real comments keep the comment tier) (evidence: src/rank.rs) (source: request)
- Acceptance runs the built `kogen-context request` with a ranked search over a temporary file and observes the order of the returned lines, because tiers are observable only through the ranked order (tier, then path, then line). (evidence: src/rank.rs; features/steps/rank-ignores-comment-markers-in-strings__steps.js) (source: request)

## Source comparison
- Addressed: a shell line with a hash inside a single-quoted string is source, not a comment (scenario 1; request check 1).
- Addressed: a Python line with a hash inside a single-quoted string is source (scenario 2; request check 2).
- Addressed: a hash outside a single-quoted string, at line start or after a closed string, is still a comment (scenario 3; request check 3).
- Preserved: a `'` in a `//` language (a Rust lifetime) does not hide a following comment (scenario 4).
- Superseded: the unit assertion that `echo '# spin'` in a shell file is a comment.
- Out of scope and unchanged: ranking tiers, source extensions, full language parsers.

## Tests
- A hash inside a single-quoted string in shell and Python lines is not a comment; a hash after a closed single-quoted string is; a quote of the other kind is ordinary; a `'` in a `rs` line does not hide a comment: update and extend the `comments` unit test in `src/rank.rs` (unit)
- The ranked order of a real search reflects these rules for a shell file, a Python file and a Rust file: the acceptance scenarios run `kogen-context request` (scenario)

## Feasibility
- none
