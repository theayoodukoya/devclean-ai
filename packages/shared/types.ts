export type RiskClass = 'Critical' | 'Active' | 'Burner';

export type RiskSource = 'Heuristic' | 'Ai' | 'Combined';

export type RiskAssessment = {
	className: RiskClass;
	score: number;
	reasons: string[];
	source: RiskSource;
};

export type ProjectMeta = {
	id: string;
	path: string;
	name: string;
	packageJsonPath: string;
	dependencyCount: number;
	hasGit: boolean;
	hasEnvFile: boolean;
	hasStartupKeyword: boolean;
	lastModified: number;
	lastModifiedDays: number;
	sizeBytes: number;
	isCache: boolean;
};

export type ProjectRecord = ProjectMeta & {
	risk: RiskAssessment;
};

export type ScanProgress = {
	foundCount: number;
	currentPath: string;
	scannedCount: number;
	totalCount?: number;
	elapsedMs?: number;
};

export type AiStats = {
	cacheHits: number;
	cacheMisses: number;
	calls: number;
};

export type ScanRequest = {
	rootPath: string;
	scanAll: boolean;
	aiEnabled: boolean;
	scanCaches: boolean;
};

export type ScanResponse = {
	projects: ProjectRecord[];
	aiStats?: AiStats;
	summary?: ScanSummary;
};

export type ScanSummary = {
	rootPath: string;
	scanAll: boolean;
	scanCaches: boolean;
	totalEntries: number;
	skippedEntries: number;
	projectCount: number;
	cacheCount: number;
	cacheBytes: number;
};

export type DeleteRequest = {
	entries: {path: string; isCache?: boolean}[];
	depsOnly: boolean;
	dryRun: boolean;
	quarantine: boolean;
};

export type DeleteItem = {
	path: string;
	sizeBytes: number;
	action: string;
	status: string;
	destination?: string;
	originalPath?: string;
};

export type DeleteResponse = {
	removedCount: number;
	reclaimedBytes: number;
	items: DeleteItem[];
};

export type FeedbackRequest = {
	path: string;
	name: string;
	riskScore: number;
	riskClass: string;
	vote: 'safe' | 'unsafe';
};

export type FeedbackEntry = FeedbackRequest & {
	createdAt: number;
};
