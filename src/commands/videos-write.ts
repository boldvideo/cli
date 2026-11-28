import { createInterface } from "node:readline";
import { request } from "../api";
import type { Credential } from "../auth";
import { type CliError, error } from "../errors";
import { hint, output, table } from "../output";
import type { Command, Context, Flags } from "../spec";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const fields = [
	["title", "title", "string", "Replace the video title."],
	[
		"description",
		"description",
		"string",
		"Replace the description; an empty string clears it.",
	],
	[
		"published-at",
		"published_at",
		"string",
		"ISO date or datetime (UTC if no timezone), or none to clear.",
	],
	["type", "video_type", "string", "Video type UUID or slug."],
	["privacy", "privacy", "string", "Visibility: public, unlisted or private."],
	[
		"tags",
		"tags",
		"list",
		"Replace tags, comma-separated or repeated; an empty value clears them.",
	],
	["add-tags", "add_tags", "list", "Add tags, comma-separated or repeated."],
	[
		"remove-tags",
		"remove_tags",
		"list",
		"Remove tags, comma-separated or repeated.",
	],
	[
		"collections",
		"collection_ids",
		"list",
		"Replace collections, comma-separated or repeated; an empty value clears them.",
	],
	[
		"add-collection",
		"add_collection_ids",
		"list",
		"Add collections, comma-separated or repeated.",
	],
	[
		"remove-collection",
		"remove_collection_ids",
		"list",
		"Remove collections, comma-separated or repeated.",
	],
] as const;

function usage(action: string, message: string): never {
	throw error("usage_error", message, `boldvideo videos ${action} --help`, 2);
}

function publishedAt(value: string, action: string): string | null {
	if (value === "none" && action === "update") return null;
	// Require ISO syntax and a real calendar date, not Date.parse's rollover dates.
	const match =
		/^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(
			value,
		);
	const date = match?.[1];
	const iso =
		value.includes("T") && !/(Z|[+-]\d{2}:\d{2})$/.test(value)
			? `${value}Z`
			: value;
	if (
		!date ||
		!Number.isFinite(Date.parse(iso)) ||
		new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
		/T24:/.test(value)
	)
		usage(
			action,
			`--published-at must be an ISO date or datetime${action === "update" ? ", or none" : ""}.`,
		);
	return new Date(iso).toISOString();
}

function changes(
	action: string,
	flags: Flags,
): Record<string, unknown> | undefined {
	if (action !== "update" && action !== "publish") return undefined;
	const body: Record<string, unknown> = {};
	for (const [flag, field] of fields) {
		if (
			flags[flag] !== undefined &&
			(action === "update" || flag === "published-at")
		)
			body[field] = flags[flag];
	}
	if (body.published_at !== undefined)
		body.published_at = publishedAt(String(body.published_at), action);
	if (
		body.privacy !== undefined &&
		!["public", "unlisted", "private"].includes(String(body.privacy))
	)
		usage(action, "--privacy must be public, unlisted or private.");
	if (action === "update" && Object.keys(body).length === 0)
		usage(action, "At least one change flag is required.");
	return body;
}

// PR #721 returns the same unwrapped admin single-video record as videos get.
function parseVideo(data: unknown): Record<string, unknown> {
	if (
		!data ||
		typeof data !== "object" ||
		Array.isArray(data) ||
		typeof (data as Record<string, unknown>).title !== "string"
	)
		throw error(
			"api_error",
			"The Bold API returned an invalid video record.",
			"boldvideo videos list",
		);
	return data as Record<string, unknown>;
}

type Result =
	| {
			id: string;
			ok: true;
			video?: Record<string, unknown>;
			dry_run?: true;
			method?: string;
			path?: string;
			body?: Record<string, unknown>;
	  }
	| { id: string; ok: false; error: Omit<CliError, "exitCode"> };

function failure(id: string, cause: unknown): Result {
	const { exitCode: _, ...details } =
		cause && typeof cause === "object" && "exitCode" in cause
			? (cause as CliError)
			: error(
					"internal_error",
					"An unexpected error occurred.",
					"boldvideo videos list",
				);
	details.message = details.message.replace(/[\r\n]+/g, " ");
	return { id, ok: false, error: details };
}

async function confirmDelete(videos: Result[]): Promise<void> {
	const reader = createInterface({ input: process.stdin, terminal: true });
	try {
		hint(
			`Delete these videos?\n${videos
				.filter((result) => result.ok)
				.map((result) => `${result.id}: ${result.video?.title}`)
				.join("\n")}\nType yes to delete:`,
		);
		const answer = await new Promise<string>((resolve) => {
			reader.once("line", resolve);
			reader.once("close", () => resolve(""));
			reader.once("SIGINT", () => resolve(""));
		});
		if (answer.trim().toLowerCase() !== "yes")
			throw error(
				"confirmation_required",
				"Video deletion cancelled.",
				"boldvideo videos delete --help",
				2,
			);
	} finally {
		reader.close();
	}
}

