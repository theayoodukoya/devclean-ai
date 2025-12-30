# DevClean AI Roadmap

## MVP (Ship)

- Fast scan + cross-platform paths (fast-glob)
- Risk scoring (heuristics + AI blend)
- AI-key preflight block when AI is enabled and `GEMINI_API_KEY` is missing
- TUI list with selection + shift-range
- Dry-run + explicit DELETE confirmation
- Cache AI results by package.json hash
- Folder size calculation + total reclaimable size
- Full-disk scan flag with warning banner and skip lists

## Stage 1 (MVP+ Polish)

- Reclaimable total + selected total in footer
- "Why" panel per project (reasons list)
- Filter/sort by size, risk, last modified
- Quick search by name/path
- "Clean dependencies only" mode (node_modules/.cache)

## Stage 2 (Pro Safety + Workflow)

- Quarantine/soft-delete with auto-expire
- Undo last delete
- Export plan (JSON/CSV) for audit
- Profiles: Safe / Balanced / Aggressive
- Allowlist/denylist rules file

## Stage 3 (Wow / Next-Gen)

- AI feedback loop ("Was this safe?") to personalize risk
- Weekly "Storage Health" report
- Plugin rules / community heuristics
- Monorepo intelligence + workspace grouping
- Team/shared policy profiles

## Phase Tasks (Implementation Order)

1. Scanner module (fast-glob, cross-platform)
2. GeminiProvider with `$GEMINI_API_KEY` + local cache
3. Ink UI components: Header, ProjectList, FooterStatus
4. Selection logic (single + shift-range)
5. Safety: DELETE confirmation + dry run
6. Packaging: `npx` binary support + `--dry-run`

## Testing Checklist

- Phase 1: Scan a repo with multiple nested `package.json` files.
- Phase 2: Set `GEMINI_API_KEY` and confirm cache reuse by re-running.
- Phase 2b: Run without `GEMINI_API_KEY` and confirm the UI blocks with instructions unless `--no-ai` is set.
- Phase 3: Verify UI renders on Mac and Windows terminals.
- Phase 4: Check space toggles, shift+arrow selects range, and `A` selects burners.
- Phase 5: Use `--dry-run` and verify no filesystem changes; confirm delete prompt.
- Phase 6: Run `--all` and confirm warning banner + permission errors are skipped.

## Runbook (Start Each Time)

1. If a root artifact named `2.` exists, remove it before installing deps: `rm -rf 2.`
2. `npm install`
3. `npm run build`
4. Run locally: `node dist/cli.js` (or `npm link` for `devclean-ai` command)

## Local Test Walkthrough

1. Export your key (free tier): `export GEMINI_API_KEY="your_key_here"`
2. Run with a target directory: `node dist/cli.js --path ~/Projects`
3. Try a dry run: `node dist/cli.js --path ~/Projects --dry-run`
4. Heuristic-only mode (no AI): `node dist/cli.js --path ~/Projects --no-ai`
5. Re-run step 2 to verify cached AI results (no extra API calls).
6. Unset the key and confirm AI preflight block: `unset GEMINI_API_KEY && node dist/cli.js --path ~/Projects`
7. Full-disk scan warning: `node dist/cli.js --all`

## Context Hygiene

- Keep `docs/ARCH.md` updated with any new system rules.
- Track roadmap progress in this file.
- Record UI/UX changes in the commit message or a short note here.

## Development Rule: Test After Each Change

- After every feature, fix, or update, run the phase test below and capture the result (success/fail + notes).
- Minimum check: `npm run build` plus the relevant manual steps.

## Phase Test Commands (Run Every Phase)

1. Build check (always): `npm run build`
2. Scan smoke test: `node dist/cli.js --path <your_test_dir>`
3. AI path: `GEMINI_API_KEY="key" node dist/cli.js --path <your_test_dir>`
4. AI block check: `unset GEMINI_API_KEY && node dist/cli.js --path <your_test_dir>` (expect block unless `--no-ai`)
5. Dry run safety: `node dist/cli.js --path <your_test_dir> --dry-run`
6. Heuristic-only: `node dist/cli.js --path <your_test_dir> --no-ai`
7. Full-disk scan: `node dist/cli.js --all`
