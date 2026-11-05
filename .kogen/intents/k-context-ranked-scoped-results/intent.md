# Add task-ranked search order to kogen-context

Slug: k-context-ranked-scoped-results
Model: not applicable — every `kogen-context request` run is stateless (one request in, one packet out, nothing stored between runs), the ranked order is a pure function of the request and the checkout's files, and the replay script keeps nothing after it exits
Acceptance:
- .kogen/intents/k-context-ranked-scoped-results/acceptance.feature
- features/steps/k-context-ranked-scoped-results__steps.js
- features/steps/k-context-ranked-scoped-results__trace.js

A version 1 search request may now carry an optional `"order"` member. With `"order": "ranked"`, `kogen-context request` considers every matching line of the checkout, ranks the lines so that the code that owns the behaviour (definitions and call sites in source files) comes before other source lines, tests, generated code, comments, docs and other files, and returns the first `max_matches` of that ranking. With `"order": "path"` or without `"order"`, the packet is byte for byte the current version 1 packet in path order. This is the expand step of expand-then-contract: the field is added, version 1 keeps working unchanged, and nothing is removed. The packet format, the packet schema, the read operation, the error codes and messages, and the unversioned `kogen-context search ROOT LITERAL` and `kogen-context read ROOT PATH START END` commands do not change. No option, flag or command is added to the binary besides the request member. Use only the Rust standard library and add no crates (`--locked --offline`).

The change also adds checked-in ranking fixtures with golden requests and packets under `tests/ranking/`, a Rust golden test `tests/ranking.rs`, and `scripts/crane-replay.sh`, which fetches two pinned public Crane revisions and records the rank of every match of a fixed list of hints in both orders. Crane source is fetched only by that script, at its run time, into a temporary directory; nothing of it is checked in.

**Request member `order` (search only)**

- Allowed on `"operation": "search"` requests, next to `version`, `root`, `operation`, `literal` and `limits`. Its value must be exactly the string `"path"` or `"ranked"`. Absent means `"path"`.
- Any other value (another string such as `"rank"`, `"RANKED"` or `""`, a number, `null`, an array), `order` on a read request (whatever its value), and `order` inside `limits` are schema violations: error packet `{"version":1,"error":{"code":"invalid_request","message":"request does not match the version 1 request schema"}}`, exit status 2. The existing check order stays: invalid JSON first, then the version (`{"version":2,...,"order":"ranked"}` is still `unsupported_version` with `request version must be 1`), then the schema.
- The packet is the version 1 search packet as now, with the same members in the same order, the applied `limits` and no new member. Only the order of `matches`, and with `ranked` which lines fill the cap, depend on `order`.

**Ranked order**

The searchable files, the matching lines, `column` (1-based character position of the first occurrence of the literal in the full line), `text` (the first `max_line_chars` characters of the line) and the line splitting are exactly those of the path order: regular UTF-8 files under the root reached without following symlinks, every directory named `.git` skipped, one match per matching line. A ranked search reads every searchable file, sorts all matching lines by the key below and returns the first `max_matches`. `truncated` is `true` exactly when the checkout has more matching lines than `max_matches` (the same meaning as now). It may keep only the best `max_matches` candidates while it scans; the output stays bounded by `max_matches` and `max_line_chars` as before. Every classification below uses the match's path relative to the selected root (as reported in `path`) and the full line, never the cut text.

File class. Let the name be the last path component. Its extension is the part after its last `.`, ASCII-lowercased, when the name has a `.` after its first character; otherwise it has none. The source extensions are: `c cc cpp cxx h hh hpp hxx m mm cs go rs zig py pyi js mjs cjs jsx ts mts cts tsx java kt kts scala swift rb php lua pl pm sh bash zsh fish ps1 ex exs erl hs ml mli dart r jl nim sql`.
- `other`: the extension is not a source extension, or there is none (for example `.md`, `.txt`, `.json`, `.toml`, `Makefile`).
- `generated`: a source extension, and a directory component of the path is exactly `generated`, or one of the file's first five lines contains `DO NOT EDIT` or `@generated` (a marker on line 6 or later does not count).
- `test`: a source extension, not generated, and splitting the ASCII-lowercased name at every `.`, `_` and `-` gives a part equal to `test`, `tests` or `spec` (`format_test.go`, `test_format.py`, `format.test.js`, `app.spec.ts`). Directories do not make a file a test: `tests/runner/main.zig` is a source file.
- `source`: every other file with a source extension.

