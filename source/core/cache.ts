import fs from 'node:fs/promises';
import path from 'node:path';
import {RiskAssessment} from './types.js';

export type CacheEntry = {
	hash: string;
	assessment: RiskAssessment;
	updatedAt: number;
};

export type CacheFile = {
	version: 1;
	entries: Record<string, CacheEntry>;
};

const emptyCache = (): CacheFile => ({version: 1, entries: {}});

export const getCachePath = (root: string) =>
	path.join(root, '.devclean-cache.json');

export const readCache = async (root: string): Promise<CacheFile> => {
	const cachePath = getCachePath(root);
	try {
		const raw = await fs.readFile(cachePath, 'utf8');
		const data = JSON.parse(raw) as CacheFile;
		if (data?.version !== 1 || !data.entries) {
			return emptyCache();
		}
		return data;
	} catch {
		return emptyCache();
	}
};

export const writeCache = async (root: string, cache: CacheFile) => {
	const cachePath = getCachePath(root);
	await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
};

export const getCachedAssessment = (
	cache: CacheFile,
	key: string,
	hash: string,
) => {
	const entry = cache.entries[key];
	if (!entry) return null;
	if (entry.hash !== hash) return null;
	return entry.assessment;
};

export const setCachedAssessment = (
	cache: CacheFile,
	key: string,
	hash: string,
	assessment: RiskAssessment,
) => {
	cache.entries[key] = {
		hash,
		assessment,
		updatedAt: Date.now(),
	};
};
