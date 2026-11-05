//! The shared per-commit search index: outputs, cache files and checkout state
//! of `kogen-context` searches on real Git checkouts in temporary directories.
//! Every search is compared with the same search on a plain copy of the
//! checkout without Git, which has no index.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, SystemTime};

/// 2020-01-01T00:00:00Z
const AGED_SECONDS: u64 = 1_577_836_800;

struct Scenario {
    dir: PathBuf,
    next_plain: usize,
}

#[derive(Clone, Copy)]
enum Search<'a> {
    Request(&'a str),
    Cli,
}

impl Scenario {
    fn new(name: &str) -> Scenario {
        let base = fs::canonicalize(std::env::temp_dir()).unwrap();
        let dir = base.join(format!("kogen-index-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("home")).unwrap();
        Scenario { dir, next_plain: 0 }
    }

    fn cache(&self) -> PathBuf {
        self.dir.join("cache")
    }

    fn path(&self, rel: &str) -> PathBuf {
        self.dir.join(rel)
    }

    fn write(&self, rel: &str, content: &str) {
        let file = self.path(rel);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, content).unwrap();
    }

    fn git(&self, dir: &str, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false"])
            .args(["-c", "init.defaultBranch=main"])
            .args(args)
            .current_dir(self.path(dir))
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap())
            .env("HOME", self.path("home"))
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_AUTHOR_NAME", "Kogen")
            .env("GIT_AUTHOR_EMAIL", "kogen@example.invalid")
            .env("GIT_AUTHOR_DATE", "2020-01-01T00:00:00Z")
            .env("GIT_COMMITTER_NAME", "Kogen")
            .env("GIT_COMMITTER_EMAIL", "kogen@example.invalid")
            .env("GIT_COMMITTER_DATE", "2020-01-01T00:00:00Z")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    }

    /// A committed Git checkout.
    fn checkout(&self, name: &str, files: &[(&str, &str)]) {
        for (rel, content) in files {
            self.write(&format!("{name}/{rel}"), content);
        }
        self.git(name, &["init", "-q"]);
        self.commit(name);
    }

    fn commit(&self, name: &str) {
        self.git(name, &["add", "-A"]);
        self.git(name, &["commit", "-q", "-m", "change"]);
    }

    fn head(&self, name: &str) -> String {
        self.git(name, &["rev-parse", "HEAD"]).trim().to_owned()
    }

    /// Gives every file outside `.git` a whole-second modification time in
    /// 2020 and waits until its change time is more than 2 seconds old.
    fn age(&self) {
        let aged = SystemTime::UNIX_EPOCH + Duration::from_secs(AGED_SECONDS);
        fn walk(dir: &Path, aged: SystemTime) {
            for entry in fs::read_dir(dir).unwrap().flatten() {
                let kind = entry.file_type().unwrap();
                if kind.is_dir() {
                    if entry.file_name() != ".git" {
                        walk(&entry.path(), aged);
                    }
                } else if kind.is_file() {
                    set_mtime(&entry.path(), aged);
                }
            }
        }
        for entry in fs::read_dir(&self.dir).unwrap().flatten() {
            if entry.file_name() != "cache" && entry.file_name() != "home" {
                walk(&entry.path(), aged);
            }
        }
        std::thread::sleep(Duration::from_millis(3200));
    }

    fn env(&self, command: &mut Command) {
        command
            .env("XDG_CACHE_HOME", self.cache())
            .env("HOME", self.path("home"));
    }

