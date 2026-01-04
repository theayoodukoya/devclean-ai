# DevClean AI v2.0 Implementation Plan (Tauri)

This document is the source of truth for the v2.0 build. Follow phases in order.

## Status
- Phase 0 started and scaffolded Tauri template in `apps/desktop`.
- Rust toolchain is still required to run Tauri dev/build.

## Prerequisites
- Node.js 22+
- Rust toolchain (stable) via rustup
- Tauri prerequisites for your OS
  - macOS: Xcode CLI tools
  - Windows: Visual Studio Build Tools + WebView2
  - Linux: webkit2gtk, openssl, libappindicator, etc.

## Phase 0 - Decision + Scaffolding
Goal: Create the v2 monorepo structure and baseline Tauri app.

### Actions
1. Create monorepo layout:
   - `apps/desktop`
   - `packages/core-rs`
   - `packages/shared`
2. Initialize Tauri app in `apps/desktop`.
3. Define IPC contract doc in `docs/IMPLEMENTATION.md`.

### IPC Contract (Initial)
- `scan.start({rootPath, scanAll, aiEnabled})`
- `scan.progress({foundCount, currentPath, elapsedMs})`
- `scan.complete({projects})`
- `scan.error({message})`
- `delete.execute({paths, depsOnly, dryRun})`
- `delete.complete({removedCount})`
- `delete.error({message})`

### Tests
- Build desktop app (dev mode)
- Confirm the shell app launches

## Phase 1 - Core Engine (Rust)
Goal: Replace Node scanner with a native Rust engine.

### Modules
- `scanner.rs` (fast glob + skip lists + permission handling)
- `risk.rs` (heuristics)
- `cache.rs` (hash + cache file)
- `types.rs` (ProjectMeta, RiskAssessment)

### Tests
- Unit tests for scoring
- Integration test scanning a fixture directory

## Phase 2 - Desktop UI
Goal: Mouse-first UI with split panes and real-time progress.

### UI Requirements
- Multi-select with mouse (Shift/Cmd/Ctrl click)
- Details panel for selected project
- Progress view with bar + ETA
- Search, filter, sort controls

### Tests
- Manual UX pass on macOS + Windows
- Validate multi-select behavior

## Phase 3 - Safety + Delete
Goal: Safe deletion by default.

### Requirements
- Default deps-only delete
- Quarantine folder
- Review screen
- Export plan (JSON/CSV)

### Tests
- Deps-only delete on a dummy project
- Restore from quarantine

## Phase 4 - AI + Personalization
Goal: Bring Gemini back with caching.

### Requirements
- Gemini API calls in Rust
- Hash-based cache
- Feedback capture

### Tests
- API call with dummy project
- Cache hit on repeat scan

## Phase 5 - Release
Goal: Stable builds for distribution.

### Requirements
- CI build pipelines
- App signing
- Auto-updater
- GitHub releases

### Tests
- Installer test on macOS + Windows

## Rules
- After each feature/fix, run phase tests and record results in a short note.
- Avoid breaking v1 TUI while building v2.
