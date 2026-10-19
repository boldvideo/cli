import { mkdir } from "node:fs/promises";
import { targets, writeChecksums } from "./checksums";

await mkdir("dist/bin", { recursive: true });
for (const [name, target] of Object.entries(targets)) {
	const result = Bun.spawnSync(
		[
			process.execPath,
			"build",
			"src/main.ts",
			"--compile",
			`--target=${target}`,
			`--outfile=dist/bin/${name}`,
		],
		{ stdout: "inherit", stderr: "inherit" },
	);
	if (result.exitCode !== 0) process.exit(result.exitCode);
}
await writeChecksums("dist/bin");
