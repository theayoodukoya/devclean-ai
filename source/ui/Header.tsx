import React from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';
import gradient from 'gradient-string';

export type HeaderProps = {
	totalLabel?: string;
	selectedLabel?: string;
	durationLabel?: string;
};

export const Header = ({totalLabel, selectedLabel, durationLabel}: HeaderProps) => {
	const title = gradient('cyan', 'blue')('DevClean AI');
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text>{title}</Text>
			<Text>{chalk.hex('#0047AB')('Project Reclaim - Risk Engine')}</Text>
			<Text color="#6B7280">
				Reclaimable {totalLabel ?? '--'} | Selected {selectedLabel ?? '--'} | Scan {durationLabel ?? '--'}
			</Text>
		</Box>
	);
};
