import pc from "picocolors";
import { hint, output, table } from "../output";
import type { Context, Flags } from "../spec";

interface Source extends Record<string, unknown> {
	id: string;
	video_id: string | null;
	title: string;
	timestamp: number | null;
	timestamp_url: string | null;
	cited: boolean;
}

export interface AiResult extends Record<string, unknown> {
	content: string;
	sources: Source[];
}

export function commandLine(
	path: string[],
	args: string[],
	flags: Flags,
): string {
	const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;
	const options = Object.entries(flags).flatMap(([name, value]) => {
		if (value === undefined || value === false) return [];
		return value === true
			? [`--${name}`]
			: [
					`--${name}`,
					quote(Array.isArray(value) ? value.join(",") : String(value)),
				];
	});
	return ["boldvideo", ...path, ...options, "--", ...args.map(quote)].join(" ");
}

// Preserve Markdown paragraphs, list indentation and citation markers. Never split a URL.
function wrap(text: string): string {
	const width = process.stdout.columns || 80;
	return text
		.split("\n")
		.map((line) => {
			const indent = line.match(/^\s*/)?.[0] ?? "";
			let current = indent;
			const lines: string[] = [];
			for (const word of line.trim().split(/\s+/)) {
				if (current.trim() && current.length + 1 + word.length > width) {
					lines.push(current);
					current = indent;
				}
				current += `${current.trim() ? " " : ""}${word}`;
			}
			return [...lines, current].join("\n");
		})
		.join("\n");
}

export function outputAi(
	result: AiResult,
	ctx: Context,
	args: string[],
	flags: Flags,
): void {
	const sources = result.sources.slice(
		0,
		flags["no-sources"] ? 0 : Number(flags.limit),
	);
	const omitted = result.sources.length - sources.length;
	const next = omitted
		? commandLine(ctx.path, args, {
				...flags,
				limit: result.sources.length,
				"no-sources": false,
			})
		: undefined;
	const fields = flags.fields as string[] | undefined;
	const projected = fields?.length
		? sources.map((source) =>
				Object.fromEntries(fields.map((field) => [field, source[field]])),
			)
		: sources;
	let text = wrap(result.content);
	if (sources.length) {
		const colors = pc.createColors(
			Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
		);
		const rows = sources.map((source, index) => [
			`[${index + 1}]`,
			source.timestamp === null
				? ""
				: `${String(Math.floor(source.timestamp / 60)).padStart(2, "0")}:${String(Math.floor(source.timestamp % 60)).padStart(2, "0")}`,
			source.title.replace(/[\r\n\t]/g, " "),
			source.timestamp_url ?? "—",
		]);
		const widths = [0, 1, 2].map((i) =>
			Math.max(...rows.map((row) => row[i]?.length ?? 0)),
		);
		const list = fields?.length
			? table(projected, fields)
			: rows
					.map((row) =>
						row
							.map((cell, i) => (i < 3 ? cell.padEnd(widths[i] ?? 0) : cell))
							.join("  "),
					)
					.join("\n");
		text += `\n\n${colors.bold("Sources")}\n${list}`;
	}
	// The deprecated alias duplicates sources and would bypass --limit / --no-sources.
	const { citations: _citations, ...data } = result;
	output(
		{
			...data,
			sources: projected,
			has_more: omitted > 0,
			sources_omitted: omitted,
			...(next ? { next } : {}),
		},
		text,
		ctx.json,
	);
	if (next && !flags["no-sources"])
		hint(`${omitted} sources omitted. Regenerate with a larger limit: ${next}`);
}