Line kind, for lines of `source`, `test` and `generated` files. `before` is the text of the line before the first occurrence of the literal, `after` the text after that occurrence. The comment marker is `#` for the extensions `py pyi rb sh bash zsh fish pl pm r jl ex exs nim ps1`, `--` for `lua sql hs`, and `//` for every other source extension.
- `comment`: `before` contains the comment marker; or, for an extension whose marker is not `#`, the line with its leading spaces and tabs removed starts with `/*` or `*`.
- `definition`: not a comment; `before` ends with at least one space or tab; with those trailing spaces and tabs removed, the run of ASCII letters at its end is one of the keywords `fn func def function class struct enum union interface trait type const let var val impl mod module macro` and stands at the start of the line or right after a space or tab; and `after` is empty or does not start with an ASCII letter, digit or `_`. So `pub fn spinUntil(`, `def spin():` and `const gen_snapshot = ...` are definitions, while `var spinning = ...` (searching `spin`), `func FormatRows(` (searching `FormatRow`) and `writeAll("fn spin(` are not.
- `call`: neither of the above, and `after` with its leading spaces and tabs removed starts with `(`.
- `reference`: every other line.

Tier: 0 a definition in a source file; 1 a call in a source file; 2 a reference in a source file; 3 a definition, call or reference in a test file; 4 a definition, call or reference in a generated file; 5 a comment line in a source, test or generated file; 6 any line of an other file. The ranked order sorts by tier, then by path compared bytewise, then by line number. The acceptance scenario on the checkout `kinds` pins every rule above, with its exact expected order.

**Unchanged path order and contract**

Without `order` or with `"order": "path"`, a search keeps the current behaviour: matches in bytewise path order, then line order, scanning stopping after `max_matches` + 1 matching lines. The contract examples, the golden packets in `tests/goldens/` and the corpus in `tests/corpus/` stay byte for byte as they are, and `tests/cli.rs`, `tests/contract.rs` and `tests/corpus.rs` keep passing unchanged.

`contract/request.schema.json` gains, in `$defs.search.properties`, exactly:

```json
"order": {
  "description": "The order of the matches. \"path\", the default, sorts them by path, then line. \"ranked\" lists definitions and call sites in source code first and docs and other files last.",
  "enum": ["path", "ranked"]
}
```

The rest of the file stays as it is (the acceptance scenario holds the whole expected JSON). `contract/packet.schema.json` and `contract/examples/` do not change. `contract/README.md` documents the member: its two values `"path"` and `"ranked"` (writing them with their quotes), that `"path"` is the default, a short statement of the ranked tiers, and that this is an added optional field: version 1 requests without it behave exactly as before. It keeps saying that the request search behaves like the unversioned `kogen-context search`, now for the path order.

**Ranking fixtures and golden test**

`tests/ranking/` holds exactly these files, with exactly the contents the acceptance scenarios give for the fixture files:

```
goldens/repl-path.packet.json
goldens/repl-path.request.json
goldens/repl-ranked.packet.json
goldens/repl-ranked.request.json
goldens/wpt-path.packet.json
goldens/wpt-path.request.json
goldens/wpt-ranked.packet.json
goldens/wpt-ranked.request.json
repl/README.md
repl/docs/event-loop.md
repl/docs/lessons/console-waits.md
repl/src/loop.zig
repl/tests/loop_test.zig
repl/tools/repl.zig
wpt/docs/lessons/stream-names.md
wpt/docs/sweep.md
wpt/tests/runner/main.zig
wpt/tests/runner/options_test.zig
wpt/tools/site/render.py
```

