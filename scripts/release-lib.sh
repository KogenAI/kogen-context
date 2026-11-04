# Shared by release.sh and release-check.sh; sourced, not run.
#
# Builds a commit twice in two directories, compares the builds, checks the
# binary's version line and runs the fixture corpus tests against the binary.
# The caller sets SCRIPT (its file name) and REPO (the top level of the
# repository), then calls release_pipeline COMMIT [TAG]. Without a TAG the
# build is a development build. On success BINARY, PLATFORM and CHECKSUM
# describe the first build, which lives in the temporary directory TMP.

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

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d ' ' -f 1 | tr 'A-F' 'a-f'
    else
        shasum -a 256 "$1" | cut -d ' ' -f 1 | tr 'A-F' 'a-f'
    fi
}

host_platform() {
    host=$(cd "$REPO" && rustc -vV | sed -n 's/^host: //p')
    case $host in
    aarch64-apple-darwin) PLATFORM=darwin-arm64 ;;
    x86_64-unknown-linux-gnu) PLATFORM=linux-x86_64 ;;
    aarch64-unknown-linux-gnu) PLATFORM=linux-arm64 ;;
    *) fail "unsupported build host: $host" ;;
    esac
}

# cargo ARGS...: runs cargo in the export directory $dir with its own target
# directory and no inherited rustc flags or release variables. A tag and
# commit are set for the release build only (BUILD_TAG and BUILD_COMMIT).
run_cargo() {
    (
        cd "$dir" || exit 1
        unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS KOGEN_CONTEXT_RELEASE_TAG KOGEN_CONTEXT_RELEASE_COMMIT
        CARGO_TARGET_DIR=$dir/target
        export CARGO_TARGET_DIR
        if [ -n "$BUILD_TAG" ]; then
            KOGEN_CONTEXT_RELEASE_TAG=$BUILD_TAG
            KOGEN_CONTEXT_RELEASE_COMMIT=$COMMIT
            export KOGEN_CONTEXT_RELEASE_TAG KOGEN_CONTEXT_RELEASE_COMMIT
        fi
        if [ -n "$TEST_BINARY" ]; then
            KOGEN_CONTEXT_BIN=$TEST_BINARY
            export KOGEN_CONTEXT_BIN
        fi
        cargo "$@" >&2
    )
}

release_pipeline() {
    COMMIT=$1
    tag=${2-}
    BUILD_TAG=
    TEST_BINARY=

    host_platform

    TMP=$(mktemp -d "${TMPDIR:-/tmp}/kogen-context-release.XXXXXX") || fail "cannot create a temporary directory"
    git -C "$REPO" archive --format=tar -o "$TMP/tree.tar" "$COMMIT" >&2 || fail "cannot export $COMMIT"
    for side in a b; do
        mkdir -p "$TMP/$side/kogen-context" || fail "cannot create $TMP/$side/kogen-context"
        tar -xf "$TMP/tree.tar" -C "$TMP/$side/kogen-context" >&2 || fail "cannot unpack $COMMIT"
    done
    first=$TMP/a/kogen-context
    second=$TMP/b/kogen-context

    BUILD_TAG=$tag
    for dir in "$first" "$second"; do
        run_cargo build --release --locked --offline || fail "build of $COMMIT failed in $dir"
    done

    BINARY=$first/target/release/kogen-context
    cmp -s "$BINARY" "$second/target/release/kogen-context" || fail "builds of $COMMIT in two directories differ"

    line=$("$BINARY" version 2>/dev/null)
    if [ -n "$tag" ]; then
        case $line in
        *"(tag $tag, commit $COMMIT)") ;;
        *) fail "the build does not report its version" ;;
        esac
    else
        case $line in
        *"(development build)") ;;
        *) fail "the build does not report its version" ;;
        esac
    fi

    dir=$first
    BUILD_TAG=
    TEST_BINARY=$BINARY
    run_cargo test --locked --offline --test corpus || fail "fixture tests failed for $COMMIT"

    CHECKSUM=$(sha256_of "$BINARY")
}
