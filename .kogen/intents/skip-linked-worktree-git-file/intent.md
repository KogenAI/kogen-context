# Exclude regular .git files from search

Slug: skip-linked-worktree-git-file
Model: not applicable — this is a stateless file-entry filtering correction
Acceptance:
- .kogen/intents/skip-linked-worktree-git-file/acceptance.feature
- features/steps/skip-linked-worktree-git-file__steps.js

Exclude a regular file named `.git` from search results while retaining ordinary sibling matches. Preserve the existing exclusion of `.git` directories and their contents. Replace only the search traversal's treatment of regular `.git` entries; limit implementation edits to `src/main.rs` and regression coverage in `tests/cli.rs`. Git discovery, index construction, and read behavior remain out of scope.

## Decisions
- Exclude the .git entry itself from search results when it is a regular file, while continuing to search ordinary files in the same checkout. (source: request)
- Preserve exclusion of files beneath a .git directory and preserve ordinary sibling matches. (source: request)
- Use the actual built CLI on temporary filesystem fixtures, following the existing CLI integration-test convention; add regular-file regression coverage and retain directory exclusion coverage in tests/cli.rs. (evidence: tests/cli.rs; features/steps/README.md) (source: request)

## Source comparison
- addressed: Request evidence ev-7fc2825c identifies the directory-only exclusion in src/main.rs::walk_files and the existing .git/config coverage in tests/cli.rs; the complete contract changes regular .git file filtering only and adds regression coverage in the requested two-file implementation scope.
- addressed: Request acceptance 1 is executable in the regular-file scenario: a query-bearing .git pointer and a sibling source file yield only the sibling match. Controls distinguish searching the pointer from suppressing the entire checkout.
- addressed: Request acceptance 2 is executable in the directory scenario: query-bearing .git/config remains omitted while the sibling match remains visible. Controls distinguish exposing metadata from hiding siblings.
- addressed: Request boundaries leave src/index/git.rs discovery, index construction, and read behavior unchanged. No conflicting, omitted, or superseded requested behavior is introduced.

## Tests
- Regular .git files are excluded without hiding siblings: add a CLI regression test in tests/cli.rs and execute the regular-file acceptance scenario (regression)
- .git directory contents remain excluded without hiding siblings: retain the existing tests/cli.rs directory exclusion and execute the directory acceptance scenario (scenario)
- none: No constant-work collection scenario applies: filesystem search necessarily examines candidate files as their count grows; this request only corrects which named entry is excluded and introduces no bulk data-store or external-service operation.

## Feasibility
- A scratch build and actual CLI searches reproduced the metadata-file leak and confirmed the directory fixture returns only the sibling. The local fixtures require no Git commands or network access. (probe 1: exit 0, 58.9 s)
