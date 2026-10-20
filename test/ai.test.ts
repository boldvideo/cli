import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import fixtures from "./fixtures/ai.json";
import me from "./fixtures/me.json";
import { run as execute, type RunResult } from "./run";

const home = mkdtempSync(join(tmpdir(), "boldvideo-ai-"));
let answer: unknown;
let failure: Response | undefined;
let viewers: boolean;
const calls: {
	method: string;
	path: string;
	body: unknown;
	query: Record<string, string>;
}[] = [];
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		calls.push({
			method: request.method,
			path: url.pathname,
			body: request.method === "POST" ? await request.json() : null,
			query: Object.fromEntries(url.searchParams),
		});
		if (request.headers.get("authorization") !== "Bearer bold_test_ai_2033")
			return Response.json(fixtures.unauthorized, { status: 401 });
		if (failure) return failure.clone();
		switch (url.pathname) {
			case "/api/v1/me":
				return Response.json({
					data: { ...me.data, features: { ...me.data.features, viewers } },
				});
			case "/api/v1/ai/chat":
				return Response.json(answer);
			case "/api/v1/ai/search":
				return Response.json(fixtures.search);
			case "/api/v1/search": {
				const page = Number(url.searchParams.get("page"));
				const perPage = Number(url.searchParams.get("per_page"));
				return Response.json({
					...fixtures.keyword,
					page,
					per_page: perPage,
					hits: fixtures.keyword.hits.slice(
						(page - 1) * perPage,
						page * perPage,
					),
				});
			}
			default:
				return new Response("Not found", { status: 404 });
		}
	},
});
beforeEach(() => {
	answer = fixtures.answer;
	failure = undefined;
	viewers = true;
	calls.length = 0;
});
afterAll(() => {
	server.stop(true);
	rmSync(home, { recursive: true, force: true });
});

