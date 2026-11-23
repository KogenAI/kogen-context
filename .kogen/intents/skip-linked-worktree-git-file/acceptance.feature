Feature: Exclude .git metadata entries from search
  This feature preserves ordinary sibling matches for both forms of .git entry.

  Scenario: Exclude a regular .git pointer and retain a sibling match
    Given skip-linked-worktree-git-file: a checkout with these files
      | path   | text                       |
      | .git   | gitdir: ../parse_config     |
      | app.py | x = parse_config()         |
    When skip-linked-worktree-git-file: I search for "parse_config"
    Then skip-linked-worktree-git-file: the search succeeds with exactly this JSON
      """
      {"query":"parse_config","matches":[{"path":"app.py","line":1,"column":5,"text":"x = parse_config()"}],"truncated":false}
      """

  Scenario: Exclude .git directory contents and retain a sibling match
    Given skip-linked-worktree-git-file: a checkout with these files
      | path        | text               |
      | .git/config | parse_config       |
      | app.py      | x = parse_config() |
    When skip-linked-worktree-git-file: I search for "parse_config"
    Then skip-linked-worktree-git-file: the search succeeds with exactly this JSON
      """
      {"query":"parse_config","matches":[{"path":"app.py","line":1,"column":5,"text":"x = parse_config()"}],"truncated":false}
      """
