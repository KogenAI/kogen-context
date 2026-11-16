# Prune old index files after a writing search

Slug: context-index-cache-prunes-old-files
Model: not applicable — the change is a stateless filter over files in one directory pair; its rules are checked directly on real cache files
Acceptance:
- .kogen/intents/context-index-cache-prunes-old-files/acceptance.feature
- features/steps/context-index-cache-prunes-old-files__steps.js

The search index of `kogen-context` in the per-user cache directory only grows today: nothing removes a commit index, a tree snapshot or the temporary file of a killed search. After this change, a search that has just published a commit index or a tree snapshot also removes the files of `index-v1/commits` and `index-v1/trees` (under the cache directory it just used) that nobody has modified for more than 7 days, so the cache of a busy checkout stays bounded.

Rules:
1. Only a search for which `src/index.rs` successfully published a commit index or a tree snapshot removes anything. A warm search writes nothing and removes nothing.
2. A file is removed when it is a regular file (not a symlink, not a directory) directly inside `index-v1/commits` or `index-v1/trees` and its modification time is more than 7 days before now. This includes leftover hidden temporary files (`.<name>.<pid>.<n>.tmp`).
3. The commit index file of the HEAD commit the search used and the tree snapshot file of its root are never removed, whatever their age.
4. The retention is a named constant of 7 days in `src/index/cache.rs`. There is no setting, flag or environment variable.
5. Removal failures are ignored: a file that cannot be removed (`remove_file` fails) or a directory that cannot be listed never fails the search, never changes the packet or CLI output and never causes a rebuild. Nothing outside the two directories is touched, a symlink there is neither followed nor removed, and the checkout is still never written.
6. `contract/README.md` and `README.md` (the Search index sections) say that a search which writes the cache also removes index files not modified for 7 days, and that a warm search still writes nothing.

Unchanged: packets and CLI outputs (byte-identical with and without the index and with and without the removal), which files a search reads, the version 1 index formats, file names, modes (0600 files, 0700 directories), atomic publication, the request and packet schemas and examples, `tests/corpus.rs`, `tests/contract.rs`, the golden files and the existing assertions in `tests/index.rs`. No new crate (`--locked --offline`), no locking: a concurrent search holding an open removed file keeps reading it, and one that finds it missing builds it again, since every index file is validated on open.

Implementation notes: `Cache` in `src/index/cache.rs` gains the removal; `src/index.rs` tracks whether `cache::publish` returned true for either file and calls the removal once, after both are loaded, with the two used files excluded.

The new Rust tests in `tests/index.rs` use its Scenario helper (`checkout`, `commit`, `head`, `search`, `cache_files`, `commit_file`, `tree_file`, `cache_state`, `age`) and its `set_mtime` function. Every old file gets its modification time with `set_mtime` to the current time minus 8 days (old) or minus 6 days (young). Their names start with `retention_`, so `cargo test --locked --offline --test index retention` runs exactly them. `s.search` already compares every search with a plain copy of the checkout without Git through `assert_like_plain`.

## Decisions
- The removal runs once per search, after the commit index and the tree snapshot were loaded or built, and only when at least one `publish` returned true; it is skipped when neither was published (evidence: src/index.rs; src/index/cache.rs) (source: request)
- The files of the search are excluded by comparing the directory entry path with `Cache::commit_file` and `Cache::tree_file` for this search, and the age test uses `symlink_metadata` so symlinks are never followed (evidence: src/index/cache.rs) (source: request)
- The retention is `const RETENTION: Duration` of 7 days in `src/index/cache.rs`; no option exists for it (evidence: src/index/cache.rs) (source: request)
- Acceptance runs the built release binary through the `search ROOT LITERAL` command on temporary Git checkouts, and ages cache files with file modification times, because the new Rust integration tests are written by the Build and acceptance may not depend on them (evidence: tests/index.rs) (source: request)
- Rust integration tests named `retention_*` are added to `tests/index.rs` using its Scenario helper and `set_mtime` (evidence: tests/index.rs) (source: request)
- The unwritable-directory scenario does nothing observable when the user ignores file modes (a write into the 0500 directory succeeds), as the existing unwritable-cache test allows (evidence: tests/index.rs) (assumption: the acceptance host runs as a non-root user so the mode takes effect) (source: request)
- Prune once per search after both index files are loaded, only when a publish returned true, excluding this search's commit file and tree file, using symlink_metadata and ignoring every error (decision: D1, round 1) (constraint: 7-day RETENTION constant in src/index/cache.rs with no setting) (constraint: only regular files directly inside index-v1/commits and index-v1/trees) (evidence: src/index.rs; src/index/cache.rs; tests/index.rs; contract/README.md) (assumption: I built and ran the correct and seven wrong overlays and the acceptance feature in a scratch copy as a non-root user; the acceptance host must also be non-root for the unwritable-directory scenario to observe anything.) (source: request)