    fn command(&self, search: Search, root: &Path, literal: &str) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_kogen-context"));
        match search {
            Search::Request(_) => command.arg("request"),
            Search::Cli => command.args(["search", root.to_str().unwrap(), literal]),
        };
        self.env(&mut command);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }

    fn run(&self, search: Search, root: &Path, literal: &str) -> Output {
        let mut child = self.command(search, root, literal).spawn().unwrap();
        feed(&mut child, search, root, literal);
        child.wait_with_output().unwrap()
    }

    /// Searches `root` (a path below the scenario directory) and checks that
    /// the output is byte for byte the one on a plain copy of its checkout
    /// and that the checkouts did not change. Returns the stdout.
    fn search(&mut self, root: &str, literal: &str, search: Search) -> String {
        let before = self.checkouts_state();
        let out = self.run(search, &self.path(root), literal);
        assert_eq!(
            self.checkouts_state(),
            before,
            "a search changed a checkout"
        );
        self.assert_like_plain(root, literal, search, &out);
        String::from_utf8(out.stdout).unwrap()
    }

    fn assert_like_plain(&mut self, root: &str, literal: &str, search: Search, out: &Output) {
        assert!(
            out.stderr.is_empty(),
            "stderr: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let top = root.split('/').next().unwrap();
        self.next_plain += 1;
        let plain_dir = self.path(&format!("plain-{}", self.next_plain));
        copy_without_git(&self.path(top), &plain_dir.join(top));
        let plain_root = plain_dir.join(root);
        let mut command = self.command(search, &plain_root, literal);
        let unused = plain_dir.join("unused-cache");
        command
            .env("XDG_CACHE_HOME", &unused)
            .env("HOME", plain_dir.join("unused-home"));
        let mut child = command.spawn().unwrap();
        feed(&mut child, search, &plain_root, literal);
        let plain = child.wait_with_output().unwrap();
        assert!(!unused.exists() && !plain_dir.join("unused-home").exists());
        fs::remove_dir_all(&plain_dir).unwrap();
        assert_eq!(out.status.code(), plain.status.code());
        assert_eq!(
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&plain.stdout)
        );
        assert_eq!(out.status.code(), Some(0));
    }

    /// Every file and directory below the scenario's checkouts with what
    /// `lstat` and the content show, `.git` included.
    fn checkouts_state(&self) -> BTreeMap<PathBuf, String> {
        let mut state = BTreeMap::new();
        for entry in fs::read_dir(&self.dir).unwrap().flatten() {
            let name = entry.file_name();
            let name = name.to_str().unwrap();
            if !matches!(name, "cache" | "home") && !name.starts_with("plain-") {
                record(&entry.path(), &mut state);
            }
        }
        state
    }

    /// The files in the cache directory, relative to it, with their state.
    fn cache_state(&self) -> BTreeMap<PathBuf, String> {
        let mut state = BTreeMap::new();
        if self.cache().exists() {
            record(&self.cache(), &mut state);
        }
        state
    }

    fn cache_files(&self) -> Vec<String> {
        let mut files = Vec::new();
        fn walk(dir: &Path, base: &Path, files: &mut Vec<String>) {
            for entry in fs::read_dir(dir).unwrap().flatten() {
                if entry.file_type().unwrap().is_dir() {
                    walk(&entry.path(), base, files);
                } else {
                    let rel = entry.path().strip_prefix(base).unwrap().to_owned();
                    files.push(rel.to_str().unwrap().to_owned());
                }
            }
        }
        if self.cache().exists() {
            walk(&self.cache(), &self.cache(), &mut files);
        }
        files.sort();
        files
    }

    fn commit_file(&self, name: &str) -> String {
        format!("kogen-context/index-v1/commits/{}", self.head(name))
    }

    fn tree_file(&self, commit: &str, root: &str) -> String {
        let canonical = fs::canonicalize(self.path(root)).unwrap();
        format!(
            "kogen-context/index-v1/trees/{commit}-{}",
            fnv1a(canonical.to_str().unwrap().as_bytes())
        )
    }
}