async function run(ctx: Context, args: string[], flags: Flags): Promise<void> {
	const action = ctx.path.at(-1) as string;
	const body = changes(action, flags);
	let ids = args;
	if (!ids.length && !process.stdin.isTTY) {
		let input = "";
		for await (const chunk of process.stdin) input += chunk;
		ids = input
			.split(/\r?\n/)
			.map((id) => id.trim())
			.filter(Boolean);
	}
	if (!ids.length)
		usage(
			action,
			"Supply at least one video ID as an argument or one per line on stdin.",
		);
	const { key } = ctx.credential as Credential;
	const method =
		action === "update" ? "PATCH" : action === "delete" ? "DELETE" : "POST";
	const path = (id: string) =>
		`/admin/videos/${encodeURIComponent(id)}${action === "publish" || action === "unpublish" ? `/${action}` : ""}`;
	const results: Result[] = [];
	// Read all titles before asking once; no deletes occur until confirmation.
	if (action === "delete" && (flags["dry-run"] || !flags.yes)) {
		for (const id of ids) {
			try {
				// TODO(bold-js): use the SDK when it covers admin video records.
				results.push({
					id,
					ok: true,
					video: parseVideo(await request("GET", path(id), { key })),
				});
			} catch (cause) {
				results.push(failure(id, cause));
			}
		}
		if (!flags["dry-run"] && results.some((result) => result.ok))
			await confirmDelete(results);
	}
	for (const [index, id] of ids.entries()) {
		if (results[index]?.ok === false) continue;
		try {
			if (flags["dry-run"]) {
				results[index] = {
					id,
					ok: true,
					video: results[index]?.video,
					dry_run: true,
					method,
					path: path(id),
					...(body ? { body } : {}),
				};
				if (body) hint(`Would ${method} ${path(id)} ${JSON.stringify(body)}`);
			} else {
				// TODO(bold-js): use the SDK when it covers admin video mutations.
				const video = parseVideo(
					await request(method, path(id), { key, body }),
				);
				results[index] = { id, ok: true, video };
			}
		} catch (cause) {
			results[index] = failure(id, cause);
		}
	}
	output(
		results,
		table(
			results.map((result) => ({
				id: result.id,
				title: result.ok ? (result.video?.title ?? body?.title) : "",
				status: result.ok ? result.video?.status : "",
				privacy: result.ok
					? (result.video?.privacy_level ?? body?.privacy)
					: "",
				result: result.ok
					? flags["dry-run"]
						? `would ${action}`
						: "ok"
					: result.error.code,
			})),
		),
		ctx.json,
	);
	const failed = results.filter((result) => !result.ok);
	if (failed.length)
		throw error(
			"bulk_failed",
			`${failed.length} video operation(s) failed.`,
			`boldvideo videos ${action} ${failed.map((result) => quote(result.id)).join(" ")} --help`,
		);
}

const bulk = {
	auth: "admin" as const,
	write: true,
	args: [
		{
			name: "id",
			description:
				"Video UUIDs, hashids or slugs; omit to read one per stdin line.",
			required: false,
			variadic: true,
		},
	],
	description:
		"Processes IDs in order and continues on individual failures. Reads one ID per stdin line when no IDs are given. Exit 1 means at least one video failed; stdout still contains every result. --dry-run previews without writing.",
	run,
};

export const videoWrites: Command[] = [
	{
		...bulk,
		name: "update",
		aliases: ["edit"],
		summary: "Update metadata and visibility for one or more videos.",
		flags: fields.map(([name, , type, description]) => ({
			name,
			type,
			description,
			...(name === "privacy"
				? { choices: ["public", "unlisted", "private"] }
				: {}),
		})),
		examples: [
			{
				cmd: "boldvideo videos update paid-workshops --title 'Paid workshops: October' --privacy unlisted",
				note: "Rename a video and change visibility.",
			},
			{
				cmd: "boldvideo videos update paid-workshops sales-onboarding --add-tags sales,training --remove-collection archived",
				note: "Apply the same metadata changes to multiple videos.",
			},
		],
		seeAlso: ["boldvideo videos get --help", "boldvideo videos publish --help"],
	},
	{
		...bulk,
		name: "publish",
		summary:
			"Publish one or more videos, optionally setting the publication date.",
		flags: [
			{
				name: "published-at",
				type: "string",
				description: "Publication ISO date or datetime (UTC if no timezone).",
			},
		],
		examples: [
			{
				cmd: "boldvideo videos publish paid-workshops sales-onboarding",
				note: "Publish two videos in sequence.",
			},
			{
				cmd: "boldvideo videos publish paid-workshops --published-at 2026-10-19T10:00:00Z --dry-run",
				note: "Preview publishing with an explicit date.",
			},
		],
		seeAlso: [
			"boldvideo videos unpublish --help",
			"boldvideo videos update --help",
		],
	},
	{
		...bulk,
		name: "unpublish",
		summary: "Unpublish one or more videos.",
		examples: [
			{
				cmd: "boldvideo videos unpublish paid-workshops sales-onboarding",
				note: "Unpublish two videos in sequence.",
			},
			{
				cmd: "boldvideo videos unpublish paid-workshops --dry-run",
				note: "Preview unpublishing without changing the video.",
			},
		],
		seeAlso: [
			"boldvideo videos publish --help",
			"boldvideo videos delete --help",
		],
	},
	{
		...bulk,
		name: "delete",
		aliases: ["rm"],
		summary: "Delete one or more videos after confirmation.",
		destructive: true,
		description: `${bulk.description} On a terminal, asks once listing video titles unless --yes is given. Piped stdin requires --yes, including with --dry-run.`,
		examples: [
			{
				cmd: "boldvideo videos delete paid-workshops sales-onboarding --yes",
				note: "Delete two videos without an interactive prompt.",
			},
			{
				cmd: "boldvideo videos delete paid-workshops --dry-run --yes",
				note: "Preview deletion, including the video's title.",
			},
		],
		seeAlso: ["boldvideo videos unpublish --help", "boldvideo videos list"],
	},
];
