# Add the versioned request and packet contract

Slug: k-context-cli-contract
Model: not applicable — each `kogen-context request` run is a stateless, read-only query: one request in, one packet out, nothing stored between runs
Acceptance:
- .kogen/intents/k-context-cli-contract/acceptance.feature
- features/steps/k-context-cli-contract__cli.js
- features/steps/k-context-cli-contract__schema.js

Callers run `kogen-context` as a separate read-only process, so they get a stable, versioned contract: a new command, `kogen-context request`, reads one version 1 JSON request on standard input and writes one version 1 JSON packet on standard output. A new `contract/` directory publishes the JSON Schemas of the request and the packet, example requests with the binary's real packets for them, a fixture checkout that the examples run against, and a README. A new Rust integration test, `tests/contract.rs`, runs the binary on every example and checks that its real output validates against the packet schema.

The search and read behavior is the one that already exists: the same file selection, matching, ordering, line splitting, path handling and refusals. This Intent adds no retrieval mechanism, index, placement, cache or ranking, and makes no change to how files are found. The existing `kogen-context search ROOT LITERAL` and `kogen-context read ROOT PATH START END` commands stay byte-for-byte unchanged: same unversioned output, the same refusals on stderr, the same exit statuses and the same usage message. Nothing is removed.

Use only the Rust standard library: add no crates (the checks run `--locked --offline` and no crate registry is available). The request JSON parser in `src/` and the JSON parser and schema validator in `tests/contract.rs` are written by hand.

**Invocation**

`kogen-context request` with no further argument. Any further argument (for example `kogen-context request extra`) is the existing usage refusal: stdout empty, stderr `{"error":{"code":"usage","message":"usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"}}` plus `\n`, exit status 2. The command reads standard input to its end.

**Output of `kogen-context request`**

- Every outcome, success or refusal, is exactly one packet on stdout: one compact JSON object (no spaces or newlines between tokens) with its keys in the order given below, followed by one `\n`. stderr stays empty.
- Exit status 0 for a search or read packet, 2 for an error packet with code `invalid_request` or `unsupported_version`, 1 for an error packet with any other code.
- JSON strings are escaped exactly like the existing commands (the existing `json_string`, byte-identical to JavaScript `JSON.stringify`). Paths are relative to the canonicalized root, `/`-separated, never starting with `./`, as in the existing commands.
- Search packet: `{"version":1,"operation":"search","query":LITERAL,"matches":[{"path":P,"line":L,"column":C,"text":T},...],"truncated":B,"limits":{"max_matches":M,"max_line_chars":X}}`.
- Read packet: `{"version":1,"operation":"read","path":P,"start":S,"end":E,"total_lines":N,"lines":[{"line":S,"text":T},...,{"line":E,"text":T}],"limits":{"max_lines":L,"max_line_chars":X}}`.
- Error packet: `{"version":1,"error":{"code":CODE,"message":MESSAGE}}`.
- `limits` always reports the limits that were applied: the request's value, or the default when the request leaves it out.

**Request (version 1)**

A search request is `{"version":1,"root":ROOT,"operation":"search","literal":LITERAL}` with an optional `"limits":{"max_matches":M,"max_line_chars":X}`; a read request is `{"version":1,"root":ROOT,"operation":"read","path":PATH,"start":S,"end":E}` with an optional `"limits":{"max_lines":L,"max_line_chars":X}`. Members may appear in any order. ROOT is the checkout root, absolute or relative to the working directory of the process. Each member of `limits` is optional: `max_matches` is 1 to 100 (default 100), `max_lines` is 1 to 200 (default 200), `max_line_chars` is 1 to 500 (default 500). `contract/request.schema.json` is the exact definition.

