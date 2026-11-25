Feature: Validate version 1 read I/O refusals
  This feature aligns the packet schema with the existing I/O refusal.

  Scenario: Validate a failed read packet
    # Observed stdout (one JSON packet followed by a newline):
    # {"version":1,"error":{"code":"io_error","message":"cannot read file: mem: Input/output error (os error 5)"}}
    When packet-schema-allows-io-error: kogen-context request receives this JSON:
      """
      {"version":1,"root":"/proc/self","operation":"read","path":"mem","start":1,"end":1}
      """
    Then packet-schema-allows-io-error: the refusal has status 1, empty stderr, code "io_error", and a message starting with "cannot read file: mem: "
    And packet-schema-allows-io-error: the packet is "valid" against "contract/packet.schema.json"

  Scenario: Preserve the existing version 1 error codes
    Given packet-schema-allows-io-error: these version 1 error packets with message "x":
      | code                |
      | invalid_request     |
      | unsupported_version |
      | invalid_range       |
      | root_not_directory  |
      | path_outside_root   |
      | not_found           |
      | not_a_file          |
      | not_text            |
    Then packet-schema-allows-io-error: the packets are "valid" against "contract/packet.schema.json"

  Scenario: Reject an unknown error code
    Given packet-schema-allows-io-error: these version 1 error packets with message "x":
      | code  |
      | usage |
    Then packet-schema-allows-io-error: the packets are "invalid" against "contract/packet.schema.json"
