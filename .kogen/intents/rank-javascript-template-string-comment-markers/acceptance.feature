Feature: Ranking ignores comment markers inside JavaScript template literal text

  This feature covers the ranked order of a search of JavaScript and Go files.
  A comment marker inside template literal text does not make the line a
  comment; a real comment after a closed template literal still ranks as a
  comment; other languages are unchanged.

  Scenario: A comment marker inside template literal text is not a comment
    Given rank-javascript-template-string-comment-markers: a file "a.js" containing the lines:
      """
      // spin
      const s = `a // spin`;
      """
    When rank-javascript-template-string-comment-markers: I run a ranked search for "spin"
    Then rank-javascript-template-string-comment-markers: the matches are on lines "2, 1" in that order

  Scenario: A comment after a closed template literal is still a comment
    Given rank-javascript-template-string-comment-markers: a file "a.js" containing the lines:
      """
      const s = `//`; // spin
      const a = spin;
      """
    When rank-javascript-template-string-comment-markers: I run a ranked search for "spin"
    Then rank-javascript-template-string-comment-markers: the matches are on lines "2, 1" in that order

  Scenario: Other languages do not get template literal handling
    Given rank-javascript-template-string-comment-markers: a file "a.go" containing the lines:
      """
      // spin
      x := `a // spin`
      """
    When rank-javascript-template-string-comment-markers: I run a ranked search for "spin"
    Then rank-javascript-template-string-comment-markers: the matches are on lines "1, 2" in that order
