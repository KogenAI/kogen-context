Feature: Ranking ignores comment markers inside quoted strings

  This feature covers the ranked order of a search of a Go file. A comment marker
  inside a double-quoted string does not make the line a comment; a real comment
  still ranks as a comment.

  Scenario: A comment marker inside a quoted Go string does not make the match a comment
    Given rank-ignores-comment-markers-in-strings: a Go file "a.go" containing the lines:
      """
      // spin
      log.Println("// spin")
      """
    When rank-ignores-comment-markers-in-strings: I run a ranked search for "spin"
    Then rank-ignores-comment-markers-in-strings: the matches are on lines "2, 1" in that order

  Scenario: A real trailing comment stays below source matches
    Given rank-ignores-comment-markers-in-strings: a Go file "a.go" containing the lines:
      """
      // spin
      x := 1 // spin
      y := spin
      """
    When rank-ignores-comment-markers-in-strings: I run a ranked search for "spin"
    Then rank-ignores-comment-markers-in-strings: the matches are on lines "3, 1, 2" in that order

  Scenario: A quoted marker and real comments in one file rank apart
    Given rank-ignores-comment-markers-in-strings: a Go file "a.go" containing the lines:
      """
      // spin
      log.Println("// spin")
      y := spin(1)
      x := 1 // spin
      """
    When rank-ignores-comment-markers-in-strings: I run a ranked search for "spin"
    Then rank-ignores-comment-markers-in-strings: the matches are on lines "3, 2, 1, 4" in that order
