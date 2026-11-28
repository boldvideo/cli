import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Credential } from "../auth";
import { type CliError, error } from "../errors";
import {
	getRun,
	getVideo,
	type ImportRun,
	importResponse,
	importRun,
	importVideo,
	resolveCollections,
} from "../import-api";
import { hint, output, table } from "../output";
import type { Command, Flags } from "../spec";
import { fileCommands, VIDEO } from "./import-files";
import {
	failed,
	metadataFlags,
	quote,
	sharedFields,
	usage,
	validateWait,
	videoFields,
	waitFlags,
	waitFor,
} from "./import-shared";
import { videoText } from "./videos";

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
	const body: Record<string, unknown> = {
		source_url: source,
		...sharedFields(flags),
	};
	if (isRun) {
		for (const name of ["title", "description", "external-id", "language"])
			if (flags[name] !== undefined)
				usage(`--${name} is only supported for single videos.`);
		if (
			flags.max !== undefined &&
			(!Number.isSafeInteger(flags.max) || Number(flags.max) < 1)
		)
			usage("--max must be a positive integer.");
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
		if (flags.max !== undefined) body.limit = flags.max;
		if (flags.order !== undefined) body.order = flags.order;
	} else {
		if (!youtube && !vimeo && !String(flags.title ?? "").trim())
			usage("--title is required for direct media URLs.");
		for (const name of ["max", "order"])
			if (flags[name] !== undefined)
				usage(`--${name} is only supported for playlist/channel runs.`);
		Object.assign(body, videoFields(flags));
	}
	return { path: isRun ? "/admin/imports" : "/admin/videos", body, isRun };
}

function resumeCommand(id: string, flags: Flags) {
	return `boldvideo import status ${quote(id)}${flags.profile ? ` --profile ${quote(String(flags.profile))}` : ""}`;
}

