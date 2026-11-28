import { setTimeout as sleep } from "node:timers/promises";
import { type CliError, error, writeError } from "../errors";
import type { Flag, Flags } from "../spec";

// What every import command shares: the metadata and wait flags, their
// validation, and the wait loop. URL imports and file uploads both read it.
export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export const waitFlags: Flag[] = [
	{
		name: "wait",
		type: "boolean",
		default: false,
		description: "Wait until imported videos are transcribed and indexed.",
	},
	{
		name: "poll-interval",
		type: "number",
		default: 5,
		description: "Seconds between polls (positive number).",
	},
	{
		name: "timeout",
		type: "number",
		default: 3600,
		description:
			"Maximum seconds to wait (positive number; default 60 minutes).",
	},
];
export const metadataFlags: Flag[] = [
	{
		name: "from",
		type: "string",
		description:
			"Read URLs one per line from a file instead of a positional URL or stdin.",
		complete: "file",
	},
	{
		name: "title",
		type: "string",
		description: "Single-video title; required for direct media URLs.",
	},
	{
		name: "description",
		type: "string",
		description: "Single-video description.",
	},
	{
		name: "tags",
		type: "list",
		description: "Tag names, comma-separated or repeated.",
	},
	{
		name: "collection",
		type: "list",
		description: "Collection IDs or exact names, comma-separated or repeated.",
	},
	{ name: "type", type: "string", description: "Video type UUID or slug." },
	{
		name: "privacy",
		type: "string",
		default: "unlisted",
		description: "Visibility: public, unlisted or private.",
		choices: ["public", "unlisted", "private"],
	},
	{
		name: "published-at",
		type: "string",
		description:
			"Single: ISO date or datetime with timezone. Run: source (default), now or none.",
	},
	{
		name: "external-id",
		type: "string",
		description: "Single-video external identifier.",
	},
	{
		name: "language",
		type: "string",
		description: "Single-video language code.",
	},
	{
		name: "max",
		type: "number",
		description: "Maximum videos in a playlist/channel run (positive integer).",
	},
	{
		name: "order",
		type: "string",
		description: "Playlist/channel order: latest or oldest.",
		choices: ["latest", "oldest"],
	},
	...waitFlags,
];

export function usage(message: string): never {
	throw error("usage_error", message, "boldvideo import --help", 2);
}

export function validateWait(flags: Flags) {
	for (const name of ["poll-interval", "timeout"])
		if (Number(flags[name]) <= 0 || Number(flags[name]) > 2_147_483)
			usage(`--${name} must be positive and at most 2147483 seconds.`);
}

/** Fields every import accepts, for one video or a whole run. */
export function sharedFields(flags: Flags): Record<string, unknown> {
	if (!["public", "unlisted", "private"].includes(String(flags.privacy)))
		usage("--privacy must be public, unlisted or private.");
	const body: Record<string, unknown> = { privacy: flags.privacy };
	for (const [flag, field] of [
		["tags", "tags"],
		["collection", "collection_ids"],
		["type", "video_type"],
	] as const)
		if (flags[flag] !== undefined) body[field] = flags[flag];
	return body;
}

/** Fields that describe exactly one video. */
export function videoFields(flags: Flags): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	for (const name of ["title", "description", "external-id", "language"])
		if (flags[name] !== undefined)
			body[name.replaceAll("-", "_")] = flags[name];
	if (flags["published-at"] !== undefined) {
		const value = String(flags["published-at"]);
		const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
		const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
		if (
			(!dateOnly &&
				!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
					value,
				)) ||
			!Number.isFinite(date.getTime()) ||
			new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !==
				value.slice(0, 10)
		)
			usage(
				"--published-at must be a valid ISO date or datetime with timezone.",
			);
		body.published_at = date.toISOString();
	}
	return body;
}

export async function waitFor<T>(
	flags: Flags,
	resume: string,
	poll: (signal: AbortSignal) => Promise<T | undefined>,
): Promise<T> {
	const controller = new AbortController();
	const interrupted = () => {
		writeError(
			error(
				"interrupted",
				"Stopped waiting; the import continues without cancellation.",
				resume,
			),
		);
		process.exit(130);
	};
	// Abort observation, not the remote import. Bulk callers can report this
	// item's timeout and continue with the remaining URLs.
	const timeout = setTimeout(() => {
		controller.abort(
			error(
				"timed_out",
				"Timed out waiting for imported videos to become ready.",
				resume,
				5,
			),
		);
	}, Number(flags.timeout) * 1000);
	process.on("SIGINT", interrupted);
	try {
		for (;;) {
			controller.signal.throwIfAborted();
			const result = await poll(controller.signal);
			controller.signal.throwIfAborted();
			if (result !== undefined) return result;
			await sleep(Number(flags["poll-interval"]) * 1000, undefined, {
				signal: controller.signal,
			});
		}
	} catch (cause) {
		if (controller.signal.aborted) throw controller.signal.reason;
		if ((cause as CliError)?.code === "timed_out")
			throw { ...(cause as CliError), hint: resume };
		throw cause;
	} finally {
		clearTimeout(timeout);
		process.removeListener("SIGINT", interrupted);
	}
}

export function failed(video: Record<string, unknown>) {
	return (
		["failed", "error", "canceled", "cancelled"].includes(
			String(video.status),
		) || String(video.status).endsWith("_failed")
	);
}
