# devclean-ai

DevClean AI is a TUI storage manager for developer projects. It scans for `package.json` files, scores risk, and helps you safely remove low-value project folders.

## Install

```bash
npm install --global devclean-ai
```

## CLI

```bash
$ devclean-ai --help

Usage
  $ devclean-ai [--path <dir>] [--all] [--dry-run] [--no-ai] [--deps-only]

Options
  --path       Root folder to scan (default: cwd)
  --all        Scan entire disk (current drive)
  --dry-run    Skip deletion, report actions only
  --no-ai      Disable Gemini calls (heuristics only)
  --deps-only  Delete node_modules/.cache only (keep projects)

Examples
  $ devclean-ai --path ~/Projects
  $ devclean-ai --all
  $ devclean-ai --dry-run
  $ devclean-ai --deps-only
```

## Development

```bash
npm install
npm run build
node dist/cli.js
```

See `docs/ARCH.md` and `docs/TASKS.md` for architecture rules and the roadmap.
