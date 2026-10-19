import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "../src/cli";
import { commands } from "../src/commands";
import { commandTree, rootCommand } from "../src/help";
import { type Command, commandFlags } from "../src/spec";
import { fixture } from "./commands";

const temporary = mkdtempSync(join(tmpdir(), "boldvideo-test-"));
const built = resolve("dist/boldvideo.js");
const runner = join(temporary, "runner.mjs");
const registry = [...commands, fixture];
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

beforeAll(async () => {
	const result = await Bun.build({
		entrypoints: [resolve("test/runner.ts")],
		target: "node",
	});
	expect(result.success).toBe(true);
	const artifact = result.outputs[0];
	if (!artifact) throw new Error("Missing test bundle");
	await Bun.write(runner, artifact);
});
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

function run(
	args: string[],
	options: {
		fixture?: boolean;
		tty?: boolean;
		env?: Record<string, string>;
	} = {},
) {
	const argv = ["node", options.fixture ? runner : built, ...args];
	const env = {
		...process.env,
		NO_COLOR: "1",
		FORCE_COLOR: undefined,
		BOLDVIDEO_API_KEY: "",
		...options.env,
	};
	const result = options.tty
		? spawnSync(
				"script",
				process.platform === "darwin"
					? ["-q", "/dev/null", ...argv]
					: ["-qefc", argv.map(quote).join(" "), "/dev/null"],
				{
					encoding: "utf8",
					env,
					input: "",
				},
			)
		: spawnSync(argv[0] ?? "node", argv.slice(1), {
				encoding: "utf8",
				env,
				input: "",
			});
	if (result.error) throw result.error;
	let stdout = result.stdout.replaceAll("\r\n", "\n");
	if (options.tty && process.platform === "darwin") {
		// BSD script echoes EOF, sometimes followed by two erasing backspaces.
		if (stdout.startsWith("^D"))
			stdout = stdout.slice(stdout.startsWith("^D\b\b") ? 4 : 2);
	}
	return {
		status: result.status,
		stdout,
		stderr: result.stderr,
	};
}

// A shell-word tokenizer, not a shell: examples are parsed, never executed.
function words(example: string): string[] {
	const result: string[] = [];
	let word = "";
	let quote = "";
	let started = false;
	for (let i = 0; i < example.length; i++) {
		const char = example[i] ?? "";
		if (char === "\\" && quote !== "'") {
			const next = example[++i];
			if (next === undefined) throw new Error("Trailing escape in example");
			word += next;
			started = true;
		} else if (quote) {
			if (char === quote) quote = "";
			else word += char;
		} else if (char === "'" || char === '"') {
			quote = char;
			started = true;
		} else if (/\s/.test(char)) {
			if (started) result.push(word);
			word = "";
			started = false;
		} else {
			word += char;
			started = true;
		}
	}
	if (quote) throw new Error("Unclosed quote in example");
	if (started) result.push(word);
	expect(result.shift()).toBe("boldvideo");
	return result;
}

