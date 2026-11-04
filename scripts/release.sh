#!/bin/sh
# Builds the commit of a local tag twice, checks that the builds are identical,
# runs the fixture tests against the binary and keeps the binary and its
# SHA-256 checksum under target/kogen-context-release/TAG/. Publishes nothing.
SCRIPT=release.sh

if [ "$#" -ne 1 ]; then
    echo "usage: scripts/release.sh TAG" >&2
    exit 2
fi
tag=$1
case $tag in
'' | *[!A-Za-z0-9._-]*)
    echo "$SCRIPT: tag name must match [A-Za-z0-9._-]+: $tag" >&2
    exit 1
    ;;
esac

here=$(cd "$(dirname "$0")" && pwd) || exit 1
REPO=$(git -C "$here" rev-parse --show-toplevel) || exit 1
. "$here/release-lib.sh"
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

commit=$(git -C "$REPO" rev-parse --verify --quiet "refs/tags/$tag^{commit}" 2>/dev/null) || fail "no such tag: $tag"

release_pipeline "$commit" "$tag"

name=kogen-context-$tag-$PLATFORM
out=$REPO/target/kogen-context-release/$tag
rm -rf "$out"
mkdir -p "$out" || fail "cannot create $out"
cp "$BINARY" "$out/$name" || fail "cannot write $out/$name"
chmod 755 "$out/$name"
printf '%s  %s\n' "$CHECKSUM" "$name" >"$out/SHA256SUMS" || fail "cannot write $out/SHA256SUMS"
cat "$out/SHA256SUMS"
