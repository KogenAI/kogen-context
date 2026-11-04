Feature: Fixture corpus and golden packets for kogen-context tests
  A checked-in corpus of a Go, a JS/TS and a Python checkout, with golden
  version 1 packets of kogen-context request for literal searches and bounded
  reads over it. cargo test runs the binary on every golden request, compares
  its output to the golden packet byte for byte and checks that the corpus is
  unchanged; KOGEN_CONTEXT_UPDATE_GOLDENS=1 rewrites the packets instead.

  Scenario: The corpus holds a Go, a JS/TS and a Python checkout with nested, binary, oversized and escaping symlinked paths
    Then k-context-fixture-corpus-goldens: the directory "tests/corpus" holds exactly these regular files and symlinks:
      """
      go/assets/logo.png
      go/go.mod
      go/internal/report/format.go
      go/internal/report/format_test.go
      go/internal/report/rows_generated.go
      go/leak.go -> ../outside/secret.txt
      go/linked -> ../outside
      go/main.go
      js/leak.js -> ../outside/secret.txt
      js/linked -> ../outside
      js/package.json
      js/public/favicon.ico
      js/src/generated/catalog.js
      js/src/index.js
      js/src/lib/format.ts
      js/test/format.test.js
      outside/secret.txt
      python/app/__init__.py
      python/app/cli.py
      python/app/data/fixtures.py
      python/app/data/icon.png
      python/app/report/__init__.py
      python/app/report/format.py
      python/leak.py -> ../outside/secret.txt
      python/linked -> ../outside
      python/pyproject.toml
      python/tests/test_format.py
      """
    And k-context-fixture-corpus-goldens: the file "tests/corpus/outside/secret.txt" has exactly the content:
      """
      KOGEN_OUTSIDE_SENTINEL: FormatRow formatRow format_row
      """
    And k-context-fixture-corpus-goldens: these symlinks resolve outside their checkout:
      | symlink                     | checkout            | resolves to                     |
      | tests/corpus/go/leak.go     | tests/corpus/go     | tests/corpus/outside/secret.txt |
      | tests/corpus/go/linked      | tests/corpus/go     | tests/corpus/outside            |
      | tests/corpus/js/leak.js     | tests/corpus/js     | tests/corpus/outside/secret.txt |
      | tests/corpus/js/linked      | tests/corpus/js     | tests/corpus/outside            |
      | tests/corpus/python/leak.py | tests/corpus/python | tests/corpus/outside/secret.txt |
      | tests/corpus/python/linked  | tests/corpus/python | tests/corpus/outside            |
    And k-context-fixture-corpus-goldens: at least 101 lines of the file "tests/corpus/go/internal/report/rows_generated.go" contain "Row{"
    And k-context-fixture-corpus-goldens: line 1 of the file "tests/corpus/js/src/generated/catalog.js" is longer than 500 characters and contains "formatRow"

  Scenario Outline: The <checkout> checkout is a few hundred lines with a binary file and an oversized file
    Then k-context-fixture-corpus-goldens: the regular UTF-8 files of "tests/corpus/<checkout>" hold between 200 and 800 lines in total
    And k-context-fixture-corpus-goldens: the file "tests/corpus/<checkout>/<binary>" is not valid UTF-8 and contains the bytes of "<literal>"
    And k-context-fixture-corpus-goldens: the file "tests/corpus/<checkout>/<oversized>" is UTF-8 text with at least 210 lines

    Examples:
      | checkout | binary             | literal   | oversized                         |
      | go       | assets/logo.png    | FormatRow | internal/report/rows_generated.go |
      | js       | public/favicon.ico | formatRow | src/generated/catalog.js          |
      | python   | app/data/icon.png  | format_row | app/data/fixtures.py             |

  Scenario: Every golden packet is exactly what kogen-context request prints for its request, and no run changes the corpus
    Then k-context-fixture-corpus-goldens: the directory "tests/goldens" holds exactly the request and packet files of these goldens:
      | golden                   |
      | go-search                |
      | go-search-nested-root    |
      | go-search-truncated      |
      | go-search-outside        |
      | go-read-oversized        |
      | go-read-file-symlink     |
      | go-read-dir-symlink      |
      | go-read-traversal        |
      | go-read-binary           |
      | js-search                |
      | js-search-limited        |
      | js-search-outside        |
      | js-read-oversized        |
      | js-read-limited          |
      | js-read-over-limit       |
      | js-read-file-symlink     |
      | js-read-dir-symlink      |
      | js-read-binary           |
      | python-search            |
      | python-search-outside    |
      | python-read-oversized    |
      | python-read-over-limit   |
      | python-read-file-symlink |
      | python-read-dir-symlink  |
      | python-read-traversal    |
      | python-read-binary       |
    And k-context-fixture-corpus-goldens: these golden requests hold exactly this JSON:
      | golden                   | request                                                                                                                                                     |
      | go-search                | {"version":1,"root":"tests/corpus/go","operation":"search","literal":"FormatRow"}                                                                           |
      | go-search-nested-root    | {"version":1,"root":"tests/corpus/go/internal","operation":"search","literal":"FormatRow"}                                                                  |
      | go-search-truncated      | {"version":1,"root":"tests/corpus/go","operation":"search","literal":"Row{"}                                                                                |
      | go-search-outside        | {"version":1,"root":"tests/corpus/go","operation":"search","literal":"KOGEN_OUTSIDE_SENTINEL"}                                                              |
      | go-read-oversized        | {"version":1,"root":"tests/corpus/go","operation":"read","path":"internal/report/rows_generated.go","start":1,"end":200}                                    |
      | go-read-file-symlink     | {"version":1,"root":"tests/corpus/go","operation":"read","path":"leak.go","start":1,"end":1}                                                                |
      | go-read-dir-symlink      | {"version":1,"root":"tests/corpus/go","operation":"read","path":"linked/secret.txt","start":1,"end":1}                                                      |
      | go-read-traversal        | {"version":1,"root":"tests/corpus/go","operation":"read","path":"../outside/secret.txt","start":1,"end":1}                                                  |
      | go-read-binary           | {"version":1,"root":"tests/corpus/go","operation":"read","path":"assets/logo.png","start":1,"end":1}                                                        |
      | js-search                | {"version":1,"root":"tests/corpus/js","operation":"search","literal":"formatRow"}                                                                           |
      | js-search-limited        | {"version":1,"root":"tests/corpus/js","operation":"search","literal":"formatRow","limits":{"max_matches":3,"max_line_chars":20}}                            |
      | js-search-outside        | {"version":1,"root":"tests/corpus/js","operation":"search","literal":"KOGEN_OUTSIDE_SENTINEL"}                                                              |
      | js-read-oversized        | {"version":1,"root":"tests/corpus/js","operation":"read","path":"src/generated/catalog.js","start":1,"end":200}                                             |
      | js-read-limited          | {"version":1,"root":"tests/corpus/js","operation":"read","path":"src/generated/catalog.js","start":1,"end":3,"limits":{"max_lines":3,"max_line_chars":40}} |
      | js-read-over-limit       | {"version":1,"root":"tests/corpus/js","operation":"read","path":"src/generated/catalog.js","start":1,"end":4,"limits":{"max_lines":3}}                     |
      | js-read-file-symlink     | {"version":1,"root":"tests/corpus/js","operation":"read","path":"leak.js","start":1,"end":1}                                                                |
      | js-read-dir-symlink      | {"version":1,"root":"tests/corpus/js","operation":"read","path":"linked/secret.txt","start":1,"end":1}                                                      |
      | js-read-binary           | {"version":1,"root":"tests/corpus/js","operation":"read","path":"public/favicon.ico","start":1,"end":1}                                                     |
      | python-search            | {"version":1,"root":"tests/corpus/python","operation":"search","literal":"format_row"}                                                                      |
      | python-search-outside    | {"version":1,"root":"tests/corpus/python","operation":"search","literal":"KOGEN_OUTSIDE_SENTINEL"}                                                          |
      | python-read-oversized    | {"version":1,"root":"tests/corpus/python","operation":"read","path":"app/data/fixtures.py","start":2,"end":201}                                             |
      | python-read-over-limit   | {"version":1,"root":"tests/corpus/python","operation":"read","path":"app/data/fixtures.py","start":1,"end":201}                                             |
      | python-read-file-symlink | {"version":1,"root":"tests/corpus/python","operation":"read","path":"leak.py","start":1,"end":1}                                                            |
      | python-read-dir-symlink  | {"version":1,"root":"tests/corpus/python","operation":"read","path":"linked/secret.txt","start":1,"end":1}                                                  |
      | python-read-traversal    | {"version":1,"root":"tests/corpus/python","operation":"read","path":"app/../../outside/secret.txt","start":1,"end":1}                                       |
      | python-read-binary       | {"version":1,"root":"tests/corpus/python","operation":"read","path":"app/data/icon.png","start":1,"end":1}                                                  |
    When k-context-fixture-corpus-goldens: I run kogen-context request on every golden request from the repository root, recording "tests/corpus" around each run
    Then k-context-fixture-corpus-goldens: each run printed exactly its golden packet on stdout and nothing on stderr
    And k-context-fixture-corpus-goldens: each run exited with status 0 for a search or read packet, 2 for an error packet with code "invalid_request" or "unsupported_version" and 1 for any other error packet
    And k-context-fixture-corpus-goldens: every run left "tests/corpus" unchanged

  Scenario: Searches never read outside the selected root, skip symlinks and binary files, and report paths relative to that root
    Then k-context-fixture-corpus-goldens: these golden packets are exactly:
      | golden                | packet                                                                                                                                                |
      | go-search-outside     | {"version":1,"operation":"search","query":"KOGEN_OUTSIDE_SENTINEL","matches":[],"truncated":false,"limits":{"max_matches":100,"max_line_chars":500}} |
      | js-search-outside     | {"version":1,"operation":"search","query":"KOGEN_OUTSIDE_SENTINEL","matches":[],"truncated":false,"limits":{"max_matches":100,"max_line_chars":500}} |
      | python-search-outside | {"version":1,"operation":"search","query":"KOGEN_OUTSIDE_SENTINEL","matches":[],"truncated":false,"limits":{"max_matches":100,"max_line_chars":500}} |
    And k-context-fixture-corpus-goldens: the golden packet "go-search" is a search in "tests/corpus/go" for "FormatRow" with max matches 100, max line chars 500 and truncated "false", each match being the line of its file
    And k-context-fixture-corpus-goldens: the golden packet "go-search" has a match in each of these files:
      | file                             |
      | main.go                          |
      | internal/report/format.go        |
      | internal/report/format_test.go   |
    And k-context-fixture-corpus-goldens: the golden packet "go-search" has no match in any of these paths:
      | path            |
      | leak.go         |
      | linked          |
      | assets/logo.png |
    And k-context-fixture-corpus-goldens: the golden packet "go-search-nested-root" is a search in "tests/corpus/go/internal" for "FormatRow" with max matches 100, max line chars 500 and truncated "false", each match being the line of its file
    And k-context-fixture-corpus-goldens: the golden packet "go-search-nested-root" lists exactly the matches of "go-search" under "internal/", with that prefix removed
    And k-context-fixture-corpus-goldens: the golden packet "js-search" is a search in "tests/corpus/js" for "formatRow" with max matches 100, max line chars 500 and truncated "false", each match being the line of its file
    And k-context-fixture-corpus-goldens: the golden packet "js-search" has a match in each of these files:
      | file                     |
      | src/generated/catalog.js |
      | src/index.js             |
      | src/lib/format.ts        |
      | test/format.test.js      |
    And k-context-fixture-corpus-goldens: the golden packet "js-search" has no match in any of these paths:
      | path               |
      | leak.js            |
      | linked             |
      | public/favicon.ico |
    And k-context-fixture-corpus-goldens: the golden packet "python-search" is a search in "tests/corpus/python" for "format_row" with max matches 100, max line chars 500 and truncated "false", each match being the line of its file
    And k-context-fixture-corpus-goldens: the golden packet "python-search" has a match in each of these files:
      | file                 |
      | app/cli.py           |
      | app/report/format.py |
      | tests/test_format.py |
    And k-context-fixture-corpus-goldens: the golden packet "python-search" has no match in any of these paths:
      | path              |
      | leak.py           |
      | linked            |
      | app/data/icon.png |
    And k-context-fixture-corpus-goldens: no golden packet has a match path, match text or line text containing "KOGEN_OUTSIDE_SENTINEL"

  Scenario: Reads through escaping symlinks or paths, and reads of binary files, are refused
    Then k-context-fixture-corpus-goldens: these golden packets are exactly:
      | golden                   | packet                                                                                                                |
      | go-read-file-symlink     | {"version":1,"error":{"code":"path_outside_root","message":"path escapes the checkout root: leak.go"}}                |
      | go-read-dir-symlink      | {"version":1,"error":{"code":"path_outside_root","message":"path escapes the checkout root: linked/secret.txt"}}      |
      | go-read-traversal        | {"version":1,"error":{"code":"path_outside_root","message":"path escapes the checkout root: ../outside/secret.txt"}}  |
      | go-read-binary           | {"version":1,"error":{"code":"not_text","message":"file is not UTF-8 text: assets/logo.png"}}                         |
      | js-read-file-symlink     | {"version":1,"error":{"code":"path_outside_root","message":"path escapes the checkout root: leak.js"}}                |
      | js-read-dir-symlink      | {"version":1,"error":{"code":"path_outside_root","message":"path escapes the checkout root: linked/secret.txt"}}      |
      | js-read-binary           | {"version":1,"error":{"code":"not_text","message":"file is not UTF-8 text: public/favicon.ico"}}                      |
      | python-read-file-symlink | {"version":1,"error":{"code":"path_outside_root","message":"path escapes the checkout root: leak.py"}}                |
      | python-read-dir-symlink  | {"version":1,"error":{"code":"path_outside_root","message":"path escapes the checkout root: linked/secret.txt"}}      |
      | python-read-traversal    | {"version":1,"error":{"code":"path_outside_root","message":"path escapes the checkout root: app/../../outside/secret.txt"}} |
      | python-read-binary       | {"version":1,"error":{"code":"not_text","message":"file is not UTF-8 text: app/data/icon.png"}}                       |

  Scenario: Bounded output: match and line limits, truncation and text cuts
    Then k-context-fixture-corpus-goldens: the golden packet "go-search-truncated" is a search in "tests/corpus/go" for "Row{" with max matches 100, max line chars 500 and truncated "true", each match being the line of its file
    And k-context-fixture-corpus-goldens: the golden packet "go-search-truncated" has exactly 100 matches
    And k-context-fixture-corpus-goldens: the golden packet "js-search-limited" is a search in "tests/corpus/js" for "formatRow" with max matches 3, max line chars 20 and truncated "true", each match being the line of its file
    And k-context-fixture-corpus-goldens: the golden packet "js-search-limited" lists the first 3 matches of "js-search" with their text cut to 20 characters
    And k-context-fixture-corpus-goldens: the golden packet "go-read-oversized" holds lines 1 to 200 of "internal/report/rows_generated.go" in "tests/corpus/go" cut to 500 characters, with max lines 200
    And k-context-fixture-corpus-goldens: the golden packet "js-read-oversized" holds lines 1 to 200 of "src/generated/catalog.js" in "tests/corpus/js" cut to 500 characters, with max lines 200
    And k-context-fixture-corpus-goldens: the golden packet "js-read-limited" holds lines 1 to 3 of "src/generated/catalog.js" in "tests/corpus/js" cut to 40 characters, with max lines 3
    And k-context-fixture-corpus-goldens: the golden packet "python-read-oversized" holds lines 2 to 201 of "app/data/fixtures.py" in "tests/corpus/python" cut to 500 characters, with max lines 200
    And k-context-fixture-corpus-goldens: these golden packets are exactly:
      | golden                 | packet                                                                                                  |
      | js-read-over-limit     | {"version":1,"error":{"code":"invalid_range","message":"line range 1-4 exceeds the 3-line read limit"}} |
      | python-read-over-limit | {"version":1,"error":{"code":"invalid_range","message":"line range 1-201 exceeds the 200-line read limit"}} |

  Scenario: cargo test fails on a changed golden packet, and the test-only update path rewrites it
    Given k-context-fixture-corpus-goldens: a copy of the repository without its Git directory and build output
    When k-context-fixture-corpus-goldens: I replace "\"truncated\":false" with "\"truncated\":true" in the copy's "tests/goldens/go-search.packet.json"
    And k-context-fixture-corpus-goldens: I run "cargo test --locked --offline" in the copy
    Then k-context-fixture-corpus-goldens: the command fails and its output mentions "tests/goldens/go-search.packet.json"
    When k-context-fixture-corpus-goldens: I run "cargo test --locked --offline" in the copy with "KOGEN_CONTEXT_UPDATE_GOLDENS" set to "1"
    Then k-context-fixture-corpus-goldens: the command succeeds
    And k-context-fixture-corpus-goldens: the copy's "tests/goldens/go-search.packet.json" is byte-identical to the repository's
    When k-context-fixture-corpus-goldens: I run "cargo test --locked --offline" in the copy
    Then k-context-fixture-corpus-goldens: the command succeeds

  Scenario: cargo test fails on a missing golden packet, and the update path writes it
    Given k-context-fixture-corpus-goldens: a copy of the repository without its Git directory and build output
    When k-context-fixture-corpus-goldens: I delete the copy's "tests/goldens/python-read-oversized.packet.json"
    And k-context-fixture-corpus-goldens: I run "cargo test --locked --offline" in the copy
    Then k-context-fixture-corpus-goldens: the command fails and its output mentions "tests/goldens/python-read-oversized.packet.json"
    When k-context-fixture-corpus-goldens: I run "cargo test --locked --offline" in the copy with "KOGEN_CONTEXT_UPDATE_GOLDENS" set to "1"
    Then k-context-fixture-corpus-goldens: the command succeeds
    And k-context-fixture-corpus-goldens: the copy's "tests/goldens/python-read-oversized.packet.json" is byte-identical to the repository's

  Scenario: The README names the corpus, the goldens and the update command
    Then k-context-fixture-corpus-goldens: the file "README.md" mentions "tests/corpus/"
    And k-context-fixture-corpus-goldens: the file "README.md" mentions "tests/goldens/"
    And k-context-fixture-corpus-goldens: the file "README.md" mentions "KOGEN_CONTEXT_UPDATE_GOLDENS=1 cargo test --locked --offline --test corpus"