## Source comparison
- Expected 1 (remove regular files older than 7 days in commits and trees after a writing search): addressed by scenarios 1, 2 and 5 of acceptance.feature and by `retention_old_index_files_are_removed_by_a_writing_search`, `retention_young_index_files_are_kept`, `retention_a_warm_search_removes_nothing`.
- Expected 2 (the files this search uses are kept): scenario 3 and `retention_files_used_by_the_search_are_kept`.
- Expected 3 (named constant of 7 days, no setting): rule 4; no scenario can observe a missing setting, the constant is reviewed in `src/index/cache.rs`.
- Expected 4 (failures ignored, only the two directories, symlinks neither followed nor removed, checkout never written): scenarios 4 and 6 and `retention_touches_only_regular_files_of_the_index_directories`, `retention_a_failed_removal_does_not_fail_the_search`; every scenario also checks the packet against a plain copy without Git and that the checkouts are unchanged.
- Expected 5 (documentation): the Search index sections of `contract/README.md` and `README.md` are edited by the Build; no executable check.
- Superseded: the documented claim that the index only ever grows has no counterpart; the documentation sentence that the cache "may be deleted at any time" stays true.

## Tests
- A search that writes a new index removes index files older than 7 days (checkout `app` searched once, so commit A's commit file and tree file are in the cache; both set 8 days old with set_mtime; new commit B; second s.search; the cache holds exactly s.commit_file("app") and the tree file of B, none of A's): retention_old_index_files_are_removed_by_a_writing_search in tests/index.rs (integration)
- Index files younger than 7 days stay (same steps with A's files 6 days old; four files remain, A's and B's): retention_young_index_files_are_kept in tests/index.rs (integration)
- The commit index and tree snapshot the search uses stay whatever their age (search right after the commit so the snapshot is racy, write a new file, s.age(), set the commit file 8 days old, search again; exactly its two files remain): retention_files_used_by_the_search_are_kept in tests/index.rs (integration)
- Only regular files directly inside commits and trees are removed and symlinks are not followed (index-v1/notes.txt, kogen-context/other.txt, outside.txt and a symlink trees/link to outside.txt all survive): retention_touches_only_regular_files_of_the_index_directories in tests/index.rs (integration)
- A warm search removes nothing (second search of B writes nothing; A's files set 8 days old, s.cache_state() noted, third search leaves the cache state equal): retention_a_warm_search_removes_nothing in tests/index.rs (integration)
- A removal that fails does not fail the search or change its output (leftover .stuck.1.0.tmp in trees set 8 days old, directory mode 0500, new commit, search exits 0 with the plain packet checked by assert_like_plain; returns early when a probe fs::write into the directory succeeds): retention_a_failed_removal_does_not_fail_the_search in tests/index.rs (integration)
- The same six rules end to end through the built binary: the six scenarios of acceptance.feature (scenario)
- The Search index sections of contract/README.md and README.md state the 7-day removal and that a warm search writes nothing: the changed text itself (existing)
- The existing assertions of tests/index.rs, tests/corpus.rs and tests/contract.rs keep passing unchanged: cargo test --locked --offline (existing)

## Feasibility
- none
