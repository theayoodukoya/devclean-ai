#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use devclean_core::{
    build_delete_plan, evaluate_heuristic, scan_projects, DeleteEntry, ProjectRecord, ScanProgress,
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
struct ScanCompletePayload {
    projects: Vec<ProjectRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanRequest {
    root_path: String,
    scan_all: bool,
    ai_enabled: bool,
    scan_caches: bool,
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
    let root_clone = root.clone();

    let projects = tauri::async_runtime::spawn_blocking(move || {
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

    let records: Vec<ProjectRecord> = projects
        .into_iter()
        .map(|meta| {
            let risk = evaluate_heuristic(&meta);
            ProjectRecord { meta, risk }
        })
        .collect();

    Ok(ScanCompletePayload { projects: records })
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_start, delete_execute, export_plan])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
