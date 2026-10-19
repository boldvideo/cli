import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./run";

const temporary = mkdtempSync(join(tmpdir(), "boldvideo-docs-"));
const index = readFileSync(resolve("test/fixtures/docs-index.txt"), "utf8");
const page = readFileSync(resolve("test/fixtures/docs-quickstart.md"), "utf8");
const full = readFileSync(resolve("test/fixtures/docs-full.txt"), "utf8");
const requests: { path: string; accept: string | null; auth: string | null }[] =
	[];
const responses = new Map<string, Response>();
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		const path = new URL(request.url).pathname;
		requests.push({
			path,
			accept: request.headers.get("accept"),
			auth: request.headers.get("authorization"),
		});
		return (
			responses.get(path)?.clone() ?? new Response("Not found", { status: 404 })
		);
	},
});
const base = `http://127.0.0.1:${server.port}/preview`;
const url = `${base}/guides/quickstart`;
const markdown = `<!-- ${url} -->\n${page.trim()}\n`;
const execute = (args: string[], tty = false, key = "") =>
	run(["node", resolve("dist/boldvideo.js"), "docs", ...args], {
		tty,
		env: {
			BOLDVIDEO_DOCS_URL: `${base}/`,
			BOLDVIDEO_API_KEY: key,
			XDG_CONFIG_HOME: temporary,
			APPDATA: temporary,
		},
	});

beforeEach(() => {
	requests.length = 0;
	responses.clear();
	responses.set("/preview/llms.txt", new Response(index));
	responses.set("/preview/guides/quickstart.md", new Response(page));
	responses.set("/preview/llms-full.txt", new Response(full));
});
afterAll(() => {
	server.stop(true);
	rmSync(temporary, { recursive: true, force: true });
});

test("lists fixture topics as JSON and a terminal table without credentials", async () => {
	const result = await execute([]);
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	const data = JSON.parse(result.stdout);
	expect(data.has_more).toBe(false);
	expect(data.items).toEqual([
		{
			topic: "guides",
			title: "Welcome to Bold",
			description: "What Bold is, how it works, and where to start",
		},
		{
			topic: "guides/quickstart",
			title: "Quickstart",
			description: "From login to your first shared video",
		},
		{
			topic: "sdk/videos",
			title: "Videos",
			description: "List, fetch, and search videos with the SDK",
		},
		{ topic: "api/reference/videos", title: "Videos", description: "" },
		{
			topic: "cli",
			title: "CLI Reference",
			description: "boldvideo command-line reference.",
		},
	]);
	const terminal = await execute([], true);
	expect(terminal.status).toBe(0);
	expect(terminal.stdout).toMatch(/^TOPIC\s+TITLE\s+DESCRIPTION\n/);
	expect(terminal.stdout).toContain("guides/quickstart");
	expect((await execute(["--json"], true)).stdout).toBe(result.stdout);
});

test("searches topic, title and description case-insensitively, including no matches", async () => {
	for (const [search, expected] of [
		["sdk/", "sdk/videos"],
		["WELCOME", "guides"],
		["first shared", "guides/quickstart"],
	]) {
		const result = await execute(["--search", search as string]);
		expect(JSON.parse(result.stdout)).toMatchObject({
			items: [expect.objectContaining({ topic: expected })],
			has_more: false,
		});
	}
	expect(JSON.parse((await execute(["--search", "unlisted"])).stdout)).toEqual({
		items: [],
		has_more: false,
	});
});

test("paginates filtered topics and executes the exact projected continuation", async () => {
	const first = await execute([
		"--search",
		"videos",
		"--limit",
		"1",
		"--fields",
		"topic",
		"--json",
	]);
	const data = JSON.parse(first.stdout);
	expect(data).toEqual({
		items: [{ topic: "sdk/videos" }],
		has_more: true,
		next: "boldvideo docs --offset 1 --limit 1 --search 'videos' --fields 'topic' --json",
	});
	const next = await run(
		[
			"sh",
			"-c",
			data.next.replace("boldvideo", `node '${resolve("dist/boldvideo.js")}'`),
		],
		{ env: { BOLDVIDEO_DOCS_URL: base, XDG_CONFIG_HOME: temporary } },
	);
	expect(next.status).toBe(0);
	expect(JSON.parse(next.stdout)).toEqual({
		items: [{ topic: "api/reference/videos" }],
		has_more: false,
	});
});

test("resolves exact topics before prefixes, then unique prefixes and substrings", async () => {
	for (const query of ["guides/quickstart", "guides/quick", "quickstart"]) {
		requests.length = 0;
		const result = await execute([query]);
		expect(result).toEqual({ status: 0, stdout: markdown, stderr: "" });
		expect(requests.map((request) => request.path)).toEqual([
			"/preview/llms.txt",
			"/preview/guides/quickstart.md",
		]);
	}
	expect((await execute(["guides"])).stdout).toContain("# Welcome to Bold");
});

