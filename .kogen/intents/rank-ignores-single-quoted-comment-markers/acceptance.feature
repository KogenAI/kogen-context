Feature: Ranking ignores comment markers inside single-quoted strings

  This feature covers the ranked order of a search of shell, Python and Rust files.
  A comment marker inside a single-quoted string does not make the line a comment;
  a real comment still ranks as a comment.

  Scenario: A hash inside a single-quoted shell string is not a comment
    Given rank-ignores-single-quoted-comment-markers: a file "a.sh" containing the lines:
      """
      # spin
      echo '# spin'
      """
    When rank-ignores-single-quoted-comment-markers: I run a ranked search for "spin"
    Then rank-ignores-single-quoted-comment-markers: the matches are on lines "2, 1" in that order

  Scenario: A hash inside a single-quoted Python string is not a comment
    Given rank-ignores-single-quoted-comment-markers: a file "a.py" containing the lines:
      """
      # spin
      x = '# spin'
      """
    When rank-ignores-single-quoted-comment-markers: I run a ranked search for "spin"
    Then rank-ignores-single-quoted-comment-markers: the matches are on lines "2, 1" in that order

  Scenario: A hash outside a single-quoted string is still a comment
    Given rank-ignores-single-quoted-comment-markers: a file "a.sh" containing the lines:
      """
      # spin
      echo 'a' # spin
      spin_cmd
      """
    When rank-ignores-single-quoted-comment-markers: I run a ranked search for "spin"
    Then rank-ignores-single-quoted-comment-markers: the matches are on lines "3, 1, 2" in that order

  Scenario: A single quote outside hash-comment languages is not a string
    Given rank-ignores-single-quoted-comment-markers: a file "a.rs" containing the lines:
      """
      // spin
      let r: &'a str = y; // spin
      let z = spin;
      """
    When rank-ignores-single-quoted-comment-markers: I run a ranked search for "spin"
    Then rank-ignores-single-quoted-comment-markers: the matches are on lines "3, 1, 2" in that order
