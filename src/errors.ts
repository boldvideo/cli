import pc from "picocolors";
import type { ExitCode } from "./exit-codes";

export interface CliError {
	code: string;
	message: string;
	hint: string;
	docs: string;
	exitCode: ExitCode;
	request_id?: string;
}

export function error(
	code: string,
	message: string,
	hint: string,
	exitCode: ExitCode = 1,
): CliError {
	return {
		code,
		message,
		hint,
		docs: `https://docs.boldvideo.com/cli#${code.replaceAll("_", "-")}`,
		exitCode,
	};
}

export function apiError(
	status: number,
	body: unknown,
	requestId?: string,
	hint = "boldvideo --help",
): CliError {
	const codes: Record<number, [string, ExitCode]> = {
		401: ["not_authenticated", 3],
		403: ["not_permitted", 3],
		404: ["not_found", 4],
		408: ["timed_out", 5],
		504: ["timed_out", 5],
	};
	const [code, exitCode] = codes[status] ?? ["api_error", 1];
	const data =
		body && typeof body === "object" ? (body as Record<string, unknown>) : {};
	const details =
		data.error && typeof data.error === "object"
			? (data.error as Record<string, unknown>)
			: data;
	const result = error(
		code,
		typeof details.message === "string"
			? details.message
			: `API request failed (HTTP ${status}).`,
		hint,
		exitCode,
	);
	const id = requestId ?? data.request_id;
	if (typeof id === "string") result.request_id = id;
	return result;
}

const secrets = new Set<string>();

export function registerSecret(key: string): void {
	if (key) secrets.add(key);
}

export function redact(text: string): string {
	registerSecret(process.env.BOLDVIDEO_API_KEY ?? "");
	for (const key of [...secrets].sort((a, b) => b.length - a.length)) {
		text = text
			.replaceAll(JSON.stringify(key).slice(1, -1), "[REDACTED]")
			.replaceAll(key, "[REDACTED]");
	}
	return text;
}

export function writeError(thrown: unknown): ExitCode {
	const value =
		thrown &&
		typeof thrown === "object" &&
		"exitCode" in thrown &&
		"code" in thrown
			? (thrown as CliError)
			: error(
					"internal_error",
					thrown instanceof Error
						? thrown.message
						: "An unexpected error occurred.",
					"boldvideo --help",
				);
	const { exitCode, ...fields } = value;
	fields.message = fields.message.replace(/[\r\n]+/g, " ");
	const colors = pc.createColors(
		Boolean(process.stderr.isTTY) && !process.env.NO_COLOR,
	);
	const text = process.stderr.isTTY
		? `${colors.red(fields.code)}: ${fields.message}\n${colors.cyan(`Hint: ${fields.hint}`)}\nDocs: ${fields.docs}${fields.request_id ? `\nRequest ID: ${fields.request_id}` : ""}\n`
		: `${JSON.stringify(fields)}\n`;
	process.stderr.write(redact(text));
	return exitCode;
}
