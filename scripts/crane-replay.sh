#!/bin/sh
# Fetches two pinned public Crane revisions into a temporary directory and
# records the rank of every match of a fixed list of hints in the path order
# and the ranked order of `BINARY request`. Needs git, tar, python3 and network
# access to GitHub; it is the only script of this repository that uses the
# network. Writes nothing outside its temporary directory.
SCRIPT=crane-replay.sh
REMOTE=https://github.com/zig-whatwg/crane.git
REVISIONS="adc2ea58b65:adc2ea58b65af01f112e0fa4cfd91520cb78a766 b41782ab61d:b41782ab61da93c80ca6c0fa8c83ff3ceb5ac99c"
HINTS="spinEventLoopUntil evaluateReplScript journal.shard wptreport.jsonl cleanup gen_snapshot constructorCallback"
MAX_MATCHES=12

if [ "$#" -ne 1 ]; then
    echo "usage: scripts/crane-replay.sh BINARY" >&2
    exit 2
fi
BINARY=$1

TMP=

fail() {
    echo "$SCRIPT: $1" >&2
    exit 1
}

cleanup() {
    if [ -n "$TMP" ]; then
        rm -rf "$TMP"
    fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

TMP=$(mktemp -d) || fail "cannot create a temporary directory"
TMP=$(cd "$TMP" && pwd) || fail "cannot enter the temporary directory"
GIT_TERMINAL_PROMPT=0
export GIT_TERMINAL_PROMPT

git init -q "$TMP/repo" >&2 || fail "cannot initialise a repository"

# export_revision ID: exports the tracked files of the commit ID into $TMP/ID.
export_revision() {
    id=$1
    git -C "$TMP/repo" fetch -q --depth 1 --no-tags "$REMOTE" "$id" >&2 || fail "cannot fetch $id from $REMOTE"
    found=$(git -C "$TMP/repo" rev-parse --verify --quiet "$id^{commit}") || fail "no commit $id"
    [ "$found" = "$id" ] || fail "commit $id has the id $found"
    mkdir "$TMP/$id" || fail "cannot create $TMP/$id"
    git -C "$TMP/repo" archive --format=tar -o "$TMP/$id.tar" "$id" >&2 || fail "cannot export $id"
    tar -xf "$TMP/$id.tar" -C "$TMP/$id" >&2 || fail "cannot unpack $id"
    rm -f "$TMP/$id.tar"
}

# record LABEL ROOT ORDER HINT: one record per match of the search.
record() {
    label=$1
    root=$2
    order=$3
    hint=$4
    python3 -I -c '
import json, sys
root, literal, order, limit = sys.argv[1:5]
print(json.dumps({"version": 1, "root": root, "operation": "search", "literal": literal,
                  "limits": {"max_matches": int(limit)}, "order": order}, separators=(",", ":")))
' "$root" "$hint" "$order" "$MAX_MATCHES" >"$TMP/request.json" || fail "cannot build the request for $hint"
    "$BINARY" request <"$TMP/request.json" >"$TMP/packet.json" || fail "$BINARY request failed for $hint in $label ($order)"
    python3 -I -c '
import json, sys
label, order, hint, packet = sys.argv[1:5]
with open(packet, encoding="utf-8") as f:
    data = json.load(f)
if data.get("operation") != "search" or not isinstance(data.get("matches"), list):
    sys.exit("no search packet")
for rank, m in enumerate(data["matches"], 1):
    print("%s\t%s\t%s\t%d\t%s:%d" % (label, order, hint, rank, m["path"], m["line"]))
' "$label" "$order" "$hint" "$TMP/packet.json" >"$TMP/records.txt" || fail "no search packet for $hint in $label ($order)"
    cat "$TMP/records.txt"
}

for revision in $REVISIONS; do
    export_revision "${revision#*:}"
done

for revision in $REVISIONS; do
    label=${revision%%:*}
    id=${revision#*:}
    for hint in $HINTS; do
        for order in path ranked; do
            record "$label" "$TMP/$id" "$order" "$hint"
        done
    done
done
