import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "../src/cli";
import { commands } from "../src/commands";
import { complete, completionLines } from "../src/completion";
import { rootCommand } from "../src/help";
import type { Command } from "../src/spec";
import { run as execute } from "./run";

const temporary = mkdtempSync(join(tmpdir(), "boldvideo-completion-"));
const built = resolve("dist/boldvideo.js");
const config = join(temporary, "config");
const bin = join(temporary, "bin");
const work = join(temporary, "work");

beforeAll(() => {
	mkdirSync(join(config, "boldvideo"), { recursive: true });
	writeFileSync(
		join(config, "boldvideo", "profiles.json"),
		JSON.stringify({
			active: "hrtu",
			profiles: {
				hrtu: { key: "bold_test_admin_hrtu", name: "HRT University" },
				viva: { key: "bold_test_admin_viva" },
			},
		}),
	);
	mkdirSync(bin);
	mkdirSync(work);
	writeFileSync(join(work, "members.csv"), "external_id\n");
	// The scripts call back into whatever name was typed, so both must resolve.
	for (const name of ["boldvideo", "bold"]) {
		writeFileSync(join(bin, name), `#!/bin/sh\nexec node '${built}' "$@"\n`);
		chmodSync(join(bin, name), 0o755);
	}
});
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

// Every test below starts several processes; a busy machine needs the room.
const slow = 60_000;
const env = { XDG_CONFIG_HOME: config, APPDATA: config };
const run = (args: string[], extra: Record<string, string> = {}) =>
	execute(["node", built, ...args], { env: { ...env, ...extra } });
const values = (words: string[]) =>
	complete(words, commands).candidates.map((candidate) => candidate.value);

describe("shorthands", () => {
	test("every shorthand runs the command it stands for", () => {
		for (const [short, long] of [
			["v ls", "videos list"],
			["video show paid-workshops", "videos get paid-workshops"],
			[
				"v edit paid-workshops --title x",
				"videos update paid-workshops --title x",
			],
			["v rm paid-workshops", "videos delete paid-workshops"],
			["c new Workshops", "collections create Workshops"],
			["collection mv abc Workshops", "collections rename abc Workshops"],
			["c rm abc def", "collections remove abc def"],
			["vw show ada@example.com", "viewers get ada@example.com"],
			["p switch hrtu", "profiles use hrtu"],
			["profile rm hrtu", "profiles remove hrtu"],
			["i yt https://youtu.be/abc", "import youtube https://youtu.be/abc"],
			["i st run_1", "import status run_1"],
			["ins q", "insights questions"],
			["s pricing", "search pricing"],
			["a pricing", "ask pricing"],
			["me", "whoami"],
		] as const) {
			const expected = parse(long.split(" "));
			const actual = parse(short.split(" "));
			expect(actual.path, short).toEqual(expected.path);
			expect(actual.args, short).toEqual(expected.args);
			expect(actual.flags, short).toEqual(expected.flags);
		}
	});

	test("no shorthand collides with a sibling's name or shorthand", () => {
		function check(command: Command) {
			const taken = (command.subcommands ?? []).flatMap((child) => [
				child.name,
				...(child.aliases ?? []),
			]);
			expect(new Set(taken).size, command.name).toBe(taken.length);
			for (const child of command.subcommands ?? []) check(child);
		}
		check(rootCommand(commands));
	});

	test("a bare group lists, and its list flags need no subcommand", () => {
		for (const group of ["videos", "collections", "viewers", "profiles"])
			expect(parse([group]).path).toEqual([group, "list"]);
		expect(parse(["v"]).path).toEqual(["videos", "list"]);
		const filtered = parse(["v", "--privacy", "private", "-n", "5"]);
		expect(filtered.path).toEqual(["videos", "list"]);
		expect(filtered.flags).toMatchObject({ privacy: "private", limit: 5 });
		// Groups without a list, and any group asked for help, still show help.
		expect(parse(["insights"]).path).toEqual(["insights"]);
		expect(parse(["videos", "--help"]).path).toEqual(["videos"]);
		expect(parse(["v", "-h"]).path).toEqual(["videos"]);
	});

	test("a mistyped subcommand is still an error, not a list", () => {
		expect(() => parse(["videos", "lst"])).toThrow(
			expect.objectContaining({
				code: "unknown_command",
				hint: expect.stringContaining("boldvideo videos list --help"),
			}),
		);
	});

	test("short flags match their long forms", () => {
		expect(parse(["v", "ls", "-n", "3", "-j", "-p", "hrtu"]).flags).toEqual(
			parse(["videos", "list", "--limit", "3", "--json", "--profile", "hrtu"])
				.flags,
		);
		expect(parse(["v", "rm", "abc", "-y"]).flags.yes).toBe(true);
		expect(parse(["-v"]).flags.version).toBe(true);
		expect(parse(["v", "-t", "viva"]).flags.profile).toBe("viva");
	});

	test("help shows shorthands, short flags and the bare-group rule", async () => {
		const help = await execute(["node", built, "v", "--help"], {
			env,
			tty: true,
		});
		expect(help.stdout).toContain("COMMAND     SHORT  PURPOSE");
		expect(help.stdout).toMatch(/\nlist +ls +List a bounded page/);
		expect(help.stdout).toContain(
			"Without a command, boldvideo videos runs boldvideo videos list.",
		);
		expect(help.stdout).toContain("--help, -h");
		const tree = JSON.parse((await run(["help", "--json"])).stdout);
		expect(
			tree.subcommands.find((child: Command) => child.name === "videos")
				.aliases,
		).toEqual(["v", "video"]);
	});
});

