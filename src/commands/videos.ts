import { writeFileSync } from "node:fs";
import { apiUrl, request } from "../api";
import { type Credential, identity } from "../auth";
import { apiError, type CliError, error, redact } from "../errors";
import { hint, output, outputList, table } from "../output";
import type { Command } from "../spec";
import { videoWrites } from "./videos-write";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const filters = ["status", "privacy", "collection", "tag", "type", "since"];

// Keep the pending backend's page envelope and display fields isolated here.
function parsePage(data: unknown, admin: boolean) {
	const page = data as {
		data: Record<string, unknown>[];
		meta?: { page: number; total_pages: number };
	};
	if (
		!Array.isArray(page?.data) ||
		((admin || page.meta !== undefined) &&
			(!Number.isSafeInteger(page.meta?.page) ||
				!Number.isSafeInteger(page.meta?.total_pages)))
	)
		throw error(
			"api_error",
			"The Bold API did not return a paginated video page; bounded listing requires pagination metadata.",
			"boldvideo videos list",
		);
	return page;
}

// Both key kinds get the record inside a data envelope. A bare record, which
// the admin API returned before it had one, is still read.
function parseVideo(data: unknown): Record<string, unknown> {
	const inner = (data as { data?: unknown } | null)?.data;
	return (inner && typeof inner === "object" ? inner : data) as Record<
		string,
		unknown
	>;
}

function videoRow(video: Record<string, unknown>) {
	const seconds =
		typeof video.duration === "number" ? Math.floor(video.duration) : undefined;
	return {
		id: video.internal_id ?? video.id,
		title: video.title,
		status: video.status,
		privacy: video.privacy_level,
		published: video.published_at,
		duration:
			seconds === undefined
				? ""
				: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
	};
}

function videoError(cause: unknown): never {
	if ((cause as CliError)?.code === "not_found")
		throw { ...(cause as CliError), hint: "boldvideo videos list" };
	throw cause;
}

export function videoText(video: Record<string, unknown>): string {
	return table(
		Object.entries(video).map(([key, value]) => ({
			key,
			value: typeof value === "object" ? JSON.stringify(value) : value,
		})),
	);
}

