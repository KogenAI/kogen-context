Feature: Read directory path refusal regression coverage
  This feature adds coverage to tests/cli.rs without changing production behavior.
  The integration target runs the real built kogen-context read ROOT PATH START END command.
  A directory must return status 1, no stdout, and stderr with not_a_file and the supplied path.
  A regular file must still return the requested lines.

  Background:
    Given read-directory-path-refusal-test: a temporary copy of the CLI integration target

  Scenario: Retain working CLI integration behavior
    Then read-directory-path-refusal-test: the CLI integration tests pass with unchanged read behavior

  Scenario: Detect a changed directory refusal code
    Then read-directory-path-refusal-test: the CLI integration tests reject "changed refusal code"

  Scenario: Detect an omitted supplied directory path
    Then read-directory-path-refusal-test: the CLI integration tests reject "omitted supplied path"

  Scenario: Detect an incorrect directory exit status
    Then read-directory-path-refusal-test: the CLI integration tests reject "wrong directory status"

  Scenario: Detect directory output on stdout
    Then read-directory-path-refusal-test: the CLI integration tests reject "directory stdout leak"

  Scenario: Preserve requested regular-file lines
    Then read-directory-path-refusal-test: the CLI integration tests reject "changed regular-file lines"
