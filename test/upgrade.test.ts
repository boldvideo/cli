import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { version } from "../package.json";

const temporary = realpathSync(
	mkdtempSync(join(tmpdir(), "boldvideo-upgrade-test-")),
);
const built = resolve("dist/boldvideo.js");
const binary = join(temporary, "boldvideo");
const preload = join(temporary, "registry.mjs");
const sourceCommand = `cd '${process.cwd()}' && git pull --ff-only && bun install --frozen-lockfile && bun run build`;

beforeAll(() => {
	const result = spawnSync(
		process.execPath,
		["build", "src/main.ts", "--compile", `--outfile=${binary}`],
		{ encoding: "utf8" },
	);
	expect(result.status, result.stderr).toBe(0);
	writeFileSync(
		preload,
		`import { readFileSync } from 'node:fs';
globalThis.fetch = async (_url, { signal }) => {
  switch (process.env.REGISTRY_CASE) {
    case 'forbidden': process.exit(99);
    case 'offline': throw new Error('Offline');
    case 'http': return new Response('', { status: 503 });
    case 'invalid': return new Response('not json');
    case 'timeout':
      await new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Unbounded request')), 10000);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); });
      });
  }
  return new Response(readFileSync(${JSON.stringify(resolve("test/fixtures/npm-latest.json"))}, 'utf8'));
};
`,
	);
});
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

function run(
	entry: string,
	args = ["upgrade", "--no-check"],
	env: Record<string, string> = {},
) {
	return spawnSync("node", [entry, ...args], {
		encoding: "utf8",
		timeout: 5000,
		env: {
			...process.env,
			NO_COLOR: "1",
			NODE_OPTIONS: `--import=${preload}`,
			npm_command: "",
			BOLDVIDEO_API_KEY: "",
			REGISTRY_CASE: "forbidden",
			...env,
		},
	});
}

test.each([
	[
		"global/lib/node_modules/boldvideo/dist/boldvideo.js",
		"",
		"npm",
		"npm install --global boldvideo@latest",
	],
	[
		"cache/_npx/42/node_modules/boldvideo/dist/boldvideo.js",
		"",
		"npx",
		"npx --yes boldvideo@latest",
	],
	[
		"project/node_modules/boldvideo/dist/boldvideo.js",
		"exec",
		"npx",
		"npx --yes boldvideo@latest",
	],
])(
	"upgrade detects %s without contacting the registry",
	(relative, npmCommand, channel, command) => {
		const entry = join(temporary, relative ?? "");
		mkdirSync(dirname(entry), { recursive: true });
		copyFileSync(built, entry);
		writeFileSync(join(dirname(entry), "package.json"), '{"type":"module"}');
		const link = `${entry}.link`;
		symlinkSync(entry, link);
		const result = run(link, undefined, { npm_command: npmCommand ?? "" });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({
			channel,
			current_version: version,
			upgrade_command: command,
		});
	},
);

test("upgrade recognizes a source checkout even with inherited npm environment", () => {
	const result = run(built, undefined, { npm_command: "exec" });
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({
		channel: "source",
		current_version: version,
		upgrade_command: sourceCommand,
	});
});

test("standalone upgrade follows Homebrew symlinks and preserves custom script directories", () => {
	const brew = join(temporary, "brew/Cellar/boldvideo/0.1.0/bin/boldvideo");
	const scriptDirectory = join(temporary, "Marcel's bin");
	const script = join(scriptDirectory, "boldvideo");
	mkdirSync(dirname(brew), { recursive: true });
	mkdirSync(scriptDirectory);
	copyFileSync(binary, brew);
	copyFileSync(binary, script);
	const link = join(temporary, "brew/boldvideo");
	symlinkSync(brew, link);
	const before = createHash("sha256")
		.update(readFileSync(binary))
		.digest("hex");
	const checkout = join(temporary, "checkout");
	const checkoutBinary = join(checkout, "dist/bin/boldvideo-linux-x64");
	mkdirSync(join(checkout, "src"), { recursive: true });
	mkdirSync(dirname(checkoutBinary), { recursive: true });
	writeFileSync(join(checkout, "src/main.ts"), "");
	writeFileSync(join(checkout, "package.json"), '{"name":"boldvideo"}');
	copyFileSync(binary, checkoutBinary);
	for (const [executable, channel, command] of [
		[link, "homebrew", "brew upgrade boldvideo/tap/boldvideo"],
		[
			script,
			"script",
			`curl -fsSL https://boldvideo.com/install.sh | BOLDVIDEO_INSTALL_DIR='${temporary}/Marcel'\\''s bin' sh`,
		],
		[
			checkoutBinary,
			"source",
			`cd '${checkout}' && git pull --ff-only && bun install --frozen-lockfile && bun run build:binaries`,
		],
	] as const) {
		const result = spawnSync(executable, ["upgrade", "--no-check"], {
			encoding: "utf8",
			env: {
				...process.env,
				npm_command: "exec",
				BOLDVIDEO_INSTALL_DIR: "/wrong-directory",
				BOLDVIDEO_API_KEY: "",
			},
		});
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			channel,
			current_version: version,
			upgrade_command: command,
		});
		expect(
			createHash("sha256").update(readFileSync(executable)).digest("hex"),
		).toBe(before);
	}
});

test("standalone and Node builds embed identical version output", () => {
	const node = run(built, ["--version"]);
	const standalone = spawnSync(binary, ["--version"], {
		encoding: "utf8",
		env: { PATH: "/nonexistent" },
	});
	expect(node.status).toBe(0);
	expect(standalone.status, standalone.stderr).toBe(0);
	expect(JSON.parse(standalone.stdout)).toEqual({ version });
	expect(standalone.stdout).toBe(node.stdout);
	expect(standalone.stderr).toBe("");
});

test.each(["offline", "http", "invalid", "timeout"])(
	"registry %s does not prevent upgrade advice",
	(mode) => {
		const result = run(built, ["upgrade"], { REGISTRY_CASE: mode });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({
			channel: "source",
			current_version: version,
			upgrade_command: sourceCommand,
		});
	},
);

test("terminal upgrade reports the latest version and JSON mode keeps the three-field contract", () => {
	const args = ["node", built, "upgrade"];
	const terminal = spawnSync(
		"script",
		process.platform === "darwin"
			? ["-q", "/dev/null", ...args]
			: [
					"-qefc",
					args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" "),
					"/dev/null",
				],
		{
			encoding: "utf8",
			input: "",
			env: {
				...process.env,
				NO_COLOR: "1",
				NODE_OPTIONS: `--import=${preload}`,
				REGISTRY_CASE: "success",
				BOLDVIDEO_API_KEY: "",
			},
		},
	);
	expect(terminal.status, terminal.stderr).toBe(0);
	expect(terminal.stdout).toContain("Latest npm version: 9.8.7");
	expect(terminal.stdout).toContain(`Upgrade command: ${sourceCommand}`);
	const json = run(built, ["upgrade", "--json"], { REGISTRY_CASE: "success" });
	expect(json.status).toBe(0);
	expect(json.stderr).toBe("");
	expect(JSON.parse(json.stdout)).toEqual({
		channel: "source",
		current_version: version,
		upgrade_command: sourceCommand,
	});
});
