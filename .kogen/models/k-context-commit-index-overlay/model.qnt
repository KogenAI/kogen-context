// The overlay rule of the kogen-context search index: a file of the checkout
// is served from the commit index only while the tree snapshot trusts it and
// its stat (mtime, ctime, inode) still equals the recorded one. Times are
// ticks of the file system's timestamp granularity; WINDOW is the number of
// ticks a file must be older than the snapshot's start to be trusted.
module overlay {
  pure val PATHS: Set[str] = Set("a", "b")
  pure val INODES: Set[int] = Set(1, 2, 3)
  pure val CONTENTS: Set[int] = Set(0, 1, 2)
  pure val BLOB: int = 0
  pure val ABSENT: int = -1
  pure val WINDOW: int = 2
  pure val MAX_CLOCK: int = 8

  type FileState = { content: int, mtime: int, ctime: int, ino: int }
  type Entry = { trusted: bool, mtime: int, ctime: int, ino: int }

  pure val NO_FILE: FileState = { content: ABSENT, mtime: 0, ctime: 0, ino: 0 }
  pure val NO_ENTRY: Entry = { trusted: false, mtime: 0, ctime: 0, ino: 0 }

  var clock: int
  var files: str -> FileState
  var snap: str -> Entry
  var snapStart: int
  var snapRacy: bool

  def present(p: str): bool = files.get(p).content != ABSENT
  def liveInodes: Set[int] = PATHS.filter(p => present(p)).map(p => files.get(p).ino)
  pure def oldEnough(f: FileState, now: int): bool = f.mtime < now - WINDOW and f.ctime < now - WINDOW
  pure def entryOf(f: FileState, now: int): Entry =
    { trusted: f.content == BLOB and oldEnough(f, now), mtime: f.mtime, ctime: f.ctime, ino: f.ino }

  // A search reads p from the commit index instead of from the checkout.
  def served(p: str): bool = and {
    snapStart >= 0,
    snap.get(p).trusted,
    present(p),
    snap.get(p).mtime == files.get(p).mtime,
    snap.get(p).ctime == files.get(p).ctime,
    snap.get(p).ino == files.get(p).ino,
  }

  action keepSnapshot = all { snap' = snap, snapStart' = snapStart, snapRacy' = snapRacy }

  action init = all {
    clock' = 0,
    files' = PATHS.mapBy(p => { content: BLOB, mtime: 0, ctime: 0, ino: if (p == "a") 1 else 2 }),
    snap' = PATHS.mapBy(p => NO_ENTRY),
    snapStart' = -1,
    snapRacy' = false,
  }

  action tick = all { clock < MAX_CLOCK, clock' = clock + 1, files' = files, keepSnapshot }

  // Creating a file may reuse the inode number of a removed file.
  action create(p: str, v: int, i: int): bool = all {
    not(present(p)),
    not(liveInodes.contains(i)),
    files' = files.set(p, { content: v, mtime: clock, ctime: clock, ino: i }),
    clock' = clock,
    keepSnapshot,
  }

  action write(p: str, v: int): bool = all {
    present(p),
    files' = files.set(p, { content: v, mtime: clock, ctime: clock, ino: files.get(p).ino }),
    clock' = clock,
    keepSnapshot,
  }

  // A tool that sets an older modification time (touch -r, cp -p, rsync -t).
  action setModified(p: str, t: int): bool = all {
    present(p),
    t <= clock,
    files' = files.set(p, { content: files.get(p).content, mtime: t, ctime: clock, ino: files.get(p).ino }),
    clock' = clock,
    keepSnapshot,
  }

  action remove(p: str): bool = all {
    present(p),
    files' = files.set(p, NO_FILE),
    clock' = clock,
    keepSnapshot,
  }

  // A rename over another path keeps the inode and both times of the source.
  action move(p: str, q: str): bool = all {
    p != q,
    present(p),
    files' = files.set(q, files.get(p)).set(p, NO_FILE),
    clock' = clock,
    keepSnapshot,
  }

  // The first search on the commit makes the snapshot; a snapshot that left
  // out recent files is made again by a search more than WINDOW ticks later.
  action takeSnapshot = all {
    snapStart < 0 or (snapRacy and clock > snapStart + WINDOW),
    snap' = PATHS.mapBy(p => entryOf(files.get(p), clock)),
    snapStart' = clock,
    snapRacy' = PATHS.exists(p => files.get(p).content == BLOB and not(oldEnough(files.get(p), clock))),
    clock' = clock,
    files' = files,
  }

  action step = {
    nondet p = PATHS.oneOf()
    nondet q = PATHS.oneOf()
    nondet v = CONTENTS.oneOf()
    nondet i = INODES.oneOf()
    nondet t = 0.to(MAX_CLOCK).oneOf()
    any { tick, create(p, v, i), write(p, v), setModified(p, t), remove(p), move(p, q), takeSnapshot }
  }

  // Every file served from the commit index has the commit's content.
  val ServedFilesHaveTheCommitContent = PATHS.forall(p => served(p) implies files.get(p).content == BLOB)

  // The snapshot trusts only files more than WINDOW ticks older than its start.
  val TrustedEntriesAreOld = PATHS.forall(p =>
    snap.get(p).trusted implies (snap.get(p).mtime < snapStart - WINDOW and snap.get(p).ctime < snapStart - WINDOW))
}
