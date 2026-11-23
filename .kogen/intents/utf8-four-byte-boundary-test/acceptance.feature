Feature: A four-byte UTF-8 character across a block boundary is read intact
  This feature judges the unit tests of read_utf8_blocks in src/main.rs. Each scenario
  makes one wrong change to how incomplete bytes are retained between blocks and
  requires the unit tests to fail on it.

  Scenario: A four-byte character split after its first byte is returned intact
    Given utf8-four-byte-boundary-test: a copy of the Rust sources
    Then utf8-four-byte-boundary-test: the unit tests reject the mutant "drops the leading byte of a retained four-byte character"

  Scenario: A four-byte character split after its second byte is returned intact
    Given utf8-four-byte-boundary-test: a copy of the Rust sources
    Then utf8-four-byte-boundary-test: the unit tests reject the mutant "retains one byte of two incomplete bytes"

  Scenario: A four-byte character split after its third byte is returned intact
    Given utf8-four-byte-boundary-test: a copy of the Rust sources
    Then utf8-four-byte-boundary-test: the unit tests reject the mutant "retains two bytes of three incomplete bytes"

  Scenario: An incomplete final character is still refused
    Given utf8-four-byte-boundary-test: a copy of the Rust sources
    Then utf8-four-byte-boundary-test: the unit tests pass on the unchanged sources
    And utf8-four-byte-boundary-test: the unit tests reject the mutant "accepts an incomplete final character as complete text"
    And utf8-four-byte-boundary-test: the unit tests reject the mutant "drops the leading byte of a retained four-byte character"
