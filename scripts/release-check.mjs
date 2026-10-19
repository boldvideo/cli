import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

const alias = JSON.parse(
	readFileSync("packages/cli-alias/package.json", "utf8"),
);
assert.equal(alias.version, version, "Alias version must match boldvideo");
assert.equal(alias.dependencies.boldvideo, version, "Alias must pin boldvideo");
const aliasFilename = `boldvideo-cli-${version}.tgz`;
execFileSync("npm", ["pack", "./packages/cli-alias"], { stdio: "inherit" });
const aliasEntries = execFileSync("tar", ["-tzf", aliasFilename], {
	encoding: "utf8",
})
	.trim()
	.split("\n");
assert.deepEqual(aliasEntries.sort(), [
	"package/bin/boldvideo.js",
	"package/package.json",
]);
const temporary = mkdtempSync(join(tmpdir(), "boldvideo-alias-"));
try {
	execFileSync(
		"npm",
		[
			"install",
			"--prefix",
			temporary,
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			resolve(filename),
			resolve(aliasFilename),
		],
		{ stdio: "inherit" },
	);
	const aliasOutput = execFileSync(
		"node",
		[
			join(temporary, "node_modules/@boldvideo/cli/bin/boldvideo.js"),
			"--version",
		],
		{ encoding: "utf8" },
	);
	assert.deepEqual(JSON.parse(aliasOutput), { version });
	console.log(
		`${aliasFilename}: contents OK; installed alias --version = ${version}`,
	);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
