use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

/// Named blobs persisted by the vault and the throttle. Writes must be atomic: after a
/// crash a reader sees the old complete contents or the new complete contents.
pub trait Storage: Send + Sync {
    fn read(&self, name: &str) -> io::Result<Option<Vec<u8>>>;
    fn write_atomic(&self, name: &str, data: &[u8]) -> io::Result<()>;
}

pub struct FsStorage {
    dir: PathBuf,
}

impl FsStorage {
    pub fn new(dir: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }
}

impl Storage for FsStorage {
    fn read(&self, name: &str) -> io::Result<Option<Vec<u8>>> {
        match fs::read(self.dir.join(name)) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Temp file in the same directory, fsync, rename over the target, fsync the
    /// directory. Files are owner-only (0600) on Unix.
    fn write_atomic(&self, name: &str, data: &[u8]) -> io::Result<()> {
        let target = self.dir.join(name);
        let tmp = self.dir.join(format!("{name}.tmp"));
        let mut opts = OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let result = (|| {
            let mut f = opts.open(&tmp)?;
            f.write_all(data)?;
            f.sync_all()?;
            drop(f);
            fs::rename(&tmp, &target)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
            return result;
        }
        #[cfg(unix)]
        File::open(&self.dir)?.sync_all()?;
        Ok(())
    }
}

#[cfg(test)]
pub mod mem {
    use super::Storage;
    use std::collections::HashMap;
    use std::io;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    /// In-memory storage whose writes can be made to fail, to test interrupted saves.
    #[derive(Default, Clone)]
    pub struct MemStorage {
        pub files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
        pub fail_writes: Arc<AtomicBool>,
    }

    impl Storage for MemStorage {
        fn read(&self, name: &str) -> io::Result<Option<Vec<u8>>> {
            Ok(self.files.lock().unwrap().get(name).cloned())
        }

        fn write_atomic(&self, name: &str, data: &[u8]) -> io::Result<()> {
            if self.fail_writes.load(Ordering::SeqCst) {
                return Err(io::Error::other("injected write failure"));
            }
            self.files
                .lock()
                .unwrap()
                .insert(name.to_string(), data.to_vec());
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_and_replace() {
        let dir = tempfile::tempdir().unwrap();
        let s = FsStorage::new(dir.path().to_path_buf()).unwrap();
        assert_eq!(s.read("a").unwrap(), None);
        s.write_atomic("a", b"one").unwrap();
        s.write_atomic("a", b"two").unwrap();
        assert_eq!(s.read("a").unwrap().unwrap(), b"two");
        // No temp file is left behind after a successful write.
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["a"]);
    }

    #[cfg(unix)]
    #[test]
    fn files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let s = FsStorage::new(dir.path().to_path_buf()).unwrap();
        s.write_atomic("vault.json", b"x").unwrap();
        let mode = fs::metadata(dir.path().join("vault.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn failed_write_keeps_old_contents_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let s = FsStorage::new(dir.path().to_path_buf()).unwrap();
        s.write_atomic("a", b"old").unwrap();
        // A directory squatting on the temp name makes the write fail before the rename.
        fs::create_dir(dir.path().join("a.tmp")).unwrap();
        assert!(s.write_atomic("a", b"new").is_err());
        assert_eq!(s.read("a").unwrap().unwrap(), b"old");
    }

    #[test]
    fn stale_temp_file_from_a_crash_is_ignored_and_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let s = FsStorage::new(dir.path().to_path_buf()).unwrap();
        s.write_atomic("a", b"complete").unwrap();
        fs::write(dir.path().join("a.tmp"), b"partial garb").unwrap();
        assert_eq!(s.read("a").unwrap().unwrap(), b"complete");
        s.write_atomic("a", b"next").unwrap();
        assert_eq!(s.read("a").unwrap().unwrap(), b"next");
    }
}
