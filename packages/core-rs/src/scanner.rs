use crate::risk::has_startup_signal;
use crate::types::{ProjectMeta, ScanProgress};
use dirs::{cache_dir, data_dir, home_dir};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use walkdir::{DirEntry, WalkDir};

const DEFAULT_IGNORES: &[&str] = &[
    "node_modules",
    "dist",
    "build",
    ".git",
    ".next",
    ".cache",
    "coverage",
];

const FULL_DISK_IGNORES_UNIX: &[&str] = &[
    "System",
    "Library",
    "Applications",
    "private",
    "Volumes",
    "proc",
    "dev",
    "sys",
    "run",
    "tmp",
];

const FULL_DISK_IGNORES_WINDOWS: &[&str] = &[
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    "$Recycle.Bin",
    "System Volume Information",
];

fn is_ignored(entry: &DirEntry, scan_all: bool) -> bool {
    let name = entry.file_name().to_string_lossy();
    if DEFAULT_IGNORES.iter().any(|item| *item == name) {
        return true;
    }

    if !scan_all {
        return false;
    }

    #[cfg(target_os = "windows")]
    let full_disk_list = FULL_DISK_IGNORES_WINDOWS;
    #[cfg(not(target_os = "windows"))]
    let full_disk_list = FULL_DISK_IGNORES_UNIX;

    full_disk_list.iter().any(|item| *item == name)
}

fn read_package_json(path: &Path) -> Option<serde_json::Value> {
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn get_dependency_count(pkg: &serde_json::Value) -> usize {
    let keys = [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ];
    keys.iter()
        .filter_map(|key| pkg.get(key))
        .filter_map(|value| value.as_object())
        .map(|map| map.len())
        .sum()
}

fn has_env_file(dir: &Path) -> bool {
    if let Ok(entries) = fs::read_dir(dir) {
        return entries
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with(".env"));
    }
    false
}

fn last_modified_ms(path: &Path) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

fn last_modified_days(ms: i64) -> i64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let delta_ms = now.saturating_sub(ms);
    delta_ms / (1000 * 60 * 60 * 24)
}

fn directory_size_bytes(dir: &Path) -> u64 {
    WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|meta| meta.len())
        .sum()
}