export const videos: Command = {
	name: "videos",
	aliases: ["v", "video"],
	summary: "Browse library videos and retrieve transcripts.",
	examples: [
		{ cmd: "boldvideo videos list", note: "Browse the first page of videos." },
		{
			cmd: "boldvideo videos get paid-workshops",
			note: "Inspect a video by slug.",
		},
	],
	seeAlso: ["boldvideo whoami"],
	subcommands: [
		{
			name: "list",
			aliases: ["ls"],
			summary: "List a bounded page of library videos.",
			list: true,
			flags: [
				...filters.map((name) => ({
					name,
					type: "string" as const,
					description:
						name === "since"
							? "Videos updated since this ISO timestamp."
							: `Filter by video ${name}.`,
					...(name === "privacy"
						? { choices: ["public", "unlisted", "private"] }
						: {}),
				})),
				{
					name: "page",
					type: "number",
					default: 1,
					description: "Page number (positive integer).",
				},
			],
			examples: [
				{
					cmd: "boldvideo videos list --status ready --privacy private --limit 10",
					note: "Find ready private videos with an admin key.",
				},
				{
					cmd: "boldvideo videos list --collection paid-workshops --fields internal_id,title --page 2",
					note: "Select fields from the second page.",
				},
			],
			seeAlso: ["boldvideo videos get --help"],
			async run(ctx, _args, flags) {
				const page = Number(flags.page);
				if (!Number.isSafeInteger(page) || page < 1)
					throw error(
						"usage_error",
						"--page must be a positive integer.",
						"boldvideo videos list --help",
						2,
					);
				const { key } = ctx.credential as Credential;
				const admin = (await identity(key)).key.kind === "admin";
				if (!admin && !ctx.json) hint("Tenant keys list public videos only.");
				const query: Record<string, string | number> = {
					page,
					page_size: Number(flags.limit),
				};
				for (const name of filters)
					if (flags[name] !== undefined)
						query[name === "since" ? "updated_since" : name] = String(
							flags[name],
						);
				// TODO(bold-js): use the SDK when it covers the admin video filters and page envelope.
				const result = parsePage(
					await request("GET", admin ? "/admin/videos" : "/videos", {
						key,
						query,
					}),
					admin,
				);
				const limit = Number(flags.limit);
				// The public endpoint currently ignores page_size and omits meta.
				// Until it paginates, show a bounded prefix and offer a larger one.
				const items = result.meta ? result.data : result.data.slice(0, limit);
				const hasMore = result.meta
					? page < result.meta.total_pages
					: result.data.length > limit;
				const next = hasMore
					? `boldvideo videos list --page ${result.meta ? page + 1 : page} --limit ${result.meta ? limit : Math.min(limit * 2, result.data.length)}${[
							...filters,
							"profile",
							"fields",
						]
							.filter((name) => flags[name] !== undefined)
							.map(
								(name) =>
									` --${name} ${quote(Array.isArray(flags[name]) ? (flags[name] as string[]).join(",") : String(flags[name]))}`,
							)
							.join("")}${flags.json ? " --json" : ""}`
					: undefined;
				outputList(
					!ctx.json && !(flags.fields as string[] | undefined)?.length
						? items.map(videoRow)
						: items,
					flags,
					next,
				);
			},
		},
		{
			name: "get",
			aliases: ["show"],
			summary: "Show the full video record by UUID, hashid or slug.",
			args: [{ name: "id", description: "Video UUID, hashid or slug." }],
			examples: [
				{
					cmd: "boldvideo videos get paid-workshops",
					note: "Inspect a video by slug.",
				},
				{
					cmd: "boldvideo videos get 30c0d0a0-278c-4c90-b15c-e64e197abf12 --json",
					note: "Retrieve a complete admin record by UUID.",
				},
			],
			seeAlso: ["boldvideo videos list", "boldvideo videos transcript --help"],
			async run(ctx, args) {
				const { key } = ctx.credential as Credential;
				const admin = (await identity(key)).key.kind === "admin";
				try {
					// TODO(bold-js): use the SDK when it covers admin records and preserves API field names.
					const video = parseVideo(
						await request(
							"GET",
							`${admin ? "/admin" : ""}/videos/${encodeURIComponent(args[0] as string)}`,
							{ key },
						),
					);
					output(video, videoText(video), ctx.json);
				} catch (cause) {
					videoError(cause);
				}
			},
		},
		{
			name: "transcript",
			summary: "Retrieve a video transcript or save it to a file.",
			write: true,
			description:
				"Defaults to txt on a terminal and json when piped. Piped text formats are JSON strings; --out saves the raw body.",
			args: [{ name: "id", description: "Video UUID, hashid or slug." }],
			flags: [
				{
					name: "format",
					type: "string",
					description: "Transcript format: txt, srt, vtt or json.",
					choices: ["txt", "srt", "vtt", "json"],
				},
				{
					name: "out",
					type: "string",
					description: "Save the transcript body to this file.",
					complete: "file",
				},
			],
			examples: [
				{
					cmd: "boldvideo videos transcript paid-workshops",
					note: "Read the transcript in the default format.",
				},
				{
					cmd: "boldvideo videos transcript paid-workshops --format srt --out paid-workshops.srt",
					note: "Save subtitles to a file.",
				},
			],
			seeAlso: ["boldvideo videos get paid-workshops"],
			async run(ctx, args, flags) {
				const format = String(flags.format ?? (ctx.json ? "json" : "txt"));
				if (!["txt", "srt", "vtt", "json"].includes(format))
					throw error(
						"usage_error",
						"--format must be txt, srt, vtt or json.",
						"boldvideo videos transcript --help",
						2,
					);
				if (flags["dry-run"] && flags.out) {
					output(
						{ out: flags.out, format, dry_run: true },
						`Would save transcript to ${flags.out}.`,
						ctx.json,
					);
					return;
				}
				const { key } = ctx.credential as Credential;
				await identity(key);
				const signal = AbortSignal.timeout(30_000);
				try {
					// TODO(bold-js): use the SDK when it supports transcript content negotiation.
					// request() is JSON-only; keep text transport here until it supports raw bodies.
					const response = await fetch(
						`${apiUrl()}/videos/${encodeURIComponent(args[0] as string)}/transcript?format=${format}`,
						{
							headers: {
								Authorization: `Bearer ${key}`,
								Accept: {
									txt: "text/plain",
									srt: "application/x-subrip",
									vtt: "text/vtt",
									json: "application/json",
								}[format] as string,
							},
							redirect: "error",
							signal,
						},
					);
					const body = await response.text();
					if (!response.ok) {
						let data: { code?: string } | null = {};
						try {
							data = JSON.parse(body);
						} catch {
							/* Non-JSON API failures still use the standard error shape. */
						}
						const failure = apiError(
							response.status,
							data,
							response.headers.get("x-request-id") ?? undefined,
						);
						if (
							response.status === 404 &&
							data?.code === "transcript_not_ready"
						) {
							const pending = error(
								"transcript_not_ready",
								"The video transcript is not ready.",
								`Run boldvideo videos get ${quote(args[0] as string)} and try again, or use --wait on the import.`,
								4,
							);
							throw {
								...pending,
								...(failure.request_id
									? { request_id: failure.request_id }
									: {}),
							};
						}
						throw failure;
					}
					let data: unknown = body;
					if (format === "json") {
						try {
							data = JSON.parse(body);
						} catch {
							throw error(
								"api_error",
								"The Bold API returned invalid transcript JSON.",
								"boldvideo videos transcript --help",
							);
						}
					}
					if (flags.out) {
						try {
							writeFileSync(String(flags.out), redact(body));
						} catch {
							throw error(
								"file_error",
								"Could not write the transcript file.",
								"boldvideo videos transcript --help",
							);
						}
						output(
							{ out: flags.out, format },
							`Saved transcript to ${flags.out}.`,
							ctx.json,
						);
					} else output(data, body.replace(/\n$/, ""), ctx.json);
				} catch (cause) {
					if (signal.aborted)
						throw error(
							"timed_out",
							"The transcript request timed out.",
							"boldvideo videos transcript --help",
							5,
						);
					if (cause instanceof TypeError)
						throw error(
							"api_error",
							"Could not reach the Bold API.",
							"boldvideo whoami",
						);
					videoError(cause);
				}
			},
		},
		...videoWrites,
	],
};
