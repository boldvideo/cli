import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { version } from "../package.json";
import { identity, loadProfiles, resolveKey } from "./auth";
import { commands } from "./commands";
import { error, registerSecret } from "./errors";
import { rootCommand, showHelp } from "./help";
import { output } from "./output";
import { type Command, commandFlags, type Flags } from "./spec";

function options(command: Command): ParseArgsOptionsConfig {
	return Object.fromEntries(
		commandFlags(command).map((flag) => [
			flag.name,
			{
				type: flag.type === "boolean" ? "boolean" : "string",
				...(flag.short ? { short: flag.short } : {}),
				multiple: flag.type === "list",
			},
		]),
	);
}

function distance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(
				(row[j - 1] ?? 0) + 1,
				(previous[j] ?? 0) + 1,
				(previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		}
		previous = row;
	}
	return previous[b.length] ?? 0;
}

// Parsing is separate from execution so every documented example can be checked without writes.
export function parse(argv: string[], registry = commands) {
	let command = rootCommand(registry);
	const path: string[] = [];
	const remaining = [...argv];
	const usage = (message: string) =>
		error(
			"usage_error",
			message,
			`${["boldvideo", ...path].join(" ")} --help`,
			2,
		);
	try {
		while (command.subcommands) {
			const scan = parseArgs({
				args: remaining,
				options: options(command),
				strict: false,
				allowPositionals: true,
				tokens: true,
			});
			const token = scan.tokens.find((token) => token.kind === "positional");
			if (token?.kind !== "positional") break;
			const child = command.subcommands.find(
				(child) => child.name === token.value,
			);
			if (!child) {
				const nearest = [...command.subcommands].sort(
					(a, b) =>
						distance(token.value, a.name) - distance(token.value, b.name),
				)[0];
				throw error(
					"unknown_command",
					`Unknown command '${token.value}'.`,
					nearest && distance(token.value, nearest.name) <= 2
						? `boldvideo ${[...path, nearest.name].join(" ")} --help`
						: "boldvideo --help",
					2,
				);
			}
			path.push(child.name);
			command = child;
			remaining.splice(token.index, 1);
		}
		const parsed = parseArgs({
			args: remaining,
			options: options(command),
			allowPositionals: true,
			strict: true,
		});
		const flags: Flags = {};
		for (const flag of commandFlags(command)) {
			const value = parsed.values[flag.name];
			if (value === undefined) {
				if (flag.default !== undefined) flags[flag.name] = flag.default;
				if (flag.required && !parsed.values.help)
					throw usage(`Missing required flag --${flag.name}.`);
			} else if (flag.type === "number") {
				if (
					typeof value !== "string" ||
					!value.trim() ||
					!Number.isFinite(Number(value))
				)
					throw usage(`--${flag.name} must be a number.`);
				flags[flag.name] = Number(value);
			} else if (flag.type === "list") {
				flags[flag.name] = flag.verbatim
					? (value as string[])
					: (value as string[])
							.flatMap((item) => item.split(","))
							.map((item) => item.trim())
							.filter(Boolean);
			} else flags[flag.name] = value as string | boolean;
		}
		if (
			command.list &&
			(!Number.isSafeInteger(flags.limit) || Number(flags.limit) < 1)
		)
			throw usage("--limit must be a positive integer.");
		if (!flags.help) {
			const args = command.args ?? [];
			if (!args.at(-1)?.variadic && parsed.positionals.length > args.length)
				throw usage("Too many arguments.");
			for (const [index, arg] of args.entries()) {
				if (arg.required !== false && parsed.positionals[index] === undefined)
					throw usage(`Missing argument <${arg.name}>.`);
			}
		}
		return { command, path, args: parsed.positionals, flags };
	} catch (cause) {
		if (cause instanceof TypeError) throw usage(cause.message);
		throw cause;
	}
}

export async function cli(argv: string[], registry = commands): Promise<void> {
	// Redact credentials even when parsing fails or help echoes an example.
	for (const [index, arg] of argv.entries()) {
		if (arg === "--") break;
		if (arg === "--token") registerSecret(argv[index + 1] ?? "");
		if (arg.startsWith("--token=")) registerSecret(arg.slice(8));
	}
	try {
		loadProfiles();
	} catch {
		// Help and environment authentication must work with an unreadable file.
		// Commands that need profiles report the error when they load it.
	}
	const { command, path, args, flags } = parse(argv, registry);
	if (path.length === 0 && flags.version) {
		output({ version }, version, flags.json === true);
		return;
	}
	if (flags.help || !command.run) {
		showHelp(command, path, flags.json === true);
		return;
	}
	if (
		(command.destructive ||
			command.flags?.some((flag) => flag.destructive && flags[flag.name])) &&
		!flags.yes &&
		!process.stdin.isTTY
	) {
		throw error(
			"confirmation_required",
			"Destructive commands require --yes when stdin is not a terminal.",
			`boldvideo --yes ${argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ")}`,
			2,
		);
	}
	const credential =
		command.auth === "none"
			? undefined
			: resolveKey(flags.profile as string | undefined);
	if (
		command.auth === "admin" &&
		credential &&
		(await identity(credential.key)).key.kind !== "admin"
	)
		throw error(
			"not_permitted",
			"This command requires an admin key.",
			"An admin key is required. Set BOLDVIDEO_API_KEY to an admin key or run boldvideo login --token <admin-key>.",
			3,
		);
	await command.run(
		{
			json: flags.json === true || !process.stdout.isTTY,
			debug: flags.debug === true,
			commands: registry,
			path,
			credential,
		},
		args,
		flags,
	);
}