describe("completion engine", () => {
	test("offers commands by full name, and shorthands only when nothing else fits", () => {
		const root = values([""]);
		expect(root).toEqual(commands.map((command) => command.name));
		expect(root).not.toContain("v");
		expect(values(["vi"])).toEqual(["videos", "viewers"]);
		expect(values(["me"])).toEqual(["me"]);
		expect(values(["v", ""])).toEqual(
			(parse(["videos", "--help"]).command.subcommands ?? []).map(
				(child) => child.name,
			),
		);
		expect(values(["viewers", "memory", ""])).toEqual(["get", "clear"]);
		expect(values(["nope", ""])).toEqual([]);
	});

	test("offers flags once, including list flags on a bare group", () => {
		expect(values(["v", "--p"])).toEqual(["--profile", "--privacy", "--page"]);
		expect(values(["v", "--privacy", "private", "--p"])).toEqual([
			"--profile",
			"--page",
		]);
		expect(values(["videos", "list", "-n", "5", "--li"])).toEqual([]);
		// Repeatable flags stay on offer.
		expect(values(["api", "GET", "/videos", "-q", "a=b", "--qu"])).toEqual([
			"--query",
		]);
		expect(complete(["v", "--pri"], commands).candidates[0]?.description).toBe(
			"Filter by video privacy.",
		);
	});

	test("offers known values for flags and arguments", () => {
		const privacy = ["public", "unlisted", "private"];
		expect(values(["v", "--privacy", ""])).toEqual(privacy);
		expect(values(["v", "--privacy=pu"])).toEqual(["--privacy=public"]);
		expect(values(["videos", "update", "abc", "--privacy", "u"])).toEqual([
			"unlisted",
		]);
		expect(values(["i", "yt", "--order", ""])).toEqual(["latest", "oldest"]);
		expect(values(["videos", "transcript", "abc", "--format", ""])).toEqual([
			"txt",
			"srt",
			"vtt",
			"json",
		]);
		expect(values(["completion", ""])).toEqual(["bash", "zsh", "fish"]);
		expect(values(["api", "P"])).toEqual(["POST", "PUT", "PATCH"]);
		// A flag that takes free text offers nothing rather than something wrong.
		expect(complete(["v", "--tag", ""], commands)).toEqual({
			candidates: [],
			files: false,
		});
		expect(values(["v", "ls", "--", "--pri"])).toEqual([]);
		// A value-taking short flag ends its cluster, wherever it sits in it.
		expect(values(["i", "yt", "-jn", "5", "--order", ""])).toEqual([
			"latest",
			"oldest",
		]);
		expect(values(["v", "-n5", "--privacy", "u"])).toEqual(["unlisted"]);
	});

	test("hands file arguments to the shell", () => {
		for (const words of [
			["viewers", "sync", ""],
			["videos", "transcript", "abc", "--out", ""],
			["import", "url", "--from", ""],
			["api", "POST", "/videos", "--input", ""],
			["import", "url", "--from=mem"],
			// After -- the word is still the file argument.
			["viewers", "sync", "--", "mem"],
		])
			expect(complete(words, commands), words.join(" ")).toEqual({
				candidates: [],
				files: true,
			});
	});

	test("bash's split words are rejoined and answered without the prefix", () => {
		expect(
			completionLines("bash", ["v", "--privacy", "=", "pu"], commands),
		).toEqual(["public"]);
		expect(completionLines("bash", ["v", "--privacy", "="], commands)).toEqual([
			"public",
			"unlisted",
			"private",
		]);
		// A URL is one argument, however bash split it.
		expect(
			completionLines(
				"bash",
				["i", "url", "https", ":", "//cdn.example.com/a.mp4", "--ord"],
				commands,
			),
		).toEqual(["--order"]);
		expect(completionLines("zsh", ["v", "--pri"], commands)).toEqual([
			"--privacy\tFilter by video privacy.",
		]);
	});
});

