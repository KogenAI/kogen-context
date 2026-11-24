# Name commands in wrong-arity refusals

Slug: cli-arity-refusals-name-command
Model: not applicable — stateless CLI argument validation changes diagnostic text only
Acceptance:
- .kogen/intents/cli-arity-refusals-name-command/acceptance.feature
- features/steps/cli-arity-refusals-name-command__steps.js

Replace the generic usage refusal for wrong-arity search and read invocations with a refusal identifying the command and stating its expected argument count. Implement only in src/main.rs and tests/cli.rs. Preserve successful command output and exit status, argument parsing rules, and unknown-command refusals. Keep the existing usage error envelope, stderr destination, empty stdout, and exit status. Add regression coverage for missing and extra arguments on both command paths; retain useful existing tests.

## Decisions
- Count positional arguments after the command name: search expects two and read expects four; preserve the current usage refusal transport and status. (decision: D1, round 1) (evidence: src/main.rs; tests/cli.rs) (source: request)
- Assert the command identity and expected argument count without prescribing diagnostic wording or positional labels. (decision: D3, round 1) (evidence: src/main.rs; tests/cli.rs) (revises: D2 because the request specifies diagnostic meaning, not exact copy or positional labels) (source: request)

## Source comparison
- Addressed: Request evidence ev-465dc1a8 identifies the shared generic wrong-arity branch in src/main.rs and missing search/read coverage in tests/cli.rs; this contract replaces those two refusals and requires regression coverage in those same scoped files.
- Addressed: Request acceptance 1 and its generic-usage counterexample map to every missing search argument count and one extra argument in acceptance.feature, with a generic-search wrong implementation in controls.json.
- Addressed: Request acceptance 2 and its search-only counterexample map to every missing read argument count and one extra argument, with a generic-read wrong implementation in controls.json.
- Addressed: Request acceptance 3 and its valid-dispatch counterexample map to actual search/read CLI invocations with current stdout and status, and separate wrong valid-dispatch controls.
- Addressed: Request exclusions preserve successful output, parsing, and unknown-command refusals. Acceptance also checks existing empty-command, help-extra, and unknown-command refusals; existing tests/cli.rs coverage remains in place.
- Superseded: The initial draft fixed exact diagnostic copy and positional labels beyond the request. The complete current contract asserts only command identity and expected count, allowing varied wording. Concrete control implementations illustrate one acceptable wording, not an additional product requirement.
- Omitted: No requested behavior or settled non-secret input is omitted. No new settings, parsing forms, or compatibility mechanisms are introduced. The slug, Intent paths, step folder, binding prefix, and implementation scope follow the supplied request.

## Tests
- Search wrong arity: add tests/cli.rs regression cases and CLI scenarios for missing and extra arguments identifying search and its expected count (regression)
- Read wrong arity: add tests/cli.rs regression cases and CLI scenarios for missing and extra arguments identifying read and its expected count (regression)
- Valid dispatch: preserve existing tests/cli.rs search/read coverage and compare representative real CLI stdout, stderr, and status to current results (scenario)
- Unchanged refusal boundaries: retain existing tests/cli.rs help and unknown-command coverage and exercise representative unchanged refusals through the binary (scenario)

## Feasibility
- Built the actual binary with cargo build --locked --offline --bin kogen-context and observed both README quickstart commands successfully, including their JSON stdout. This is simple local CLI validation with no external dependency or state model obligation. (probe 1: exit 0)
