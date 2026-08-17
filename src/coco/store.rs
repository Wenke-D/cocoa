//! The private store (convention §5).
//!
//! Everything that is coco's own state — and nothing that belongs to a
//! folder — lives in `~/.local/share/coco/store.json`: registered folder
//! paths, the values of each entity's most recent start, and a monotonic
//! run-id counter. The counter is persisted at allocation, so an id is never
//! handed out twice, even across a crash.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::coco::error::CocoError;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Store {
    /// Registered folder paths. Adding a folder is registration, and it
    /// persists across sessions.
    pub entities: Vec<PathBuf>,
    /// Values used by the most recent start of each entity, keyed by the
    /// entity's platform-wide unique manifest name.
    pub last_args: BTreeMap<String, BTreeMap<String, String>>,
    /// Monotonic counter; run ids are platform-unique, allocated once, never
    /// reused.
    pub next_run_id: u64,
}

impl Store {
    pub fn load(path: &Path) -> Result<Self, CocoError> {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| CocoError::store(path, format!("store.json does not parse: {e}"))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(source) => Err(CocoError::io(path, source)),
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), CocoError> {
        let json = serde_json::to_vec_pretty(self)
            .map_err(|e| CocoError::store(path, format!("store.json does not serialize: {e}")))?;
        write_atomic(path, &json)
    }

    /// Allocates the next run id and persists immediately (§5).
    pub fn allocate_run_id(&mut self, path: &Path) -> Result<u64, CocoError> {
        let id = self.next_run_id;
        self.next_run_id += 1;
        self.save(path)?;
        Ok(id)
    }

    pub fn contains(&self, path: &Path) -> bool {
        self.entities.iter().any(|registered| registered == path)
    }

    pub fn add(&mut self, path: PathBuf) {
        if !self.contains(&path) {
            self.entities.push(path);
        }
    }

    pub fn remove(&mut self, path: &Path) -> bool {
        let before = self.entities.len();
        self.entities.retain(|registered| registered != path);
        self.entities.len() != before
    }
}

/// Writes a file atomically: temp file, then rename (convention §12).
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), CocoError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|source| CocoError::io(parent, source))?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "out".to_owned());
    let tmp = parent.join(format!(".{file_name}.tmp.{}", std::process::id()));

    fs::write(&tmp, bytes).map_err(|source| CocoError::io(&tmp, source))?;
    let file = fs::File::open(&tmp).map_err(|source| CocoError::io(&tmp, source))?;
    file.sync_all()
        .map_err(|source| CocoError::io(&tmp, source))?;
    fs::rename(&tmp, path).map_err(|source| CocoError::io(path, source))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tempfile::TempDir;

    use super::Store;

    #[test]
    fn missing_store_is_default_and_round_trips() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("store.json");
        let store = Store::load(&path).unwrap();
        assert_eq!(store.next_run_id, 0);
        store.save(&path).unwrap();
        let reloaded = Store::load(&path).unwrap();
        assert_eq!(reloaded, store);
    }

    #[test]
    fn ids_are_monotonic_and_persisted_at_allocation() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("store.json");
        let mut store = Store::load(&path).unwrap();
        assert_eq!(store.allocate_run_id(&path).unwrap(), 0);
        assert_eq!(store.allocate_run_id(&path).unwrap(), 1);

        let mut reloaded = Store::load(&path).unwrap();
        assert_eq!(reloaded.next_run_id, 2);
        assert_eq!(reloaded.allocate_run_id(&path).unwrap(), 2);
    }

    #[test]
    fn add_is_idempotent_and_remove_works() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("store.json");
        let mut store = Store::load(&path).unwrap();
        let folder = PathBuf::from("/abs/exp");
        store.add(folder.clone());
        store.add(folder.clone());
        assert_eq!(store.entities.len(), 1);
        assert!(store.remove(&folder));
        assert!(!store.remove(&folder));
    }
}
