Feature: Read distinguishes I/O errors from non-text files
  This feature checks the refusals of kogen-context read: not_text is reserved for
  invalid UTF-8 content, while open and read failures are I/O errors naming the path.

  Scenario: Invalid UTF-8 content is still refused as not_text
    Given read-distinguishes-io-errors-from-non-text: a checkout holding the file "broken-encoding.txt" with the bytes "fffe0a" in hexadecimal
    When read-distinguishes-io-errors-from-non-text: kogen-context read is run with the root "<checkout>" and the path "broken-encoding.txt" from line 1 to 1
    Then read-distinguishes-io-errors-from-non-text: the refusal code is "not_text"
    And read-distinguishes-io-errors-from-non-text: the refusal message names the path "broken-encoding.txt"
    And read-distinguishes-io-errors-from-non-text: the exit status is 1

  Scenario: A file that cannot be opened is refused as an I/O error
    Given read-distinguishes-io-errors-from-non-text: a checkout holding the file "locked-notes.txt" with the text "secret\n" that its owner cannot read
    When read-distinguishes-io-errors-from-non-text: kogen-context read is run with the root "<checkout>" and the path "locked-notes.txt" from line 1 to 1
    Then read-distinguishes-io-errors-from-non-text: the refusal code is not "not_text"
    And read-distinguishes-io-errors-from-non-text: the refusal message names the path "locked-notes.txt"
    And read-distinguishes-io-errors-from-non-text: the refusal message does not say the file is not UTF-8 text
    And read-distinguishes-io-errors-from-non-text: the exit status is 1

  Scenario: A read failure after opening is refused as an I/O error
    When read-distinguishes-io-errors-from-non-text: kogen-context read is run with the root "/proc/self" and the path "mem" from line 1 to 1
    Then read-distinguishes-io-errors-from-non-text: the refusal code is not "not_text"
    And read-distinguishes-io-errors-from-non-text: the refusal message names the path "mem"
    And read-distinguishes-io-errors-from-non-text: the refusal message does not say the file is not UTF-8 text
    And read-distinguishes-io-errors-from-non-text: the exit status is 1

  Scenario: A successful read still returns the requested lines and total
    Given read-distinguishes-io-errors-from-non-text: a checkout holding the file "notes.txt" with the text "alpha\nbeta\ngamma\n"
    When read-distinguishes-io-errors-from-non-text: kogen-context read is run with the root "<checkout>" and the path "notes.txt" from line 2 to 3
    Then read-distinguishes-io-errors-from-non-text: the packet total_lines is 3
    And read-distinguishes-io-errors-from-non-text: the packet lines are "2:beta,3:gamma"
    And read-distinguishes-io-errors-from-non-text: the exit status is 0
