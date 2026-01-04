import React from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';
import {ProjectRecord, RiskClass} from '../core/types.js';
import {formatBytes} from './format.js';

const riskColors: Record<RiskClass, string> = {
	Critical: '#FF7A00',
	Active: '#0047AB',
	Burner: '#6B7280',
};

const selectionBg = '#0047AB';
const selectionFg = '#FFFFFF';
const cursorBg = '#0F2A44';

const safeTruncate = (value: string, length: number) => {
	if (value.length <= length) return value.padEnd(length);
	return `${value.slice(0, Math.max(0, length - 3))}...`;
};

const tailTruncate = (value: string, length: number) => {
	if (value.length <= length) return value.padEnd(length);
	const parts = value.split('/');
	const sep = '/';
	const tailCount = Math.min(3, parts.length);
	const tail = parts.slice(-tailCount).join(sep);
	if (tail.length + 4 >= length) {
		return `...${tail.slice(-Math.max(0, length - 3))}`;
	}
	return `...${sep}${tail}`.padEnd(length);
};

export type ProjectListProps = {
	projects: ProjectRecord[];
	cursorIndex: number;
	selectedIds: Set<string>;
	availableWidth: number;
};

export const ProjectList = ({
	projects,
	cursorIndex,
	selectedIds,
	availableWidth,
}: ProjectListProps) => {
	if (projects.length === 0) {
		return (
			<Text color="#6B7280">
				No projects found. Try running from a folder with package.json files.
			</Text>
		);
	}

	const selWidth = 5; // ">[ ] "
	const riskWidth = 8;
	const scoreWidth = 6;
	const modifiedWidth = 9;
	const sizeWidth = 9;
	const minNameWidth = 16;
	const maxNameWidth = 30;
	const separators = 6;
	const baseWidth = selWidth + riskWidth + scoreWidth + modifiedWidth + sizeWidth + separators;
	const remaining = Math.max(20, availableWidth - baseWidth);
	const nameWidth = Math.min(
		maxNameWidth,
		Math.max(minNameWidth, Math.floor(remaining * 0.35)),
	);
	const pathWidth = Math.max(20, availableWidth - (baseWidth + nameWidth));
	const sep = ' ';

	const header =
		'Sel'.padEnd(selWidth) +
		sep +
		'Name'.padEnd(nameWidth) +
		sep +
		'Risk'.padEnd(riskWidth) +
		sep +
		'Score'.padEnd(scoreWidth) +
		sep +
		'Modified'.padEnd(modifiedWidth) +
		sep +
		'Size'.padEnd(sizeWidth) +
		sep +
		'Path'.padEnd(pathWidth);

	return (
		<Box flexDirection="column">
			<Box>
				<Text color="#6B7280">{header}</Text>
			</Box>
			<Text color="#6B7280">
				Risk: Critical 8-10 | Active 5-7 | Burner 0-4 | Modified = days since change | Size = folder size
			</Text>
			{projects.map((project, index) => {
				const isSelected = selectedIds.has(project.id);
				const isCursor = index === cursorIndex;
				const indicator = isSelected ? '[x]' : '[ ]';
				const cursor = isCursor ? '>' : ' ';
				const label = project.risk.className.padEnd(riskWidth);
				const name = safeTruncate(project.name, nameWidth).padEnd(nameWidth);
				const modified = `${project.lastModifiedDays}d`.padEnd(modifiedWidth);
				const sizeLabel = safeTruncate(formatBytes(project.sizeBytes), sizeWidth).padEnd(sizeWidth);
				const pathLabel = tailTruncate(project.path, pathWidth);
				const score = project.risk.score.toString().padEnd(scoreWidth);
				const selText = `${cursor}${indicator} `.padEnd(selWidth);

				const row =
					selText +
					sep +
					name +
					sep +
					label +
					sep +
					score +
					sep +
					modified +
					sep +
					sizeLabel +
					sep +
					pathLabel;

				if (isSelected) {
					return (
						<Text key={project.id} color={selectionFg} backgroundColor={selectionBg}>
							{row}
						</Text>
					);
				}

				const riskColor = riskColors[project.risk.className];
				const rowWithRisk = row.replace(label, chalk.hex(riskColor)(label));

				if (isCursor) {
					return (
						<Text key={project.id} backgroundColor={cursorBg}>
							{rowWithRisk}
						</Text>
					);
				}

				return <Text key={project.id}>{rowWithRisk}</Text>;
			})}
		</Box>
	);
};