Checks, in this order (the first failing one wins):
1. Standard input is not exactly one JSON value (RFC 8259) in UTF-8, optionally surrounded by JSON whitespace, or that value is not an object. This includes empty input, invalid UTF-8, syntax errors, content after the value, a `\u` escape that is a lone surrogate, and an object anywhere in the value with two members of the same name. Error code `invalid_request`, message `request is not one valid JSON object`.
2. The object has no member `version`, or its value is not the number written `1` (for example `2`, `"1"` or `1.0`): code `unsupported_version`, message `request version must be 1`.
3. The object does not match `contract/request.schema.json`: a required member is missing, a member has the wrong type or is out of range, `literal`, `root` or `path` is empty, `operation` is neither `search` nor `read`, or there is a member that the schema does not allow (at the top level or in `limits`, including a limit of the other operation such as `max_lines` in a search request). Here an integer is a JSON number written without a fraction or an exponent: `1.5`, `1.0` and `1e2` are not integers. `start` and `end` have no upper bound; values beyond what fits are handled as the existing read handles them (they saturate). Code `invalid_request`, message `request does not match the version 1 request schema`.
4. Then, for a search request: ROOT does not exist or is not a directory: code `root_not_directory`, message `checkout root is not a directory: <ROOT as given>`.
5. Or, for a read request, with L the applied `max_lines`, the existing read checks in their existing order:
   1. S > E: code `invalid_range`, message `start line <S> is after end line <E>`.
   2. E - S + 1 > L: code `invalid_range`, message `line range <S>-<E> exceeds the <L>-line read limit` (with the default, exactly the existing `exceeds the 200-line read limit`).
   3. ROOT does not exist or is not a directory: code `root_not_directory`, message `checkout root is not a directory: <ROOT as given>`.
   4. PATH is absolute or escapes ROOT lexically (for example `../outside.txt`): code `path_outside_root`, message `path escapes the checkout root: <PATH as given>`.
   5. The joined path does not exist: code `not_found`, message `file not found: <PATH as given>`.
   6. The canonicalized path is outside the canonicalized ROOT (a symlink escape): code `path_outside_root`, message `path escapes the checkout root: <PATH as given>`; the outside file is not read.
   7. The target is not a regular file (for example a directory): code `not_a_file`, message `not a regular file: <PATH as given>`.
   8. The content is not valid UTF-8: code `not_text`, message `file is not UTF-8 text: <PATH as given>`.
   9. E > the file's line count N: code `invalid_range`, message `line range <S>-<E> exceeds the file's line count <N>`.

**Serving a request**

- Search searches exactly the files the existing `search` searches, matches lines exactly as it does and orders matches the same way. It returns the first M matches; `truncated` is `true` exactly when at least one more matching line exists, otherwise `false`. A search without hits returns `"matches":[]` with exit status 0.
- Read returns the inclusive range S..E as the existing `read` does, with `total_lines` the file's line count.
- Each `text` is the line's first X characters (Unicode scalar values), where X is the applied `max_line_chars`; a line of X characters or fewer is unchanged. A match's `column` is still the 1-based character position of the first occurrence of LITERAL in the full line, so it can lie beyond the cut text.

**`contract/`**

- `contract/request.schema.json` and `contract/packet.schema.json`: JSON Schemas (draft 2020-12) whose content is exactly the JSON in the acceptance scenario "The contract publishes the version 1 request and packet schemas" (formatting is free, the JSON content is pinned). They use only the keywords `$schema`, `$id`, `title`, `description`, `$defs`, `$ref` (only `#/$defs/...`), `type`, `const`, `enum`, `properties`, `required`, `additionalProperties`, `items`, `minimum`, `maximum`, `minLength`, `maxLength`, `maxItems` and `oneOf`.
- `contract/examples/`: exactly the files `checkout/README.md`, `checkout/app.py`, `checkout/util.py`, and the pairs `search`, `search-limited`, `read` and `error` as `<name>.request.json` and `<name>.packet.json`, with the contents given in the acceptance scenarios. Each request's `root` is `contract/examples/checkout`, relative to the repository root. Each `<name>.packet.json` is exactly the bytes that `kogen-context request` prints on stdout for `<name>.request.json` when run from the repository root: one compact JSON line ending in `\n`.
- `contract/README.md`: what the contract is (the version 1 request and packet of `kogen-context request`, its callers being separate processes), the invocation, the exit statuses, the files `request.schema.json`, `packet.schema.json` and `examples/`, how to run the contract test alone (`cargo test --locked --offline --test contract`), and the version rule: an incompatible change to the request or the packet is a new version with new schemas, and version 1 stays as it is. It follows the `contract/` and `consumes/` convention of the other Kogen component repositories: this repository's `contract/` pins what its callers use, and each caller pins its use in its own repository under `consumes/kogen-context/`. kogen-context consumes no other Kogen component, so this repository adds no `consumes/` directory. The README says this, naming `consumes/kogen-context`.
- The project `README.md` names `contract/` in its source map and mentions `kogen-context request` in its current state.

