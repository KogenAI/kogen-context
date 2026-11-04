# Add reproducible release builds and versioning

Slug: k-context-release-binaries
Model: not applicable — each script run is a stateless pipeline from one Git commit to one artifact directory, and `kogen-context version` prints a compile-time constant; nothing is stored between runs except the replaced artifact directory of one tag
Acceptance:
- .kogen/intents/k-context-release-binaries/acceptance.feature
- features/steps/k-context-release-binaries__cli.js
- features/steps/k-context-release-binaries__check.js

This Intent adds a reproducible release build of the `kogen-context` binary that each of the four build hosts runs for its own platform: the two Macs build `darwin-arm64` and the Linux hosts lm and eu2 build `linux-x86_64`. It adds a `kogen-context version` command, a release script `scripts/release.sh TAG` that builds a local tag's commit and keeps the binary and its SHA-256 checksum on the host, and a CI-equivalent check `scripts/release-check.sh` that runs the same build and fixture tests on HEAD without writing artifacts. The corpus golden test (`tests/corpus.rs`) learns to run a given binary, so the fixture tests run against the built release binary.

A host can only build and run its own platform's binary: cross-compiling would need extra rustup targets in the protected `rust-toolchain.toml` and network access, and a darwin binary cannot run its fixture tests on Linux. So "every target" means every host runs the scripts for its own platform. Nothing is published: the scripts never create, move or push tags, never contact a remote and never upload, and the artifacts stay under `target/` (Git-ignored) on the host. Packaging for end users, a tag naming scheme and publication are out of scope. `search`, `read`, `request`, the version 1 contract in `contract/`, the usage refusal message, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` and `.kogen/project.yaml` stay unchanged. Add no crates; use only the Rust standard library.

**`kogen-context version`**

`kogen-context version` with no further argument prints exactly one line on stdout, writes nothing to stderr and exits 0:
- when the compile-time environment variables `KOGEN_CONTEXT_RELEASE_TAG` and `KOGEN_CONTEXT_RELEASE_COMMIT` were both set and nonempty when the binary was compiled (read with `option_env!`): `kogen-context <package version> (tag <tag>, commit <commit>)` plus `\n`, for example `kogen-context 0.1.0 (tag local-test-1, commit 0123…)` with the full 40-character commit;
- otherwise: `kogen-context <package version> (development build)` plus `\n`, today `kogen-context 0.1.0 (development build)`.

The package version is `env!("CARGO_PKG_VERSION")`. `version` with any further argument (for example `kogen-context version extra`) is the existing usage refusal, byte for byte unchanged: stdout empty, stderr `{"error":{"code":"usage","message":"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}` plus `\n`, exit status 2. The usage message keeps its exact text, because earlier Intents pin it.

**Corpus test binary (`tests/corpus.rs`)**

When the runtime environment variable `KOGEN_CONTEXT_BIN` is set to a nonempty value, `golden_packets_match_and_the_corpus_is_unchanged` runs that file as `kogen-context request` instead of `env!("CARGO_BIN_EXE_kogen-context")`. Everything else stays: the same goldens, comparisons, snapshots, failure messages (for example `tests/goldens/go-search.packet.json: stdout of tests/goldens/go-search.request.json differs from the golden packet`) and update path. When the variable is unset or empty, the test runs the binary that Cargo built, as now. If the named file cannot be started, the test fails with a message that names its path.

**Release pipeline, shared by both scripts**

