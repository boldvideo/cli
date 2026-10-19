export type FlagValue = string | number | boolean | string[];
export type Flags = Record<string, FlagValue | undefined>;

export interface Flag {
	name: string;
	type: "string" | "number" | "boolean" | "list";
	default?: FlagValue;
	description: string;
	required?: boolean;
}

export interface Context {
	json: boolean;
	debug: boolean;
	commands: Command[];
	path: string[];
}

export interface Command {
	name: string;
	summary: string;
	description?: string;
	args?: { name: string; description: string; required?: boolean }[];
	flags?: Flag[];
	examples: [{ cmd: string; note: string }, { cmd: string; note: string }];
	seeAlso: string[];
	write?: boolean;
	destructive?: boolean;
	list?: boolean;
	subcommands?: Command[];
	run?: (ctx: Context, args: string[], flags: Flags) => void | Promise<void>;
}

export function commandFlags(command: Command): Flag[] {
	return [
		{
			name: "help",
			type: "boolean",
			default: false,
			description: "Show command help.",
		},
		{
			name: "json",
			type: "boolean",
			default: false,
			description: "Print JSON, even on a terminal.",
		},
		{
			name: "debug",
			type: "boolean",
			default: false,
			description:
				"Enable diagnostics on terminal stderr; never print API keys.",
		},
		...(command.list
			? [
					{
						name: "limit",
						type: "number" as const,
						default: 20,
						description: "Maximum items to return (positive integer).",
					},
					{
						name: "fields",
						type: "list" as const,
						description: "API fields to include, comma-separated or repeated.",
					},
				]
			: []),
		...(command.write || command.destructive
			? [
					{
						name: "dry-run",
						type: "boolean" as const,
						default: false,
						description: "Preview the write without making changes.",
					},
					{
						name: "yes",
						type: "boolean" as const,
						default: false,
						description: "Confirm a destructive operation.",
					},
				]
			: []),
		...(command.flags ?? []),
	];
}
