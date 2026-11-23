Feature: kogen-context names an unknown command in its usage refusal
  This feature covers kogen-context run with an unsupported first word, with supported words and wrong arguments, with no arguments, and with search literals that look like commands. Arguments are separated by one space and the token <root> stands for the checkout root.

  Scenario: An unknown command is named in the refusal
    Given cli-names-unknown-command: a checkout holding the file "a.txt" with the text "help me\nfrobnicate me\n"
    When cli-names-unknown-command: kogen-context is run with the arguments "frobnicate"
    Then cli-names-unknown-command: the exit status is exactly 2
    And cli-names-unknown-command: standard output is empty
    And cli-names-unknown-command: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"unknown command: frobnicate; usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}
      """
    When cli-names-unknown-command: kogen-context is run with the arguments "frobnicate extra"
    Then cli-names-unknown-command: the exit status is exactly 2
    And cli-names-unknown-command: standard output is empty
    And cli-names-unknown-command: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"unknown command: frobnicate; usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}
      """

  Scenario: Supported commands with the wrong arguments keep the generic usage refusal
    Given cli-names-unknown-command: a checkout holding the file "a.txt" with the text "help me\nfrobnicate me\n"
    When cli-names-unknown-command: kogen-context is run with no arguments
    Then cli-names-unknown-command: the exit status is exactly 2
    And cli-names-unknown-command: standard output is empty
    And cli-names-unknown-command: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}
      """
    When cli-names-unknown-command: kogen-context is run with the arguments "version extra"
    Then cli-names-unknown-command: the exit status is exactly 2
    And cli-names-unknown-command: standard output is empty
    And cli-names-unknown-command: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}
      """
    When cli-names-unknown-command: kogen-context is run with the arguments "help extra"
    Then cli-names-unknown-command: the exit status is exactly 2
    And cli-names-unknown-command: standard output is empty
    And cli-names-unknown-command: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}
      """
    When cli-names-unknown-command: kogen-context is run with the arguments "search <root>"
    Then cli-names-unknown-command: the exit status is exactly 2
    And cli-names-unknown-command: standard output is empty
    And cli-names-unknown-command: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}
      """

  Scenario: A search for a help word or an unknown word is still a search
    Given cli-names-unknown-command: a checkout holding the file "a.txt" with the text "help me\nfrobnicate me\n"
    When cli-names-unknown-command: kogen-context is run with the arguments "search <root> help"
    Then cli-names-unknown-command: standard output is exactly the following text
      """
      {"query":"help","matches":[{"path":"a.txt","line":1,"column":1,"text":"help me"}],"truncated":false}
      """
    And cli-names-unknown-command: the exit status is exactly 0
    And cli-names-unknown-command: standard error is empty
    When cli-names-unknown-command: kogen-context is run with the arguments "search <root> frobnicate"
    Then cli-names-unknown-command: standard output is exactly the following text
      """
      {"query":"frobnicate","matches":[{"path":"a.txt","line":2,"column":1,"text":"frobnicate me"}],"truncated":false}
      """
    And cli-names-unknown-command: the exit status is exactly 0
    And cli-names-unknown-command: standard error is empty
