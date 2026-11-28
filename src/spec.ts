import type { Credential } from "./auth";

export type FlagValue = string | number | boolean | string[];
export type Flags = Record<string, FlagValue | undefined>;

export interface Flag {
	name: string;
	short?: string;
	type: "string" | "number" | "boolean" | "list";
	/** Preserve each repeated value verbatim instead of splitting comma lists. */
	verbatim?: boolean;
	default?: FlagValue;
	description: string;
	required?: boolean;
	destructive?: boolean;
	/** Known values, offered by tab completion. Validation stays with the command or the API. */
	choices?: string[];
	/** What tab completion offers when there are no fixed choices. */
	complete?: Completion;
}

/** Values tab completion can look up locally, without a network call. */
export type Completion = "profiles" | "file";

export interface Context {
	json: boolean;
	debug: boolean;
	commands: Command[];
	path: string[];
	credential?: Credential;
}

export interface Command {
	name: string;
	/** Shorter names that run the same command, such as v for videos. */
	aliases?: string[];
	summary: string;
	description?: string;
	args?: {
		name: string;
		description: string;
		required?: boolean;
		variadic?: boolean;
		choices?: string[];
		complete?: Completion;
	}[];
	flags?: Flag[];
	examples: [{ cmd: string; note: string }, { cmd: string; note: string }];
	seeAlso: string[];
	write?: boolean;
	destructive?: boolean;
	list?: boolean;
	/** Defaults to any; local commands explicitly opt out. */
	auth?: "any" | "admin" | "none";
	subcommands?: Command[];
	run?: (ctx: Context, args: string[], flags: Flags) => void | Promise<void>;
}

export function commandFlags(command: Command): Flag[] {
	return [
		{
			name: "help",
			short: "h",
			type: "boolean",
			default: false,
			description: "Show command help.",
		},
		{
			name: "json",
			short: "j",
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
		{
			name: "profile",
			short: "p",
			type: "string",
			complete: "profiles",
			description:
				"Use a stored profile for this call; BOLDVIDEO_API_KEY takes precedence.",
		},
		{
			name: "tenant",
			short: "t",
			type: "string",
			complete: "profiles",
			description:
				"Run this call in another signed-in workspace, by slug. Same as --profile.",
		},
		...(command.list
			? [
					{
						name: "limit",
						short: "n",
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
						short: "y",
						type: "boolean" as const,
						default: false,
						description: "Confirm a destructive operation.",
					},
				]
			: []),
		...(command.flags ?? []),
	];
}

/** A group run without a subcommand lists: `boldvideo videos` is `boldvideo videos list`. */
export function defaultSubcommand(command: Command): Command | undefined {
	return command.run
		? undefined
		: command.subcommands?.find((child) => child.name === "list");
}

export function findSubcommand(
	command: Command,
	name: string,
): Command | undefined {
	return command.subcommands?.find(
		(child) => child.name === name || child.aliases?.includes(name),
	);
}
