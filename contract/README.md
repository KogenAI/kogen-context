# kogen-context contract

This directory pins the contract that callers of `kogen-context` use. Callers run `kogen-context` as a separate process that never writes to the checkout: `kogen-context request` reads one version 1 JSON request on standard input and writes one version 1 JSON packet on standard output. One request in, one packet out. The packet depends only on the request and the files under the root; a search may keep an index in the per-user cache directory (see [Search index](#search-index)), which changes speed only.

## Invocation

```sh
kogen-context request < request.json
```

`request` takes no further argument; any other argument is the usage refusal of the `search` and `read` commands. The command reads standard input to its end.

Every outcome, success or refusal, is exactly one compact JSON packet on stdout followed by `\n`; stderr stays empty.

| Packet | Exit status |
| --- | --- |
| search or read packet | 0 |
| error packet, code `invalid_request` or `unsupported_version` | 2 |
| error packet, any other code | 1 |

A search request finds a literal in the searchable files under the checkout root; a read request returns an inclusive line range of one file. Both behave exactly like the unversioned `kogen-context search ROOT LITERAL` and `kogen-context read ROOT PATH START END` commands, which stay unchanged; the search does so in the path order. A request may lower the limits (`max_matches`, `max_lines`, `max_line_chars`); the packet reports the limits that were applied.

## Order of search matches

A search request may carry an optional `"order"` member, `"path"` or `"ranked"`; any other value, and `"order"` on a read request or inside `limits`, is an `invalid_request` refusal. `"path"` is the default: the matches are in bytewise path order, then line order, and the cap cuts that list. With `"ranked"` the search considers every matching line of the checkout, sorts them by tier, then by path (bytewise), then by line, and returns the first `max_matches`; `truncated` stays `true` exactly when more matching lines exist. The tiers, best first:

0. a definition in a source file
1. a call in a source file
2. any other line (a reference) in a source file
3. a line in a test file
4. a line in a generated file
5. a comment line in a source, test or generated file
6. any line of any other file (docs, data, build files)

Source files are told by extension; a generated file is under a `generated` directory or has `DO NOT EDIT` or `@generated` in its first five lines; a test file has `test`, `tests` or `spec` as a part of its name. The packet has the same members as before and no new one. This is an added optional field: version 1 requests without it behave exactly as before.

## Search index

A search of a root inside a Git checkout may keep an index of the checkout's HEAD commit in the per-user cache directory. The index changes speed only: the packet of a search is byte-identical with and without it, for the same request and the same files under the root, and the unversioned `search` command prints the same. Packets carry no index or freshness field, and nothing in the request changes.

- Location: `$XDG_CACHE_HOME/kogen-context` when `XDG_CACHE_HOME` is an absolute path, else `~/Library/Caches/kogen-context` on macOS and `~/.cache/kogen-context` elsewhere (`~` is an absolute `HOME`). With neither, or when that directory is the root or inside it, the search uses no index and writes nothing.
- Files: `index-v1/commits/<commit>` holds the regular-file blobs of the commit with their trigrams, shared by every checkout, root and run of the user. `index-v1/trees/<commit>-<root key>` records which files of one root still have the commit's bytes, by their `lstat`; `<root key>` is the FNV-1a 64-bit hash of the canonical root path as 16 lowercase hexadecimal digits.
- The working tree's uncommitted state is overlaid on every search: edited, added, ignored and deleted files are seen in the next search without a rebuild, because a file is read unless the snapshot trusts it and the index shows that the literal cannot match in it.
- The index is never inside the root, is safe for concurrent runs (files are published whole by a rename, nothing is locked), and may be deleted at any time; the next search rebuilds what it needs. The checkout, including its `.git`, is never written. A search outside a Git checkout, or without a usable cache directory, scans the files as before.
- A cold search runs `git ls-tree`, `git cat-file` and, for refs that are not files, `git rev-parse`, all read-only. A warm search runs no other program.

This is the expand step of expand-then-contract: no request or packet member is added or removed, version 1 and its schemas are unchanged, and nothing is contracted.

## Files

- [`request.schema.json`](request.schema.json): the JSON Schema (draft 2020-12) of the version 1 request.
- [`packet.schema.json`](packet.schema.json): the JSON Schema of the version 1 packet: search, read or error.
- [`examples/`](examples/): example requests (`<name>.request.json`) with the packets the binary prints for them (`<name>.packet.json`), and the fixture checkout `examples/checkout/` they run against. Run the examples from the repository root, since each request's `root` is relative to it.

## Contract test

`tests/contract.rs` runs the binary on every example and checks that the request, the example packet and the real output validate against the schemas, that stdout is byte-identical to the example packet, and the exit status. Run it alone with:

```sh
cargo test --locked --offline --test contract
```

## Versions

Every request and packet carries `"version":1`. A request with another version is refused with the error code `unsupported_version`. An incompatible change to the request or the packet is a new version with new schemas; version 1 stays as it is.

## Consumers

This follows the `contract/` and `consumes/` convention of the other Kogen component repositories: this repository's `contract/` pins what its callers use, and each caller pins its use in its own repository under `consumes/kogen-context/`. kogen-context consumes no other Kogen component, so this repository has no `consumes/` directory.
