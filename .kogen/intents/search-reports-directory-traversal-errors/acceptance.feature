Feature: Report directory enumeration failures in search

  Scenario: Refuse an incomplete search of a nested directory
    Given search-reports-directory-traversal-errors: a checkout with these files
      | path                 | text               |
      | app/locked/notes.txt | parse_config       |
      | app.py               | x = parse_config() |
    And search-reports-directory-traversal-errors: directory "app/locked" cannot be enumerated
    When search-reports-directory-traversal-errors: kogen-context search runs in that checkout for "parse_config"
    Then search-reports-directory-traversal-errors: search refuses with "io_error" naming "app/locked" and no results

  Scenario: Preserve the full results and order in an accessible tree
    Given search-reports-directory-traversal-errors: a checkout with these files
      | path             | text                   |
      | app/util.py      | def parse_config(path) |
      | app.py           | x = parse_config()     |
      | README.md        | Café parse_config      |
      | .gitignore       | app/ignored.txt        |
      | app/ignored.txt  | parse_config           |
      | .git/hidden.txt  | parse_config           |
    And search-reports-directory-traversal-errors: the checkout is a Git repository
    And search-reports-directory-traversal-errors: symlink "linked.py" points to "app.py"
    And search-reports-directory-traversal-errors: symlink "linked-dir" points to "app"
    When search-reports-directory-traversal-errors: kogen-context search runs in that checkout for "parse_config"
    Then search-reports-directory-traversal-errors: search succeeds with exactly this result
      """json
      {"query":"parse_config","matches":[
        {"path":"README.md","line":1,"column":6,"text":"Café parse_config"},
        {"path":"app.py","line":1,"column":5,"text":"x = parse_config()"},
        {"path":"app/ignored.txt","line":1,"column":1,"text":"parse_config"},
        {"path":"app/util.py","line":1,"column":5,"text":"def parse_config(path)"}
      ],"truncated":false}
      """

  Scenario: Skip unreadable and non-text regular files
    Given search-reports-directory-traversal-errors: a checkout with these files
      | path            | text               |
      | app/secret.txt  | parse_config       |
      | app/visible.txt | x = parse_config() |
    And search-reports-directory-traversal-errors: regular file "app/secret.txt" cannot be opened for reading
    And search-reports-directory-traversal-errors: file "app/binary.bin" contains invalid UTF-8 followed by "parse_config"
    When search-reports-directory-traversal-errors: kogen-context search runs in that checkout for "parse_config"
    Then search-reports-directory-traversal-errors: search succeeds with exactly this result
      """json
      {"query":"parse_config","matches":[
        {"path":"app/visible.txt","line":1,"column":5,"text":"x = parse_config()"}
      ],"truncated":false}
      """
    When search-reports-directory-traversal-errors: kogen-context read runs in that checkout for "app/secret.txt" at line 1
    Then search-reports-directory-traversal-errors: read refuses with "io_error" naming "app/secret.txt" and no results
    When search-reports-directory-traversal-errors: kogen-context read runs in that checkout for "app/binary.bin" at line 1
    Then search-reports-directory-traversal-errors: read refuses with "not_text" naming "app/binary.bin" and no results
