#!/usr/bin/env node
import React from 'react';
import path from 'node:path';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ devclean-ai [--path <dir>] [--all] [--dry-run] [--no-ai]

	Options
	  --path       Root folder to scan (default: cwd)
	  --all        Scan entire disk (current drive)
	  --dry-run    Skip deletion, report actions only
	  --no-ai      Disable Gemini calls (heuristics only)

	Examples
	  $ devclean-ai --path ~/Projects
	  $ devclean-ai --dry-run
	`,
	{
		importMeta: import.meta,
		flags: {
			path: {
				type: 'string',
				default: process.cwd(),
			},
			all: {
				type: 'boolean',
				default: false,
			},
			dryRun: {
				type: 'boolean',
				default: false,
			},
			ai: {
				type: 'boolean',
				default: true,
			},
		},
	},
);

const rootPath = cli.flags.all ? path.parse(process.cwd()).root : cli.flags.path;

render(
	<App
		rootPath={rootPath}
		dryRun={cli.flags.dryRun}
		aiEnabled={cli.flags.ai}
		apiKey={process.env.GEMINI_API_KEY}
		scanAll={cli.flags.all}
	/>,
);
