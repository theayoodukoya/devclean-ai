import {create} from 'zustand';
import {ProjectRecord, RiskClass} from '../core/types.js';

export type StoreState = {
	projects: ProjectRecord[];
	selectedIds: Set<string>;
	cursorIndex: number;
	rangeAnchor: number | null;
	isLoading: boolean;
	error: string | null;
	statusMessage: string | null;
	deleteMode: boolean;
	confirmText: string;
	dryRun: boolean;
	aiEnabled: boolean;
};

export type StoreActions = {
	setProjects: (projects: ProjectRecord[]) => void;
	setLoading: (isLoading: boolean) => void;
	setError: (error: string | null) => void;
	setStatus: (message: string | null) => void;
	moveCursor: (delta: number) => void;
	setCursor: (index: number) => void;
	setRangeAnchor: (index: number | null) => void;
	toggleSelect: (index: number) => void;
	selectRange: (from: number, to: number) => void;
	selectAllByClass: (className: RiskClass) => void;
	clearSelection: () => void;
	startDelete: () => void;
	cancelDelete: () => void;
	updateConfirmText: (text: string) => void;
	setDryRun: (dryRun: boolean) => void;
	setAiEnabled: (enabled: boolean) => void;
};

export const useStore = create<StoreState & StoreActions>((set, get) => ({
	projects: [],
	selectedIds: new Set(),
	cursorIndex: 0,
	rangeAnchor: null,
	isLoading: true,
	error: null,
	statusMessage: null,
	deleteMode: false,
	confirmText: '',
	dryRun: false,
	aiEnabled: true,
	setProjects: projects => set({projects}),
	setLoading: isLoading => set({isLoading}),
	setError: error => set({error}),
	setStatus: statusMessage => set({statusMessage}),
	moveCursor: delta => {
		const {projects, cursorIndex} = get();
		if (projects.length === 0) return;
		const next = Math.max(0, Math.min(projects.length - 1, cursorIndex + delta));
		set({cursorIndex: next});
	},
	setCursor: index => {
		const {projects} = get();
		const next = Math.max(0, Math.min(projects.length - 1, index));
		set({cursorIndex: next});
	},
	setRangeAnchor: index => set({rangeAnchor: index}),
	toggleSelect: index => {
		const {projects, selectedIds} = get();
		const project = projects[index];
		if (!project) return;
		const next = new Set(selectedIds);
		if (next.has(project.id)) {
			next.delete(project.id);
		} else {
			next.add(project.id);
		}
		set({selectedIds: next, rangeAnchor: index});
	},
	selectRange: (from, to) => {
		const {projects, selectedIds} = get();
		const next = new Set(selectedIds);
		const start = Math.min(from, to);
		const end = Math.max(from, to);
		for (let i = start; i <= end; i++) {
			const project = projects[i];
			if (project) next.add(project.id);
		}
		set({selectedIds: next});
	},
	selectAllByClass: className => {
		const {projects} = get();
		const next = new Set<string>();
		for (const project of projects) {
			if (project.risk.className === className) {
				next.add(project.id);
			}
		}
		set({selectedIds: next});
	},
	clearSelection: () => set({selectedIds: new Set()}),
	startDelete: () => set({deleteMode: true, confirmText: ''}),
	cancelDelete: () => set({deleteMode: false, confirmText: ''}),
	updateConfirmText: text => set({confirmText: text}),
	setDryRun: dryRun => set({dryRun}),
	setAiEnabled: enabled => set({aiEnabled: enabled}),
}));
