import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const filename = `boldvideo-${version}.tgz`;
execFileSync("npm", ["pack"], { stdio: "inherit" });
const entries = execFileSync("tar", ["-tzf", filename], {
	encoding: "utf8",
})
	.trim()
	.split("\n");
for (const entry of entries) {
	assert.match(
		entry,
		/^package\/(dist\/.*|package\.json|README\.md|LICENSE)$/,
		`Unexpected tarball entry: ${entry}`,
	);
	assert.ok(!entry.endsWith(".map"), `Source map in tarball: ${entry}`);
}
for (const required of [
	"dist/boldvideo.js",
	"package.json",
	"README.md",
	"LICENSE",
]) {
	assert.ok(entries.includes(`package/${required}`), `Missing ${required}`);
}
const output = execFileSync("npx", ["--yes", `./${filename}`, "--version"], {
	encoding: "utf8",
});
assert.deepEqual(JSON.parse(output), { version });
console.log(`${filename}: contents OK; npx --version = ${version}`);
