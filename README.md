# Kogen Context

Kogen Context is a standalone Rust CLI in development for finding relevant source code for coding agents. It is designed to take a task and a scoped checkout and return a small set of source excerpts with exact file and line references.

## Current state

The repo contains the Cargo scaffold and Kogen setup, the `search` and `read` commands, and `kogen-context request`, which reads one version 1 JSON request on standard input and writes one version 1 JSON packet on standard output. [`contract/`](contract/) publishes its schemas and examples. `.kogen/project.yaml` configures Claude Code: Sonnet 5.5 medium for Shape and Build, Opus 5.5 medium for Review.

## Source map

- [`src/`](src/): Rust source for the CLI
- [`contract/`](contract/): the version 1 request and packet schemas, examples and fixture checkout
- [`tests/`](tests/): Rust integration tests, including the contract test and the golden packet test
- [`tests/corpus/`](tests/corpus/): the fixture corpus, a Go, a JS/TS and a Python checkout with binary, oversized and escaping symlinked paths
- [`tests/goldens/`](tests/goldens/): the golden requests and packets of `kogen-context request` over the corpus
- [`.kogen/project.yaml`](.kogen/project.yaml): Kogen project configuration
- [`features/steps/README.md`](features/steps/README.md): feature steps notes
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

## License

[Apache License 2.0](LICENSE). For inquiries, contact [contact@kogen.dev](mailto:contact@kogen.dev).
