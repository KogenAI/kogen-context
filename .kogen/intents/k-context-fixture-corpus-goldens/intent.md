# Add the fixture corpus and golden packet tests

Slug: k-context-fixture-corpus-goldens
Model: not applicable — the corpus and the goldens are static checked-in files, and the golden test is a stateless comparison of one `kogen-context request` run per golden; kogen-context stores nothing between runs
Acceptance:
- .kogen/intents/k-context-fixture-corpus-goldens/acceptance.feature
- features/steps/k-context-fixture-corpus-goldens__corpus.js
- features/steps/k-context-fixture-corpus-goldens__check.js

This Intent adds three things. A small checked-in fixture corpus under `tests/corpus/` holds a Go, a JS/TS and a Python checkout. Each is a few hundred lines with nested directories, a binary file, an oversized file and symlinks that point outside the checkout. Golden request and packet pairs under `tests/goldens/` cover literal search and bounded reads over that corpus. A new Rust integration test, `tests/corpus.rs`, runs the built binary as a process on every golden request and compares its stdout to the golden packet byte for byte. It checks that no run changes the corpus. It also has a test-only update path that rewrites the packets. The goldens cover scoping (nothing outside the selected root shows up in any output, and escaping reads are refused), bounded output (match and line limits, the `truncated` marker and text cuts) and read-only behavior (the corpus is unchanged after every run).

This is test and fixture work only. `src/` does not change: search, read, `kogen-context request`, the version 1 contract in `contract/` and the existing tests stay exactly as they are, and nothing is removed. No ranking, index, cache or other retrieval mechanism is added. Use only the Rust standard library and add no crates, because the checks run `--locked --offline`. The goldens are version 1 packets of `kogen-context request`. The unversioned `search` and `read` commands get no goldens; they share the same code, and `tests/cli.rs` already covers them.

**Ignored paths.** kogen-context skips symlinks, files that are not valid UTF-8 and every directory named `.git`. The corpus covers the first two with checked-in symlinks and binary files. A `.git` directory cannot be part of a checked-in corpus, because Git refuses to track any path component named `.git` (a probe showed `git add -A` silently leaves `c/.git/config` out, and `git update-index --add` fails with `error: Invalid path 'c/.git/config'`). So `.git` skipping stays covered by the existing `tests/cli.rs` test `search_orders_paths_bytewise_and_skips_unreadable_content`. The corpus contains no `.gitignore` or `.gitattributes` file. It uses only the file names listed below, which are not names commonly ignored by Git (no `node_modules`, `dist`, `build`, `__pycache__`, `*.pyc`, `.venv`, `*.log` or `.env`), so committing it records every file.

**Corpus (`tests/corpus/`)**

The directory holds exactly these regular files and symlinks, and nothing else apart from the directories that contain them:

```
go/assets/logo.png
go/go.mod
go/internal/report/format.go
go/internal/report/format_test.go
go/internal/report/rows_generated.go
go/leak.go -> ../outside/secret.txt
go/linked -> ../outside
go/main.go
js/leak.js -> ../outside/secret.txt
js/linked -> ../outside
js/package.json
js/public/favicon.ico
js/src/generated/catalog.js
js/src/index.js
js/src/lib/format.ts
js/test/format.test.js
outside/secret.txt
python/app/__init__.py
python/app/cli.py
python/app/data/fixtures.py
python/app/data/icon.png
python/app/report/__init__.py
python/app/report/format.py
python/leak.py -> ../outside/secret.txt
python/linked -> ../outside
python/pyproject.toml
python/tests/test_format.py
```