function contracts(command: Command, path: string[], testOnly = false) {
	describe(["boldvideo", ...path].join(" "), () => {
		test("has complete metadata, shared flags and parseable examples", () => {
			expect(command.summary.trim()).not.toBe("");
			expect(command.summary).not.toMatch(/[\r\n]/);
			expect(Boolean(command.run || command.subcommands?.length)).toBe(true);
			const flags = commandFlags(command);
			expect(new Set(flags.map((flag) => flag.name)).size).toBe(flags.length);
			for (const flag of flags) expect(flag.description.trim()).not.toBe("");
			for (const arg of command.args ?? [])
				expect(arg.description.trim()).not.toBe("");
			expect(flags.map((flag) => flag.name)).toContain("json");
			if (command.list) {
				expect(flags.find((flag) => flag.name === "limit")?.default).toBe(20);
				expect(flags.map((flag) => flag.name)).toContain("fields");
			}
			if (command.write || command.destructive) {
				expect(flags.map((flag) => flag.name)).toEqual(
					expect.arrayContaining(["dry-run", "yes"]),
				);
			}
			expect(command.examples).toHaveLength(2);
			for (const example of command.examples) {
				expect(example.note.trim()).not.toBe("");
				expect(example.cmd).not.toMatch(/\bfoo\b|<[^>]+>/);
				expect(() => parse(words(example.cmd), registry)).not.toThrow();
			}
			for (const related of command.seeAlso)
				expect(() => parse(words(related), registry)).not.toThrow();
		});
		test("exposes the same complete metadata in built --help JSON", () => {
			const result = run([...path, "--help", "--json"], { fixture: testOnly });
			expect(result.status).toBe(0);
			expect(result.stderr).toBe("");
			const data = JSON.parse(result.stdout);
			expect(data).toMatchObject({
				name: command.name,
				summary: command.summary,
				examples: command.examples,
				seeAlso: command.seeAlso,
			});
			for (const flag of commandFlags(command))
				expect(data.flags).toContainEqual(flag);
			for (const child of command.subcommands ?? [])
				expect(data.subcommands).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							name: child.name,
							summary: child.summary,
						}),
					]),
				);
			const text = run([...path, "--help"], { fixture: testOnly, tty: true });
			expect(text.status).toBe(0);
			expect(text.stdout).toContain(command.summary);
			for (const flag of commandFlags(command)) {
				expect(text.stdout).toContain(`--${flag.name}`);
				expect(text.stdout).toContain(flag.description);
			}
			if (path.length)
				for (const example of command.examples)
					expect(text.stdout).toContain(example.cmd);
		});
		for (const child of command.subcommands ?? [])
			contracts(
				child,
				[...path, child.name],
				testOnly || child.name === "fixture",
			);
	});
}
contracts(rootCommand(commands), []);
contracts(fixture, ["fixture"], true);

test("no args and --help agree; the published tree excludes test commands", () => {
	const help = run(["--help"]);
	expect(run([])).toEqual(help);
	expect(run(["help", "--json"])).toEqual(help);
	const names = JSON.parse(help.stdout).subcommands.map(
		(command: Command) => command.name,
	);
	expect(names).toHaveLength(commands.length);
	expect(names).toEqual(
		expect.arrayContaining(commands.map((command) => command.name)),
	);
	expect(names).not.toContain("fixture");
	expect(JSON.parse(run(["--version"]).stdout)).toEqual({ version: "0.1.0" });
	expect(readFileSync(built, "utf8")).toStartWith("#!/usr/bin/env node\n");
});

test("unknown commands suggest close matches and fall back to top-level help", () => {
	for (const [args, hint] of [
		[["hlep"], "boldvideo help --help"],
		[["xyzp"], "boldvideo --help"],
		[["help", "exit-code"], "boldvideo help exit-codes --help"],
		[["help", "unrelated"], "boldvideo --help"],
	] as const) {
		const result = run([...args]);
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "unknown_command",
			hint,
			docs: "https://docs.boldvideo.com/cli#unknown-command",
		});
		expect(result.stderr.trim().split("\n")).toHaveLength(1);
	}
	const result = run(["fixture", "ech"], { fixture: true });
	expect(result.status).toBe(2);
	expect(JSON.parse(result.stderr).hint).toBe("boldvideo fixture echo --help");
});

test("parseArgs failures use the usage error contract", () => {
	for (const args of [
		["--bogus"],
		["--version=yes"],
		["help", "exit-codes", "extra"],
	]) {
		const result = run(args);
		expect(result.status).toBe(2);
		expect(JSON.parse(result.stderr).code).toBe("usage_error");
	}
});

test("typed flags, quoted positionals, defaults, global flags and -- survive parsing", () => {
	const parsed = parse(
		words(fixture.subcommands?.[2]?.examples[0].cmd ?? ""),
		registry,
	);
	expect(parsed.args).toEqual(["Paid workshops"]);
	expect(parsed.flags).toMatchObject({
		rating: -3.5,
		tags: ["sales", "coaching", "pricing"],
	});
	const result = run(
		["--json", "fixture", "echo", "--", "--private-workshop"],
		{ fixture: true },
	);
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({
		title: "--private-workshop",
		rating: 2.5,
	});
	for (const args of [
		["fixture", "echo"],
		["fixture", "delete", "paid-workshops"],
		["fixture", "echo", "Title", "--rating", "NaN"],
	])
		expect(() => parse(args, registry)).toThrow();
});

