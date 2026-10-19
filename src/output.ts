import pc from "picocolors";
import { redact } from "./errors";
import type { Flags } from "./spec";

export function table(
	rows: Record<string, unknown>[],
	columns = Object.keys(rows[0] ?? {}),
): string {
	if (columns.length === 0) return "No results.";
	const cells = rows.map((row) =>
		columns.map((column) =>
			String(row[column] ?? "").replace(/[\r\n\t]/g, " "),
		),
	);
	const headers = columns.map((column) => column.toUpperCase());
	const widths = headers.map((header, i) =>
		Math.max(header.length, ...cells.map((row) => row[i]?.length ?? 0)),
	);
	const line = (row: string[]) =>
		row
			.map((cell, i) =>
				i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0),
			)
			.join("  ");
	const colors = pc.createColors(
		Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
	);
	return [colors.bold(line(headers)), ...cells.map(line)].join("\n");
}

export function output(data: unknown, text: string, json = false): void {
	process.stdout.write(
		redact(`${json || !process.stdout.isTTY ? JSON.stringify(data) : text}\n`),
	);
}

export function hint(text: string): void {
	if (!process.stderr.isTTY) return;
	const colors = pc.createColors(!process.env.NO_COLOR);
	process.stderr.write(redact(`${colors.dim(text)}\n`));
}

export function outputList(
	items: Record<string, unknown>[],
	flags: Flags,
	next?: string,
): void {
	const fields = flags.fields as string[] | undefined;
	const rows = fields?.length
		? items.map((item) =>
				Object.fromEntries(fields.map((field) => [field, item[field]])),
			)
		: items;
	output(
		{ items: rows, has_more: Boolean(next), ...(next ? { next } : {}) },
		table(rows, fields?.length ? fields : undefined),
		flags.json === true,
	);
	if (next) hint(`More results: ${next}`);
}
