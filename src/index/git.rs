//! Finding the Git directory and HEAD commit of a checkout, and the read-only
//! `git` runs that build an index.

use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::thread::JoinHandle;

/// How many `ref:` contents are followed from HEAD to an object id.
const MAX_REF_HOPS: usize = 5;

/// A checkout: its top directory and its Git directory.
#[derive(Debug, PartialEq, Eq)]
pub struct Checkout {
    pub top: PathBuf,
    pub git_dir: PathBuf,
}

/// The checkout that holds `root`: the first directory from `root` up with a
/// `.git` entry is its top. A `.git` directory is the Git directory; a
/// `.git` file with `gitdir: <path>` names it (relative to the top).
pub fn discover(root: &Path) -> Option<Checkout> {
    let top = root
        .ancestors()
        .find(|dir| fs::symlink_metadata(dir.join(".git")).is_ok())?;
    let dot_git = top.join(".git");
    let meta = fs::metadata(&dot_git).ok()?;
    let git_dir = if meta.is_dir() {
        dot_git
    } else if meta.is_file() {
        let content = fs::read_to_string(&dot_git).ok()?;
        let path = content
            .strip_prefix("gitdir: ")?
            .trim_end_matches(['\n', '\r']);
        if path.is_empty() {
            return None;
        }
        top.join(path)
    } else {
        return None;
    };
    Some(Checkout {
        top: top.to_path_buf(),
        git_dir,
    })
}