Both scripts are POSIX `sh` scripts, committed executable (Git mode 100755), that run on macOS and Linux with only `git`, `cargo`, `rustc` (through the rustup toolchain pinned by the exported `rust-toolchain.toml`), `tar`, `mktemp`, `cmp` and `sha256sum` or, where that is missing, `shasum -a 256`. Each works on the Git repository that contains it (found from the script's own path, whatever the current directory), never changes that repository's HEAD, index, tags or tracked or untracked files, and removes its temporary directory on exit. All output of `git`, `cargo` and the test run goes to stderr; stdout carries only the final line(s) described below. For a commit `C` (a full 40-character commit id), the pipeline does, in this order, stopping at the first failure:
1. Determine the host platform from the `host:` line of `rustc -vV`: `aarch64-apple-darwin` is `darwin-arm64`, `x86_64-unknown-linux-gnu` is `linux-x86_64`, `aarch64-unknown-linux-gnu` is `linux-arm64` (the request gives the Linux hosts no architecture; this host is x86_64). Any other host fails with `<script>: unsupported build host: <triple>`.
2. Export the tree of `C` with `git archive C` into two fresh, different directories inside one new temporary directory (for example `<tmp>/a/kogen-context` and `<tmp>/b/kogen-context`). Uncommitted changes and untracked files of the repository are never built or tested.
3. In each export run `cargo build --release --locked --offline` with `CARGO_TARGET_DIR` inside that export, with `RUSTFLAGS` and `CARGO_ENCODED_RUSTFLAGS` unset, and, for a release only, `KOGEN_CONTEXT_RELEASE_TAG=<tag>` and `KOGEN_CONTEXT_RELEASE_COMMIT=C`. A failed build fails the script.
4. Compare the two `target/release/kogen-context` files byte for byte (`cmp`). If they differ, fail with `<script>: builds of C in two directories differ`.
5. Run the first binary's `version`. For a release its line must end with `(tag <tag>, commit C)`, for the check with `(development build)`; otherwise fail with `<script>: the build does not report its version`.
6. In the first export run `cargo test --locked --offline --test corpus` with `KOGEN_CONTEXT_BIN` set to the absolute path of the first binary, so the fixture corpus tests of commit `C` run against the built binary. If they fail, fail with `<script>: fixture tests failed for C`, after the test output.

`<script>` is `release.sh` or `release-check.sh`. Every failure message above is one line on stderr, and every failure exits with status 1. A failure writes nothing under `target/kogen-context-release/`.

Probes on this host (x86_64 Linux, Rust 1.99.1) showed that two `cargo build --release --locked --offline` runs of `git archive HEAD` in two different directories give byte-identical binaries without path remapping, each build taking about 1 s, and that `cargo test --locked --offline --test corpus` passes inside such an export (symlinks and mtimes from `git archive` keep the corpus valid). A build that embeds `env!("CARGO_MANIFEST_DIR")` gives different binaries in the two directories, which is what step 4 must catch. Reproducibility on the Macs has not been observed; step 4 reports it on each Mac.

**`scripts/release.sh TAG`**

- Not exactly one argument: stderr `usage: scripts/release.sh TAG`, exit 2.
- `TAG` not matching `^[A-Za-z0-9._-]+$` (it becomes part of file names): stderr `release.sh: tag name must match [A-Za-z0-9._-]+: <TAG>`, exit 1. This check comes before the tag lookup.
- `refs/tags/<TAG>` missing in the repository: stderr `release.sh: no such tag: <TAG>`, exit 1. An annotated or a lightweight tag is peeled to its commit (`<TAG>^{commit}`); HEAD and the working tree do not matter.
- Otherwise the pipeline runs for the tag's commit `C`, with the tag. On success the script replaces the directory `target/kogen-context-release/<TAG>/` of the repository (under its top level, whatever `CARGO_TARGET_DIR` says) so that afterwards it holds exactly two files: the first binary copied as `kogen-context-<TAG>-<platform>`, executable (mode 0755), and `SHA256SUMS` holding exactly the line `<lowercase sha256 of that file>  kogen-context-<TAG>-<platform>` plus `\n` (the `sha256sum` format, two spaces). Earlier contents of that directory, such as an earlier release of the same tag, are removed; other tags' directories are untouched. The script then prints the content of `SHA256SUMS` on stdout and exits 0.

**`scripts/release-check.sh`**

- Any argument: stderr `usage: scripts/release-check.sh`, exit 2.
- Otherwise the pipeline runs for the commit of HEAD without a tag, so the binary is a development build. On success it prints exactly `release check passed: <platform> <lowercase sha256 of the built binary>` plus `\n` on stdout and exits 0. It writes no artifacts: it creates nothing under `target/kogen-context-release/`.

**README**

`README.md` gets a `## Release builds` section that states: run `scripts/release.sh TAG` on each of the four build hosts (the two Macs build `darwin-arm64`, lm and eu2 build `linux-x86_64`) from a local tag; the artifacts are `target/kogen-context-release/TAG/kogen-context-TAG-<platform>` and `target/kogen-context-release/TAG/SHA256SUMS`; `scripts/release-check.sh` is the CI-equivalent check of HEAD to run on each host; `kogen-context version` reports the tag and commit of a release build; `KOGEN_CONTEXT_BIN` makes the corpus test run a given binary; and it contains the sentence `Nothing is published and release tags are not pushed.` The "Current state" paragraph mentions the version command and the release scripts.

## Decisions
- Release builds for darwin-arm64 (the two Macs) and Linux (lm, eu2), each host building its own platform natively (source: request)
- A release builds a tagged commit, comes with checksums and the binary has a version command, so Kogen callers can run it as a process (source: request)
- A release script and a CI-equivalent check build the target and run the fixture tests against the built binary (source: request)
- No publication and no public tags: the scripts never create or push tags and the artifacts stay on the host under `target/` (source: request)
- No packaging for end users (source: request)

## Source comparison
- Reproducible release build of the binary: addressed by the pipeline's two builds in two directories with the byte comparison, by the scenario "The same tag gives byte-identical artifacts in another directory ..." and by the scenario outline "... fails on a commit whose build depends on its directory ...".
- For darwin-arm64 (the two Macs) and linux (lm, eu2): addressed by the platform mapping of step 1, with `linux-arm64` added because the request names no Linux architecture. Only `linux-x86_64` is exercised here; this host is x86_64 Linux. Cross-building another host's platform is omitted, because it would need the protected `rust-toolchain.toml` to list extra targets and its fixture tests could not run on the wrong OS.
- From a tagged commit: addressed by `scripts/release.sh TAG`, which builds `TAG^{commit}` from `git archive`, ignoring HEAD and the working tree (scenario "A release builds the tagged commit, not HEAD or the working tree"). The tag naming scheme is not set (the owner sets it later), so any local tag whose name is usable in a file name is accepted.
- With checksums: addressed by `SHA256SUMS` and the script's stdout.
- A version command: addressed by `kogen-context version`, which embeds the tag and commit in release builds. Its one-line plain text format is a shaping decision, given in the prose above.
- So Kogen callers can run it as a process: addressed by the scenario that runs the artifact on a golden request and compares the golden packet.
- Release script and CI-equivalent check that builds every target and runs the fixture tests against each built binary: addressed by `scripts/release.sh`, `scripts/release-check.sh` and `KOGEN_CONTEXT_BIN` in `tests/corpus.rs`; each host checks its own target. `.kogen/project.yaml` is protected and stays unchanged, so the check is a script, not a configured Kogen check.
- No publication or public tags until the owner sets the release scheme; artifacts stay on the hosts: addressed by scripts that never push, tag or upload, by artifacts under the Git-ignored `target/`, by the step that checks HEAD, status and tags are unchanged, and by the README sentence.
- Out of scope, packaging for end users: no installer, archive, Homebrew or distro package.
- Roadmap order after kontext-literal-search-bounded-reads: builds on the existing commands and the fixture corpus, and changes neither.

## Tests
- `kogen-context version` prints the development line, and `version` with an extra argument is the unchanged usage refusal: a new `tests/cli.rs` test (integration) and the acceptance scenarios "A development build reports its package version" and "The version command takes no further argument" (scenario)
- A release build reports its tag and commit: acceptance scenario "A release builds the tagged commit, not HEAD or the working tree" (scenario)
- `tests/corpus.rs` runs the binary that `KOGEN_CONTEXT_BIN` names, and the built binary when it is unset: acceptance scenario "The corpus test runs the binary that KOGEN_CONTEXT_BIN names" (integration) and the existing configured `cargo test --locked --offline` (existing)
- `scripts/release.sh TAG` builds the tag's commit, not HEAD or the working tree, writes the binary and `SHA256SUMS`, prints them, runs as a process on a golden request and leaves Git state unchanged: acceptance scenario "A release builds the tagged commit, not HEAD or the working tree" (scenario)
- The same tag in another directory gives byte-identical artifacts, and a release replaces that tag's earlier artifact directory: acceptance scenario "The same tag gives byte-identical artifacts in another directory ..." (scenario)
- The release script refuses a wrong argument count, a missing tag and a tag name unusable in file names, without artifacts: acceptance scenario outline "The release script refuses <case> without building" (scenario)
- `scripts/release-check.sh` checks HEAD, not the working tree, prints its line and writes no artifacts, and refuses arguments: acceptance scenarios "The release check builds HEAD ..." and "The release check takes no argument" (scenario)
- Both scripts fail without artifacts when the fixture tests fail against the built binary: acceptance scenario outline "<script> fails on a commit whose fixture tests fail ..." (scenario)
- Both scripts fail without artifacts when the two builds differ: acceptance scenario outline "<script> fails on a commit whose build depends on its directory ..." (scenario)
- The README documents the release builds: acceptance scenario outline "The README documents the release builds: <text>" (scenario)
- `search`, `read` and `request` are unchanged: the existing `tests/cli.rs`, `tests/contract.rs`, `tests/corpus.rs` and unit tests (existing)

## Feasibility
- Two `cargo build --release --locked --offline` runs of `git archive HEAD` in directories of different depth gave the same SHA-256 (`2c9971b2…`), about 0.9 s each, and `cargo test --locked --offline --test corpus` passed inside such an export. Inserting `eprintln!("{}", env!("CARGO_MANIFEST_DIR"))` (behind an environment check) at the start of `main` made the two builds differ (`7c60b577…` and `8e9d7c81…`). (scratch probes on this x86_64 Linux host; not observed on macOS)
- On the unchanged tree the acceptance copies, commits and tags build as intended; the scenarios fail on the missing `version` command (usage refusal, exit 2), the missing `scripts/release.sh` and `scripts/release-check.sh` (ENOENT) and on `tests/corpus.rs` ignoring `KOGEN_CONTEXT_BIN` (the stub run passed). (scratch run of three scenarios)
- evidence: {"id":"artifact-check","kind":"observer","inputs":["features/steps/k-context-release-binaries__check.js"],"observers":["features/steps/k-context-release-binaries__check.js"],"checks":[{"name":"good","command":"d=$(mktemp -d) && f=kogen-context-t1-linux-x86_64 && printf x > \"$d/$f\" && chmod 755 \"$d/$f\" && printf \"2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881  $f\\n\" > \"$d/SHA256SUMS\" && cp \"$d/SHA256SUMS\" \"$d.out\" && node features/steps/k-context-release-binaries__check.js artifacts \"$d\" t1 linux-x86_64 \"$d.out\"","exit":0,"output":"ok\n"},{"name":"bad","command":"d=$(mktemp -d) && f=kogen-context-t1-linux-x86_64 && printf x > \"$d/$f\" && chmod 755 \"$d/$f\" && printf \"0000000000000000000000000000000000000000000000000000000000000000  $f\\n\" > \"$d/SHA256SUMS\" && cp \"$d/SHA256SUMS\" \"$d.out\" && node features/steps/k-context-release-binaries__check.js artifacts \"$d\" t1 linux-x86_64 \"$d.out\"","exit":1,"output":"SHA256SUMS: expected \"2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881  kogen-context-t1-linux-x86_64\\n\", actual \"0000000000000000000000000000000000000000000000000000000000000000  kogen-context-t1-linux-x86_64\\n\"\nstdout: expected \"2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881  kogen-context-t1-linux-x86_64\\n\", actual \"0000000000000000000000000000000000000000000000000000000000000000  kogen-context-t1-linux-x86_64\\n\"\n"}]}
