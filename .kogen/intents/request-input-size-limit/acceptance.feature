Feature: Bound kogen-context request input to 1 MiB
  This feature measures the complete standard input in UTF-8 bytes, including trailing JSON whitespace. Padding a valid search with spaces keeps the JSON valid on both sides of the boundary. Its non-ASCII literal makes byte and character counts differ and marks any request data leaked in the refusal.

  Scenario: The inclusive byte limit rejects oversized input without changing ordinary requests
    Given request-input-size-limit: the kogen-context CLI is built
    When request-input-size-limit: kogen-context request runs this JSON unpadded and padded to 1048575 and 1048576 bytes
      """
      {"version":1,"root":"contract/examples/checkout","operation":"search","literal":"request-size-sentinel-é-9f21"}
      """
    Then request-input-size-limit: each run exits with status 0 and returns this packet
      """
      {"version":1,"operation":"search","query":"request-size-sentinel-é-9f21","matches":[],"truncated":false,"limits":{"max_matches":100,"max_line_chars":500}}
      """
    When request-input-size-limit: kogen-context request runs the original search with its literal extended to fill 1048576 input bytes
    Then request-input-size-limit: it exits with status 0 and returns the complete search packet with that literal, larger than 1048576 bytes
    When request-input-size-limit: kogen-context request runs this input
      """
      {"version":1,}
      """
    Then request-input-size-limit: each run exits with status 2 and returns this packet
      """
      {"version":1,"error":{"code":"invalid_request","message":"request is not one valid JSON object"}}
      """
    When request-input-size-limit: kogen-context request runs this input
      """
      {"version":1,"root":"marker-root-1f3a","operation":"search","literal":"x","extra_member":true}
      """
    Then request-input-size-limit: each run exits with status 2 and returns this packet
      """
      {"version":1,"error":{"code":"invalid_request","message":"request does not match the version 1 request schema: extra_member is not a member of a search request"}}
      """
    When request-input-size-limit: kogen-context request runs the original search JSON padded to 1048577 and 2097152 bytes
    Then request-input-size-limit: each run exits with status 2 and returns one JSON refusal with code "invalid_request" without echoing "request-size-sentinel-é-9f21"
