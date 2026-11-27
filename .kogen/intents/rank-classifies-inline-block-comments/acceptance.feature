Feature: Ranking classifies inline block comments as comments

  This feature covers the ranked order of a search of a C source file.
  A match inside a C-style block comment that begins after code on the same line
  ranks as a comment; code before or after such a comment ranks from its code context.

  Scenario: An inline block comment after code is a comment
    Given rank-classifies-inline-block-comments: a file "a.c" containing the lines:
      """
      int a = 1; /* spin */
      int spin = 2;
      """
    When rank-classifies-inline-block-comments: I run a ranked search for "spin"
    Then rank-classifies-inline-block-comments: the matches are on lines "2, 1" in that order

  Scenario: A match before an inline block comment keeps its code classification
    Given rank-classifies-inline-block-comments: a file "a.c" containing the lines:
      """
      /* spin */
      x = spin; /* note */
      """
    When rank-classifies-inline-block-comments: I run a ranked search for "spin"
    Then rank-classifies-inline-block-comments: the matches are on lines "2, 1" in that order

  Scenario: Ordinary code without a block comment keeps its classification
    Given rank-classifies-inline-block-comments: a file "a.c" containing the lines:
      """
      // spin
      y = 2 * spin(1);
      s = "/*" + spin;
      """
    When rank-classifies-inline-block-comments: I run a ranked search for "spin"
    Then rank-classifies-inline-block-comments: the matches are on lines "2, 3, 1" in that order

  Scenario: A match after a closed inline block comment is code
    Given rank-classifies-inline-block-comments: a file "a.c" containing the lines:
      """
      // spin
      x = 1; /* a */ y = spin;
      z = spin;
      """
    When rank-classifies-inline-block-comments: I run a ranked search for "spin"
    Then rank-classifies-inline-block-comments: the matches are on lines "2, 3, 1" in that order
