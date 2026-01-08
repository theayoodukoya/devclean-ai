use crate::types::RiskAssessment;
use serde::{Deserialize, Serialize};
use dirs::data_dir;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub hash: String,
    pub assessment: RiskAssessment,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheFile {
    pub version: u8,
    pub entries: HashMap<String, CacheEntry>,
}

impl Default for CacheFile {
    fn default() -> Self {
        Self {
            version: 1,
            entries: HashMap::new(),
        }
    }
}

fn root_cache_path(root: &Path) -> PathBuf {
    root.join(".devclean-cache.json")
}

fn app_cache_path(root: &Path) -> Option<PathBuf> {
    let base = data_dir()?.join("devclean-ai").join("cache");
    let mut hasher = Sha256::new();
    hasher.update(root.to_string_lossy().as_bytes());
    let digest = hex::encode(hasher.finalize());
    Some(base.join(format!("cache-{digest}.json")))
}

pub fn cache_path(root: &Path) -> PathBuf {
    root_cache_path(root)
}

pub fn read_cache(root: &Path) -> CacheFile {
    let primary = root_cache_path(root);
    if let Ok(contents) = fs::read_to_string(&primary) {
        return serde_json::from_str(&contents).unwrap_or_default();
    }

    if let Some(fallback) = app_cache_path(root) {
        if let Ok(contents) = fs::read_to_string(&fallback) {
            return serde_json::from_str(&contents).unwrap_or_default();
        }
    }

    CacheFile::default()
}

pub fn write_cache(root: &Path, cache: &CacheFile) -> std::io::Result<()> {
    let data = serde_json::to_string_pretty(cache).unwrap_or_else(|_| "{}".to_string());
    let primary = root_cache_path(root);
    if fs::write(&primary, &data).is_ok() {
        return Ok(());
    }

    if let Some(fallback) = app_cache_path(root) {
        if let Some(parent) = fallback.parent() {
            fs::create_dir_all(parent)?;
        }
        return fs::write(fallback, data);
    }

    Err(io::Error::new(
        io::ErrorKind::Other,
        "Unable to write cache file",
    ))
}

pub fn get_cached_assessment(cache: &CacheFile, key: &str, hash: &str) -> Option<RiskAssessment> {
    cache
        .entries
        .get(key)
        .filter(|entry| entry.hash == hash)
        .map(|entry| entry.assessment.clone())
}

pub fn set_cached_assessment(cache: &mut CacheFile, key: &str, hash: &str, assessment: RiskAssessment) {
    let updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    cache.entries.insert(
        key.to_string(),
        CacheEntry {
            hash: hash.to_string(),
            assessment,
            updated_at,
        },
    );
}

pub fn hash_file(path: &Path) -> Option<String> {
    let data = fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(data);
    Some(hex::encode(hasher.finalize()))
}
