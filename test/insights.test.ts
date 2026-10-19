import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import questions from "./fixtures/insights-questions.json";
import me from "./fixtures/me.json";
import { type RunOptions, run } from "./run";

const temporary = mkdtempSync(join(tmpdir(), "boldvideo-insights-"));
const built = resolve("dist/boldvideo.js");
const queries: Record<string, string>[] = [];
let override: Response | undefined;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/api/v1/me") {
			return Response.json({
				data: {
					...me.data,
					key: {
						...me.data.key,
						kind:
							request.headers.get("authorization") === "Bearer test-tenant"
								? "tenant"
								: "admin",
					},
				},
			});
		}
		if (
			url.pathname !== "/api/v1/admin/insights/questions" ||
			request.method !== "GET"
		)
			return new Response("Not found", { status: 404 });
		// Exercise the mandated shared transport, not live auth compatibility:
		// BOLD_admin #723 currently requires a different admin-key header.
		if (request.headers.get("authorization") !== "Bearer test-admin")
			return Response.json(
				{ message: "Invalid test credential" },
				{ status: 401 },
			);
		queries.push(Object.fromEntries(url.searchParams));
		if (override) return override.clone();
		const page = Number(url.searchParams.get("page"));
		const size = Number(url.searchParams.get("page_size"));
		return Response.json({
			data: questions.data.slice((page - 1) * size, page * size),
			meta: {
				...questions.meta,
				page,
				page_size: size,
				total_pages: Math.ceil(questions.data.length / size),
			},
		});
	},
});
const env = {
	BOLDVIDEO_API_KEY: "test-admin",
	BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}/api/v1`,
	XDG_CONFIG_HOME: temporary,
	APPDATA: temporary,
	TZ: "Europe/Madrid",
	LANG: "en_US.UTF-8",
};
function invoke(args: string[] = [], options: RunOptions = {}) {
	return run(["node", built, "insights", "questions", ...args], {
		...options,
		env: { ...env, ...options.env },
	});
}
beforeEach(() => {
	queries.length = 0;
	override = undefined;
});
afterAll(() => {
	server.stop(true);
	rmSync(temporary, { recursive: true, force: true });
});

test("default window and JSON retain complete items, IDs, null and empty sources", async () => {
	const result = await invoke();
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	expect(queries).toEqual([{ since: "7d", page: "1", page_size: "20" }]);
	expect(JSON.parse(result.stdout)).toEqual({
		items: questions.data,
		has_more: false,
	});
	const forced = await invoke(
		["--json", "--fields", "id,sources,future_field"],
		{ tty: true },
	);
	expect(forced.status).toBe(0);
	expect(JSON.parse(forced.stdout).items[0]).toEqual({
		id: "q_9d7b8e2a-full-id",
		sources: questions.data[0]?.sources,
		future_field: { retained: true },
	});
});

test("explicit windows pass through verbatim and every filter maps to its API name", async () => {
	const result = await invoke([
		"--since",
		"2026-10-01T10:30:00+02:00",
		"--until",
		"2026-10-08",
		"--collection",
		"a31c608a-2ab7-457f-8734-4f8f055d2e08",
		"--video",
		"pricing-workshops",
		"--kind",
		"library_ask",
		"--channel",
		"portal",
		"--outcome",
		"missing",
		"--status",
		"resolved",
		"--reason",
		"no_sources",
		"--needs-a-look",
		"--include-team",
		"--include-noise",
		"--include-pending",
		"--limit",
		"100",
		"--page",
		"2",
	]);
	expect(result.status).toBe(0);
	expect(queries).toEqual([
		{
			since: "2026-10-01T10:30:00+02:00",
			until: "2026-10-08",
			collection: "a31c608a-2ab7-457f-8734-4f8f055d2e08",
			video: "pricing-workshops",
			kind: "library_ask",
			channel: "portal",
			outcome: "missing",
			status: "resolved",
			reason: "no_sources",
			needs_a_look: "true",
			include_team: "true",
			include_noise: "true",
			include_pending: "true",
			page_size: "100",
			page: "2",
		},
	]);
	expect((await invoke(["--since", "24h", "--until", "1h"])).status).toBe(0);
	expect(queries[1]).toMatchObject({ since: "24h", until: "1h" });
});

test("pagination freezes the server window and shell-quotes filters, profile and fields", async () => {
	const filter = "Director's workshop; $(exit 9)";
	const args = [
		"--limit",
		"2",
		"--video",
		filter,
		"--fields",
		"outcome,count",
		"--profile",
		"admin-team",
		"--include-noise",
		"--group-by",
		"outcome",
	];
	const first = await invoke(args);
	expect(first.status).toBe(0);
	const page = JSON.parse(first.stdout);
	expect(page.has_more).toBe(true);
	expect(page.items).toEqual([{ outcome: "answered", count: 2 }]);
	expect(page.next).toContain("--since '2026-10-12T12:00:00Z'");
	expect(page.next).toContain("--until '2026-10-19T12:00:00Z'");
	expect(page.next).toContain("--page '2'");
	const next = await run(
		["sh", "-c", page.next.replace("boldvideo", `node '${built}'`)],
		{ env },
	);
	expect(next.status).toBe(0);
	expect(queries[1]).toEqual({
		...queries[0],
		page: "2",
		since: questions.meta.since,
		until: questions.meta.until,
	});
	expect(JSON.parse(next.stdout).next).toContain("--group-by 'outcome'");
	expect(JSON.parse(next.stdout).next).toContain("--profile 'admin-team'");
	expect(JSON.parse(next.stdout).items).toEqual([
		{ outcome: "not_answered", count: 1 },
		{ outcome: "(unobserved)", count: 1 },
	]);
	const last = await run(
		[
			"sh",
			"-c",
			JSON.parse(next.stdout).next.replace("boldvideo", `node '${built}'`),
		],
		{ env },
	);
	expect(last.status).toBe(0);
	expect(JSON.parse(last.stdout)).toEqual({
		items: [{ outcome: "answered", count: 1 }],
		has_more: false,
	});
	const terminal = await invoke(["--limit", "2"], { tty: true });
	expect(terminal.status).toBe(0);
	expect(terminal.stdout).toContain(
		"More results: boldvideo insights questions",
	);
	expect(terminal.stdout).toContain("--until '2026-10-19T12:00:00Z'");
});

test("grouping counts only the fetched page and deduplicates videos within a question", async () => {
	for (const [group, expected] of [
		[
			"video",
			[
				{ video: "pricing-workshops", count: 2 },
				{ video: "team-coaching", count: 2 },
				{ video: "(none)", count: 1 },
				{ video: "(unobserved)", count: 1 },
			],
		],
		[
			"outcome",
			[
				{ outcome: "answered", count: 3 },
				{ outcome: "not_answered", count: 1 },
				{ outcome: "(unobserved)", count: 1 },
			],
		],
		[
			"day",
			[
				{ day: "2026-10-19", count: 3 },
				{ day: "2026-10-18", count: 2 },
			],
		],
	] as const) {
		const result = await invoke(["--group-by", group]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			items: expected,
			has_more: false,
		});
	}
	const bounded = await invoke(["--group-by", "outcome", "--limit", "2"]);
	expect(JSON.parse(bounded.stdout).items).toEqual([
		{ outcome: "answered", count: 2 },
	]);
	const terminal = await invoke(["--group-by", "outcome"], { tty: true });
	expect(terminal.stdout).toContain("OUTCOME");
	expect(terminal.stdout).toContain("answered");
	expect(terminal.stdout).toContain("3");
});

test("terminal table fits the width, uses local time and distinguishes unobserved sources", async () => {
	for (const columns of [70, 100]) {
		const result = await invoke([], { tty: true, columns, stderr: "pipe" });
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const lines = result.stdout.trimEnd().split("\n");
		expect(lines[0]).toMatch(/^ASKED\s+VIEWER\s+QUESTION\s+OUTCOME\s+SOURCES$/);
		expect(lines[1]).toContain("10/19/26, 12:15 PM");
		expect(lines[1]).toContain("…");
		expect(lines[1]).toMatch(/answered\s+3$/);
		expect(lines[3]).toMatch(/not_answered\s+0$/);
		expect(lines[4]).toMatch(/—\s+\?$/);
		for (const line of lines)
			expect(Array.from(line).length).toBeLessThanOrEqual(columns);
	}
	const empty = await invoke(["--page", "2"], { tty: true });
	expect(empty.status).toBe(0);
	expect(empty.stdout.trim()).toMatch(
		/^ASKED\s+VIEWER\s+QUESTION\s+OUTCOME\s+SOURCES$/,
	);
});

test("invalid duration and pagination use standard usage errors", async () => {
	for (const args of [
		["--since", "a-week"],
		["--until", "7w"],
		["--since", "2026-99-99"],
		["--since", "2026-02-30"],
		["--since", "0d"],
		["--since", "01h"],
		["--since", "2026-10-19T12:00:00"],
		["--page", "1.5"],
		["--page", "0"],
		["--limit", "101"],
		["--group-by", "viewer"],
		["--format", "html"],
		["--format", "md", "--group-by", "video"],
		["--format", "md", "--fields", "question"],
	]) {
		const result = await invoke(args);
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "usage_error",
			hint: "boldvideo insights questions --help",
			docs: "https://docs.boldvideo.com/cli#usage-error",
		});
		if (["--since", "--until"].includes(args[0] ?? ""))
			expect(JSON.parse(result.stderr).message).toContain(
				"ISO 8601 timestamp, YYYY-MM-DD date, or Nd/Nh duration",
			);
	}
	expect(queries).toHaveLength(0);
});

test("explicit Markdown is report-ready in pipes and terminals; JSON still wins", async () => {
	const expected = [
		"- 2026-10-19 — Marcel: How can I price a paid workshop for a team with several departments and different learning goals?  ",
		"  Sources: Pricing workshops (00:42), Pricing workshops (01:30), Team coaching (00:15)",
		"- 2026-10-19 — Ana: Can I offer team discounts?  ",
		"  Sources: Pricing workshops (01:00)",
		"- 2026-10-19 — Lee: Do you cover refunds?  ",
		"  Sources: None",
		"- 2026-10-18 — Anonymous viewer: What about certification?  ",
		"  Sources: Unobserved",
		"- 2026-10-18 — Jules: How long is a session?  ",
		"  Sources: Team coaching (00:30)",
		"",
	].join("\n");
	for (const tty of [false, true]) {
		const result = await invoke(["--format", "md"], { tty });
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe(expected);
		const json = await invoke(["--format", "md", "--json"], { tty });
		expect(json.status).toBe(0);
		expect(JSON.parse(json.stdout)).toEqual({
			items: questions.data,
			has_more: false,
		});
	}
	expect(queries.every((query) => query.format === undefined)).toBe(true);
	const paged = await invoke(["--format", "md", "--limit", "2"], { tty: true });
	expect(paged.stdout).toContain("--format 'md'");
	expect(paged.stdout).toContain("--since '2026-10-12T12:00:00Z'");
	expect(paged.stdout).not.toContain("Do you cover refunds?");
	const empty = await invoke(["--format", "md", "--page", "2"]);
	expect(empty).toMatchObject({ status: 0, stdout: "\n", stderr: "" });
});

test("Markdown escapes report content and handles zero, fractional and unknown timestamps", async () => {
	override = Response.json({
		...questions,
		data: [
			{
				...questions.data[0],
				viewer: { id: "report-viewer", display_name: "Ana *team*" },
				question: "Why?\n- <script> [notes]",
				sources: [
					{ video_id: "intro", title: "Intro (part 1)", timestamp: 0 },
					{
						video_id: "long-session",
						title: "Long session",
						timestamp: 3605.9,
					},
					{ video_id: "untitled-session", title: null, timestamp: null },
				],
			},
		],
	});
	const result = await invoke(["--format", "md"]);
	expect(result.status).toBe(0);
	expect(result.stdout).toBe(
		"- 2026-10-19 — Ana \\*team\\*: Why? - \\<script\\> \\[notes\\]  \n  Sources: Intro \\(part 1\\) (00:00), Long session (60:05), untitled-session\n",
	);
});

test("tenant keys and endpoint 401/403 errors exit 3 with an admin-key hint", async () => {
	const tenant = await invoke([], {
		env: { BOLDVIDEO_API_KEY: "test-tenant" },
	});
	expect(tenant.status).toBe(3);
	expect(JSON.parse(tenant.stderr).hint).toContain("admin key is required");
	expect(queries).toHaveLength(0);
	for (const status of [401, 403]) {
		override = Response.json(
			{ message: "Admin access required" },
			{ status, headers: { "x-request-id": "req_insights" } },
		);
		const result = await invoke();
		expect(result.status).toBe(3);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: status === 401 ? "not_authenticated" : "not_permitted",
			request_id: "req_insights",
			hint: expect.stringContaining("boldvideo login --token <admin-key>"),
		});
	}
});

test("an invalid future backend envelope fails as an API error rather than silently dropping data", async () => {
	for (const body of [
		null,
		{ data: [], meta: {} },
		{ ...questions, data: [{ ...questions.data[0], sources: {} }] },
	]) {
		override = Response.json(body);
		const result = await invoke();
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr).code).toBe("api_error");
	}
});
