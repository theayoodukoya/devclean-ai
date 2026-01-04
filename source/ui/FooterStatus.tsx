import React from 'react';
import {Box, Text} from 'ink';
import {ProjectRecord} from '../core/types.js';
import {formatBytes} from './format.js';

export type FooterStatusProps = {
	projects: ProjectRecord[];
	selectedCount: number;
	statusMessage: string | null;
	dryRun: boolean;
	aiEnabled: boolean;
	deleteMode: boolean;
	confirmText: string;
	totalSizeBytes: number;
	selectedSizeBytes: number;
	filterText: string;
	sortKey: string;
	sortDirection: string;
	deleteDependenciesOnly: boolean;
};

const countBy = (projects: ProjectRecord[], className: string) =>
	projects.filter(project => project.risk.className === className).length;

export const FooterStatus = ({
	projects,
	selectedCount,
	statusMessage,
	dryRun,
	aiEnabled,
	deleteMode,
	confirmText,
	totalSizeBytes,
	selectedSizeBytes,
	filterText,
	sortKey,
	sortDirection,
	deleteDependenciesOnly,
}: FooterStatusProps) => {
	const critical = countBy(projects, 'Critical');
	const active = countBy(projects, 'Active');
	const burner = countBy(projects, 'Burner');

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text color="#6B7280">
				Critical {critical} | Active {active} | Burner {burner} | Selected{' '}
				{selectedCount}
			</Text>
			<Text color="#6B7280">
				Total {formatBytes(totalSizeBytes)} | Selected{' '}
				{formatBytes(selectedSizeBytes)}
			</Text>
			<Text color="#6B7280">
				AI {aiEnabled ? 'on' : 'off'} | Dry run {dryRun ? 'on' : 'off'}
			</Text>
			<Text color="#6B7280">
				Sort {sortKey} ({sortDirection}) | Filter {filterText ? `"${filterText}"` : 'none'} | Deps-only{' '}
				{deleteDependenciesOnly ? 'on' : 'off'}
			</Text>
			{deleteMode ? (
				<Text color="#FF7A00">
					Type DELETE then Enter to confirm: {confirmText}
				</Text>
			) : (
				<Text color="#6B7280">
					Type to filter | Esc clear | Arrows move | Space toggle | Shift+Arrow range | Ctrl+A select burners | Ctrl+D delete | Ctrl+S sort | Ctrl+R order | Ctrl+X deps-only | Ctrl+E reasons | Tab details | Ctrl+Q quit
				</Text>
			)}
			{statusMessage ? <Text color="#FF7A00">{statusMessage}</Text> : null}
		</Box>
	);
};