test("list pages are bounded, project fields and provide an executable next command", () => {
	const first = run(["fixture", "list"], { fixture: true });
	const page = JSON.parse(first.stdout);
	expect(first.stderr).toBe("");
	expect(page.items).toHaveLength(20);
	expect(page).toMatchObject({
		has_more: true,
		next: "boldvideo fixture list --offset 20 --limit 20",
	});
	const last = JSON.parse(run(words(page.next), { fixture: true }).stdout);
	expect(last.items.map((item: { id: string }) => item.id)).toEqual([
		"workshop-recording-21",
		"workshop-recording-22",
		"workshop-recording-23",
	]);
	expect(last).toMatchObject({ has_more: false });
	expect(last.next).toBeUndefined();
	const projected = JSON.parse(
		run(
			[
				"fixture",
				"list",
				"--limit",
				"2",
				"--fields",
				"id",
				"--fields",
				"published_at",
			],
			{ fixture: true },
		).stdout,
	);
	expect(projected.items).toEqual([
		{ id: "workshop-recording-1", published_at: "2026-10-19" },
		{ id: "workshop-recording-2", published_at: "2026-10-19" },
	]);
	expect(
		JSON.parse(run(words(projected.next), { fixture: true }).stdout).items[0],
	).toEqual({ id: "workshop-recording-3", published_at: "2026-10-19" });
	for (const limit of ["0", "-1", "1.5", "Infinity", "", "9007199254740992"])
		expect(() =>
			parse(["fixture", "list", `--limit=${limit}`], registry),
		).toThrow();
	expect(
		run(["fixture", "list", "--offset", "23"], { fixture: true, tty: true })
			.stdout,
	).toBe("No results.\n");
});

test("destructive calls require --yes before any effect, and dry-run makes no write", () => {
	const destination = join(temporary, "deleted-video");
	const options = { fixture: true, env: { BOLDVIDEO_TEST_WRITE: destination } };
	const args = [
		"fixture",
		"delete",
		"--reason",
		"Director's duplicate recording",
		"--",
		"paid-workshops",
	];
	const refused = run(args, options);
	expect(refused.status).toBe(2);
	expect(refused.stdout).toBe("");
	expect(existsSync(destination)).toBe(false);
	const refusal = JSON.parse(refused.stderr);
	expect(refusal.code).toBe("confirmation_required");
	expect(run(["--dry-run", "--yes", ...args], options).status).toBe(0);
	expect(existsSync(destination)).toBe(false);
	expect(run(words(refusal.hint), options).status).toBe(0);
	expect(readFileSync(destination, "utf8")).toBe("paid-workshops");
});

test("API errors preserve request IDs and map to stable exits", () => {
	for (const [status, code, exit] of [
		[401, "not_authenticated", 3],
		[403, "not_permitted", 3],
		[404, "not_found", 4],
		[408, "timed_out", 5],
		[504, "timed_out", 5],
		[500, "api_error", 1],
	] as const) {
		const result = run(["fixture", "fail", "--status", String(status)], {
			fixture: true,
		});
		expect(result.status).toBe(exit);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toEqual({
			code,
			message: "You cannot delete this video. Ask an administrator for access.",
			hint: "boldvideo --help",
			docs: `https://docs.boldvideo.com/cli#${code.replaceAll("_", "-")}`,
			request_id: "req_8d7b9e2a",
		});
	}
	expect(
		JSON.parse(
			run(["fixture", "fail", "--request-id", "req_header_42"], {
				fixture: true,
			}).stderr,
		).request_id,
	).toBe("req_header_42");
});

