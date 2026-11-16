Feature: Search and read stop reading a file at the first byte that proves it is not UTF-8 text
  This feature covers read_utf8_blocks in src/main.rs, which reads a file as UTF-8 text from any std::io::Read in blocks of 65536 bytes. Each scenario adds in-memory reader tests to a scratch copy of the crate and runs one of them with cargo.

  Scenario: A file that is invalid from its first byte is dropped after one block
    Given context-search-stops-reading-non-text-files: the block reader tests are added to a scratch copy of the crate
    When context-search-stops-reading-non-text-files: the test reads_text_blocks_stops_at_the_first_invalid_block is run in the scratch copy
    Then context-search-stops-reading-non-text-files: the test reads_text_blocks_stops_at_the_first_invalid_block passed

  Scenario: An invalid byte in a later block is still found
    Given context-search-stops-reading-non-text-files: the block reader tests are added to a scratch copy of the crate
    When context-search-stops-reading-non-text-files: the test reads_text_blocks_finds_an_invalid_byte_in_a_later_block is run in the scratch copy
    Then context-search-stops-reading-non-text-files: the test reads_text_blocks_finds_an_invalid_byte_in_a_later_block passed

  Scenario: A character that straddles two blocks is valid
    Given context-search-stops-reading-non-text-files: the block reader tests are added to a scratch copy of the crate
    When context-search-stops-reading-non-text-files: the test reads_text_blocks_accepts_a_character_across_a_block_boundary is run in the scratch copy
    Then context-search-stops-reading-non-text-files: the test reads_text_blocks_accepts_a_character_across_a_block_boundary passed

  Scenario: An incomplete character at the end of the file is invalid
    Given context-search-stops-reading-non-text-files: the block reader tests are added to a scratch copy of the crate
    When context-search-stops-reading-non-text-files: the test reads_text_blocks_refuses_an_incomplete_final_character is run in the scratch copy
    Then context-search-stops-reading-non-text-files: the test reads_text_blocks_refuses_an_incomplete_final_character passed

  Scenario: A failing read gives nothing
    Given context-search-stops-reading-non-text-files: the block reader tests are added to a scratch copy of the crate
    When context-search-stops-reading-non-text-files: the test reads_text_blocks_gives_nothing_when_the_read_fails is run in the scratch copy
    Then context-search-stops-reading-non-text-files: the test reads_text_blocks_gives_nothing_when_the_read_fails passed

  Scenario: Both searches and read use the block reader
    Given context-search-stops-reading-non-text-files: the block reader tests are added to a scratch copy of the crate
    Then context-search-stops-reading-non-text-files: find_matches, find_ranked_matches and read_lines read files with read_utf8_blocks instead of fs::read
