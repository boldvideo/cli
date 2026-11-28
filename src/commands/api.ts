import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { apiUrl } from "../api";
import { apiError, error } from "../errors";
import { hint, output, outputList } from "../output";
import type { Command } from "../spec";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const usage = (message: string) =>
	error("usage_error", message, "boldvideo api --help", 2);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function pair(value: string): [string, string] {
	const equals = value.indexOf("=");
	if (equals < 1) throw usage("Fields and query parameters require key=value.");
	return [value.slice(0, equals), value.slice(equals + 1)];
}

function apiPath(path: string, base: URL): URL {
	const url = new URL(path.replace(/^\/+/, ""), base);
	if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
		throw usage("API paths must stay under the API base URL.");
	return url;
}

// This command needs response headers for Link pagination, not just the body.
function describeRequest(
	url: URL,
	method: string,
	key: string,
	body?: unknown,
) {
	const base = new URL(`${apiUrl()}/`);
	const headers = {
		Authorization: `Bearer ${key}`,
		Accept: "application/json",
		...(url.pathname.slice(base.pathname.length).startsWith("admin")
			? { "X-Bold-Admin-Api-Key": key }
			: {}),
		...(body === undefined ? {} : { "Content-Type": "application/json" }),
	};
	return {
		method,
		url: url.href,
		headers,
		body,
	};
}

async function fetchJson(request: ReturnType<typeof describeRequest>) {
	const signal = AbortSignal.timeout(30_000);
	let response: Response;
	let raw: string;
	try {
		response = await fetch(request.url, {
			method: request.method,
			headers: request.headers,
			body:
				request.body === undefined ? undefined : JSON.stringify(request.body),
			redirect: "error",
			signal,
		});
		raw = await response.text();
	} catch {
		throw error(
			signal.aborted ? "timed_out" : "api_error",
			signal.aborted
				? "The Bold API request timed out."
				: "Could not reach the Bold API.",
			"boldvideo api --help",
			signal.aborted ? 5 : 1,
		);
	}
	let data: unknown = null;
	try {
		data = raw ? JSON.parse(raw) : null;
	} catch {
		if (response.ok)
			throw error(
				"api_error",
				"The Bold API returned invalid JSON.",
				"boldvideo api --help",
			);
		data = raw;
	}
	if (!response.ok)
		throw {
			...apiError(
				response.status,
				data,
				response.headers.get("x-request-id") ?? undefined,
				[401, 403].includes(response.status)
					? "boldvideo login --help"
					: "boldvideo api --help",
			),
			details: data,
		};
	return { data, response };
}

