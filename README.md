# kogen-context

Standalone Rust checkout that serves as source context for coding agents.

## Current state

- Kogen is configured for this repo with Claude Code.
- Nothing is implemented yet; `src/main.rs` is the stock `cargo init` hello world.
- Implementation will start on the Mac Studio.

## Plan

https://app.kogen.studio/workspaces/optimum/projects/kontext/documents/kogen-context-runtime-and-bootstrap-20261104?revision=4

## Entry points

```sh
cargo check
cargo build
cargo test
```

## Map

- `src/` – Rust source.
- `.kogen/project.yaml` – Kogen project configuration.
- `features/` and steps – Kogen feature and step definitions.
