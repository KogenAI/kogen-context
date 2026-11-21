# Kogen Context

Kogen Context is a standalone CLI for coding agents. Give it a checkout and an exact string, such as an error message or a function name. It returns matching file paths and line numbers, and can read just the lines you ask for. It works with any agent that can run shell commands.

## Quickstart

Install from source with Git, [rustup](https://rustup.rs/) and a system linker (for example, Xcode Command Line Tools on macOS or a C toolchain on Linux). Run these commands in the environment where your agent will work.

```sh
git clone https://github.com/KogenAI/kogen-context.git
cd kogen-context
rustup toolchain install --no-self-update
cargo install --locked --path .
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
kogen-context --help
```

Rustup reads the pinned toolchain from the clone. If your agent opens a separate shell, check that it can run `kogen-context --help` there too. The CLI needs no Kogen installation, account, plugin or project setup.

Try it from the clone:

```sh
kogen-context search contract/examples/checkout parse_config
kogen-context read contract/examples/checkout util.py 1 2
```

The search lists the definition at `util.py:1` and its uses. The read prints lines 1 and 2. Both commands return JSON.

### Agent prompt

Open the checkout where the bug lives and paste this after the bug report:

```text
Use Kogen Context from this checkout. Pick an exact error string or symbol from
the bug report and run kogen-context search . 'LITERAL' with that text.
For the best match, run kogen-context read . PATH LINE LINE using its path and
line number. Use total_lines from the response to keep any wider read within
the file. Both endpoints are inclusive.
If you need more evidence, use your normal tools. Fix the bug, run a targeted
test and report the relevant file and line numbers and the test result.
```

### Request from JSON

For a structured call, send one version 1 request on standard input. This one ranks matches in the fixture and returns at most 5:

```sh
kogen-context request <<'EOF'
{"version":1,"root":"contract/examples/checkout","operation":"search","literal":"parse_config","order":"ranked","limits":{"max_matches":5}}
EOF
```

The default order is by path. Ranked search prioritizes likely definitions and call sites using simple rules. Both modes look for exact, case-sensitive text. See the [request and packet contract](contract/).

Search includes ignored files, so choose a narrow root where practical.

## Current state

Kogen Context is in development. Each invocation searches or reads one directory tree. The CLI reads source files without editing them. In a Git checkout, the first search can build an [index](#search-index) in your user cache automatically.

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

Every search overlays the working tree on the index. A file that the snapshot trusts and that the index shows cannot contain the literal is not read; every other file is read as before. So edited, added, ignored and deleted files are seen in the next search, and nothing is rebuilt for them. The packets and CLI outputs are byte-identical with and without the index, the checkout (`.git` included) is never written, and the cache may be deleted at any time. Outside Git checkouts, and without a usable cache directory, a search scans the files as before. A cold search runs `git` read-only and writes in the cache directory; a warm search runs no other program and writes nothing. A search that writes the cache also removes regular index files (including leftover temporary files) not modified for more than 7 days from `index-v1/commits` and `index-v1/trees`, except the commit index and root snapshot it uses. Symlinks are left alone and removal failures are ignored. `contract/README.md` states the rules.

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