**Contract test (`tests/contract.rs`)**

It runs in `cargo test --locked --offline`. It lists `contract/examples/` and, for every `*.request.json` there, requires the paired `*.packet.json`; checks that the request validates against `contract/request.schema.json` and the example packet validates against `contract/packet.schema.json`; runs the built binary (`env!("CARGO_BIN_EXE_kogen-context")`) as `kogen-context request` with the repository root (`env!("CARGO_MANIFEST_DIR")`) as working directory and the request file's bytes on stdin; and asserts that stderr is empty, stdout is byte-identical to the example packet, the exit status is 0 for a search or read packet, 2 for codes `invalid_request` and `unsupported_version` and 1 for any other code, and the real stdout validates against `contract/packet.schema.json`. Its validator implements exactly the keyword subset above and fails on any other keyword, so an unsupported schema cannot pass by being ignored; the test also asserts that the validator rejects one known-bad packet (an error packet with code `usage`), so the validation is not vacuous. Each failure message names the example file.

## Decisions
- The contract lives in `contract/` of this repository, following the `contract/` and `consumes/` convention of the other Kogen component repositories (source: request)
- The contract is a JSON Schema for the CLI's request (checkout root, operation, literal search string or bounded read request, limits) and one for its result packet (matches, read ranges, truncation and limit fields, errors) (source: request)
- The contract is versioned: every request and packet carries `"version":1`, and another version is refused with `unsupported_version` (source: request)
- Example request and packet files validate against the schemas, and a test checks that the binary's real output for each example validates (source: request)
- No retrieval mechanism, placement or index is decided or added (source: request)

## Source comparison
- Stable, versioned contract for callers that run kogen-context as a separate read-only process: addressed by `kogen-context request` with `"version":1` in every request and packet, `unsupported_version` for any other version, and the version rule in `contract/README.md` (scenarios "The contract publishes ...", "Requests that cannot be served are refused with an error packet" version rows).
- `contract/` in KogenAI/kogen-context with JSON Schemas for the request (selected checkout root, operation, literal search string or bounded read request, limits): addressed by `contract/request.schema.json` (`root`, `operation`, `literal`, `path`/`start`/`end`, `limits`).
- Result packet schema (matches, read ranges, truncation and limit fields, errors): addressed by `contract/packet.schema.json` (`matches`, `start`/`end`/`total_lines`/`lines`, `truncated`, `limits`, `error`).
- Following the `contract/` and `consumes/` convention of the other Kogen component repositories: addressed. In those repositories `contract/` pins what consumers use and each consumer keeps `consumes/<producer>/`; here `contract/` holds the schemas and examples, callers keep `consumes/kogen-context/` in their own repositories, and no `consumes/` directory is added because kogen-context depends on no other Kogen component (it uses only the Rust standard library).
- Example request and packet files that validate against the schemas: addressed by `contract/examples/` (`search`, `search-limited`, `read`, `error`, and the fixture checkout), each scenario checking that both files validate.
- A test that the binary's real output for each example validates: addressed by `tests/contract.rs` in `cargo test --locked --offline`, and in acceptance by the four example scenarios, which run the binary on each example request from the repository root and validate its real stdout.
- Out of scope, retrieval mechanisms, placement and indexes: addressed. Search and read keep their existing behavior; only the request and packet framing and the caller-selected limits (lower than or equal to the existing bounds) are added.
- Existing `search` and `read` commands and the usage message: preserved unchanged (scenario "The request command sits next to the unchanged search and read commands"); the settled bounds of 100 matches, 200 read lines and 500 characters stay the defaults and maxima.
- Roadmap order after kontext-literal-search-bounded-reads: this builds on that Intent's commands without changing them.

