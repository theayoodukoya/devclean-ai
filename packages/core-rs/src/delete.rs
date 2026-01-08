use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct DeleteEntry {
    pub path: PathBuf,
    pub is_cache: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePlanItem {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePlan {
    pub items: Vec<DeletePlanItem>,
    pub total_bytes: u64,
}

fn path_id(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn directory_size_bytes(dir: &Path) -> u64 {
    if let Ok(meta) = fs::metadata(dir) {
        if meta.is_file() {
            return meta.len();
        }
    }
    WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|meta| meta.len())
        .sum()
}

fn collect_targets(entries: &[DeleteEntry], deps_only: bool) -> Vec<PathBuf> {
    let mut targets = Vec::new();
    let mut seen = HashSet::new();

    for entry in entries {
        let entry_path = entry.path.clone();
        if deps_only && !entry.is_cache {
            let candidates = [entry_path.join("node_modules"), entry_path.join(".cache")];
            for candidate in candidates {
                if !candidate.exists() {
                    continue;
                }
                let key = path_id(&candidate);
                if seen.insert(key) {
                    targets.push(candidate);
                }
            }
            continue;
        }

        if !entry_path.exists() {
            continue;
        }
        let key = path_id(&entry_path);
        if seen.insert(key) {
            targets.push(entry_path);
        }
    }

    targets
}

pub fn build_delete_plan(entries: &[DeleteEntry], deps_only: bool) -> DeletePlan {
    let mut items = Vec::new();
    let mut total_bytes = 0u64;

    for target in collect_targets(entries, deps_only) {
        let size_bytes = directory_size_bytes(&target);
        total_bytes = total_bytes.saturating_add(size_bytes);
        items.push(DeletePlanItem {
            path: target.to_string_lossy().to_string(),
            size_bytes,
        });
    }

    DeletePlan { items, total_bytes }
}
