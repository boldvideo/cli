import { request } from "../api";
import type { Credential } from "../auth";
import { type CliError, error } from "../errors";
import { hint, output, outputList, table } from "../output";
import type { Command, Flags } from "../spec";

interface Question extends Record<string, unknown> {
	id: string;
	asked_at: string;
	question: string;
	viewer: { id: string | null; display_name: string };
	outcome: string | null;
	sources:
		| { video_id: string; title: string | null; timestamp: number | null }[]
		| null;
}

// Isolate the not-yet-deployed endpoint's envelope; keep item fields untouched.
function parseQuestions(body: unknown) {
	const value = body as {
		data: Question[];
		meta: {
			page: number;
			page_size: number;
			total_entries: number;
			total_pages: number;
			since: string;
			until: string;
		};
	} | null;
	if (
		!Array.isArray(value?.data) ||
		!value.data.every(
			(item) =>
				item &&
				typeof item.id === "string" &&
				typeof item.question === "string" &&
				typeof item.asked_at === "string" &&
				Number.isFinite(Date.parse(item.asked_at)) &&
				(item.sources === null ||
					(Array.isArray(item.sources) &&
						item.sources.every(
							(source) => typeof source?.video_id === "string",
						))),
		) ||
		!Number.isSafeInteger(value.meta?.page) ||
		value.meta.page < 1 ||
		!Number.isSafeInteger(value.meta.total_pages) ||
		value.meta.total_pages < 0 ||
		typeof value.meta.since !== "string" ||
		!Number.isFinite(Date.parse(value.meta.since)) ||
		typeof value.meta.until !== "string" ||
		!Number.isFinite(Date.parse(value.meta.until))
	)
		throw error(
			"api_error",
			"The Bold API returned an invalid questions page.",
			"boldvideo insights questions --help",
		);
	return value;
}

const usage = (message: string) =>
	error("usage_error", message, "boldvideo insights questions --help", 2);

function validateWindow(name: string, value: string) {
	if (
		!/^[1-9]\d{0,8}[dh]$/.test(value) &&
		!(
			/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
				value,
			) &&
			Number.isFinite(Date.parse(value)) &&
			new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) ===
				value.slice(0, 10)
		)
	)
		throw usage(
			`--${name} must be an ISO 8601 timestamp, YYYY-MM-DD date, or Nd/Nh duration (for example 7d or 24h).`,
		);
}

function questionTable(items: Question[]) {
	const rows = items.map((item) => ({
		asked: new Date(item.asked_at).toLocaleString(undefined, {
			dateStyle: "short",
			timeStyle: "short",
		}),
		viewer: item.viewer?.display_name ?? item.viewer?.id ?? "—",
		question: item.question.replace(/\s/g, " "),
		outcome: item.outcome ?? "—",
		sources: item.sources === null ? "?" : String(item.sources.length),
	}));
	const columns = ["asked", "viewer", "question", "outcome", "sources"];
	const fixedWidth = columns
		.filter((column) => column !== "question")
		.reduce(
			(sum, column) =>
				sum +
				Math.max(
					column.length,
					...rows.map((row) => String(row[column as keyof typeof row]).length),
				),
			8, // Four two-space column separators.
		);
	const width = Math.max(8, (process.stdout.columns || 80) - fixedWidth);
	for (const row of rows) {
		const characters = Array.from(row.question);
		if (characters.length > width)
			row.question = `${characters.slice(0, width - 1).join("")}…`;
	}
	return table(rows, columns);
}

function groupQuestions(items: Question[], groupBy: string) {
	const counts = new Map<string, number>();
	for (const item of items) {
		const groups =
			groupBy === "video"
				? item.sources === null
					? ["(unobserved)"]
					: item.sources.length
						? [...new Set(item.sources.map((source) => source.video_id))]
						: ["(none)"]
				: [
						groupBy === "day"
							? item.asked_at.slice(0, 10)
							: (item.outcome ?? "(unobserved)"),
					];
		for (const group of groups) counts.set(group, (counts.get(group) ?? 0) + 1);
	}
	return [...counts].map(([group, count]) => ({ [groupBy]: group, count }));
}

