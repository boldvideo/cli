import { request } from "../api";
import type { Credential } from "../auth";
import { error } from "../errors";
import { outputList } from "../output";
import type { Command } from "../spec";
import { type AiResult, commandLine, outputAi } from "./ai-results";

export const search: Command = {
	name: "search",
	summary: "Search your library with AI or find keyword matches.",
	description:
		"AI search shows a summary with cited sources. --limit bounds displayed sources, not retrieval; increasing it regenerates the summary. --keyword uses paginated keyword results instead. --fields selects source or keyword-result fields.",
	list: true,
	args: [{ name: "query", description: "Question or keywords to search for." }],
	flags: [
		{
			name: "keyword",
			type: "boolean",
			default: false,
			description: "Search keywords without AI synthesis.",
		},
		{
			name: "page",
			type: "number",
			default: 1,
			description:
				"Keyword results page (positive integer; requires --keyword).",
		},
	],
	examples: [
		{
			cmd: 'boldvideo search "pricing a live workshop" --limit 5',
			note: "Find relevant moments with an AI summary.",
		},
		{
			cmd: 'boldvideo search "early bird" --keyword --fields id,title',
			note: "Find keyword matches without AI.",
		},
	],
	seeAlso: ["boldvideo ask --help", "boldvideo whoami"],
	async run(ctx, args, flags) {
		const { key } = ctx.credential as Credential;
		const page = Number(flags.page);
		if (
			!Number.isSafeInteger(page) ||
			page < 1 ||
			(!flags.keyword && page !== 1)
		)
			throw error(
				"usage_error",
				"--page must be a positive integer and requires --keyword.",
				"boldvideo search --help",
				2,
			);
		if (flags.keyword) {
			// TODO(bold-js): videos.search targets /videos, not paginated GET /search.
			const result = (await request("GET", "/search", {
				key,
				query: { query: args[0], page, per_page: Number(flags.limit) },
			})) as {
				hits: Record<string, unknown>[];
				page: number;
				per_page: number;
				total_hits: number;
			};
			const next =
				result.page * result.per_page < result.total_hits
					? commandLine(ctx.path, args, { ...flags, page: result.page + 1 })
					: undefined;
			outputList(result.hits, flags, next);
			return;
		}
		// TODO(bold-js): use the SDK when AI errors retain entitlement codes and messages.
		const result = (await request("POST", "/ai/search", {
			key,
			body: { prompt: args[0], stream: false },
		})) as AiResult;
		outputAi(result, ctx, args, flags);
	},
};
