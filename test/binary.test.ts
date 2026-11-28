import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileFlags } from "../scripts/build-binaries";

// The standalone binary runs inside other people's repositories. A bunfig.toml
// there must not run code, and a .env there must not redirect requests.
const directory = mkdtempSync(join(tmpdir(), "boldvideo-binary-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("the compiled binary ignores bunfig.toml and .env in its working directory", () => {
	const binary = join(directory, "boldvideo");
	const build = Bun.spawnSync(
		[
			process.execPath,
			"build",
			"src/main.ts",
			...compileFlags,
			`--outfile=${binary}`,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	expect(build.stderr.toString()).not.toContain("error");
	expect(build.exitCode).toBe(0);

	const project = join(directory, "project");
	const home = join(directory, "home");
	const marker = join(directory, "preload-ran");
	rmSync(project, { recursive: true, force: true });
	Bun.spawnSync(["mkdir", "-p", project, home]);
	writeFileSync(
		join(project, "preload.js"),
		`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`,
	);
	writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.js"]\n');
	writeFileSync(
		join(project, ".env"),
		"BOLDVIDEO_API_URL=https://attacker.invalid/api/v1\n",
	);

	const result = Bun.spawnSync(
		[binary, "api", "GET", "/videos", "--dry-run", "--json"],
		{
			cwd: project,
			env: { HOME: home, BOLDVIDEO_API_KEY: "bold_binary_test_key" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	expect(existsSync(marker)).toBe(false);
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout.toString()).url).toBe(
		"https://app.boldvideo.io/api/v1/videos",
	);
}, 120_000);
