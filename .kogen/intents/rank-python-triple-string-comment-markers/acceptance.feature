Feature: Ranking ignores comment markers inside Python triple-quoted strings

  This feature covers the ranked order of a search of Python and Ruby files.
  A matching line that begins with a comment marker inside a Python
  triple-quoted string is a reference, not a comment; a real comment after the
  string closes still ranks as a comment; other languages are unchanged.

  Scenario: A comment marker inside a triple-quoted string is not a comment
    Given rank-python-triple-string-comment-markers: a file "a.py" containing the lines:
      """
      # spin
      s = \"\"\"
      # spin
      \"\"\"
      """
    When rank-python-triple-string-comment-markers: I run a ranked search for "spin"
    Then rank-python-triple-string-comment-markers: the matches are on lines "3, 1" in that order

  Scenario: A comment after a closed triple-quoted string is a comment
    Given rank-python-triple-string-comment-markers: a file "a.py" containing the lines:
      """
      s = \"\"\"
      note
      \"\"\"
      # spin
      x = spin
      """
    When rank-python-triple-string-comment-markers: I run a ranked search for "spin"
    Then rank-python-triple-string-comment-markers: the matches are on lines "5, 4" in that order

  Scenario: A comment after the closing delimiter on the same line is a comment
    Given rank-python-triple-string-comment-markers: a file "a.py" containing the lines:
      """
      s = \"\"\"
      spin
      \"\"\" # spin
      x = spin
      """
    When rank-python-triple-string-comment-markers: I run a ranked search for "spin"
    Then rank-python-triple-string-comment-markers: the matches are on lines "2, 4, 3" in that order

  Scenario: A comment marker inside a single-quote triple string is not a comment
    Given rank-python-triple-string-comment-markers: a file "a.py" containing the lines:
      """
      # spin
      s = '''
      # spin
      '''
      """
    When rank-python-triple-string-comment-markers: I run a ranked search for "spin"
    Then rank-python-triple-string-comment-markers: the matches are on lines "3, 1" in that order

  Scenario: Other languages keep their comment scan
    Given rank-python-triple-string-comment-markers: a file "a.rb" containing the lines:
      """
      s = \"\"\"
      # spin
      \"\"\"
      x = spin
      """
    When rank-python-triple-string-comment-markers: I run a ranked search for "spin"
    Then rank-python-triple-string-comment-markers: the matches are on lines "4, 2" in that order
