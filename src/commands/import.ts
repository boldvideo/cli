import { setTimeout as sleep } from "node:timers/promises";
import { request } from "../api";
import type { Credential } from "../auth";
import { type CliError, error, writeError } from "../errors";
import {
	getRun,
	type ImportRun,
	importRun,
	importVideo,
	postImport,
} from "../import-api";
import { hint, output } from "../output";
import type { Command, Context, Flag, Flags } from "../spec";
import { videoText } from "./videos";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const waitFlags: Flag[] = [
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
const metadataFlags: Flag[] = [
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
		description: "Collection IDs, comma-separated or repeated.",
	},
	{ name: "type", type: "string", description: "Video type UUID or slug." },
	{
		name: "privacy",
		type: "string",
		default: "unlisted",
		description: "Visibility: public, unlisted or private.",
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
		name: "limit",
		type: "number",
		description: "Maximum videos in a playlist/channel run (positive integer).",
	},
	{
		name: "order",
		type: "string",
		description: "Playlist/channel order: latest or oldest.",
	},
	...waitFlags,
];

function usage(message: string): never {
	throw error("usage_error", message, "boldvideo import --help", 2);
}

function validateWait(flags: Flags) {
	for (const name of ["poll-interval", "timeout"])
		if (Number(flags[name]) <= 0 || Number(flags[name]) > 2_147_483)
			usage(`--${name} must be positive and at most 2147483 seconds.`);
}

function importRequest(source: string, youtubeOnly: boolean, flags: Flags) {
	let url: URL;
	try {
		url = new URL(source);
	} catch {
		return usage("The source must be an HTTP or HTTPS URL.");
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password
	)
		usage("The source must be an HTTP or HTTPS URL without credentials.");
	const host = url.hostname;
	const youtube =
		host === "youtu.be" ||
		host === "youtube.com" ||
		host.endsWith(".youtube.com");
	const vimeo = host === "vimeo.com" || host.endsWith(".vimeo.com");
	if (youtubeOnly && !youtube)
		usage("Use boldvideo import url for sources outside YouTube.");
	const isRun =
		youtube &&
		(url.searchParams.has("list") ||
			/^\/(?:playlist(?:\/|$)|@[^/]+(?:\/|$)|(?:channel|c|user)\/)/.test(
				url.pathname,
			));
	if (!["public", "unlisted", "private"].includes(String(flags.privacy)))
		usage("--privacy must be public, unlisted or private.");
	const body: Record<string, unknown> = {
		source_url: source,
		privacy: flags.privacy,
	};
	for (const [flag, field] of [
		["tags", "tags"],
		["collection", "collection_ids"],
		["type", "video_type"],
	] as const)
		if (flags[flag] !== undefined) body[field] = flags[flag];
	if (isRun) {
		for (const name of ["title", "description", "external-id", "language"])
			if (flags[name] !== undefined)
				usage(`--${name} is only supported for single videos.`);
		if (
			flags.limit !== undefined &&
			(!Number.isSafeInteger(flags.limit) || Number(flags.limit) < 1)
		)
			usage("--limit must be a positive integer.");
		if (
			flags.order !== undefined &&
			!["latest", "oldest"].includes(String(flags.order))
		)
			usage("--order must be latest or oldest.");
		const strategy = flags["published-at"] ?? "source";
		if (!["source", "now", "none"].includes(String(strategy)))
			usage(
				"--published-at must be source, now or none for playlist/channel runs.",
			);
		body.published_at_strategy = strategy;
		if (flags.limit !== undefined) body.limit = flags.limit;
		if (flags.order !== undefined) body.order = flags.order;
	} else {
		if (!youtube && !vimeo && !String(flags.title ?? "").trim())
			usage("--title is required for direct media URLs.");
		for (const name of ["limit", "order"])
			if (flags[name] !== undefined)
				usage(`--${name} is only supported for playlist/channel runs.`);
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
				new Date(`${value.slice(0, 10)}T00:00:00Z`)
					.toISOString()
					.slice(0, 10) !== value.slice(0, 10)
			)
				usage(
					"--published-at must be a valid ISO date or datetime with timezone.",
				);
			body.published_at = date.toISOString();
		}
	}
	return { path: isRun ? "/admin/imports" : "/admin/videos", body, isRun };
}

function resumeCommand(id: string, flags: Flags, single = false) {
	return `boldvideo ${single ? "videos get" : "import status"} ${quote(id)}${flags.profile ? ` --profile ${quote(String(flags.profile))}` : ""}`;
}

