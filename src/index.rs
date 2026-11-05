//! A shared per-commit search index with the working tree overlaid.
//!
//! The commit index (`index-v1/commits/<commit>`) holds every regular-file
//! blob of the HEAD commit with its distinct byte trigrams. The tree snapshot
//! (`index-v1/trees/<commit>-<root key>`) records the files of one root whose
//! working-tree bytes were the commit's bytes, with their `lstat`. A search
//! skips a file that the snapshot trusts (its `lstat` is unchanged) when the
//! commit index shows that the literal cannot match in it, and reads every
//! other file as the full scan does. The index changes speed only.

mod cache;
mod format;
mod git;

use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

use cache::Cache;
use format::{CommitBuilder, CommitIndex, SnapEntry, Snapshot, Source, StatKey};
use git::Checkout;

/// The index of the HEAD commit of the checkout that holds a root, ready to
/// tell which files of a search need not be read.
pub struct Overlay {
    index: CommitIndex,
    snapshot: Snapshot,
    candidates: Option<Vec<bool>>,
}

/// The overlay for a search of `literal` under the canonical `root`, or
/// `None` when the search must scan every file: no cache directory outside
/// the root, no Git checkout, no HEAD commit, or `git` failed on a build.
pub fn open(root: &Path, literal: &str) -> Option<Overlay> {
    let cache = Cache::locate(root)?;
    let checkout = git::discover(root)?;
    let commit = checkout.head_commit()?;
    let prefix = root.strip_prefix(&checkout.top).ok()?.to_str()?;
    let index = load_commit_index(&cache, &checkout, &commit)?;
    let snapshot = load_snapshot(&cache, &checkout, &commit, root, prefix, &index)?;
    let candidates = index.candidates(literal.as_bytes());
    Some(Overlay {
        index,
        snapshot,
        candidates,
    })
}

impl Overlay {
    /// Whether the file `rel` (relative to the root, with the `lstat` of the
    /// directory entry) cannot match, so that it need not be read.
    pub fn skips(&self, rel: &str, meta: &fs::Metadata) -> bool {
        let Some(SnapEntry { entry, stat, .. }) = self.snapshot.lookup(rel) else {
            return false;
        };
        if *stat != StatKey::of(meta) {
            return false;
        }
        match self.index.is_utf8(*entry) {
            Some(false) => true,
            Some(true) => self
                .candidates
                .as_ref()
                .and_then(|c| c.get(*entry as usize))
                .is_some_and(|candidate| !candidate),
            None => false,
        }
    }
}

fn load_commit_index(cache: &Cache, checkout: &Checkout, commit: &str) -> Option<CommitIndex> {
    let file = cache.commit_file(commit);
    if let Some(index) = fs::File::open(&file)
        .ok()
        .and_then(|f| CommitIndex::open(Source::File(f), commit))
    {
        return Some(index);
    }
    let bytes = build_commit_index(checkout, commit)?;
    cache::publish(&file, &bytes);
    CommitIndex::open(Source::Memory(bytes), commit)
}

/// The commit index file for `commit`, built with `git ls-tree` and
/// `git cat-file --batch`.
fn build_commit_index(checkout: &Checkout, commit: &str) -> Option<Vec<u8>> {
    let files = checkout.list_files(commit)?;
    let mut cat = checkout.cat_blobs(files.iter().map(|(_, id)| id.clone()).collect())?;
    let mut builder = CommitBuilder::new();
    for (path, id) in files {
        // A blob that Git reports missing is left out.
        if let Some(blob) = cat.next_blob()? {
            builder.add(path, &id, &blob);
        }
    }
    cat.finish().then_some(())?;
    builder.finish(commit)
}

fn load_snapshot(
    cache: &Cache,
    checkout: &Checkout,
    commit: &str,
    root: &Path,
    prefix: &str,
    index: &CommitIndex,
) -> Option<Snapshot> {
    let file = cache.tree_file(commit, root);
    let existing = fs::read(&file).ok().and_then(|bytes| {
        Snapshot::decode(
            &bytes,
            commit,
            root.as_os_str().as_bytes(),
            index.entry_count(),
        )
    });
    match existing {
        Some(snapshot) if !snapshot.is_stale_at(format::now_ns()) => Some(snapshot),
        // A racy snapshot older than the window is made again; if that fails,
        // the old one is still correct.
        other => match build_snapshot(checkout, root, prefix, index) {
            Some(snapshot) => {
                let bytes = snapshot.encode(commit, root.as_os_str().as_bytes());
                cache::publish(&file, &bytes);
                Some(snapshot)
            }
            None => other,
        },
    }
}

/// Walks `root` like a search and records the files whose bytes equal the
/// commit's blob and whose times are old enough to be trusted.
fn build_snapshot(
    checkout: &Checkout,
    root: &Path,
    prefix: &str,
    index: &CommitIndex,
) -> Option<Snapshot> {
    let start = format::now_ns();
    let indexed = index.entries()?;
    let mut pending = Vec::new();
    for (rel, meta) in crate::walk_files(root, true) {
        let Some(meta) = meta else { continue };
        let full = if prefix.is_empty() {
            rel.clone()
        } else {
            format!("{prefix}/{rel}")
        };
        if let Ok(entry) = indexed.binary_search_by(|(path, _)| path.as_str().cmp(&full)) {
            pending.push((rel, entry, StatKey::of(&meta)));
        }
    }
    let mut cat = checkout.cat_blobs(
        pending
            .iter()
            .map(|(_, e, _)| indexed[*e].1.clone())
            .collect(),
    )?;
    let mut entries = Vec::new();
    let mut racy = false;
    for (rel, entry, stat) in pending {
        let Some(blob) = cat.next_blob()? else {
            continue;
        };
        if fs::read(root.join(&rel)).is_ok_and(|bytes| bytes == blob) {
            if format::trusted_at(&stat, start) {
                entries.push(SnapEntry {
                    path: rel,
                    entry: entry as u32,
                    stat,
                });
            } else {
                racy = true;
            }
        }
    }
    cat.finish().then_some(())?;
    Some(Snapshot {
        start,
        racy,
        index_entries: index.entry_count() as u32,
        entries,
    })
}
