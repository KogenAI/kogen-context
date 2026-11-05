//! The per-user cache directory of the index files and the atomic writes
//! into it.

use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// The base directory of the caches: an absolute `XDG_CACHE_HOME`, else
/// `Library/Caches` (macOS) or `.cache` (elsewhere) under an absolute `HOME`.
fn base_dir(xdg: Option<OsString>, home: Option<OsString>, macos: bool) -> Option<PathBuf> {
    let absolute = |value: Option<OsString>| value.map(PathBuf::from).filter(|p| p.is_absolute());
    absolute(xdg).or_else(|| {
        absolute(home).map(|home| home.join(if macos { "Library/Caches" } else { ".cache" }))
    })
}

/// `<base>/kogen-context` for the environment of this process.
pub fn cache_dir() -> Option<PathBuf> {
    base_dir(
        std::env::var_os("XDG_CACHE_HOME"),
        std::env::var_os("HOME"),
        cfg!(target_os = "macos"),
    )
    .map(|base| base.join("kogen-context"))
}

/// `path` with symlinks resolved in its longest existing ancestor and the
/// missing components appended.
fn resolve(path: &Path) -> Option<PathBuf> {
    let mut missing: Vec<OsString> = Vec::new();
    let mut current = path.to_path_buf();
    loop {
        if let Ok(mut resolved) = fs::canonicalize(&current) {
            resolved.extend(missing.iter().rev());
            return Some(resolved);
        }
        missing.push(current.file_name()?.to_owned());
        if !current.pop() {
            return None;
        }
    }
}