export const api: Command = {
	name: "api",
	summary: "Call any Bold API endpoint with the active key.",
	description:
		"Paths are relative to /api/v1. Use --list [filter] to discover endpoints. -f preserves strings; -F parses JSON values. --input reads a JSON file or stdin (-), and cannot be combined with fields. --paginate concatenates data arrays, bounded by --limit (default 20); --fields projects pagination or discovery results. DELETE requires --yes on piped stdin, including dry-run.",
	list: true,
	write: true,
	args: [
		{
			name: "method",
			description:
				"GET, POST, PUT, PATCH, DELETE, or an optional --list filter.",
			choices: methods,
			required: false,
		},
		{
			name: "path",
			description: "Endpoint path, including optional query parameters.",
			required: false,
		},
	],
	flags: [
		{
			name: "field",
			short: "f",
			type: "list",
			verbatim: true,
			description: "String body field (-f key=value), repeatable.",
		},
		{
			name: "typed-field",
			short: "F",
			type: "list",
			verbatim: true,
			description: "JSON body field (-F key=value), repeatable.",
		},
		{
			name: "query",
			short: "q",
			type: "list",
			verbatim: true,
			description: "Query parameter (-q key=value), repeatable.",
		},
		{
			name: "input",
			type: "string",
			description: "Read the whole JSON body from a file, or - for stdin.",
			complete: "file",
		},
		{
			name: "paginate",
			type: "boolean",
			default: false,
			description: "Follow Link or meta pagination up to --limit items.",
		},
		{
			name: "list",
			type: "boolean",
			default: false,
			description: "Fetch OpenAPI and list methods, paths and summaries.",
		},
		{
			name: "offset",
			type: "number",
			default: 0,
			description: "Skip this many endpoints in --list results.",
		},
	],
	examples: [
		{
			cmd: "boldvideo api GET /videos",
			note: "Read the video response as JSON.",
		},
		{
			cmd: 'boldvideo api POST /collections -f title="Paid workshops"',
			note: "Create a collection with a string field.",
		},
	],
	seeAlso: ["boldvideo login --help", "boldvideo whoami"],
	async run(ctx, args, flags) {
		const key = ctx.credential?.key as string;
		const base = new URL(`${apiUrl()}/`);
		const limit = Number(flags.limit);
		if (flags.list) {
			if (args[1]) throw usage("--list accepts at most one filter.");
			const offset = Number(flags.offset);
			if (!Number.isSafeInteger(offset) || offset < 0)
				throw usage("--offset must be a nonnegative integer.");
			const url = new URL(apiUrl().replace(/\/api\/v1$/, "/api/openapi"));
			if (flags["dry-run"]) {
				const preview = describeRequest(url, "GET", key);
				output(
					{ dry_run: true, ...preview },
					JSON.stringify({ dry_run: true, ...preview }, null, 2),
					ctx.json,
				);
				return;
			}
			const { data } = await fetchJson(describeRequest(url, "GET", key));
			const spec = data as {
				paths?: Record<string, Record<string, { summary?: string }>>;
			} | null;
			if (!spec?.paths)
				throw error(
					"api_error",
					"The Bold API returned an invalid OpenAPI spec.",
					"boldvideo api --help",
				);
			const filter = (args[0] ?? "").toLowerCase();
			const rows = Object.entries(spec.paths)
				.flatMap(([path, operations]) =>
					Object.entries(operations)
						.filter(([method]) =>
							[...methods, "HEAD", "OPTIONS", "TRACE"].includes(
								method.toUpperCase(),
							),
						)
						.map(([method, operation]) => ({
							method: method.toUpperCase(),
							path,
							summary: (operation.summary ?? "").replace(/[\r\n]+/g, " "),
						})),
				)
				.filter((row) =>
					`${row.path} ${row.summary}`.toLowerCase().includes(filter),
				);
			const next =
				offset + limit < rows.length
					? `boldvideo api --list ${quote(args[0] ?? "")} --offset ${offset + limit} --limit ${limit}${flags.fields ? ` --fields ${quote((flags.fields as string[]).join(","))}` : ""}${flags.profile ? ` --profile ${quote(String(flags.profile))}` : ""}${flags.json ? " --json" : ""}`
					: undefined;
			outputList(rows.slice(offset, offset + limit), flags, next);
			return;
		}
		const method = (args[0] ?? "").toUpperCase();
		if (!methods.includes(method) || !args[1])
			throw usage(
				"Supply a supported method and endpoint path, or use --list.",
			);
		if (method === "DELETE" && !flags.yes && !process.stdin.isTTY)
			throw error(
				"confirmation_required",
				"DELETE requires --yes when stdin is not a terminal.",
				`boldvideo api DELETE '${args[1].replaceAll("'", "'\\''")}' --yes`,
				2,
			);
		let url = apiPath(args[1], base);
		for (const value of (flags.query as string[] | undefined) ?? []) {
			const [name, content] = pair(value);
			url.searchParams.append(name, content);
		}
		const fields = (flags.field as string[] | undefined) ?? [];
		const typed = (flags["typed-field"] as string[] | undefined) ?? [];
		let body: unknown;
		if (flags.input !== undefined) {
			if (fields.length || typed.length)
				throw usage("--input cannot be combined with body fields.");
			try {
				body = JSON.parse(
					flags.input === "-"
						? await text(process.stdin)
						: await readFile(String(flags.input), "utf8"),
				);
			} catch {
				throw usage("--input must contain readable JSON.");
			}
		} else if (fields.length || typed.length) {
			const entries: [string, unknown][] = fields.map(pair);
			for (const value of typed) {
				const [name, content] = pair(value);
				try {
					entries.push([name, JSON.parse(content)]);
				} catch {
					throw usage(`Invalid JSON value for field '${name}'.`);
				}
			}
			body = Object.fromEntries(entries);
		}
		if (method === "GET" && body !== undefined)
			throw usage(
				"GET requests cannot include a body; use -q for query parameters.",
			);
		const request = describeRequest(url, method, key, body);
		if (flags["dry-run"]) {
			output(
				{ dry_run: true, ...request },
				JSON.stringify({ dry_run: true, ...request }, null, 2),
				ctx.json,
			);
			return;
		}
		const items: unknown[] = [];
		const visited = new Set<string>();
		while (true) {
			if (visited.has(url.href))
				throw error(
					"api_error",
					"The API returned a pagination cycle.",
					"boldvideo api --help",
				);
			visited.add(url.href);
			const { data, response } = await fetchJson(
				describeRequest(url, method, key, body),
			);
			if (!flags.paginate) {
				output(data, JSON.stringify(data, null, 2), ctx.json);
				return;
			}
			const page = data as {
				data?: unknown[];
				meta?: { page?: number; total_pages?: number };
			} | null;
			if (!Array.isArray(page?.data))
				throw error(
					"api_error",
					"Pagination requires a response with a data array.",
					"boldvideo api --help",
				);
			const link = [
				...(response.headers.get("link") ?? "").matchAll(/<([^>]+)>([^<>]*)/g),
			].find((entry) => {
				const rel = entry[2]?.match(/;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i);
				return (rel?.[1] ?? rel?.[2])?.split(/\s+/).includes("next");
			})?.[1];
			const remaining = limit - items.length;
			items.push(...page.data.slice(0, remaining));
			if (items.length >= limit) {
				if (
					page.data.length > remaining ||
					link ||
					Number(page.meta?.page) < Number(page.meta?.total_pages)
				) {
					const argv = process.argv.slice(2);
					const end = argv.indexOf("--");
					argv.splice(
						end < 0 ? argv.length : end,
						0,
						"--limit",
						String(Math.min(Number.MAX_SAFE_INTEGER, limit * 2)),
					);
					const input =
						flags.input === "-"
							? `printf '%s' ${quote(JSON.stringify(body))} | `
							: "";
					hint(
						`More results (repeat with a larger limit): ${input}boldvideo ${argv.map(quote).join(" ")}`,
					);
				}
				break;
			}
			if (link) {
				const next = new URL(link, url);
				if (
					next.origin !== base.origin ||
					!next.pathname.startsWith(base.pathname)
				)
					throw usage("Pagination links must stay under the API base URL.");
				url = next;
			} else if (
				Number.isSafeInteger(page.meta?.page) &&
				Number(page.meta?.page) < Number(page.meta?.total_pages)
			) {
				url.searchParams.set("page", String(Number(page.meta?.page) + 1));
			} else break;
		}
		const selected = flags.fields as string[] | undefined;
		const result = selected?.length
			? items.map((item) =>
					Object.fromEntries(
						selected.map((field) => [
							field,
							(item as Record<string, unknown>)[field],
						]),
					),
				)
			: items;
		output(result, JSON.stringify(result, null, 2), ctx.json);
	},
};
