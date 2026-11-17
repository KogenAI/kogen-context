Feature: The search and read commands refuse an argument that is not valid UTF-8
  This feature covers kogen-context search ROOT LITERAL and kogen-context read ROOT PATH START END when the literal or the path holds a byte that is not valid UTF-8. The byte 0xFF is written hex:ff in the arguments, and the bytes 0x64 0x2F 0xFF (d, a slash and 0xFF) hex:642fff.

  Scenario: A non-UTF-8 search literal is refused
    Given cli-refuses-arguments-that-are-not-utf-8: a checkout holding the file "a.txt" with the bytes "62616420efbfbd0a"
    When cli-refuses-arguments-that-are-not-utf-8: kogen-context is run with the arguments "search <root> hex:ff"
    Then cli-refuses-arguments-that-are-not-utf-8: the exit status is exactly 2
    And cli-refuses-arguments-that-are-not-utf-8: standard output is empty
    And cli-refuses-arguments-that-are-not-utf-8: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"the search literal is not valid UTF-8"}}
      """

  Scenario: A non-UTF-8 read path is refused
    Given cli-refuses-arguments-that-are-not-utf-8: a checkout holding the file "d/b.txt" with the bytes "610a"
    When cli-refuses-arguments-that-are-not-utf-8: kogen-context is run with the arguments "read <root> hex:642fff 1 1"
    Then cli-refuses-arguments-that-are-not-utf-8: the exit status is exactly 2
    And cli-refuses-arguments-that-are-not-utf-8: standard output is empty
    And cli-refuses-arguments-that-are-not-utf-8: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"the read path is not valid UTF-8"}}
      """

  Scenario: The refusal does not look at the root
    Given cli-refuses-arguments-that-are-not-utf-8: a checkout holding the file "a.txt" with the bytes "610a"
    When cli-refuses-arguments-that-are-not-utf-8: kogen-context is run with the arguments "search <missing-root> hex:ff"
    Then cli-refuses-arguments-that-are-not-utf-8: the exit status is exactly 2
    And cli-refuses-arguments-that-are-not-utf-8: standard output is empty
    And cli-refuses-arguments-that-are-not-utf-8: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"the search literal is not valid UTF-8"}}
      """

  Scenario: A valid UTF-8 literal still searches
    Given cli-refuses-arguments-that-are-not-utf-8: a checkout holding the file "a.txt" with the bytes "636166c3a920780a"
    When cli-refuses-arguments-that-are-not-utf-8: kogen-context is run with the arguments "search <root> café"
    Then cli-refuses-arguments-that-are-not-utf-8: the exit status is exactly 0
    And cli-refuses-arguments-that-are-not-utf-8: standard error is empty
    And cli-refuses-arguments-that-are-not-utf-8: standard output is exactly the following line
      """
      {"query":"café","matches":[{"path":"a.txt","line":1,"column":1,"text":"café x"}],"truncated":false}
      """
