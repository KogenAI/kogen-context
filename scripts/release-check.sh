#!/bin/sh
# Builds HEAD twice, checks that the builds are identical and runs the fixture
# tests against the binary, like scripts/release.sh but without a tag and
# without writing artifacts.
SCRIPT=release-check.sh

if [ "$#" -ne 0 ]; then
    echo "usage: scripts/release-check.sh" >&2
    exit 2
fi

here=$(cd "$(dirname "$0")" && pwd) || exit 1
REPO=$(git -C "$here" rev-parse --show-toplevel) || exit 1
. "$here/release-lib.sh"
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

commit=$(git -C "$REPO" rev-parse --verify --quiet "HEAD^{commit}") || fail "no commit at HEAD"

release_pipeline "$commit"

echo "release check passed: $PLATFORM $CHECKSUM"