- `repl/` mirrors the Crane REPL shape: the owning call `tools/repl.zig:13` of `spinUntil` sorts after 13 doc and test matches. In path order the 12-match packet holds only docs and `src/loop.zig`; ranked, the definition `src/loop.zig:7` is first and the call second.
- `wpt/` mirrors the WPT shared-queue shape: the runner's owning line `tests/runner/main.zig:9` for `journal.shard` lives under `tests/` in a file not named as a test, and sorts after 13 doc matches. In path order the packet holds only docs; ranked, it is first, ahead of the report renderer `tools/site/render.py`, the test file and the docs.
- The golden requests are exactly (any formatting; one compact line plus `\n` recommended): `repl-path` `{"version":1,"root":"tests/ranking/repl","operation":"search","literal":"spinUntil","limits":{"max_matches":12}}`, `repl-ranked` the same with `"order":"ranked"`, `wpt-path` `{"version":1,"root":"tests/ranking/wpt","operation":"search","literal":"journal.shard","limits":{"max_matches":12}}`, and `wpt-ranked` the same with `"order":"ranked"`. Each `<name>.packet.json` is exactly what `kogen-context request` prints on stdout for its request from the repository root; the acceptance scenarios pin those packets match by match.
- `tests/ranking.rs` is a new integration test using only the standard library: for every `tests/ranking/goldens/*.request.json`, in sorted order, it runs `env!("CARGO_BIN_EXE_kogen-context")` as `kogen-context request` from `env!("CARGO_MANIFEST_DIR")` with the request bytes on stdin, asserts exit status 0 and empty stderr, and compares stdout byte for byte with `<name>.packet.json`. A failure names the packet by its repo-relative path and shows the expected and actual bytes. Adding `tests/ranking/` must not change `tests/corpus/` or `tests/goldens/`.

**Replay script `scripts/crane-replay.sh`**

A POSIX `sh` script in the style of the release scripts, executable (mode 755) and runnable as `sh scripts/crane-replay.sh BINARY`. It needs `git`, `tar`, `python3` and network access to GitHub; it is the only part of this repository that uses the network, and kogen-context itself never does.

- Arguments: exactly one, the path of a `kogen-context` binary. Any other argument count prints exactly `usage: scripts/crane-replay.sh BINARY` and a newline on stderr, nothing on stdout, and exits 2, before fetching anything.
- It makes one directory with `mktemp -d` (so under `TMPDIR` when set) and removes it when it exits, on success and on failure. It writes nothing anywhere else, and in particular nothing in the repository.
- Revisions, in this order: `adc2ea58b65af01f112e0fa4cfd91520cb78a766` (label `adc2ea58b65`) and `b41782ab61da93c80ca6c0fa8c83ff3ceb5ac99c` (label `b41782ab61d`) of `https://github.com/zig-whatwg/crane.git`. It fetches each commit by id with `git fetch --depth 1` into a repository it initialises inside its temporary directory, checks that the commit exists under that exact id, and exports the commit's tracked files with `git archive` into its own directory `<tmp>/<full id>`, the checkout root of the requests (no `.git` inside).
- Hints, in this order: `spinEventLoopUntil`, `evaluateReplScript`, `journal.shard`, `wptreport.jsonl`, `cleanup`, `gen_snapshot`, `constructorCallback`.
- For each revision, each hint, and then each order `path` and `ranked`, it sends `{"version":1,"root":"<absolute export directory>","operation":"search","literal":"<hint>","limits":{"max_matches":12},"order":"<order>"}` to `BINARY request` and prints one record per match, in packet order: `<label>\t<order>\t<hint>\t<rank>\t<path>:<line>` and a newline, `<rank>` counting from 1. It prints nothing else on stdout. It reads each packet with `python3`'s `json` module.
- It exits 0 after the last record. If a fetch, the commit check, an export or a request fails (non-zero exit or no search packet), it prints a message starting with `crane-replay.sh: ` on stderr and exits 1.
- It records ranks only; the acceptance scenario judges them.

**README**

`README.md` names `tests/ranking/` (the ranking fixtures and their goldens) and `scripts/crane-replay.sh` in its source map, says how to run the replay (`sh scripts/crane-replay.sh target/debug/kogen-context`, which needs network access, `git`, `tar` and `python3`), and keeps its statement that the release scripts never contact a remote, noting that the replay script is the exception. The "Current state" text mentions the ranked order of `kogen-context request`.

**What the tests do not prove.** The strace scenario observes the system calls of the real binary on the checked-in fixtures: no network call, no other program, no file opened for writing or changed, no file opened outside the root except the dynamic loader's and the Rust runtime's system files. It does not prove those properties for every input. The Crane scenario proves the ranks on the two pinned revisions and the seven hints only.

