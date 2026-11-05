//! The binary formats of the commit index and the tree snapshot. Both start
//! with the same header: magic, format version, kind, total length and key.
//! All numbers are little-endian.

use std::fs;
use std::os::unix::fs::{FileExt, MetadataExt};

const MAGIC: &[u8; 8] = b"KOGENCTX";
const VERSION: u32 = 1;
const KIND_COMMIT: u32 = 1;
const KIND_TREE: u32 = 2;
/// Magic, version, kind, total length and key length.
const COMMON_HEADER: usize = 28;
/// The fixed fields of a commit index after the key.
const COMMIT_FIXED: usize = 56;
/// A record of the entry table: the end of the path and the flags.
const RECORD_LEN: usize = 8;
/// A record of the trigram directory: trigram, byte length, absolute offset.
const DIR_RECORD_LEN: usize = 16;
const FLAG_UTF8: u32 = 1;
/// A file is trusted only when its times are more than this before the start
/// of the snapshot build.
pub const TRUST_WINDOW_NS: i128 = 2_000_000_000;

fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_u64(out: &mut Vec<u8>, v: u64) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_i64(out: &mut Vec<u8>, v: i64) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_header(out: &mut Vec<u8>, kind: u32, key: &[u8]) {
    out.extend_from_slice(MAGIC);
    put_u32(out, VERSION);
    put_u32(out, kind);
    put_u64(out, 0);
    put_u32(out, key.len() as u32);
    out.extend_from_slice(key);
}

/// Records the total length in the header.
fn seal(out: &mut [u8]) {
    let len = out.len() as u64;
    out[16..24].copy_from_slice(&len.to_le_bytes());
}

