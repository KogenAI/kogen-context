#!/bin/sh
# Times `BINARY request` against ripgrep on two pinned public Crane revisions:
# the first search of a revision (cold), repeat searches (warm) and repeat
# searches after an edit (after-edit). Each revision is a linked Git worktree,
# so that kogen-context uses its commit index; a plain export of the same
# commit is the reference for every packet. Prints one tab-separated record per
# measurement: label, phase, order, hint, kogen-context ms, ripgrep ms.
# Needs git, rg, tar, python3 and network access to GitHub; it and
# scripts/crane-replay.sh are the only scripts of this repository that use the
# network. Writes nothing outside its temporary directory, and uses a cache
# directory inside it for the index.
SCRIPT=crane-bench.sh
REMOTE=https://github.com/zig-whatwg/crane.git
REVISIONS="adc2ea58b65:adc2ea58b65af01f112e0fa4cfd91520cb78a766 b41782ab61d:b41782ab61da93c80ca6c0fa8c83ff3ceb5ac99c"
HINTS="spinEventLoopUntil evaluateReplScript journal.shard wptreport.jsonl cleanup gen_snapshot constructorCallback"
ORDERS="path ranked"
EDIT_LINE='// crane-bench: spinEventLoopUntil evaluateReplScript journal.shard wptreport.jsonl cleanup gen_snapshot constructorCallback'
RUNS=3

if [ "$#" -ne 1 ]; then
    echo "usage: scripts/crane-bench.sh BINARY" >&2
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

