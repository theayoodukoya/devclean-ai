import React from 'react';
import {Box, Text} from 'ink';
import {ProjectRecord, RiskClass} from '../core/types.js';
import {formatBytes} from './format.js';

const riskColors: Record<RiskClass, string> = {
	Critical: '#FF7A00',
	Active: '#0047AB',
	Burner: '#6B7280',
};

const selectionBg = '#0047AB';
const selectionFg = '#FFFFFF';

const safeTruncate = (value: string, length: number) => {
	if (value.length <= length) return value.padEnd(length);
	return `${value.slice(0, Math.max(0, length - 3))}...`;
};

export type ProjectListProps = {
	projects: ProjectRecord[];
	cursorIndex: number;
	selectedIds: Set<string>;
};

export const ProjectList = ({
	projects,
	cursorIndex,
	selectedIds,
}: ProjectListProps) => {
	if (projects.length === 0) {
		return (
			<Text color="#6B7280">
				No projects found. Try running from a folder with package.json files.
			</Text>
		);
	}

	return (
		<Box flexDirection="column">
			<Box>
				<Text color="#6B7280">
					{' '}
					Sel Name{' '.repeat(20)} Risk Score Modified Size Path
				</Text>
			</Box>
			{projects.map((project, index) => {
				const isSelected = selectedIds.has(project.id);
				const isCursor = index === cursorIndex;
				const indicator = isSelected ? '[x]' : '[ ]';
				const cursor = isCursor ? '>' : ' ';
				const label = project.risk.className.padEnd(7);
				const name = safeTruncate(project.name, 24);
				const modified = `${project.lastModifiedDays}d`.padEnd(9);
				const sizeLabel = safeTruncate(formatBytes(project.sizeBytes), 8);
				const pathLabel = safeTruncate(project.path, 44);
				const score = project.risk.score.toString().padEnd(5);
				const rowColor = isSelected ? selectionFg : undefined;
				const rowBackground = isSelected ? selectionBg : undefined;
				const riskColor = isSelected
					? selectionFg
					: riskColors[project.risk.className];

				return (
					<Box key={project.id}>
						<Text color={rowColor} backgroundColor={rowBackground}>
							{cursor}
							{indicator} {name}
						</Text>
						<Text color={riskColor} backgroundColor={rowBackground}>
							{label}
						</Text>
						<Text color={rowColor} backgroundColor={rowBackground}>
							{score}
							{modified}
							{sizeLabel}
							{pathLabel}
						</Text>
					</Box>
				);
			})}
		</Box>
	);
};
