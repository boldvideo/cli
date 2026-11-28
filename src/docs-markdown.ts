import { exitCodes } from "./exit-codes";
import { type Command, defaultSubcommand } from "./spec";

/** Render the serialized command tree returned by `boldvideo help --json`. */
export function commandTreeToMarkdown(tree: Command): string {
	const sections = [
		"# boldvideo CLI reference",
		"## Install",
		"Requires Node.js 22 or newer.\n\n```sh\nnpm install -g boldvideo\n```",
		"## Authentication",
		"Run `boldvideo login` to sign in with your browser; each workspace you approve is saved as a profile, and `-t <slug>` runs one call in another. For servers and CI, set BOLDVIDEO_API_KEY to an admin key from Settings → Developer; it takes precedence over `--profile` and the active stored profile. Help, version, local profile management and `boldvideo docs` need no sign-in.",
		"BOLDVIDEO_API_URL overrides the API base URL (https://app.boldvideo.io/api/v1). `boldvideo docs cli` renders this installed reference offline without making network requests. Other documentation topics require access to BOLDVIDEO_DOCS_URL (https://docs.boldvideo.com by default).",
		"## Commands",
	];
	const cell = (value: string) =>
		value
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll("|", "\\|")
			.replace(/\r?\n/g, "<br>");
	function render(command: Command, path: string[]): void {
		const invocation = [...path, command.name].join(" ");
		const args = (command.args ?? [])
			.map((arg) =>
				arg.required === false ? `[${arg.name}]` : `<${arg.name}>`,
			)
			.join(" ");
		const synopsis = `${invocation}${command.subcommands ? " <command>" : ""}${args ? ` ${args}` : ""} [flags]`;
		sections.push(`### ${invocation}`, command.summary);
		if (command.aliases?.length)
			sections.push(
				`Shorthand: ${command.aliases.map((alias) => `\`${[...path, alias].join(" ")}\``).join(", ")}.`,
			);
		if (defaultSubcommand(command))
			sections.push(
				`Without a command, \`${invocation}\` runs \`${invocation} list\`.`,
			);
		if (command.description) sections.push(command.description);
		sections.push(`\`\`\`sh\n${synopsis}\n\`\`\``);
		if (command.args?.length)
			sections.push(
				"#### Arguments\n\n| Argument | Required | Description |\n| --- | --- | --- |\n" +
					command.args
						.map(
							(arg) =>
								`| ${cell(arg.name)} | ${arg.required === false ? "No" : "Yes"} | ${cell(arg.description)} |`,
						)
						.join("\n"),
			);
		sections.push(
			"#### Flags\n\n| Flag | Type | Default | Description |\n| --- | --- | --- | --- |\n" +
				(command.flags ?? [])
					.map(
						(flag) =>
							`| --${cell(flag.name)}${flag.short ? `, -${flag.short}` : ""} | ${flag.type} | ${cell(flag.default === undefined ? "—" : JSON.stringify(flag.default))} | ${cell(`${flag.description}${flag.required ? " (required)" : ""}`)} |`,
					)
					.join("\n"),
			"#### Examples",
			...command.examples.map(
				(example) => `${example.note}\n\n\`\`\`sh\n${example.cmd}\n\`\`\``,
			),
		);
		for (const child of command.subcommands ?? [])
			render(child, [...path, command.name]);
	}
	render(tree, []);
	sections.push(
		"## Exit codes\n\n| Exit | Meaning |\n| --- | --- |\n" +
			exitCodes
				.map((entry) => `| ${entry.exit_code} | ${entry.meaning} |`)
				.join("\n"),
	);
	return `${sections.join("\n\n")}\n`;
}
