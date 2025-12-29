import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import {ProjectMeta} from './types.js';

const DEFAULT_IGNORES = [
	'**/node_modules/**',
	'**/dist/**',
	'**/build/**',
	'**/.git/**',
	'**/.next/**',
	'**/.cache/**',
	'**/coverage/**',
];

const STARTUP_KEYWORDS = ['startup', 'production', 'prod'];

const NAME_BURNER_HINTS = ['tutorial', 'test', 'boilerplate', 'example', 'sample'];

const nowMs = () => Date.now();

const safeParseJson = <T>(raw: string, fallback: T): T => {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
};

const fileExists = async (filePath: string) => {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
};

const getDependencyCount = (pkg: Record<string, unknown>) => {
	const depBuckets = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
	return depBuckets.reduce((total, key) => {
		const bucket = pkg[key] as Record<string, string> | undefined;
		return total + (bucket ? Object.keys(bucket).length : 0);
	}, 0);
};

const hasStartupSignal = (pkg: Record<string, unknown>, name: string) => {
	const keywordField = Array.isArray(pkg.keywords) ? pkg.keywords : [];
	const keywordText = keywordField.join(' ').toLowerCase();
	const scripts = (pkg.scripts ?? {}) as Record<string, string>;
	const scriptsText = Object.values(scripts).join(' ').toLowerCase();
	const nameText = name.toLowerCase();
	return STARTUP_KEYWORDS.some(keyword =>
		keywordText.includes(keyword) || scriptsText.includes(keyword) || nameText.includes(keyword),
	);
};

const getLastModified = async (projectDir: string, packageJsonPath: string) => {
	// Keep this light: use package.json mtime and a small sample of common files.
	const patterns = [
		'package.json',
		'**/*.{ts,tsx,js,jsx,json,md}',
	];

	const entries = await fg(patterns, {
		cwd: projectDir,
		absolute: true,
		onlyFiles: true,
		ignore: DEFAULT_IGNORES,
		deep: 2,
	});

	if (entries.length === 0) {
		const stats = await fs.stat(packageJsonPath);
		return stats.mtimeMs;
	}

	let latest = 0;
	for (const entry of entries) {
		try {
			const stats = await fs.stat(entry);
			if (stats.mtimeMs > latest) {
				latest = stats.mtimeMs;
			}
		} catch {
			// Ignore missing files during scan.
		}
	}

	return latest || (await fs.stat(packageJsonPath)).mtimeMs;
};

export const scanProjects = async (root: string): Promise<ProjectMeta[]> => {
	const packageJsonPaths = await fg('**/package.json', {
		cwd: root,
		absolute: true,
		ignore: DEFAULT_IGNORES,
	});

	const projects: ProjectMeta[] = [];

	for (const packageJsonPath of packageJsonPaths) {
		const projectDir = path.dirname(packageJsonPath);
		const packageRaw = await fs.readFile(packageJsonPath, 'utf8');
		const pkg = safeParseJson<Record<string, unknown>>(packageRaw, {});
		const name = typeof pkg.name === 'string' && pkg.name.trim().length > 0 ? pkg.name : path.basename(projectDir);

		const dependencyCount = getDependencyCount(pkg);
		const hasGit = await fileExists(path.join(projectDir, '.git'));
		const hasEnvFile = (await fg('.env*', {cwd: projectDir, onlyFiles: true, deep: 1})).length > 0;
		const hasStartupKeyword = hasStartupSignal(pkg, name);
		const lastModified = await getLastModified(projectDir, packageJsonPath);
		const lastModifiedDays = Math.floor((nowMs() - lastModified) / (1000 * 60 * 60 * 24));

		const id = projectDir;

		projects.push({
			id,
			path: projectDir,
			name,
			packageJsonPath,
			dependencyCount,
			hasGit,
			hasEnvFile,
			hasStartupKeyword,
			lastModified,
			lastModifiedDays,
		});
	}

	return projects.sort((a, b) => a.path.localeCompare(b.path));
};

export const isBurnerName = (name: string) => NAME_BURNER_HINTS.some(hint => name.toLowerCase().includes(hint));
