import { basename } from "node:path";
import { completionScript, type Shell, shells } from "../completion";
import { error } from "../errors";
import { output } from "../output";
import type { Command } from "../spec";

export const completion: Command = {
	name: "completion",
	summary: "Print a tab-completion script for bash, zsh or fish.",
	description:
		'Completes commands, shorthands, flags, flag values, saved workspaces and file names, for both boldvideo and bold. Without a shell it uses $SHELL. Load it from your shell\'s startup file:\n  zsh:  eval "$(boldvideo completion zsh)"   in ~/.zshrc, after compinit\n  bash: eval "$(boldvideo completion bash)"  in ~/.bashrc\n  fish: boldvideo completion fish | source   in ~/.config/fish/config.fish\nThe script prints as text even when piped; --json returns {shell, script}. Completion reads only local files and never calls the API.',
	auth: "none",
	args: [
		{
			name: "shell",
			description: "bash, zsh or fish; defaults to the shell in $SHELL.",
			required: false,
			choices: [...shells],
		},
	],
	examples: [
		{
			cmd: "boldvideo completion zsh",
			note: "Print the zsh completion script.",
		},
		{
			cmd: "boldvideo completion fish --json",
			note: "Read the fish script as JSON.",
		},
	],
	seeAlso: ["boldvideo --help"],
	run(_ctx, args, flags) {
		const shell = args[0] ?? basename(process.env.SHELL ?? "");
		if (!shells.includes(shell as Shell))
			throw error(
				"usage_error",
				args[0]
					? `Unsupported shell '${args[0]}'. Choose bash, zsh or fish.`
					: "Could not tell your shell from $SHELL. Name it: bash, zsh or fish.",
				"boldvideo completion zsh",
				2,
			);
		const script = completionScript(shell as Shell);
		output({ shell, script }, script.trimEnd(), flags.json === true || "text");
	},
};
