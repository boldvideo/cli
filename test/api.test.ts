import { afterAll, beforeEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request } from "../src/api";
import fixture from "./fixtures/api.json";

const home = mkdtempSync(join(tmpdir(), "boldvideo-api-"));
const key = "bold_test_escape_hatch_2030";
const calls: {
	method: string;
	path: string;
	headers: Headers;
	body: unknown;
}[] = [];
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request): Promise<Response> {
		const url = new URL(request.url);
		const raw = await request.text();
		const body = raw ? JSON.parse(raw) : null;
		calls.push({
			method: request.method,
			path: url.pathname + url.search,
			headers: request.headers,
			body,
		});
		if (url.pathname === "/api/openapi") return Response.json(fixture.spec);
		if (url.pathname === "/api/v1/videos") return Response.json(fixture.videos);
		if (url.pathname === "/api/v1/fail")
			return Response.json(fixture.failure, {
				status: Number(url.searchParams.get("status")),
				headers: { "x-request-id": "req_header_2030" },
			});
		if (url.pathname === "/api/v1/plain-error")
			return new Response("Temporarily unavailable", { status: 503 });
		if (url.pathname === "/api/v1/empty")
			return new Response(null, { status: 204 });
		if (url.pathname === "/api/v1/invalid") return new Response("not json");
		if (url.pathname === "/api/v1/redirect")
			return Response.redirect(`${server.url}api/v1/echo`);
		if (url.pathname === "/api/v1/meta" || url.pathname === "/api/v1/links") {
			const second = url.searchParams.get("page") === "2";
			const page = second ? fixture.last : fixture.videos;
			if (url.pathname.endsWith("meta")) return Response.json(page);
			return Response.json(
				{ data: page.data },
				{
					headers: second
						? {}
						: {
								Link: `</api/v1/links?page=1>; rel="prev", <${server.url}api/v1/links?page=2>; type="application/json"; rel="next last"`,
							},
				},
			);
		}
		if (url.pathname === "/api/v1/unsafe")
			return Response.json(
				{ data: [] },
				{ headers: { Link: '<https://example.com/stolen>; rel="next"' } },
			);
		if (url.pathname === "/api/v1/cycle")
			return Response.json(
				{ data: [] },
				{ headers: { Link: '</api/v1/cycle>; rel="next"' } },
			);
		return Response.json({
			method: request.method,
			body,
			query: [...url.searchParams],
		});
	},
});
const base = `${server.url}api/v1`;

beforeEach(() => {
	calls.length = 0;
});
afterAll(() => {
	server.stop(true);
	rmSync(home, { recursive: true, force: true });
});

async function run(args: string[], input = "", tty = false) {
	const argv = ["node", resolve("dist/boldvideo.js"), "api", ...args];
	const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;
	const child = spawn(
		tty ? "script" : "node",
		tty ? ["-qefc", argv.map(quote).join(" "), "/dev/null"] : argv.slice(1),
		{
			env: {
				...process.env,
				BOLDVIDEO_API_KEY: key,
				BOLDVIDEO_API_URL: `${base}/`,
				XDG_CONFIG_HOME: home,
				APPDATA: home,
				NO_COLOR: "1",
			},
			stdio: "pipe",
		},
	);
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (data) => {
		stdout += data;
	});
	child.stderr.on("data", (data) => {
		stderr += data;
	});
	child.stdin.end(input);
	const status = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	return { status, stdout: stdout.replaceAll("\r\n", "\n"), stderr };
}

