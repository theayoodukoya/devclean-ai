import React, {useEffect} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import fs from 'node:fs/promises';
import path from 'node:path';
import {scanProjects} from './core/scanner.js';
import {evaluateHeuristicRisk, mergeRisk} from './core/risk.js';
import {classifyWithGemini, hashFile} from './core/ai.js';
import {
	readCache,
	writeCache,
	getCachedAssessment,
	setCachedAssessment,
} from './core/cache.js';
import {ProjectRecord} from './core/types.js';
import {useStore} from './store/useStore.js';
import {Header} from './ui/Header.js';
import {ProjectList} from './ui/ProjectList.js';
import {FooterStatus} from './ui/FooterStatus.js';
import {ApiKeyBlock} from './ui/ApiKeyBlock.js';
import {ProjectDetails} from './ui/ProjectDetails.js';

export type AppProps = {
	rootPath: string;
	dryRun: boolean;
	aiEnabled: boolean;
	apiKey: string | undefined;
	scanAll: boolean;
	depsOnly: boolean;
};

const removePaths = async (paths: string[]) => {
	for (const projectPath of paths) {
		await fs.rm(projectPath, {recursive: true, force: true});
	}
};

const getDependencyTargets = (projectPath: string) => [
	path.join(projectPath, 'node_modules'),
	path.join(projectPath, '.cache'),
];

