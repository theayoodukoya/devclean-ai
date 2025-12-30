export type RiskClass = 'Critical' | 'Active' | 'Burner';

export type RiskSource = 'heuristic' | 'ai' | 'combined';

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
};

export type ProjectRecord = ProjectMeta & {
	risk: RiskAssessment;
};
