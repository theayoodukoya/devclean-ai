import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import {formatDuration} from './format.js';

export type ScanStatusProps = {
	foundCount: number;
	currentPath: string | null;
	elapsedMs: number | null;
};

const frames = ['|', '/', '-', '\\'];

const buildBar = (index: number, width: number) => {
	const position = index % width;
	const head = '='.repeat(position);
	const tail = ' '.repeat(Math.max(0, width - position - 1));
	return `[${head}>${tail}]`;
};

const truncateMiddle = (value: string, max: number) => {
	if (value.length <= max) return value;
	const keep = Math.max(4, Math.floor((max - 3) / 2));
	return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};

export const ScanStatus = ({foundCount, currentPath, elapsedMs}: ScanStatusProps) => {
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		const id = setInterval(() => {
			setFrameIndex(index => index + 1);
		}, 120);

		return () => {
			clearInterval(id);
		};
	}, []);

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text color="#6B7280">
				{frames[frameIndex % frames.length]} Scanning {buildBar(frameIndex, 24)} {formatDuration(elapsedMs)}
			</Text>
			<Text color="#6B7280">Found {foundCount} package.json files</Text>
			{currentPath ? (
				<Text color="#6B7280">Last: {truncateMiddle(currentPath, 72)}</Text>
			) : null}
		</Box>
	);
};
