import React, {useEffect, useMemo, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {homeDir, desktopDir, documentDir, downloadDir} from '@tauri-apps/api/path';
import {open, save} from '@tauri-apps/plugin-dialog';
import {check as checkForUpdates} from '@tauri-apps/plugin-updater';
import type {
	DeleteRequest,
	DeleteResponse,
	FeedbackRequest,
	FeedbackEntry,
	ProjectRecord,
	ScanResponse,
	ScanProgress,
	ScanRequest,
	RiskClass,
} from '@shared/types';
import './App.css';

const formatBytes = (bytes: number) => {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rounded} ${units[index]}`;
};

const formatDuration = (ms: number | null) => {
	if (!ms || ms <= 0) return '--';
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	const remaining = Math.round(seconds % 60);
	return `${minutes}m ${remaining}s`;
};

const truncateMiddle = (value: string, max: number) => {
	if (value.length <= max) return value;
	const keep = Math.max(4, Math.floor((max - 3) / 2));
	return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};

const tailPath = (value: string, segments = 4) => {
	const normalized = value.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(Boolean);
	if (parts.length <= segments) return value;
	const tail = parts.slice(-segments).join('/');
	return `.../${tail}`;
};

const InfoTip = ({text}: {text: string}) => (
	<span className="info-tip" title={text} aria-label={text}>
		i
	</span>
);

const deriveDiskRoot = (homePath: string | null) => {
	if (!homePath) return null;
	const windowsRoot = homePath.match(/^[A-Za-z]:\\/);
	if (windowsRoot) return windowsRoot[0];
	if (homePath.startsWith('/')) return '/';
	return homePath;
};

class ErrorBoundary extends React.Component<
	{children: React.ReactNode},
	{error: Error | null}
> {
	state: {error: Error | null} = {error: null};

	static getDerivedStateFromError(error: Error) {
		return {error};
	}

	componentDidCatch(error: Error) {
		console.error('Render error', error);
	}

	render() {
		if (this.state.error) {
			return (
				<div className="fatal">
					<h2>Something went wrong</h2>
					<p>{this.state.error.message}</p>
				</div>
			);
		}
		return this.props.children;
	}
}

export default function App() {
	const [projects, setProjects] = useState<ProjectRecord[]>([]);
	const [progress, setProgress] = useState<ScanProgress | null>(null);
	const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
	const [elapsedMs, setElapsedMs] = useState<number | null>(null);
	const [etaMs, setEtaMs] = useState<number | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [updateMessage, setUpdateMessage] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [lastIndex, setLastIndex] = useState<number | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [riskFilter, setRiskFilter] = useState<RiskClass | 'All'>('All');
	const [sortKey, setSortKey] = useState<'size' | 'modified' | 'score' | 'name'>('size');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
	const [rootPath, setRootPath] = useState('.');
	const [scanAll, setScanAll] = useState(false);
	const [aiEnabled, setAiEnabled] = useState(false);
	const [scanCaches, setScanCaches] = useState(false);
	const [quickPaths, setQuickPaths] = useState<{label: string; path: string}[]>([]);
	const [diskRoot, setDiskRoot] = useState<string | null>(null);
	const [scanKey, setScanKey] = useState('');
	const [lastScanDurations, setLastScanDurations] = useState<Record<string, number>>({});
	const [reclaimedBytes, setReclaimedBytes] = useState(0);
	const [showReview, setShowReview] = useState(false);
	const [deleteDepsOnly, setDeleteDepsOnly] = useState(true);
	const [deleteDryRun, setDeleteDryRun] = useState(true);
	const [deleteQuarantine, setDeleteQuarantine] = useState(true);
	const [deletePlan, setDeletePlan] = useState<DeleteResponse | null>(null);
	const [deleteBusy, setDeleteBusy] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [confirmText, setConfirmText] = useState('');
	const [feedbackNote, setFeedbackNote] = useState<string | null>(null);
	const [feedbackBusy, setFeedbackBusy] = useState(false);
	const [feedbackQueue, setFeedbackQueue] = useState<
		{vote: 'safe' | 'unsafe'; project: ProjectRecord; queuedAt: number}[]
	>([]);
	const [aiStats, setAiStats] = useState<{cacheHits: number; cacheMisses: number; calls: number} | null>(null);
	const [aiKeyStatus, setAiKeyStatus] = useState<{hasKey: boolean; model: string; source: string} | null>(null);
	const [showAiModal, setShowAiModal] = useState(false);
	const [aiKeyInput, setAiKeyInput] = useState('');
	const [aiKeyMessage, setAiKeyMessage] = useState<string | null>(null);
	const [showFeedbackModal, setShowFeedbackModal] = useState(false);
	const [feedbackList, setFeedbackList] = useState<FeedbackEntry[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [scanSummary, setScanSummary] = useState<ScanResponse['summary'] | null>(null);
	const [isScrolled, setIsScrolled] = useState(false);

	useEffect(() => {
		let mounted = true;
		const unlisten = listen<ScanProgress>('scan.progress', event => {
			if (!mounted) return;
			setProgress(event.payload);
		});

		return () => {
			mounted = false;
			void unlisten.then(off => off());
		};
	}, []);

	useEffect(() => {
		const onScroll = () => {
			setIsScrolled(window.scrollY > 8);
		};
		onScroll();
		window.addEventListener('scroll', onScroll, {passive: true});
		return () => window.removeEventListener('scroll', onScroll);
	}, []);

	useEffect(() => {
		if (import.meta.env.DEV) return;
		let isActive = true;
		const run = async () => {
			try {
				setUpdateMessage('Checking for updates...');
				const update = await checkForUpdates();
				if (!isActive) return;
				if (!update) {
					setUpdateMessage(null);
					return;
				}
				setUpdateMessage(`Update ${update.version} available. Downloading...`);
				await update.downloadAndInstall();
				if (!isActive) return;
				setUpdateMessage(`Update ${update.version} installed. Restart the app to apply.`);
			} catch (err) {
				if (!isActive) return;
				setUpdateMessage('Update check failed.');
				console.error('Updater error', err);
			}
		};
		void run();
		return () => {
			isActive = false;
		};
	}, []);

	useEffect(() => {
		let active = true;
		const loadStatus = async () => {
			try {
				const status = await invoke<{hasKey: boolean; model: string; source: string}>('ai_status');
				if (active) setAiKeyStatus(status);
			} catch {
				if (active) {
					setAiKeyStatus({hasKey: false, model: 'gemini-2.5-flash-lite', source: 'none'});
				}
			}
		};
		void loadStatus();
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		let active = true;
		const loadPaths = async () => {
			try {
				const [home, desktop, documents, downloads] = await Promise.all([
					homeDir(),
					desktopDir(),
					documentDir(),
					downloadDir(),
				]);
				if (!active) return;
				const entries = [
					{label: 'Home', path: home},
					{label: 'Desktop', path: desktop},
					{label: 'Documents', path: documents},
					{label: 'Downloads', path: downloads},
				].filter(item => Boolean(item.path)) as {label: string; path: string}[];
				setQuickPaths(entries);
				setDiskRoot(deriveDiskRoot(home));
			} catch {
				if (!active) return;
				setQuickPaths([]);
				setDiskRoot(null);
			}
		};
		void loadPaths();
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		if (!isLoading) return;
		const id = setInterval(() => {
			if (scanStartedAt) {
				const nextElapsed = Date.now() - scanStartedAt;
				setElapsedMs(nextElapsed);
				const previousDuration = lastScanDurations[scanKey];
				if (previousDuration && previousDuration > 0) {
					const remaining = Math.max(previousDuration - nextElapsed, 0);
					setEtaMs(remaining);
				} else {
					setEtaMs(null);
				}
			}
		}, 200);
		return () => clearInterval(id);
	}, [isLoading, scanStartedAt, lastScanDurations, scanKey]);

	useEffect(() => {
		if (!scanAll) return;
		const trimmed = rootPath.trim();
		if (trimmed === '' || trimmed === '.' || trimmed === './') {
			if (diskRoot) setRootPath(diskRoot);
		}
	}, [scanAll, diskRoot, rootPath]);

	const startScan = async () => {
		setError(null);
		setProjects([]);
		setProgress(null);
		setSelectedIds(new Set());
		setActiveId(null);
		setLastIndex(null);
		setIsLoading(true);
		const started = Date.now();
		setScanStartedAt(started);
		setElapsedMs(0);
		setEtaMs(null);

		const resolvedRoot = rootPath.trim() || '.';
		const request: ScanRequest = {
			rootPath: resolvedRoot,
			scanAll,
			aiEnabled,
			scanCaches,
		};
		const nextKey = `${resolvedRoot}|${scanAll ? 'all' : 'root'}|${scanCaches ? 'caches' : 'nocache'}`;
		setScanKey(nextKey);

		try {
			const result = await invoke<ScanResponse>('scan_start', {request});
			setProjects(result.projects);
			setAiStats(result.aiStats ?? null);
			setScanSummary(result.summary ?? null);
			setSelectedIds(new Set());
		} catch (error) {
			if (typeof error === 'string') {
				setError(error);
			} else if (error instanceof Error) {
				setError(error.message);
			} else {
				setError(`Scan failed: ${JSON.stringify(error)}`);
			}
		} finally {
			setIsLoading(false);
			const finished = Date.now() - started;
			setElapsedMs(finished);
			setLastScanDurations(prev => ({...prev, [nextKey]: finished}));
		}
	};

	useEffect(() => {
		void startScan();
	}, []);

	useEffect(() => {
		setLastIndex(null);
	}, [searchQuery, riskFilter, sortKey, sortDir]);

	const visibleProjects = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		let list = projects;

		if (riskFilter !== 'All') {
			list = list.filter(project => project.risk.className === riskFilter);
		}

		if (query) {
			list = list.filter(project =>
				project.name.toLowerCase().includes(query) ||
				project.path.toLowerCase().includes(query)
			);
		}

		const sorted = [...list].sort((a, b) => {
			if (sortKey === 'name') {
				const result = a.name.localeCompare(b.name);
				return sortDir === 'asc' ? result : -result;
			}

			let left = 0;
			let right = 0;

			switch (sortKey) {
				case 'size':
					left = a.sizeBytes;
					right = b.sizeBytes;
					break;
				case 'modified':
					left = a.lastModifiedDays;
					right = b.lastModifiedDays;
					break;
				case 'score':
					left = a.risk.score;
					right = b.risk.score;
					break;
				default:
					break;
			}

			const result = left === right ? 0 : left > right ? 1 : -1;
			return sortDir === 'asc' ? result : -result;
		});

		return sorted;
	}, [projects, riskFilter, searchQuery, sortKey, sortDir]);

	const progressPercent = useMemo(() => {
		if (!progress?.totalCount || progress.totalCount <= 0) return null;
		const ratio = Math.min(progress.scannedCount / progress.totalCount, 1);
		if (!Number.isFinite(ratio)) return null;
		return Math.round(ratio * 1000) / 10;
	}, [progress]);

	const liveEtaMs = useMemo(() => {
		if (!progress?.totalCount || progress.totalCount <= 0) return etaMs;
		if (!elapsedMs || elapsedMs <= 0 || progress.scannedCount <= 0) return etaMs;
		const rate = progress.scannedCount / elapsedMs;
		if (!Number.isFinite(rate) || rate <= 0) return etaMs;
		const remaining = Math.max(progress.totalCount - progress.scannedCount, 0);
		return Math.round(remaining / rate);
	}, [progress, elapsedMs, etaMs]);

	const selectedTotal = useMemo(() => {
		let total = 0;
		for (const project of projects) {
			if (selectedIds.has(project.id)) {
				total += project.sizeBytes;
			}
		}
		return formatBytes(total);
	}, [projects, selectedIds]);

	const reclaimableAfterDeletes = useMemo(() => {
		const totalBytes = projects.reduce((sum, project) => sum + project.sizeBytes, 0);
		return formatBytes(Math.max(totalBytes - reclaimedBytes, 0));
	}, [projects, reclaimedBytes]);

	const reclaimedTotal = useMemo(() => formatBytes(reclaimedBytes), [reclaimedBytes]);

	const selectedProject = useMemo(() => {
		if (activeId) {
			const active = projects.find(project => project.id === activeId);
			if (active) return active;
		}
		const first = projects.find(project => selectedIds.has(project.id));
		return first ?? null;
	}, [projects, selectedIds, activeId]);

	const selectedProjects = useMemo(() => {
		return projects.filter(project => selectedIds.has(project.id));
	}, [projects, selectedIds]);

	const deleteTargets = useMemo(() => {
		return selectedProjects.map(project => {
			if (project.isCache) {
				return {
					id: project.id,
					name: project.name,
					path: project.path,
					target: 'Cache folder',
				};
			}
			if (deleteDepsOnly) {
				return {
					id: project.id,
					name: project.name,
					path: project.path,
					target: 'node_modules + .cache (if present)',
				};
			}
			return {
				id: project.id,
				name: project.name,
				path: project.path,
				target: 'Project root',
			};
		});
	}, [selectedProjects, deleteDepsOnly]);

	const onRowClick = (
		list: ProjectRecord[],
		index: number,
		projectId: string,
		event: React.MouseEvent,
	) => {
		setActiveId(projectId);
		if (event.shiftKey && lastIndex !== null) {
			const start = Math.min(lastIndex, index);
			const end = Math.max(lastIndex, index);
			const next = new Set<string>();
			for (let i = start; i <= end; i += 1) {
				const target = list[i];
				if (target) next.add(target.id);
			}
			setSelectedIds(next);
			setLastIndex(index);
			return;
		}

		if (event.metaKey || event.ctrlKey) {
			const next = new Set(selectedIds);
			if (next.has(projectId)) {
				next.delete(projectId);
			} else {
				next.add(projectId);
			}
			setSelectedIds(next);
			setLastIndex(index);
			return;
		}

		setSelectedIds(new Set([projectId]));
		setLastIndex(index);
	};

	const onPickRoot = async () => {
		try {
			const selection = await open({
				title: 'Select scan root',
				directory: true,
				multiple: false,
				defaultPath: rootPath.trim() || undefined,
			});
			if (typeof selection === 'string') {
				setRootPath(selection);
			}
		} catch (error) {
			setError(error instanceof Error ? error.message : 'Failed to open dialog');
		}
	};

	const buildDeleteRequest = (dryRunOverride?: boolean): DeleteRequest => ({
		entries: selectedProjects.map(project => ({
			path: project.path,
			isCache: project.isCache,
		})),
		depsOnly: deleteDepsOnly,
		dryRun: dryRunOverride ?? deleteDryRun,
		quarantine: deleteQuarantine,
	});

	const refreshPlan = async () => {
		if (selectedProjects.length === 0) {
			setDeletePlan(null);
			return;
		}
		setDeleteBusy(true);
		setDeleteError(null);
		try {
			const plan = await invoke<DeleteResponse>('delete_execute', {
				request: buildDeleteRequest(true),
			});
			setDeletePlan(plan);
		} catch (error) {
			setDeleteError(error instanceof Error ? error.message : 'Failed to build plan');
		} finally {
			setDeleteBusy(false);
		}
	};

	useEffect(() => {
		if (!showReview) return;
		void refreshPlan();
	}, [showReview, deleteDepsOnly, deleteQuarantine, selectedProjects]);

	const onExecuteDelete = async () => {
		if (selectedProjects.length === 0) return;
		setDeleteBusy(true);
		setDeleteError(null);
		try {
			const response = await invoke<DeleteResponse>('delete_execute', {
				request: buildDeleteRequest(),
			});
			setDeletePlan(response);
			if (!deleteDryRun) {
				setReclaimedBytes(prev => prev + response.reclaimedBytes);
				const removedPaths = new Set(
					response.items
						.filter(item => item.status === 'deleted' || item.status === 'moved')
						.map(item => item.path),
				);
				if (removedPaths.size > 0) {
					setProjects(prevProjects =>
						prevProjects.filter(project => !removedPaths.has(project.path)),
					);
					setSelectedIds(new Set());
				}
			}
		} catch (error) {
			setDeleteError(error instanceof Error ? error.message : 'Delete failed');
		} finally {
			setDeleteBusy(false);
		}
	};

	const onExportPlan = async (format: 'json' | 'csv') => {
		if (!deletePlan || deletePlan.items.length === 0) {
			setDeleteError('No plan to export.');
			return;
		}
		const content =
			format === 'json'
				? JSON.stringify(deletePlan.items, null, 2)
				: [
						'path,sizeBytes,action,status,destination',
						...deletePlan.items.map(item =>
							[
								item.path.replace(/"/g, '""'),
								item.sizeBytes,
								item.action,
								item.status,
								item.destination ?? '',
							]
								.map(value => `"${value}"`)
								.join(',')
						),
					].join('\n');
		try {
			const target = await save({
				title: 'Export delete plan',
				defaultPath: `devclean-plan.${format}`,
			});
			if (!target || typeof target !== 'string') return;
			await invoke('export_plan', {request: {path: target, contents: content}});
		} catch (error) {
			setDeleteError(error instanceof Error ? error.message : 'Export failed');
		}
	};

	const submitFeedback = (vote: 'safe' | 'unsafe') => {
		if (!selectedProject) return;
		const entry = {vote, project: selectedProject, queuedAt: Date.now()};
		setFeedbackQueue(prev => [...prev, entry]);
		setFeedbackNote(null);
	};

	useEffect(() => {
		if (feedbackBusy || feedbackQueue.length === 0) return;
		let cancelled = false;
		const next = feedbackQueue[0];

		const run = async () => {
			setFeedbackBusy(true);
			try {
				const request: FeedbackRequest = {
					path: next.project.path,
					name: next.project.name,
					riskScore: next.project.risk?.score ?? 0,
					riskClass: next.project.risk?.className ?? 'Unknown',
					vote: next.vote,
				};
				await invoke('feedback_submit', {request});
				if (cancelled) return;
				const savedAt = Date.now();
				setFeedbackNote(`Saved ${new Date(savedAt).toLocaleTimeString()}`);
				setFeedbackList(prev => [
					{
						path: request.path,
						name: request.name,
						riskScore: request.riskScore,
						riskClass: request.riskClass,
						vote: request.vote,
						createdAt: savedAt,
					},
					...prev,
				]);
			} catch (error) {
				if (cancelled) return;
				setFeedbackNote(error instanceof Error ? error.message : 'Feedback failed');
			} finally {
				if (cancelled) return;
				setFeedbackQueue(prev => prev.slice(1));
				setFeedbackBusy(false);
			}
		};

		void run();
		return () => {
			cancelled = true;
		};
	}, [feedbackBusy, feedbackQueue]);

	const openFeedbackPanel = async () => {
		setShowFeedbackModal(true);
		try {
			const entries = await invoke<FeedbackEntry[]>('feedback_list');
			setFeedbackList(entries);
		} catch {
			setFeedbackList([]);
		}
	};

	const saveAiKey = async () => {
		setAiKeyMessage(null);
		try {
			await invoke('ai_save_key', {key: aiKeyInput});
			const status = await invoke<{hasKey: boolean; model: string; source: string}>('ai_status');
			setAiKeyStatus(status);
			setAiKeyInput('');
			setShowAiModal(false);
		} catch (error) {
			setAiKeyMessage(error instanceof Error ? error.message : 'Failed to save key');
		}
	};

	const clearAiKey = async () => {
		setAiKeyMessage(null);
		try {
			await invoke('ai_clear_key');
			const status = await invoke<{hasKey: boolean; model: string; source: string}>('ai_status');
			setAiKeyStatus(status);
		} catch (error) {
			setAiKeyMessage(error instanceof Error ? error.message : 'Failed to clear key');
		}
	};

	const sortLabel = (key: typeof sortKey, label: string) => {
		if (sortKey !== key) return label;
		return `${label} ${sortDir === 'asc' ? '↑' : '↓'}`;
	};

	const onHeaderSort = (key: typeof sortKey) => {
		if (sortKey === key) {
			setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
			return;
		}
		setSortKey(key);
		setSortDir('desc');
	};

	return (
		<ErrorBoundary>
			<div className="app">
			<header className={`header ${isScrolled ? 'scrolled' : ''}`}>
				<div>
					<h1>DevClean AI</h1>
					<p>Project Reclaim - Risk Engine</p>
				</div>
				<div className="stats">
					<span>Reclaimable {isLoading ? '...' : reclaimableAfterDeletes}</span>
					<span>Selected {selectedTotal}</span>
					<span>Reclaimed {reclaimedTotal}</span>
					{aiStats ? (
						<span>AI {aiStats.cacheHits} hit · {aiStats.cacheMisses} miss · {aiStats.calls} calls</span>
					) : null}
					<span>
						Scan {formatDuration(elapsedMs)}
						{isLoading && liveEtaMs !== null ? ` · ETA ${formatDuration(liveEtaMs)}` : ''}
					</span>
				</div>
			</header>

			<section className="panel">
				<div className="panel-header">
					<div>
						<h2>Scan</h2>
						<p>Risk: Critical 8-10 | Active 5-7 | Burner 0-4</p>
					</div>
					<div className="panel-actions">
						<button onClick={startScan} disabled={isLoading}>Rescan</button>
						<button
							type="button"
							className="ghost"
							disabled={selectedProjects.length === 0 || isLoading}
							onClick={() => {
								setShowReview(true);
								setConfirmText('');
								setDeleteError(null);
							}}
						>
							Review delete ({selectedProjects.length})
						</button>
						<button
							type="button"
							className="ghost"
							onClick={() => setShowAiModal(true)}
						>
							AI key
						</button>
						<button
							type="button"
							className="ghost"
							onClick={openFeedbackPanel}
						>
							Feedback
						</button>
					</div>
				</div>

				<div className="toolbar">
					<div className="field">
						<label htmlFor="rootPath">Root path</label>
						<div className="input-row">
							<input
								id="rootPath"
								value={rootPath}
								onChange={event => setRootPath(event.target.value)}
								placeholder="/Users/you/Projects"
							/>
							<button type="button" className="ghost" onClick={onPickRoot}>
								Browse
							</button>
						</div>
					</div>
					<div className="field">
						<label htmlFor="search">Search</label>
						<input
							id="search"
							value={searchQuery}
							onChange={event => setSearchQuery(event.target.value)}
							placeholder="name or path"
						/>
					</div>
					<div className="field">
						<label htmlFor="riskFilter">Risk</label>
						<select
							id="riskFilter"
							value={riskFilter}
							onChange={event => setRiskFilter(event.target.value as RiskClass | 'All')}
						>
							<option value="All">All</option>
							<option value="Critical">Critical</option>
							<option value="Active">Active</option>
							<option value="Burner">Burner</option>
						</select>
					</div>
					<div className="field">
						<label htmlFor="sortKey">Sort</label>
						<div className="sort-controls">
							<select
								id="sortKey"
								value={sortKey}
								onChange={event =>
									setSortKey(event.target.value as 'size' | 'modified' | 'score' | 'name')
								}
							>
								<option value="size">Size</option>
								<option value="modified">Modified</option>
								<option value="score">Risk score</option>
								<option value="name">Name</option>
							</select>
							<button
								type="button"
								className="ghost"
								onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
							>
								{sortDir === 'asc' ? '↑' : '↓'}
							</button>
						</div>
					</div>
					<label className="toggle">
						<input
							type="checkbox"
							checked={scanAll}
							onChange={event => setScanAll(event.target.checked)}
						/>
						<span>Full disk</span>
					</label>
					<label className="toggle">
						<input
							type="checkbox"
							checked={aiEnabled}
							onChange={event => {
								const next = event.target.checked;
								setAiEnabled(next);
								if (next && !aiKeyStatus?.hasKey) {
									setShowAiModal(true);
								}
							}}
						/>
						<span>AI</span>
					</label>
					<label className="toggle">
						<input
							type="checkbox"
							checked={scanCaches}
							onChange={event => setScanCaches(event.target.checked)}
						/>
						<span>Caches</span>
					</label>
				</div>
				{aiKeyStatus ? (
					<div className="ai-status">
						AI key: {aiKeyStatus.hasKey ? `set (${aiKeyStatus.source})` : 'missing'} · Model {aiKeyStatus.model}
					</div>
				) : null}
				{isLoading ? (
					<div className="scan-summary">
						Current settings: Root {rootPath || '.'} · Full disk {scanAll ? 'on' : 'off'} · Caches {scanCaches ? 'on' : 'off'}
					</div>
				) : null}
				{scanSummary ? (
					<div className="scan-summary">
						Last scan: Root {scanSummary.rootPath} · Full disk {scanSummary.scanAll ? 'on' : 'off'} · Caches {scanSummary.scanCaches ? 'on' : 'off'}
						{' '}· {scanSummary.projectCount} projects · {scanSummary.cacheCount} caches ({formatBytes(scanSummary.cacheBytes)}) · {scanSummary.totalEntries} entries · {scanSummary.skippedEntries} skipped
					</div>
				) : null}
				{quickPaths.length > 0 ? (
					<div className="quick-paths">
						<span>Quick paths:</span>
						{quickPaths.map(item => (
							<button
								key={item.label}
								type="button"
								className="chip"
								onClick={() => setRootPath(item.path)}
							>
								{item.label}
							</button>
						))}
						{diskRoot ? (
							<button
								type="button"
								className="chip"
								onClick={() => setRootPath(diskRoot)}
							>
								Disk root
							</button>
						) : null}
					</div>
				) : null}

				{isLoading ? (
					<div className="loader">
						<div className="bar">
							{progressPercent === null ? (
								<div className="pulse" />
							) : (
								<div className="fill" style={{width: `${progressPercent}%`}} />
							)}
						</div>
						<div className="loader-meta">
							<span>
								Scanning... {formatDuration(elapsedMs)}
								{liveEtaMs !== null ? ` · ETA ${formatDuration(liveEtaMs)}` : ''}
							</span>
							<span>
								Found {progress?.foundCount ?? 0} package.json files · Scanned {progress?.scannedCount ?? 0}/{progress?.totalCount ?? '--'} entries
							</span>
							{progress?.currentPath ? (
								<span>Last: {truncateMiddle(progress.currentPath, 80)}</span>
							) : null}
						</div>
					</div>
				) : null}

				{error ? <div className="error">{error}</div> : null}
				{updateMessage ? <div className="notice">{updateMessage}</div> : null}

				<div className="content">
					<div className="table">
						<div className="row header-row">
							<button type="button" onClick={() => onHeaderSort('name')}>
								{sortLabel('name', 'Name')}
							</button>
							<span>Risk</span>
							<button type="button" onClick={() => onHeaderSort('score')}>
								{sortLabel('score', 'Score')}
							</button>
							<button type="button" onClick={() => onHeaderSort('modified')}>
								{sortLabel('modified', 'Modified')}
							</button>
							<button type="button" onClick={() => onHeaderSort('size')}>
								{sortLabel('size', 'Size')}
							</button>
							<span>Path</span>
						</div>
						{visibleProjects.map((project, index) => {
							const riskLabel = project.risk?.className ?? 'Unknown';
							const riskClass =
								typeof riskLabel === 'string'
									? riskLabel.toLowerCase()
									: 'unknown';
							const isSelected = selectedIds.has(project.id);
							return (
								<div
									key={project.id}
									className={`row ${isSelected ? 'selected' : ''}`}
									onClick={event => onRowClick(visibleProjects, index, project.id, event)}
								>
									<span>{project.name}</span>
									<span className={`risk ${riskClass}`}>
										{riskLabel}
									</span>
									<span>{project.risk?.score ?? '--'}</span>
									<span>{project.lastModifiedDays}d</span>
									<span>{formatBytes(project.sizeBytes)}</span>
									<span className="path">{tailPath(project.path, 4)}</span>
								</div>
							);
						})}
						{!isLoading && visibleProjects.length === 0 ? (
							<div className="empty">No projects match your filters.</div>
						) : null}
					</div>
					<aside className="details">
						<h3>Project details</h3>
						{selectedProject ? (
							<div className="details-body">
								<p><strong>Name:</strong> {selectedProject.name}</p>
								<p><strong>Path:</strong> {selectedProject.path}</p>
								<p><strong>Size:</strong> {formatBytes(selectedProject.sizeBytes)}</p>
								<p><strong>Modified:</strong> {selectedProject.lastModifiedDays}d</p>
								<p><strong>Deps:</strong> {selectedProject.dependencyCount}</p>
								<p>
									<strong>Risk:</strong>{' '}
									{selectedProject.risk?.className ?? 'Unknown'} ({selectedProject.risk?.score ?? '--'})
								</p>
								<p><strong>Source:</strong> {selectedProject.risk?.source ?? 'Heuristic'}</p>
								<p>
									<strong>Flags:</strong>{' '}
									{selectedProject.hasGit ? 'git ' : ''}
									{selectedProject.hasEnvFile ? '.env ' : ''}
									{selectedProject.hasStartupKeyword ? 'startup ' : ''}
									{selectedProject.isCache ? 'cache' : ''}
								</p>
								<div className="feedback">
									<span>Was this safe?</span>
									<div className="feedback-actions">
										<button
											type="button"
											className="ghost"
											onClick={() => submitFeedback('safe')}
											disabled={feedbackBusy}
										>
											Safe
										</button>
										<button
											type="button"
											className="ghost"
											onClick={() => submitFeedback('unsafe')}
											disabled={feedbackBusy}
										>
											Unsafe
										</button>
									</div>
									{feedbackBusy ? <span className="muted">Saving…</span> : null}
									{feedbackNote ? <span className="muted">{feedbackNote}</span> : null}
									{feedbackQueue.length > 1 ? (
										<span className="muted">Queued {feedbackQueue.length - 1} more</span>
									) : null}
								</div>
								<div className="reason-block">
									<span>Reasons</span>
									<ul>
										{(selectedProject.risk?.reasons ?? []).map(reason => (
											<li key={reason}>{reason}</li>
										))}
									</ul>
								</div>
							</div>
						) : (
							<p className="muted">Select a project to see details.</p>
						)}
					</aside>
				</div>
			</section>
			{showReview ? (
				<div className="modal-backdrop" onClick={() => setShowReview(false)}>
					<div className="modal" onClick={event => event.stopPropagation()}>
						<header>
							<div>
								<h3>Review delete</h3>
								<p>
									{selectedProjects.length} selected ·{' '}
									{deletePlan ? formatBytes(deletePlan.reclaimedBytes) : '--'} reclaimable
								</p>
							</div>
							<button type="button" className="ghost" onClick={() => setShowReview(false)}>
								Close
							</button>
						</header>
						<div className="modal-body">
							<div className="review-options">
								<label className="toggle">
									<input
										type="checkbox"
										checked={!deleteDepsOnly}
										onChange={event => setDeleteDepsOnly(!event.target.checked)}
									/>
									<span className="toggle-label">
										Delete entire project
										<InfoTip text="On: removes the project folder. Off: only removes node_modules/.cache inside each project." />
									</span>
								</label>
								<label className="toggle">
									<input
										type="checkbox"
										checked={deleteQuarantine}
										onChange={event => setDeleteQuarantine(event.target.checked)}
									/>
									<span className="toggle-label">
										Quarantine
										<InfoTip text="On: move items into a local quarantine folder. Off: delete immediately." />
									</span>
								</label>
								<label className="toggle">
									<input
										type="checkbox"
										checked={deleteDryRun}
										onChange={event => setDeleteDryRun(event.target.checked)}
									/>
									<span className="toggle-label">
										Preview only
										<InfoTip text="On: build a preview without deleting. Off: delete immediately." />
									</span>
								</label>
							</div>

							{!deleteDepsOnly ? (
								<div className="warning">
									Full delete enabled. Selected project folders will be removed. Ensure you have backups before continuing.
								</div>
							) : null}

							<div className="target-preview">
								<div className="target-title">Targets preview</div>
								<div className="target-list">
									<div className="target-row header">
										<span>Project</span>
										<span>Target</span>
										<span>Path</span>
									</div>
									{deleteTargets.length === 0 ? (
										<div className="target-row">
											<span className="muted">No targets selected.</span>
											<span />
											<span />
										</div>
									) : (
										deleteTargets.map(target => (
											<div key={target.id} className="target-row">
												<span>{target.name}</span>
												<span className="muted">{target.target}</span>
												<span>{tailPath(target.path, 4)}</span>
											</div>
										))
									)}
								</div>
							</div>

							<div className="review-actions">
								<button type="button" className="ghost" onClick={() => onExportPlan('json')}>
									Export JSON
								</button>
								<button type="button" className="ghost" onClick={() => onExportPlan('csv')}>
									Export CSV
								</button>
							</div>

							{deleteDryRun ? (
								<div className="notice">Preview only is enabled. No files will be removed.</div>
							) : null}

							{deleteError ? <div className="error">{deleteError}</div> : null}
							{deleteBusy ? <div className="muted">Building plan...</div> : null}

							{deletePlan ? (
								<div className="review-summary">
									{deleteDryRun
										? `Preview: ${formatBytes(deletePlan.reclaimedBytes)} would be reclaimed.`
										: `${deletePlan.removedCount} items removed · ${formatBytes(deletePlan.reclaimedBytes)} reclaimed.`}
								</div>
							) : null}
							{deletePlan ? (
								<div className="review-list">
									<div className="review-row header">
										<span>Path</span>
										<span>Size</span>
										<span>Action</span>
										<span>Status</span>
									</div>
									{deletePlan.items.map(item => (
										<div key={item.path} className="review-row">
											<span>{tailPath(item.path, 4)}</span>
											<span>{formatBytes(item.sizeBytes)}</span>
											<span className="muted">{item.action}</span>
											<span className={item.status.startsWith('error') ? 'status error' : 'status'}>
												{item.status}
											</span>
										</div>
									))}
								</div>
							) : (
								<p className="muted">No plan generated yet.</p>
							)}
						</div>
						<footer>
							{deleteDryRun ? null : (
								<input
									value={confirmText}
									onChange={event => setConfirmText(event.target.value)}
									placeholder="Type DELETE to confirm"
									style={{display: 'none'}}
								/>
							)}
							<button
								type="button"
								onClick={onExecuteDelete}
								disabled={deleteBusy || selectedProjects.length === 0}
							>
								{deleteDryRun ? 'Preview delete' : 'Delete now'}
							</button>
						</footer>
					</div>
				</div>
			) : null}
			{showAiModal ? (
				<div className="modal-backdrop" onClick={() => setShowAiModal(false)}>
					<div className="modal" onClick={event => event.stopPropagation()}>
						<header>
							<div>
								<h3>Gemini API key</h3>
								<p>Stored locally in your app data directory. You can also set GEMINI_API_KEY as an env var.</p>
							</div>
							<button type="button" className="ghost" onClick={() => setShowAiModal(false)}>
								Close
							</button>
						</header>
						<div className="modal-body">
							<label className="field">
								<span>API key</span>
								<input
									value={aiKeyInput}
									onChange={event => setAiKeyInput(event.target.value)}
									placeholder="AIza..."
								/>
							</label>
							{aiKeyMessage ? <div className="error">{aiKeyMessage}</div> : null}
							{aiKeyStatus ? (
								<div className="muted">Status: {aiKeyStatus.hasKey ? `set (${aiKeyStatus.source})` : 'missing'}</div>
							) : null}
						</div>
						<footer>
							<button type="button" className="ghost" onClick={clearAiKey}>
								Clear
							</button>
							<button type="button" onClick={saveAiKey}>
								Save key
							</button>
						</footer>
					</div>
				</div>
			) : null}
			{showFeedbackModal ? (
				<div className="modal-backdrop" onClick={() => setShowFeedbackModal(false)}>
					<div className="modal" onClick={event => event.stopPropagation()}>
						<header>
							<div>
								<h3>Feedback log</h3>
								<p>Recent safety votes captured locally.</p>
							</div>
							<button type="button" className="ghost" onClick={() => setShowFeedbackModal(false)}>
								Close
							</button>
						</header>
						<div className="modal-body">
							{feedbackList.length === 0 ? (
								<p className="muted">No feedback yet. Use the Safe/Unsafe buttons in the details panel.</p>
							) : (
								<div className="review-list">
									<div className="review-row header">
										<span>Project</span>
										<span>Vote</span>
										<span>Score</span>
										<span>When</span>
									</div>
									{feedbackList.map(entry => (
										<div key={`${entry.path}-${entry.createdAt}`} className="review-row">
											<span>{entry.name}</span>
											<span className="muted">{entry.vote}</span>
											<span>{entry.riskScore}</span>
											<span className="muted">{new Date(entry.createdAt).toLocaleString()}</span>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			) : null}
		</div>
	</ErrorBoundary>
	);
}
