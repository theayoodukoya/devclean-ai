#!/usr/bin/env node
import {execSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = resolve(rootDir, 'apps', 'desktop');
const packageJsonPath = resolve(appDir, 'package.json');
const tauriConfPath = resolve(appDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = resolve(appDir, 'src-tauri', 'Cargo.toml');

const args = new Set(process.argv.slice(2));
const override =
	args.has('--major') ? 'major' : args.has('--minor') ? 'minor' : args.has('--patch') ? 'patch' : null;
const shouldApply = args.has('--apply');

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, data) => {
	writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};

const getLatestTag = () => {
	try {
		const tag = execSync('git describe --tags --abbrev=0', {cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore']})
			.toString()
			.trim();
		return tag;
	} catch {
		return null;
	}
};

const getCommitText = tag => {
	const range = tag ? `${tag}..HEAD` : 'HEAD';
	try {
		return execSync(`git log ${range} --pretty=%s%n%b`, {
			cwd: rootDir,
			stdio: ['ignore', 'pipe', 'ignore'],
		}).toString();
	} catch {
		return '';
	}
};

const detectBump = message => {
	if (/BREAKING CHANGE/i.test(message) || /!:/m.test(message)) return 'major';
	if (/^feat(\(.+\))?:/m.test(message)) return 'minor';
	if (/^fix(\(.+\))?:/m.test(message)) return 'patch';
	return 'patch';
};

const parseVersion = version => {
	const parts = version.split('.').map(value => Number(value));
	if (parts.length !== 3 || parts.some(Number.isNaN)) {
		throw new Error(`Invalid version: ${version}`);
	}
	return {major: parts[0], minor: parts[1], patch: parts[2]};
};

const bumpVersion = (version, bump) => {
	const parsed = parseVersion(version);
	if (bump === 'major') {
		return `${parsed.major + 1}.0.0`;
	}
	if (bump === 'minor') {
		return `${parsed.major}.${parsed.minor + 1}.0`;
	}
	return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
};

const packageJson = readJson(packageJsonPath);
const tauriConf = readJson(tauriConfPath);
const current = tauriConf.version || packageJson.version;
if (!current) {
	throw new Error('Unable to determine current version.');
}

const latestTag = getLatestTag();
const commitText = getCommitText(latestTag);
const bump = override ?? detectBump(commitText);
const nextVersion = bumpVersion(current, bump);

console.log(`Current version: ${current}`);
console.log(`Latest tag: ${latestTag ?? 'none'}`);
console.log(`Detected bump: ${bump}`);
console.log(`Next version: ${nextVersion}`);

if (!shouldApply) {
	console.log('Dry run only. Re-run with --apply to write changes.');
	process.exit(0);
}

packageJson.version = nextVersion;
tauriConf.version = nextVersion;

const cargoToml = readFileSync(cargoTomlPath, 'utf8');
const updatedCargoToml = cargoToml.replace(
	/(\nversion\s*=\s*")[^"]+(")/,
	`$1${nextVersion}$2`
);

if (updatedCargoToml === cargoToml) {
	throw new Error('Failed to update Cargo.toml version.');
}

writeJson(packageJsonPath, packageJson);
writeJson(tauriConfPath, tauriConf);
writeFileSync(cargoTomlPath, updatedCargoToml);

console.log('Version files updated.');
