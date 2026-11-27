Feature: Ranking ignores comment markers inside Rust raw strings

  This feature covers the ranked order of a search of Rust and Go files.
  A comment marker inside a Rust raw string does not make the line a comment;
  a real comment after a closed raw string still ranks as a comment; other
  languages are unchanged.

  Scenario: A comment marker inside a hashed raw string is not a comment
    Given rank-rust-raw-string-comment-markers: a file "a.rs" containing the lines:
      """
      // spin
      let s = r#"a" // spin"#;
      """
    When rank-rust-raw-string-comment-markers: I run a ranked search for "spin"
    Then rank-rust-raw-string-comment-markers: the matches are on lines "2, 1" in that order

  Scenario: A comment after a closed raw string is still a comment
    Given rank-rust-raw-string-comment-markers: a file "a.rs" containing the lines:
      """
      let s = r#"//"#; // spin
      let a = spin;
      """
    When rank-rust-raw-string-comment-markers: I run a ranked search for "spin"
    Then rank-rust-raw-string-comment-markers: the matches are on lines "2, 1" in that order

  Scenario: A raw string ending in a backslash does not hide a following comment
    Given rank-rust-raw-string-comment-markers: a file "a.rs" containing the lines:
      """
      let p = r"C:\"; // spin
      let a = spin;
      """
    When rank-rust-raw-string-comment-markers: I run a ranked search for "spin"
    Then rank-rust-raw-string-comment-markers: the matches are on lines "2, 1" in that order

  Scenario: Other languages do not get raw string handling
    Given rank-rust-raw-string-comment-markers: a file "a.go" containing the lines:
      """
      // spin
      x := r#"a" // spin"#
      """
    When rank-rust-raw-string-comment-markers: I run a ranked search for "spin"
    Then rank-rust-raw-string-comment-markers: the matches are on lines "1, 2" in that order