describe("the built CLI", () => {
	test(
		"completes saved workspaces from the profile file, without a key",
		async () => {
			for (const words of [
				["-t", ""],
				["v", "--profile", ""],
				["v", "-jp", ""],
				["profiles", "use", ""],
				["p", "rm", ""],
			]) {
				const result = await run(["__complete", "fish", "--", ...words]);
				expect(result.status).toBe(0);
				expect(result.stderr).toBe("");
				expect(result.stdout).toBe("hrtu\tHRT University\nviva\n");
			}
			expect((await run(["__complete", "fish", "--", "-t", "v"])).stdout).toBe(
				"viva\n",
			);
			// Completion never prints a stored key.
			expect(
				(await run(["__complete", "zsh", "--", "-t", ""])).stdout,
			).not.toContain("bold_test_admin");
		},
		slow,
	);

	test(
		"the completion hook stays silent on anything it does not understand",
		async () => {
			for (const args of [
				["__complete"],
				["__complete", "tcsh", "--", ""],
				["__complete", "zsh"],
				["__complete", "zsh", "--"],
				["__complete", "zsh", "--", "nope", ""],
			]) {
				const result = await run(args, { XDG_CONFIG_HOME: "/dev/null/nope" });
				expect(result, args.join(" ")).toEqual({
					status: 0,
					stdout: "",
					stderr: "",
				});
			}
			const tree = (await run(["help", "--json"])).stdout;
			expect(tree).not.toContain("__complete");
		},
		slow,
	);

	test(
		"prints a script per shell, guesses from $SHELL, and refuses the rest",
		async () => {
			for (const shell of ["bash", "zsh", "fish"]) {
				const script = (await run(["completion", shell])).stdout;
				expect(script).toContain(`__complete ${shell} --`);
				expect(script).toMatch(/\bboldvideo\b[\s\S]*\bbold\b/);
				expect(
					JSON.parse((await run(["completion", shell, "--json"])).stdout),
				).toEqual({ shell, script: `${script.trimEnd()}\n` });
			}
			expect(
				(await run(["completion"], { SHELL: "/opt/homebrew/bin/fish" })).stdout,
			).toContain("__complete fish --");
			for (const [args, shell] of [
				[["completion", "powershell"], "/bin/zsh"],
				[["completion"], "/bin/tcsh"],
			] as const) {
				const result = await run([...args], { SHELL: shell });
				expect(result.status).toBe(2);
				expect(JSON.parse(result.stderr).code).toBe("usage_error");
			}
		},
		slow,
	);
});

function shell(name: string, script: string) {
	return spawnSync(
		name,
		name === "zsh" ? ["-f", "-c", script] : ["-c", script],
		{
			cwd: work,
			encoding: "utf8",
			env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` },
		},
	);
}
const has = (name: string) => spawnSync(name, ["-c", "exit 0"]).status === 0;

describe("in a real shell", () => {
	test.skipIf(!has("bash"))(
		"bash completes both names",
		() => {
			const result = shell(
				"bash",
				`eval "$(boldvideo completion bash)"
			t() { COMP_WORDS=("$@"); COMP_CWORD=$((\${#COMP_WORDS[@]} - 1)); _boldvideo; (IFS=,; echo "\${COMPREPLY[*]}"); }
			t bold c ""
			t boldvideo v --privacy = pu
			t bold v --privacy =
			t bold vw sync mem
			t bold -t ""
			complete -p bold boldvideo`,
			);
			expect(result.stderr).toBe("");
			expect(result.stdout.trim().split("\n")).toEqual([
				"list,create,rename,add,remove,videos",
				"public",
				"public,unlisted,private",
				"members.csv",
				"hrtu,viva",
				"complete -F _boldvideo bold",
				"complete -F _boldvideo boldvideo",
			]);
		},
		slow,
	);

	test.skipIf(!has("zsh"))(
		"zsh registers both names and describes each match",
		() => {
			const registered = shell(
				"zsh",
				`autoload -Uz compinit && compinit -u -d '${join(temporary, "zcompdump")}'
			eval "$(boldvideo completion zsh)"
			print $_comps[bold] $_comps[boldvideo]`,
			);
			expect(registered.stderr).toBe("");
			expect(registered.stdout).toBe("_boldvideo _boldvideo\n");
			const result = shell(
				"zsh",
				`compdef() { :; }
			_describe() { print -r -- "\${(j:|:)\${(@P)2}}"; }
			_files() { print files; }
			eval "$(boldvideo completion zsh)"
			t() { words=("$@"); CURRENT=$#words; _boldvideo; }
			t bold viewers memory ""
			t boldvideo v --privacy=pu
			t bold -t ""
			t bold vw sync ""
			t bold v --tag ""
			PREFIX=--from=mem; compset() { print "compset $*"; }
			t bold import url --from=mem`,
			);
			expect(result.stderr).toBe("");
			expect(result.stdout.trim().split("\n")).toEqual([
				"get:Read memory or toggle future memory distillation.|clear:Delete a viewer's memory content.",
				"--privacy=public",
				"hrtu:HRT University|viva",
				"files",
				"compset -P *=",
				"files",
			]);
		},
		slow,
	);
});
