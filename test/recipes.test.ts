import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/cli";
import { commands } from "../src/commands";
import { words } from "./examples";

// Only known sibling paths may skip; a typo in an installed command must fail.
const siblings = [
	"collections",
	"viewers",
	"insights",
	"ask",
	"search",
	"videos publish",
];
let checked = 0;
let skipped = 0;
const directory = join(import.meta.dir, "../skill/recipes");

describe("recipe commands use the real CLI parser without executing writes", () => {
	for (const file of readdirSync(directory).filter((file) =>
		file.endsWith(".md"),
	)) {
		const markdown = readFileSync(join(directory, file), "utf8");
		const blocks = [...markdown.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)];
		let count = 0;
		for (const block of blocks) {
			for (const line of (block[1] ?? "").split("\n")) {
				if (!/^\s*boldvideo\s/.test(line)) continue;
				// Recipe CLI invocations occupy one line; shell redirects/pipelines
				// are outside argv. Variables remain literal single argument values.
				const invocation = line.trim().split(/\s(?:[<>]{1,2}|\|)\s/)[0];
				const argv = words(invocation ?? "");
				count++;
				const pending = siblings.find((path) =>
					path.split(" ").every((part, index) => argv[index] === part),
				);
				let registered = commands;
				let missing = false;
				for (const part of pending?.split(" ") ?? []) {
					const command = registered.find((command) => command.name === part);
					if (!command) {
						missing = true;
						break;
					}
					registered = command.subcommands ?? [];
				}
				const title = `${file}: ${count}: ${invocation}`;
				if (missing) {
					skipped++;
					test.skip(title, () => {});
				} else {
					checked++;
					test(title, () => {
						expect(() => parse(argv, commands)).not.toThrow();
					});
				}
			}
		}
		test(`${file} has executable CLI examples`, () => {
			expect(count).toBeGreaterThan(0);
		});
	}
});

afterAll(() => {
	console.info(
		`Recipe commands: ${checked} parsed, ${skipped} skipped (unregistered sibling paths).`,
	);
});