test("API keys are redacted from failures, success and debug hints", () => {
	for (const key of ["bold_test_secret_2026", 'bold_test_"quoted"\\key']) {
		for (const args of [
			[key, "--debug"],
			["fixture", "fail", "--internal", "--debug"],
			["fixture", "echo", key, "--debug"],
		]) {
			const result = run(args, {
				fixture: true,
				env: { BOLDVIDEO_API_KEY: key },
			});
			expect(result.stdout + result.stderr).not.toContain(key);
			expect(result.stdout + result.stderr).not.toContain(
				JSON.stringify(key).slice(1, -1),
			);
			expect(result.stdout + result.stderr).toContain("[REDACTED]");
		}
	}
});

test("terminal help is compact, group help lists direct children, and JSON can be forced", () => {
	const help = run(["--help"], { tty: true });
	expect(help.status).toBe(0);
	expect(run([], { tty: true })).toEqual(help);
	expect(help.stdout.trim().split("\n").length).toBeLessThanOrEqual(40);
	expect(help.stdout).toContain("Run boldvideo <command> --help");
	expect(help.stdout).not.toContain("\u001b[");
	expect(run(["--version"], { tty: true }).stdout).toBe("0.1.0\n");
	expect(JSON.parse(run(["--help", "--json"], { tty: true }).stdout).name).toBe(
		"boldvideo",
	);
	const group = run(["help", "--help"], { tty: true }).stdout;
	expect(group).toContain("exit-codes  Explain process exit codes.");
	expect(group).toContain("Examples:");
	expect(group).toContain("Related:");
	const exits = run(["help", "exit-codes"], { tty: true }).stdout;
	expect(exits).toContain("EXIT_CODE  MEANING");
	expect(exits).toContain("5          Timed out while waiting");
	expect(
		JSON.parse(run(["help", "exit-codes"]).stdout).map(
			(row: { exit_code: number }) => row.exit_code,
		),
	).toEqual([0, 1, 2, 3, 4, 5]);
});

test("terminal tables keep full IDs; hints and meaningful colors respect NO_COLOR", () => {
	const args = ["fixture", "list", "--limit", "1", "--fields", "id,title"];
	const plain = run(args, { fixture: true, tty: true }).stdout;
	expect(plain).toContain(
		"ID                    TITLE\nworkshop-recording-1  Paid workshops 1",
	);
	expect(plain).toContain(
		"More results: boldvideo fixture list --offset 1 --limit 1 --fields id,title",
	);
	expect(plain).not.toContain("\u001b[");
	const colored = run(args, {
		fixture: true,
		tty: true,
		env: { NO_COLOR: "" },
	}).stdout;
	expect(colored).toContain("\u001b[1m");
	expect(colored).toContain("\u001b[2m");
	const failure = run(["hlep"], { tty: true, env: { NO_COLOR: "" } }).stdout;
	expect(failure).toContain("\u001b[31munknown_command");
	expect(failure).toContain("\u001b[36mHint: boldvideo help --help");
	expect(run(["hlep"], { tty: true }).stdout).toBe(
		"unknown_command: Unknown command 'hlep'.\nHint: boldvideo help --help\nDocs: https://docs.boldvideo.com/cli#unknown-command\n",
	);
	const key = "bold_test_terminal_secret";
	const debug = run(["fixture", "echo", key, "--debug"], {
		fixture: true,
		tty: true,
		env: { BOLDVIDEO_API_KEY: key },
	}).stdout;
	expect(debug).not.toContain(key);
	expect(debug).toContain("Debug title: [REDACTED]");
});

test("future import, ask and search entries sort first without mutating registration order", () => {
	const children = ["videos", "search", "collections", "ask", "import"].map(
		(name) => ({ ...fixture, name }),
	);
	const tree = commandTree(rootCommand(children)) as { subcommands: Command[] };
	expect(tree.subcommands.map((command) => command.name)).toEqual([
		"import",
		"ask",
		"search",
		"videos",
		"collections",
	]);
	expect(children.map((command) => command.name)).toEqual([
		"videos",
		"search",
		"collections",
		"ask",
		"import",
	]);
});
