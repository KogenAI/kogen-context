Feature: kogen-context prints the list of its commands when asked for help
  This feature covers kogen-context with the single argument --help, -h or help, the same words with another argument, and a search for the literal help. Arguments are separated by one space and the token <root> stands for the checkout root.

  Scenario: The help flag lists every command
    Given context-help-lists-every-command: a checkout holding the file "a.txt" with the text "help me\n"
    When context-help-lists-every-command: kogen-context is run with the arguments "--help"
    Then context-help-lists-every-command: standard output is exactly the following text
      """
      usage:
        kogen-context search ROOT LITERAL
        kogen-context read ROOT PATH START END
        kogen-context request
        kogen-context version
      """
    And context-help-lists-every-command: the exit status is exactly 0
    And context-help-lists-every-command: standard error is empty

  Scenario: The short forms print the same list
    Given context-help-lists-every-command: a checkout holding the file "a.txt" with the text "help me\n"
    When context-help-lists-every-command: kogen-context is run with the arguments "-h"
    Then context-help-lists-every-command: the exit status is exactly 0
    And context-help-lists-every-command: standard error is empty
    And context-help-lists-every-command: standard output is exactly the following text
      """
      usage:
        kogen-context search ROOT LITERAL
        kogen-context read ROOT PATH START END
        kogen-context request
        kogen-context version
      """
    When context-help-lists-every-command: kogen-context is run with the arguments "help"
    Then context-help-lists-every-command: the exit status is exactly 0
    And context-help-lists-every-command: standard error is empty
    And context-help-lists-every-command: standard output is exactly the following text
      """
      usage:
        kogen-context search ROOT LITERAL
        kogen-context read ROOT PATH START END
        kogen-context request
        kogen-context version
      """

  Scenario: Help with more arguments is still refused
    Given context-help-lists-every-command: a checkout holding the file "a.txt" with the text "help me\n"
    When context-help-lists-every-command: kogen-context is run with the arguments "help extra"
    Then context-help-lists-every-command: the exit status is exactly 2
    And context-help-lists-every-command: standard output is empty
    And context-help-lists-every-command: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}
      """
    When context-help-lists-every-command: kogen-context is run with the arguments "--help search"
    Then context-help-lists-every-command: the exit status is exactly 2
    And context-help-lists-every-command: standard output is empty
    And context-help-lists-every-command: standard error is exactly the following line
      """
      {"error":{"code":"usage","message":"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}
      """

  Scenario: A search for the literal help still searches
    Given context-help-lists-every-command: a checkout holding the file "a.txt" with the text "help me\n"
    When context-help-lists-every-command: kogen-context is run with the arguments "search <root> help"
    Then context-help-lists-every-command: standard output is exactly the following text
      """
      {"query":"help","matches":[{"path":"a.txt","line":1,"column":1,"text":"help me"}],"truncated":false}
      """
    And context-help-lists-every-command: the exit status is exactly 0
    And context-help-lists-every-command: standard error is empty
