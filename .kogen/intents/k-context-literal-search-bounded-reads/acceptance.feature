Feature: Literal search and bounded source reads in one selected checkout
  kogen-context search ROOT LITERAL and kogen-context read ROOT PATH START END
  work on a fresh checkout without an index and print deterministic, bounded JSON
  with repo-relative paths and exact line evidence.

  Scenario: Search a Go checkout for an exact literal
    Given k-context-literal-search-bounded-reads: the Go fixture checkout
    When k-context-literal-search-bounded-reads: I search for "Hello"
    Then k-context-literal-search-bounded-reads: the command succeeds with JSON:
      """
      {"query":"Hello","matches":[{"path":"internal/greet/greet.go","line":3,"column":4,"text":"// Hello returns a greeting for name."},{"path":"internal/greet/greet.go","line":4,"column":6,"text":"func Hello(name string) string {"},{"path":"internal/greet/greet.go","line":5,"column":10,"text":"\treturn \"Hello, \" + name"},{"path":"main.go","line":6,"column":16,"text":"\tprintln(greet.Hello(\"world\"))"}],"truncated":false}
      """
    And k-context-literal-search-bounded-reads: running the same command again prints identical bytes
    And k-context-literal-search-bounded-reads: the checkout contents are unchanged

  Scenario: Search is case-sensitive and a search with no hits succeeds with no matches
    Given k-context-literal-search-bounded-reads: the Go fixture checkout
    When k-context-literal-search-bounded-reads: I search for "hello"
    Then k-context-literal-search-bounded-reads: the command succeeds with JSON:
      """
      {"query":"hello","matches":[],"truncated":false}
      """
    And k-context-literal-search-bounded-reads: the checkout contents are unchanged

  Scenario: Read a bounded line range from a Go checkout
    Given k-context-literal-search-bounded-reads: the Go fixture checkout
    When k-context-literal-search-bounded-reads: I read "main.go" lines "5" to "7"
    Then k-context-literal-search-bounded-reads: the command succeeds with JSON:
      """
      {"path":"main.go","start":5,"end":7,"total_lines":7,"lines":[{"line":5,"text":"func main() {"},{"line":6,"text":"\tprintln(greet.Hello(\"world\"))"},{"line":7,"text":"}"}]}
      """
    And k-context-literal-search-bounded-reads: running the same command again prints identical bytes
    And k-context-literal-search-bounded-reads: the checkout contents are unchanged

  Scenario: Search a non-Go checkout in bytewise path order, skipping files that are not UTF-8
    Given k-context-literal-search-bounded-reads: the non-Go fixture checkout
    When k-context-literal-search-bounded-reads: I search for "parse_config"
    Then k-context-literal-search-bounded-reads: the command succeeds with JSON:
      """
      {"query":"parse_config","matches":[{"path":"README.md","line":3,"column":12,"text":"Café: call parse_config to load settings."},{"path":"app.py","line":1,"column":22,"text":"from app.util import parse_config"},{"path":"app.py","line":3,"column":10,"text":"CONFIG = parse_config(\"app.toml\")"},{"path":"app/util.py","line":1,"column":5,"text":"def parse_config(path):"}],"truncated":false}
      """
    And k-context-literal-search-bounded-reads: running the same command again prints identical bytes
    And k-context-literal-search-bounded-reads: the checkout contents are unchanged

  Scenario: Read CRLF lines from a non-Go checkout
    Given k-context-literal-search-bounded-reads: the non-Go fixture checkout
    When k-context-literal-search-bounded-reads: I read "app/util.py" lines "1" to "2"
    Then k-context-literal-search-bounded-reads: the command succeeds with JSON:
      """
      {"path":"app/util.py","start":1,"end":2,"total_lines":2,"lines":[{"line":1,"text":"def parse_config(path):"},{"line":2,"text":"    return open(path).read()"}]}
      """

  Scenario: Read reports the normalized repo-relative path and counts a last line without a newline
    Given k-context-literal-search-bounded-reads: the non-Go fixture checkout
    When k-context-literal-search-bounded-reads: I read "./app/../app.py" lines "3" to "3"
    Then k-context-literal-search-bounded-reads: the command succeeds with JSON:
      """
      {"path":"app.py","start":3,"end":3,"total_lines":3,"lines":[{"line":3,"text":"CONFIG = parse_config(\"app.toml\")"}]}
      """

  Scenario: Reading a file that is not UTF-8 text is refused
    Given k-context-literal-search-bounded-reads: the non-Go fixture checkout
    When k-context-literal-search-bounded-reads: I read "logo.bin" lines "1" to "1"
    Then k-context-literal-search-bounded-reads: the command fails with exit code 1, error code "not_text" and message "file is not UTF-8 text: logo.bin"

  Scenario: Symlinks that escape the checkout are never searched or read
    Given k-context-literal-search-bounded-reads: the Go fixture checkout
    And k-context-literal-search-bounded-reads: the checkout links outside it as directory "linked" and file "leak.go"
    When k-context-literal-search-bounded-reads: I search for "Hello"
    Then k-context-literal-search-bounded-reads: the command succeeds with JSON:
      """
      {"query":"Hello","matches":[{"path":"internal/greet/greet.go","line":3,"column":4,"text":"// Hello returns a greeting for name."},{"path":"internal/greet/greet.go","line":4,"column":6,"text":"func Hello(name string) string {"},{"path":"internal/greet/greet.go","line":5,"column":10,"text":"\treturn \"Hello, \" + name"},{"path":"main.go","line":6,"column":16,"text":"\tprintln(greet.Hello(\"world\"))"}],"truncated":false}
      """
    When k-context-literal-search-bounded-reads: I read "leak.go" lines "1" to "1"
    Then k-context-literal-search-bounded-reads: the command fails with exit code 1, error code "path_outside_root" and message "path escapes the checkout root: leak.go"
    When k-context-literal-search-bounded-reads: I read "linked/secret.txt" lines "1" to "1"
    Then k-context-literal-search-bounded-reads: the command fails with exit code 1, error code "path_outside_root" and message "path escapes the checkout root: linked/secret.txt"
    And k-context-literal-search-bounded-reads: the checkout contents are unchanged

  Scenario Outline: Invalid reads are refused with a clear error
    Given k-context-literal-search-bounded-reads: the Go fixture checkout
    And k-context-literal-search-bounded-reads: the checkout links outside it as directory "linked" and file "leak.go"
    When k-context-literal-search-bounded-reads: I read "<path>" lines "<start>" to "<end>"
    Then k-context-literal-search-bounded-reads: the command fails with exit code 1, error code "<code>" and message "<message>"

    Examples:
      | path                       | start | end | code              | message                                                    |
      | missing.go                 | 1     | 1   | not_found         | file not found: missing.go                                 |
      | internal                   | 1     | 1   | not_a_file        | not a regular file: internal                               |
      | internal/greet             | 1     | 1   | not_a_file        | not a regular file: internal/greet                         |
      | main.go                    | 0     | 2   | invalid_range     | start and end must be positive integers                    |
      | main.go                    | x     | 2   | invalid_range     | start and end must be positive integers                    |
      | main.go                    | 3     | 2   | invalid_range     | start line 3 is after end line 2                           |
      | main.go                    | 7     | 8   | invalid_range     | line range 7-8 exceeds the file's line count 7             |
      | main.go                    | 8     | 8   | invalid_range     | line range 8-8 exceeds the file's line count 7             |
      | ../outside/secret.txt      | 1     | 1   | path_outside_root | path escapes the checkout root: ../outside/secret.txt      |
      | internal/../../outside.txt | 1     | 1   | path_outside_root | path escapes the checkout root: internal/../../outside.txt |
      | /etc/hostname              | 1     | 1   | path_outside_root | path escapes the checkout root: /etc/hostname              |

  Scenario: Reading the full last line of a file is accepted
    Given k-context-literal-search-bounded-reads: the Go fixture checkout
    When k-context-literal-search-bounded-reads: I read "go.mod" lines "1" to "3"
    Then k-context-literal-search-bounded-reads: the command succeeds with JSON:
      """
      {"path":"go.mod","start":1,"end":3,"total_lines":3,"lines":[{"line":1,"text":"module example.com/demo"},{"line":2,"text":""},{"line":3,"text":"go 1.27"}]}
      """

  Scenario Outline: Usage and checkout root errors are refused with a clear error
    Given k-context-literal-search-bounded-reads: the Go fixture checkout
    When k-context-literal-search-bounded-reads: I run kogen-context with arguments '<arguments>'
    Then k-context-literal-search-bounded-reads: the command fails with exit code <exit>, error code "<code>" and message "<message>"

    Examples:
      | arguments                                  | exit | code               | message                                                                            |
      | []                                         | 2    | usage              | usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END |
      | ["find","{root}","Hello"]                  | 2    | usage              | usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END |
      | ["search","{root}"]                        | 2    | usage              | usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END |
      | ["search","{root}","Hello","extra"]        | 2    | usage              | usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END |
      | ["read","{root}","main.go","1"]            | 2    | usage              | usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END |
      | ["search","{root}",""]                     | 2    | usage              | the search literal must not be empty                                               |
      | ["search","{root}/missing","Hello"]        | 1    | root_not_directory | checkout root is not a directory: {root}/missing                                   |
      | ["read","{root}/main.go","go.mod","1","1"] | 1    | root_not_directory | checkout root is not a directory: {root}/main.go                                   |

  Scenario: Search returns at most 100 matching lines and says when more exist
    Given k-context-literal-search-bounded-reads: a checkout file "many.txt" of 101 lines each containing "needle"
    When k-context-literal-search-bounded-reads: I search for "needle"
    Then k-context-literal-search-bounded-reads: the search output has 100 matches in "many.txt" from line 1 to line 100, truncated "true"

  Scenario: Search with exactly 100 matching lines is not truncated
    Given k-context-literal-search-bounded-reads: a checkout file "many.txt" of 100 lines each containing "needle"
    When k-context-literal-search-bounded-reads: I search for "needle"
    Then k-context-literal-search-bounded-reads: the search output has 100 matches in "many.txt" from line 1 to line 100, truncated "false"

  Scenario: A read returns at most 200 lines
    Given k-context-literal-search-bounded-reads: a checkout file "long.txt" of 250 lines each containing "needle"
    When k-context-literal-search-bounded-reads: I read "long.txt" lines "1" to "200"
    Then k-context-literal-search-bounded-reads: the read output has lines 1 to 200 of 250 in "long.txt"
    When k-context-literal-search-bounded-reads: I read "long.txt" lines "51" to "250"
    Then k-context-literal-search-bounded-reads: the read output has lines 51 to 250 of 250 in "long.txt"
    When k-context-literal-search-bounded-reads: I read "long.txt" lines "1" to "201"
    Then k-context-literal-search-bounded-reads: the command fails with exit code 1, error code "invalid_range" and message "line range 1-201 exceeds the 200-line read limit"

  Scenario: Line text is limited to its first 500 characters
    Given k-context-literal-search-bounded-reads: a checkout file "wide.txt" holding one line of 501 "x" characters
    And k-context-literal-search-bounded-reads: a checkout file "exact.txt" holding one line of 500 "y" characters
    When k-context-literal-search-bounded-reads: I read "wide.txt" lines "1" to "1"
    Then k-context-literal-search-bounded-reads: the read output line 1 of "wide.txt" is 500 "x" characters
    When k-context-literal-search-bounded-reads: I read "exact.txt" lines "1" to "1"
    Then k-context-literal-search-bounded-reads: the read output line 1 of "exact.txt" is 500 "y" characters
    When k-context-literal-search-bounded-reads: I search for "xxx"
    Then k-context-literal-search-bounded-reads: the only search match is in "wide.txt" at line 1 column 1 with 500 "x" characters