async function waitSingle(
	key: string,
	video: Record<string, unknown>,
	flags: Flags,
) {
	const resume = resumeCommand(String(video.internal_id), flags);
	return waitFor(flags, resume, async (signal) => {
		if (video.ready !== true && !failed(video))
			video = await getVideo(key, String(video.internal_id), signal);
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
	return waitFor(flags, resume, async (signal) => {
		if (!terminal) {
			const run = await getRun(key, id, 1, signal);
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
				page = await getRun(key, id, next, signal);
				if (page.meta.page !== next)
					throw error(
						"api_error",
						"The import API returned the wrong video page.",
						resume,
					);
			}
		}
		for (const videoId of pending) {
			const video = await getVideo(key, videoId, signal);
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

function runResult(
	run: ImportRun,
	flags: Flags,
	extra: Record<string, unknown> = {},
) {
	const next =
		run.meta.page < run.meta.total_pages
			? `${resumeCommand(run.run_id, flags)} --page ${run.meta.page + 1}`
			: undefined;
	const data = { ...run, ...extra, ...(next ? { next } : {}) };
	if (next) hint(`More results: ${next}`);
	return {
		data,
		text: videoText({
			run_id: run.run_id,
			status: run.status,
			counts: run.counts,
			status_url: run.status_url,
			...(run.readiness ? { readiness: run.readiness } : {}),
		}),
	};
}

async function sourceUrls(args: string[], flags: Flags) {
	if (args[0] !== undefined) {
		if (flags.from !== undefined)
			usage("Choose a positional URL or --from, not both.");
		return { sources: [args[0]], bulk: false };
	}
	let text = "";
	if (flags.from !== undefined) {
		try {
			text = await readFile(String(flags.from), "utf8");
		} catch {
			usage(`Could not read URL file '${flags.from}'.`);
		}
	} else {
		if (process.stdin.isTTY)
			usage("Supply a URL, pipe URLs on stdin, or use --from <file>.");
		process.stdin.setEncoding("utf8");
		for await (const chunk of process.stdin) text += chunk;
	}
	const sources = text
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (!sources.length) usage("No URLs were supplied.");
	return { sources, bulk: true };
}

async function importSource(
	key: string,
	source: string,
	youtubeOnly: boolean,
	flags: Flags,
) {
	const plan = importRequest(source, youtubeOnly, flags);
	if (flags["dry-run"])
		return {
			isRun: plan.isRun,
			data: { dry_run: true, method: "POST", path: plan.path, body: plan.body },
			text: `POST ${plan.path}\n${JSON.stringify(plan.body, null, 2)}`,
		};
	const response = await importResponse("POST", key, plan.path, plan.body);
	if (plan.isRun) {
		let run = importRun(response.data);
		const alreadyActive = response.status === 200;
		if (alreadyActive)
			hint(`Import ${run.run_id} is already active; reusing it.`);
		if (flags.wait) run = await waitRun(key, run.run_id, flags);
		return {
			isRun: true,
			...runResult(run, flags, { already_active: alreadyActive }),
		};
	}
	let video = importVideo(response.data);
	const deduplicated =
		(response.data as { deduplicated?: boolean }).deduplicated === true;
	if (deduplicated)
		hint("Source already imported; reusing the existing video (deduplicated).");
	if (flags.wait) video = await waitSingle(key, video, flags);
	return {
		isRun: false,
		data: { ...video, deduplicated },
		text: videoText(video),
	};
}

type BulkResult =
	| {
			source_url: string;
			ok: true;
			video?: Record<string, unknown>;
			run?: Record<string, unknown>;
			dry_run?: boolean;
	  }
	| { source_url: string; ok: false; error: Omit<CliError, "exitCode"> };

function sourceCommand(name: "youtube" | "url"): Command {
	return {
		name,
		...(name === "youtube" ? { aliases: ["yt"] } : {}),
		summary:
			name === "youtube"
				? "Import a YouTube video, playlist or channel."
				: "Import a direct video URL or a YouTube/Vimeo video.",
		auth: "admin",
		write: true,
		args: [
			{
				name: "source_url",
				required: false,
				description:
					"HTTP or HTTPS source URL; otherwise read one URL per line from stdin or --from.",
			},
		],
		flags: metadataFlags,
		examples:
			name === "youtube"
				? [
						{
							cmd: "boldvideo import youtube https://www.youtube.com/watch?v=aqz-KE-bpKQ --wait",
							note: "Import one video and wait for a searchable transcript.",
						},
						{
							cmd: 'boldvideo import youtube https://www.youtube.com/@yourchannel --collection "Coaching"',
							note: "Import a channel into a named collection.",
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
			const { sources, bulk } = await sourceUrls(args, flags);
			const { key } = ctx.credential as Credential;
			if (flags.collection)
				flags = {
					...flags,
					collection: await resolveCollections(
						key,
						flags.collection as string[],
					),
				};
			if (!bulk) {
				const result = await importSource(
					key,
					sources[0] as string,
					name === "youtube",
					flags,
				);
				output(result.data, result.text, ctx.json);
				return;
			}
			const results: BulkResult[] = [];
			for (const source of sources) {
				try {
					const result = await importSource(
						key,
						source,
						name === "youtube",
						flags,
					);
					results.push({
						source_url: source,
						ok: true,
						...(flags["dry-run"]
							? result.data
							: result.isRun
								? { run: result.data }
								: { video: result.data }),
					});
				} catch (cause) {
					const failure = (cause as CliError)?.code
						? (cause as CliError)
						: error(
								"internal_error",
								cause instanceof Error
									? cause.message
									: "An unexpected error occurred.",
								`boldvideo import ${name} --help`,
							);
					const { exitCode: _, ...fields } = failure;
					results.push({
						source_url: source,
						ok: false,
						error: {
							...fields,
							message: fields.message.replace(/[\r\n]+/g, " "),
						},
					});
				}
			}
			output(
				results,
				flags["dry-run"]
					? results.map((result) => videoText(result)).join("\n\n")
					: table(
							results.map((result) => ({
								source_url: result.source_url,
								ok: result.ok,
								id: result.ok
									? (result.video?.internal_id ?? result.run?.run_id ?? "")
									: "",
								status: result.ok
									? (result.video?.status ?? result.run?.status ?? "dry-run")
									: `${result.error.code}: ${result.error.message}`,
							})),
						),
				ctx.json,
			);
			const failures = results.filter((result) => !result.ok);
			if (failures.length)
				throw error(
					"bulk_failed",
					`${failures.length} import operation(s) failed.`,
					`boldvideo import ${name} --help`,
				);
		},
	};
}

export const imports: Command = {
	name: "import",
	aliases: ["i"],
	summary: "Import videos and wait until their content is searchable.",
	description:
		"Name the source and import picks the command: a folder runs import dir, a file runs import file, and an http(s) URL runs import url, each with that command's flags. Naming the command yourself does the same thing and is the form to use in scripts, where the output shape should not depend on what a path turns out to be. A path that is also a command name (status, dir) needs ./ in front.",
	auth: "admin",
	write: true,
	route(word) {
		if (/^https?:\/\//i.test(word)) return "url";
		const found = statSync(word, { throwIfNoEntry: false });
		if (found?.isDirectory()) return "dir";
		if (found?.isFile()) return "file";
		// Nothing is there, but it is written like a path: the file commands say
		// so, which helps more than calling a path an unknown command.
		if (/[\\/]/.test(word) || /^[.~]/.test(word) || VIDEO.test(word))
			return /[\\/]$/.test(word) ? "dir" : "file";
	},
	examples: [
		{
			cmd: "boldvideo import youtube https://www.youtube.com/@yourchannel --wait",
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
		...fileCommands,
		{
			name: "status",
			aliases: ["st"],
			summary: "Show a video or import run, or resume waiting for readiness.",
			auth: "admin",
			args: [
				{
					name: "id-or-run",
					description: "Video UUID, hashid, slug or import run identifier.",
				},
			],
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
					cmd: "boldvideo import status run_demo_20261019",
					note: "Inspect a channel import.",
				},
				{
					cmd: "boldvideo import status run_demo_20261019 --wait --timeout 7200",
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
				let run: ImportRun;
				try {
					run = await getRun(key, id, Number(flags.page));
				} catch (cause) {
					if ((cause as CliError)?.code !== "not_found") throw cause;
					let video = await getVideo(key, id);
					if (flags.wait) video = await waitSingle(key, video, flags);
					output(video, videoText(video), ctx.json);
					return;
				}
				const result = runResult(
					flags.wait ? await waitRun(key, id, flags) : run,
					flags,
				);
				output(result.data, result.text, ctx.json);
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
					cmd: "boldvideo import cancel run_demo_20261019 --yes",
					note: "Cancel further submission; the current batch drains.",
				},
				{
					cmd: "boldvideo import cancel run_demo_20261019 --dry-run --yes",
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
				const response = await importResponse(
					"POST",
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