test("ambiguous topics list candidates; unknown topics exit 4 without fetching pages", async () => {
	for (const query of ["videos", "guide"]) {
		const result = await execute([query]);
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "usage_error",
			message: expect.stringContaining(
				query === "videos"
					? "sdk/videos, api/reference/videos"
					: "guides, guides/quickstart",
			),
			hint: "boldvideo docs",
			docs: "https://docs.boldvideo.com/cli#usage-error",
		});
	}
	const missing = await execute(["nonexistent"]);
	expect(missing.status).toBe(4);
	expect(missing.stdout).toBe("");
	expect(JSON.parse(missing.stderr).code).toBe("not_found");
	expect(
		requests.every((request) => request.path === "/preview/llms.txt"),
	).toBe(true);
});

test("falls back from missing or HTML .md to negotiated markdown, never sending auth", async () => {
	for (const response of [
		new Response("Missing", { status: 404 }),
		new Response("<!doctype html><html><body>Docs</body></html>"),
	]) {
		requests.length = 0;
		responses.set("/preview/guides/quickstart.md", response);
		responses.set(
			"/preview/guides/quickstart",
			new Response(page, {
				headers: { "content-type": "text/markdown; charset=utf-8" },
			}),
		);
		expect(
			await execute(["quickstart"], false, "bold_docs_secret_2040"),
		).toEqual({ status: 0, stdout: markdown, stderr: "" });
		expect(requests.map((request) => request.path)).toEqual([
			"/preview/llms.txt",
			"/preview/guides/quickstart.md",
			"/preview/guides/quickstart",
		]);
		expect(requests.at(-1)?.accept).toBe("text/markdown");
		expect(requests.every((request) => request.auth === null)).toBe(true);
	}
});

test("requires negotiated markdown content type before using the full-text section", async () => {
	responses.delete("/preview/guides/quickstart.md");
	for (const response of [
		new Response(page, { headers: { "content-type": "text/html" } }),
		new Response("<html>Not markdown</html>", {
			headers: { "content-type": "text/markdown" },
		}),
	]) {
		requests.length = 0;
		responses.set("/preview/guides/quickstart", response);
		expect(await execute(["quickstart"])).toEqual({
			status: 0,
			stdout: markdown,
			stderr: "",
		});
		expect(requests.map((request) => request.path)).toEqual([
			"/preview/llms.txt",
			"/preview/guides/quickstart.md",
			"/preview/guides/quickstart",
			"/preview/llms-full.txt",
		]);
	}
});

test("full-text fallback separates duplicate titles and ignores headings inside code fences", async () => {
	const sdk = await execute(["sdk/videos"]);
	const api = await execute(["api/reference/videos"]);
	expect(sdk.status).toBe(0);
	expect(sdk.stdout).toContain("The `videos` namespace reads video content");
	expect(sdk.stdout).not.toContain("<APIPage");
	expect(api.status).toBe(0);
	expect(api.stdout).toContain("<APIPage");
	expect(api.stdout).not.toContain("The `videos` namespace");
	responses.delete("/preview/guides/quickstart.md");
	const fenced = `${page.trim()}\n\n\`\`\`sh\n# shell comment\necho hello\n\`\`\`\n\n# Other page\nDo not include.\n`;
	responses.set("/preview/llms-full.txt", new Response(fenced));
	const result = await execute(["quickstart"]);
	expect(result.status).toBe(0);
	expect(result.stdout).toContain("# shell comment\necho hello\n```");
	expect(result.stdout).not.toContain("Other page");
});

test("wraps markdown only with explicit --json and preserves an existing canonical line", async () => {
	for (const prefix of [`<!-- ${url} -->`, `URL: ${url}`]) {
		const content = `${prefix}\n${page.trim()}`;
		responses.set("/preview/guides/quickstart.md", new Response(content));
		for (const tty of [false, true]) {
			const result = await execute(["quickstart", "--json"], tty);
			expect(result.status).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual({
				url,
				title: "Quickstart",
				markdown: content,
			});
		}
		expect((await execute(["quickstart"], true)).stdout).toBe(`${content}\n`);
	}
});

test("unavailable markdown and the cli alias exit 4 with a browser URL hint", async () => {
	responses.delete("/preview/guides/quickstart.md");
	responses.delete("/preview/llms-full.txt");
	for (const topic of ["guides/quickstart", "cli"]) {
		const result = await execute([topic]);
		expect(result.status).toBe(4);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "not_found",
			hint: expect.stringContaining(`${base}/${topic}`),
			docs: "https://docs.boldvideo.com/cli#not-found",
		});
	}
	responses.set("/preview/cli.md", new Response("# Command reference\n"));
	expect((await execute(["cli"])).stdout).toBe(
		`<!-- ${base}/cli -->\n# Command reference\n`,
	);
	responses.delete("/preview/llms.txt");
	expect((await execute(["cli"])).status).toBe(0);
	const failure = await execute([]);
	expect(failure.status).toBe(1);
	expect(failure.stdout).toBe("");
	expect(JSON.parse(failure.stderr).code).toBe("docs_error");
});
