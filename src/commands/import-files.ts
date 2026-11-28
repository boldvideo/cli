import { createHash } from "node:crypto";
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import type { Credential } from "../auth";
import { csvRows, csvText } from "../csv";
import { type CliError, error, writeError } from "../errors";
import { getVideo, resolveCollections } from "../import-api";
import { recordedAt } from "../media-date";
import { hint, output, table } from "../output";
import type { Command, Context, Flag, Flags } from "../spec";
import { limiter, uploadFile } from "../upload";
import {
	failed,
	metadataFlags,
	sharedFields,
	usage,
	validateWait,
	videoFields,
	waitFor,
} from "./import-shared";
import { videoText } from "./videos";

// Bold's own uploader accepts video/*. These are the extensions its MIME table
// and browsers file under video, without .ts: in a folder that is far more often
// TypeScript than an MPEG transport stream.
export const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|mpeg|mpg|ogv|3gp|3g2)$/i;
const MAP_COLUMNS = [
	"file",
	"title",
	"published_at",
	"type",
	"tags",
	"collection",
	"privacy",
	"external_id",
];
const RESULT_COLUMNS = ["status", "bold_id", "error_msg"];
/** Parts held in memory at once, across all files: 4 x 16 MiB. */
const PARTS_IN_FLIGHT = 4;

type Status =
	| "pending"
	| "uploaded"
	| "already_uploaded"
	| "failed"
	| "missing"
	| "skipped";

interface Item {
	/** Path relative to the folder, with forward slashes: how the map names it. */
	file: string;
	path?: string;
	size?: number;
	row?: Record<string, string>;
	body?: Record<string, unknown>;
	status: Status;
	video?: Record<string, unknown>;
	deduplicated?: boolean;
	error?: CliError;
	/** Why a map row was left out without being an error. */
	note?: string;
	/** Where a publication date taken from the file came from. */
	dated?: "recorded" | "modified";
}

/** A publication date worked out for one file: a value, or none on purpose. */
interface Dated {
	value?: string;
	from?: "recorded" | "modified";
}

const flag = (name: string, description?: string): Flag => {
	const found = metadataFlags.find((item) => item.name === name) as Flag;
	return description ? { ...found, description } : found;
};

// The same metadata flags as import url; only wording that speaks of URLs differs.
const fileFlags = (single: boolean): Flag[] => [
	...(single
		? [flag("title", "Title; defaults to the file name without its extension.")]
		: [
				{
					name: "recursive",
					short: "r",
					type: "boolean" as const,
					default: false,
					description: "Include files in subfolders.",
				},
				{
					name: "include",
					type: "list" as const,
					description:
						"Only files matching these globs (* ? **), comma-separated or repeated; replaces the video-extension filter.",
				},
				{
					name: "exclude",
					type: "list" as const,
					description:
						"Skip files matching these globs, comma-separated or repeated.",
				},
			]),
	flag("description", "Description for every uploaded video."),
	flag("tags"),
	flag("collection"),
	flag("type"),
	flag("privacy"),
	{
		...flag(
			"published-at",
			"Publication date: an ISO date or datetime with timezone; source for the file's own date (the recording time inside mp4/mov files, otherwise its last-modified time); now; or none. Without it the video stays unpublished.",
		),
		choices: ["source", "now", "none"],
	},
	...(single
		? [
				flag(
					"external-id",
					"Your own ID for the file; the upload resumes by it.",
				),
			]
		: []),
	flag("language", "Language code."),
	{
		name: "map",
		type: "string",
		complete: "file",
		description: `CSV with metadata per file. Columns: ${MAP_COLUMNS.join(", ")}.`,
	},
	{
		name: "results",
		type: "string",
		complete: "file",
		description:
			"Write the result CSV here: the map's columns plus status, bold_id, error_msg.",
	},
	{
		name: "concurrency",
		type: "number",
		default: 3,
		description: "Files uploaded at the same time (1 to 16).",
	},
	...metadataFlags.filter((item) =>
		["wait", "poll-interval", "timeout"].includes(item.name),
	),
];

const word = (value: string) =>
	/^[\w@%+=:,./-]+$/.test(value)
		? value
		: `'${value.replaceAll("'", "'\\''")}'`;
/** The command as typed: running it again continues the run. */
const rerun = () => `boldvideo ${process.argv.slice(2).map(word).join(" ")}`;

function glob(pattern: string): RegExp {
	const source = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*\/|\*\*|\*|\?/g, (token) =>
			token === "*"
				? "[^/]*"
				: token === "?"
					? "[^/]"
					: token === "**"
						? ".*"
						: "(?:.*/)?",
		);
	return new RegExp(`^${source}$`, "i");
}

