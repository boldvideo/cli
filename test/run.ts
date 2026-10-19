import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RunOptions {
	env?: NodeJS.ProcessEnv;
	tty?: boolean;
	columns?: number;
	/** With a PTY, default to terminal stderr; use pipe to test independent streams. */
	stderr?: "tty" | "pipe";
	input?: string;
	/** Send input only after this marker appears on terminal stdout. Async only. */
	waitFor?: string;
}

export interface RunResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

// All script arguments, BSD stdin handling and PTY normalization live here.
function invocation(argv: string[], options: RunOptions) {
	let temporary: string | undefined;
	let stderrFile: string | undefined;
	if (options.tty) {
		let command = `exec ${argv.map(quote).join(" ")}`;
		if (options.columns !== undefined) {
			if (!Number.isSafeInteger(options.columns) || options.columns < 1)
				throw new Error("Terminal columns must be a positive integer");
			command = `stty cols ${options.columns}; ${command}`;
		}
		if (options.stderr === "pipe") {
			temporary = mkdtempSync(join(tmpdir(), "boldvideo-stderr-"));
			stderrFile = join(temporary, "stderr");
			command += ` 2>${quote(stderrFile)}`;
		}
		// Bun async stdin is a socket; BSD script's terminal probe needs a real pipe.
		argv =
			process.platform === "darwin"
				? ["sh", "-c", `cat | script -q /dev/null sh -c ${quote(command)}`]
				: ["script", "-qefc", command, "/dev/null"];
	}
	return {
		argv,
		env: {
			...process.env,
			NO_COLOR: "1",
			FORCE_COLOR: undefined,
			BOLDVIDEO_API_KEY: "",
			...options.env,
		},
		result(status: number | null, stdout: string, stderr: string): RunResult {
			stdout = stdout.replaceAll("\r\n", "\n");
			if (
				options.tty &&
				process.platform === "darwin" &&
				stdout.startsWith("^D")
			)
				stdout = stdout.slice(stdout.startsWith("^D\b\b") ? 4 : 2);
			if (stderrFile && existsSync(stderrFile))
				stderr += readFileSync(stderrFile, "utf8");
			return { status, stdout, stderr };
		},
		cleanup() {
			if (temporary) rmSync(temporary, { recursive: true, force: true });
		},
	};
}

/** Execute a full argv, e.g. ["node", built, "whoami"] or ["sh", "-c", continuation]. */
export async function run(
	argv: string[],
	options: RunOptions = {},
): Promise<RunResult> {
	const call = invocation(argv, options);
	try {
		return await new Promise<RunResult>((resolve, reject) => {
			const child = spawn(call.argv[0] as string, call.argv.slice(1), {
				env: call.env,
				stdio: "pipe",
			});
			let stdout = "";
			let stderr = "";
			let sent = false;
			child.stdout.setEncoding("utf8").on("data", (data) => {
				stdout += data;
				if (options.waitFor && !sent && stdout.includes(options.waitFor)) {
					sent = true;
					child.stdin.end(options.input ?? "");
				}
			});
			child.stderr.setEncoding("utf8").on("data", (data) => {
				stderr += data;
			});
			child.once("error", reject);
			child.stdin.once("error", reject);
			child.once("close", (status) =>
				resolve(call.result(status, stdout, stderr)),
			);
			if (!options.waitFor) child.stdin.end(options.input ?? "");
		});
	} finally {
		call.cleanup();
	}
}

/** Only for tests without an in-process server or interactive input. */
export function runSync(
	argv: string[],
	options: Omit<RunOptions, "waitFor"> = {},
): RunResult {
	const call = invocation(argv, options);
	try {
		const result = spawnSync(call.argv[0] as string, call.argv.slice(1), {
			env: call.env,
			input: options.input ?? "",
			encoding: "utf8",
		});
		if (result.error) throw result.error;
		return call.result(result.status, result.stdout, result.stderr);
	} finally {
		call.cleanup();
	}
}