/// A bounds-checked cursor over bytes.
struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Reader { bytes, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let slice = self.bytes.get(self.pos..end)?;
        self.pos = end;
        Some(slice)
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    fn i64(&mut self) -> Option<i64> {
        Some(i64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
}

/// Accepts the header only with the magic, version 1, the expected kind and
/// key, and a recorded total length equal to `file_len`.
fn check_header(r: &mut Reader, kind: u32, key: &[u8], file_len: u64) -> Option<()> {
    (r.take(8)? == MAGIC
        && r.u32()? == VERSION
        && r.u32()? == kind
        && r.u64()? == file_len
        && r.u32()? as usize == key.len()
        && r.take(key.len())? == key)
        .then_some(())
}

fn trigram(window: &[u8]) -> u32 {
    (u32::from(window[0]) << 16) | (u32::from(window[1]) << 8) | u32::from(window[2])
}

fn put_varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v & 0x7f) as u8 | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

/// The ascending entry numbers of a posting list of delta-coded varints, each
/// below `limit`.
fn decode_postings(bytes: &[u8], limit: usize) -> Option<Vec<u32>> {
    let mut out = Vec::new();
    let mut current: i64 = -1;
    let mut i = 0;
    while i < bytes.len() {
        let mut delta: u64 = 0;
        let mut shift = 0;
        loop {
            let b = *bytes.get(i)?;
            i += 1;
            delta |= u64::from(b & 0x7f) << shift;
            if b & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift > 28 {
                return None;
            }
        }
        current += delta as i64;
        if delta == 0 || current >= limit as i64 {
            return None;
        }
        out.push(current as u32);
    }
    Some(out)
}

fn intersect(a: &[u32], b: &[u32]) -> Vec<u32> {
    let (mut i, mut j) = (0, 0);
    let mut out = Vec::new();
    while i < a.len() && j < b.len() {
        match a[i].cmp(&b[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                out.push(a[i]);
                i += 1;
                j += 1;
            }
        }
    }
    out
}

/// Collects the entries of a commit index in path order and encodes them.
pub struct CommitBuilder {
    paths: Vec<String>,
    ids: Vec<String>,
    flags: Vec<u32>,
    postings: std::collections::HashMap<u32, (i64, Vec<u8>)>,
    seen: Vec<u64>,
    distinct: Vec<u32>,
}

impl CommitBuilder {
    pub fn new() -> Self {
        CommitBuilder {
            paths: Vec::new(),
            ids: Vec::new(),
            flags: Vec::new(),
            postings: std::collections::HashMap::new(),
            seen: vec![0; (1 << 24) / 64],
            distinct: Vec::new(),
        }
    }

    /// Adds the next entry; entries must come in ascending path order.
    pub fn add(&mut self, path: String, id: &str, content: &[u8]) {
        let entry = self.paths.len() as i64;
        let utf8 = std::str::from_utf8(content).is_ok();
        if utf8 {
            for window in content.windows(3) {
                let t = trigram(window);
                let (word, bit) = ((t >> 6) as usize, 1u64 << (t & 63));
                if self.seen[word] & bit == 0 {
                    self.seen[word] |= bit;
                    self.distinct.push(t);
                }
            }
            for t in self.distinct.drain(..) {
                self.seen[(t >> 6) as usize] &= !(1u64 << (t & 63));
                let (last, list) = self.postings.entry(t).or_insert((-1, Vec::new()));
                put_varint(list, (entry - *last) as u64);
                *last = entry;
            }
        }
        self.paths.push(path);
        self.ids.push(id.to_owned());
        self.flags.push(if utf8 { FLAG_UTF8 } else { 0 });
    }

    /// The commit index file for `commit`, or `None` when the blob ids do not
    /// all have one length.
    pub fn finish(self, commit: &str) -> Option<Vec<u8>> {
        let id_len = self.ids.first().map_or(40, String::len);
        if self.ids.iter().any(|id| id.len() != id_len) {
            return None;
        }
        let mut out = Vec::new();
        put_header(&mut out, KIND_COMMIT, commit.as_bytes());
        let fixed_at = out.len();
        out.resize(fixed_at + COMMIT_FIXED, 0);
        let records_off = out.len();
        let mut end = 0u32;
        for (path, flags) in self.paths.iter().zip(&self.flags) {
            end += path.len() as u32;
            put_u32(&mut out, end);
            put_u32(&mut out, *flags);
        }
        let ids_off = out.len();
        for id in &self.ids {
            out.extend_from_slice(id.as_bytes());
        }
        let dir_off = out.len();
        let mut keys: Vec<u32> = self.postings.keys().copied().collect();
        keys.sort_unstable();
        let post_off = dir_off + keys.len() * DIR_RECORD_LEN;
        let mut offset = post_off as u64;
        for key in &keys {
            let len = self.postings[key].1.len();
            put_u32(&mut out, *key);
            put_u32(&mut out, len as u32);
            put_u64(&mut out, offset);
            offset += len as u64;
        }
        for key in &keys {
            out.extend_from_slice(&self.postings[key].1);
        }
        let paths_off = out.len();
        for path in &self.paths {
            out.extend_from_slice(path.as_bytes());
        }
        let mut fixed = Vec::new();
        put_u32(&mut fixed, self.paths.len() as u32);
        put_u32(&mut fixed, id_len as u32);
        put_u32(&mut fixed, keys.len() as u32);
        put_u32(&mut fixed, 0);
        for off in [records_off, ids_off, dir_off, post_off, paths_off] {
            put_u64(&mut fixed, off as u64);
        }
        out[fixed_at..fixed_at + COMMIT_FIXED].copy_from_slice(&fixed);
        seal(&mut out);
        Some(out)
    }
}

/// Where the bytes of an index file come from.
pub enum Source {
    File(fs::File),
    Memory(Vec<u8>),
}

impl Source {
    fn len(&self) -> Option<u64> {
        match self {
            Source::File(f) => f.metadata().ok().map(|m| m.len()),
            Source::Memory(bytes) => Some(bytes.len() as u64),
        }
    }

    fn read_at(&self, offset: u64, len: usize) -> Option<Vec<u8>> {
        match self {
            Source::File(f) => {
                let mut buf = vec![0; len];
                f.read_exact_at(&mut buf, offset).ok()?;
                Some(buf)
            }
            Source::Memory(bytes) => {
                let start = usize::try_from(offset).ok()?;
                bytes
                    .get(start..start.checked_add(len)?)
                    .map(<[u8]>::to_vec)
            }
        }
    }
}

/// A valid commit index: its header, entry table and trigram directory in
/// memory, its posting lists and paths read on demand.
pub struct CommitIndex {
    source: Source,
    front: Vec<u8>,
    entry_count: usize,
    id_len: usize,
    tri_count: usize,
    records_off: usize,
    ids_off: usize,
    dir_off: usize,
    post_off: usize,
    paths_off: usize,
    total_len: usize,
}

impl CommitIndex {
    /// The index in `source` if it is a valid commit index of `commit`.
    pub fn open(source: Source, commit: &str) -> Option<CommitIndex> {
        let total_len = source.len()?;
        let head_len = COMMON_HEADER + commit.len() + COMMIT_FIXED;
        if total_len < head_len as u64 {
            return None;
        }
        let head = source.read_at(0, head_len)?;
        let mut r = Reader::new(&head);
        check_header(&mut r, KIND_COMMIT, commit.as_bytes(), total_len)?;
        let entry_count = r.u32()? as usize;
        let id_len = r.u32()? as usize;
        let tri_count = r.u32()? as usize;
        r.u32()?;
        let mut offsets = [0usize; 5];
        for off in &mut offsets {
            *off = usize::try_from(r.u64()?).ok()?;
        }
        let [records_off, ids_off, dir_off, post_off, paths_off] = offsets;
        let total_len = usize::try_from(total_len).ok()?;
        let consistent = records_off == head_len
            && ids_off == records_off.checked_add(entry_count.checked_mul(RECORD_LEN)?)?
            && dir_off == ids_off.checked_add(entry_count.checked_mul(id_len)?)?
            && post_off == dir_off.checked_add(tri_count.checked_mul(DIR_RECORD_LEN)?)?
            && post_off <= paths_off
            && paths_off <= total_len;
        if !consistent {
            return None;
        }
        let front = source.read_at(0, post_off)?;
        Some(CommitIndex {
            source,
            front,
            entry_count,
            id_len,
            tri_count,
            records_off,
            ids_off,
            dir_off,
            post_off,
            paths_off,
            total_len,
        })
    }

    pub fn entry_count(&self) -> usize {
        self.entry_count
    }

    /// Whether the blob of an entry is valid UTF-8.
    pub fn is_utf8(&self, entry: u32) -> Option<bool> {
        if entry as usize >= self.entry_count {
            return None;
        }
        let at = self.records_off + entry as usize * RECORD_LEN + 4;
        let flags = Reader::new(self.front.get(at..)?).u32()?;
        Some(flags & FLAG_UTF8 != 0)
    }

    /// The posting list location of a trigram: byte length and offset.
    fn find(&self, key: u32) -> Option<Option<(usize, u64)>> {
        let (mut lo, mut hi) = (0, self.tri_count);
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            let mut r = Reader::new(self.front.get(self.dir_off + mid * DIR_RECORD_LEN..)?);
            let (t, len, off) = (r.u32()?, r.u32()? as usize, r.u64()?);
            match t.cmp(&key) {
                std::cmp::Ordering::Equal => {
                    let end = off.checked_add(len as u64)?;
                    return (off >= self.post_off as u64 && end <= self.paths_off as u64)
                        .then_some(Some((len, off)));
                }
                std::cmp::Ordering::Less => lo = mid + 1,
                std::cmp::Ordering::Greater => hi = mid,
            }
        }
        Some(None)
    }

    /// For a literal of at least 3 bytes, which entries contain every
    /// trigram of it, indexed by entry number. `None` when the index cannot
    /// filter: a shorter literal, or an unreadable posting list.
    pub fn candidates(&self, literal: &[u8]) -> Option<Vec<bool>> {
        if literal.len() < 3 {
            return None;
        }
        let mut keys: Vec<u32> = literal.windows(3).map(trigram).collect();
        keys.sort_unstable();
        keys.dedup();
        let mut lists = Vec::new();
        for key in keys {
            match self.find(key)? {
                Some(location) => lists.push(location),
                None => return Some(vec![false; self.entry_count]),
            }
        }
        lists.sort_unstable();
        let mut found: Option<Vec<u32>> = None;
        for (len, off) in lists {
            let list = decode_postings(&self.source.read_at(off, len)?, self.entry_count)?;
            let next = match found {
                None => list,
                Some(previous) => intersect(&previous, &list),
            };
            let empty = next.is_empty();
            found = Some(next);
            if empty {
                break;
            }
        }
        let mut candidates = vec![false; self.entry_count];
        for entry in found? {
            candidates[entry as usize] = true;
        }
        Some(candidates)
    }

    /// The path and blob id of every entry, in entry order.
    pub fn entries(&self) -> Option<Vec<(String, String)>> {
        let blob = self
            .source
            .read_at(self.paths_off as u64, self.total_len - self.paths_off)?;
        let mut out = Vec::with_capacity(self.entry_count);
        let mut start = 0usize;
        for i in 0..self.entry_count {
            let at = self.records_off + i * RECORD_LEN;
            let end = Reader::new(self.front.get(at..)?).u32()? as usize;
            let path = std::str::from_utf8(blob.get(start..end)?).ok()?;
            let id_at = self.ids_off + i * self.id_len;
            let id = std::str::from_utf8(self.front.get(id_at..id_at + self.id_len)?).ok()?;
            out.push((path.to_owned(), id.to_owned()));
            start = end;
        }
        Some(out)
    }
}

