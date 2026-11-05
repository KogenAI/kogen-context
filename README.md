# Kogen Context

Kogen Context is a standalone Rust CLI in development for finding relevant source code for coding agents. It is designed to take a task and a scoped checkout and return a small set of source excerpts with exact file and line references.

## Current state

The repo contains the Cargo scaffold and Kogen setup, the `search` and `read` commands, and `kogen-context request`, which reads one version 1 JSON request on standard input and writes one version 1 JSON packet on standard output. A search request may ask for `"order": "ranked"`, which lists definitions and call sites in source code before tests, generated code, comments and docs; the default stays the path order. `kogen-context version` prints the package version and, in a release build, its tag and commit. `scripts/release.sh` and `scripts/release-check.sh` build and check release binaries. [`contract/`](contract/) publishes its schemas and examples. `.kogen/project.yaml` configures Claude Code: Sonnet 5.5 medium for Shape and Build, Opus 5.5 medium for Review.

## Source map

- [`src/`](src/): Rust source for the CLI
- [`contract/`](contract/): the version 1 request and packet schemas, examples and fixture checkout
- [`tests/`](tests/): Rust integration tests, including the contract test and the golden packet test
- [`tests/corpus/`](tests/corpus/): the fixture corpus, a Go, a JS/TS and a Python checkout with binary, oversized and escaping symlinked paths
- [`tests/goldens/`](tests/goldens/): the golden requests and packets of `kogen-context request` over the corpus
- [`tests/ranking/`](tests/ranking/): the ranking fixtures (a REPL and a WPT shape) and their golden requests and packets, run by `tests/ranking.rs`
- [`.kogen/project.yaml`](.kogen/project.yaml): Kogen project configuration
- [`features/steps/README.md`](features/steps/README.md): feature steps notes
- [`scripts/`](scripts/): the release build scripts and `scripts/crane-replay.sh`, the ranking replay on two pinned Crane revisions
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

Nothing is published and release tags are not pushed. The release scripts never create, move or push tags, never contact a remote and never upload; the replay script above is the one script that uses the network.

## License

[Apache License 2.0](LICENSE). For inquiries, contact [contact@kogen.dev](mailto:contact@kogen.dev).