function run(
	args: string[] | string,
	options: { tty?: boolean; color?: boolean; stderrTty?: boolean } = {},
): Promise<RunResult> {
	const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;
	const argv =
		typeof args === "string"
			? [
					"sh",
					"-c",
					args.replace(
						/^boldvideo/,
						`node ${quote(resolve("dist/boldvideo.js"))}`,
					),
				]
			: ["node", resolve("dist/boldvideo.js"), ...args];
	return execute(argv, {
		tty: options.tty,
		columns: 64,
		stderr: options.stderrTty === false ? "pipe" : "tty",
		env: {
			...process.env,
			NO_COLOR: options.color ? "" : "1",
			FORCE_COLOR: undefined,
			BOLDVIDEO_API_KEY: "bold_test_ai_2033",
			BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}/api/v1`,
			XDG_CONFIG_HOME: home,
			APPDATA: home,
		},
	});
}

test("ask preserves JSON, source fields and IDs and sends follow-up and personalization", async () => {
	const result = await run([
		"ask",
		"What should I try next?",
		"--collection",
		"paid-workshops",
		"--as",
		"customer-1042",
		"--conversation",
		fixtures.answer.conversation_id,
	]);
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toEqual({
		...fixtures.answer,
		has_more: false,
		sources_omitted: 0,
	});
	expect(calls).toEqual([
		{ method: "GET", path: "/api/v1/me", body: null, query: {} },
		{
			method: "POST",
			path: "/api/v1/ai/chat",
			body: {
				prompt: "What should I try next?",
				stream: false,
				collection_id: "paid-workshops",
				viewer: "customer-1042",
				conversation_id: fixtures.answer.conversation_id,
			},
			query: {},
		},
	]);
});

test("terminal answers wrap and retain citation positions, zero times and untimed resources", async () => {
	const result = await run(["ask", "How should I price my first workshop?"], {
		tty: true,
	});
	expect(result.status).toBe(0);
	expect(result.stdout).toBe(
		"Start with a small paid workshop and validate demand before\nexpanding. [2]\n\nUse the pricing worksheet to choose your first offer. [3]\n\nSources\n[1]  00:00  Introduction         —\n[2]  02:05  Price your workshop  https://acme.boldvideo.io/pricing?t=125\n[3]         Pricing worksheet    —\n",
	);
	expect(result.stdout).not.toContain("\u001b[");
	const colored = await run(["ask", "Workshop pricing"], {
		tty: true,
		color: true,
	});
	expect(colored.stdout).toContain("\u001b[1mSources\u001b[22m");
	const json = await run(["ask", "Workshop pricing", "--json"], {
		tty: true,
		color: true,
	});
	expect(JSON.parse(json.stdout)).toEqual({
		...fixtures.answer,
		has_more: false,
		sources_omitted: 0,
	});
});

test("clarifications succeed without inventing sources", async () => {
	answer = fixtures.clarification;
	const result = await run(["ask", "How much?"]);
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({
		...fixtures.clarification,
		has_more: false,
		sources_omitted: 0,
	});
	expect((await run(["ask", "How much?"], { tty: true })).stdout).toBe(
		`${fixtures.clarification.content}\n`,
	);
});

test("source limits and no-sources report omissions, project only on request and provide executable reruns", async () => {
	answer = { ...fixtures.answer, citations: fixtures.answer.sources };
	const prompt = "--What's the workshop price?";
	const result = await run([
		"ask",
		"--limit",
		"2",
		"--collection",
		"paid-workshops",
		"--",
		prompt,
	]);
	const data = JSON.parse(result.stdout);
	expect(data.sources).toEqual(fixtures.answer.sources.slice(0, 2));
	expect(data).toMatchObject({ has_more: true, sources_omitted: 1 });
	expect(data).not.toHaveProperty("citations");
	const rerun = await run(data.next);
	expect(rerun.status).toBe(0);
	expect(JSON.parse(rerun.stdout).sources).toEqual(fixtures.answer.sources);
	expect(calls.at(-1)?.body).toEqual({
		prompt,
		stream: false,
		collection_id: "paid-workshops",
	});
	const hidden = JSON.parse(
		(await run(["ask", "Workshop pricing", "--no-sources"])).stdout,
	);
	expect(hidden).toMatchObject({
		sources: [],
		sources_omitted: 3,
		has_more: true,
	});
	expect(hidden).not.toHaveProperty("citations");
	expect(
		(await run(["ask", "Workshop pricing", "--no-sources"], { tty: true }))
			.stdout,
	).not.toContain("Sources");
	expect(
		JSON.parse(
			(
				await run([
					"ask",
					"Workshop pricing",
					"--fields",
					"id,timestamp",
					"--limit",
					"1",
				])
			).stdout,
		).sources,
	).toEqual([{ id: "chunk-introduction-17", timestamp: 0 }]);
	answer = {
		...fixtures.answer,
		sources: Array.from({ length: 21 }, (_, i) => ({
			...fixtures.answer.sources[0],
			id: `source-${i}`,
		})),
	};
	expect(
		JSON.parse((await run(["ask", "Workshop pricing"])).stdout),
	).toMatchObject({ sources_omitted: 1, has_more: true });
	for (const limit of ["0", "-1", "1.5", "9007199254740992"])
		expect(
			(await run(["ask", "Workshop pricing", `--limit=${limit}`])).status,
		).toBe(2);
});

test("disabled viewers warn only on terminal stderr, without changing JSON or the viewer request", async () => {
	viewers = false;
	const args = ["ask", "Workshop pricing", "--as", "customer-1042"];
	const result = await run(args, { tty: true });
	expect(result.status).toBe(0);
	expect(result.stdout).toContain("viewers disabled; --as will be ignored");
	expect(calls.at(-1)?.body).toMatchObject({ viewer: "customer-1042" });
	expect(
		(await run(args, { tty: true, stderrTty: false })).stdout,
	).not.toContain("Warning:");
	const piped = await run(args);
	expect(piped.stderr).toBe("");
	expect(JSON.parse(piped.stdout)).toMatchObject(fixtures.answer);
});

test("AI search preserves query and context and renders timestamps beyond an hour", async () => {
	const result = await run(["search", "pricing a live workshop"]);
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toEqual({
		...fixtures.search,
		has_more: false,
		sources_omitted: 0,
	});
	expect(calls).toEqual([
		{
			method: "POST",
			path: "/api/v1/ai/search",
			body: { prompt: "pricing a live workshop", stream: false },
			query: {},
		},
	]);
	expect(
		(await run(["search", "pricing a live workshop"], { tty: true })).stdout,
	).toContain("[1]  61:01  Price your workshop");
});

test("keyword search uses bounded server pages and preserves fields and quoting in next commands", async () => {
	const query = "--Director's early bird";
	const result = await run([
		"search",
		"--keyword",
		"--limit",
		"1",
		"--",
		query,
	]);
	expect(result.status).toBe(0);
	const first = JSON.parse(result.stdout);
	expect(first.items).toEqual([fixtures.keyword.hits[0]]);
	expect(first.has_more).toBe(true);
	expect(calls[0]).toEqual({
		method: "GET",
		path: "/api/v1/search",
		body: null,
		query: { query, page: "1", per_page: "1" },
	});
	const second = await run(first.next);
	expect(second.status).toBe(0);
	expect(JSON.parse(second.stdout)).toEqual({
		items: [fixtures.keyword.hits[1]],
		has_more: false,
	});
	const projected = JSON.parse(
		(
			await run([
				"search",
				"early bird",
				"--keyword",
				"--limit",
				"1",
				"--fields",
				"id,title",
			])
		).stdout,
	);
	expect(JSON.parse((await run(projected.next)).stdout)).toEqual({
		items: [{ id: "early-bird-workshop-2", title: "Early bird pricing" }],
		has_more: false,
	});
	const terminal = await run(
		["search", "early bird", "--keyword", "--fields", "id,title"],
		{ tty: true },
	);
	expect(terminal.stdout).toContain("ID");
	expect(terminal.stdout).toContain("TITLE");
	expect(terminal.stdout).toContain(
		"550e8400-e29b-41d4-a716-446655440000_1_5000-10000",
	);
	expect(
		(
			await run(["search", "early bird", "--keyword", "--page", "3"], {
				tty: true,
			})
		).stdout,
	).toBe("No results.\n");
});

test("401 envelopes, generic 403 and AI entitlement use stable errors and specific hints", async () => {
	for (const [body, status, code, hint] of [
		[
			fixtures.unauthorized,
			401,
			"not_authenticated",
			"Set BOLDVIDEO_API_KEY or run boldvideo login --token <key>. Create a key in Bold: Settings → Developer.",
		],
		[fixtures.forbidden, 403, "not_permitted", "boldvideo login --help"],
		[
			fixtures.entitlement,
			403,
			"not_permitted",
			"Enable the AI (ai) feature in your Bold account settings, then run boldvideo whoami.",
		],
	] as const) {
		failure = Response.json(body, {
			status,
			headers: { "x-request-id": "req_ai_2033" },
		});
		for (const command of ["ask", "search"]) {
			const result = await run([command, "Workshop pricing"]);
			expect(result.status).toBe(3);
			expect(result.stdout).toBe("");
			expect(JSON.parse(result.stderr)).toEqual({
				code,
				message: "message" in body ? body.message : body.error,
				hint: `${hint}\nRead: boldvideo docs cli`,
				docs: `https://docs.boldvideo.com/cli#${code.replaceAll("_", "-")}`,
				request_id: "req_ai_2033",
			});
		}
	}
});
