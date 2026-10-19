import { parseArgs } from "node:util";
import { readTask } from "./tasks";

// Standalone checker contract: exit 0 passes; exit 1 fails with a one-line reason.
// BOLD-2041 can replace this checker without changing the runner.
export async function check(taskPath: string, answerPath?: string) {
	const { check: rule } = await readTask(taskPath);
	let actual: unknown;
	if (rule.kind === "answer") {
		if (!answerPath) throw new Error("Answer check requires --answer file");
		actual = await Bun.file(answerPath).text();
	} else {
		if (!process.env.BOLDVIDEO_API_KEY || !process.env.BOLDVIDEO_API_URL)
			throw new Error(
				"API checks require BOLDVIDEO_API_KEY and BOLDVIDEO_API_URL",
			);
		const base = `${process.env.BOLDVIDEO_API_URL.replace(/\/$/, "")}/`;
		if (typeof rule.path !== "string" || !rule.path.startsWith("/"))
			throw new Error("API check requires an API-relative path");
		const url = new URL(base + rule.path.slice(1));
		if (!url.href.startsWith(base))
			throw new Error("Check path escapes API base");
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${process.env.BOLDVIDEO_API_KEY}` },
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) throw new Error(`Check API returned ${response.status}`);
		actual = await response.json();
		for (const key of String(rule.field ?? "")
			.split(".")
			.filter(Boolean))
			actual = (actual as Record<string, unknown>)?.[key];
	}
	if (Object.hasOwn(rule, "equals")) {
		if (JSON.stringify(actual) !== JSON.stringify(rule.equals))
			throw new Error("Check value does not equal expected value");
	} else if (typeof rule.contains === "string") {
		if (!String(actual).includes(rule.contains))
			throw new Error(`Answer missing expected text: ${rule.contains}`);
	} else throw new Error("Check requires equals or contains");
}

if (import.meta.main) {
	try {
		const args = parseArgs({
			args: process.argv.slice(2),
			allowPositionals: true,
			options: { answer: { type: "string" } },
		});
		if (!args.positionals[0])
			throw new Error("Usage: bun evals/check.ts <task> [--answer file]");
		await check(args.positionals[0], args.values.answer);
		console.log("pass");
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
