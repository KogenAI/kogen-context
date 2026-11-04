Feature: Release builds of kogen-context for the build hosts

  Each build host builds its own platform's binary from a local tag, twice in
  two directories, checks that both builds are byte-identical, runs the fixture
  corpus tests against the built binary and keeps the binary and its SHA-256
  checksum under target/kogen-context-release/TAG/. Nothing is published.

  Background:
    Given k-context-release-binaries: the build host platforms
      | host triple               | platform     |
      | aarch64-apple-darwin      | darwin-arm64 |
      | x86_64-unknown-linux-gnu  | linux-x86_64 |
      | aarch64-unknown-linux-gnu | linux-arm64  |

  Scenario: A development build reports its package version
    When k-context-release-binaries: I run the development build with arguments ["version"]
    Then k-context-release-binaries: it exits with status 0, stdout "kogen-context 0.1.0 (development build)\n" and stderr ""

  Scenario: The version command takes no further argument
    When k-context-release-binaries: I run the development build with arguments ["version","extra"]
    Then k-context-release-binaries: it exits with status 2, stdout "" and stderr "{\"error\":{\"code\":\"usage\",\"message\":\"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END\"}}\n"

  Scenario: A release builds the tagged commit, not HEAD or the working tree
    Given k-context-release-binaries: a committed copy "first" of the working tree at "one/checkout"
    And k-context-release-binaries: copy "first" has the annotated tag "local-test-1" on HEAD
    And k-context-release-binaries: copy "first" commits "a README edit"
    And k-context-release-binaries: copy "first" has the uncommitted change "a wrong golden packet"
    When k-context-release-binaries: I run "scripts/release.sh" with arguments ["local-test-1"] in copy "first"
    Then k-context-release-binaries: it exits with status 0
    And k-context-release-binaries: copy "first" holds the release artifacts of "local-test-1" for the host platform, and stdout is their SHA256SUMS
    And k-context-release-binaries: the artifact of "local-test-1" in copy "first" prints "kogen-context 0.1.0 (tag local-test-1, commit {tag:local-test-1})\n" for arguments ["version"]
    And k-context-release-binaries: the artifact of "local-test-1" in copy "first" prints the golden packet "go-search" for its request
    And k-context-release-binaries: the command left the Git status, HEAD and tags of copy "first" unchanged

  Scenario: The same tag gives byte-identical artifacts in another directory, replacing that tag's earlier artifacts
    Given k-context-release-binaries: a committed copy "first" of the working tree at "one/checkout"
    And k-context-release-binaries: copy "first" has the annotated tag "local-test-1" on HEAD
    And k-context-release-binaries: a committed copy "second" of the working tree at "two/a/much/deeper/directory/checkout"
    And k-context-release-binaries: copy "second" has the annotated tag "local-test-1" on HEAD
    And k-context-release-binaries: copy "second" has the file "target/kogen-context-release/local-test-1/stale.txt"
    When k-context-release-binaries: I run "scripts/release.sh" with arguments ["local-test-1"] in copy "first"
    Then k-context-release-binaries: it exits with status 0
    When k-context-release-binaries: I run "scripts/release.sh" with arguments ["local-test-1"] in copy "second"
    Then k-context-release-binaries: it exits with status 0
    And k-context-release-binaries: copy "second" holds the release artifacts of "local-test-1" for the host platform, and stdout is their SHA256SUMS
    And k-context-release-binaries: copies "first" and "second" have the same commit for "local-test-1" and byte-identical artifacts

  Scenario Outline: The release script refuses <case> without building
    Given k-context-release-binaries: a committed copy "first" of the working tree at "one/checkout"
    And k-context-release-binaries: copy "first" has the annotated tag "local-test-1" on HEAD
    And k-context-release-binaries: copy "first" has the annotated tag "bad/name" on HEAD
    When k-context-release-binaries: I run "scripts/release.sh" with arguments <arguments> in copy "first"
    Then k-context-release-binaries: it exits with status <status>, empty stdout and the single stderr line <stderr>
    And k-context-release-binaries: copy "first" has no "target/kogen-context-release"
    And k-context-release-binaries: the command left the Git status, HEAD and tags of copy "first" unchanged

    Examples:
      | case                         | arguments                | status | stderr                                                         |
      | no argument                  | []                       | 2      | "usage: scripts/release.sh TAG"                                |
      | two arguments                | ["local-test-1","extra"] | 2      | "usage: scripts/release.sh TAG"                                |
      | a missing tag                | ["missing-tag"]          | 1      | "release.sh: no such tag: missing-tag"                         |
      | a tag unusable in file names | ["bad/name"]             | 1      | "release.sh: tag name must match [A-Za-z0-9._-]+: bad/name"    |

  Scenario: The release check builds HEAD, not the working tree, and writes no artifacts
    Given k-context-release-binaries: a committed copy "first" of the working tree at "one/checkout"
    And k-context-release-binaries: copy "first" has the uncommitted change "a wrong golden packet"
    When k-context-release-binaries: I run "scripts/release-check.sh" with arguments [] in copy "first"
    Then k-context-release-binaries: it exits with status 0
    And k-context-release-binaries: stdout matches "^release check passed: {platform} [0-9a-f]{64}\n$"
    And k-context-release-binaries: copy "first" has no "target/kogen-context-release"
    And k-context-release-binaries: the command left the Git status, HEAD and tags of copy "first" unchanged

  Scenario: The release check takes no argument
    Given k-context-release-binaries: a committed copy "first" of the working tree at "one/checkout"
    When k-context-release-binaries: I run "scripts/release-check.sh" with arguments ["extra"] in copy "first"
    Then k-context-release-binaries: it exits with status 2, stdout "" and stderr "usage: scripts/release-check.sh\n"

  Scenario Outline: <script> fails on a commit whose fixture tests fail, writing no artifacts
    Given k-context-release-binaries: a committed copy "first" of the working tree at "one/checkout"
    And k-context-release-binaries: copy "first" commits "a wrong golden packet"
    And k-context-release-binaries: copy "first" has the annotated tag "local-test-1" on HEAD
    When k-context-release-binaries: I run "scripts/<script>" with arguments <arguments> in copy "first"
    Then k-context-release-binaries: it exits with status 1
    And k-context-release-binaries: stderr has the line "<script>: fixture tests failed for {head}"
    And k-context-release-binaries: its output contains "tests/goldens/go-search.packet.json: stdout of tests/goldens/go-search.request.json differs from the golden packet"
    And k-context-release-binaries: copy "first" has no "target/kogen-context-release"

    Examples:
      | script           | arguments        |
      | release.sh       | ["local-test-1"] |
      | release-check.sh | []               |

  Scenario Outline: <script> fails on a commit whose build depends on its directory, writing no artifacts
    Given k-context-release-binaries: a committed copy "first" of the working tree at "one/checkout"
    And k-context-release-binaries: copy "first" commits "a build that depends on its directory"
    And k-context-release-binaries: copy "first" has the annotated tag "local-test-1" on HEAD
    When k-context-release-binaries: I run "scripts/<script>" with arguments <arguments> in copy "first"
    Then k-context-release-binaries: it exits with status 1
    And k-context-release-binaries: stderr has the line "<script>: builds of {head} in two directories differ"
    And k-context-release-binaries: copy "first" has no "target/kogen-context-release"

    Examples:
      | script           | arguments        |
      | release.sh       | ["local-test-1"] |
      | release-check.sh | []               |

  Scenario: The corpus test runs the binary that KOGEN_CONTEXT_BIN names
    Given k-context-release-binaries: a committed copy "first" of the working tree at "one/checkout"
    When k-context-release-binaries: I run the corpus test in copy "first" with KOGEN_CONTEXT_BIN naming a stub that prints "{}"
    Then k-context-release-binaries: it exits with a status other than 0
    And k-context-release-binaries: its output contains "tests/goldens/go-search.packet.json: stdout of tests/goldens/go-search.request.json differs from the golden packet"

  Scenario Outline: The README documents the release builds: <text>
    Then k-context-release-binaries: README.md contains <text>

    Examples:
      | text                                                     |
      | "## Release builds"                                      |
      | "scripts/release.sh TAG"                                 |
      | "scripts/release-check.sh"                               |
      | "target/kogen-context-release/TAG/"                      |
      | "kogen-context version"                                  |
      | "KOGEN_CONTEXT_BIN"                                      |
      | "darwin-arm64"                                           |
      | "linux-x86_64"                                           |
      | "Nothing is published and release tags are not pushed."  |
