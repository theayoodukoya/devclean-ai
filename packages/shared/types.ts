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
	elapsedMs?: number;
};

export type ScanRequest = {
	rootPath: string;
	scanAll: boolean;
	aiEnabled: boolean;
	scanCaches: boolean;
};

export type DeleteRequest = {
	paths: string[];
	depsOnly: boolean;
	dryRun: boolean;
};
