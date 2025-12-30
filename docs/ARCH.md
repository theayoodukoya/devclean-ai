# DevClean AI Architecture

## Goals
- Preserve separation of concerns: scanner and AI are core services, UI only renders data.
- Support cross-platform scanning (Mac/Windows) with fast-glob.
- Keep destructive actions explicit and confirmed by the user.

## System Boundaries
- `source/core/scanner.ts` scans the filesystem and returns `ProjectMeta[]` only.
- `source/core/ai.ts` handles Gemini calls and JSON parsing.
- `source/core/cache.ts` stores AI assessments keyed by package.json hash.
- `source/core/risk.ts` owns heuristic scoring and merges AI with heuristics.
- `source/app.tsx` orchestrates data flow and deletes only after confirmation.

## Risk Engine Rules
- Critical (8-10): `.git`, env files, or startup keywords should push scores high.
- Active (5-7): recent modification and dependency density.
- Burner (0-4): tutorial/test/boilerplate naming + inactive 6+ months.

## Safety Rules
- The `rm -rf` equivalent runs only after a typed confirmation (`DELETE`).
- `--dry-run` must skip all removal and only report actions.

## Cache Rules
- Cache stored at `./.devclean-cache.json` in the scan root.
- If the package.json hash matches, AI calls are skipped.

## UI Rules
- Ink UI uses a cobalt blue primary and bright orange for destructive cues.
- Selection uses an inverted background (white on blue).
- Every state is readable without color (labels and text markers).
- If AI is enabled and `GEMINI_API_KEY` is missing, the UI must block with setup instructions.

## Full-Disk Scan Rules
- `--all` scans the current drive root and shows a warning banner in the UI.
- Scanner must suppress permission errors and continue.
- Skip lists are applied to avoid system directories during full-disk scans.
