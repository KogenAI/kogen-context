Feature: A per-commit shared search index with the working tree's edits overlaid
  A search of kogen-context on a Git checkout keeps an index of the checkout's
  commit in the per-user cache directory, shared by every run of the user on
  the host, and overlays the working tree's uncommitted edits: edited, added
  and deleted files are visible in the next search without a rebuild. The
  index only changes speed: every output is byte for byte the output of the
  same search without it, and the checkout is never written. Repeat searches
  on one commit take at most ripgrep's time on the same tree.

  Scenario: The first search of a commit writes the shared index to the cache, and later searches reuse it without writing
    Given k-context-commit-index-overlay: a Git checkout "app" committed with these files:
      | path        | content                                       |
      | .gitignore  | build/\n                                      |
      | README.md   | Call render to draw.\n                        |
      | src/draw.go | package view\n\nfunc draw() { redraw() }\n    |
      | src/keep.go | package view\n\nvar keep = redraw // keep\n   |
      | src/list.go | package view\n\nfunc list() { render() }\n    |
      | src/old.go  | package view\n\nvar old = render\n            |
      | src/view.go | package view\n\nfunc render() int { return 1 }\n |
    And k-context-commit-index-overlay: the files of every checkout are more than 2 seconds old
    When k-context-commit-index-overlay: I search "app" for "render" in "path" order
    Then k-context-commit-index-overlay: the packet of search 1 is a search for "render" listing exactly these matches:
      | path        | line | column | text                           |
      | README.md   | 1    | 6      | Call render to draw.           |
      | src/list.go | 3    | 15     | func list() { render() }       |
      | src/old.go  | 3    | 11     | var old = render               |
      | src/view.go | 3    | 6      | func render() int { return 1 } |
    And k-context-commit-index-overlay: the files under the scenario directory outside the checkouts are exactly:
      | file                                                            |
      | cache/kogen-context/index-v1/commits/<commit of app>            |
      | cache/kogen-context/index-v1/trees/<commit of app>-<key of app> |
    And k-context-commit-index-overlay: kogen-context made the directory "cache/kogen-context" and everything in it private to the user
    When k-context-commit-index-overlay: I note the state of the directory "cache"
    And k-context-commit-index-overlay: I search "app" for "render" in "ranked" order
    And k-context-commit-index-overlay: I run kogen-context search "app" "render"
    And k-context-commit-index-overlay: I search "app" for "render" in "path" order
    Then k-context-commit-index-overlay: every search exited with status 0 and printed nothing on stderr
    And k-context-commit-index-overlay: every search printed byte for byte what the same search prints on a plain copy of its checkout without Git
    And k-context-commit-index-overlay: the packet of search 2 is a search for "render" listing exactly these matches:
      | path        | line | column | text                           |
      | src/view.go | 3    | 6      | func render() int { return 1 } |
      | src/list.go | 3    | 15     | func list() { render() }       |
      | src/old.go  | 3    | 11     | var old = render               |
      | README.md   | 1    | 6      | Call render to draw.           |
    And k-context-commit-index-overlay: the packets of search 1 and search 4 are byte for byte the same
    And k-context-commit-index-overlay: the directory "cache" is unchanged since it was noted
    And k-context-commit-index-overlay: no search changed anything in the checkouts

  Scenario: Edited, added, ignored and deleted files are visible in the next search without rebuilding the index
    Given k-context-commit-index-overlay: a Git checkout "app" committed with these files:
      | path        | content                                       |
      | .gitignore  | build/\n                                      |
      | README.md   | Call render to draw.\n                        |
      | src/draw.go | package view\n\nfunc draw() { redraw() }\n    |
      | src/keep.go | package view\n\nvar keep = redraw // keep\n   |
      | src/list.go | package view\n\nfunc list() { render() }\n    |
      | src/old.go  | package view\n\nvar old = render\n            |
      | src/view.go | package view\n\nfunc render() int { return 1 }\n |
    And k-context-commit-index-overlay: the files of every checkout are more than 2 seconds old
    When k-context-commit-index-overlay: I search "app" for "render" in "path" order
    And k-context-commit-index-overlay: I note the state of the directory "cache"
    And k-context-commit-index-overlay: I write "src/draw.go" in "app" with the content "package view\n\nfunc draw() { render() }\n"
    And k-context-commit-index-overlay: I write "src/keep.go" in "app" with the content "package view\n\nvar keep = render // keep\n" keeping its size and modification time
    And k-context-commit-index-overlay: I write "src/list.go" in "app" with the content "package view\n\nfunc list() { render() }\n\nfunc again() { render() }\n"
    And k-context-commit-index-overlay: I write "src/view.go" in "app" with the content "package view\n\nfunc redraw() int { return 1 }\n"
    And k-context-commit-index-overlay: I delete "src/old.go" from "app"
    And k-context-commit-index-overlay: I write "src/new.go" in "app" with the content "package view\n\nvar fresh = render()\n"
    And k-context-commit-index-overlay: I write "build/out.txt" in "app" with the content "render output\n"
    And k-context-commit-index-overlay: I search "app" for "render" in "path" order
    And k-context-commit-index-overlay: I search "app" for "render" in "ranked" order
    And k-context-commit-index-overlay: I run kogen-context search "app" "render"
    And k-context-commit-index-overlay: I search "app/src" for "render" in "path" order
    Then k-context-commit-index-overlay: every search exited with status 0 and printed nothing on stderr
    And k-context-commit-index-overlay: every search printed byte for byte what the same search prints on a plain copy of its checkout without Git
    And k-context-commit-index-overlay: the packet of search 2 is a search for "render" listing exactly these matches:
      | path          | line | column | text                      |
      | README.md     | 1    | 6      | Call render to draw.      |
      | build/out.txt | 1    | 1      | render output             |
      | src/draw.go   | 3    | 15     | func draw() { render() }  |
      | src/keep.go   | 3    | 12     | var keep = render // keep |
      | src/list.go   | 3    | 15     | func list() { render() }  |
      | src/list.go   | 5    | 16     | func again() { render() } |
      | src/new.go    | 3    | 13     | var fresh = render()      |
    And k-context-commit-index-overlay: the packet of search 3 is a search for "render" listing exactly these matches:
      | path          | line | column | text                      |
      | src/draw.go   | 3    | 15     | func draw() { render() }  |
      | src/list.go   | 3    | 15     | func list() { render() }  |
      | src/list.go   | 5    | 16     | func again() { render() } |
      | src/new.go    | 3    | 13     | var fresh = render()      |
      | src/keep.go   | 3    | 12     | var keep = render // keep |
      | README.md     | 1    | 6      | Call render to draw.      |
      | build/out.txt | 1    | 1      | render output             |
    And k-context-commit-index-overlay: the packet of search 5 is a search for "render" listing exactly these matches:
      | path    | line | column | text                      |
      | draw.go | 3    | 15     | func draw() { render() }  |
      | keep.go | 3    | 12     | var keep = render // keep |
      | list.go | 3    | 15     | func list() { render() }  |
      | list.go | 5    | 16     | func again() { render() } |
      | new.go  | 3    | 13     | var fresh = render()      |
    And k-context-commit-index-overlay: the files under the scenario directory outside the checkouts are exactly:
      | file                                                                |
      | cache/kogen-context/index-v1/commits/<commit of app>                |
      | cache/kogen-context/index-v1/trees/<commit of app>-<key of app>     |
      | cache/kogen-context/index-v1/trees/<commit of app>-<key of app/src> |
    And k-context-commit-index-overlay: no search changed anything in the checkouts

  Scenario: Searches after the edits leave the cache untouched, and a new commit gets its own index
    Given k-context-commit-index-overlay: a Git checkout "app" committed with these files:
      | path        | content                                       |
      | README.md   | Call render to draw.\n                        |
      | src/list.go | package view\n\nfunc list() { render() }\n    |
      | src/old.go  | package view\n\nvar old = render\n            |
    And k-context-commit-index-overlay: the files of every checkout are more than 2 seconds old
    When k-context-commit-index-overlay: I search "app" for "render" in "path" order
    And k-context-commit-index-overlay: I note the state of the directory "cache"
    And k-context-commit-index-overlay: I write "src/new.go" in "app" with the content "package view\n\nvar fresh = render()\n"
    And k-context-commit-index-overlay: I delete "src/old.go" from "app"
    And k-context-commit-index-overlay: I search "app" for "render" in "path" order
    And k-context-commit-index-overlay: I search "app" for "render" in "ranked" order
    Then k-context-commit-index-overlay: the directory "cache" is unchanged since it was noted
    When k-context-commit-index-overlay: I commit every change of the checkout "app"
    And k-context-commit-index-overlay: I search "app" for "render" in "path" order
    Then k-context-commit-index-overlay: every search exited with status 0 and printed nothing on stderr
    And k-context-commit-index-overlay: every search printed byte for byte what the same search prints on a plain copy of its checkout without Git
    And k-context-commit-index-overlay: the packets of search 2 and search 4 are byte for byte the same
    And k-context-commit-index-overlay: the packet of search 4 is a search for "render" listing exactly these matches:
      | path        | line | column | text                     |
      | README.md   | 1    | 6      | Call render to draw.     |
      | src/list.go | 3    | 15     | func list() { render() } |
      | src/new.go  | 3    | 13     | var fresh = render()     |
    And k-context-commit-index-overlay: the files under the scenario directory outside the checkouts are exactly:
      | file                                                                     |
      | cache/kogen-context/index-v1/commits/<previous commit of app>            |
      | cache/kogen-context/index-v1/commits/<commit of app>                     |
      | cache/kogen-context/index-v1/trees/<previous commit of app>-<key of app> |
      | cache/kogen-context/index-v1/trees/<commit of app>-<key of app>          |
    And k-context-commit-index-overlay: no search changed anything in the checkouts

  Scenario: Two checkouts of one commit share its index and each sees only its own edits
    Given k-context-commit-index-overlay: a Git checkout "app" committed with these files:
      | path        | content                                       |
      | README.md   | Call render to draw.\n                        |
      | src/list.go | package view\n\nfunc list() { render() }\n    |
      | src/view.go | package view\n\nfunc render() int { return 1 }\n |
    And k-context-commit-index-overlay: the checkout "app" has a worktree "wt" at its commit
    And k-context-commit-index-overlay: the files of every checkout are more than 2 seconds old
    When k-context-commit-index-overlay: I search "app" for "render" in "path" order
    And k-context-commit-index-overlay: I search "wt" for "render" in "path" order
    And k-context-commit-index-overlay: I write "src/new.go" in "wt" with the content "package view\n\nvar fresh = render()\n"
    And k-context-commit-index-overlay: I search "wt" for "render" in "path" order
    And k-context-commit-index-overlay: I search "app" for "render" in "path" order
    Then k-context-commit-index-overlay: every search exited with status 0 and printed nothing on stderr
    And k-context-commit-index-overlay: every search printed byte for byte what the same search prints on a plain copy of its checkout without Git
    And k-context-commit-index-overlay: the packet of search 3 is a search for "render" listing exactly these matches:
      | path        | line | column | text                           |
      | README.md   | 1    | 6      | Call render to draw.           |
      | src/list.go | 3    | 15     | func list() { render() }       |
      | src/new.go  | 3    | 13     | var fresh = render()           |
      | src/view.go | 3    | 6      | func render() int { return 1 } |
    And k-context-commit-index-overlay: the packets of search 1 and search 4 are byte for byte the same
    And k-context-commit-index-overlay: the packets of search 1 and search 2 are byte for byte the same
    And k-context-commit-index-overlay: the files under the scenario directory outside the checkouts are exactly:
      | file                                                            |
      | cache/kogen-context/index-v1/commits/<commit of app>            |
      | cache/kogen-context/index-v1/trees/<commit of app>-<key of app> |
      | cache/kogen-context/index-v1/trees/<commit of app>-<key of wt>  |
    And k-context-commit-index-overlay: no search changed anything in the checkouts

  Scenario: Concurrent searches on an empty cache all print the right packets and leave one complete index
    Given k-context-commit-index-overlay: a Git checkout "app" committed with these files:
      | path        | content                                       |
      | README.md   | Call render to draw.\n                        |
      | src/list.go | package view\n\nfunc list() { render() }\n    |
      | src/view.go | package view\n\nfunc render() int { return 1 }\n |
    And k-context-commit-index-overlay: the checkout "app" has a worktree "wt" at its commit
    And k-context-commit-index-overlay: the files of every checkout are more than 2 seconds old
    When k-context-commit-index-overlay: I start these searches at once and wait for all of them:
      | root | literal | order  |
      | app  | render  | path   |
      | wt   | render  | path   |
      | app  | render  | ranked |
      | wt   | render  | ranked |
      | app  | render  | path   |
      | wt   | render  | path   |
      | app  | render  | ranked |
      | wt   | render  | ranked |
    Then k-context-commit-index-overlay: the files under the scenario directory outside the checkouts are exactly:
      | file                                                            |
      | cache/kogen-context/index-v1/commits/<commit of app>            |
      | cache/kogen-context/index-v1/trees/<commit of app>-<key of app> |
      | cache/kogen-context/index-v1/trees/<commit of app>-<key of wt>  |
    When k-context-commit-index-overlay: I note the state of the directory "cache"
    And k-context-commit-index-overlay: I search "app" for "render" in "path" order
    And k-context-commit-index-overlay: I search "wt" for "render" in "ranked" order
    Then k-context-commit-index-overlay: every search exited with status 0 and printed nothing on stderr
    And k-context-commit-index-overlay: every search printed byte for byte what the same search prints on a plain copy of its checkout without Git
    And k-context-commit-index-overlay: the packet of search 9 is a search for "render" listing exactly these matches:
      | path        | line | column | text                           |
      | README.md   | 1    | 6      | Call render to draw.           |
      | src/list.go | 3    | 15     | func list() { render() }       |
      | src/view.go | 3    | 6      | func render() int { return 1 } |
    And k-context-commit-index-overlay: the directory "cache" is unchanged since it was noted
    And k-context-commit-index-overlay: no search changed anything in the checkouts

  Scenario: A snapshot made while files were less than 2 seconds old is made again once, by a search more than 2 seconds later
    Given k-context-commit-index-overlay: a Git checkout "app" committed with these files:
      | path        | content                                       |
      | README.md   | Call render to draw.\n                        |
      | src/draw.go | package view\n\nfunc draw() { redraw() }\n    |
      | src/view.go | package view\n\nfunc render() int { return 1 }\n |
    When k-context-commit-index-overlay: I search "app" for "render" in "path" order
    And k-context-commit-index-overlay: I write "src/draw.go" in "app" with the content "package view\n\nfunc draw() { render() }\n"
    And k-context-commit-index-overlay: I note the state of the directory "cache"
    And k-context-commit-index-overlay: the files of every checkout are more than 2 seconds old
    And k-context-commit-index-overlay: I search "app" for "render" in "path" order
    Then k-context-commit-index-overlay: the file "cache/kogen-context/index-v1/trees/<commit of app>-<key of app>" was replaced since the directory "cache" was noted, and nothing else in that directory changed but the directory holding the file
    When k-context-commit-index-overlay: I note the state of the directory "cache"
    And k-context-commit-index-overlay: I search "app" for "render" in "ranked" order
    Then k-context-commit-index-overlay: the directory "cache" is unchanged since it was noted
    And k-context-commit-index-overlay: every search exited with status 0 and printed nothing on stderr
    And k-context-commit-index-overlay: every search printed byte for byte what the same search prints on a plain copy of its checkout without Git
    And k-context-commit-index-overlay: the packet of search 2 is a search for "render" listing exactly these matches:
      | path        | line | column | text                           |
      | README.md   | 1    | 6      | Call render to draw.           |
      | src/draw.go | 3    | 15     | func draw() { render() }       |
      | src/view.go | 3    | 6      | func render() int { return 1 } |
    And k-context-commit-index-overlay: no search changed anything in the checkouts

  Scenario Outline: The cache directory is $XDG_CACHE_HOME/kogen-context, or else the user's cache directory under $HOME
    Given k-context-commit-index-overlay: a Git checkout "app" committed with these files:
      | path        | content                                    |
      | README.md   | Call render to draw.\n                     |
      | src/list.go | package view\n\nfunc list() { render() }\n |
    And k-context-commit-index-overlay: the files of every checkout are more than 2 seconds old
    And k-context-commit-index-overlay: XDG_CACHE_HOME is "<xdg>" and HOME is "<home>"
    When k-context-commit-index-overlay: I search "app" for "render" in "path" order
    Then k-context-commit-index-overlay: every search exited with status 0 and printed nothing on stderr
    And k-context-commit-index-overlay: every search printed byte for byte what the same search prints on a plain copy of its checkout without Git
    And k-context-commit-index-overlay: the files under the scenario directory outside the checkouts are exactly:
      | file                                                                    |
      | <cache>/kogen-context/index-v1/commits/<commit of app>                  |
      | <cache>/kogen-context/index-v1/trees/<commit of app>-<key of app>       |
    And k-context-commit-index-overlay: kogen-context made the directory "<cache>/kogen-context" and everything in it private to the user
    And k-context-commit-index-overlay: no search changed anything in the checkouts

    Examples:
      | xdg                   | home            | cache             |
      | <scenario>/xdg-cache  | <scenario>/home | xdg-cache         |
      | <unset>               | <scenario>/home | home/<home cache> |
      |                       | <scenario>/home | home/<home cache> |
      | relative/cache        | <scenario>/home | home/<home cache> |

  Scenario Outline: Without a Git checkout, or without a cache directory outside the root, a search scans the files and writes nothing
    Given k-context-commit-index-overlay: a Git checkout "app" committed with these files:
      | path        | content                                    |
      | README.md   | Call render to draw.\n                     |
      | src/list.go | package view\n\nfunc list() { render() }\n |
    And k-context-commit-index-overlay: a plain directory "notes" with these files:
      | path     | content                      |
      | notes.md | Call render to draw.\n       |
      | a/b.go   | package a\n\nvar x = render\n |
    And k-context-commit-index-overlay: the files of every checkout are more than 2 seconds old
    And k-context-commit-index-overlay: XDG_CACHE_HOME is "<xdg>" and HOME is "<home>"
    When k-context-commit-index-overlay: I search "<root>" for "render" in "path" order
    And k-context-commit-index-overlay: I run kogen-context search "<root>" "render"
    Then k-context-commit-index-overlay: every search exited with status 0 and printed nothing on stderr
    And k-context-commit-index-overlay: every search printed byte for byte what the same search prints on a plain copy of its checkout without Git
    And k-context-commit-index-overlay: no file is under the scenario directory outside the checkouts
    And k-context-commit-index-overlay: no search changed anything in the checkouts

    Examples:
      | root  | xdg                         | home            |
      | notes | <scenario>/cache            | <scenario>/home |
      | app   | <scenario>/app/cache-inside | <scenario>/home |
      | app   | <unset>                     | <scenario>/app  |
      | app   | <unset>                     |                 |
      | app   | <unset>                     | relative-home   |
      | app   | <unset>                     | <unset>         |

  Scenario: Repeat searches on the commit of a generated 4000-file checkout take at most ripgrep's time, also after an edit
    Given k-context-commit-index-overlay: a generated Git checkout "big" with 4000 files of 200 lines and the literal "needleIndexBench" on line 100 of every 500th file
    And k-context-commit-index-overlay: the files of every checkout are more than 2 seconds old
    When k-context-commit-index-overlay: I time kogen-context against ripgrep on these searches:
      | root | literal          | edit               |
      | big  | needleIndexBench | pkg12/file1234.zig |
    Then k-context-commit-index-overlay: every warm and after-edit median of kogen-context is at or below the ripgrep median

  Scenario: Repeat searches on the commit of the repository fixtures take at most ripgrep's time, also after an edit
    Given k-context-commit-index-overlay: a Git checkout "fixtures" with copies of these repository directories:
      | directory                  | as       |
      | tests/corpus/go            | go       |
      | tests/corpus/js            | js       |
      | tests/corpus/python        | python   |
      | tests/ranking/repl         | repl     |
      | tests/ranking/wpt          | wpt      |
      | contract/examples/checkout | checkout |
    And k-context-commit-index-overlay: the files of every checkout are more than 2 seconds old
    When k-context-commit-index-overlay: I time kogen-context against ripgrep on these searches:
      | root              | literal       | edit          |
      | fixtures/go       | FormatRow     | main.go       |
      | fixtures/js       | formatRow     | src/index.js  |
      | fixtures/python   | format_row    | app/cli.py    |
      | fixtures/repl     | spinUntil     | src/loop.zig  |
      | fixtures/wpt      | journal.shard | docs/sweep.md |
      | fixtures/checkout | parse_config  | app.py        |
    Then k-context-commit-index-overlay: every warm and after-edit median of kogen-context is at or below the ripgrep median

  Scenario: The repository's ignored benchmark test compares cold, warm and after-edit times of kogen-context with ripgrep on its fixture
    When k-context-commit-index-overlay: I run the ignored tests of the repository in a release build with a benchmark report file
    Then k-context-commit-index-overlay: the benchmark test run exited with status 0
    And k-context-commit-index-overlay: the benchmark report lists exactly these measurements against ripgrep:
      | phase      | order  |
      | cold       | path   |
      | warm       | path   |
      | warm       | ranked |
      | after-edit | path   |
      | after-edit | ranked |
    And k-context-commit-index-overlay: in every warm and after-edit measurement of the report kogen-context took at most as long as ripgrep

  Scenario: The Crane benchmark script times cold, warm and after-edit searches on both pinned Crane revisions against ripgrep
    When k-context-commit-index-overlay: I run the Crane benchmark script with the release kogen-context binary
    Then k-context-commit-index-overlay: the script exited with status 0
    And k-context-commit-index-overlay: the script printed exactly these records, with times in milliseconds:
      | label       | phase      | order  | hint                |
      | adc2ea58b65 | cold       | path   | spinEventLoopUntil  |
      | adc2ea58b65 | warm       | path   | spinEventLoopUntil  |
      | adc2ea58b65 | warm       | ranked | spinEventLoopUntil  |
      | adc2ea58b65 | warm       | path   | evaluateReplScript  |
      | adc2ea58b65 | warm       | ranked | evaluateReplScript  |
      | adc2ea58b65 | warm       | path   | journal.shard       |
      | adc2ea58b65 | warm       | ranked | journal.shard       |
      | adc2ea58b65 | warm       | path   | wptreport.jsonl     |
      | adc2ea58b65 | warm       | ranked | wptreport.jsonl     |
      | adc2ea58b65 | warm       | path   | cleanup             |
      | adc2ea58b65 | warm       | ranked | cleanup             |
      | adc2ea58b65 | warm       | path   | gen_snapshot        |
      | adc2ea58b65 | warm       | ranked | gen_snapshot        |
      | adc2ea58b65 | warm       | path   | constructorCallback |
      | adc2ea58b65 | warm       | ranked | constructorCallback |
      | adc2ea58b65 | after-edit | path   | spinEventLoopUntil  |
      | adc2ea58b65 | after-edit | ranked | spinEventLoopUntil  |
      | adc2ea58b65 | after-edit | path   | evaluateReplScript  |
      | adc2ea58b65 | after-edit | ranked | evaluateReplScript  |
      | adc2ea58b65 | after-edit | path   | journal.shard       |
      | adc2ea58b65 | after-edit | ranked | journal.shard       |
      | adc2ea58b65 | after-edit | path   | wptreport.jsonl     |
      | adc2ea58b65 | after-edit | ranked | wptreport.jsonl     |
      | adc2ea58b65 | after-edit | path   | cleanup             |
      | adc2ea58b65 | after-edit | ranked | cleanup             |
      | adc2ea58b65 | after-edit | path   | gen_snapshot        |
      | adc2ea58b65 | after-edit | ranked | gen_snapshot        |
      | adc2ea58b65 | after-edit | path   | constructorCallback |
      | adc2ea58b65 | after-edit | ranked | constructorCallback |
      | b41782ab61d | cold       | path   | spinEventLoopUntil  |
      | b41782ab61d | warm       | path   | spinEventLoopUntil  |
      | b41782ab61d | warm       | ranked | spinEventLoopUntil  |
      | b41782ab61d | warm       | path   | evaluateReplScript  |
      | b41782ab61d | warm       | ranked | evaluateReplScript  |
      | b41782ab61d | warm       | path   | journal.shard       |
      | b41782ab61d | warm       | ranked | journal.shard       |
      | b41782ab61d | warm       | path   | wptreport.jsonl     |
      | b41782ab61d | warm       | ranked | wptreport.jsonl     |
      | b41782ab61d | warm       | path   | cleanup             |
      | b41782ab61d | warm       | ranked | cleanup             |
      | b41782ab61d | warm       | path   | gen_snapshot        |
      | b41782ab61d | warm       | ranked | gen_snapshot        |
      | b41782ab61d | warm       | path   | constructorCallback |
      | b41782ab61d | warm       | ranked | constructorCallback |
      | b41782ab61d | after-edit | path   | spinEventLoopUntil  |
      | b41782ab61d | after-edit | ranked | spinEventLoopUntil  |
      | b41782ab61d | after-edit | path   | evaluateReplScript  |
      | b41782ab61d | after-edit | ranked | evaluateReplScript  |
      | b41782ab61d | after-edit | path   | journal.shard       |
      | b41782ab61d | after-edit | ranked | journal.shard       |
      | b41782ab61d | after-edit | path   | wptreport.jsonl     |
      | b41782ab61d | after-edit | ranked | wptreport.jsonl     |
      | b41782ab61d | after-edit | path   | cleanup             |
      | b41782ab61d | after-edit | ranked | cleanup             |
      | b41782ab61d | after-edit | path   | gen_snapshot        |
      | b41782ab61d | after-edit | ranked | gen_snapshot        |
      | b41782ab61d | after-edit | path   | constructorCallback |
      | b41782ab61d | after-edit | ranked | constructorCallback |
    And k-context-commit-index-overlay: in every warm and after-edit record kogen-context took at most as long as ripgrep
    And k-context-commit-index-overlay: no file is in the temporary, home or cache directory of the script run

  Scenario: The Crane benchmark script refuses to run without exactly one argument
    When k-context-commit-index-overlay: I run the Crane benchmark script without an argument
    Then k-context-commit-index-overlay: the script exited with status 2
    And k-context-commit-index-overlay: the script printed nothing on stdout and exactly "usage: scripts/crane-bench.sh BINARY" and a newline on stderr

  Scenario: The contract and the README state where the index lives and that packets do not change
    Then k-context-commit-index-overlay: the file "contract/README.md" contains each of these texts:
      | text                               |
      | $XDG_CACHE_HOME/kogen-context      |
      | ~/.cache/kogen-context             |
      | ~/Library/Caches/kogen-context     |
      | index-v1/commits/<commit>          |
      | index-v1/trees/<commit>-<root key> |
      | byte-identical                     |
      | expand                             |
    And k-context-commit-index-overlay: the file "contract/README.md" does not contain "nothing stored between runs"
    And k-context-commit-index-overlay: the file "README.md" contains each of these texts:
      | text                                                                                |
      | $XDG_CACHE_HOME/kogen-context                                                       |
      | scripts/crane-bench.sh                                                              |
      | sh scripts/crane-bench.sh target/release/kogen-context                              |
      | tests/index_bench.rs                                                                |
      | cargo test --release --locked --offline --test index_bench -- --ignored --nocapture |
    And k-context-commit-index-overlay: the file "contract/request.schema.json" has the SHA-256 digest "4e8ff5d21468d3d645dab7ecbfb56b0aa6ef17841a830f17aedbf7e14341cfb5"
    And k-context-commit-index-overlay: the file "contract/packet.schema.json" has the SHA-256 digest "686e72b33aa4f050669d28cabad993adefe3899a0205e84a29431efccb1b15d4"
