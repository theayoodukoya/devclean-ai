# DevClean AI Roadmap

## Phase Tasks
1. Scanner module (fast-glob, cross-platform)
2. GeminiProvider with `$GEMINI_API_KEY`
3. Ink UI components: Header, ProjectList, FooterStatus
4. Selection logic (single + shift-range)
5. Packaging: `npx` binary support + `--dry-run`

## Testing Checklist
- Phase 1: Scan a repo with multiple nested `package.json` files.
- Phase 2: Set `GEMINI_API_KEY` and confirm cache reuse by re-running.
- Phase 3: Verify UI renders on Mac and Windows terminals.
- Phase 4: Check space toggles, shift+arrow selects range, and `A` selects burners.
- Phase 5: Use `--dry-run` and verify no filesystem changes; confirm delete prompt.

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

## Context Hygiene
- Keep `docs/ARCH.md` updated with any new system rules.
- Track roadmap progress in this file.
- Record UI/UX changes in the commit message or a short note here.
