# Kogen Context

Kogen Context is a standalone Rust CLI in development for finding relevant source code for coding agents. It is designed to take a task and a scoped checkout and return a small set of source excerpts with exact file and line references.

## Current state

The repo contains the Cargo scaffold and Kogen setup, the `search` and `read` commands, and `kogen-context request`, which reads one version 1 JSON request on standard input and writes one version 1 JSON packet on standard output. A search request may ask for `"order": "ranked"`, which lists definitions and call sites in source code before tests, generated code, comments and docs; the default stays the path order. `kogen-context version` prints the package version and, in a release build, its tag and commit. `scripts/release.sh` and `scripts/release-check.sh` build and check release binaries. [`contract/`](contract/) publishes its schemas and examples. A search on a Git checkout keeps a per-commit index in the per-user cache directory and overlays the working tree's edits on it (see [Search index](#search-index)); it changes speed only. `.kogen/project.yaml` configures Claude Code: Sonnet 5.5 medium for Shape and Build, Opus 5.5 medium for Review.

## Source map

- [`src/`](src/): Rust source for the CLI
- [`contract/`](contract/): the version 1 request and packet schemas, examples and fixture checkout
- [`tests/`](tests/): Rust integration tests, including the contract test and the golden packet test; `tests/index.rs` runs searches on real Git checkouts and checks the index files, and `tests/index_bench.rs` is the ignored benchmark against ripgrep
- [`tests/corpus/`](tests/corpus/): the fixture corpus, a Go, a JS/TS and a Python checkout with binary, oversized and escaping symlinked paths
- [`tests/goldens/`](tests/goldens/): the golden requests and packets of `kogen-context request` over the corpus
- [`tests/ranking/`](tests/ranking/): the ranking fixtures (a REPL and a WPT shape) and their golden requests and packets, run by `tests/ranking.rs`
- [`.kogen/project.yaml`](.kogen/project.yaml): Kogen project configuration
- [`features/steps/README.md`](features/steps/README.md): feature steps notes
- [`src/index.rs`](src/index.rs) and [`src/index/`](src/index/): the commit index, the tree snapshot, the cache directory and the `git` runs
- [`scripts/`](scripts/): the release build scripts, `scripts/crane-replay.sh`, the ranking replay on two pinned Crane revisions, and `scripts/crane-bench.sh`, the benchmark replay on the same revisions
- [`rust-toolchain.toml`](rust-toolchain.toml): pinned Rust toolchain

## Checks

The repo pins Rust 1.99.1 with rustfmt and Clippy. With the Rust toolchain installed, run:

```sh
cargo fmt --all --check
cargo clippy --locked --offline --all-targets -- -D warnings
cargo test --locked --offline
cargo build --locked --offline
```

`tests/corpus.rs` runs `kogen-context request` on every golden request, compares its output to the golden packet byte for byte and checks that the corpus is unchanged. To rewrite the golden packets after an intended output change, run:

```sh
KOGEN_CONTEXT_UPDATE_GOLDENS=1 cargo test --locked --offline --test corpus
```

## Ranking replay

`scripts/crane-replay.sh` fetches two pinned public Crane revisions (`adc2ea58b65` and `b41782ab61d` of `https://github.com/zig-whatwg/crane.git`) into a temporary directory, searches them for a fixed list of hints in both orders and prints the rank of every match. Build the binary, then run:

```sh
cargo build --locked --offline
sh scripts/crane-replay.sh target/debug/kogen-context
```

It needs network access, `git`, `tar` and `python3`, prints one tab-separated record per match (`revision`, `order`, `hint`, `rank`, `path:line`) and removes its temporary directory. Nothing of Crane is checked in.

## Search index

A search (`kogen-context request` with `"operation": "search"`, and `kogen-context search ROOT LITERAL`) on a root inside a Git checkout uses an index of the checkout's HEAD commit. The index lives in the per-user cache directory, outside the root, and every run of the same user on the host shares it:

- `$XDG_CACHE_HOME/kogen-context` when `XDG_CACHE_HOME` is an absolute path, else `~/Library/Caches/kogen-context` on macOS and `~/.cache/kogen-context` elsewhere (`HOME` must be absolute).
- `index-v1/commits/<commit>` is the commit index: every regular-file blob of the commit with its distinct byte trigrams.
- `index-v1/trees/<commit>-<root key>` is the tree snapshot of one root: the files whose working-tree bytes were the commit's bytes and whose `lstat` is recorded.

Every search overlays the working tree on the index. A file that the snapshot trusts and that the index shows cannot contain the literal is not read; every other file is read as before. So edited, added, ignored and deleted files are seen in the next search, and nothing is rebuilt for them. The packets and CLI outputs are byte-identical with and without the index, the checkout (`.git` included) is never written, and the cache may be deleted at any time. Outside Git checkouts, and without a usable cache directory, a search scans the files as before. A cold search runs `git` read-only and writes in the cache directory; a warm search runs no other program and writes nothing. `contract/README.md` states the rules.

## Benchmarks

The benchmark test compares kogen-context with ripgrep on a generated 4000-file Git checkout, cold, warm and after an edit. It is ignored by default; it needs `git` and `rg`, and a release build:

```sh
cargo test --release --locked --offline --test index_bench -- --ignored --nocapture
```

It prints five lines, `<phase>`, `<order>`, kogen-context milliseconds and ripgrep milliseconds, tab-separated, and writes them to the file named by `KOGEN_CONTEXT_BENCH_REPORT` when that variable is set. It fails when a warm or after-edit time of kogen-context is above ripgrep's.

`scripts/crane-bench.sh` does the same on the two pinned Crane revisions, as linked Git worktrees with a cache directory inside its temporary directory:

```sh
cargo build --release --locked --offline
sh scripts/crane-bench.sh target/release/kogen-context
```

It needs network access, `git`, `rg`, `tar` and `python3`, prints one tab-separated record per measurement (`revision`, `phase`, `order`, `hint`, kogen-context ms, ripgrep ms) and removes its temporary directory. It judges no time.

## Release builds

Each build host builds the binary for its own platform: the two Macs build `darwin-arm64`, lm and eu2 build `linux-x86_64`. On each of the four hosts, run `scripts/release.sh TAG` from a local tag. The script exports the tag's commit with `git archive`, builds it with `cargo build --release --locked --offline` in two directories, checks that both binaries are byte-identical, runs the fixture corpus tests against the first binary and keeps it. HEAD and the working tree do not matter. The artifacts are:

- `target/kogen-context-release/TAG/kogen-context-TAG-<platform>`
- `target/kogen-context-release/TAG/SHA256SUMS`

Running the script again for the same tag replaces that tag's directory. The script prints `SHA256SUMS`.

`scripts/release-check.sh` is the CI-equivalent check of HEAD to run on each host. It runs the same build and fixture tests without a tag, writes no artifacts and prints `release check passed: <platform> <sha256>`.

`kogen-context version` prints one line: `kogen-context 0.1.0 (tag TAG, commit COMMIT)` for a release build and `kogen-context 0.1.0 (development build)` otherwise.

`KOGEN_CONTEXT_BIN` makes the corpus test (`tests/corpus.rs`) run the named file as `kogen-context request` instead of the binary that Cargo built:

```sh
KOGEN_CONTEXT_BIN=/path/to/kogen-context cargo test --locked --offline --test corpus
```

Nothing is published and release tags are not pushed. The release scripts never create, move or push tags, never contact a remote and never upload; `scripts/crane-replay.sh` and `scripts/crane-bench.sh` are the only scripts that use the network.

## License

[Apache License 2.0](LICENSE). For inquiries, contact [contact@kogen.dev](mailto:contact@kogen.dev).