fn path_id(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn dir_exists(path: &Path) -> bool {
    fs::metadata(path).map(|meta| meta.is_dir()).unwrap_or(false)
}

struct CacheCandidate {
    path: PathBuf,
    label: String,
    expand_children: bool,
}

fn gather_cache_candidates() -> Vec<CacheCandidate> {
    let mut candidates: Vec<CacheCandidate> = Vec::new();

    if let Some(path) = cache_dir() {
        candidates.push(CacheCandidate {
            path,
            label: "System cache".to_string(),
            expand_children: true,
        });
    }

    if let Some(path) = home_dir() {
        candidates.push(CacheCandidate {
            path: path.join(".npm"),
            label: "npm cache".to_string(),
            expand_children: false,
        });
        candidates.push(CacheCandidate {
            path: path.join(".yarn").join("cache"),
            label: "yarn cache".to_string(),
            expand_children: false,
        });
        candidates.push(CacheCandidate {
            path: path.join(".yarn"),
            label: "yarn data".to_string(),
            expand_children: false,
        });
        candidates.push(CacheCandidate {
            path: path.join(".pnpm-store"),
            label: "pnpm store".to_string(),
            expand_children: false,
        });
        candidates.push(CacheCandidate {
            path: path.join(".cache").join("yarn"),
            label: "yarn cache".to_string(),
            expand_children: false,
        });
        candidates.push(CacheCandidate {
            path: path.join(".cache").join("npm"),
            label: "npm cache".to_string(),
            expand_children: false,
        });
    }

    if let Some(path) = data_dir() {
        candidates.push(CacheCandidate {
            path: path.join("pnpm").join("store"),
            label: "pnpm store".to_string(),
            expand_children: false,
        });
    }

    if let Some(value) = env::var_os("NPM_CONFIG_CACHE") {
        candidates.push(CacheCandidate {
            path: PathBuf::from(value),
            label: "npm cache".to_string(),
            expand_children: false,
        });
    }
    if let Some(value) = env::var_os("YARN_CACHE_FOLDER") {
        candidates.push(CacheCandidate {
            path: PathBuf::from(value),
            label: "yarn cache".to_string(),
            expand_children: false,
        });
    }
    if let Some(value) = env::var_os("PNPM_STORE_PATH") {
        candidates.push(CacheCandidate {
            path: PathBuf::from(value),
            label: "pnpm store".to_string(),
            expand_children: false,
        });
    }

    candidates
}

fn scan_cache_dirs() -> Vec<ProjectMeta> {
    let mut projects = Vec::new();
    let mut seen = HashSet::new();
    let mut labels: HashMap<String, String> = HashMap::new();

    for candidate in gather_cache_candidates() {
        if !dir_exists(&candidate.path) {
            continue;
        }

        if candidate.expand_children {
            let entries = match fs::read_dir(&candidate.path) {
                Ok(entries) => entries,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let entry_path = entry.path();
                let is_dir = entry
                    .file_type()
                    .map(|file_type| file_type.is_dir())
                    .unwrap_or(false);
                if !is_dir {
                    continue;
                }

                let path_key = path_id(&entry_path);
                if !seen.insert(path_key.clone()) {
                    continue;
                }

                let folder_name = entry.file_name().to_string_lossy().to_string();
                labels.insert(path_key, format!("{} - {}", candidate.label, folder_name));
                let last_modified = last_modified_ms(&entry_path).unwrap_or(0);
                let modified_days = last_modified_days(last_modified);
                let size_bytes = directory_size_bytes(&entry_path);

                projects.push(ProjectMeta {
                    id: path_id(&entry_path),
                    path: entry_path.to_string_lossy().to_string(),
                    name: folder_name,
                    package_json_path: String::new(),
                    dependency_count: 0,
                    has_git: false,
                    has_env_file: false,
                    has_startup_keyword: false,
                    last_modified,
                    last_modified_days: modified_days,
                    size_bytes,
                    is_cache: true,
                });
            }
            continue;
        }

        let path_key = path_id(&candidate.path);
        if !seen.insert(path_key.clone()) {
            continue;
        }

        let name = candidate
            .path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        labels.insert(path_key, format!("{} - {}", candidate.label, name));
        let last_modified = last_modified_ms(&candidate.path).unwrap_or(0);
        let modified_days = last_modified_days(last_modified);
        let size_bytes = directory_size_bytes(&candidate.path);

        projects.push(ProjectMeta {
            id: path_id(&candidate.path),
            path: candidate.path.to_string_lossy().to_string(),
            name,
            package_json_path: String::new(),
            dependency_count: 0,
            has_git: false,
            has_env_file: false,
            has_startup_keyword: false,
            last_modified,
            last_modified_days: modified_days,
            size_bytes,
            is_cache: true,
        });
    }

    for project in &mut projects {
        if let Some(label) = labels.get(&project.id) {
            project.name = label.clone();
        }
    }

    projects
}

pub struct ScanResult {
    pub projects: Vec<ProjectMeta>,
    pub total_entries: usize,
    pub skipped_entries: usize,
}

pub fn scan_projects<F>(
    root: &Path,
    scan_all: bool,
    scan_caches: bool,
    mut on_progress: Option<F>,
) -> ScanResult
where
    F: FnMut(ScanProgress),
{
    let mut total_entries = 0usize;
    let mut skipped_entries = 0usize;
    let count_walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_ignored(entry, scan_all));

    for entry in count_walker {
        match entry {
            Ok(_) => total_entries += 1,
            Err(_) => skipped_entries += 1,
        }
    }

    let mut package_paths: Vec<PathBuf> = Vec::new();
    let mut found_count = 0usize;
    let mut scanned_count = 0usize;
    let mut last_emit = Instant::now();

    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_ignored(entry, scan_all));

    for entry in walker.flatten() {
        scanned_count += 1;
        if entry.file_type().is_file() && entry.file_name() == "package.json" {
            let path = entry.path().to_path_buf();
            package_paths.push(path.clone());
            found_count += 1;
        }

        if let Some(callback) = on_progress.as_mut() {
            if last_emit.elapsed().as_millis() >= 120 || scanned_count % 200 == 0 {
                last_emit = Instant::now();
                callback(ScanProgress {
                    found_count,
                    current_path: entry.path().to_string_lossy().to_string(),
                    scanned_count,
                    total_count: Some(total_entries),
                });
            }
        }
    }

    if let Some(callback) = on_progress.as_mut() {
        callback(ScanProgress {
            found_count,
            current_path: root.to_string_lossy().to_string(),
            scanned_count,
            total_count: Some(total_entries),
        });
    }

    let mut projects = Vec::new();

    for package_json_path in package_paths {
        let project_dir = package_json_path.parent().unwrap_or(root);
        let pkg = match read_package_json(&package_json_path) {
            Some(value) => value,
            None => continue,
        };

        let name = pkg
            .get("name")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.to_string())
            .unwrap_or_else(|| {
                project_dir
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            });

        let keywords = pkg
            .get("keywords")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(|value| value.to_string()))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();

        let scripts = pkg
            .get("scripts")
            .and_then(|value| value.as_object())
            .map(|map| {
                map.values()
                    .filter_map(|value| value.as_str().map(|value| value.to_string()))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();

        let dependency_count = get_dependency_count(&pkg);
        let has_git = project_dir.join(".git").exists();
        let has_env = has_env_file(project_dir);
        let has_startup = has_startup_signal(&name, &keywords, &scripts);
        let last_modified = last_modified_ms(&package_json_path)
            .or_else(|| last_modified_ms(project_dir))
            .unwrap_or(0);
        let modified_days = last_modified_days(last_modified);
        let size_bytes = directory_size_bytes(project_dir);

        projects.push(ProjectMeta {
            id: path_id(project_dir),
            path: project_dir.to_string_lossy().to_string(),
            name,
            package_json_path: package_json_path.to_string_lossy().to_string(),
            dependency_count,
            has_git,
            has_env_file: has_env,
            has_startup_keyword: has_startup,
            last_modified,
            last_modified_days: modified_days,
            size_bytes,
            is_cache: false,
        });
    }

    if scan_caches {
        projects.extend(scan_cache_dirs());
    }

    projects.sort_by(|a, b| a.path.cmp(&b.path));
    ScanResult {
        projects,
        total_entries,
        skipped_entries,
    }
}
