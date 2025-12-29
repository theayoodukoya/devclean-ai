import React from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';
import gradient from 'gradient-string';

export const Header = () => {
	const title = gradient('cyan', 'blue')('DevClean AI');
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text>{title}</Text>
			<Text>{chalk.hex('#0047AB')('Project Reclaim - Risk Engine')}</Text>
		</Box>
	);
};
