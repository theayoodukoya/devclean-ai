import React from 'react';
import {Box, Text} from 'ink';
import {ProjectRecord} from '../core/types.js';
import {formatBytes} from './format.js';
import {RiskLegend} from './RiskLegend.js';

export type ProjectDetailsProps = {
	project: ProjectRecord | undefined;
	showAllReasons: boolean;
};

const line = (label: string, value: string) => (
	<Text>
		<Text color="#6B7280">{label}</Text>
		<Text> {value}</Text>
	</Text>
);

export const ProjectDetails = ({project, showAllReasons}: ProjectDetailsProps) => {
	if (!project) {
		return <Text color="#6B7280">No selection</Text>;
	}

	const flags = [
		project.hasGit ? 'git' : null,
		project.hasEnvFile ? '.env' : null,
		project.hasStartupKeyword ? 'startup' : null,
	].filter(Boolean);

	return (
		<Box flexDirection="column" paddingLeft={2}>
			<Text color="#0047AB">Project details</Text>
			{line('Name:', project.name)}
			{line('Path:', project.path)}
			{line('Size:', formatBytes(project.sizeBytes))}
			{line('Modified:', `${project.lastModifiedDays}d ago`)}
			{line('Deps:', project.dependencyCount.toString())}
			{line('Risk:', `${project.risk.className} (${project.risk.score})`)}
			{line('Flags:', flags.length ? flags.join(', ') : 'none')}
			<Box flexDirection="column" marginTop={1}>
				<Text color="#6B7280">Reasons</Text>
				{project.risk.reasons.length === 0 ? (
					<Text color="#6B7280">No reasons provided.</Text>
				) : (
					(showAllReasons ? project.risk.reasons : project.risk.reasons.slice(0, 6)).map(
						reason => (
							<Text key={reason}>- {reason}</Text>
						),
					)
				)}
				{project.risk.reasons.length > 6 && !showAllReasons ? (
					<Text color="#6B7280">Ctrl+E to show all reasons.</Text>
				) : null}
			</Box>
			<RiskLegend />
		</Box>
	);
};