test("GET passes through JSON, uses the active key and pretty prints on terminals", async () => {
	const result = await run(["GET", "/videos"]);
	expect(result).toEqual({
		status: 0,
		stdout: `${JSON.stringify(fixture.videos)}\n`,
		stderr: "",
	});
	expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${key}`);
	expect(calls[0]?.headers.get("x-bold-admin-api-key")).toBeNull();
	expect((await run(["GET", "/videos"], "", true)).stdout).toBe(
		`${JSON.stringify(fixture.videos, null, 2)}\n`,
	);
	expect((await run(["GET", "/videos", "--json"], "", true)).stdout).toBe(
		`${JSON.stringify(fixture.videos)}\n`,
	);
	expect((await run(["DELETE", "/empty", "--yes"])).stdout).toBe("null\n");
});

test("body fields preserve strings and JSON types; query values repeat without losing commas or equals", async () => {
	for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
		const result = await run([
			method,
			"/echo?tag=existing",
			"--yes",
			"-f",
			"title= Paid, workshops ",
			"-f",
			"code=001=2",
			"-F",
			"count=3",
			"-F",
			"enabled=false",
			"-F",
			"missing=null",
			"-F",
			'tags=["sales","coaching"]',
			"-q",
			"tag=paid,live",
			"-q",
			"tag=a=b",
		]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			method,
			body: {
				title: " Paid, workshops ",
				code: "001=2",
				count: 3,
				enabled: false,
				missing: null,
				tags: ["sales", "coaching"],
			},
			query: [
				["tag", "existing"],
				["tag", "paid,live"],
				["tag", "a=b"],
			],
		});
		expect(calls.at(-1)?.headers.get("content-type")).toBe("application/json");
	}
});

test("whole input bodies come from files or stdin, including arrays and null", async () => {
	const file = resolve("test/fixtures/api.json");
	expect(
		JSON.parse((await run(["POST", "/echo", "--input", file])).stdout).body,
	).toEqual(fixture);
	for (const body of [fixture.body, [false, 7, "video"], null]) {
		const result = await run(
			["PATCH", "/echo", "--input", "-"],
			JSON.stringify(body),
		);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).body).toEqual(body);
	}
});

test("pagination concatenates both conventions, stops at limits and projects fields", async () => {
	for (const path of ["/links", "/meta"]) {
		for (const limit of [1, 2, 3, 10]) {
			calls.length = 0;
			const result = await run([
				"GET",
				`${path}?kind=training`,
				"--paginate",
				"--limit",
				String(limit),
			]);
			expect(result.status).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual(
				[...fixture.videos.data, ...fixture.last.data].slice(0, limit),
			);
			expect(calls.length).toBe(limit <= 2 ? 1 : 2);
			if (path === "/meta" && limit > 2)
				expect(calls[1]?.path).toBe("/api/v1/meta?kind=training&page=2");
		}
	}
	const selected = await run(["GET", "/meta", "--paginate", "--fields", "id"]);
	expect(JSON.parse(selected.stdout)).toEqual([
		{ id: "paid-workshops" },
		{ id: "sales-onboarding" },
		{ id: "pricing-masterclass" },
	]);
	const bounded = await run(
		["GET", "/meta?kind=training", "--paginate", "--limit", "1"],
		"",
		true,
	);
	expect(bounded.stdout).toContain(
		"More results (repeat with a larger limit): boldvideo 'api' 'GET' '/meta?kind=training' '--paginate' '--limit' '1' '--limit' '2'",
	);
	expect(
		JSON.parse(
			(
				await run([
					"GET",
					"/meta?kind=training",
					"--paginate",
					"--limit",
					"1",
					"--limit",
					"2",
				])
			).stdout,
		),
	).toEqual(fixture.videos.data);
});

test("live OpenAPI discovery filters paths and summaries, tables, and supplies a continuation", async () => {
	const result = await run(["--list", "videos"]);
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({
		items: [
			{ method: "GET", path: "/videos", summary: "List videos" },
			{ method: "POST", path: "/videos", summary: "Import a video" },
			{
				method: "GET",
				path: "/collections",
				summary: "Find collections containing videos",
			},
		],
		has_more: false,
	});
	expect(calls[0]?.path).toBe("/api/openapi");
	const page = JSON.parse(
		(await run(["--list", "videos", "--limit", "1", "--fields", "method,path"]))
			.stdout,
	);
	expect(page.items).toEqual([{ method: "GET", path: "/videos" }]);
	expect(page.next).toBe(
		"boldvideo api --list 'videos' --offset 1 --limit 1 --fields 'method,path'",
	);
	expect(
		JSON.parse(
			(
				await run([
					"--list",
					"videos",
					"--offset",
					"1",
					"--limit",
					"1",
					"--fields",
					"method,path",
				])
			).stdout,
		).items,
	).toEqual([{ method: "POST", path: "/videos" }]);
	expect((await run(["--list", "viewers"], "", true)).stdout).toContain(
		"METHOD  PATH      SUMMARY\nGET     /viewers  List viewers",
	);
	expect(
		JSON.parse((await run(["--list", "nonexistent"])).stdout).items,
	).toEqual([]);
});

test("HTTP failures preserve details and request IDs with stable codes and exits", async () => {
	for (const [status, code, exit] of [
		[401, "not_authenticated", 3],
		[403, "not_permitted", 3],
		[404, "not_found", 4],
		[422, "api_error", 1],
		[500, "api_error", 1],
		[408, "timed_out", 5],
		[504, "timed_out", 5],
	] as const) {
		const result = await run(["GET", `/fail?status=${status}`]);
		expect(result.status).toBe(exit);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toEqual({
			code,
			message: fixture.failure.message,
			hint:
				status === 401 || status === 403
					? "boldvideo login --help"
					: "boldvideo api --help",
			docs: `https://docs.boldvideo.com/cli#${code.replaceAll("_", "-")}`,
			request_id: "req_header_2030",
			details: fixture.failure,
		});
	}
	expect(JSON.parse((await run(["GET", "/plain-error"])).stderr).details).toBe(
		"Temporarily unavailable",
	);
});