/// The identity of a file as `lstat` reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StatKey {
    pub dev: u64,
    pub ino: u64,
    pub size: u64,
    pub mtime: (i64, i64),
    pub ctime: (i64, i64),
}

impl StatKey {
    pub fn of(meta: &fs::Metadata) -> StatKey {
        StatKey {
            dev: meta.dev(),
            ino: meta.ino(),
            size: meta.size(),
            mtime: (meta.mtime(), meta.mtime_nsec()),
            ctime: (meta.ctime(), meta.ctime_nsec()),
        }
    }
}

/// A wall-clock time in nanoseconds since the Unix epoch.
pub fn total_ns(seconds: i64, nanos: i64) -> i128 {
    i128::from(seconds) * 1_000_000_000 + i128::from(nanos)
}

pub fn now_ns() -> i128 {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_nanos() as i128,
        Err(_) => 0,
    }
}

/// A file is trusted when both its times are more than the window before
/// `start`; exactly the window is too recent.
pub fn trusted_at(stat: &StatKey, start: i128) -> bool {
    [stat.mtime, stat.ctime]
        .iter()
        .all(|&(s, n)| start - total_ns(s, n) > TRUST_WINDOW_NS)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapEntry {
    pub path: String,
    pub entry: u32,
    pub stat: StatKey,
}

/// The files of one root whose working-tree bytes were the commit's bytes.
#[derive(Debug, PartialEq, Eq)]
pub struct Snapshot {
    /// The wall-clock time when the build began, in nanoseconds.
    pub start: i128,
    /// Some file with the commit's bytes was too recent to be recorded.
    pub racy: bool,
    pub index_entries: u32,
    /// In bytewise path order.
    pub entries: Vec<SnapEntry>,
}

fn tree_key(commit: &str, root: &[u8]) -> Vec<u8> {
    let mut key = commit.as_bytes().to_vec();
    key.push(0);
    key.extend_from_slice(root);
    key
}

impl Snapshot {
    pub fn encode(&self, commit: &str, root: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        put_header(&mut out, KIND_TREE, &tree_key(commit, root));
        put_i64(&mut out, self.start.div_euclid(1_000_000_000) as i64);
        put_u32(&mut out, self.start.rem_euclid(1_000_000_000) as u32);
        put_u32(&mut out, u32::from(self.racy));
        put_u32(&mut out, self.index_entries);
        put_u32(&mut out, self.entries.len() as u32);
        for e in &self.entries {
            put_u32(&mut out, e.path.len() as u32);
            out.extend_from_slice(e.path.as_bytes());
            put_u32(&mut out, e.entry);
            put_u64(&mut out, e.stat.dev);
            put_u64(&mut out, e.stat.ino);
            put_u64(&mut out, e.stat.size);
            for (s, n) in [e.stat.mtime, e.stat.ctime] {
                put_i64(&mut out, s);
                put_i64(&mut out, n);
            }
        }
        seal(&mut out);
        out
    }

    /// The snapshot in `bytes` if it is a valid one of `commit` and `root`
    /// made for a commit index of `index_entries` entries.
    pub fn decode(
        bytes: &[u8],
        commit: &str,
        root: &[u8],
        index_entries: usize,
    ) -> Option<Snapshot> {
        let mut r = Reader::new(bytes);
        check_header(
            &mut r,
            KIND_TREE,
            &tree_key(commit, root),
            bytes.len() as u64,
        )?;
        let seconds = r.i64()?;
        let nanos = i64::from(r.u32()?);
        let racy = r.u32()? != 0;
        let recorded = r.u32()?;
        let count = r.u32()? as usize;
        if recorded as usize != index_entries {
            return None;
        }
        let mut entries = Vec::new();
        for _ in 0..count {
            let len = r.u32()? as usize;
            let path = std::str::from_utf8(r.take(len)?).ok()?.to_owned();
            let entry = r.u32()?;
            let (dev, ino, size) = (r.u64()?, r.u64()?, r.u64()?);
            let mtime = (r.i64()?, r.i64()?);
            let ctime = (r.i64()?, r.i64()?);
            if entry as usize >= index_entries {
                return None;
            }
            let stat = StatKey {
                dev,
                ino,
                size,
                mtime,
                ctime,
            };
            entries.push(SnapEntry { path, entry, stat });
        }
        if r.pos != bytes.len() || entries.windows(2).any(|w| w[0].path >= w[1].path) {
            return None;
        }
        Some(Snapshot {
            start: total_ns(seconds, nanos),
            racy,
            index_entries: recorded,
            entries,
        })
    }

    /// A racy snapshot is made again by a search more than the window after
    /// its start.
    pub fn is_stale_at(&self, now: i128) -> bool {
        self.racy && now - self.start > TRUST_WINDOW_NS
    }

    pub fn lookup(&self, rel: &str) -> Option<&SnapEntry> {
        self.entries
            .binary_search_by(|e| e.path.as_str().cmp(rel))
            .ok()
            .map(|i| &self.entries[i])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";
    const ID: &str = "89abcdef0123456789abcdef0123456789abcdef";

    fn sample() -> Vec<u8> {
        let mut b = CommitBuilder::new();
        b.add("a.txt".into(), ID, b"call render here\n");
        b.add("b.bin".into(), ID, b"\xff\xfe render");
        b.add("c.txt".into(), ID, b"renderer only\n");
        b.add("d.txt".into(), ID, b"nothing\n");
        b.finish(COMMIT).unwrap()
    }

    fn open(bytes: Vec<u8>) -> Option<CommitIndex> {
        CommitIndex::open(Source::Memory(bytes), COMMIT)
    }

    #[test]
    fn filters_candidates_by_the_trigrams_of_the_literal() {
        let index = open(sample()).unwrap();
        assert_eq!(index.entry_count(), 4);
        assert_eq!(
            index.candidates(b"render"),
            Some(vec![true, false, true, false])
        );
        assert_eq!(
            index.candidates(b"renderer"),
            Some(vec![false, false, true, false])
        );
        // Every trigram present in some file, but not all in one file.
        assert_eq!(index.candidates(b"call nothing"), Some(vec![false; 4]),);
        assert_eq!(index.candidates(b"zzz"), Some(vec![false; 4]));
        // Literals shorter than 3 bytes give no filter.
        assert_eq!(index.candidates(b"re"), None);
        assert_eq!(index.candidates(b"r"), None);
        // The shortest filtered literal.
        assert_eq!(
            index.candidates(b"ren"),
            Some(vec![true, false, true, false])
        );
    }

    #[test]
    fn non_utf8_blobs_have_no_trigrams_and_are_flagged() {
        let index = open(sample()).unwrap();
        let flags: Vec<_> = (0..4).map(|e| index.is_utf8(e).unwrap()).collect();
        assert_eq!(flags, [true, false, true, true]);
        assert_eq!(index.is_utf8(99), None);
    }

    #[test]
    fn lists_paths_and_ids() {
        let index = open(sample()).unwrap();
        let entries = index.entries().unwrap();
        let paths: Vec<_> = entries.iter().map(|e| e.0.as_str()).collect();
        assert_eq!(paths, ["a.txt", "b.bin", "c.txt", "d.txt"]);
        assert!(entries.iter().all(|e| e.1 == ID));
    }

    #[test]
    fn empty_and_mixed_id_commit_indexes() {
        let empty = CommitBuilder::new().finish(COMMIT).unwrap();
        let index = open(empty).unwrap();
        assert_eq!(index.entry_count(), 0);
        assert_eq!(index.candidates(b"abc"), Some(Vec::new()));
        let mut b = CommitBuilder::new();
        b.add("a".into(), ID, b"abc");
        b.add("b".into(), &ID[..39], b"abc");
        assert!(b.finish(COMMIT).is_none());
    }

    #[test]
    fn rejects_a_commit_index_that_is_not_the_expected_one() {
        let good = sample();
        assert!(open(good.clone()).is_some());
        // Wrong magic, version, kind, key and length.
        let mut bad = good.clone();
        bad[0] ^= 1;
        assert!(open(bad).is_none());
        let mut bad = good.clone();
        bad[8] = 2;
        assert!(open(bad).is_none());
        let mut bad = good.clone();
        bad[12] = 2;
        assert!(open(bad).is_none());
        let mut bad = good.clone();
        bad[COMMON_HEADER] ^= 1;
        assert!(open(bad).is_none());
        assert!(
            CommitIndex::open(Source::Memory(good.clone()), &COMMIT.replace('0', "1")).is_none()
        );
        assert!(open(good[..good.len() - 1].to_vec()).is_none());
        let mut longer = good.clone();
        longer.push(0);
        assert!(open(longer).is_none());
        assert!(open(Vec::new()).is_none());
        assert!(open(good[..20].to_vec()).is_none());
    }

    #[test]
    fn a_corrupt_posting_list_gives_no_filter() {
        let mut bytes = sample();
        let index = open(bytes.clone()).unwrap();
        // Overwrite the posting data with a zero delta.
        for b in &mut bytes[index.post_off..index.paths_off] {
            *b = 0;
        }
        let index = open(bytes).unwrap();
        assert_eq!(index.candidates(b"render"), None);
    }

    fn stat(mtime: i64, ctime: i64) -> StatKey {
        StatKey {
            dev: 1,
            ino: 2,
            size: 3,
            mtime: (mtime, 0),
            ctime: (ctime, 0),
        }
    }

    #[test]
    fn trusts_only_files_more_than_two_seconds_older_than_the_start() {
        let start = total_ns(100, 0);
        assert!(trusted_at(&stat(97, 97), start));
        assert!(trusted_at(&stat(0, 0), start));
        // Exactly two seconds, in either time, is too recent.
        assert!(!trusted_at(&stat(98, 97), start));
        assert!(!trusted_at(&stat(97, 98), start));
        assert!(!trusted_at(&stat(99, 99), start));
        assert!(!trusted_at(&stat(100, 100), start));
        assert!(!trusted_at(&stat(101, 0), start));
        let mut nanos = stat(97, 97);
        nanos.mtime = (98, 0);
        assert!(!trusted_at(&nanos, start));
        nanos.mtime = (97, 999_999_999);
        assert!(trusted_at(&nanos, start));
        nanos.mtime = (98, 0);
        assert!(!trusted_at(&nanos, total_ns(100, 0)));
        assert!(trusted_at(&nanos, total_ns(100, 1)));
    }

    fn snapshot(racy: bool) -> Snapshot {
        Snapshot {
            start: total_ns(1_600_000_000, 123),
            racy,
            index_entries: 4,
            entries: vec![
                SnapEntry {
                    path: "a.txt".into(),
                    entry: 0,
                    stat: stat(1, 2),
                },
                SnapEntry {
                    path: "src/c.txt".into(),
                    entry: 2,
                    stat: stat(3, 4),
                },
            ],
        }
    }

    #[test]
    fn snapshots_round_trip_and_are_validated() {
        let snap = snapshot(true);
        let bytes = snap.encode(COMMIT, b"/work/app");
        assert_eq!(
            Snapshot::decode(&bytes, COMMIT, b"/work/app", 4).as_ref(),
            Some(&snap)
        );
        assert_eq!(snap.lookup("src/c.txt").map(|e| e.entry), Some(2));
        assert!(snap.lookup("src").is_none());
        assert!(Snapshot::decode(&bytes, COMMIT, b"/work/other", 4).is_none());
        assert!(Snapshot::decode(&bytes, COMMIT, b"/work/app", 5).is_none());
        assert!(Snapshot::decode(&bytes, &COMMIT.replace('0', "1"), b"/work/app", 4).is_none());
        assert!(Snapshot::decode(&bytes[..bytes.len() - 1], COMMIT, b"/work/app", 4).is_none());
        let mut longer = bytes.clone();
        longer.push(0);
        assert!(Snapshot::decode(&longer, COMMIT, b"/work/app", 4).is_none());
        for position in [0, 8, 12] {
            let mut bad = bytes.clone();
            bad[position] ^= 1;
            assert!(Snapshot::decode(&bad, COMMIT, b"/work/app", 4).is_none());
        }
        // A commit index is not a snapshot.
        assert!(Snapshot::decode(&sample(), COMMIT, b"/work/app", 4).is_none());
    }

    #[test]
    fn only_a_racy_snapshot_is_made_again_and_only_after_the_window() {
        let racy = snapshot(true);
        let start = racy.start;
        assert!(!racy.is_stale_at(start));
        assert!(!racy.is_stale_at(start + TRUST_WINDOW_NS));
        assert!(racy.is_stale_at(start + TRUST_WINDOW_NS + 1));
        assert!(!snapshot(false).is_stale_at(start + 10 * TRUST_WINDOW_NS));
    }
}
