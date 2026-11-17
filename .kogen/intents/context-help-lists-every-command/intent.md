# List every command when asked for help

Slug: context-help-lists-every-command
Model: not applicable — the change is an argument check of a stateless command-line program with no state that persists between runs
Acceptance:
- .kogen/intents/context-help-lists-every-command/acceptance.feature
- features/steps/context-help-lists-every-command__steps.js

`kogen-context --help`, `kogen-context -h` and `kogen-context help` are today an unknown command: nothing on stdout, one JSON `usage` error line on stderr and exit status 2. That usage text names only `search` and `read`, so a caller asking for help learns about two of the four commands. This change makes asking for help succeed and list every command (`search`, `read`, `request` and `version`).

In `src/main.rs`, `main` handles `request` and `version` before `run`, and `run` accepts only `search` with 3 arguments and `read` with 5; every other argument list is `Err(usage())`. The usage refusal text stays byte for byte unchanged.

## Required change

1. When `--help`, `-h` or `help` is the only argument (one argument in total), `kogen-context` prints exactly these five lines on stdout, each ending in a newline, nothing on stderr, and exits with status 0. The four command lines start with two spaces. As one string the output is `usage:\n  kogen-context search ROOT LITERAL\n  kogen-context read ROOT PATH START END\n  kogen-context request\n  kogen-context version\n`:

```
usage:
  kogen-context search ROOT LITERAL
  kogen-context read ROOT PATH START END
  kogen-context request
  kogen-context version
```

2. A help word followed by any other argument, no argument at all, and every other unknown word keep the existing usage refusal: stdout empty, the unchanged line `{"error":{"code":"usage","message":"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}` on stderr, exit status 2.
3. `search`, `read`, `request` and `version` keep their output, exit statuses and refusals; `kogen-context search ROOT help` still searches for the literal `help`.
4. In `README.md`, the paragraph of "Current state" that lists the commands gets one sentence saying that `--help`, `-h` and `help` print the list of commands.

No new option, flag or setting; no cache or index change; no change to the contract schemas or to the packet of any request.

Add model-free Rust integration tests to `tests/cli.rs`, using its existing `run` helper (it runs the built binary), `stdout(&out)` (asserts exit status 0 and empty stderr) and `Checkout`. Their names all contain `help`, so `cargo test --locked --offline --test cli help` runs them:
- `help_flag_lists_every_command`: `run(&["--help"])` gives status 0, empty stderr and the five lines above on stdout.
- `help_short_forms_print_the_same_list`: `run(&["-h"])` and `run(&["help"])` give the same.
- `help_with_more_arguments_is_still_usage`: `run(&["help", "extra"])` and `run(&["--help", "search"])` give status 2, empty stdout and the unchanged usage line on stderr.
- `help_as_a_search_literal_is_a_search`: in a `Checkout` with `a.txt` holding `help me\n`, `run(&["search", root, "help"])` gives status 0 and a packet with one match, path `a.txt`, line 1, column 1, text `help me`.

## Decisions
- The help handling is one branch in `main` in `src/main.rs`, next to the `version` branch, matching exactly one argument among `--help`, `-h` and `help`; `run` and the `USAGE` constant stay as they are, so every other argument list keeps the usage refusal. (decision: D1, round 1) (constraint: the usage refusal text stays byte for byte unchanged) (constraint: no new option, flag or setting) (evidence: src/main.rs; tests/cli.rs) (source: request)
- Acceptance drives the built binary and does not run the `help` Rust tests by name, because they do not exist before the Build; those tests are required by this Intent and run by the project's own `cargo test` check. (decision: D2, round 1) (evidence: features/steps/cli-refuses-arguments-that-are-not-utf-8__steps.js; tests/cli.rs) (source: request)
- The README sentence is a documentation change with no executable behavior and is not covered by acceptance or a test line. (decision: D3, round 1) (evidence: README.md) (assumption: the user accepts that the README sentence is verified by review, not by a scenario) (source: request)

## Source comparison
- Request expectation 1 (help lists five lines, status 0, empty stderr): addressed by Required change 1, scenarios "The help flag lists every command" and "The short forms print the same list", tests `help_flag_lists_every_command` and `help_short_forms_print_the_same_list`.
- Request expectation 2 (help with more arguments, no argument and unknown words keep the refusal): addressed by Required change 2, scenario "Help with more arguments is still refused", test `help_with_more_arguments_is_still_usage`; the existing tests cover the unknown word and the missing arguments.
- Request expectation 3 (other commands unchanged, `search ROOT help` searches): addressed by Required change 3, scenario "A search for the literal help still searches", test `help_as_a_search_literal_is_a_search`, and the existing tests.
- Request expectation 4 (README sentence): addressed by Required change 4.
- Usage refusal text pinned by earlier accepted scenarios and `version_prints_one_line_and_takes_no_argument`: unchanged.

## Tests
- `--help` prints the five-line command list with status 0 and empty stderr: `help_flag_lists_every_command` in tests/cli.rs (integration)
- `-h` and `help` print the same list: `help_short_forms_print_the_same_list` in tests/cli.rs (integration)
- A help word with another argument is still the usage refusal: `help_with_more_arguments_is_still_usage` in tests/cli.rs (integration)
- `search ROOT help` still searches for the literal: `help_as_a_search_literal_is_a_search` in tests/cli.rs (integration)
- Other commands and refusals are unchanged: the existing tests in tests/cli.rs (existing)

## Feasibility
- none
