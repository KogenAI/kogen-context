Feature: Name commands and expected counts in wrong-arity refusals
  This feature changes only search and read wrong-arity diagnostics.

  Background:
    Given cli-arity-refusals-name-command: the CLI is built and the example checkout exists

  Scenario Outline: Refuse wrong-arity search invocations
    When cli-arity-refusals-name-command: I invoke the CLI with "<arguments>"
    Then cli-arity-refusals-name-command: the usage refusal identifies "search" and expects 2 arguments

    Examples:
      | arguments                                                       |
      | search                                                          |
      | search contract/examples/checkout                               |
      | search contract/examples/checkout parse_config extra             |

  Scenario Outline: Refuse wrong-arity read invocations
    When cli-arity-refusals-name-command: I invoke the CLI with "<arguments>"
    Then cli-arity-refusals-name-command: the usage refusal identifies "read" and expects 4 arguments

    Examples:
      | arguments                                                       |
      | read                                                            |
      | read contract/examples/checkout                                 |
      | read contract/examples/checkout util.py                          |
      | read contract/examples/checkout util.py 1                        |
      | read contract/examples/checkout util.py 1 2 extra                |

  Scenario: Preserve successful search output
    When cli-arity-refusals-name-command: I invoke the CLI with "search contract/examples/checkout parse_config"
    Then cli-arity-refusals-name-command: the command succeeds with this output
      """
      {"query":"parse_config","matches":[{"path":"README.md","line":3,"column":6,"text":"Call parse_config to load settings."},{"path":"app.py","line":1,"column":18,"text":"from util import parse_config"},{"path":"app.py","line":3,"column":10,"text":"CONFIG = parse_config(\"app.toml\")"},{"path":"util.py","line":1,"column":5,"text":"def parse_config(path):"}],"truncated":false}
      """

  Scenario: Preserve successful read output
    When cli-arity-refusals-name-command: I invoke the CLI with "read contract/examples/checkout util.py 1 2"
    Then cli-arity-refusals-name-command: the command succeeds with this output
      """
      {"path":"util.py","start":1,"end":2,"total_lines":2,"lines":[{"line":1,"text":"def parse_config(path):"},{"line":2,"text":"    return open(path).read()"}]}
      """

  Scenario Outline: Preserve other usage refusals
    When cli-arity-refusals-name-command: I invoke the CLI with "<arguments>"
    Then cli-arity-refusals-name-command: the usage refusal is
      """
      {"error":{"code":"usage","message":"<message>"}}
      """

    Examples:
      | arguments         | message                                                                                                                                       |
      |                   | usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END                                                               |
      | help extra        | usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END                                                               |
      | frobnicate        | unknown command: frobnicate; usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END                                  |
      | frobnicate extra  | unknown command: frobnicate; usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END                                  |
