import React, {useEffect} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import fs from 'node:fs/promises';
import path from 'node:path';
import {scanProjects} from './core/scanner.js';
import {evaluateHeuristicRisk, mergeRisk} from './core/risk.js';
import {classifyWithGemini, hashFile} from './core/ai.js';
import {readCache, writeCache, getCachedAssessment, setCachedAssessment} from './core/cache.js';
import {ProjectRecord} from './core/types.js';
import {useStore} from './store/useStore.js';
import {Header} from './ui/Header.js';
import {ProjectList} from './ui/ProjectList.js';
import {FooterStatus} from './ui/FooterStatus.js';
import {ApiKeyBlock} from './ui/ApiKeyBlock.js';

export type AppProps = {
	rootPath: string;
	dryRun: boolean;
	aiEnabled: boolean;
	apiKey: string | undefined;
	scanAll: boolean;
};

const removePaths = async (paths: string[]) => {
	for (const projectPath of paths) {
		await fs.rm(projectPath, {recursive: true, force: true});
	}
};

export default function App({rootPath, dryRun, aiEnabled, apiKey, scanAll}: AppProps) {
	const {exit} = useApp();
	const needsApiKey = aiEnabled && !apiKey;

	const projects = useStore(state => state.projects);
	const selectedIds = useStore(state => state.selectedIds);
	const cursorIndex = useStore(state => state.cursorIndex);
	const rangeAnchor = useStore(state => state.rangeAnchor);
	const isLoading = useStore(state => state.isLoading);
	const error = useStore(state => state.error);
	const statusMessage = useStore(state => state.statusMessage);
	const deleteMode = useStore(state => state.deleteMode);
	const confirmText = useStore(state => state.confirmText);
	const storeDryRun = useStore(state => state.dryRun);
	const storeAiEnabled = useStore(state => state.aiEnabled);

	const setProjects = useStore(state => state.setProjects);
	const setLoading = useStore(state => state.setLoading);
	const setError = useStore(state => state.setError);
	const setStatus = useStore(state => state.setStatus);
	const setDryRun = useStore(state => state.setDryRun);
	const setAiEnabled = useStore(state => state.setAiEnabled);
	const moveCursor = useStore(state => state.moveCursor);
	const setCursor = useStore(state => state.setCursor);
	const setRangeAnchor = useStore(state => state.setRangeAnchor);
	const toggleSelect = useStore(state => state.toggleSelect);
	const selectRange = useStore(state => state.selectRange);
	const selectAllByClass = useStore(state => state.selectAllByClass);
	const clearSelection = useStore(state => state.clearSelection);
	const startDelete = useStore(state => state.startDelete);
	const cancelDelete = useStore(state => state.cancelDelete);
	const updateConfirmText = useStore(state => state.updateConfirmText);

	const selectedCount = selectedIds.size;
	const totalSizeBytes = projects.reduce((total, project) => total + project.sizeBytes, 0);
	const selectedSizeBytes = projects
		.filter(project => selectedIds.has(project.id))
		.reduce((total, project) => total + project.sizeBytes, 0);
	const fullDiskBanner = scanAll ? (
		<Text color="#FF7A00">Full-disk scan enabled. This may take a while.</Text>
	) : null;

	useEffect(() => {
		setDryRun(dryRun);
		setAiEnabled(aiEnabled);
	}, [dryRun, aiEnabled, setDryRun, setAiEnabled]);

	useEffect(() => {
		if (needsApiKey) {
			setLoading(false);
			return;
		}

		let active = true;

		const load = async () => {
			setLoading(true);
			setError(null);
			setStatus(null);

			try {
				const absoluteRoot = path.resolve(rootPath);
				const cache = await readCache(absoluteRoot);
				const discovered = await scanProjects(absoluteRoot, {scanAll});
				const records: ProjectRecord[] = [];

				for (const project of discovered) {
					const heuristic = evaluateHeuristicRisk(project);
					let aiAssessment = null;

					if (aiEnabled && apiKey) {
						const hash = await hashFile(project.packageJsonPath);
						const cached = getCachedAssessment(cache, project.packageJsonPath, hash);
						if (cached) {
							aiAssessment = cached;
						} else {
							const result = await classifyWithGemini(project, hash, {apiKey});
							if (result) {
								aiAssessment = result;
								setCachedAssessment(cache, project.packageJsonPath, hash, result);
							}
						}
					}

					records.push({...project, risk: mergeRisk(heuristic, aiAssessment)});
				}

				await writeCache(absoluteRoot, cache);

				if (active) {
					setProjects(records);
				}
			} catch (error: unknown) {
				if (active) {
					setError(error instanceof Error ? error.message : 'Unknown error');
				}
			} finally {
				if (active) {
					setLoading(false);
				}
			}
		};

		void load();

		return () => {
			active = false;
		};
	}, [rootPath, aiEnabled, apiKey, needsApiKey, scanAll, setProjects, setLoading, setError, setStatus]);

	useInput((input, key) => {
		if (needsApiKey) {
			if (input && input.toLowerCase() === 'q') {
				exit();
			}
			return;
		}

		if (deleteMode) {
			if (key.escape) {
				cancelDelete();
				setStatus('Delete canceled.');
				return;
			}

			if (key.backspace) {
				updateConfirmText(confirmText.slice(0, -1));
				return;
			}

			if (key.return) {
				if (confirmText === 'DELETE') {
					const selectedPaths = projects
						.filter(project => selectedIds.has(project.id))
						.map(project => project.path);

					if (selectedPaths.length === 0) {
						setStatus('No projects selected.');
						cancelDelete();
						return;
					}

					void (async () => {
						try {
							if (!storeDryRun) {
								await removePaths(selectedPaths);
							}

							const remaining = projects.filter(project => !selectedIds.has(project.id));
							setProjects(remaining);
							clearSelection();
							setStatus(storeDryRun ? 'Dry run complete. No changes made.' : 'Deleted selected projects.');
						} catch (error: unknown) {
							setStatus(error instanceof Error ? error.message : 'Delete failed.');
						} finally {
							cancelDelete();
						}
					})();
				} else {
					setStatus('Confirmation text did not match.');
					cancelDelete();
				}
				return;
			}

			if (input && input.length === 1) {
				updateConfirmText(`${confirmText}${input}`.slice(0, 12));
			}

			return;
		}

		if (key.upArrow) {
			const nextIndex = Math.max(0, cursorIndex - 1);
			if (key.shift) {
				const anchor = rangeAnchor ?? cursorIndex;
				setCursor(nextIndex);
				setRangeAnchor(anchor);
				selectRange(anchor, nextIndex);
			} else {
				moveCursor(-1);
			}
			return;
		}

		if (key.downArrow) {
			const nextIndex = Math.min(projects.length - 1, cursorIndex + 1);
			if (key.shift) {
				const anchor = rangeAnchor ?? cursorIndex;
				setCursor(nextIndex);
				setRangeAnchor(anchor);
				selectRange(anchor, nextIndex);
			} else {
				moveCursor(1);
			}
			return;
		}

		if (input === ' ') {
			toggleSelect(cursorIndex);
			return;
		}

		if (input.toLowerCase() === 'a') {
			selectAllByClass('Burner');
			setStatus('Selected all burner projects.');
			return;
		}

		if (input.toLowerCase() === 'd') {
			if (selectedIds.size === 0) {
				setStatus('Select at least one project before deleting.');
				return;
			}
			startDelete();
			return;
		}

		if (input.toLowerCase() === 'q') {
			exit();
		}
	});

	if (needsApiKey) {
		return (
			<Box flexDirection="column">
				<Header />
				{fullDiskBanner}
				<ApiKeyBlock />
			</Box>
		);
	}

	if (isLoading) {
		return (
			<Box flexDirection="column">
				<Header />
				{fullDiskBanner}
				<Text color="#6B7280">Scanning projects...</Text>
			</Box>
		);
	}

	if (error) {
		return (
			<Box flexDirection="column">
				<Header />
				{fullDiskBanner}
				<Text color="#FF7A00">{error}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Header />
			{fullDiskBanner}
			<ProjectList projects={projects} cursorIndex={cursorIndex} selectedIds={selectedIds} />
			<FooterStatus
				projects={projects}
				selectedCount={selectedCount}
				statusMessage={statusMessage}
				dryRun={storeDryRun}
				aiEnabled={storeAiEnabled}
				deleteMode={deleteMode}
				confirmText={confirmText}
				totalSizeBytes={totalSizeBytes}
				selectedSizeBytes={selectedSizeBytes}
			/>
		</Box>
	);
}