## Decisions
- The code that owns a hint's behaviour (definitions and call sites in source) ranks within the cap ahead of docs, generated code and tests, without manual scoping (source: request)
- Output stays deterministic and bounded: same input, same bytes, and the contract limits still hold (source: request)
- The contract change goes through `contract/` as expand-then-contract: an optional `order` member is added to version 1 search requests, version 1 requests without it behave exactly as before, and nothing is removed (source: request)
- Ranking is opt-in through `"order": "ranked"` so that version 1 keeps working: the default stays the path order, and existing callers, goldens and examples keep their bytes (source: request)
- Checked-in fixtures reproduce the shape of an owning call site whose path sorts after more than 12 doc and test matches, with golden tests, and a replay script against the two pinned public Crane revisions records ranks (source: request)
- Read-only, scoped to the selected checkout, no network at run time; Crane source is fetched by the replay script only and is not vendored (source: request)

## Source comparison
- Results come back in path order and the cap cuts them: addressed by `"order": "ranked"` (ranked order rules above; scenarios "A ranked search lists definitions, then calls ..." and the two fixture scenarios). Path order stays the default and is pinned by "Without order, or with order \"path\" ..." and the contract-examples scenario.
- `spinEventLoopUntil`: the 12-match packet has the `tools/repl.zig` call at :367 before but only the comment at :30 after, and the terminal-lifetime call is missing in both trees: the Crane scenario pins, in path order, :367 listed and :1778 not listed on `adc2ea58b65`, :457 and :1932 not listed on `b41782ab61d`; ranked, all four calls are listed.
- `evaluateReplScript` gives no `tools/repl.zig` match; scoping to `tools/` recovers :835 / :928 and the loop :1778 / :1932: ranked lists `tools/repl.zig:835` and `tools/repl.zig:928` without scoping, and the loop lines through the `spinEventLoopUntil` rows.
- `cleanup` returns only docs and general text: the replay records `cleanup` in both orders; the scenario checks that all 12 path-order records are `.md` files and all 12 ranked records are `.zig` source files.
- WPT shared-queue hints, where docs and report renderers fill the cap and the scheduler code never appears: the request names no hint literals, so this Intent uses `journal.shard` and `wptreport.jsonl`, chosen by inspecting both pinned trees: in path order docs fill all 12 slots and the runner's owning lines `tests/wpt_runner/main.zig:2091` / `:2116` (the shard scheduler's journal path in `runShardsInParallel`) and `tests/wpt_runner/options.zig:217` (the result stream path) are not listed; ranked, they are listed. The `wpt/` fixture reproduces the shape locally.
- Paired Sonnet 5.5 navigation runs: background evidence for the need; nothing to build.
- Same input, same bytes; contract limits still hold: scenario "A ranked search prints the same bytes on every run ..." (repeat run and reverse creation order), and the limits/truncated scenario (`max_matches` 21 and 20 at the 21-match boundary, `max_matches` 4 with `max_line_chars` 6).
- Acceptance on the REPL and WPT hints on both pinned revisions, and the cases that already work (`gen_snapshot` → `build.zig`, `constructorCallback` → its definition `src/runtime/engines/v8/interface.zig:5852`): the Crane scenario, with `build.zig:4407` / `build.zig:4761` and `interface.zig:5852` listed in both orders.
- Golden tests with checked-in fixtures, plus a replay script against the two pinned public Crane revisions that records ranks: `tests/ranking/`, `tests/ranking.rs` and `scripts/crane-replay.sh` above.
- Contract changes through `contract/` as expand-then-contract: the optional `order` member in `contract/request.schema.json` and `contract/README.md`. This supersedes the pin in the earlier Intent `k-context-cli-contract` that `contract/request.schema.json` holds exactly its first version 1 JSON; its other pins (examples, packet schema, refusals) stay true.
- The earlier Intent `k-context-fixture-corpus-goldens` excluded ranking from its own scope; this Intent adds ranking without touching `tests/corpus/` or `tests/goldens/`.
- Rust per `rust-toolchain.toml` and the configured checks (fmt, clippy `-D warnings`, test, build, `--locked --offline`) stay green: no crates are added and `rust-toolchain.toml` (protected) is not changed.
- Read-only, scoped to the selected checkout, no network at run time (the cause of the previous attempt's refusal): scenario "A ranked search reads only inside its root, writes nothing, runs no other program and makes no network call" runs the real binary under strace on `tests/corpus/go` (with its escaping symlinks and binary file), the outside sentinel and the REPL fixture, and checks that `tests/corpus` and `tests/ranking` are unchanged. The kinds scenario checks that a symlink to a file outside the checkout and a binary file never appear.
- Crane source is fetched by the replay script only and is not vendored: the replay runs with a fresh `TMPDIR` that is empty again afterwards, the repository is unchanged by the replay, and no file of the repository outside `tests/ranking/` ends in `.zig`.
- Related `kontext-ranked-lexical-lookup` (blocked on Lab verification): not consumed and not waited on; this Intent is driven by the Crane probe.

## Tests
- The `order` member: absent and `"path"` give the version 1 path-order packet, `"ranked"` the ranked one; other values, `order` on read requests and inside `limits` are refused with `invalid_request`, and the version check still comes first: unit tests in `src/request.rs` (extend the parse and `schema_violations_are_refused` tests) and the scenario outline "order is \"path\" or \"ranked\" ..." (unit)
- File class, line kind and tier rules, and the sort by tier, bytewise path and line: unit tests of the classification and of the ranked order through a callable function in `src/`, with one case per class, kind, comment marker family, the five-line generated boundary and the keyword boundaries; and the kinds scenario through `kogen-context request` (unit)
- A ranked search returns the first `max_matches` of the whole ranking, cuts text to `max_line_chars`, and sets `truncated` exactly when more matching lines exist: limits scenario at the 21/20 boundary and with 4 and 6 (scenario)
- The ranked order is deterministic: determinism scenario (scenario)
- Without `order` or with `"path"`, packets stay byte-identical: path-order scenario, contract-examples scenario, and the existing `tests/cli.rs`, `tests/contract.rs` and `tests/corpus.rs` (existing)
- The checked-in fixtures reproduce the cut in path order and the owning lines rank within the cap, and each golden packet is the binary's output: new `tests/ranking.rs` and the fixture and golden scenarios (integration)
- A ranked search stays read-only, inside its root, runs no other program and makes no network call: strace scenario on the real binary (integration)
- The replay script's usage refusal, and on both pinned Crane revisions its records and the ranks of the owning lines in both orders: replay scenarios (integration)
- The request schema, contract README and README document the change: documentation scenario (scenario)

## Feasibility
- Reproduced the problem with the current binary (HEAD `da48a46`, the `fad0cba` code): over `git archive` exports of both pinned Crane commits (9,326 files, about 1.46M lines of Zig), 12-match path-order packets match the request's evidence exactly (`spinEventLoopUntil`: `tools/repl.zig:367` at rank 11 before, only the `:30` comment after, `:1778`/`:1932` never; `evaluateReplScript` without any `tools/repl.zig` match; `cleanup`, `journal.shard` and `wptreport.jsonl` with docs filling the cap; `gen_snapshot` `build.zig:4407`/`:4761` at rank 1 and `constructorCallback` `interface.zig:5852` at rank 5).
- A scratch Python model of exactly the ranked rules above (outside the repository; not a deliverable) over both trees ranks `tools/repl.zig:367`/`:1778` at 2/3 before and `:457`/`:1932` at 2/3 after, `evaluateReplScript` `:835`/`:928` at 8, `journal.shard` and `wptreport.jsonl` owning lines at 1, `gen_snapshot` and `constructorCallback` definitions at 1, and 12 `.zig` lines for `cleanup`. Its match sets equal the binary's on every fixture, and its orders produced the expected tables in the acceptance feature.
- A path-order search over a whole Crane tree takes about 1 s with the debug binary; a depth-1 fetch of one pinned commit takes about 11 s.
- The Crane-replay steps were run in a scratch copy against a stand-in replay that printed the binary's path order and the model's ranked order: all steps passed; with path order in place of the ranked records, the owning-lines step failed on exactly the nine expected rows.
- The network control runs bash with `--norc --noprofile`, `HOME=/` and `SHELL=/bin/sh`, so that no startup file and no user lookup depend on the environment (readiness showed `/etc/bash.bashrc`, `~/.bashrc`, `/etc/nsswitch.conf` and `/etc/passwd` opens otherwise); the same output was observed with the shell's environment and with an emptied one.
- evidence: {"id":"strace","kind":"capability","inputs":[],"observers":[],"checks":[{"name":"support","command":"strace -f -qq -o /dev/null true","exit":0,"output":""}]}
- evidence: {"id":"crane-fetch","kind":"capability","inputs":[],"observers":[],"checks":[{"name":"support","command":"d=$(mktemp -d) && git -C \"$d\" init -q && git -C \"$d\" fetch -q --depth 1 https://github.com/zig-whatwg/crane.git adc2ea58b65af01f112e0fa4cfd91520cb78a766 b41782ab61da93c80ca6c0fa8c83ff3ceb5ac99c && git -C \"$d\" rev-parse 'adc2ea58b65af01f112e0fa4cfd91520cb78a766^{commit}' 'b41782ab61da93c80ca6c0fa8c83ff3ceb5ac99c^{commit}'; s=$?; rm -rf \"$d\"; exit $s","exit":0,"output":"adc2ea58b65af01f112e0fa4cfd91520cb78a766\nb41782ab61da93c80ca6c0fa8c83ff3ceb5ac99c\n"}]}
- evidence: {"id":"trace-scope","kind":"observer","inputs":["features/steps/k-context-ranked-scoped-results__trace.js","tests/goldens/go-search.request.json","tests/corpus/go/main.go","tests/corpus/outside/secret.txt"],"observers":["features/steps/k-context-ranked-scoped-results__trace.js"],"checks":[{"name":"good","command":"node features/steps/k-context-ranked-scoped-results__trace.js tests/corpus/go tests/goldens/go-search.request.json -- sh -c ': < tests/corpus/go/main.go'","exit":0,"output":"ok\n"},{"name":"bad","command":"node features/steps/k-context-ranked-scoped-results__trace.js tests/corpus/go tests/goldens/go-search.request.json -- sh -c ': < tests/corpus/go/leak.go'","exit":1,"output":"opened outside the root: tests/corpus/go/leak.go -> tests/corpus/outside/secret.txt\n"}]}
- evidence: {"id":"trace-write","kind":"observer","inputs":["features/steps/k-context-ranked-scoped-results__trace.js","tests/goldens/go-search.request.json","tests/corpus/go/main.go"],"observers":["features/steps/k-context-ranked-scoped-results__trace.js"],"checks":[{"name":"good","command":"node features/steps/k-context-ranked-scoped-results__trace.js tests/corpus/go tests/goldens/go-search.request.json -- sh -c ': < tests/corpus/go/main.go'","exit":0,"output":"ok\n"},{"name":"bad","command":"node features/steps/k-context-ranked-scoped-results__trace.js tests/corpus/go tests/goldens/go-search.request.json -- sh -c ': > /dev/null'","exit":1,"output":"opened for writing: /dev/null\n"}]}
- evidence: {"id":"trace-exec","kind":"observer","inputs":["features/steps/k-context-ranked-scoped-results__trace.js","tests/goldens/go-search.request.json","tests/corpus/go/main.go"],"observers":["features/steps/k-context-ranked-scoped-results__trace.js"],"checks":[{"name":"good","command":"node features/steps/k-context-ranked-scoped-results__trace.js tests/corpus/go tests/goldens/go-search.request.json -- sh -c ': < tests/corpus/go/main.go'","exit":0,"output":"ok\n"},{"name":"bad","command":"node features/steps/k-context-ranked-scoped-results__trace.js tests/corpus/go tests/goldens/go-search.request.json -- sh -c '/bin/true; true'","exit":1,"output":"ran another program: /bin/true\n"}]}
- evidence: {"id":"trace-network","kind":"observer","inputs":["features/steps/k-context-ranked-scoped-results__trace.js","tests/goldens/go-search.request.json","tests/corpus/go/main.go"],"observers":["features/steps/k-context-ranked-scoped-results__trace.js"],"checks":[{"name":"good","command":"node features/steps/k-context-ranked-scoped-results__trace.js tests/corpus/go tests/goldens/go-search.request.json -- sh -c ': < tests/corpus/go/main.go'","exit":0,"output":"ok\n"},{"name":"bad","command":"HOME=/ SHELL=/bin/sh LC_ALL=C node features/steps/k-context-ranked-scoped-results__trace.js tests/corpus/go tests/goldens/go-search.request.json -- bash --norc --noprofile -c 'exec 3<>/dev/tcp/127.0.0.1/1'","exit":1,"output":"network call: connect\nnetwork call: socket\nopened for writing: /dev/tty\n"}]}
