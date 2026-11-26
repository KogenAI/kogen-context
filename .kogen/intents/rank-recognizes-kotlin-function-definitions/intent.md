# Rank Kotlin function definitions first

Slug: rank-recognizes-kotlin-function-definitions
Model: not applicable — ranking classifies each matching line without state or transitions
Acceptance:
- .kogen/intents/rank-recognizes-kotlin-function-definitions/acceptance.feature
- features/steps/rank-recognizes-kotlin-function-definitions__steps.js
- features/steps/rank-recognizes-kotlin-function-definitions__observe.js

In ranked search, recognize Kotlin `fun` declarations in `.kt` and `.kts` source files as definitions, so the declared function name ranks in tier 0. A call to that function in a source file stays in tier 1; merely containing the function name or `fun` elsewhere is not a definition. Implementation and its focused Rust tests are confined to `src/rank.rs`. Do not add a Kotlin parser or change matching, other ranking rules, path order, or the CLI or packet contract.

## Decisions
- Recognize `fun` in `DEFINITION_KEYWORDS` using the existing definition keyword and name boundaries; keep comment precedence and the call and reference fallbacks unchanged. (evidence: src/rank.rs) (source: request)
- Observe definition, call, and reference tiers through the order of matches for a version 1 `kogen-context request` search with `order` set to `ranked`; the packet does not expose tiers. Each scenario uses one fresh temporary directory outside the checkout so path order cannot explain the ordering. (evidence: src/rank.rs; contract/README.md; features/steps/README.md) (source: request)

## Source comparison
- Addressed: Evidence ev-3ab359fa identifies the gap in `DEFINITION_KEYWORDS` for existing source extensions `kt` and `kts`. The rule above and the two file scenarios cover both extensions; the Rust regression must use explicit Kotlin inputs instead of only iterating the keyword table.
- Addressed: Acceptance 1's `fun spin()` must rank as a definition, not a reference. The scenarios put the declaration after both calls in file order and require it first in ranked order. The omit-`fun` control exercises the missing-keyword counterexample; a declaration in the reference tier would also fail this ordering assertion.
- Addressed: Acceptance 2's `val result = spin()` must still rank as a call. The scenarios place a plain reference before the calls and the declaration after them, so a call ranked either as a reference or a definition changes the observed order. A call containing `fun` elsewhere rejects the broad `fun` control; the ordinary call rejects treating `spin` anywhere as a definition.
- Addressed: `src/rank.rs` is the only implementation scope. No requested behavior omitted; broader Kotlin parsing is explicitly out of scope and no public format is replaced.

## Tests
- Kotlin declaration recognition: add explicit `kt` and `kts` extension cases to `definitions_and_their_keyword_boundaries` in `src/rank.rs` that expect `LineKind::Definition` (regression)
- Kotlin calls remain calls: extend `calls` in `src/rank.rs` with the ordinary Kotlin call and the Kotlin call containing unrelated `fun` text, expecting `LineKind::Call` (unit)
- Definitions outrank calls and calls outrank references in each Kotlin source extension: run the two ranked CLI searches and compare all match locations in order (scenario)

## Feasibility
- With the repository-pinned Rust 1.99.1, `cargo build --locked --offline --bin kogen-context` followed by `target/debug/kogen-context request` succeeds on the unchanged tree (final fixture probe: exit 0, 55.7 s; initial three-line fixture probe: exit 0, 59.3 s). Steps use the configured Cucumber runtime, the resulting debug binary under `CARGO_TARGET_DIR` or the default `target`, and a fresh temporary fixture per scenario. They take successful, newline-terminated JSON on stdout and do not accept a failed process as an order assertion; refusals use the existing error-packet and exit-status contract in `contract/README.md`.
- The unchanged tree emitted this exact packet, followed by a newline, on the `Spin.kt` fixture: `{"version":1,"operation":"search","query":"spin","matches":[{"path":"Spin.kt","line":2,"column":14,"text":"val result = spin()"},{"path":"Spin.kt","line":3,"column":23,"text":"val display = \"fun\" + spin()"},{"path":"Spin.kt","line":4,"column":5,"text":"fun spin()"},{"path":"Spin.kt","line":1,"column":15,"text":"val alias = ::spin"}],"truncated":false,"limits":{"max_matches":100,"max_line_chars":500}}`
- The existing focused Rust rank target passed all eight tests before the change (`cargo test --locked --offline --bin kogen-context rank::tests:: -- --nocapture`: exit 0, 53.3 s; same probe confirmed the configured Node and Cucumber paths were set). Generated the correct and three wrong implementation patches from the current `src/rank.rs` (artifact-generation probe: exit 0, 0.1 s).
- The order observer accepted correct locations and rejected a call incorrectly promoted ahead of the declaration on isolated decoded packets (good: exit 0 in 0.1 s; bad: exit 1 in 0.1 s).
- evidence: {"id":"kotlin-rank-order","kind":"observer","inputs":[".kogen/intents/rank-recognizes-kotlin-function-definitions/acceptance.feature"],"observers":["features/steps/rank-recognizes-kotlin-function-definitions__observe.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" -e 'const observe = require(\"./features/steps/rank-recognizes-kotlin-function-definitions__observe.js\"); const matches = [4, 2, 3, 1].map(line => ({path: \"Spin.kt\", line})); observe({matches}, \"Spin.kt\", \"4, 2, 3, 1\"); console.log(\"observer accepted correct order\")'","exit":0,"output":"observer accepted correct order\n"},{"name":"bad","command":"\"$KOGEN_NODE\" -e 'const observe = require(\"./features/steps/rank-recognizes-kotlin-function-definitions__observe.js\"); const matches = [3, 4, 2, 1].map(line => ({path: \"Spin.kt\", line})); try { observe({matches}, \"Spin.kt\", \"4, 2, 3, 1\") } catch (e) { if (e.code !== \"ERR_ASSERTION\") throw e; console.log(\"observer rejected promoted call\"); process.exitCode = 1 }'","exit":1,"output":"observer rejected promoted call\n"}]}
