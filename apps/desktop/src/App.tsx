import React, {useEffect, useMemo, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {homeDir, desktopDir, documentDir, downloadDir} from '@tauri-apps/api/path';
import {open} from '@tauri-apps/plugin-dialog';
import type {ProjectRecord, ScanProgress, ScanRequest, RiskClass} from '@shared/types';
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
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
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
				setElapsedMs(Date.now() - scanStartedAt);
			}
		}, 200);
		return () => clearInterval(id);
	}, [isLoading, scanStartedAt]);

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
		setLastIndex(null);
		setIsLoading(true);
		const started = Date.now();
		setScanStartedAt(started);
		setElapsedMs(0);

		const resolvedRoot = rootPath.trim() || '.';
		const request: ScanRequest = {
			rootPath: resolvedRoot,
			scanAll,
			aiEnabled,
			scanCaches,
		};

		try {
			const result = await invoke<{projects: ProjectRecord[]}>('scan_start', {request});
			setProjects(result.projects);
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
			setElapsedMs(Date.now() - started);
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

	const totals = useMemo(() => {
		const total = projects.reduce((sum, project) => sum + project.sizeBytes, 0);
		return formatBytes(total);
	}, [projects]);

	const selectedTotal = useMemo(() => {
		let total = 0;
		for (const project of projects) {
			if (selectedIds.has(project.id)) {
				total += project.sizeBytes;
			}
		}
		return formatBytes(total);
	}, [projects, selectedIds]);

	const selectedProject = useMemo(() => {
		const first = projects.find(project => selectedIds.has(project.id));
		return first ?? null;
	}, [projects, selectedIds]);

	const onRowClick = (
		list: ProjectRecord[],
		index: number,
		projectId: string,
		event: React.MouseEvent,
	) => {
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

	return (
		<ErrorBoundary>
			<div className="app">
			<header className="header">
				<div>
					<h1>DevClean AI</h1>
					<p>Project Reclaim - Risk Engine</p>
				</div>
				<div className="stats">
					<span>Reclaimable {isLoading ? '...' : totals}</span>
					<span>Selected {selectedTotal}</span>
					<span>Scan {formatDuration(isLoading ? elapsedMs : elapsedMs)}</span>
				</div>
			</header>

			<section className="panel">
				<div className="panel-header">
					<div>
						<h2>Scan</h2>
						<p>Risk: Critical 8-10 | Active 5-7 | Burner 0-4</p>
					</div>
					<button onClick={startScan} disabled={isLoading}>Rescan</button>
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
							onChange={event => setAiEnabled(event.target.checked)}
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
							<div className="pulse" />
						</div>
						<div className="loader-meta">
							<span>Scanning... {formatDuration(elapsedMs)}</span>
							<span>Found {progress?.foundCount ?? 0} package.json files</span>
							{progress?.currentPath ? (
								<span>Last: {truncateMiddle(progress.currentPath, 80)}</span>
							) : null}
						</div>
					</div>
				) : null}

				{error ? <div className="error">{error}</div> : null}

				<div className="content">
					<div className="table">
						<div className="row header-row">
							<span>Name</span>
							<span>Risk</span>
							<span>Score</span>
							<span>Modified</span>
							<span>Size</span>
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
								<p>
									<strong>Flags:</strong>{' '}
									{selectedProject.hasGit ? 'git ' : ''}
									{selectedProject.hasEnvFile ? '.env ' : ''}
									{selectedProject.hasStartupKeyword ? 'startup ' : ''}
									{selectedProject.isCache ? 'cache' : ''}
								</p>
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
			</div>
		</ErrorBoundary>
	);
}