for tool in git rg tar python3; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is needed and was not found"
done
case $BINARY in
/*) ;;
*) BINARY=$(pwd)/$BINARY ;;
esac
[ -x "$BINARY" ] && [ -f "$BINARY" ] || fail "$BINARY is not an executable file"

TMP=$(mktemp -d) || fail "cannot create a temporary directory"
TMP=$(cd "$TMP" && pwd) || fail "cannot enter the temporary directory"
GIT_TERMINAL_PROMPT=0
XDG_CACHE_HOME=$TMP/cache
export GIT_TERMINAL_PROMPT XDG_CACHE_HOME

# $TMP/timed.py OUT STDIN CWD COMMAND...: runs the command with standard
# output in OUT, standard input from the file STDIN (or none for "-") and no
# standard error, and prints its wall-clock milliseconds and exit status.
cat >"$TMP/timed.py" <<'PY' || fail "cannot write the timer"
import subprocess, sys, time
out, stdin_file, cwd = sys.argv[1:4]
stdin = subprocess.DEVNULL if stdin_file == "-" else open(stdin_file, "rb")
with open(out, "wb") as sink:
    start = time.perf_counter()
    result = subprocess.run(sys.argv[4:], stdin=stdin, stdout=sink, stderr=subprocess.DEVNULL, cwd=cwd)
    elapsed = (time.perf_counter() - start) * 1000.0
print("%.6f %d" % (elapsed, result.returncode))
PY

# timed OUT STDIN CWD COMMAND...: sets T_MS and T_RC.
timed() {
    result=$(python3 -I "$TMP/timed.py" "$@") || fail "cannot time $4"
    T_MS=${result% *}
    T_RC=${result#* }
}

# median MS...: the median, with one decimal.
median() {
    python3 -I -c 'import sys
v = sorted(float(x) for x in sys.argv[1:])
print("%.1f" % v[len(v) // 2])' "$@"
}

# write_request FILE ROOT HINT ORDER
write_request() {
    python3 -I -c '
import json, sys
root, literal, order = sys.argv[1:4]
print(json.dumps({"version": 1, "root": root, "operation": "search", "literal": literal, "order": order},
                 separators=(",", ":")))
' "$2" "$3" "$4" >"$1" || fail "cannot build the request for $3"
}

# time_ripgrep LABEL HINT: sets RG_MS to one timed path-sorted scan of the worktree.
time_ripgrep() {
    timed "$TMP/rg.out" - "$TMP/$1" rg --sort path --fixed-strings --line-number --column --no-heading --no-ignore --hidden --glob '!.git' --no-messages -e "$2" .
    if [ "$T_RC" != 0 ] && [ "$T_RC" != 1 ]; then
        fail "rg failed for $2 on $1"
    fi
    RG_MS=$T_MS
}

# prepare LABEL PHASE ORDER HINT: writes the request for the worktree and the
# packet that the plain export prints for the same request.
prepare() {
    write_request "$TMP/request.json" "$TMP/$1" "$4" "$3"
    write_request "$TMP/plain-request.json" "$TMP/$1-plain" "$4" "$3"
    "$BINARY" request <"$TMP/plain-request.json" >"$TMP/expected.out" 2>/dev/null ||
        fail "$BINARY request failed for $4 ($3, $2) on the plain export of $1"
}

# time_request LABEL PHASE ORDER HINT: sets KOGEN_MS to one timed request,
# which must print what the plain export printed.
time_request() {
    timed "$TMP/packet.out" "$TMP/request.json" "$TMP" "$BINARY" request
    if [ "$T_RC" != 0 ] || ! cmp -s "$TMP/packet.out" "$TMP/expected.out"; then
        fail "packet differs for $4 ($3, $2) on $1"
    fi
    KOGEN_MS=$T_MS
}

# record LABEL PHASE ORDER HINT KOGEN_MS RG_MS
record() {
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" "$6"
}

# cold LABEL: the first search of the revision, against the median of three scans.
cold() {
    hint=spinEventLoopUntil
    prepare "$1" cold path "$hint"
    time_request "$1" cold path "$hint"
    kogen_ms=$(median "$KOGEN_MS") || fail "cannot compute a median"
    rg_runs=
    n=0
    while [ "$n" -lt "$RUNS" ]; do
        time_ripgrep "$1" "$hint"
        rg_runs="$rg_runs $RG_MS"
        n=$((n + 1))
    done
    rg_ms=$(median $rg_runs) || fail "cannot compute a median"
    record "$1" cold path "$hint" "$kogen_ms" "$rg_ms"
}

# repeat LABEL PHASE: the medians of three requests and three scans for every
# hint and order.
repeat() {
    for hint in $HINTS; do
        for order in $ORDERS; do
            prepare "$1" "$2" "$order" "$hint"
            kogen_runs=
            rg_runs=
            n=0
            while [ "$n" -lt "$RUNS" ]; do
                time_request "$1" "$2" "$order" "$hint"
                kogen_runs="$kogen_runs $KOGEN_MS"
                time_ripgrep "$1" "$hint"
                rg_runs="$rg_runs $RG_MS"
                n=$((n + 1))
            done
            kogen_ms=$(median $kogen_runs) || fail "cannot compute a median"
            rg_ms=$(median $rg_runs) || fail "cannot compute a median"
            record "$1" "$2" "$order" "$hint" "$kogen_ms" "$rg_ms"
        done
    done
}

# edit DIR: appends the hint line to build.zig, adds crane-bench-added.zig
# with that line and deletes CHANGELOG.md.
edit() {
    printf '%s\n' "$EDIT_LINE" >>"$1/build.zig" || fail "cannot edit $1/build.zig"
    printf '%s\n' "$EDIT_LINE" >"$1/crane-bench-added.zig" || fail "cannot write $1/crane-bench-added.zig"
    rm "$1/CHANGELOG.md" || fail "cannot delete $1/CHANGELOG.md"
}

git init -q "$TMP/repo" >&2 || fail "cannot initialise a repository"

for revision in $REVISIONS; do
    label=${revision%%:*}
    id=${revision#*:}
    git -C "$TMP/repo" fetch -q --depth 1 --no-tags "$REMOTE" "$id" >&2 || fail "cannot fetch $id from $REMOTE"
    found=$(git -C "$TMP/repo" rev-parse --verify --quiet "$id^{commit}") || fail "no commit $id"
    [ "$found" = "$id" ] || fail "commit $id has the id $found"
done

for revision in $REVISIONS; do
    label=${revision%%:*}
    id=${revision#*:}
    git -C "$TMP/repo" worktree add --detach "$TMP/$label" "$id" >&2 || fail "cannot create the worktree of $id"
    mkdir "$TMP/$label-plain" || fail "cannot create $TMP/$label-plain"
    git -C "$TMP/repo" archive --format=tar -o "$TMP/$label.tar" "$id" >&2 || fail "cannot export $id"
    tar -xf "$TMP/$label.tar" -C "$TMP/$label-plain" >&2 || fail "cannot unpack $id"
    rm -f "$TMP/$label.tar"
done

# Every checked-out file must be more than 2 seconds old for the index to trust it.
sleep 3

for revision in $REVISIONS; do
    label=${revision%%:*}
    cold "$label"
    repeat "$label" warm
    edit "$TMP/$label"
    edit "$TMP/$label-plain"
    repeat "$label" after-edit
done
