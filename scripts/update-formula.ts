import { readFile, writeFile } from "node:fs/promises";
import { parseChecksums } from "./checksums";

const [version, checksumsPath, formulaPath] = process.argv.slice(2);
if (!version || !checksumsPath || !formulaPath) {
	throw new Error(
		"Usage: bun scripts/update-formula.ts <version> <checksums.txt> <boldvideo.rb>",
	);
}
const normalized = version.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
	throw new Error("Homebrew requires a stable version such as 0.1.0 or v0.1.0");
}
const hashes = parseChecksums(await readFile(checksumsPath, "utf8"));
let formula = await readFile(formulaPath, "utf8");
if ((formula.match(/^ {2}version ".*"$/gm) ?? []).length !== 1) {
	throw new Error("Expected exactly one formula version");
}
formula = formula.replace(/^ {2}version ".*"$/m, `  version "${normalized}"`);
for (const [name, hash] of Object.entries(hashes)) {
	const pattern = new RegExp(
		`(url "https://github\\.com/boldvideo/cli/releases/download/v#\\{version\\}/${name}"\\n\\s+sha256 ")[a-f0-9]{64}"`,
	);
	if (!pattern.test(formula)) throw new Error(`Missing formula entry: ${name}`);
	formula = formula.replace(
		pattern,
		(_, prefix: string) => `${prefix}${hash}"`,
	);
}
await writeFile(formulaPath, formula);
