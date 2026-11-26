# Rank PHP hash comments as comments

Slug: rank-recognizes-php-hash-comments
Model: not applicable — the change is a stateless classification of one line of text
Acceptance:
- .kogen/intents/rank-recognizes-php-hash-comments/acceptance.feature
- features/steps/rank-recognizes-php-hash-comments__steps.js

In `src/rank.rs`, `line_kind` picks the comment marker from the file extension. PHP is a source extension but is not in `HASH_COMMENT_EXTENSIONS`, so a PHP line such as `# spin` or `$x = 1; # spin` is classified as a source reference instead of a comment. After this change a PHP line whose `#` occurs before the literal outside a double-quoted string is ranked as a comment, and PHP keeps its existing `//` comment marker and leading `/*` / `*` comment rule. A PHP line that is not a comment keeps its classification as a definition, call or reference.

Out of scope and unchanged: adding extensions, the comment syntaxes of other extensions, the ranking tiers and their order, the set of matches, match columns and the packet format.

## Decisions
- PHP recognizes both `//` and `#` as comment markers (`//` is existing PHP behavior and must not regress); PHP is not added to `HASH_COMMENT_EXTENSIONS`, because that list makes `#` the only marker. (constraint: `//` and leading `/*`/`*` PHP comments stay comments) (evidence: src/rank.rs) (source: request)
- A `#` marker in PHP follows the existing string rule: a `#` inside a double-quoted string before the literal is not a comment marker. (evidence: src/rank.rs) (source: request)
- A PHP line `spin($x);` containing the literal as a call remains a call, and `$x = spin;` remains a reference; non-comment PHP lines are not demoted. (constraint: PHP source classification preserved) (evidence: src/rank.rs) (source: request)
- Acceptance runs the built `kogen-context request` with a ranked search over a temporary PHP file and observes the order of the returned lines, because tiers are observable only through the ranked order (tier, then path, then line). (evidence: src/rank.rs; features/steps/rank-ignores-comment-markers-in-strings__steps.js) (source: request)
- PHP 8 attribute lines beginning `#[` are treated as `#` comments like any other `#`, as the request states. (assumption: attribute lines `#[...]` matching the literal are acceptable as comment-tier matches) (source: request)
- PHP recognizes both // and # as comment markers; PHP is not added to HASH_COMMENT_EXTENSIONS, which would make # the only marker. (decision: D1, round 1) (constraint: // and leading /* and * PHP comments stay comments) (evidence: src/rank.rs) (assumption: Scratch run showed the correct patch passes the rank unit tests and orders the three scenarios as 2,1 / 2,1 / 2,1,3, while the three wrong variants diverge; not retained as Kogen evidence.) (source: request)
- The # marker in PHP follows the existing double-quoted-string rule. (decision: D2, round 1) (evidence: src/rank.rs) (source: request)
- PHP calls and references that are not comments keep their classification. (decision: D3, round 1) (evidence: src/rank.rs) (source: request)
- Acceptance runs the built kogen-context request ranked search over a temporary PHP file and observes line order. (decision: D4, round 1) (evidence: src/rank.rs; features/steps/rank-ignores-comment-markers-in-strings__steps.js) (source: request)
- PHP 8 attribute lines beginning #[ are treated as # comments, as the request states. (decision: D5, round 1) (assumption: Attribute lines matching the literal become comment-tier matches.) (source: request)

## Source comparison
- Addressed: a PHP line beginning with `# spin` or containing a trailing `# spin` is a comment (scenarios 1 and 3).
- Addressed: a PHP source call containing `spin` remains a call (scenario 2).
- Preserved: PHP `//` comments stay comments (scenario 3).
- Out of scope and unchanged: other extensions and other comment syntaxes, ranking tiers.

## Tests
- PHP `#` comments, leading and trailing, are comments; `//` and `/*` still are; a quoted `#` is not: add assertions to the `comments` unit test in `src/rank.rs` (unit)
- A PHP call stays a call and a PHP reference stays a reference: add assertions to the `comments` unit test in `src/rank.rs` (unit)
- The ranked order of a real search of a PHP file reflects these rules: the acceptance scenarios run `kogen-context request` over a PHP file (scenario)

## Feasibility
- none
