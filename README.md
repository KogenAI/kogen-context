# Kogen Context

Kogen Context is a standalone Rust CLI in development for finding relevant source code for coding agents. It is designed to take a task and a scoped checkout and return a small set of source excerpts with exact file and line references.

## Current state

The repo currently contains the Cargo scaffold and Kogen setup. `.kogen/project.yaml` configures Claude Code: Sonnet 5.5 medium for Shape and Build, Opus 5.5 medium for Review.

## Source map

- [`src/`](src/): Rust source for the CLI
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

## License

[Apache License 2.0](LICENSE). For inquiries, contact [contact@kogen.dev](mailto:contact@kogen.dev).
