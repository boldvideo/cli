import { output, table } from "./output";
import { type Command, commandFlags } from "./spec";

export function rootCommand(commands: Command[]): Command {
	return {
		name: "boldvideo",
		summary: "Run your Bold video library.",
		flags: [
			{
				name: "version",
				type: "boolean",
				default: false,
				description: "Print the installed version.",
			},
		],
		examples: [
			{ cmd: "boldvideo --help", note: "Discover available commands." },
			{ cmd: "boldvideo help --json", note: "Read the command tree as JSON." },
		],
		seeAlso: ["boldvideo help exit-codes"],
		subcommands: commands,
	};
}

export function commandTree(command: Command): Command {
	const { run: _run, subcommands, ...data } = command;
	return {
		...data,
		flags: commandFlags(command),
		...(subcommands
			? { subcommands: ordered(subcommands).map(commandTree) }
			: {}),
	};
}

function ordered(commands: Command[]): Command[] {
	const priority = ["import", "ask", "search"];
	const rank = (name: string) =>
		priority.includes(name) ? priority.indexOf(name) : priority.length;
	return [...commands].sort((a, b) => rank(a.name) - rank(b.name));
}

export function showHelp(command: Command, path: string[], json = false): void {
	const root = path.length === 0;
	const invocation = ["boldvideo", ...path].join(" ");
	const args = command.args
		?.map((arg) => (arg.required === false ? `[${arg.name}]` : `<${arg.name}>`))
		.join(" ");
	const synopsis = `${invocation}${command.subcommands ? " <command>" : ""}${args ? ` ${args}` : ""} [flags]`;
	const flags = commandFlags(command).map((flag) => ({
		flag: `--${flag.name}`,
		type: flag.type,
		default: flag.default === undefined ? "—" : JSON.stringify(flag.default),
		description: `${flag.description}${flag.required ? " (required)" : ""}`,
	}));
	const sections = [
		root ? `boldvideo — ${command.summary}` : command.summary,
		`Usage: ${synopsis}`,
	];
	if (command.description) sections.push(command.description);
	if (command.subcommands)
		sections.push(
			`Commands:\n${table(ordered(command.subcommands).map((child) => ({ command: child.name, purpose: child.summary })))}`,
		);
	if (command.args?.length)
		sections.push(
			`Arguments:\n${table(command.args.map((arg) => ({ argument: arg.name, description: arg.description })))}`,
		);
	sections.push(`Flags:\n${table(flags)}`);
	if (root) {
		sections.push("Run boldvideo <command> --help for command details.");
	} else {
		sections.push(
			`Examples:\n${command.examples.map((example) => `  ${example.cmd}\n    ${example.note}`).join("\n")}`,
		);
		sections.push(
			`Related:\n${command.seeAlso.map((related) => `  ${related}`).join("\n") || "  None."}`,
		);
	}
	output(commandTree(command), sections.join("\n\n"), json);
}