async function waitFor<T>(
	flags: Flags,
	resume: string,
	poll: () => Promise<T | undefined>,
): Promise<T> {
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
	// Enforce the wait deadline even during an in-flight request. Exiting this
	// CLI stops observation only; it never cancels the server-side import.
	const timeout = setTimeout(() => {
		process.exit(
			writeError(
				error(
					"timed_out",
					"Timed out waiting for imported videos to become ready.",
					resume,
					5,
				),
			),
		);
	}, Number(flags.timeout) * 1000);
	process.on("SIGINT", interrupted);
	try {
		for (;;) {
			const result = await poll();
			if (result !== undefined) return result;
			await sleep(Number(flags["poll-interval"]) * 1000);
		}
	} catch (cause) {
		if ((cause as CliError)?.code === "timed_out")
			throw { ...(cause as CliError), hint: resume };
		throw cause;
	} finally {
		clearTimeout(timeout);
		process.removeListener("SIGINT", interrupted);
	}
}

async function getVideo(key: string, id: string) {
	// TODO(bold-js): use the SDK when it exposes admin readiness and failure_reason.
	return importVideo(
		await request("GET", `/admin/videos/${encodeURIComponent(id)}`, { key }),
	);
}

function failed(video: Record<string, unknown>) {
	return (
		["failed", "error", "canceled", "cancelled"].includes(
			String(video.status),
		) || String(video.status).endsWith("_failed")
	);
}

async function waitSingle(
	key: string,
	video: Record<string, unknown>,
	flags: Flags,
) {
	const resume = resumeCommand(String(video.internal_id), flags, true);
	return waitFor(flags, resume, async () => {
		if (video.ready !== true && !failed(video))
			video = await getVideo(key, String(video.internal_id));
		if (failed(video))
			throw error(
				"import_failed",
				`Video import failed: ${video.failure_reason ?? video.status}.`,
				resume,
			);
		hint(`1/1 done, ${video.ready === true ? 1 : 0} ready, 0 failed`);
		return video.ready === true ? video : undefined;
	});
}

async function waitRun(key: string, id: string, flags: Flags) {
	const resume = resumeCommand(id, flags);
	let terminal: ImportRun | undefined;
	const pending = new Set<string>();
	let ready = 0;
	let failures = 0;
	let reason = "";
	return waitFor(flags, resume, async () => {
		if (!terminal) {
			const run = await getRun(key, id);
			if (["queued", "running"].includes(run.status)) {
				hint(
					`${run.counts.done}/${run.counts.total ?? "?"} done, 0 ready, ${run.counts.failed} failed`,
				);
				return;
			}
			terminal = run;
			failures = run.counts.failed + run.counts.canceled;
			let page = run;
			for (;;) {
				for (const video of page.videos) {
					if (video.internal_id) pending.add(video.internal_id);
					if (video.error && !reason)
						reason =
							typeof video.error === "string"
								? video.error
								: JSON.stringify(video.error);
				}
				if (page.meta.page >= page.meta.total_pages) break;
				const next = page.meta.page + 1;
				page = await getRun(key, id, next);
				if (page.meta.page !== next)
					throw error(
						"api_error",
						"The import API returned the wrong video page.",
						resume,
					);
			}
		}
		for (const videoId of pending) {
			const video = await getVideo(key, videoId);
			if (failed(video)) {
				failures++;
				reason ||= String(video.failure_reason ?? video.status);
				pending.delete(videoId);
			} else if (video.ready === true) {
				ready++;
				pending.delete(videoId);
			}
		}
		hint(
			`${terminal.counts.done}/${terminal.counts.total ?? "?"} done, ${ready} ready, ${failures} failed`,
		);
		if (pending.size) return;
		if (failures || terminal.status !== "completed")
			throw error(
				"import_failed",
				`Import ${terminal.status}: ${ready} ready, ${failures} failed.${reason ? ` ${reason}` : ""}`,
				resume,
			);
		return { ...terminal, readiness: { ready, failed: failures } };
	});
}

function showRun(
	run: ImportRun,
	ctx: Context,
	flags: Flags,
	extra: Record<string, unknown> = {},
) {
	const next =
		run.meta.page < run.meta.total_pages
			? `${resumeCommand(run.run_id, flags)} --page ${run.meta.page + 1}`
			: undefined;
	const data = { ...run, ...extra, ...(next ? { next } : {}) };
	output(
		data,
		videoText({
			run_id: run.run_id,
			status: run.status,
			counts: run.counts,
			status_url: run.status_url,
			...(run.readiness ? { readiness: run.readiness } : {}),
		}),
		ctx.json,
	);
	if (next) hint(`More results: ${next}`);
}