impl Drop for Scenario {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn feed(child: &mut std::process::Child, search: Search, root: &Path, literal: &str) {
    let mut stdin = child.stdin.take().unwrap();
    if let Search::Request(order) = search {
        let request = format!(
            "{{\"version\":1,\"root\":\"{}\",\"operation\":\"search\",\"literal\":\"{literal}\",\"order\":\"{order}\"}}\n",
            root.to_str().unwrap()
        );
        stdin.write_all(request.as_bytes()).unwrap();
    }
}

fn set_mtime(path: &Path, time: SystemTime) {
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(time)
        .unwrap();
}

fn fnv1a(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        hash = (hash ^ u64::from(b)).wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn copy_without_git(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap().flatten() {
        if entry.file_name() == ".git" {
            continue;
        }
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_without_git(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn record(path: &Path, state: &mut BTreeMap<PathBuf, String>) {
    let meta = fs::symlink_metadata(path).unwrap();
    let content = if meta.is_file() {
        format!("{:?}", fs::read(path).unwrap())
    } else {
        String::new()
    };
    state.insert(
        path.to_owned(),
        format!(
            "mode {:o} ino {} size {} mtime {}.{} ctime {}.{} {content}",
            meta.mode(),
            meta.ino(),
            meta.size(),
            meta.mtime(),
            meta.mtime_nsec(),
            meta.ctime(),
            meta.ctime_nsec()
        ),
    );
    if meta.is_dir() {
        for entry in fs::read_dir(path).unwrap().flatten() {
            record(&entry.path(), state);
        }
    }
}

fn sorted(mut files: Vec<String>) -> Vec<String> {
    files.sort();
    files
}

fn matches(output: &str) -> Vec<(String, u64)> {
    let mut found = Vec::new();
    for part in output.split("{\"path\":").skip(1) {
        let path = part.split('"').nth(1).unwrap().to_owned();
        let line = part
            .split("\"line\":")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap();
        found.push((path, line.parse().unwrap()));
    }
    found
}

fn names(found: &[(String, u64)]) -> Vec<String> {
    found.iter().map(|(p, l)| format!("{p}:{l}")).collect()
}

const APP: [(&str, &str); 7] = [
    (".gitignore", "build/\n"),
    ("README.md", "Call render to draw.\n"),
    ("src/draw.go", "package view\n\nfunc draw() { redraw() }\n"),
    ("src/keep.go", "package view\n\nvar keep = redraw // keep\n"),
    ("src/list.go", "package view\n\nfunc list() { render() }\n"),
    ("src/old.go", "package view\n\nvar old = render\n"),
    (
        "src/view.go",
        "package view\n\nfunc render() int { return 1 }\n",
    ),
];

#[test]
fn the_first_search_writes_the_shared_index_and_later_searches_only_read_it() {
    let mut s = Scenario::new("first");
    s.checkout("app", &APP);
    s.age();
    let first = s.search("app", "render", Search::Request("path"));
    assert_eq!(
        names(&matches(&first)),
        [
            "README.md:1",
            "src/list.go:3",
            "src/old.go:3",
            "src/view.go:3"
        ]
    );
    let commit = s.head("app");
    assert_eq!(
        s.cache_files(),
        sorted(vec![s.commit_file("app"), s.tree_file(&commit, "app")])
    );
    for (path, state) in s.cache_state() {
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        let expected = if path.is_dir() { 0o700 } else { 0o600 };
        assert_eq!(mode, expected, "{path:?} {state}");
    }
    let noted = s.cache_state();
    let ranked = s.search("app", "render", Search::Request("ranked"));
    assert_eq!(
        names(&matches(&ranked)),
        [
            "src/view.go:3",
            "src/list.go:3",
            "src/old.go:3",
            "README.md:1"
        ]
    );
    s.search("app", "render", Search::Cli);
    assert_eq!(s.search("app", "render", Search::Request("path")), first);
    assert_eq!(s.cache_state(), noted, "searches rewrote the cache");
}

#[test]
fn edited_added_ignored_and_deleted_files_are_seen_without_rebuilding() {
    let mut s = Scenario::new("overlay");
    s.checkout("app", &APP);
    s.age();
    s.search("app", "render", Search::Request("path"));
    let noted = s.cache_state();

    s.write(
        "app/src/draw.go",
        "package view\n\nfunc draw() { render() }\n",
    );
    // The same size and the old modification time: only the change time shows it.
    let keep = s.path("app/src/keep.go");
    let before = fs::metadata(&keep).unwrap();
    fs::write(&keep, "package view\n\nvar keep = render // keep\n").unwrap();
    assert_eq!(fs::metadata(&keep).unwrap().len(), before.len());
    set_mtime(
        &keep,
        SystemTime::UNIX_EPOCH + Duration::from_secs(AGED_SECONDS),
    );
    assert_eq!(fs::metadata(&keep).unwrap().mtime(), before.mtime());
    s.write(
        "app/src/list.go",
        "package view\n\nfunc list() { render() }\n\nfunc again() { render() }\n",
    );
    s.write(
        "app/src/view.go",
        "package view\n\nfunc redraw() int { return 1 }\n",
    );
    fs::remove_file(s.path("app/src/old.go")).unwrap();
    s.write("app/src/new.go", "package view\n\nvar fresh = render()\n");
    s.write("app/build/out.txt", "render output\n");

    let path = s.search("app", "render", Search::Request("path"));
    assert_eq!(
        names(&matches(&path)),
        [
            "README.md:1",
            "build/out.txt:1",
            "src/draw.go:3",
            "src/keep.go:3",
            "src/list.go:3",
            "src/list.go:5",
            "src/new.go:3"
        ]
    );
    let ranked = s.search("app", "render", Search::Request("ranked"));
    assert_eq!(
        names(&matches(&ranked)),
        [
            "src/draw.go:3",
            "src/list.go:3",
            "src/list.go:5",
            "src/new.go:3",
            "src/keep.go:3",
            "README.md:1",
            "build/out.txt:1"
        ]
    );
    s.search("app", "render", Search::Cli);
    assert_eq!(s.cache_state(), noted, "edits rebuilt the index");

    // A subdirectory root has its own snapshot of the same commit index.
    let sub = s.search("app/src", "render", Search::Request("path"));
    assert_eq!(
        names(&matches(&sub)),
        [
            "draw.go:3",
            "keep.go:3",
            "list.go:3",
            "list.go:5",
            "new.go:3"
        ]
    );
    let commit = s.head("app");
    assert_eq!(
        s.cache_files(),
        sorted(vec![
            s.commit_file("app"),
            s.tree_file(&commit, "app"),
            s.tree_file(&commit, "app/src")
        ])
    );

    // A new commit gets its own commit index and snapshot.
    s.commit("app");
    let previous = commit;
    let commit = s.head("app");
    assert_ne!(previous, commit);
    assert_eq!(s.search("app", "render", Search::Request("path")), path);
    let files = s.cache_files();
    for expected in [
        s.commit_file("app"),
        format!("kogen-context/index-v1/commits/{previous}"),
        s.tree_file(&commit, "app"),
        s.tree_file(&previous, "app"),
    ] {
        assert!(files.contains(&expected), "{expected} is not in {files:?}");
    }
}

#[test]
fn two_worktrees_of_a_commit_share_its_index_and_see_only_their_own_edits() {
    let mut s = Scenario::new("worktrees");
    s.checkout("app", &APP);
    let wt = s.path("wt");
    s.git(
        "app",
        &[
            "worktree",
            "add",
            "-q",
            "--detach",
            wt.to_str().unwrap(),
            "HEAD",
        ],
    );
    s.age();
    let in_app = s.search("app", "render", Search::Request("path"));
    assert_eq!(s.search("wt", "render", Search::Request("path")), in_app);
    s.write("wt/src/new.go", "package view\n\nvar fresh = render()\n");
    let in_wt = s.search("wt", "render", Search::Request("path"));
    assert!(in_wt.contains("src/new.go") && !in_app.contains("src/new.go"));
    assert_eq!(s.search("app", "render", Search::Request("path")), in_app);
    let commit = s.head("app");
    let mut expected = vec![
        s.commit_file("app"),
        s.tree_file(&commit, "app"),
        s.tree_file(&commit, "wt"),
    ];
    expected.sort();
    assert_eq!(s.cache_files(), expected);
}

#[test]
fn concurrent_searches_on_an_empty_cache_leave_one_complete_index() {
    let mut s = Scenario::new("concurrent");
    s.checkout("app", &APP);
    let wt = s.path("wt");
    s.git(
        "app",
        &[
            "worktree",
            "add",
            "-q",
            "--detach",
            wt.to_str().unwrap(),
            "HEAD",
        ],
    );
    s.age();
    let mut children = Vec::new();
    for round in 0..4 {
        for root in ["app", "wt"] {
            let search = Search::Request(if round % 2 == 0 { "path" } else { "ranked" });
            let mut child = s.command(search, &s.path(root), "render").spawn().unwrap();
            feed(&mut child, search, &s.path(root), "render");
            children.push((root, search, child));
        }
    }
    for (root, search, child) in children {
        let out = child.wait_with_output().unwrap();
        s.assert_like_plain(root, "render", search, &out);
    }
    let commit = s.head("app");
    let mut expected = vec![
        s.commit_file("app"),
        s.tree_file(&commit, "app"),
        s.tree_file(&commit, "wt"),
    ];
    expected.sort();
    assert_eq!(s.cache_files(), expected);
    let noted = s.cache_state();
    s.search("app", "render", Search::Request("path"));
    s.search("wt", "render", Search::Request("ranked"));
    assert_eq!(s.cache_state(), noted);
}

#[test]
fn a_snapshot_made_while_files_were_recent_is_made_again_once_later() {
    let mut s = Scenario::new("racy");
    s.checkout("app", &APP);
    s.search("app", "render", Search::Request("path"));
    s.write(
        "app/src/draw.go",
        "package view\n\nfunc draw() { render() }\n",
    );
    let before = s.cache_state();
    s.age();
    let tree = s.tree_file(&s.head("app"), "app");
    let out = s.search("app", "render", Search::Request("path"));
    assert!(out.contains("src/draw.go"));
    let after = s.cache_state();
    let changed: Vec<_> = after
        .iter()
        .filter(|(path, state)| before.get(*path) != Some(state))
        .map(|(path, _)| {
            path.strip_prefix(s.cache())
                .unwrap()
                .to_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    assert!(changed.contains(&tree), "{changed:?}");
    assert!(!changed.contains(&s.commit_file("app")), "{changed:?}");
    s.search("app", "render", Search::Request("ranked"));
    assert_eq!(
        s.cache_state(),
        after,
        "a snapshot without racy files was rewritten"
    );
}

#[test]
fn no_index_and_nothing_written_without_a_git_checkout_or_a_cache_outside_the_root() {
    let mut s = Scenario::new("no-index");
    s.checkout(
        "app",
        &[
            ("README.md", "Call render to draw.\n"),
            ("src/list.go", "func list() { render() }\n"),
        ],
    );
    s.write("notes/notes.md", "Call render to draw.\n");
    s.write("notes/a/b.go", "var x = render\n");
    s.age();
    let home = s.path("home");
    let cases: [(&str, Option<PathBuf>, Option<PathBuf>); 6] = [
        ("notes", Some(s.cache()), Some(home.clone())),
        ("app", Some(s.path("app/cache-inside")), Some(home.clone())),
        ("app", None, Some(s.path("app"))),
        ("app", None, None),
        ("app", None, Some(PathBuf::from("relative-home"))),
        (
            "app",
            Some(PathBuf::from("relative/cache")),
            Some(PathBuf::from("")),
        ),
    ];
    for (root, xdg, home) in cases {
        for search in [Search::Request("path"), Search::Cli] {
            let before = s.checkouts_state();
            let mut command = s.command(search, &s.path(root), "render");
            command.env_remove("XDG_CACHE_HOME").env_remove("HOME");
            if let Some(xdg) = &xdg {
                command.env("XDG_CACHE_HOME", xdg);
            }
            if let Some(home) = &home {
                command.env("HOME", home);
            }
            let mut child = command.spawn().unwrap();
            feed(&mut child, search, &s.path(root), "render");
            let out = child.wait_with_output().unwrap();
            s.assert_like_plain(root, "render", search, &out);
            assert_eq!(s.checkouts_state(), before, "{root} {xdg:?} {home:?}");
        }
    }
    // Nothing but the checkouts and the empty home was created.
    assert!(!s.cache().exists());
    let mut top: Vec<_> = fs::read_dir(&s.dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_str().unwrap().to_owned())
        .collect();
    top.sort();
    assert_eq!(top, ["app", "home", "notes"]);
    assert_eq!(fs::read_dir(s.path("home")).unwrap().count(), 0);
}

#[test]
fn invalid_index_files_are_rebuilt_and_an_unwritable_cache_is_no_error() {
    let mut s = Scenario::new("invalid");
    s.checkout("app", &APP);
    s.age();
    let expected = s.search("app", "render", Search::Request("path"));
    let commit = s.head("app");
    let files = [s.commit_file("app"), s.tree_file(&commit, "app")];
    for file in &files {
        let path = s.cache().join(file);
        let good = fs::read(&path).unwrap();
        // Truncated, one byte longer, wrong magic and wrong version.
        let mut longer = good.clone();
        longer.push(0);
        let mut magic = good.clone();
        magic[0] ^= 1;
        let mut version = good.clone();
        version[8] = 2;
        for bad in [
            good[..good.len() - 1].to_vec(),
            longer,
            magic,
            version,
            Vec::new(),
        ] {
            fs::write(&path, &bad).unwrap();
            assert_eq!(s.search("app", "render", Search::Request("path")), expected);
            let rebuilt = fs::read(&path).unwrap();
            // The recorded total length is the file's length.
            let recorded = u64::from_le_bytes(rebuilt[16..24].try_into().unwrap());
            assert_eq!(recorded, rebuilt.len() as u64, "{file} was not rebuilt");
            assert_eq!(rebuilt.len(), good.len(), "{file} was not rebuilt");
            assert!(rebuilt[..16] == good[..16], "{file} was not rebuilt");
            // The commit index is built the same every time.
            if file.contains("commits") {
                assert!(rebuilt == good, "{file}");
            }
            let noted = s.cache_state();
            s.search("app", "render", Search::Request("ranked"));
            assert_eq!(s.cache_state(), noted, "a valid {file} was rewritten");
        }
    }
    // Nothing is left but the final files.
    assert_eq!(s.cache_files().len(), 2);

    // A cache that cannot be written: the search answers by the full scan.
    let _ = fs::remove_dir_all(s.cache());
    fs::create_dir_all(s.cache()).unwrap();
    fs::set_permissions(s.cache(), fs::Permissions::from_mode(0o500)).unwrap();
    let writable = fs::write(s.cache().join("probe"), "x").is_ok();
    if !writable {
        assert_eq!(s.search("app", "render", Search::Request("path")), expected);
        assert!(!s.search("app", "render", Search::Cli).is_empty());
        assert_eq!(fs::read_dir(s.cache()).unwrap().count(), 0);
    }
    fs::set_permissions(s.cache(), fs::Permissions::from_mode(0o700)).unwrap();
}

#[test]
fn without_git_the_search_falls_back_and_a_warm_search_needs_no_program() {
    let mut s = Scenario::new("no-program");
    s.checkout("app", &APP);
    s.age();
    let empty_path = s.path("empty-path");
    fs::create_dir(&empty_path).unwrap();
    let run = |s: &Scenario| {
        let search = Search::Request("path");
        let mut command = s.command(search, &s.path("app"), "render");
        command.env("PATH", &empty_path);
        let mut child = command.spawn().unwrap();
        feed(&mut child, search, &s.path("app"), "render");
        child.wait_with_output().unwrap()
    };
    // Cold and without git: the full scan, nothing written.
    let out = run(&s);
    assert_eq!(out.status.code(), Some(0));
    assert!(out.stderr.is_empty());
    assert!(s.cache_files().is_empty());
    let expected = s.search("app", "render", Search::Request("path"));
    assert_eq!(String::from_utf8_lossy(&out.stdout), expected);
    // Warm and without git: the same packet from the index, nothing written.
    assert_eq!(s.cache_files().len(), 2);
    let noted = s.cache_state();
    let out = run(&s);
    assert_eq!(String::from_utf8_lossy(&out.stdout), expected);
    assert_eq!(s.cache_state(), noted);
}