fn is_object_id(text: &str) -> bool {
    matches!(text.len(), 40 | 64) && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn read_text(path: &Path) -> Option<String> {
    Some(fs::read_to_string(path).ok()?.trim().to_owned())
}

/// The directory that holds the refs: the path in `<git dir>/commondir`
/// (relative to the Git directory), or the Git directory itself.
fn common_dir(git_dir: &Path) -> PathBuf {
    match read_text(&git_dir.join("commondir")) {
        Some(path) if !path.is_empty() => git_dir.join(path),
        _ => git_dir.to_path_buf(),
    }
}

/// The id of the ref `name`: its loose file in the Git directory or the
/// common directory, else its line in `packed-refs`. The content of a loose
/// file is returned as it is, so that it may be a `ref:` itself.
fn read_ref(git_dir: &Path, common: &Path, name: &str) -> Option<String> {
    let plain = !name.is_empty()
        && !name.starts_with('/')
        && name
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..");
    if !plain {
        return None;
    }
    for dir in [git_dir, common] {
        if let Some(content) = read_text(&dir.join(name)) {
            return Some(content);
        }
    }
    let packed = fs::read_to_string(common.join("packed-refs")).ok()?;
    packed.lines().find_map(|line| {
        let (id, packed_name) = line.split_once(' ')?;
        (packed_name == name && is_object_id(id)).then(|| id.to_owned())
    })
}

/// The commit id in HEAD, read from the files of the Git directory.
pub fn read_head(git_dir: &Path) -> Option<String> {
    let common = common_dir(git_dir);
    let mut content = read_text(&git_dir.join("HEAD"))?;
    for _ in 0..=MAX_REF_HOPS {
        if is_object_id(&content) {
            return Some(content);
        }
        let name = content.strip_prefix("ref:")?.trim().to_owned();
        content = read_ref(git_dir, &common, &name)?;
    }
    None
}

impl Checkout {
    fn command(&self) -> Command {
        let mut command = Command::new("git");
        let mut git_dir = OsString::from("--git-dir=");
        git_dir.push(&self.git_dir);
        command.arg(git_dir).current_dir(&self.top);
        for (name, _) in std::env::vars_os() {
            if name.as_encoded_bytes().starts_with(b"GIT_") {
                command.env_remove(name);
            }
        }
        command
            .env("GIT_NO_LAZY_FETCH", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stderr(Stdio::null());
        command
    }

    /// Runs `git` with the arguments and returns its standard output.
    fn output(&self, args: &[&str]) -> Option<Vec<u8>> {
        let output = self.command().args(args).output().ok()?;
        output.status.success().then_some(output.stdout)
    }

    /// The commit id of HEAD: read from the files, else asked of Git (for
    /// refs that are not in files).
    pub fn head_commit(&self) -> Option<String> {
        if let Some(id) = read_head(&self.git_dir) {
            return Some(id);
        }
        let out = self.output(&["rev-parse", "--verify", "--quiet", "HEAD"])?;
        let id = String::from_utf8(out).ok()?.trim().to_owned();
        is_object_id(&id).then_some(id)
    }

    /// The path and blob id of every regular file (mode 100644 or 100755)
    /// of the commit with a UTF-8 path, in bytewise path order.
    pub fn list_files(&self, commit: &str) -> Option<Vec<(String, String)>> {
        let out = self.output(&["ls-tree", "-r", "-z", "--full-tree", commit])?;
        let mut files = Vec::new();
        for record in out.split(|&b| b == 0).filter(|r| !r.is_empty()) {
            let tab = record.iter().position(|&b| b == b'\t')?;
            let meta = std::str::from_utf8(&record[..tab]).ok()?;
            let mut fields = meta.split(' ');
            let (mode, kind, id) = (fields.next()?, fields.next()?, fields.next()?);
            if kind != "blob" || !matches!(mode, "100644" | "100755") {
                continue;
            }
            if let Ok(path) = std::str::from_utf8(&record[tab + 1..]) {
                files.push((path.to_owned(), id.to_owned()));
            }
        }
        files.sort();
        Some(files)
    }

    /// Starts `git cat-file --batch` for the blobs, in order.
    pub fn cat_blobs(&self, ids: Vec<String>) -> Option<CatFile> {
        let mut child = self
            .command()
            .args(["cat-file", "--batch"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .ok()?;
        let stdin = child.stdin.take()?;
        let stdout = child.stdout.take()?;
        let requested = ids.clone();
        // Another thread feeds the ids, so that neither pipe can fill up.
        let feeder = std::thread::spawn(move || {
            let mut writer = std::io::BufWriter::new(stdin);
            for id in &ids {
                if writeln!(writer, "{id}").is_err() {
                    return;
                }
            }
            let _ = writer.flush();
        });
        Some(CatFile {
            child,
            out: BufReader::new(stdout),
            feeder: Some(feeder),
            requested,
            next: 0,
        })
    }
}

/// A running `git cat-file --batch`.
pub struct CatFile {
    child: Child,
    out: BufReader<ChildStdout>,
    feeder: Option<JoinHandle<()>>,
    requested: Vec<String>,
    next: usize,
}

impl CatFile {
    /// The bytes of the next requested blob; `Ok(None)` when Git reports it
    /// missing.
    pub fn next_blob(&mut self) -> Option<Option<Vec<u8>>> {
        let id = self.requested.get(self.next)?;
        self.next += 1;
        let mut line = Vec::new();
        self.out.read_until(b'\n', &mut line).ok()?;
        if line.pop() != Some(b'\n') {
            return None;
        }
        let line = String::from_utf8(line).ok()?;
        let mut fields = line.split(' ');
        if fields.next()? != id {
            return None;
        }
        match (fields.next()?, fields.next(), fields.next()) {
            ("missing", None, None) => Some(None),
            ("blob", Some(size), None) => {
                let mut blob = vec![0; size.parse().ok()?];
                self.out.read_exact(&mut blob).ok()?;
                let mut newline = [0u8];
                self.out.read_exact(&mut newline).ok()?;
                (newline[0] == b'\n').then_some(Some(blob))
            }
            _ => None,
        }
    }

    /// Whether every blob was answered and Git ended successfully.
    pub fn finish(mut self) -> bool {
        let answered = self.next == self.requested.len();
        let mut rest = Vec::new();
        let drained = self.out.read_to_end(&mut rest).is_ok() && rest.is_empty();
        if let Some(feeder) = self.feeder.take() {
            let _ = feeder.join();
        }
        let ended = self.child.wait().is_ok_and(|status| status.success());
        answered && drained && ended
    }
}

impl Drop for CatFile {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(feeder) = self.feeder.take() {
            let _ = feeder.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    struct Dir(PathBuf);

    impl Dir {
        fn new(name: &str) -> Dir {
            let dir = std::env::temp_dir().join(format!("kogen-git-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Dir(dir)
        }

        fn write(&self, rel: &str, content: &str) -> &Dir {
            let file = self.0.join(rel);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, content).unwrap();
            self
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_first_directory_with_a_dot_git_entry_is_the_top() {
        let d = Dir::new("discover");
        d.write("outer/.git/HEAD", "x")
            .write("outer/inner/sub/file", "x");
        let found = discover(&d.0.join("outer/inner/sub")).unwrap();
        assert_eq!(found.top, d.0.join("outer"));
        assert_eq!(found.git_dir, d.0.join("outer/.git"));
        assert_eq!(discover(&d.0.join("outer")).unwrap().top, d.0.join("outer"));
        // A nearer .git entry wins over an outer one.
        d.write("outer/inner/.git", "gitdir: ../gitdirs/inner\n");
        let found = discover(&d.0.join("outer/inner/sub")).unwrap();
        assert_eq!(found.top, d.0.join("outer/inner"));
        assert_eq!(found.git_dir, d.0.join("outer/inner/../gitdirs/inner"));
    }

    #[test]
    fn a_gitdir_file_names_the_git_directory() {
        let d = Dir::new("gitdir-file");
        d.write("wt/.git", "gitdir: /abs/repo/.git/worktrees/wt\n");
        assert_eq!(
            discover(&d.0.join("wt")).unwrap().git_dir,
            PathBuf::from("/abs/repo/.git/worktrees/wt")
        );
        d.write("wt/.git", "gitdir: rel/dir");
        assert_eq!(
            discover(&d.0.join("wt")).unwrap().git_dir,
            d.0.join("wt/rel/dir")
        );
        for bad in ["", "gitdir:", "gitdir: \n", "ref: x\n", "something else"] {
            d.write("wt/.git", bad);
            assert_eq!(discover(&d.0.join("wt")), None, "{bad:?}");
        }
    }

    #[test]
    fn no_git_entry_means_no_checkout() {
        let d = Dir::new("no-git");
        d.write("a/b/file", "x");
        // The temporary directory is outside every checkout in a test run.
        if discover(&d.0).is_none() {
            assert_eq!(discover(&d.0.join("a/b")), None);
        }
    }

    #[test]
    fn head_holds_a_commit_id() {
        let d = Dir::new("head-id");
        d.write(".git/HEAD", &format!("{A}\n"));
        assert_eq!(read_head(&d.0.join(".git")).as_deref(), Some(A));
        let long = "c".repeat(64);
        d.write(".git/HEAD", &long);
        assert_eq!(read_head(&d.0.join(".git")), Some(long));
        for bad in [
            "",
            &"a".repeat(39),
            &"a".repeat(41),
            &A.to_uppercase(),
            &A.replace('a', "g"),
        ] {
            d.write(".git/HEAD", bad);
            assert_eq!(read_head(&d.0.join(".git")), None, "{bad:?}");
        }
    }

    #[test]
    fn head_follows_a_loose_ref_in_the_git_or_the_common_directory() {
        let d = Dir::new("head-loose");
        d.write(".git/HEAD", "ref: refs/heads/main\n")
            .write(".git/refs/heads/main", &format!("{A}\n"));
        assert_eq!(read_head(&d.0.join(".git")).as_deref(), Some(A));
        // A worktree: HEAD in its own directory, refs in the common directory.
        d.write(".git/worktrees/wt/HEAD", "ref: refs/heads/topic\n")
            .write(".git/worktrees/wt/commondir", "../..\n")
            .write(".git/refs/heads/topic", &format!("{B}\n"));
        assert_eq!(
            read_head(&d.0.join(".git/worktrees/wt")).as_deref(),
            Some(B)
        );
        // The Git directory's own file wins over the common one.
        d.write(".git/worktrees/wt/refs/heads/topic", &format!("{A}\n"));
        assert_eq!(
            read_head(&d.0.join(".git/worktrees/wt")).as_deref(),
            Some(A)
        );
    }

    #[test]
    fn head_follows_a_packed_ref() {
        let d = Dir::new("head-packed");
        d.write(".git/HEAD", "ref: refs/heads/main\n").write(
            ".git/packed-refs",
            &format!("# pack-refs with: peeled\n{B} refs/heads/other\n{A} refs/heads/main\n^{B}\n"),
        );
        assert_eq!(read_head(&d.0.join(".git")).as_deref(), Some(A));
        // A loose ref wins over the packed one.
        d.write(".git/refs/heads/main", &format!("{B}\n"));
        assert_eq!(read_head(&d.0.join(".git")).as_deref(), Some(B));
    }

    #[test]
    fn head_follows_at_most_five_nested_refs() {
        let d = Dir::new("head-nested");
        d.write(".git/HEAD", "ref: refs/r1\n");
        for n in 1..5 {
            d.write(
                &format!(".git/refs/r{n}"),
                &format!("ref: refs/r{}\n", n + 1),
            );
        }
        d.write(".git/refs/r5", A);
        assert_eq!(read_head(&d.0.join(".git")).as_deref(), Some(A));
        d.write(".git/refs/r5", "ref: refs/r6\n")
            .write(".git/refs/r6", A);
        assert_eq!(read_head(&d.0.join(".git")), None);
    }

    #[test]
    fn head_without_an_id_or_with_a_bad_ref_name_gives_none() {
        let d = Dir::new("head-none");
        // An unborn branch.
        d.write(".git/HEAD", "ref: refs/heads/main\n");
        assert_eq!(read_head(&d.0.join(".git")), None);
        d.write(".git/packed-refs", &format!("{A} refs/heads/other\n"));
        assert_eq!(read_head(&d.0.join(".git")), None);
        d.write("secret", &format!("{A}\n"));
        for name in ["../secret", "refs/../../secret", "/secret", "refs//x", ""] {
            d.write(".git/HEAD", &format!("ref: {name}\n"));
            assert_eq!(read_head(&d.0.join(".git")), None, "{name:?}");
        }
        assert_eq!(read_head(&d.0.join("missing")), None);
    }

    fn git(dir: &Path, args: &[&str]) -> Option<String> {
        let out = Command::new("git")
            .args(["-c", "user.name=k", "-c", "user.email=k@example.invalid"])
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8(out.stdout).unwrap().trim().to_owned())
    }

    #[test]
    fn head_commit_of_real_repositories() {
        let d = Dir::new("head-real");
        git(&d.0, &["init", "-q"]).unwrap();
        let checkout = discover(&d.0).unwrap();
        // An unborn branch has no commit.
        assert_eq!(checkout.head_commit(), None);
        d.write("a.txt", "a\n");
        git(&d.0, &["add", "-A"]).unwrap();
        git(&d.0, &["commit", "-q", "-m", "one"]).unwrap();
        let id = git(&d.0, &["rev-parse", "HEAD"]).unwrap();
        assert_eq!(checkout.head_commit().as_deref(), Some(id.as_str()));
        git(&d.0, &["pack-refs", "--all", "--prune"]).unwrap();
        assert_eq!(read_head(&checkout.git_dir).as_deref(), Some(id.as_str()));
        let sub = d.0.join("wt");
        git(
            &d.0,
            &["worktree", "add", "-q", "--detach", sub.to_str().unwrap()],
        )
        .unwrap();
        let linked = discover(&sub).unwrap();
        assert_eq!(linked.head_commit().as_deref(), Some(id.as_str()));
    }

    #[test]
    fn head_commit_asks_git_when_the_refs_are_not_files() {
        let d = Dir::new("head-reftable");
        if git(&d.0, &["init", "-q", "--ref-format=reftable"]).is_none() {
            return;
        }
        d.write("a.txt", "a\n");
        git(&d.0, &["add", "-A"]).unwrap();
        git(&d.0, &["commit", "-q", "-m", "one"]).unwrap();
        let id = git(&d.0, &["rev-parse", "HEAD"]).unwrap();
        let checkout = discover(&d.0).unwrap();
        assert_eq!(read_head(&checkout.git_dir), None);
        assert_eq!(checkout.head_commit().as_deref(), Some(id.as_str()));
    }

    #[test]
    fn lists_regular_files_and_serves_their_blobs() {
        let d = Dir::new("list");
        git(&d.0, &["init", "-q"]).unwrap();
        d.write("b/z.txt", "zed\n")
            .write("a.txt", "a\n")
            .write("b/y.bin", "y");
        std::os::unix::fs::symlink("a.txt", d.0.join("link")).unwrap();
        git(&d.0, &["add", "-A"]).unwrap();
        git(&d.0, &["commit", "-q", "-m", "one"]).unwrap();
        let checkout = discover(&d.0).unwrap();
        let commit = checkout.head_commit().unwrap();
        let files = checkout.list_files(&commit).unwrap();
        let paths: Vec<_> = files.iter().map(|f| f.0.as_str()).collect();
        assert_eq!(paths, ["a.txt", "b/y.bin", "b/z.txt"]);
        let mut cat = checkout
            .cat_blobs(files.iter().map(|f| f.1.clone()).collect())
            .unwrap();
        assert_eq!(cat.next_blob(), Some(Some(b"a\n".to_vec())));
        assert_eq!(cat.next_blob(), Some(Some(b"y".to_vec())));
        assert_eq!(cat.next_blob(), Some(Some(b"zed\n".to_vec())));
        assert!(cat.finish());
        // A blob that is not there is reported missing.
        let mut cat = checkout.cat_blobs(vec!["0".repeat(40)]).unwrap();
        assert_eq!(cat.next_blob(), Some(None));
        assert!(cat.finish());
    }
}