function sourceCommand(name: "youtube" | "url"): Command {
	return {
		name,
		summary:
			name === "youtube"
				? "Import a YouTube video, playlist or channel."
				: "Import a direct video URL or a YouTube/Vimeo video.",
		auth: "admin",
		write: true,
		args: [{ name: "source_url", description: "HTTP or HTTPS source URL." }],
		flags: metadataFlags,
		examples:
			name === "youtube"
				? [
						{
							cmd: "boldvideo import youtube https://www.youtube.com/@takimoore --wait",
							note: "Import a channel and wait for searchable transcripts.",
						},
						{
							cmd: "boldvideo import youtube https://www.youtube.com/watch?v=aqz-KE-bpKQ --tags coaching --privacy private",
							note: "Import one video with metadata.",
						},
					]
				: [
						{
							cmd: 'boldvideo import url https://cdn.example.com/paid-workshops.mp4 --title "Paid workshops" --collection workshops --wait',
							note: "Import a workshop into a collection and wait for readiness.",
						},
						{
							cmd: "boldvideo import url https://vimeo.com/76979871 --published-at 2026-10-18 --dry-run",
							note: "Preview a Vimeo import published at midnight UTC.",
						},
					],
		seeAlso: ["boldvideo import status --help", "boldvideo videos get --help"],
		async run(ctx, args, flags) {
			validateWait(flags);
			const plan = importRequest(args[0] as string, name === "youtube", flags);
			if (flags["dry-run"]) {
				output(
					{ dry_run: true, method: "POST", path: plan.path, body: plan.body },
					`POST ${plan.path}\n${JSON.stringify(plan.body, null, 2)}`,
					ctx.json,
				);
				return;
			}
			const { key } = ctx.credential as Credential;
			const response = await postImport(key, plan.path, plan.body);
			if (plan.isRun) {
				let run = importRun(response.data);
				const alreadyActive = response.status === 200;
				if (alreadyActive)
					hint(`Import ${run.run_id} is already active; reusing it.`);
				if (flags.wait) run = await waitRun(key, run.run_id, flags);
				showRun(run, ctx, flags, { already_active: alreadyActive });
			} else {
				let video = importVideo(response.data);
				const deduplicated =
					(response.data as { deduplicated?: boolean }).deduplicated === true;
				if (deduplicated)
					hint(
						"Source already imported; reusing the existing video (deduplicated).",
					);
				if (flags.wait) video = await waitSingle(key, video, flags);
				output({ ...video, deduplicated }, videoText(video), ctx.json);
			}
		},
	};
}

export const imports: Command = {
	name: "import",
	summary: "Import videos and wait until their content is searchable.",
	auth: "admin",
	write: true,
	examples: [
		{
			cmd: "boldvideo import youtube https://www.youtube.com/@takimoore --wait",
			note: "Import a YouTube channel and wait for readiness.",
		},
		{
			cmd: 'boldvideo import url https://cdn.example.com/paid-workshops.mp4 --title "Paid workshops"',
			note: "Submit one direct video URL.",
		},
	],
	seeAlso: ["boldvideo videos list"],
	subcommands: [
		sourceCommand("youtube"),
		sourceCommand("url"),
		{
			name: "status",
			summary: "Show an import run or resume waiting for all its videos.",
			auth: "admin",
			args: [{ name: "run_id", description: "Import run identifier." }],
			flags: [
				...waitFlags,
				{
					name: "page",
					type: "number",
					default: 1,
					description:
						"Run video page (positive integer); --wait checks every page.",
				},
			],
			examples: [
				{
					cmd: "boldvideo import status run_taki_20261019",
					note: "Inspect a channel import.",
				},
				{
					cmd: "boldvideo import status run_taki_20261019 --wait --timeout 7200",
					note: "Resume waiting for up to two hours.",
				},
			],
			seeAlso: ["boldvideo import cancel --help"],
			async run(ctx, args, flags) {
				validateWait(flags);
				if (!Number.isSafeInteger(flags.page) || Number(flags.page) < 1)
					usage("--page must be a positive integer.");
				const { key } = ctx.credential as Credential;
				const id = args[0] as string;
				showRun(
					flags.wait
						? await waitRun(key, id, flags)
						: await getRun(key, id, Number(flags.page)),
					ctx,
					flags,
				);
			},
		},
		{
			name: "cancel",
			summary: "Cancel an import run; an already-submitted batch drains.",
			auth: "admin",
			write: true,
			destructive: true,
			args: [{ name: "run_id", description: "Import run identifier." }],
			examples: [
				{
					cmd: "boldvideo import cancel run_taki_20261019 --yes",
					note: "Cancel further submission; the current batch drains.",
				},
				{
					cmd: "boldvideo import cancel run_taki_20261019 --dry-run --yes",
					note: "Preview cancellation without changing the run.",
				},
			],
			seeAlso: ["boldvideo import status --help"],
			async run(ctx, args, flags) {
				const path = `/admin/imports/${encodeURIComponent(args[0] as string)}/cancel`;
				if (flags["dry-run"]) {
					output(
						{ dry_run: true, method: "POST", path },
						`POST ${path}\nAn already-submitted batch drains.`,
						ctx.json,
					);
					return;
				}
				const response = await postImport(
					(ctx.credential as Credential).key,
					path,
				);
				const message =
					"Cancellation requested; an already-submitted batch drains.";
				output(
					{ run_id: args[0], message, data: response.data },
					message,
					ctx.json,
				);
			},
		},
	],
};
