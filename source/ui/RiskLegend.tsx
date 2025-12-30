import React from 'react';
import {Box, Text} from 'ink';

export const RiskLegend = () => (
	<Box flexDirection="column" marginTop={1}>
		<Text color="#0047AB">Risk levels</Text>
		<Text>
			<Text color="#FF7A00">Critical</Text> 8-10: protected, high-value, likely active
		</Text>
		<Text>
			<Text color="#0047AB">Active</Text> 5-7: recent activity, moderate risk
		</Text>
		<Text>
			<Text color="#6B7280">Burner</Text> 0-4: tutorial/old, safe to bulk delete
		</Text>
	</Box>
);
