#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use devclean_core::{
    ai_assess, build_delete_plan, evaluate_heuristic, get_cached_assessment, hash_file,
    merge_with_ai, read_cache, scan_projects, set_cached_assessment, write_cache, DeleteEntry,
    ProjectRecord, ScanProgress,
};
use dirs::data_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanProgressPayload {
    found_count: usize,
    current_path: String,
    scanned_count: usize,
    total_count: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanCompletePayload {
    projects: Vec<ProjectRecord>,
    ai_stats: Option<AiStatsPayload>,
    summary: Option<ScanSummaryPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanRequest {
    root_path: String,
    scan_all: bool,
    ai_enabled: bool,
    scan_caches: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStatsPayload {
    cache_hits: usize,
    cache_misses: usize,
    calls: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanSummaryPayload {
    root_path: String,
    scan_all: bool,
    scan_caches: bool,
    total_entries: usize,
    skipped_entries: usize,
    project_count: usize,
    cache_count: usize,
    cache_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteRequestEntry {
    path: String,
    is_cache: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteRequest {
    entries: Vec<DeleteRequestEntry>,
    deps_only: bool,
    dry_run: bool,
    quarantine: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteItemPayload {
    path: String,
    size_bytes: u64,
    action: String,
    status: String,
    destination: Option<String>,
    original_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteResponsePayload {
    removed_count: usize,
    reclaimed_bytes: u64,
    items: Vec<DeleteItemPayload>,
}

#[derive(Debug, Deserialize)]
struct ExportPlanRequest {
    path: String,
    contents: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackRequest {
    path: String,
    name: String,
    risk_score: u8,
    risk_class: String,
    vote: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackEntry {
    path: String,
    name: String,
    risk_score: u8,
    risk_class: String,
    vote: String,
    created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStatusPayload {
    has_key: bool,
    model: String,
    source: String,
}

#[tauri::command]
async fn scan_start(app: AppHandle, request: ScanRequest) -> Result<ScanCompletePayload, String> {
    let root_input = request.root_path.trim();
    let root = if root_input.is_empty() {
        PathBuf::from(".")
    } else {
        PathBuf::from(root_input)
    };

    if !root.exists() {
        return Err(format!("Root path not found: {}", root.display()));
    }

    let app_handle = app.clone();
    let scan_all = request.scan_all;
    let scan_caches = request.scan_caches;
    let ai_enabled = request.ai_enabled;
    let root_clone = root.clone();
    let api_key = load_ai_key();
    let model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-2.5-flash-lite".to_string());

    if ai_enabled && api_key.is_none() {
        return Err("Gemini API key missing. Add it in Settings or disable AI.".to_string());
    }

    let scan_result = tauri::async_runtime::spawn_blocking(move || {
        scan_projects(&root_clone, scan_all, scan_caches, Some(|progress: ScanProgress| {
            let _ = app_handle.emit(
                "scan.progress",
                ScanProgressPayload {
                    found_count: progress.found_count,
                    current_path: progress.current_path,
                    scanned_count: progress.scanned_count,
                    total_count: progress.total_count,
                },
            );
        }))
    })
    .await
    .map_err(|error| format!("Scan task failed: {error}"))?;

    let total_entries = scan_result.total_entries;
    let skipped_entries = scan_result.skipped_entries;
    let scan_projects_list = scan_result.projects;
    let root_for_cache = root.clone();
    let (records, stats): (Vec<ProjectRecord>, Option<AiStatsPayload>) =
        tauri::async_runtime::spawn_blocking(move || {
            let mut cache = if ai_enabled { read_cache(&root_for_cache) } else { Default::default() };
            let mut cache_hits = 0usize;
            let mut cache_misses = 0usize;
            let mut calls = 0usize;

            let records: Vec<ProjectRecord> = scan_projects_list
                .into_iter()
                .map(|meta| {
                    let heuristic = evaluate_heuristic(&meta);
                    if !ai_enabled || meta.is_cache {
                        return ProjectRecord {
                            meta,
                            risk: heuristic,
                        };
                    }

                    let hash = PathBuf::from(&meta.package_json_path);
                    let hash_value = if meta.package_json_path.is_empty() {
                        None
                    } else {
                        hash_file(&hash)
                    };

                    if let Some(hash_value) = hash_value.as_ref() {
                        if let Some(cached) = get_cached_assessment(&cache, &meta.id, hash_value) {
                            cache_hits += 1;
                            let merged = merge_with_ai(&heuristic, &cached);
                            return ProjectRecord { meta, risk: merged };
                        }
                    }

                    cache_misses += 1;

                    if let Some(key) = api_key.as_ref() {
                        calls += 1;
                        match ai_assess(&meta, key, &model) {
                            Ok(ai_result) => {
                                if let Some(hash_value) = hash_value.as_ref() {
                                    set_cached_assessment(
                                        &mut cache,
                                        &meta.id,
                                        hash_value,
                                        ai_result.clone(),
                                    );
                                }
                                let merged = merge_with_ai(&heuristic, &ai_result);
                                ProjectRecord { meta, risk: merged }
                            }
                            Err(_) => ProjectRecord { meta, risk: heuristic },
                        }
                    } else {
                        ProjectRecord { meta, risk: heuristic }
                    }
                })
                .collect();

            if ai_enabled {
                let _ = write_cache(&root_for_cache, &cache);
            }

            let stats = if ai_enabled {
                Some(AiStatsPayload {
                    cache_hits,
                    cache_misses,
                    calls,
                })
            } else {
                None
            };

            (records, stats)
        })
        .await
        .map_err(|error| format!("Risk task failed: {error}"))?;

    let cache_count = records.iter().filter(|item| item.meta.is_cache).count();
    let cache_bytes = records
        .iter()
        .filter(|item| item.meta.is_cache)
        .map(|item| item.meta.size_bytes)
        .sum();

    let summary = ScanSummaryPayload {
        root_path: root.to_string_lossy().to_string(),
        scan_all,
        scan_caches,
        total_entries,
        skipped_entries,
        project_count: records.len(),
        cache_count,
        cache_bytes,
    };

    Ok(ScanCompletePayload {
        projects: records,
        ai_stats: stats,
        summary: Some(summary),
    })
}

#[tauri::command]
async fn delete_execute(_app: AppHandle, request: DeleteRequest) -> Result<DeleteResponsePayload, String> {
    let entries: Vec<DeleteEntry> = request
        .entries
        .iter()
        .map(|entry| DeleteEntry {
            path: PathBuf::from(entry.path.clone()),
            is_cache: entry.is_cache,
        })
        .collect();

    let plan = build_delete_plan(&entries, request.deps_only);
    let action = if request.quarantine { "quarantine" } else { "delete" };

    if request.dry_run {
        let items = plan
            .items
            .into_iter()
            .map(|item| DeleteItemPayload {
                path: item.path,
                size_bytes: item.size_bytes,
                action: action.to_string(),
                status: "dry-run".to_string(),
                destination: None,
                original_path: None,
            })
            .collect();

        return Ok(DeleteResponsePayload {
            removed_count: 0,
            reclaimed_bytes: plan.total_bytes,
            items,
        });
    }

    let mut removed_count = 0usize;
    let mut reclaimed_bytes = 0u64;
    let mut items = Vec::new();

    let quarantine_root = if request.quarantine {
        let base = data_dir()
            .map(|dir| dir.join("devclean-ai").join("quarantine"))
            .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
        fs::create_dir_all(&base).map_err(|error| error.to_string())?;
        Some(base)
    } else {
        None
    };

    for item in plan.items {
        let target = PathBuf::from(&item.path);
        if !target.exists() {
            items.push(DeleteItemPayload {
                path: item.path,
                size_bytes: item.size_bytes,
                action: action.to_string(),
                status: "missing".to_string(),
                destination: None,
                original_path: None,
            });
            continue;
        }

        let result = if let Some(base) = &quarantine_root {
            let name = target
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "item".to_string());
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_secs())
                .unwrap_or(0);
            let mut destination = base.join(format!("{stamp}_{name}"));
            let mut counter = 1;
            while destination.exists() {
                destination = base.join(format!("{stamp}_{name}_{counter}"));
                counter += 1;
            }

            fs::rename(&target, &destination)
                .map(|_| destination)
                .map_err(|error| error.to_string())
        } else if target.is_file() {
            fs::remove_file(&target)
                .map(|_| target.clone())
                .map_err(|error| error.to_string())
        } else {
            fs::remove_dir_all(&target)
                .map(|_| target.clone())
                .map_err(|error| error.to_string())
        };

        match result {
            Ok(destination) => {
                removed_count += 1;
                reclaimed_bytes = reclaimed_bytes.saturating_add(item.size_bytes);
                let path = item.path;
                items.push(DeleteItemPayload {
                    path: path.clone(),
                    size_bytes: item.size_bytes,
                    action: action.to_string(),
                    status: know_action_status(request.quarantine),
                    destination: if request.quarantine {
                        Some(destination.to_string_lossy().to_string())
                    } else {
                        None
                    },
                    original_path: if request.quarantine {
                        Some(path)
                    } else {
                        None
                    },
                });
            }
            Err(error) => {
                items.push(DeleteItemPayload {
                    path: item.path,
                    size_bytes: item.size_bytes,
                    action: action.to_string(),
                    status: format!("error: {error}"),
                    destination: None,
                    original_path: None,
                });
            }
        }
    }

    Ok(DeleteResponsePayload {
        removed_count,
        reclaimed_bytes,
        items,
    })
}

fn know_action_status(quarantine: bool) -> String {
    if quarantine {
        "moved".to_string()
    } else {
        "deleted".to_string()
    }
}

#[tauri::command]
fn export_plan(request: ExportPlanRequest) -> Result<(), String> {
    fs::write(&request.path, request.contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn feedback_submit(request: FeedbackRequest) -> Result<(), String> {
    let base = data_dir()
        .map(|dir| dir.join("devclean-ai"))
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    fs::create_dir_all(&base).map_err(|error| error.to_string())?;
    let path = base.join("feedback.json");

    let mut entries: Vec<FeedbackEntry> = if path.exists() {
        let contents = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&contents).unwrap_or_default()
    } else {
        Vec::new()
    };

    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0);

    entries.push(FeedbackEntry {
        path: request.path,
        name: request.name,
        risk_score: request.risk_score,
        risk_class: request.risk_class,
        vote: request.vote,
        created_at,
    });

    let data = serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".to_string());
    fs::write(path, data).map_err(|error| error.to_string())
}

#[tauri::command]
fn feedback_list() -> Result<Vec<FeedbackEntry>, String> {
    let base = data_dir()
        .map(|dir| dir.join("devclean-ai"))
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let path = base.join("feedback.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(&path).unwrap_or_default();
    let mut entries: Vec<FeedbackEntry> = serde_json::from_str(&contents).unwrap_or_default();
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

fn ai_key_path() -> Result<PathBuf, String> {
    let base = data_dir()
        .map(|dir| dir.join("devclean-ai"))
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    Ok(base.join("ai-key.json"))
}

fn load_ai_key() -> Option<String> {
    if let Ok(key) = std::env::var("GEMINI_API_KEY") {
        if !key.trim().is_empty() {
            return Some(key);
        }
    }

    let path = ai_key_path().ok()?;
    let contents = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    value.get("key")?.as_str().map(|key| key.to_string())
}

#[tauri::command]
fn ai_status() -> Result<AiStatusPayload, String> {
    let model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-2.5-flash-lite".to_string());
    if let Ok(key) = std::env::var("GEMINI_API_KEY") {
        if !key.trim().is_empty() {
            return Ok(AiStatusPayload {
                has_key: true,
                model,
                source: "env".to_string(),
            });
        }
    }
    let path = ai_key_path()?;
    let has_key = path.exists();
    Ok(AiStatusPayload {
        has_key,
        model,
        source: if has_key { "local" } else { "none" }.to_string(),
    })
}

#[tauri::command]
fn ai_save_key(key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("Key cannot be empty".to_string());
    }
    let path = ai_key_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let payload = serde_json::json!({ "key": key.trim() });
    fs::write(path, payload.to_string()).map_err(|error| error.to_string())
}

#[tauri::command]
fn ai_clear_key() -> Result<(), String> {
    let path = ai_key_path()?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            scan_start,
            delete_execute,
            export_plan,
            feedback_submit,
            feedback_list,
            ai_status,
            ai_save_key,
            ai_clear_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
