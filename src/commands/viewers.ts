import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { apiUrl, request } from "../api";
import { type Credential, identity } from "../auth";
import { apiError, type CliError, error } from "../errors";
import { hint, output, outputList, table } from "../output";
import type { Command, Context, Flags } from "../spec";
import { syncRequest } from "./viewers-sync-request";

type RecordData = Record<string, unknown>;
type Envelope<T> = { data: T };
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const viewerArg = [
	{ name: "viewer", description: "Viewer UUID, email or external ID." },
];

async function keyFor(ctx: Context, memory = false): Promise<string> {
	const { key } = ctx.credential as Credential;
	const me = await identity(key).catch(() => undefined);
	for (const feature of memory
		? (["viewers", "viewer_memory"] as const)
		: (["viewers"] as const)) {
		if (me?.features[feature] === false)
			throw error(
				"not_permitted",
				`The ${feature} feature is disabled for this account.`,
				`Enable ${feature === "viewers" ? "Viewers" : "Viewer Memory"} in Bold Settings, then run boldvideo whoami.`,
				3,
			);
	}
	return key;
}

async function sdkRead(
	key: string,
	read: (
		viewers: ReturnType<
			typeof import("@boldvideo/bold-js").createClient
		>["viewers"],
	) => Promise<{ data: unknown }>,
): Promise<unknown> {
	const { createClient } = await import("@boldvideo/bold-js");
	try {
		return (
			await read(
				createClient(key, {
					baseURL: `${apiUrl()}/`,
					headers: { Authorization: `Bearer ${key}` },
				}).viewers,
			)
		).data;
	} catch (cause) {
		const failure = cause as {
			status?: number;
			originalError?: {
				response?: { data?: unknown; headers?: Record<string, string> };
			};
		};
		const response = failure.originalError?.response;
		throw apiError(
			failure.status ?? 500,
			response?.data,
			response?.headers?.["x-request-id"],
			"boldvideo whoami",
		);
	}
}

// The CLI exposes API field names; only normalize record keys, never user traits.
function apiRecord(data: unknown): RecordData {
	return Object.fromEntries(
		Object.entries(data as RecordData).map(([name, value]) => [
			name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
			value,
		]),
	);
}

async function resolveViewer(key: string, value: string): Promise<RecordData> {
	const uuid =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			value,
		);
	return apiRecord(
		await sdkRead(key, (viewers) =>
			uuid
				? viewers.get(encodeURIComponent(value))
				: viewers.lookup(
						value.includes("@") ? { email: value } : { externalId: value },
					),
		),
	);
}

// CSV quoting follows RFC 4180, including escaped quotes and embedded newlines.
function csv(text: string): RecordData[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	let closed = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
				closed = true;
			} else cell += char;
		} else if (char === "," || char === "\n" || char === "\r") {
			row.push(cell);
			cell = "";
			closed = false;
			if (char !== ",") {
				if (char === "\r" && text[i + 1] === "\n") i++;
				if (row.some((value) => value !== "")) rows.push(row);
				row = [];
			}
		} else if (char === '"' && !cell && !closed) quoted = true;
		else if (closed || char === '"') throw new Error("Invalid CSV quoting.");
		else cell += char;
	}
	if (quoted) throw new Error("Unclosed CSV quote.");
	row.push(cell);
	if (row.some((value) => value !== "")) rows.push(row);
	const headers = rows.shift() ?? [];
	if (
		!headers.includes("external_id") ||
		new Set(headers).size !== headers.length ||
		headers.includes("")
	)
		throw new Error("CSV needs unique column names including external_id.");
	return rows.map((values) => {
		if (values.length !== headers.length)
			throw new Error("CSV row has the wrong number of columns.");
		return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
	});
}