- The symlinks are relative, with exactly the targets shown. Each resolves into `tests/corpus/outside/`, which is outside the checkout (`tests/corpus/go`, `tests/corpus/js` or `tests/corpus/python`) that holds the symlink.
- `outside/secret.txt` is not a checkout. Its content is exactly the line `KOGEN_OUTSIDE_SENTINEL: FormatRow formatRow format_row` followed by `\n`. It contains each checkout's search literal, so a search that followed a symlink would report it.
- Each checkout is small, realistic source in its language: a tiny report formatter. Its regular UTF-8 files (symlinks not followed, the binary file not counted, a file's lines counted as kogen-context splits them) hold between 200 and 800 lines in total. `__init__.py` files may be empty.
- Go (`tests/corpus/go`): `main.go`, `internal/report/format.go` and `internal/report/format_test.go` each contain `FormatRow`. `internal/report/rows_generated.go` is the oversized file: at least 210 lines, at least 101 of which contain `Row{` (for example `\tRow{ID: 1, Name: "alpha"},`). Fewer than 101 lines of the checkout contain `FormatRow`. `assets/logo.png` is binary: it is not valid UTF-8 and contains the bytes `FormatRow`.
- JS/TS (`tests/corpus/js`): `src/index.js`, `src/lib/format.ts` and `test/format.test.js` each contain `formatRow`. `src/generated/catalog.js` is the oversized file: at least 210 lines, and its line 1 is longer than 500 characters and contains `formatRow`. Fewer than 101 lines of the checkout contain `formatRow`. `public/favicon.ico` is binary: not valid UTF-8 and contains the bytes `formatRow`.
- Python (`tests/corpus/python`): `app/cli.py`, `app/report/format.py` and `tests/test_format.py` each contain `format_row`. `app/data/fixtures.py` is the oversized file, with at least 210 lines. Fewer than 101 lines of the checkout contain `format_row`. `app/data/icon.png` is binary: not valid UTF-8 and contains the bytes `format_row`.

**Goldens (`tests/goldens/`)**

The directory holds exactly one `<name>.request.json` and one `<name>.packet.json` for each of these 26 goldens. Each request file holds the JSON given here: any formatting, one compact line plus `\n` recommended. Each request's `root` is relative to the repository root.

| golden | request |
| --- | --- |
| go-search | `{"version":1,"root":"tests/corpus/go","operation":"search","literal":"FormatRow"}` |
| go-search-nested-root | `{"version":1,"root":"tests/corpus/go/internal","operation":"search","literal":"FormatRow"}` |
| go-search-truncated | `{"version":1,"root":"tests/corpus/go","operation":"search","literal":"Row{"}` |
| go-search-outside | `{"version":1,"root":"tests/corpus/go","operation":"search","literal":"KOGEN_OUTSIDE_SENTINEL"}` |
| go-read-oversized | `{"version":1,"root":"tests/corpus/go","operation":"read","path":"internal/report/rows_generated.go","start":1,"end":200}` |
| go-read-file-symlink | `{"version":1,"root":"tests/corpus/go","operation":"read","path":"leak.go","start":1,"end":1}` |
| go-read-dir-symlink | `{"version":1,"root":"tests/corpus/go","operation":"read","path":"linked/secret.txt","start":1,"end":1}` |
| go-read-traversal | `{"version":1,"root":"tests/corpus/go","operation":"read","path":"../outside/secret.txt","start":1,"end":1}` |
| go-read-binary | `{"version":1,"root":"tests/corpus/go","operation":"read","path":"assets/logo.png","start":1,"end":1}` |
| js-search | `{"version":1,"root":"tests/corpus/js","operation":"search","literal":"formatRow"}` |
| js-search-limited | `{"version":1,"root":"tests/corpus/js","operation":"search","literal":"formatRow","limits":{"max_matches":3,"max_line_chars":20}}` |
| js-search-outside | `{"version":1,"root":"tests/corpus/js","operation":"search","literal":"KOGEN_OUTSIDE_SENTINEL"}` |
| js-read-oversized | `{"version":1,"root":"tests/corpus/js","operation":"read","path":"src/generated/catalog.js","start":1,"end":200}` |
| js-read-limited | `{"version":1,"root":"tests/corpus/js","operation":"read","path":"src/generated/catalog.js","start":1,"end":3,"limits":{"max_lines":3,"max_line_chars":40}}` |
| js-read-over-limit | `{"version":1,"root":"tests/corpus/js","operation":"read","path":"src/generated/catalog.js","start":1,"end":4,"limits":{"max_lines":3}}` |
| js-read-file-symlink | `{"version":1,"root":"tests/corpus/js","operation":"read","path":"leak.js","start":1,"end":1}` |
| js-read-dir-symlink | `{"version":1,"root":"tests/corpus/js","operation":"read","path":"linked/secret.txt","start":1,"end":1}` |
| js-read-binary | `{"version":1,"root":"tests/corpus/js","operation":"read","path":"public/favicon.ico","start":1,"end":1}` |
| python-search | `{"version":1,"root":"tests/corpus/python","operation":"search","literal":"format_row"}` |
| python-search-outside | `{"version":1,"root":"tests/corpus/python","operation":"search","literal":"KOGEN_OUTSIDE_SENTINEL"}` |
| python-read-oversized | `{"version":1,"root":"tests/corpus/python","operation":"read","path":"app/data/fixtures.py","start":2,"end":201}` |
| python-read-over-limit | `{"version":1,"root":"tests/corpus/python","operation":"read","path":"app/data/fixtures.py","start":1,"end":201}` |
| python-read-file-symlink | `{"version":1,"root":"tests/corpus/python","operation":"read","path":"leak.py","start":1,"end":1}` |
| python-read-dir-symlink | `{"version":1,"root":"tests/corpus/python","operation":"read","path":"linked/secret.txt","start":1,"end":1}` |
| python-read-traversal | `{"version":1,"root":"tests/corpus/python","operation":"read","path":"app/../../outside/secret.txt","start":1,"end":1}` |
| python-read-binary | `{"version":1,"root":"tests/corpus/python","operation":"read","path":"app/data/icon.png","start":1,"end":1}` |

Each `<name>.packet.json` is exactly the bytes that `kogen-context request` prints on stdout for the bytes of `<name>.request.json` when run from the repository root: one compact JSON line ending in `\n`. The packets are produced with the update path, not written by hand. With the corpus above, the existing behavior gives these outcomes, and acceptance checks them:
- `*-search-outside` is `{"version":1,"operation":"search","query":"KOGEN_OUTSIDE_SENTINEL","matches":[],"truncated":false,"limits":{"max_matches":100,"max_line_chars":500}}`. The sentinel exists only outside the roots, and no golden packet's match path, match text or line text contains it.
- The symlink and traversal reads give `{"version":1,"error":{"code":"path_outside_root","message":"path escapes the checkout root: <path>"}}`. The binary reads give `{"version":1,"error":{"code":"not_text","message":"file is not UTF-8 text: <path>"}}`. `js-read-over-limit` gives `line range 1-4 exceeds the 3-line read limit` and `python-read-over-limit` gives `line range 1-201 exceeds the 200-line read limit`, both with code `invalid_range`. All of these exit with status 1. The probe of the current binary showed these exact packets.
- The search goldens list only lines of regular files reached without a symlink. `leak.*`, `linked/` and the binary file never appear. `go-search-nested-root` lists exactly the `go-search` matches under `internal/`, with that prefix removed. `go-search-truncated` has exactly 100 matches and `"truncated":true`. `js-search-limited` lists the first 3 `js-search` matches cut to 20 characters, with `"truncated":true`. `js-search` includes the line 1 of `catalog.js`, cut to 500 characters.
- The read goldens hold exactly the requested lines of their file with `total_lines`, cut to the applied `max_line_chars`, and the applied limits.

**Golden test (`tests/corpus.rs`)**

A new Rust integration test file, run by `cargo test --locked --offline` and alone by `cargo test --locked --offline --test corpus`. It uses only the standard library. For every `*.request.json` in `tests/goldens/`, in sorted order, it:
1. records a snapshot of `tests/corpus/`. The snapshot walks every entry recursively without following symlinks and records each entry's repo-relative path, kind, modification time, the bytes of each regular file and the target of each symlink;
2. runs `env!("CARGO_BIN_EXE_kogen-context")` as `kogen-context request`, with the repository root (`env!("CARGO_MANIFEST_DIR")`) as working directory and the request file's bytes on stdin;
3. asserts that stderr is empty. It asserts that the exit status is 0 for a search or read packet, 2 for an error packet with code `invalid_request` or `unsupported_version`, and 1 for any other error packet;
4. compares stdout byte for byte with `<name>.packet.json`. A missing packet file fails;
5. takes the snapshot again and asserts that it equals the first one. A failure names the request file and the entry that changed.

Every failure message about a packet names it by its repo-relative path with `/` separators, for example `tests/goldens/go-search.packet.json`. On a mismatch it shows the expected and the actual bytes.

**Update path (test only)**

When the environment variable `KOGEN_CONTEXT_UPDATE_GOLDENS` is exactly `1`, the same test does steps 1 to 3 and 5, but writes the binary's stdout to `<name>.packet.json` (creating it if missing) instead of comparing. The command is `KOGEN_CONTEXT_UPDATE_GOLDENS=1 cargo test --locked --offline --test corpus`. With the variable unset or set to any other value, the test compares. The update path lives only in `tests/corpus.rs`: no flag, command or option is added to the binary.

**README**

`README.md` names `tests/corpus/` (the fixture corpus) and `tests/goldens/` (the golden requests and packets) in its source map. It also gives the update command `KOGEN_CONTEXT_UPDATE_GOLDENS=1 cargo test --locked --offline --test corpus`.

**What the tests do not prove.** They observe the binary's outputs and the corpus before and after each run. They do not trace file system access. "Nothing outside the selected root is read" is shown by the empty sentinel searches, by the absence of symlinked paths and the sentinel from every packet, and by the `path_outside_root` refusals.

## Decisions
- The corpus is checked in and contains a Go, a JS/TS and a Python checkout of a few hundred lines each, with nested directories, ignored paths, binary and oversized files, and symlinks pointing outside the root (source: request)
- The goldens are result packets of literal search and bounded reads over the corpus (source: request)
- Tests run the binary as a process on the corpus and compare the packets to the goldens byte for byte, with a test-only update path (source: request)
- The goldens cover scoping (nothing outside the selected root is read), bounded output (limits and truncation markers) and read-only behavior (the corpus is unchanged after every run) (source: request)
- No ranking or index mechanism is added (source: request)

## Source comparison
- Small checked-in corpus of Go, JS/TS and Python checkouts, a few hundred lines each: addressed by `tests/corpus/go`, `tests/corpus/js` (`.js` and `.ts` files) and `tests/corpus/python`, each holding 200 to 800 lines of UTF-8 text (scenarios "The corpus holds ..." and "The <checkout> checkout is a few hundred lines ...").
- Nested dirs: addressed (`internal/report/`, `src/lib/`, `src/generated/`, `app/report/`, `app/data/`), and the `go-search-nested-root` golden selects a nested root.
- Ignored paths: addressed for the paths kogen-context skips that Git can store, symlinks and non-UTF-8 files. `.git` directories cannot be checked in, because Git refuses the path (probe above), so `.git` skipping stays covered by the existing `tests/cli.rs`. Paths in ignore files are not "ignored paths" here: kogen-context has no ignore-file handling, and adding it would be a new mechanism. A `.gitignore` inside the corpus would also stop this repository from committing corpus files.
- Binary and oversized files: addressed by `assets/logo.png`, `public/favicon.ico` and `app/data/icon.png` (not UTF-8, containing the literal), and by `rows_generated.go`, `catalog.js` and `fixtures.py` (at least 210 lines, more than 100 `Row{` lines, and a line over 500 characters).
- Symlinks pointing outside the root: addressed by `leak.go`/`leak.js`/`leak.py -> ../outside/secret.txt` and `linked -> ../outside` in each checkout.
- Golden result packets for literal search and bounded reads: addressed by the 26 goldens in `tests/goldens/`, as version 1 packets of `kogen-context request`.
- Run the binary as a process and compare byte for byte: addressed by `tests/corpus.rs`, and in acceptance by "Every golden packet is exactly what kogen-context request prints ..." and the two `cargo test` scenarios in a copy of the repository.
- Test-only update path: addressed by `KOGEN_CONTEXT_UPDATE_GOLDENS=1`, handled only in `tests/corpus.rs`.
- Scoping: addressed by the `*-search-outside`, symlink, traversal and nested-root goldens, and by the sentinel check across all packets.
- Bounded output (limits and truncation markers): addressed by `go-search-truncated` (100 matches, `truncated` true), `js-search-limited` (caller limits), the 200-line reads, the over-limit reads and the 500- and 40-character cuts.
- Read-only behavior: addressed by the snapshot before and after every run, in `tests/corpus.rs` and in acceptance.
- Out of scope, ranking and index mechanisms: nothing in `src/` changes.
- Roadmap order after kontext-literal-search-bounded-reads: this builds on that behavior and on the version 1 contract, and changes neither.

## Tests
- The corpus has the required checkouts, files, sizes, binary and oversized files and escaping symlinks: acceptance scenarios "The corpus holds a Go, a JS/TS and a Python checkout ..." and outline "The <checkout> checkout is a few hundred lines ..." (integration)
- Each golden packet is exactly the binary's output for its request, with empty stderr and the contract's exit status, and no run changes the corpus: acceptance scenario "Every golden packet is exactly what kogen-context request prints ..." and the new `tests/corpus.rs` (integration)
- Scoping: searches skip symlinks and binary files, never report the outside sentinel and report paths relative to the selected root, and escaping reads are refused: acceptance scenarios "Searches never read outside the selected root ..." and "Reads through escaping symlinks or paths ..." (integration)
- Bounded output: 100-match truncation, caller match and line limits, 200-line reads, over-limit refusals and text cuts: acceptance scenario "Bounded output: match and line limits, truncation and text cuts" (integration)
- `cargo test` fails on a changed or missing golden packet with a message naming it, and `KOGEN_CONTEXT_UPDATE_GOLDENS=1` rewrites or creates it with the binary's exact output: acceptance scenarios "cargo test fails on a changed golden packet ..." and "cargo test fails on a missing golden packet ...", run in a copy of the repository (integration)
- The README names the corpus, the goldens and the update command: acceptance scenario "The README names the corpus, the goldens and the update command" (scenario)
- The existing search, read and request behavior is unchanged: the existing `tests/cli.rs`, `tests/contract.rs` and unit tests (existing)

## Feasibility
- Current-binary probe (scratch checkout, `kogen-context request` from its parent): the outside-sentinel search, the file-symlink, dir-symlink and traversal reads, the binary read and the over-limit reads print exactly the packets pinned above, with exit status 0 for the search and 1 for the refusals.
- Git probe: `git add -A` leaves `c/.git/config` out, `git update-index --add --cacheinfo ... c/.git/config` fails with `error: Invalid path 'c/.git/config'`, and a symlink `c/linked` is tracked with mode 120000.
- A clean `cargo test --locked --offline` in a fresh copy with its own target directory took about 1.5 s, so the copy-based acceptance scenarios are cheap.
- evidence: {"id":"search-packet-check","kind":"observer","inputs":["features/steps/k-context-fixture-corpus-goldens__check.js","contract/examples/search.packet.json","contract/examples/checkout/README.md","contract/examples/checkout/app.py","contract/examples/checkout/util.py"],"observers":["features/steps/k-context-fixture-corpus-goldens__check.js"],"checks":[{"name":"good","command":"node features/steps/k-context-fixture-corpus-goldens__check.js search contract/examples/checkout parse_config 100 500 false \"$(cat contract/examples/search.packet.json)\"","exit":0,"output":"ok\n"},{"name":"bad","command":"node features/steps/k-context-fixture-corpus-goldens__check.js search contract/examples/checkout parse_config 100 500 false '{\"version\":1,\"operation\":\"search\",\"query\":\"parse_config\",\"matches\":[{\"path\":\"README.md\",\"line\":3,\"column\":7,\"text\":\"Call parse_config to load settings.\"},{\"path\":\"app.py\",\"line\":1,\"column\":18,\"text\":\"from util import parse_config\"},{\"path\":\"app.py\",\"line\":3,\"column\":10,\"text\":\"CONFIG = parse_config(\\\"app.toml\\\")\"},{\"path\":\"util.py\",\"line\":1,\"column\":5,\"text\":\"def parse_config(path):\"}],\"truncated\":false,\"limits\":{\"max_matches\":100,\"max_line_chars\":500}}'","exit":1,"output":"match 1 (\"README.md\" line 3): column 7 is not the first occurrence 6\n"}]}
- evidence: {"id":"read-packet-check","kind":"observer","inputs":["features/steps/k-context-fixture-corpus-goldens__check.js","contract/examples/read.packet.json","contract/examples/checkout/README.md","contract/examples/checkout/app.py","contract/examples/checkout/util.py"],"observers":["features/steps/k-context-fixture-corpus-goldens__check.js"],"checks":[{"name":"good","command":"node features/steps/k-context-fixture-corpus-goldens__check.js read contract/examples/checkout util.py 1 2 200 500 \"$(cat contract/examples/read.packet.json)\"","exit":0,"output":"ok\n"},{"name":"bad","command":"node features/steps/k-context-fixture-corpus-goldens__check.js read contract/examples/checkout util.py 1 2 200 500 '{\"version\":1,\"operation\":\"read\",\"path\":\"util.py\",\"start\":1,\"end\":2,\"total_lines\":2,\"lines\":[{\"line\":1,\"text\":\"def parse_config(path):\"},{\"line\":2,\"text\":\"    return open(path).read\"}],\"limits\":{\"max_lines\":200,\"max_line_chars\":500}}'","exit":1,"output":"lines[1]: expected {\"line\":2,\"text\":\"    return open(path).read()\"}, actual {\"line\":2,\"text\":\"    return open(path).read\"}\n"}]}
- evidence: {"id":"first-matches-check","kind":"observer","inputs":["features/steps/k-context-fixture-corpus-goldens__check.js","contract/examples/search.packet.json","contract/examples/search-limited.packet.json"],"observers":["features/steps/k-context-fixture-corpus-goldens__check.js"],"checks":[{"name":"good","command":"node features/steps/k-context-fixture-corpus-goldens__check.js first \"$(cat contract/examples/search-limited.packet.json)\" 2 12 \"$(cat contract/examples/search.packet.json)\"","exit":0,"output":"ok\n"},{"name":"bad","command":"node features/steps/k-context-fixture-corpus-goldens__check.js first \"$(cat contract/examples/search-limited.packet.json)\" 2 11 \"$(cat contract/examples/search.packet.json)\"","exit":1,"output":"match 1: expected {\"path\":\"README.md\",\"line\":3,\"column\":6,\"text\":\"Call parse_\"}, actual {\"path\":\"README.md\",\"line\":3,\"column\":6,\"text\":\"Call parse_c\"}\nmatch 2: expected {\"path\":\"app.py\",\"line\":1,\"column\":18,\"text\":\"from util i\"}, actual {\"path\":\"app.py\",\"line\":1,\"column\":18,\"text\":\"from util im\"}\n"}]}
