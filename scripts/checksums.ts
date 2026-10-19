import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const targets = {
	"boldvideo-darwin-arm64": "bun-darwin-arm64",
	"boldvideo-darwin-x64": "bun-darwin-x64",
	"boldvideo-linux-x64": "bun-linux-x64-baseline",
	"boldvideo-linux-arm64": "bun-linux-arm64",
} as const;

export async function writeChecksums(directory: string) {
	const lines = await Promise.all(
		Object.keys(targets).map(async (name) => {
			const hash = createHash("sha256")
				.update(await readFile(join(directory, name)))
				.digest("hex");
			return `${hash}  ${name}\n`;
		}),
	);
	await writeFile(join(directory, "checksums.txt"), lines.join(""));
}

export function parseChecksums(text: string): Record<string, string> {
	const hashes: Record<string, string> = {};
	for (const line of text.trim().split("\n")) {
		const match =
			/^([a-f0-9]{64}) {2}(boldvideo-(?:darwin|linux)-(?:arm64|x64))$/.exec(
				line,
			);
		if (!match?.[1] || !match[2] || hashes[match[2]]) {
			throw new Error(`Invalid or duplicate checksum: ${line}`);
		}
		hashes[match[2]] = match[1];
	}
	for (const name of Object.keys(targets)) {
		if (!hashes[name]) throw new Error(`Missing checksum: ${name}`);
	}
	return hashes;
}
