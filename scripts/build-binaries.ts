import { mkdir } from "node:fs/promises";
import { targets, writeChecksums } from "./checksums";

// A compiled binary must not load bunfig.toml (its preload runs code) or .env
// (it can redirect stored keys) from the directory it runs in.
// test/binary.test.ts builds with these flags and fails if they stop working.
export const compileFlags = [
	"--compile",
	"--no-compile-autoload-bunfig",
	"--no-compile-autoload-dotenv",
];

if (import.meta.main) {
	await mkdir("dist/bin", { recursive: true });
	for (const [name, target] of Object.entries(targets)) {
		const result = Bun.spawnSync(
			[
				process.execPath,
				"build",
				"src/main.ts",
				...compileFlags,
				`--target=${target}`,
				`--outfile=dist/bin/${name}`,
			],
			{ stdout: "inherit", stderr: "inherit" },
		);
		if (result.exitCode !== 0) process.exit(result.exitCode);
	}
	await writeChecksums("dist/bin");
}