/// FNV-1a 64-bit hash of the bytes, as 16 lowercase hexadecimal digits.
pub fn fnv1a(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The cache directory of the index files, resolved and outside the root.
pub struct Cache {
    dir: PathBuf,
}

impl Cache {
    /// The cache of the environment, unless there is none or it resolves to
    /// the canonical `root` or inside it.
    pub fn locate(root: &Path) -> Option<Cache> {
        Cache::at(&cache_dir()?, root)
    }

    fn at(dir: &Path, root: &Path) -> Option<Cache> {
        let dir = resolve(dir)?;
        (!dir.starts_with(root)).then_some(Cache { dir })
    }

    fn file(&self, kind: &str, name: &str) -> PathBuf {
        self.dir.join("index-v1").join(kind).join(name)
    }

    pub fn commit_file(&self, commit: &str) -> PathBuf {
        self.file("commits", commit)
    }

    pub fn tree_file(&self, commit: &str, root: &Path) -> PathBuf {
        let key = fnv1a(root.as_os_str().as_bytes());
        self.file("trees", &format!("{commit}-{key}"))
    }
}

/// Publishes `bytes` as the file `target`: written to a temporary file in the
/// same directory, synced, then renamed over the final name. Missing
/// directories are created with mode 0700, the file has mode 0600. Returns
/// whether the file was published; on failure no temporary file is left.
pub fn publish(target: &Path, bytes: &[u8]) -> bool {
    let (Some(dir), Some(name)) = (target.parent(), target.file_name()) else {
        return false;
    };
    if fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .is_err()
    {
        return false;
    }
    let mut temp_name = OsString::from(".");
    temp_name.push(name);
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    temp_name.push(format!(".{}.{counter}.tmp", std::process::id()));
    let temp = dir.join(temp_name);
    let written = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, target)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    written.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn os(s: &str) -> Option<OsString> {
        Some(OsString::from(s))
    }

    #[test]
    fn the_base_is_an_absolute_xdg_cache_home_or_the_home_cache() {
        let base = |xdg, home, macos| base_dir(xdg, home, macos);
        assert_eq!(base(os("/x"), os("/h"), false), Some("/x".into()));
        assert_eq!(base(os("/x"), os("/h"), true), Some("/x".into()));
        assert_eq!(base(os("/x"), None, false), Some("/x".into()));
        assert_eq!(base(None, os("/h"), false), Some("/h/.cache".into()));
        assert_eq!(base(None, os("/h"), true), Some("/h/Library/Caches".into()));
        // An empty or relative XDG_CACHE_HOME is ignored.
        assert_eq!(base(os(""), os("/h"), false), Some("/h/.cache".into()));
        assert_eq!(
            base(os("rel/c"), os("/h"), true),
            Some("/h/Library/Caches".into())
        );
        // No absolute XDG_CACHE_HOME and no absolute HOME: no cache directory.
        assert_eq!(base(None, None, false), None);
        assert_eq!(base(None, os(""), false), None);
        assert_eq!(base(None, os("rel"), false), None);
        assert_eq!(base(os("rel"), os("rel"), true), None);
        assert_eq!(base(os(""), None, true), None);
    }

    struct Dir(PathBuf);

    impl Dir {
        fn new(name: &str) -> Dir {
            let dir = fs::canonicalize(std::env::temp_dir())
                .unwrap()
                .join(format!("kogen-cache-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Dir(dir)
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn resolves_the_longest_existing_ancestor_and_appends_the_rest() {
        let d = Dir::new("resolve");
        fs::create_dir(d.0.join("real")).unwrap();
        std::os::unix::fs::symlink("real", d.0.join("link")).unwrap();
        assert_eq!(
            resolve(&d.0.join("link/missing/kogen-context")),
            Some(d.0.join("real/missing/kogen-context"))
        );
        assert_eq!(resolve(&d.0.join("real")), Some(d.0.join("real")));
        assert_eq!(resolve(&d.0.join("a/../b")), None);
    }

    #[test]
    fn a_cache_inside_the_root_is_refused() {
        let d = Dir::new("inside");
        let root = d.0.join("app");
        fs::create_dir(&root).unwrap();
        std::os::unix::fs::symlink(&root, d.0.join("alias")).unwrap();
        for inside in [
            root.join("cache/kogen-context"),
            root.clone(),
            d.0.join("alias/x/kogen-context"),
            d.0.join("alias"),
        ] {
            assert!(Cache::at(&inside, &root).is_none(), "{inside:?}");
        }
        for outside in [
            d.0.join("cache/kogen-context"),
            d.0.join("app2/kogen-context"),
            d.0.clone(),
        ] {
            assert!(Cache::at(&outside, &root).is_some(), "{outside:?}");
        }
        // Nothing was created by locating the cache.
        assert!(!d.0.join("cache").exists());
        assert!(!root.join("cache").exists());
    }

    #[test]
    fn index_file_names() {
        let cache = Cache {
            dir: PathBuf::from("/c/kogen-context"),
        };
        assert_eq!(
            cache.commit_file("abc"),
            PathBuf::from("/c/kogen-context/index-v1/commits/abc")
        );
        assert_eq!(
            cache.tree_file("abc", Path::new("")),
            PathBuf::from("/c/kogen-context/index-v1/trees/abc-cbf29ce484222325")
        );
        assert_eq!(fnv1a(b"a"), "af63dc4c8601ec8c");
        assert_eq!(fnv1a(b"foobar"), "85944171f73967e8");
    }

    #[test]
    fn publishes_atomically_with_private_modes_and_leaves_no_temporary_file() {
        let d = Dir::new("publish");
        let target = d.0.join("base/kogen-context/index-v1/commits/abc");
        assert!(publish(&target, b"one"));
        assert_eq!(fs::read(&target).unwrap(), b"one");
        assert!(publish(&target, b"two"));
        assert_eq!(fs::read(&target).unwrap(), b"two");
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&target), 0o600);
        let mut dir = target.parent().unwrap();
        while dir != d.0 {
            assert_eq!(mode(dir), 0o700, "{dir:?}");
            dir = dir.parent().unwrap();
        }
        assert_eq!(fs::read_dir(target.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn a_failed_publication_leaves_nothing_behind() {
        let d = Dir::new("publish-fail");
        // The target is a directory: the rename fails and the temporary file goes.
        let target = d.0.join("sub/final");
        fs::create_dir_all(&target).unwrap();
        assert!(!publish(&target, b"x"));
        assert_eq!(fs::read_dir(d.0.join("sub")).unwrap().count(), 1);
        // The directory cannot be created below a file.
        fs::write(d.0.join("file"), "x").unwrap();
        assert!(!publish(&d.0.join("file/dir/final"), b"x"));
    }
}