// A pattern without a slash is about the file name, anywhere in the folder.
const matches = (patterns: string[], file: string) =>
	patterns.some((pattern) =>
		glob(pattern).test(pattern.includes("/") ? file : basename(file)),
	);

async function scan(root: string, flags: Flags) {
	const include = flags.include as string[] | undefined;
	const exclude = (flags.exclude as string[] | undefined) ?? [];
	const files: {
		file: string;
		path: string;
		size: number;
		modified: Date;
	}[] = [];
	const walk = async (folder: string) => {
		const entries = await readdir(folder, { withFileTypes: true });
		for (const entry of entries) {
			// Hidden files include macOS's ._name.mp4 companions, which are not videos.
			if (entry.name.startsWith(".")) continue;
			const path = join(folder, entry.name);
			if (entry.isDirectory()) {
				if (flags.recursive) await walk(path);
				continue;
			}
			const info = await stat(path).catch(() => undefined);
			if (!info?.isFile()) continue;
			const file = relative(root, path).split("\\").join("/");
			if (include ? !matches(include, file) : !VIDEO.test(file)) continue;
			if (matches(exclude, file)) continue;
			files.push({ file, path, size: info.size, modified: info.mtime });
		}
	};
	await walk(root);
	return files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

function readMap(path: string, root: string) {
	let rows: string[][];
	try {
		rows = csvRows(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
	} catch (cause) {
		return usage(
			`Could not read map '${path}'${cause instanceof Error && /CSV/.test(cause.message) ? `: ${cause.message}` : "."}`,
		);
	}
	const headers = (rows.shift() ?? []).map((header) => header.trim());
	const unknown = headers.filter(
		(header) => ![...MAP_COLUMNS, ...RESULT_COLUMNS].includes(header),
	);
	if (unknown.length)
		usage(
			`Unknown map column(s): ${unknown.join(", ")}. Allowed: ${MAP_COLUMNS.join(", ")}.`,
		);
	if (!headers.includes("file") || new Set(headers).size !== headers.length)
		usage("The map needs a file column, and each column only once.");
	const seen = new Set<string>();
	const records = rows.map((cells, index) => {
		if (cells.length > headers.length)
			usage(`Map row ${index + 2} has more cells than the header.`);
		const row = Object.fromEntries(
			headers.map((header, i) => [header, (cells[i] ?? "").trim()]),
		);
		const named = row.file ?? "";
		if (!named) usage(`Map row ${index + 2} has no file.`);
		const file = (isAbsolute(named) ? relative(root, named) : named)
			.split("\\")
			.join("/")
			.replace(/^\.\//, "");
		if (seen.has(file)) usage(`The map lists '${file}' more than once.`);
		seen.add(file);
		return { file, row };
	});
	// A result CSV can be fed back in as the next map; its result columns are rewritten.
	return {
		headers: headers.filter((header) => !RESULT_COLUMNS.includes(header)),
		records,
	};
}

const list = (cell: string) =>
	cell
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);

/** The start request for one file: command-line defaults under its map row. */
function startBody(
	item: { file: string; path: string; size: number },
	row: Record<string, string> | undefined,
	flags: Flags,
	collections: Map<string, string>,
	dated?: Dated,
) {
	const own: Flags = { ...flags };
	if (row?.title) own.title = row.title;
	if (row?.published_at) own["published-at"] = row.published_at;
	// source, now and none were worked out for this file before it got here.
	if (dated) own["published-at"] = dated.value;
	if (row?.type) own.type = row.type;
	if (row?.tags) own.tags = list(row.tags);
	if (row?.privacy) own.privacy = row.privacy;
	if (row?.external_id) own["external-id"] = row.external_id;
	const names = row?.collection
		? list(row.collection)
		: (flags.collection as string[] | undefined);
	if (names)
		own.collection = names.map((name) => collections.get(name) ?? name);
	try {
		return {
			filename: basename(item.path),
			size: item.size,
			...sharedFields(own),
			...videoFields(own),
			// The server finds a started upload again by this ID. Without one of your
			// own it comes from the file's place in the folder and its size.
			external_id:
				own["external-id"] ??
				`cli-${createHash("sha256").update(`${item.file}\n${item.size}`).digest("hex").slice(0, 24)}`,
		};
	} catch (cause) {
		const failure = cause as CliError;
		if (row && failure?.code === "usage_error")
			throw {
				...failure,
				message: `Map row for '${item.file}': ${failure.message.replace(/^--([a-z-]+)/, (_, name) => name.replaceAll("-", "_"))}`,
			};
		throw cause;
	}
}

function resultsPath(flags: Flags, single: boolean) {
	if (flags.results !== undefined) return String(flags.results);
	// One file out of a shared map would overwrite the whole run's results.
	if (flags.map === undefined || single) return;
	return `${String(flags.map).replace(/\.csv$/i, "")}.results.csv`;
}

function writeResults(path: string, headers: string[], items: Item[]) {
	const rows = items.map((item) => [
		...headers.map((header) =>
			header === "file"
				? (item.row?.file ?? item.file)
				: (item.row?.[header] ?? ""),
		),
		item.status,
		String(item.video?.internal_id ?? ""),
		item.error?.message ?? item.note ?? "",
	]);
	// Replaced in one step, so a reader never sees half a file.
	writeFileSync(
		`${path}.tmp`,
		csvText([[...headers, ...RESULT_COLUMNS], ...rows]),
	);
	renameSync(`${path}.tmp`, path);
}

const asError = (cause: unknown): CliError =>
	(cause as CliError)?.code
		? (cause as CliError)
		: error(
				"internal_error",
				cause instanceof Error
					? cause.message
					: "An unexpected error occurred.",
				"boldvideo import dir --help",
			);

const size = (bytes: number) =>
	bytes >= 1e9
		? `${(bytes / 1e9).toFixed(1)} GB`
		: `${(bytes / 1e6).toFixed(1)} MB`;

function view(item: Item) {
	const { exitCode: _, ...failure } = item.error ?? ({} as CliError);
	return {
		file: item.file,
		ok: !item.error,
		status: item.status,
		...(item.note ? { note: item.note } : {}),
		...(item.video
			? { video: { ...item.video, deduplicated: item.deduplicated === true } }
			: {}),
		...(item.error
			? {
					error: {
						...failure,
						message: failure.message.replace(/[\r\n]+/g, " "),
					},
				}
			: {}),
	};
}

async function run(
	single: boolean,
	ctx: Context,
	args: string[],
	flags: Flags,
) {
	validateWait(flags);
	const concurrency = Number(flags.concurrency);
	if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16)
		usage("--concurrency must be a whole number from 1 to 16.");
	const target = resolve(args[0] as string);
	const info = statSync(target, { throwIfNoEntry: false });
	if (!info) usage(`Nothing at '${args[0]}'. Check the path.`);
	if (single ? !info?.isFile() : !info?.isDirectory())
		usage(
			single
				? `'${args[0]}' is not a file. For a folder: boldvideo import dir.`
				: `'${args[0]}' is not a folder. For one file: boldvideo import file.`,
		);
	const root = single ? dirname(target) : target;
	const found = single
		? [
				{
					file: basename(target),
					path: target,
					size: info?.size ?? 0,
					modified: info?.mtime ?? new Date(),
				},
			]
		: await scan(root, flags);
	const map =
		flags.map === undefined ? undefined : readMap(String(flags.map), root);

	const { key } = ctx.credential as Credential;
	const names = [
		...new Set([
			...((flags.collection as string[] | undefined) ?? []),
			...(map?.records.flatMap(({ row }) => list(row.collection ?? "")) ?? []),
		]),
	];
	const ids = names.length ? await resolveCollections(key, names) : [];
	const collections = new Map(names.map((name, i) => [name, ids[i] as string]));

	// A date word in the map or on the command line becomes a date per file.
	const started = new Date().toISOString();
	const rows = new Map(map?.records.map(({ file, row }) => [file, row]));
	const dates = new Map<string, Dated>();
	for (const entry of found) {
		const wanted = rows.get(entry.file)?.published_at || flags["published-at"];
		if (wanted === "now") dates.set(entry.file, { value: started });
		else if (wanted === "none") dates.set(entry.file, {});
		else if (wanted === "source") {
			const recorded = await recordedAt(entry.path);
			dates.set(entry.file, {
				value: (recorded ?? entry.modified).toISOString(),
				from: recorded ? "recorded" : "modified",
			});
		}
	}

	// Map rows come first and in their order, then the files the map does not name.
	const onDisk = new Map(found.map((entry) => [entry.file, entry]));
	const items: Item[] = [];
	for (const { file, row } of map?.records ?? []) {
		const entry = onDisk.get(file);
		onDisk.delete(file);
		if (entry) {
			items.push({
				...entry,
				row,
				body: startBody(entry, row, flags, collections, dates.get(file)),
				dated: dates.get(file)?.from,
				status: "pending",
			});
		} else if (single) {
			// A shared map names many files; this command is about one of them.
		} else if (
			statSync(join(root, file), { throwIfNoEntry: false })?.isFile()
		) {
			items.push({
				file,
				row,
				status: "skipped",
				note: "On disk but not selected; check --recursive, --include and --exclude.",
			});
		} else {
			items.push({
				file,
				row,
				status: "missing",
				error: error(
					"not_found",
					`'${file}' is in the map but not in the folder.`,
					"boldvideo import dir --help",
					4,
				),
			});
		}
	}
	for (const entry of onDisk.values())
		items.push({
			...entry,
			body: startBody(
				entry,
				undefined,
				flags,
				collections,
				dates.get(entry.file),
			),
			dated: dates.get(entry.file)?.from,
			status: "pending",
		});
	for (const item of items)
		if (item.status === "pending" && item.size === 0) {
			item.status = "failed";
			item.error = error(
				"validation_error",
				"The file is empty.",
				"boldvideo import dir --help",
				2,
			);
		}
	if (!items.some((item) => item.path))
		usage(
			single
				? `'${args[0]}' is not a file.`
				: `No video files in '${args[0]}'. Subfolders need --recursive; other file types need --include.`,
		);

	const finish = (data: unknown, text: string) => {
		const [first] = items;
		const broken = items.filter((item) => item.error);
		if (single && first?.error) throw first.error;
		output(data, text, ctx.json);
		if (broken.length)
			throw error(
				"bulk_failed",
				`${broken.length} of ${items.length} file(s) failed: ${broken.map((item) => item.file).join(", ")}.`,
				flags["dry-run"] ? "boldvideo import dir --help" : rerun(),
			);
	};

	if (flags["dry-run"]) {
		const plan = items.map((item) => ({
			file: item.file,
			ok: !item.error,
			action: item.status === "pending" ? ("upload" as const) : item.status,
			...(item.size === undefined ? {} : { size: item.size }),
			...(item.status === "pending" ? { body: item.body } : {}),
			...(item.dated ? { published_at_from: item.dated } : {}),
			...(item.note ? { note: item.note } : {}),
			...(item.error ? { error: view(item).error } : {}),
		}));
		const [only] = plan;
		finish(
			single
				? {
						dry_run: true,
						method: "POST",
						path: "/admin/uploads",
						body: only?.body,
						...(only?.published_at_from
							? { published_at_from: only.published_at_from }
							: {}),
					}
				: { dry_run: true, items: plan },
			single
				? `POST /admin/uploads\n${JSON.stringify(only?.body, null, 2)}`
				: table(
						plan.map((entry) => ({
							file: entry.file,
							action: entry.action,
							size: entry.size === undefined ? "" : size(entry.size),
							title: entry.body?.title ?? "",
							published: entry.body?.published_at
								? `${entry.body.published_at}${entry.published_at_from ? ` (${entry.published_at_from})` : ""}`
								: "",
							external_id: entry.body?.external_id ?? "",
						})),
					),
		);
		return;
	}

	const results = resultsPath(flags, single);
	const headers = map?.headers ?? ["file"];
	const save = () => results && writeResults(results, headers, items);
	const todo = items.filter((item) => item.status === "pending");
	const total = todo.reduce((sum, item) => sum + (item.size ?? 0), 0);
	const controller = new AbortController();
	const interrupted = () => {
		controller.abort();
		save();
		writeError(
			error(
				"interrupted",
				"Stopped. Parts already sent are kept; the same command continues from them.",
				rerun(),
			),
		);
		process.exit(130);
	};
	process.on("SIGINT", interrupted);
	try {
		save();
		const slots = limiter(PARTS_IN_FLIGHT);
		let sent = 0;
		let reported = Date.now();
		let finished = 0;
		const queue = [...todo];
		await Promise.all(
			Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
				for (let item = queue.shift(); item; item = queue.shift()) {
					try {
						const uploaded = await uploadFile({
							key,
							path: item.path as string,
							size: item.size as number,
							body: item.body as Record<string, unknown>,
							signal: controller.signal,
							slots,
							onBytes(bytes) {
								sent += bytes;
								if (Date.now() - reported < 5000) return;
								reported = Date.now();
								hint(`${size(sent)} of ${size(total)} sent`);
							},
						});
						item.video = uploaded.video;
						item.deduplicated = uploaded.deduplicated;
						item.status = uploaded.sent ? "uploaded" : "already_uploaded";
					} catch (cause) {
						item.status = "failed";
						item.error = asError(cause);
					}
					hint(
						`${++finished}/${todo.length} ${item.file}: ${item.error ? `${item.error.code}: ${item.error.message}` : item.status.replace("_", " ")}`,
					);
					save();
				}
			}),
		);
	} finally {
		process.removeListener("SIGINT", interrupted);
	}

	if (flags.wait) {
		const waiting = new Set(items.filter((item) => item.video));
		const settle = (item: Item, video: Record<string, unknown>) => {
			item.video = video;
			if (!failed(video) && video.ready !== true) return;
			waiting.delete(item);
			if (!failed(video)) return;
			item.status = "failed";
			item.error = error(
				"import_failed",
				`Video import failed: ${video.failure_reason ?? video.status}.`,
				`boldvideo import status ${video.internal_id}`,
			);
		};
		try {
			await waitFor(flags, rerun(), async (signal) => {
				for (const item of [...waiting])
					settle(
						item,
						await getVideo(key, String(item.video?.internal_id), signal),
					);
				hint(
					`${items.length - waiting.size}/${items.length} done, ${items.filter((item) => item.video?.ready === true).length} ready, ${items.filter((item) => item.error).length} failed`,
				);
				return waiting.size ? undefined : true;
			});
		} catch (cause) {
			// The uploads are in. Whatever is still processing is reported per file.
			for (const item of waiting) {
				item.status = "failed";
				item.error = {
					...asError(cause),
					hint: `boldvideo import status ${item.video?.internal_id} --wait`,
				};
			}
		}
		save();
	}

	const [first] = items;
	if (results) hint(`Results: ${results}`);
	finish(
		single
			? { ...first?.video, deduplicated: first?.deduplicated === true }
			: { items: items.map(view), ...(results ? { results } : {}) },
		single
			? videoText(first?.video ?? {})
			: table(
					items.map((item) => ({
						file: item.file,
						status: item.status,
						id: item.video?.internal_id ?? "",
						detail: item.error
							? `${item.error.code}: ${item.error.message}`
							: (item.note ?? item.video?.status ?? ""),
					})),
				),
	);
}

