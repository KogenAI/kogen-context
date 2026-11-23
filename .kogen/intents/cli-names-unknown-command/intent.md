# Name the unknown command in the usage refusal

Slug: cli-names-unknown-command
Model: not applicable — the change is an argument check of a stateless command-line program with no state that persists between runs
Acceptance:
- .kogen/intents/cli-names-unknown-command/acceptance.feature
- features/steps/cli-names-unknown-command__steps.js

Today `kogen-context` answers every argument list that `run` in `src/main.rs` does not match with the same JSON `usage` refusal on stderr and exit status 2, so a caller that mistyped a command cannot tell from the refusal which input was rejected. This change names the unsupported command in that refusal. Supported commands, exit statuses and stdout behavior do not change.

## Required change

1. When the first argument is not one of `search`, `read`, `request`, `version`, `help`, `--help` and `-h`, `kogen-context` writes nothing on stdout, writes on stderr the one line `{"error":{"code":"usage","message":"unknown command: WORD; usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}` with WORD the first argument as the JSON string escaping already used for refusals writes it (a first argument that is not valid UTF-8 appears with each invalid byte sequence replaced by U+FFFD), and exits with status 2. Further arguments after the unknown word do not change the message.
2. Every other argument list that is refused keeps the existing line `{"error":{"code":"usage","message":"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}`, stdout empty and exit status 2: no arguments, and a supported word with the wrong number of arguments (for example `version extra`, `help extra`, `--help search`, `search ROOT`), because those are not unsupported commands.
3. `search`, `read`, `request`, `version` and the help words keep their output, exit statuses and refusals. `kogen-context search ROOT help` and `kogen-context search ROOT WORD` still search for that literal; an input word is never treated as a command.

The change is in `run` of `src/main.rs`; the `USAGE` constant is unchanged. Add to `tests/cli.rs`, using its existing `run` helper, one integration test `unknown_command_is_named_in_the_usage_refusal`: `run(&["frobnicate"])` and `run(&["frobnicate", "extra"])` give status 2, empty stdout and the line of item 1 with WORD `frobnicate`. The existing tests of the generic refusal stay unchanged.

## Decisions
- The unknown-command message is `unknown command: WORD; ` followed by the unchanged `USAGE` text, with code `usage` and status 2, so the existing exit-status rule for `usage` applies. (decision: D1, round 1) (evidence: src/main.rs; tests/cli.rs) (assumption: the user accepts this exact wording, which the request does not fix) (source: request)
- Every first argument that is not a supported word is named, including one that is not valid UTF-8 (shown lossily); a supported word with the wrong arguments and an empty argument list keep the generic usage refusal, because they are not unsupported commands and the existing tests pin the generic line for `version extra`, `help extra` and `--help search`. (decision: D2, round 2) (evidence: src/main.rs; tests/cli.rs) (source: request)
- Acceptance drives the built binary and does not run the new Rust test by name, because it does not exist before the Build; the project's own `cargo test` check runs it. (decision: D3, round 1) (evidence: features/steps/context-help-lists-every-command__steps.js; tests/cli.rs) (source: request)

## Source comparison
- Request expectation (unknown command named in the JSON refusal, status 2): addressed by Required change 1, scenario "An unknown command is named in the refusal", test `unknown_command_is_named_in_the_usage_refusal`.
- Request acceptance 2 (a search literal that matches a help word is still a search): addressed by Required change 3 and scenario "A search for a help word or an unknown word is still a search", plus the existing test `help_as_a_search_literal_is_a_search`.
- Out of scope (supported commands, exit statuses, stdout behavior): kept by Required change 2 and 3 and scenario "Supported commands with the wrong arguments keep the generic usage refusal".

## Tests
- An unsupported first argument is named in the usage refusal with status 2 and empty stdout: `unknown_command_is_named_in_the_usage_refusal` in tests/cli.rs (integration)
- A search literal that is a help word or an unknown word is still a search: `help_as_a_search_literal_is_a_search` in tests/cli.rs (existing)
- Supported words with wrong arguments and no arguments keep the generic refusal: `version_prints_one_line_and_takes_no_argument` and `help_with_more_arguments_is_still_usage` in tests/cli.rs (existing)

## Feasibility
- none
