import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";

// A shared signal bounds reset + agent + checker. Kill the group, including shells.
export async function execute(
	argv: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
	signal: AbortSignal,
	transcript: string,
) {
	signal.throwIfAborted();
	const output = createWriteStream(transcript, { mode: 0o600 });
	const errors = createWriteStream(`${transcript}.stderr`, { mode: 0o600 });
	const child = spawn(argv[0] as string, argv.slice(1), {
		cwd,
		env,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let text = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		text += chunk;
		output.write(chunk);
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
		errors.write(chunk);
	});
	const abort = () => {
		if (child.pid) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		}
	};
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	try {
		const code = await new Promise<number | null>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
		signal.throwIfAborted();
		if (code !== 0)
			throw new Error(
				`Process exited ${code}: ${stderr.trim().split("\n")[0] ?? ""}`,
			);
		return text;
	} finally {
		signal.removeEventListener("abort", abort);
		output.end();
		errors.end();
		await Promise.all([finished(output), finished(errors)]);
	}
}
