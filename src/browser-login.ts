import { spawn } from "node:child_process";
import { hostname } from "node:os";
import pc from "picocolors";
import { apiUrl } from "./api";
import { mint, wordmark } from "./brand";
import { error, registerSecret } from "./errors";

export interface Workspace {
	slug: string;
	name: string;
	key: string;
}

export interface SignIn {
	user: { email: string };
	workspaces: Workspace[];
}

interface Started {
	device_code: string;
	user_code: string;
	verification_url: string;
	expires_in: number;
	interval: number;
}

const unreachable = () =>
	error(
		"api_error",
		"Could not reach the Bold API.",
		"Check BOLDVIDEO_API_URL, then run boldvideo login again.",
	);

// The sign-in endpoints take no key and answer with statuses the caller branches on.
async function post(
	path: string,
	body: unknown,
	interrupted?: AbortSignal,
): Promise<{ status: number; data: Record<string, unknown> }> {
	try {
		const timeout = AbortSignal.timeout(30_000);
		const response = await fetch(`${apiUrl()}${path}`, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			redirect: "error",
			signal: interrupted ? AbortSignal.any([timeout, interrupted]) : timeout,
		});
		const text = await response.text();
		return { status: response.status, data: text ? JSON.parse(text) : {} };
	} catch {
		throw unreachable();
	}
}

function openBrowser(url: string): void {
	const [command, args] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];
	try {
		const child = spawn(command as string, args as string[], {
			stdio: "ignore",
			detached: true,
		});
		child.on("error", () => {});
		child.unref();
	} catch {
		// No browser to open: the link is on screen.
	}
}

/**
 * Signs this terminal in through the browser: shows a code, waits for a person
 * to approve it at the link, and returns one admin key per approved workspace.
 */
export async function browserLogin(options: {
	openBrowser: boolean;
}): Promise<SignIn> {
	// "marcels-mbp.home" reads better as "marcels-mbp" on the approval page.
	const start = await post("/cli/logins", {
		client_name: hostname().split(".")[0],
	});
	if (start.status === 404)
		throw error(
			"api_error",
			"This Bold server does not support browser sign-in yet.",
			"Use boldvideo login --token <key> instead.",
		);
	if (start.status !== 201) throw unreachable();
	const started = start.data as unknown as Started;
	registerSecret(started.device_code);

	const terminal = Boolean(process.stderr.isTTY);
	const color = terminal && !process.env.NO_COLOR;
	const colors = pc.createColors(color);
	// A browser opened over SSH would open on the wrong machine.
	const opening =
		options.openBrowser &&
		terminal &&
		!process.env.BOLDVIDEO_NO_BROWSER &&
		!process.env.SSH_CONNECTION;
	const write = (text: string) => process.stderr.write(text);

	if (terminal) {
		// Some terminals report no width; assume a normal one rather than hide the logo.
		const wide = (process.stderr.columns || 80) >= 58;
		write("\n");
		if (wide) write(`${wordmark.map((row) => `  ${row}`).join("\n")}\n\n`);
		write(`  ${colors.bold("Sign in to Bold")}\n`);
		write(`  ${colors.dim("Run your video library from this terminal.")}\n\n`);
		write(
			`  ${colors.dim("Code   ")}${mint(colors.bold(started.user_code), color)}\n`,
		);
		write(`  ${colors.dim("Open   ")}${started.verification_url}\n\n`);
		write(
			`  ${colors.dim(
				opening
					? "Your browser is opening. Check the code matches, then approve."
					: "Open the link in a browser. Check the code matches, then approve.",
			)}\n\n`,
		);
	} else {
		// Piped: the link still has to reach a person, so it goes to stderr as plain text.
		write(
			`Open ${started.verification_url} and approve code ${started.user_code}.\n`,
		);
	}
	if (opening) openBrowser(started.verification_url);

	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let frame = 0;
	const hints = opening
		? "· Enter opens the browser again · Ctrl+C cancels"
		: "· Ctrl+C cancels";
	const draw = () =>
		write(
			`\r  ${mint(frames[frame++ % frames.length] as string, color)} Waiting for approval  ${colors.dim(hints)}`,
		);
	const spinner = terminal ? setInterval(draw, 80) : undefined;
	if (terminal) {
		write("\x1b[?25l");
		draw();
	}

	let cancel: (reason: unknown) => void = () => {};
	const cancelled = new Promise<never>((_resolve, reject) => {
		cancel = reject;
	});
	// Never rejects into the void if the wait ends before anyone races it.
	cancelled.catch(() => {});
	const interrupted = new AbortController();
	const onInterrupt = () => {
		interrupted.abort();
		cancel(error("usage_error", "Login cancelled.", "boldvideo login", 2));
	};
	const onInput = (chunk: Buffer) => {
		// Raw mode is off, so Ctrl+C arrives as SIGINT and Enter as a newline.
		if (opening && chunk.includes(10)) openBrowser(started.verification_url);
	};
	process.once("SIGINT", onInterrupt);
	if (terminal && process.stdin.isTTY) process.stdin.on("data", onInput);

	const deadline = Date.now() + started.expires_in * 1000;
	const pause = (ms: number) =>
		new Promise<void>((resolve) => setTimeout(resolve, ms));

	try {
		for (;;) {
			await Promise.race([
				pause(Math.max(started.interval, 0.05) * 1000),
				cancelled,
			]);
			if (Date.now() > deadline)
				throw error(
					"timed_out",
					"The sign-in expired before it was approved.",
					"boldvideo login",
					5,
				);
			// Raced, so Ctrl+C wins even while a poll is in flight and an approval
			// that lands after it is never saved.
			const poll = await Promise.race([
				post(
					"/cli/logins/token",
					{ device_code: started.device_code },
					interrupted.signal,
				),
				cancelled,
			]);
			if (poll.status === 200 && poll.data.status === "pending") continue;
			if (poll.status === 429) continue;
			if (poll.status === 200 && poll.data.status === "approved") {
				const result = poll.data as unknown as SignIn;
				for (const workspace of result.workspaces)
					registerSecret(workspace.key);
				return result;
			}
			if (poll.status === 410 && poll.data.code === "denied")
				throw error(
					"not_permitted",
					"The sign-in was cancelled in the browser.",
					"boldvideo login",
					3,
				);
			if (poll.status === 410)
				throw error(
					"timed_out",
					"The sign-in expired before it was approved.",
					"boldvideo login",
					5,
				);
			throw unreachable();
		}
	} finally {
		if (spinner) clearInterval(spinner);
		if (terminal) write("\r\x1b[2K\x1b[?25h");
		process.off("SIGINT", onInterrupt);
		process.stdin.off("data", onInput);
		process.stdin.pause();
	}
}
