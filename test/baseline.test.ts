import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("the built CLI preserves every baseline command and flag", () => {
	const tree = JSON.parse(
		execFileSync("node", ["dist/boldvideo.js", "help", "--json"], {
			encoding: "utf8",
		}),
	);
	const baseline = readFileSync("docs/baseline-0.1.0.md", "utf8");
	const rows = [...baseline.matchAll(/^\| `([^`]+)` \| (.*) \|$/gm)];
	expect(rows.length).toBeGreaterThan(0);
	for (const [, path, flags] of rows) {
		const [root, ...parts] = (path ?? "").split(" ");
		expect(root).toBe(tree.name);
		let command = tree;
		for (const part of parts) {
			command = command.subcommands?.find(
				(child: { name: string }) => child.name === part,
			);
			expect(command, `Missing baseline command: ${path}`).toBeDefined();
		}
		const names = command.flags.map((flag: { name: string }) => flag.name);
		for (const [, name] of (flags ?? "").matchAll(/`--([^`]+)`/g)) {
			expect(names, `Missing baseline flag: ${path} --${name}`).toContain(name);
		}
	}
});
