import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { version } from "../../package.json";
import { hint, output } from "../output";
import type { Command } from "../spec";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export const upgrade: Command = {
	name: "upgrade",
	summary: "Show how to upgrade this installation without changing it.",
	auth: "none",
	description:
		"Detect the install channel and print its upgrade command; never replace the running executable. Check npm for the latest version unless --no-check is passed. Check failures are ignored.",
	flags: [
		{
			name: "no-check",
			type: "boolean",
			default: false,
			description: "Skip the optional npm version check (3 second timeout).",
		},
	],
	examples: [
		{
			cmd: "boldvideo upgrade",
			note: "Find the upgrade command for this install.",
		},
		{
			cmd: "boldvideo upgrade --no-check --json",
			note: "Read upgrade instructions offline as JSON.",
		},
	],
	seeAlso: ["boldvideo --version", "boldvideo --help"],
	async run(ctx, _args, flags) {
		const entry = process.argv[1] ?? process.execPath;
		// Compiled Bun argv points into its embedded filesystem, not the installed file.
		const compiled = entry.startsWith("/$bunfs/");
		const executable = realpathSync(compiled ? process.execPath : entry);
		const path = executable.replaceAll("\\", "/");
		let channel = "script";
		let upgradeCommand = `curl -fsSL https://boldvideo.com/install.sh | BOLDVIDEO_INSTALL_DIR=${quote(dirname(executable))} sh`;
		if (/\/(?:Cellar|opt)\/boldvideo\//.test(path)) {
			channel = "homebrew";
			upgradeCommand = "brew upgrade boldvideo/tap/boldvideo";
		} else if (path.includes("/node_modules/boldvideo/")) {
			const npx = path.includes("/_npx/") || process.env.npm_command === "exec";
			channel = npx ? "npx" : "npm";
			upgradeCommand = npx
				? "npx --yes boldvideo@latest"
				: "npm install --global boldvideo@latest";
		} else {
			let directory = dirname(executable);
			for (let depth = 0; depth < 3; depth++) {
				if (
					existsSync(join(directory, "src/main.ts")) &&
					existsSync(join(directory, "package.json"))
				) {
					channel = "source";
					upgradeCommand = `cd ${quote(directory)} && git pull --ff-only && bun install --frozen-lockfile && bun run ${compiled ? "build:binaries" : "build"}`;
					break;
				}
				directory = dirname(directory);
			}
		}

		if (!flags["no-check"]) {
			try {
				const response = await fetch(
					"https://registry.npmjs.org/boldvideo/latest",
					{
						signal: AbortSignal.timeout(3000),
					},
				);
				if (response.ok) {
					const latest = (await response.json()) as { version?: unknown };
					if (
						typeof latest.version === "string" &&
						/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(latest.version)
					)
						hint(`Latest npm version: ${latest.version}`);
				}
			} catch {
				// Upgrade advice still works offline or when the registry is unavailable.
			}
		}
		output(
			{ channel, current_version: version, upgrade_command: upgradeCommand },
			`Channel: ${channel}\nCurrent version: ${version}\nUpgrade command: ${upgradeCommand}`,
			ctx.json,
		);
	},
};
