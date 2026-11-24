Feature: Binary-level invalid UTF-8 refusal coverage
  This feature adds regression coverage in tests/contract.rs, without changing
  parsing or refusal behavior. Raw request-mode input containing invalid UTF-8
  must yield status 2, empty stderr, and one valid JSON error packet with code
  invalid_request and message "request is not one valid JSON object". The packet
  must not include the invalid input bytes. Parser-only assertions cannot detect
  these transport regressions. Mutations affect only non-UTF-8 binary input.

  Scenario: Retain passing binary contract coverage
    Given request-invalid-utf8-packet-test: a temporary copy of the contract integration target
    Then request-invalid-utf8-packet-test: the contract tests pass with unchanged request handling

  Scenario Outline: Catch non-UTF-8 refusal transport regressions
    Given request-invalid-utf8-packet-test: a temporary copy of the contract integration target
    Then request-invalid-utf8-packet-test: the contract tests reject a non-UTF-8-only regression in "<property>"

    Examples:
      | property        |
      | exit status     |
      | JSON formatting |
      | packet count    |
      | stderr          |
      | error code      |
      | error message   |
      | input echo      |
