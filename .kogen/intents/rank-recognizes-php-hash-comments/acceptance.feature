Feature: Ranking recognizes PHP hash comments

  This feature covers the ranked order of a search of a PHP file. A line with a hash
  comment ranks as a comment, while PHP source lines and slash comments keep their
  classification.

  Scenario: A PHP line beginning with a hash is a comment
    Given rank-recognizes-php-hash-comments: a PHP file "a.php" containing the lines:
      """
      # spin
      $x = spin;
      """
    When rank-recognizes-php-hash-comments: I run a ranked search for "spin"
    Then rank-recognizes-php-hash-comments: the matches are on lines "2, 1" in that order

  Scenario: A PHP source call stays a call above references and comments
    Given rank-recognizes-php-hash-comments: a PHP file "a.php" containing the lines:
      """
      # spin
      spin($x);
      $x = spin;
      """
    When rank-recognizes-php-hash-comments: I run a ranked search for "spin"
    Then rank-recognizes-php-hash-comments: the matches are on lines "2, 3, 1" in that order

  Scenario: PHP comments with // or a trailing # rank below source references
    Given rank-recognizes-php-hash-comments: a PHP file "a.php" containing the lines:
      """
      // spin
      $z = spin;
      $x = 1; # spin
      """
    When rank-recognizes-php-hash-comments: I run a ranked search for "spin"
    Then rank-recognizes-php-hash-comments: the matches are on lines "2, 1, 3" in that order