export default function App({
	rootPath,
	dryRun,
	aiEnabled,
	apiKey,
	scanAll,
	depsOnly,
}: AppProps) {
	const {exit} = useApp();
	const {stdout} = useStdout();
	const needsApiKey = aiEnabled && !apiKey;

	const projects = useStore(state => state.projects);
	const allProjects = useStore(state => state.allProjects);
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
	const showDetails = useStore(state => state.showDetails);
	const filterText = useStore(state => state.filterText);
	const filterMode = useStore(state => state.filterMode);
	const sortKey = useStore(state => state.sortKey);
	const sortDirection = useStore(state => state.sortDirection);
	const deleteDependenciesOnly = useStore(state => state.deleteDependenciesOnly);

	const setAllProjects = useStore(state => state.setAllProjects);
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
	const toggleDetails = useStore(state => state.toggleDetails);
	const startFilter = useStore(state => state.startFilter);
	const stopFilter = useStore(state => state.stopFilter);
	const updateFilterText = useStore(state => state.updateFilterText);
	const clearFilter = useStore(state => state.clearFilter);
	const cycleSort = useStore(state => state.cycleSort);
	const toggleSortDirection = useStore(state => state.toggleSortDirection);
	const toggleDepsOnly = useStore(state => state.toggleDepsOnly);
	const setDepsOnly = useStore(state => state.setDepsOnly);

	const selectedCount = selectedIds.size;
	const totalSizeBytes = allProjects.reduce(
		(total, project) => total + project.sizeBytes,
		0,
	);
	const selectedSizeBytes = allProjects
		.filter(project => selectedIds.has(project.id))
		.reduce((total, project) => total + project.sizeBytes, 0);
	const selectedProject = projects[cursorIndex];
	const columns = stdout?.columns ?? 120;
	const maxListWidth = Math.max(40, columns - 2);
	const listWidth = showDetails
		? Math.min(columns, Math.max(60, Math.floor(columns * 0.6)))
		: Math.min(columns, maxListWidth);
	const fullDiskBanner = scanAll ? (
		<Text color="#FF7A00">Full-disk scan enabled. This may take a while.</Text>
	) : null;

	useEffect(() => {
		setDryRun(dryRun);
		setAiEnabled(aiEnabled);
		setDepsOnly(depsOnly);
	}, [dryRun, aiEnabled, depsOnly, setDryRun, setAiEnabled, setDepsOnly]);

	useEffect(() => {
		const term = filterText.trim().toLowerCase();
		const filtered = term
			? allProjects.filter(project =>
					`${project.name} ${project.path}`.toLowerCase().includes(term),
			  )
			: allProjects;

		const sorted = [...filtered].sort((a, b) => {
			let result = 0;
			if (sortKey === 'size') result = a.sizeBytes - b.sizeBytes;
			if (sortKey === 'risk') result = a.risk.score - b.risk.score;
			if (sortKey === 'modified') result = a.lastModified - b.lastModified;
			if (sortKey === 'name') result = a.name.localeCompare(b.name);
			return sortDirection === 'asc' ? result : -result;
		});

		setProjects(sorted);
		if (sorted.length === 0) {
			setCursor(0);
		} else if (cursorIndex >= sorted.length) {
			setCursor(sorted.length - 1);
		}
	}, [allProjects, filterText, sortKey, sortDirection, cursorIndex, setProjects, setCursor]);

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
						const cached = getCachedAssessment(
							cache,
							project.packageJsonPath,
							hash,
						);
						if (cached) {
							aiAssessment = cached;
						} else {
							const result = await classifyWithGemini(project, hash, {apiKey});
							if (result) {
								aiAssessment = result;
								setCachedAssessment(
									cache,
									project.packageJsonPath,
									hash,
									result,
								);
							}
						}
					}

					records.push({...project, risk: mergeRisk(heuristic, aiAssessment)});
				}

				await writeCache(absoluteRoot, cache);

				if (active) {
					setAllProjects(records);
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
	}, [
		rootPath,
		aiEnabled,
		apiKey,
		needsApiKey,
		scanAll,
		setAllProjects,
		setProjects,
		setLoading,
		setError,
		setStatus,
	]);

	useInput((input, key) => {
		if (needsApiKey) {
			if (input && input.toLowerCase() === 'q') {
				exit();
			}
			return;
		}

		if (filterMode) {
			if (key.escape) {
				clearFilter();
				setStatus('Filter cleared.');
				return;
			}

			if (key.return) {
				stopFilter();
				return;
			}

			if (key.backspace) {
				updateFilterText(filterText.slice(0, -1));
				return;
			}

			if (input && input.length === 1) {
				updateFilterText(`${filterText}${input}`.slice(0, 64));
				return;
			}

			return;
		}

		if (key.tab) {
			toggleDetails();
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
					const selectedPaths = allProjects
						.filter(project => selectedIds.has(project.id))
						.map(project => project.path);

					if (selectedPaths.length === 0) {
						setStatus('No projects selected.');
						cancelDelete();
						return;
					}

					void (async () => {
						try {
							if (deleteDependenciesOnly) {
								const dependencyTargets = selectedPaths.flatMap(path =>
									getDependencyTargets(path),
								);
								if (!storeDryRun) {
									await removePaths(dependencyTargets);
								}
								clearSelection();
								setStatus(
									storeDryRun
										? 'Dry run complete. No changes made.'
										: 'Dependencies removed for selected projects.',
								);
							} else {
								if (!storeDryRun) {
									await removePaths(selectedPaths);
								}

								const remaining = allProjects.filter(
									project => !selectedIds.has(project.id),
								);
								setAllProjects(remaining);
								setProjects(remaining);
								clearSelection();
								setStatus(
									storeDryRun
										? 'Dry run complete. No changes made.'
										: 'Deleted selected projects.',
								);
							}
						} catch (error: unknown) {
							setStatus(
								error instanceof Error ? error.message : 'Delete failed.',
							);
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

		if (input === '/') {
			startFilter();
			return;
		}

		if (input.toLowerCase() === 's') {
			cycleSort();
			setStatus('Sort updated.');
			return;
		}

		if (input.toLowerCase() === 'r') {
			toggleSortDirection();
			setStatus('Sort order toggled.');
			return;
		}

		if (input.toLowerCase() === 'x') {
			toggleDepsOnly();
			setStatus(
				deleteDependenciesOnly ? 'Deps-only mode off.' : 'Deps-only mode on.',
			);
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
			<Box flexDirection="row">
				<Box width={listWidth} flexDirection="column">
					<ProjectList
						projects={projects}
						cursorIndex={cursorIndex}
						selectedIds={selectedIds}
						availableWidth={listWidth}
					/>
				</Box>
				{showDetails ? (
					<Box flexGrow={1} flexDirection="column">
						<ProjectDetails project={selectedProject} />
					</Box>
				) : null}
			</Box>
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
				filterText={filterText}
				sortKey={sortKey}
				sortDirection={sortDirection}
				deleteDependenciesOnly={deleteDependenciesOnly}
			/>
		</Box>
	);
}
