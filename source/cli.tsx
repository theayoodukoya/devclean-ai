#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ devclean-ai [--path <dir>] [--dry-run] [--no-ai]

	Options
	  --path       Root folder to scan (default: cwd)
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

render(
	<App
		rootPath={cli.flags.path}
		dryRun={cli.flags.dryRun}
		aiEnabled={cli.flags.ai}
		apiKey={process.env.GEMINI_API_KEY}
	/>,
);
