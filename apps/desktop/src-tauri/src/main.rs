#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use devclean_core::{evaluate_heuristic, scan_projects, ProjectRecord, ScanProgress};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanProgressPayload {
    found_count: usize,
    current_path: String,
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_start])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
