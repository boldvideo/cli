import { error } from "../errors";
import { output, outputList } from "../output";
import type { Command } from "../spec";

interface Topic {
	topic: string;
	title: string;
	description: string;
	url: string;
}

async function fetchText(
	url: string,
	markdown = false,
): Promise<string | null> {
	try {
		const response = await fetch(url, {
			headers: { Accept: markdown ? "text/markdown" : "text/plain" },
			signal: AbortSignal.timeout(10_000),
		});
		const contentType = response.headers
			.get("content-type")
			?.split(";")[0]
			?.trim()
			.toLowerCase();
		if (
			!response.ok ||
			contentType === "text/html" ||
			(markdown && contentType !== "text/markdown")
		)
			return null;
		const text = await response.text();
		return !text.trim() ||
			/<!doctype\s+html|<\/?(?:html|head|body)\b/i.test(text)
			? null
			: text;
	} catch {
		return null;
	}
}

function pageSection(
	full: string,
	page: Topic,
	topics: Topic[],
): string | null {
	// llms-full repeats titles (e.g. SDK Videos and API Videos) in index order.
	const occurrence = topics
		.slice(0, topics.indexOf(page))
		.filter((topic) => topic.title === page.title).length;
	const sections: { title: string; lines: string[] }[] = [];
	let fence = "";
	for (const line of full.split(/\r?\n/)) {
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker) {
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length)
				fence = "";
		} else if (!fence && line.startsWith("# ")) {
			sections.push({ title: line.slice(2).trim(), lines: [] });
		}
		sections.at(-1)?.lines.push(line);
	}
	return (
		sections
			.filter((section) => section.title === page.title)
			[occurrence]?.lines.join("\n")
			.trim() ?? null
	);
}

export const docs: Command = {
	name: "docs",
	summary: "List documentation topics or print a page as markdown.",
	description:
		"Resolve an exact topic, then a unique prefix or substring. Pages print raw markdown even when piped; --json returns {url, title, markdown}. BOLDVIDEO_DOCS_URL overrides https://docs.boldvideo.com. Requests time out after 10 seconds and never send API credentials.",
	auth: "none",
	list: true,
	args: [
		{
			name: "topic",
			description: "Documentation topic or match.",
			required: false,
		},
	],
	flags: [
		{
			name: "search",
			type: "string",
			description: "Filter topics, titles and descriptions by substring.",
		},
		{
			name: "offset",
			type: "number",
			default: 0,
			description: "Start at this topic (nonnegative integer).",
		},
	],
	examples: [
		{
			cmd: "boldvideo docs --search authentication",
			note: "Find documentation about API authentication.",
		},
		{
			cmd: "boldvideo docs guides/quickstart",
			note: "Read the quickstart without leaving the shell.",
		},
	],
	seeAlso: ["boldvideo docs --help", "boldvideo help --json"],
	async run(_ctx, args, flags) {
		const base = (
			process.env.BOLDVIDEO_DOCS_URL || "https://docs.boldvideo.com"
		).replace(/\/+$/, "");
		const offset = Number(flags.offset);
		if (!Number.isSafeInteger(offset) || offset < 0)
			throw error(
				"usage_error",
				"--offset must be a nonnegative integer.",
				"boldvideo docs --help",
				2,
			);
		const index = await fetchText(`${base}/llms.txt`);
		if (!index && args[0] !== "cli")
			throw error(
				"docs_error",
				"Could not load the documentation index.",
				`Run boldvideo docs again or open ${base}/llms.txt in a browser.`,
			);
		const topics: Topic[] = [];
		for (const match of (index ?? "").matchAll(
			/^- \[([^\]]+)\]\((https?:\/\/[^\s)]+)\)(?:\s+[—–-]\s+(.*))?$/gm,
		)) {
			const url = new URL(match[2] as string);
			const topic = url.pathname.replace(/^\/+|\/+$/g, "");
			topics.push({
				topic: topic || "index",
				title: match[1] as string,
				description: match[3]?.trim() ?? "",
				url: `${base}${url.pathname.replace(/\/+$/, "") || "/"}`,
			});
		}
		if (!topics.some((topic) => topic.topic === "cli"))
			topics.push({
				topic: "cli",
				title: "CLI Reference",
				description: "boldvideo command-line reference.",
				url: `${base}/cli`,
			});
		const query = args[0];
		if (query === undefined) {
			const search = String(flags.search ?? "").toLowerCase();
			const rows = topics
				.filter((page) =>
					[page.topic, page.title, page.description].some((value) =>
						value.toLowerCase().includes(search),
					),
				)
				.map(({ topic, title, description }) => ({
					topic,
					title,
					description,
				}));
			const limit = Number(flags.limit);
			const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
			const next =
				offset + limit < rows.length
					? `boldvideo docs --offset ${offset + limit} --limit ${limit}${flags.search === undefined ? "" : ` --search ${quote(String(flags.search))}`}${flags.fields ? ` --fields ${quote((flags.fields as string[]).join(","))}` : ""}${flags.json ? " --json" : ""}`
					: undefined;
			outputList(rows.slice(offset, offset + limit), flags, next);
			return;
		}
		let matches = topics.filter((page) => page.topic === query);
		if (!matches.length)
			matches = topics.filter((page) => page.topic.startsWith(query));
		if (!matches.length)
			matches = topics.filter((page) => page.topic.includes(query));
		if (matches.length > 1)
			throw error(
				"usage_error",
				`Ambiguous documentation topic '${query}': ${matches.map((page) => page.topic).join(", ")}.`,
				"boldvideo docs",
				2,
			);
		const page = matches[0];
		if (!page)
			throw error(
				"not_found",
				`No documentation topic matches '${query}'.`,
				"boldvideo docs",
				4,
			);
		let markdown =
			(await fetchText(`${page.url}.md`)) ?? (await fetchText(page.url, true));
		if (!markdown) {
			const full = await fetchText(`${base}/llms-full.txt`);
			if (full) markdown = pageSection(full, page, topics);
		}
		if (!markdown)
			throw error(
				"not_found",
				`Markdown is not available for '${page.topic}'.`,
				`Open ${page.url} in a browser; run boldvideo docs to find other topics.`,
				4,
			);
		markdown = markdown.trim();
		if (
			!markdown.startsWith(`<!-- ${page.url} -->`) &&
			!markdown.startsWith(`URL: ${page.url}\n`)
		)
			markdown = `<!-- ${page.url} -->\n${markdown}`;
		output(
			{ url: page.url, title: page.title, markdown },
			markdown,
			flags.json === true ? true : "text",
		);
	},
};
