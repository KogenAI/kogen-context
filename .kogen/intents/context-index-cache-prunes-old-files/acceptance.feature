Feature: A search that writes the index cache removes index files not modified for 7 days
  This feature runs the built kogen-context search command on temporary Git checkouts with a temporary cache directory. Index files are aged with file modification times.

  Scenario: Old index files go when a search writes a new index
    Given context-index-cache-prunes-old-files: a Git checkout "app" whose commit is called "A"
    When context-index-cache-prunes-old-files: "app" is searched
    And context-index-cache-prunes-old-files: the commit index file of "A" is set 8 days old
    And context-index-cache-prunes-old-files: the tree snapshot files of "A" are set 8 days old
    And context-index-cache-prunes-old-files: "app" gets a new commit called "B"
    And context-index-cache-prunes-old-files: "app" is searched
    Then context-index-cache-prunes-old-files: the last search succeeded, printed the packet of a plain copy and left the checkouts unchanged
    And context-index-cache-prunes-old-files: the regular files in the index directories are exactly the files of the commits "B"

  Scenario: Young index files stay
    Given context-index-cache-prunes-old-files: a Git checkout "app" whose commit is called "A"
    When context-index-cache-prunes-old-files: "app" is searched
    And context-index-cache-prunes-old-files: the commit index file of "A" is set 6 days old
    And context-index-cache-prunes-old-files: the tree snapshot files of "A" are set 6 days old
    And context-index-cache-prunes-old-files: the hidden file ".stuck.2.0.tmp" is left in the trees directory and set 8 days old
    And context-index-cache-prunes-old-files: "app" gets a new commit called "B"
    And context-index-cache-prunes-old-files: "app" is searched
    Then context-index-cache-prunes-old-files: the last search succeeded, printed the packet of a plain copy and left the checkouts unchanged
    And context-index-cache-prunes-old-files: the regular files in the index directories are exactly the files of the commits "A, B"

  Scenario: The files the search itself uses stay however old
    Given context-index-cache-prunes-old-files: a Git checkout "app" whose commit is called "A"
    When context-index-cache-prunes-old-files: "app" is searched
    And context-index-cache-prunes-old-files: a new file "extra.txt" is written in "app"
    And context-index-cache-prunes-old-files: the working tree files are aged
    And context-index-cache-prunes-old-files: the commit index file of "A" is set 8 days old
    And context-index-cache-prunes-old-files: the hidden file ".stuck.3.0.tmp" is left in the commits directory and set 8 days old
    And context-index-cache-prunes-old-files: "app" is searched
    Then context-index-cache-prunes-old-files: the last search succeeded, printed the packet of a plain copy and left the checkouts unchanged
    And context-index-cache-prunes-old-files: the regular files in the index directories are exactly the files of the commits "A"

  Scenario: Only the two index directories are cleaned and symlinks are not followed
    Given context-index-cache-prunes-old-files: a Git checkout "app" whose commit is called "A"
    When context-index-cache-prunes-old-files: "app" is searched
    And context-index-cache-prunes-old-files: the file "cache/kogen-context/index-v1/notes.txt" is written below the scenario directory
    And context-index-cache-prunes-old-files: the file "cache/kogen-context/other.txt" is written below the scenario directory
    And context-index-cache-prunes-old-files: the file "outside.txt" is written below the scenario directory
    And context-index-cache-prunes-old-files: the symlink "cache/kogen-context/index-v1/trees/link" is made pointing at "outside.txt"
    And context-index-cache-prunes-old-files: the file "cache/kogen-context/index-v1/notes.txt" is set 8 days old
    And context-index-cache-prunes-old-files: the file "cache/kogen-context/other.txt" is set 8 days old
    And context-index-cache-prunes-old-files: the file "outside.txt" is set 8 days old
    And context-index-cache-prunes-old-files: the commit index file of "A" is set 8 days old
    And context-index-cache-prunes-old-files: the tree snapshot files of "A" are set 8 days old
    And context-index-cache-prunes-old-files: "app" gets a new commit called "B"
    And context-index-cache-prunes-old-files: "app" is searched
    Then context-index-cache-prunes-old-files: the last search succeeded, printed the packet of a plain copy and left the checkouts unchanged
    And context-index-cache-prunes-old-files: the regular files in the index directories are exactly the files of the commits "B"
    And context-index-cache-prunes-old-files: the file "cache/kogen-context/index-v1/notes.txt" still exists below the scenario directory
    And context-index-cache-prunes-old-files: the file "cache/kogen-context/other.txt" still exists below the scenario directory
    And context-index-cache-prunes-old-files: the file "outside.txt" still exists below the scenario directory
    And context-index-cache-prunes-old-files: the symlink "cache/kogen-context/index-v1/trees/link" still exists below the scenario directory

  Scenario: A warm search removes nothing
    Given context-index-cache-prunes-old-files: a Git checkout "app" whose commit is called "A"
    When context-index-cache-prunes-old-files: the working tree files are aged
    And context-index-cache-prunes-old-files: "app" is searched
    And context-index-cache-prunes-old-files: "app" gets a new commit called "B"
    And context-index-cache-prunes-old-files: the working tree files are aged
    And context-index-cache-prunes-old-files: the hidden file ".stuck.5.0.tmp" is left in the trees directory and set 8 days old
    And context-index-cache-prunes-old-files: "app" is searched
    And context-index-cache-prunes-old-files: "app" is searched
    And context-index-cache-prunes-old-files: the commit index file of "A" is set 8 days old
    And context-index-cache-prunes-old-files: the tree snapshot files of "A" are set 8 days old
    And context-index-cache-prunes-old-files: the state of the cache directory is noted
    And context-index-cache-prunes-old-files: "app" is searched
    Then context-index-cache-prunes-old-files: the last search succeeded, printed the packet of a plain copy and left the checkouts unchanged
    And context-index-cache-prunes-old-files: the state of the cache directory is the noted one
    And context-index-cache-prunes-old-files: the regular files in the index directories are exactly the files of the commits "A, B"

  Scenario: A removal that cannot happen does not fail the search
    Given context-index-cache-prunes-old-files: a Git checkout "app" whose commit is called "A"
    When context-index-cache-prunes-old-files: "app" is searched
    And context-index-cache-prunes-old-files: the hidden file ".stuck.1.0.tmp" is left in the trees directory and set 8 days old
    And context-index-cache-prunes-old-files: the hidden file ".stuck.6.0.tmp" is left in the commits directory and set 8 days old
    And context-index-cache-prunes-old-files: the trees directory is made unwritable
    And context-index-cache-prunes-old-files: "app" gets a new commit called "B"
    And context-index-cache-prunes-old-files: "app" is searched
    Then context-index-cache-prunes-old-files: the last search succeeded, printed the packet of a plain copy and left the checkouts unchanged
    And context-index-cache-prunes-old-files: the hidden file ".stuck.6.0.tmp" is gone from the commits directory