const questions: Command = {
	name: "questions",
	summary: "Read member questions and identify content gaps.",
	description:
		"Requires an admin key. Windows are half-open [since, until); dates, ISO 8601 timestamps and Nd/Nh durations are passed through verbatim. Until defaults to the server's now. Results are newest first as served. Grouping counts only the fetched page: video counts each question once per distinct source video (none/unobserved are separate); day uses the date in asked_at. Terminal sources '?' means unobserved, 0 means none; only question text is shortened.",
	auth: "admin",
	list: true,
	flags: [
		{
			name: "since",
			type: "string",
			default: "7d",
			description: "Window start: ISO timestamp, date, or Nd/Nh duration.",
		},
		{
			name: "until",
			type: "string",
			description:
				"Exclusive window end: ISO timestamp, date, or Nd/Nh duration; default now.",
		},
		...[
			["collection", "Filter by collection UUID."],
			["video", "Filter by video UUID, hashid or slug."],
			["kind", "Filter by question kind."],
			["channel", "Filter by channel."],
			["outcome", "Filter by classification outcome."],
			["status", "Filter by review status."],
			["reason", "Filter by classification reason."],
		].map(([name, description]) => ({
			name: name as string,
			type: "string" as const,
			description: description as string,
		})),
		...[
			["needs-a-look", "Only questions needing a look."],
			["include-team", "Include questions from team members."],
			["include-noise", "Include questions classified as noise."],
			["include-pending", "Include pending questions."],
		].map(([name, description]) => ({
			name: name as string,
			type: "boolean" as const,
			description: description as string,
		})),
		{
			name: "page",
			type: "number",
			default: 1,
			description:
				"Page number (positive integer); --limit sets page_size, maximum 100.",
		},
		{
			name: "group-by",
			type: "string",
			description: "Count by video, outcome or day over the fetched page only.",
		},
	],
	examples: [
		{
			cmd: "boldvideo insights questions --since 7d --needs-a-look",
			note: "Find recent questions worth reviewing.",
		},
		{
			cmd: "boldvideo insights questions --since 2026-10-01 --until 2026-10-08 --group-by video --limit 100",
			note: "Count questions per source video on one weekly page.",
		},
	],
	seeAlso: ["boldvideo whoami", "boldvideo insights --help"],
	async run(ctx, _args, flags) {
		validateWindow("since", String(flags.since));
		if (flags.until !== undefined) validateWindow("until", String(flags.until));
		if (!Number.isSafeInteger(flags.page) || Number(flags.page) < 1)
			throw usage("--page must be a positive integer.");
		if (Number(flags.limit) > 100) throw usage("--limit must be at most 100.");
		const groupBy = flags["group-by"] as string | undefined;
		if (groupBy !== undefined && !["video", "outcome", "day"].includes(groupBy))
			throw usage("--group-by must be video, outcome or day.");
		const query: Record<string, string | number | boolean | undefined> = {
			page_size: Number(flags.limit),
		};
		for (const flag of questions.flags ?? []) {
			if (flag.name !== "group-by")
				query[flag.name.replaceAll("-", "_")] = flags[flag.name] as
					| string
					| number
					| boolean
					| undefined;
		}
		let body: unknown;
		try {
			// TODO(bold-js): use the SDK when it exposes admin insights questions.
			// BOLD_admin #723 requires X-Bold-Admin-Api-Key; the shared Bearer
			// transport must gain admin-header support before live integration.
			body = await request("GET", "/admin/insights/questions", {
				key: (ctx.credential as Credential).key,
				query,
			});
		} catch (cause) {
			const failure = cause as CliError | null;
			if (
				failure?.code === "not_authenticated" ||
				failure?.code === "not_permitted"
			)
				throw {
					...failure,
					hint: "An admin key is required. Set BOLDVIDEO_API_KEY to an admin key or run boldvideo login --token <admin-key>.",
				};
			throw cause;
		}
		const page = parseQuestions(body);
		let next: string | undefined;
		if (page.meta.page < page.meta.total_pages) {
			const frozen: Flags = {
				...flags,
				since: page.meta.since,
				until: page.meta.until,
				page: page.meta.page + 1,
			};
			const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
			next = "boldvideo insights questions";
			for (const [name, value] of Object.entries(frozen)) {
				if (value === undefined || value === false || name === "help") continue;
				next += ` --${name}${value === true ? "" : ` ${quote(Array.isArray(value) ? value.join(",") : String(value))}`}`;
			}
		}
		const items = groupBy ? groupQuestions(page.data, groupBy) : page.data;
		if (ctx.json || groupBy || (flags.fields as string[] | undefined)?.length) {
			outputList(items, flags, next);
		} else {
			output(null, questionTable(page.data));
			if (next) hint(`More results: ${next}`);
		}
	},
};

export const insights: Command = {
	name: "insights",
	summary: "Explore member questions and content gaps.",
	auth: "admin",
	examples: [
		{
			cmd: "boldvideo insights questions --since 7d",
			note: "Read this week's questions.",
		},
		{
			cmd: "boldvideo insights questions --since 24h --group-by outcome",
			note: "Count outcomes on the latest page.",
		},
	],
	seeAlso: ["boldvideo insights questions --help"],
	subcommands: [questions],
};