test("DELETE refuses piped calls and previews without --yes; dry-run redacts both auth headers and makes no request", async () => {
	for (const extra of [[], ["--dry-run"]]) {
		const result = await run(["DELETE", "/videos/paid-workshops", ...extra]);
		expect(result.status).toBe(2);
		expect(JSON.parse(result.stderr).code).toBe("confirmation_required");
	}
	const result = await run([
		"DELETE",
		"/admin/videos/paid-workshops?notify=false",
		"--dry-run",
		"--yes",
		"-f",
		"reason=Duplicate recording",
	]);
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({
		dry_run: true,
		method: "DELETE",
		url: `${base}/admin/videos/paid-workshops?notify=false`,
		headers: {
			Authorization: "Bearer [REDACTED]",
			Accept: "application/json",
			"X-Bold-Admin-Api-Key": "[REDACTED]",
			"Content-Type": "application/json",
		},
		body: { reason: "Duplicate recording" },
	});
	expect(result.stdout + result.stderr).not.toContain(key);
	expect(calls).toHaveLength(0);
});

test("escape hatch and shared request send Bearer everywhere and the admin header only on admin paths", async () => {
	for (const path of ["/admin/videos", "/videos"]) {
		expect((await run(["GET", path])).status).toBe(0);
		const previous = process.env.BOLDVIDEO_API_URL;
		process.env.BOLDVIDEO_API_URL = base;
		try {
			await request("GET", path, { key });
		} finally {
			if (previous === undefined) delete process.env.BOLDVIDEO_API_URL;
			else process.env.BOLDVIDEO_API_URL = previous;
		}
		for (const call of calls.slice(-2)) {
			expect(call.headers.get("authorization")).toBe(`Bearer ${key}`);
			expect(call.headers.get("x-bold-admin-api-key")).toBe(
				path.startsWith("/admin") ? key : null,
			);
		}
	}
});

test("invalid inputs and unsafe URLs fail before requests; redirects and unsafe pagination never forward keys", async () => {
	for (const args of [
		["GET"],
		["HEAD", "/videos"],
		["POST", "/echo", "-f", "missing"],
		["POST", "/echo", "-F", "count=three"],
		["POST", "/echo", "--input", "-", "-f", "title=Training"],
		["POST", "/echo", "--input", "-"],
		["GET", "/echo", "-f", "title=Training"],
		["GET", "/../outside"],
		["GET", "https://example.com/stolen"],
		["--list", "--offset=-1"],
	]) {
		const result = await run(args);
		expect(result.status).toBe(2);
		expect(JSON.parse(result.stderr).code).toBe("usage_error");
	}
	expect(calls).toHaveLength(0);
	for (const path of ["/invalid", "/redirect", "/unsafe", "/cycle"]) {
		const result = await run([
			"GET",
			path,
			...(path === "/unsafe" || path === "/cycle" ? ["--paginate"] : []),
		]);
		expect(result.status).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).not.toContain(key);
	}
	expect(calls.some((call) => call.path === "/api/v1/echo")).toBe(false);
});
