# Release Guide (Desktop)

This project ships as a Tauri desktop app (macOS/Windows).

## One-time setup
- Ensure GitHub Actions are enabled for the repo.
- Confirm `apps/desktop/package-lock.json` is committed (for CI caching).
- Decide whether auto-updater will be used in v0.1 (see “Updater” below).

## Build locally
From `apps/desktop`:
1. `npm ci`
2. `npm run tauri build`
3. Artifacts are in `apps/desktop/src-tauri/target/release/bundle/`

## Versioning strategy (SemVer)
- **Patch** (x.y.Z): bug fixes only.
- **Minor** (x.Y.z): new features, no breaking changes.
- **Major** (X.y.z): breaking changes or “stable milestone” (e.g., 1.0).

Example: `v0.10` only becomes `v1.0` when you declare a breaking change or a “stable milestone.” Otherwise, new features go to `v0.11`, fixes to `v0.10.1`.

### Auto-bump helper
Use the helper script to bump versions across `package.json`, `Cargo.toml`, and `tauri.conf.json`:
- Preview: `node scripts/bump-version.mjs`
- Apply: `node scripts/bump-version.mjs --apply`
- Force bump: `node scripts/bump-version.mjs --major|--minor|--patch --apply`

## CI builds
- `desktop-build.yml` runs on push/PR and uploads bundle artifacts.
- `desktop-release.yml` runs on tag push (e.g. `v0.1.0`) and publishes a GitHub Release (macOS first).

## Tag a release
1. Update versions (UI + `apps/desktop/src-tauri/Cargo.toml` + `apps/desktop/src-tauri/tauri.conf.json`).
2. Commit changes.
3. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
4. GitHub Actions builds the app and uploads assets to the Release. Those assets are what the updater uses.

## What a “tagged release” means
- A tag is just a pointer to a commit (e.g., `v0.1.0`).
- The release workflow watches for tags and turns them into GitHub Releases with downloadable assets.
- The updater checks the GitHub Release feed and compares versions; if newer, it downloads and installs.

## Updater (optional for v0.1)
Tauri’s updater requires:
- Signing keys for each OS.
- A hosted update feed (e.g., GitHub releases).

If you want updater on, add the updater config and signing secrets, then use the release workflow to publish assets.

### Required secrets (GitHub Actions)
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### Updater config
- `apps/desktop/src-tauri/tauri.conf.json` must include the updater endpoints + public key.
- `bundle.createUpdaterArtifacts` must be `true`.

### Generate updater keys
1. Run `npx tauri signer generate` to create a keypair.
2. Copy the **public key** into `tauri.conf.json` under `plugins.updater.pubkey`.
3. Add the **private key** and password to GitHub Actions secrets.
