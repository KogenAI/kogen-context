Feature: An unwritable standard output is an ordinary refusal, not a panic
  This feature covers every kogen-context command that prints a result (request, search, read, version) when standard output is /dev/full, which fails every write with No space left on device. Each scenario starts the built binary with standard output on /dev/full.

  Scenario: A request whose packet cannot be written exits 1 with nothing on stderr
    Given stdout-write-failure-exits-without-panic: a checkout holding the file "a.txt" with the text "x"
    And stdout-write-failure-exits-without-panic: the request text that searches that checkout for "x"
    When stdout-write-failure-exits-without-panic: kogen-context request is run with that request text on standard input and standard output on /dev/full
    Then stdout-write-failure-exits-without-panic: the exit status is exactly 1
    And stdout-write-failure-exits-without-panic: standard error is empty

  Scenario: A search whose output cannot be written reports one JSON line on stderr
    Given stdout-write-failure-exits-without-panic: a checkout holding the file "a.txt" with the text "x"
    When stdout-write-failure-exits-without-panic: kogen-context is run with the arguments "search <root> x" and standard output on /dev/full
    Then stdout-write-failure-exits-without-panic: the exit status is exactly 1
    And stdout-write-failure-exits-without-panic: standard error is exactly the following line
      """
      {"error":{"code":"output_failed","message":"cannot write to standard output"}}
      """

  Scenario: A read whose output cannot be written reports one JSON line on stderr
    Given stdout-write-failure-exits-without-panic: a checkout holding the file "a.txt" with the text "x"
    When stdout-write-failure-exits-without-panic: kogen-context is run with the arguments "read <root> a.txt 1 1" and standard output on /dev/full
    Then stdout-write-failure-exits-without-panic: the exit status is exactly 1
    And stdout-write-failure-exits-without-panic: standard error is exactly the following line
      """
      {"error":{"code":"output_failed","message":"cannot write to standard output"}}
      """

  Scenario: A version whose output cannot be written reports one JSON line on stderr
    When stdout-write-failure-exits-without-panic: kogen-context is run with the arguments "version" and standard output on /dev/full
    Then stdout-write-failure-exits-without-panic: the exit status is exactly 1
    And stdout-write-failure-exits-without-panic: standard error is exactly the following line
      """
      {"error":{"code":"output_failed","message":"cannot write to standard output"}}
      """

  Scenario: The contract README states the exit status for an unwritable standard output
    Then stdout-write-failure-exits-without-panic: the Invocation section of "contract/README.md" contains the sentence "When standard output cannot be written, the command exits with status 1 and, for `request`, writes nothing to stderr."
