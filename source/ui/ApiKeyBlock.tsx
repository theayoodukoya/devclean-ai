import React from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';

export const ApiKeyBlock = () => (
	<Box flexDirection="column">
		<Text color="#FF7A00">Gemini API key required</Text>
		<Text>
			Set the key, then re-run:{' '}
			{chalk.hex('#0047AB')('export GEMINI_API_KEY="your_key_here"')}
		</Text>
		<Text>
			Or run with heuristics only: {chalk.hex('#0047AB')('devclean-ai --no-ai')}
		</Text>
		<Text color="#6B7280">Press Q to quit.</Text>
	</Box>
);