async function sync(ctx: Context, args: string[], flags: Flags): Promise<void> {
	let rows: unknown[];
	try {
		const file = args[0] as string;
		const text = readFileSync(file === "-" ? 0 : file, "utf8").replace(
			/^\uFEFF/,
			"",
		);
		const jsonInput =
			file.endsWith(".json") || (file === "-" && /^\s*[[{]/.test(text));
		const data = jsonInput ? JSON.parse(text) : csv(text);
		if (!Array.isArray(data))
			throw new Error("JSON input must be an array of viewer rows.");
		rows = data;
	} catch (cause) {
		throw error(
			"usage_error",
			cause instanceof Error ? cause.message : "Could not read sync input.",
			"boldvideo viewers sync --help",
			2,
		);
	}
	const key = await keyFor(ctx);
	const present = new Set(
		rows.map((row) => (row as RecordData | null)?.external_id),
	);
	const prune: RecordData[] = [];
	if (flags.prune) {
		// Snapshot every page before writes: deleting while paging can skip viewers.
		for (let page = 1; ; page++) {
			const result = (await syncRequest(key, "GET", "/viewers", undefined, {
				page: String(page),
				page_size: "100",
			})) as Envelope<RecordData[]> & {
				meta: { page: number; total_pages: number };
			};
			prune.push(
				...result.data.filter((viewer) => !present.has(viewer.external_id)),
			);
			if (result.meta.page >= result.meta.total_pages) break;
		}
	}
	const results: RecordData[] = new Array(rows.length);
	// Hash each external ID into one sequential lane: duplicates cannot race a create.
	const lanes: number[][] = Array.from({ length: 4 }, () => []);
	rows.forEach((row, index) => {
		const externalId = (row as RecordData | null)?.external_id;
		const id = typeof externalId === "string" ? externalId : "";
		let hash = 0;
		for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
		lanes[hash % 4]?.push(index);
	});
	const planned = new Map<string, RecordData>();
	await Promise.all(
		lanes.map(async (lane) => {
			for (const index of lane) {
				let row = rows[index] as RecordData;
				const externalId = row?.external_id;
				try {
					if (
						!row ||
						Array.isArray(row) ||
						typeof row !== "object" ||
						typeof externalId !== "string" ||
						!externalId.trim()
					)
						throw error(
							"usage_error",
							"Each row requires a nonempty external_id string.",
							"boldvideo viewers sync --help",
							2,
						);
					const { external_id, email, name, ...traits } = row;
					row = {
						external_id,
						...(Object.hasOwn(row, "email") ? { email } : {}),
						...(Object.hasOwn(row, "name") ? { name } : {}),
						...(Object.keys(traits).length ? { traits } : {}),
					};
					let existing = flags["dry-run"] ? planned.get(externalId) : undefined;
					if (!existing) {
						try {
							existing = (
								(await syncRequest(key, "GET", "/viewers/lookup", undefined, {
									external_id: externalId,
								})) as Envelope<RecordData>
							).data;
						} catch (cause) {
							if ((cause as CliError).code !== "not_found") throw cause;
						}
					}
					const action = !existing
						? "created"
						: Object.entries(row).some(
									([field, value]) =>
										!isDeepStrictEqual(value, existing?.[field]),
								)
							? "updated"
							: "unchanged";
					if (action !== "unchanged" && !flags["dry-run"])
						await syncRequest(
							key,
							existing ? "PATCH" : "POST",
							existing
								? `/viewers/${encodeURIComponent(String(existing.id))}`
								: "/viewers",
							{ viewer: row },
						);
					if (flags["dry-run"])
						planned.set(externalId, { ...existing, ...row });
					results[index] = { external_id: externalId, action };
				} catch (cause) {
					const failure =
						cause && typeof cause === "object" && "exitCode" in cause
							? (cause as CliError)
							: error(
									"api_error",
									cause instanceof Error
										? cause.message
										: "Could not sync this viewer.",
									"boldvideo viewers sync --help",
								);
					results[index] = {
						external_id: externalId ?? null,
						action: "failed",
						error: {
							code: failure.code,
							message: failure.message.replace(/[\r\n]+/g, " "),
							hint: failure.hint,
							docs: failure.docs,
							...(failure.request_id ? { request_id: failure.request_id } : {}),
						},
					};
				}
			}
		}),
	);
	if (flags.prune && results.some((row) => row.action === "failed")) {
		hint(
			"Prune skipped because one or more sync rows failed. Fix the failed rows before rerunning boldvideo viewers sync --prune.",
		);
	} else {
		for (const viewer of prune) {
			try {
				if (!flags["dry-run"])
					await syncRequest(
						key,
						"DELETE",
						`/viewers/${encodeURIComponent(String(viewer.id))}`,
					);
				results.push({
					external_id: viewer.external_id ?? null,
					id: viewer.id,
					action: "pruned",
				});
			} catch (cause) {
				const { exitCode: _exit, ...failure } = cause as CliError;
				results.push({
					external_id: viewer.external_id ?? null,
					id: viewer.id,
					action: "failed",
					error: {
						...failure,
						message: failure.message.replace(/[\r\n]+/g, " "),
					},
				});
			}
		}
	}
	const summary = [
		"created",
		"updated",
		"unchanged",
		...(flags.prune ? ["pruned"] : []),
		"failed",
	]
		.map(
			(action) =>
				`${results.filter((row) => row.action === action).length} ${action}`,
		)
		.join(", ");
	output(
		results,
		`${table(results, ["external_id", "action", ...(flags.prune ? ["id"] : [])])}\n${flags["dry-run"] ? "Dry run: " : ""}${summary}.`,
		ctx.json,
	);
	if (results.some((row) => row.action === "failed")) process.exitCode = 1;
}

async function memory(
	ctx: Context,
	args: string[],
	flags: Flags,
): Promise<void> {
	if (flags.enable && flags.disable)
		throw error(
			"usage_error",
			"Choose only one of --enable or --disable.",
			"boldvideo viewers memory get --help",
			2,
		);
	const key = await keyFor(ctx, true);
	const viewer = await resolveViewer(key, args[0] as string);
	const action =
		ctx.path.at(-1) === "clear"
			? "clear"
			: flags.enable
				? "enable"
				: flags.disable
					? "disable"
					: "read";
	if (flags["dry-run"] && action !== "read") {
		const plan = { viewer_id: viewer.id, action, dry_run: true };
		output(plan, table([plan]), ctx.json);
		return;
	}
	// TODO(bold-js): SDK does not expose viewer memory endpoints.
	const response = (await request(
		action === "clear" ? "DELETE" : action === "read" ? "GET" : "PATCH",
		`/viewers/${encodeURIComponent(String(viewer.id))}/memory`,
		{
			key,
			...(action === "enable" || action === "disable"
				? { body: { memory: { enabled: action === "enable" } } }
				: {}),
		},
	)) as Envelope<RecordData> | null;
	const result =
		action === "clear"
			? { viewer_id: viewer.id, cleared: true }
			: (response?.data as RecordData);
	output(result, table([result]), ctx.json);
}

export const viewers: Command = {
	name: "viewers",
	summary: "Sync members and inspect viewer progress and memory.",
	examples: [
		{ cmd: "boldvideo viewers list", note: "List account members." },
		{
			cmd: "boldvideo viewers sync members.csv --dry-run",
			note: "Preview member changes.",
		},
	],
	seeAlso: ["boldvideo whoami"],
	subcommands: [
		{
			name: "list",
			summary: "List a bounded page of viewers.",
			list: true,
			flags: [
				{
					name: "page",
					type: "number",
					default: 1,
					description: "Page number (positive integer).",
				},
			],
			examples: [
				{ cmd: "boldvideo viewers list --limit 10", note: "List ten members." },
				{
					cmd: "boldvideo viewers list --page 2 --fields id,email",
					note: "Project the second page.",
				},
			],
			seeAlso: ["boldvideo viewers get --help"],
			async run(ctx, _args, flags) {
				const page = Number(flags.page);
				if (!Number.isSafeInteger(page) || page < 1)
					throw error(
						"usage_error",
						"--page must be a positive integer.",
						"boldvideo viewers list --help",
						2,
					);
				const key = await keyFor(ctx);
				// TODO(bold-js): SDK list does not expose pagination parameters or metadata.
				const result = (await request("GET", "/viewers", {
					key,
					query: { page, page_size: Number(flags.limit) },
				})) as Envelope<RecordData[]> & {
					meta: { page: number; total_pages: number };
				};
				const next =
					result.meta.page < result.meta.total_pages
						? `boldvideo viewers list --page ${result.meta.page + 1} --limit ${flags.limit}${flags.fields ? ` --fields ${quote((flags.fields as string[]).join(","))}` : ""}${flags.profile ? ` --profile ${quote(String(flags.profile))}` : ""}${flags.json ? " --json" : ""}`
						: undefined;
				outputList(
					result.data,
					flags,
					next,
					table(
						result.data.map((row) => ({
							id: row.id,
							external_id: row.external_id,
							email: row.email,
							name: row.name,
							created: row.created_at,
						})),
						["id", "external_id", "email", "name", "created"],
					),
				);
			},
		},
		{
			name: "get",
			summary: "Get a viewer by UUID, email or external ID.",
			args: viewerArg,
			examples: [
				{
					cmd: "boldvideo viewers get maria@acme.com",
					note: "Find a member by email.",
				},
				{
					cmd: "boldvideo viewers get member_2048",
					note: "Find a member by your platform ID.",
				},
			],
			seeAlso: ["boldvideo viewers list"],
			async run(ctx, args) {
				const row = await resolveViewer(await keyFor(ctx), args[0] as string);
				output(row, table([row]), ctx.json);
			},
		},
		{
			name: "sync",
			summary: "Create or update viewers from CSV, JSON or stdin.",
			write: true,
			description:
				"Rows require external_id and may include email and name. Every other column becomes a key in traits; JSON values retain their types and CSV values are strings. New viewers require name. Omitted fields remain unchanged; supplied traits replace the map. Sync never deletes unless --prune is set. Prune snapshots all pages, then deletes viewers absent from the file only if every sync row succeeded. Four sequential lanes preserve duplicate-ID order. Each request retries a 429 once using Retry-After; other failures are not retried. Dry-run reports planned actions without writes. Partial failures return row errors and exit 1.",
			flags: [
				{
					name: "prune",
					type: "boolean",
					destructive: true,
					description:
						"Delete viewers absent from the input (requires --yes when piped).",
				},
			],
			args: [
				{
					name: "file",
					description:
						"CSV file, JSON array file, or - for stdin (JSON detected by leading [).",
				},
			],
			examples: [
				{
					cmd: "boldvideo viewers sync members.csv --dry-run",
					note: "Preview member changes without writing.",
				},
				{
					cmd: "boldvideo viewers sync -",
					note: "Read a member export from piped stdin.",
				},
			],
			seeAlso: ["boldvideo viewers list"],
			run: sync,
		},
		{
			name: "progress",
			summary: "Show a viewer's watch progress.",
			args: viewerArg,
			flags: [
				{
					name: "video",
					type: "string",
					description: "Restrict progress to this video ID.",
				},
			],
			examples: [
				{
					cmd: "boldvideo viewers progress member_2048",
					note: "Inspect a member's viewing history.",
				},
				{
					cmd: "boldvideo viewers progress maria@acme.com --video onboarding",
					note: "Inspect progress on one video.",
				},
			],
			seeAlso: ["boldvideo viewers get --help"],
			async run(ctx, args, flags) {
				const key = await keyFor(ctx);
				const viewer = await resolveViewer(key, args[0] as string);
				const result = await sdkRead(key, (viewers) =>
					flags.video
						? viewers.getProgress(
								encodeURIComponent(String(viewer.id)),
								encodeURIComponent(String(flags.video)),
							)
						: viewers.listProgress(encodeURIComponent(String(viewer.id))),
				);
				const rows = (Array.isArray(result) ? result : [result]).map(apiRecord);
				const columns = [
					"video",
					...(rows.some(
						(row) => row.title || (row.video as RecordData | undefined)?.title,
					)
						? ["title"]
						: []),
					"percent",
					"completed",
					"updated",
				];
				output(
					rows,
					table(
						rows.map((row) => ({
							video: row.video_id,
							title: row.title ?? (row.video as RecordData | undefined)?.title,
							percent: row.percentage,
							completed: row.completed,
							updated: row.updated_at,
						})),
						columns,
					),
					ctx.json,
				);
			},
		},
		{
			name: "memory",
			summary: "Read, toggle or clear a viewer's AI memory.",
			description:
				"Use get with --enable or --disable to toggle future memory distillation without replacing content. Clear deletes content; it may regrow unless disabled.",
			examples: [
				{
					cmd: "boldvideo viewers memory get member_2048",
					note: "Read a member's memory.",
				},
				{
					cmd: "boldvideo viewers memory clear maria@acme.com --yes",
					note: "Clear a member's memory content.",
				},
			],
			seeAlso: ["boldvideo viewers progress --help"],
			subcommands: [
				{
					name: "get",
					summary: "Read memory or toggle future memory distillation.",
					args: viewerArg,
					write: true,
					flags: [
						{
							name: "enable",
							type: "boolean",
							description: "Enable future memory distillation.",
						},
						{
							name: "disable",
							type: "boolean",
							description: "Disable future memory distillation.",
						},
					],
					examples: [
						{
							cmd: "boldvideo viewers memory get member_2048",
							note: "Read a member's memory.",
						},
						{
							cmd: "boldvideo viewers memory get maria@acme.com --disable",
							note: "Stop future distillation without clearing existing memory.",
						},
					],
					seeAlso: ["boldvideo viewers memory clear --help"],
					run: memory,
				},
				{
					name: "clear",
					summary: "Delete a viewer's memory content.",
					args: viewerArg,
					write: true,
					destructive: true,
					examples: [
						{
							cmd: "boldvideo viewers memory clear member_2048 --yes",
							note: "Clear a member's memory content.",
						},
						{
							cmd: "boldvideo viewers memory clear maria@acme.com --dry-run --yes",
							note: "Preview clearing memory without deleting content.",
						},
					],
					seeAlso: ["boldvideo viewers memory get --help"],
					run: memory,
				},
			],
		},
	],
};