const resume =
	"Running the same command again continues an interrupted run: files already in are left alone, and a file stopped halfway sends only its missing parts. The server finds a file again by its external_id; without one from the map the CLI derives it from the path inside the folder and the file's size, so a renamed, moved or changed file uploads as a new video.";

export const fileCommands: Command[] = [
	{
		name: "dir",
		summary: "Upload every video file in a folder.",
		description: `Takes mp4, m4v, mov, webm, mkv, avi, wmv, mpeg, mpg, ogv, 3gp and 3g2 files; --include names others. A --map CSV sets metadata per file, with the metadata flags as defaults for whatever it leaves out (its published_at column takes the same values as --published-at, including source); a file in the map but not in the folder is an error. With --map, a result CSV is written next to it as <map name>.results.csv and rewritten as each file finishes. ${resume} One file failing does not stop the rest; the exit code is 1 if any failed.`,
		auth: "admin",
		write: true,
		args: [
			{
				name: "path",
				description: "Folder with the video files.",
				complete: "file",
			},
		],
		flags: fileFlags(false),
		examples: [
			{
				cmd: "boldvideo import dir ./recordings --wait",
				note: "Upload a folder and wait until every video is searchable.",
			},
			{
				cmd: "boldvideo import dir ./recordings --map ./recordings/meta.csv --dry-run",
				note: "Check a metadata map against the folder before uploading.",
			},
		],
		seeAlso: ["boldvideo import file --help", "boldvideo import status --help"],
		run: (ctx, args, flags) => run(false, ctx, args, flags),
	},
	{
		name: "file",
		summary: "Upload one video file.",
		description: `Any file type is sent as given. With --map, the row whose file is this file's name applies. ${resume}`,
		auth: "admin",
		write: true,
		args: [{ name: "path", description: "The video file.", complete: "file" }],
		flags: fileFlags(true),
		examples: [
			{
				cmd: 'boldvideo import file ./recordings/group-call-12.mp4 --title "Group call 12: pricing" --wait',
				note: "Upload one recording and wait until it is searchable.",
			},
			{
				cmd: "boldvideo import file ./recordings/group-call-12.mp4 --privacy private --published-at 2026-11-20 --dry-run",
				note: "Preview the upload of a members-only recording.",
			},
		],
		seeAlso: ["boldvideo import dir --help", "boldvideo videos get --help"],
		run: (ctx, args, flags) => run(true, ctx, args, flags),
	},
];
