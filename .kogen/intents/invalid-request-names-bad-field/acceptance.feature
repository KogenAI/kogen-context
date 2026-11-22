Feature: Invalid-request refusals identify the offending field
  This feature covers kogen-context request when the JSON request does not match the version 1 request schema. The refusal keeps the code invalid_request and exit status 2, and its message names the first offending field and its problem without echoing the request. Every request below carries the root marker-root-1f3a, a value that must never appear in a refusal message.

  Scenario: An unknown operation is named with its unsupported value
    When invalid-request-names-bad-field: kogen-context request is run with the following request on standard input
      """
      {"version":1,"root":"marker-root-1f3a","operation":"find","literal":"x"}
      """
    Then invalid-request-names-bad-field: the exit status is exactly 2
    And invalid-request-names-bad-field: standard error is empty
    And invalid-request-names-bad-field: the packet is an error packet with the code "invalid_request"
    And invalid-request-names-bad-field: the error message contains "operation"
    And invalid-request-names-bad-field: the error message contains "find"
    And invalid-request-names-bad-field: the error message does not contain "marker-root-1f3a"

  Scenario: An unknown top-level member is named
    When invalid-request-names-bad-field: kogen-context request is run with the following request on standard input
      """
      {"version":1,"root":"marker-root-1f3a","operation":"search","literal":"x","extra_member":true}
      """
    Then invalid-request-names-bad-field: the exit status is exactly 2
    And invalid-request-names-bad-field: standard error is empty
    And invalid-request-names-bad-field: the packet is an error packet with the code "invalid_request"
    And invalid-request-names-bad-field: the error message contains "extra_member"
    And invalid-request-names-bad-field: the error message does not contain "marker-root-1f3a"

  Scenario Outline: An out-of-range limit is named with its accepted bound
    When invalid-request-names-bad-field: kogen-context request is run with the following request on standard input
      """
      {"version":1,"root":"marker-root-1f3a","operation":"<operation>",<fields>,"limits":{"<limit>":<value>}}
      """
    Then invalid-request-names-bad-field: the exit status is exactly 2
    And invalid-request-names-bad-field: standard error is empty
    And invalid-request-names-bad-field: the packet is an error packet with the code "invalid_request"
    And invalid-request-names-bad-field: the error message contains "<limit>"
    And invalid-request-names-bad-field: the error message contains "<bound>"
    And invalid-request-names-bad-field: the error message does not contain "marker-root-1f3a"

    Examples:
      | operation | fields                           | limit          | value | bound |
      | search    | "literal":"x"                    | max_matches    | 101   | 100   |
      | search    | "literal":"x"                    | max_line_chars | 501   | 500   |
      | read      | "path":"a.txt","start":1,"end":2 | max_lines      | 201   | 200   |
      | read      | "path":"a.txt","start":1,"end":2 | max_line_chars | 0     | 500   |

  Scenario: The first offending field is the one named
    When invalid-request-names-bad-field: kogen-context request is run with the following request on standard input
      """
      {"version":1,"root":"marker-root-1f3a","operation":"search","literal":"x","extra_member":true,"limits":{"max_matches":101}}
      """
    Then invalid-request-names-bad-field: the exit status is exactly 2
    And invalid-request-names-bad-field: the packet is an error packet with the code "invalid_request"
    And invalid-request-names-bad-field: the error message contains "extra_member"
    And invalid-request-names-bad-field: the error message does not contain "max_matches"

  Scenario: An unknown operation wins over a later offending field
    When invalid-request-names-bad-field: kogen-context request is run with the following request on standard input
      """
      {"version":1,"root":"marker-root-1f3a","operation":"find","extra_member":true,"limits":{"max_matches":101}}
      """
    Then invalid-request-names-bad-field: the exit status is exactly 2
    And invalid-request-names-bad-field: the packet is an error packet with the code "invalid_request"
    And invalid-request-names-bad-field: the error message contains "find"
    And invalid-request-names-bad-field: the error message does not contain "extra_member"
    And invalid-request-names-bad-field: the error message does not contain "max_matches"

  Scenario: Malformed JSON keeps its refusal
    When invalid-request-names-bad-field: kogen-context request is run with the following request on standard input
      """
      {"version":1,"root":"marker-root-1f3a",
      """
    Then invalid-request-names-bad-field: the exit status is exactly 2
    And invalid-request-names-bad-field: the packet is an error packet with the code "invalid_request"
    And invalid-request-names-bad-field: the error message is exactly "request is not one valid JSON object"

  Scenario: An unsupported version wins over schema problems
    When invalid-request-names-bad-field: kogen-context request is run with the following request on standard input
      """
      {"version":2,"root":"marker-root-1f3a","operation":"find","extra_member":true}
      """
    Then invalid-request-names-bad-field: the exit status is exactly 2
    And invalid-request-names-bad-field: the packet is an error packet with the code "unsupported_version"
    And invalid-request-names-bad-field: the error message is exactly "request version must be 1"

  Scenario: A valid request is still accepted
    When invalid-request-names-bad-field: kogen-context request is run with the following request on standard input
      """
      {"version":1,"root":"contract/examples/checkout","operation":"search","literal":"parse_config","limits":{"max_matches":5}}
      """
    Then invalid-request-names-bad-field: the exit status is exactly 0
    And invalid-request-names-bad-field: standard error is empty
    And invalid-request-names-bad-field: the packet is a search packet without an error member
