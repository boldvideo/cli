import { exitCodes } from "../exit-codes";
import { rootCommand, showHelp } from "../help";
import { output, table } from "../output";
import type { Command } from "../spec";

export const help: Command = {
	name: "help",
	summary: "Show the command tree and exit codes.",
	auth: "none",
	examples: [
		{
			cmd: "boldvideo help --json",
			note: "Read every command and flag as JSON.",
		},
		{ cmd: "boldvideo help exit-codes", note: "Look up process exit codes." },
	],
	seeAlso: ["boldvideo --help", "boldvideo help exit-codes"],
	subcommands: [
		{
			name: "exit-codes",
			summary: "Explain process exit codes.",
			auth: "none",
			examples: [
				{ cmd: "boldvideo help exit-codes", note: "Read the exit-code table." },
				{
					cmd: "boldvideo help exit-codes --json",
					note: "Read exit codes in a script.",
				},
			],
			seeAlso: ["boldvideo help --json"],
			run(ctx) {
				output(exitCodes, table([...exitCodes]), ctx.json);
			},
		},
	],
	run(ctx) {
		showHelp(rootCommand(ctx.commands), [], ctx.json);
	},
};