## Tests
- `kogen-context request` serves a search request with a version 1 packet, default limits, bytewise path order and an empty match list for no hits: acceptance scenarios "A search request with an absolute root returns a version 1 packet with the default limits" and "A search request with no hits returns an empty match list" (scenario)
- `max_matches` bounds the matches and `truncated` reports whether more exist, at 1, below and at the number of hits, and at the default and maximum of 100: acceptance outline "max_matches bounds the matches and truncated reports whether more exist" (scenario)
- `max_line_chars` cuts each line's text at 1, below, at and above the line's length, and at the default and maximum of 500, with the column still computed on the full line: acceptance outlines "max_line_chars cuts the text of each line" and "A read request keeps at most max_line_chars characters of each line", and the limited search example (scenario)
- A read request returns its range with the normalized path, `total_lines` and default limits, and `max_lines` allows ranges up to its value at 1, 3 and the maximum of 200: acceptance scenario "A read request returns its range with the default limits" and outline "max_lines bounds the lines a read request may ask for" (scenario)
- Invalid JSON, a non-object, an empty request, a missing or other version, every schema violation category and the existing range, root, path, missing-file and directory refusals give the stated error packet and exit status: acceptance outline "Requests that cannot be served are refused with an error packet" and scenario "An empty request is refused with an error packet" (scenario)
- The existing `search` and `read` commands and the usage refusal are unchanged next to `request`: acceptance scenario "The request command sits next to the unchanged search and read commands" and the existing `tests/cli.rs` (existing)
- The schemas, examples, fixture checkout and contract README are published with the pinned content: acceptance scenarios "The contract publishes the version 1 request and packet schemas" and "The contract examples and their fixture checkout are published" (scenario)
- Each example request produces exactly its example packet with the stated exit status, and both example files and the real output validate against the schemas: the four example acceptance scenarios and the new `tests/contract.rs`, which runs the built binary on every example (integration)
- The request JSON parser (whitespace, escapes including surrogate pairs and lone surrogates, trailing content, duplicate members, integer tokens without fraction or exponent) and the request check order (JSON, then version, then schema, then the operation's refusals): Rust unit tests in `src/` through the functions that implement them (unit)

## Feasibility
- evidence: {"id": "packet-schema-validator", "kind": "observer", "inputs": ["features/steps/k-context-cli-contract__schema.js", ".kogen/intents/k-context-cli-contract/acceptance.feature"], "observers": ["features/steps/k-context-cli-contract__schema.js"], "checks": [{"name": "good", "command": "node features/steps/k-context-cli-contract__schema.js .kogen/intents/k-context-cli-contract/acceptance.feature contract/packet.schema.json '{\"version\":1,\"operation\":\"read\",\"path\":\"util.py\",\"start\":1,\"end\":2,\"total_lines\":2,\"lines\":[{\"line\":1,\"text\":\"def parse_config(path):\"},{\"line\":2,\"text\":\"    return open(path).read()\"}],\"limits\":{\"max_lines\":200,\"max_line_chars\":500}}'", "exit": 0, "output": "valid\n"}, {"name": "bad", "command": "node features/steps/k-context-cli-contract__schema.js .kogen/intents/k-context-cli-contract/acceptance.feature contract/packet.schema.json '{\"version\":1,\"error\":{\"code\":\"usage\",\"message\":\"x\"}}'", "exit": 1, "output": "invalid: /: matches 0 of the 3 oneOf branches, not exactly 1 (branch 0: /: missing member \"operation\", /: missing member \"query\", /: missing member \"matches\", /: missing member \"truncated\", /: missing member \"limits\", /error: no value is allowed; branch 1: /: missing member \"operation\", /: missing member \"path\", /: missing member \"start\", /: missing member \"end\", /: missing member \"total_lines\", /: missing member \"lines\", /: missing member \"limits\", /error: no value is allowed; branch 2: /error/code: \"usage\" is not one of [\"invalid_request\",\"unsupported_version\",\"invalid_range\",\"root_not_directory\",\"path_outside_root\",\"not_found\",\"not_a_file\",\"not_text\"])\n"}]}
