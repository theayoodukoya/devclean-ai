import {ProjectMeta, RiskAssessment, RiskClass} from './types.js';
import {isBurnerName} from './scanner.js';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const classify = (score: number): RiskClass => {
	if (score >= 8) return 'Critical';
	if (score >= 5) return 'Active';
	return 'Burner';
};

export const evaluateHeuristicRisk = (project: ProjectMeta): RiskAssessment => {
	let score = 0;
	const reasons: string[] = [];

	if (project.hasGit) {
		score += 4;
		reasons.push('Git history detected');
	}

	if (project.hasEnvFile) {
		score += 3;
		reasons.push('Environment file present');
	}

	if (project.hasStartupKeyword) {
		score += 3;
		reasons.push('Startup keywords in package.json');
	}

	if (project.lastModifiedDays <= 30) {
		score += 2;
		reasons.push('Modified within 30 days');
	}

	if (project.dependencyCount >= 40) {
		score += 1;
		reasons.push('High dependency count');
	}

	if (isBurnerName(project.name)) {
		score -= 2;
		reasons.push('Name matches tutorial/test patterns');
	}

	if (project.lastModifiedDays >= 180) {
		score -= 1;
		reasons.push('Inactive for 6+ months');
	}

	score = clamp(score, 0, 10);

	return {
		className: classify(score),
		score,
		reasons,
		source: 'heuristic',
	};
};

export const mergeRisk = (heuristic: RiskAssessment, ai: RiskAssessment | null): RiskAssessment => {
	if (!ai) return heuristic;

	const score = clamp(Math.round((heuristic.score + ai.score) / 2), 0, 10);
	const className: RiskClass = score >= 8 ? 'Critical' : score >= 5 ? 'Active' : 'Burner';
	const reasons = Array.from(new Set([...heuristic.reasons, ...ai.reasons]));

	return {
		className,
		score,
		reasons,
		source: 'combined',
	};
};
