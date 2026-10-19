import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import me from "./fixtures/me.json";
import fixture from "./fixtures/viewers.json";
import members from "./fixtures/viewers-sync.json";
import { type RunOptions, run } from "./run";

const temporary = mkdtempSync(join(tmpdir(), "boldvideo-viewers-"));
type Row = Record<string, unknown>;
let viewers: Row[];
let memory: Row;
let features = { viewers: true, viewer_memory: true, mcp: true };
let identityStatus = 200;
let active = 0;
let peak = 0;
const requests: {
	path: string;
	method: string;
	query: Record<string, string>;
	at: number;
}[] = [];
const rates = new Map<
	string,
	{ remaining: number; retry: string; status?: number }
>();
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const path = url.pathname.replace("/api/v1", "");
		requests.push({
			path,
			method: request.method,
			query: Object.fromEntries(url.searchParams),
			at: Date.now(),
		});
		if (
			request.headers.get("authorization") !== "Bearer bold_test_viewers_2037"
		)
			return Response.json({ message: "Bad credentials" }, { status: 401 });
		if (path === "/me")
			return Response.json(
				{ data: { ...me.data, features } },
				{ status: identityStatus },
			);
		active++;
		peak = Math.max(peak, active);
		try {
			await Bun.sleep(15);
			const externalId = url.searchParams.get("external_id");
			const rate = rates.get(externalId ?? path);
			if (rate && rate.remaining-- > 0)
				return Response.json(
					{ message: "Try later" },
					{
						status: rate.status ?? 429,
						headers: {
							"Retry-After": rate.retry,
							"x-request-id": "req_sync_rate",
						},
					},
				);
			if (path === "/viewers/lookup") {
				if (externalId === "member_rejected")
					return Response.json(
						{ error: { message: "Member is blocked" } },
						{ status: 403, headers: { "x-request-id": "req_sync_rejected" } },
					);
				const viewer = viewers.find((row) =>
					externalId
						? row.external_id === externalId
						: row.email === url.searchParams.get("email"),
				);
				return Response.json(
					viewer ? { data: viewer } : { message: "Viewer not found" },
					{ status: viewer ? 200 : 404 },
				);
			}
			if (path === "/viewers" && request.method === "GET") {
				const page = Number(url.searchParams.get("page"));
				const size = Number(url.searchParams.get("page_size"));
				return Response.json({
					data: viewers.slice((page - 1) * size, page * size),
					meta: {
						page,
						page_size: size,
						total_entries: viewers.length,
						total_pages: Math.ceil(viewers.length / size),
					},
				});
			}
			if (path === "/viewers" && request.method === "POST") {
				const { viewer } = (await request.json()) as { viewer: Row };
				if (viewers.some((row) => row.external_id === viewer.external_id))
					return Response.json(
						{ message: "Duplicate external ID" },
						{ status: 422 },
					);
				const row = {
					id: `32345678-1234-1234-1234-${String(viewers.length).padStart(12, "0")}`,
					...viewer,
				};
				viewers.push(row);
				return Response.json({ data: row }, { status: 201 });
			}
			const viewer = viewers.find((row) => path.split("/")[2] === row.id);
			if (!viewer)
				return Response.json({ message: "Viewer not found" }, { status: 404 });
			if (path.endsWith("/memory")) {
				if (request.method === "DELETE") {
					memory.content = null;
					return new Response(null, { status: 204 });
				}
				if (request.method === "PATCH") {
					const body = await request.json();
					if (Object.keys(body.memory).join() !== "enabled")
						return Response.json(
							{ message: "Only enabled may be changed" },
							{ status: 422 },
						);
					memory.enabled = body.memory.enabled;
				}
				return Response.json({ data: memory });
			}
			if (path.includes("/progress"))
				return Response.json(
					path.endsWith("/progress")
						? fixture.progress
						: {
								data: fixture.progress.data.find((row) =>
									path.endsWith(`/${row.video_id}`),
								),
							},
				);
			if (request.method === "PATCH")
				Object.assign(viewer, (await request.json()).viewer);
			return Response.json({ data: viewer });
		} finally {
			active--;
		}
	},
});

beforeEach(() => {
	viewers = structuredClone(fixture.list.data);
	memory = structuredClone(fixture.memory.data);
	features = { viewers: true, viewer_memory: true, mcp: true };
	identityStatus = 200;
	requests.length = 0;
	rates.clear();
	active = 0;
	peak = 0;
});
afterAll(() => {
	server.stop(true);
	rmSync(temporary, { recursive: true, force: true });
});

function cli(args: string[], options: RunOptions = {}) {
	return run(["node", resolve("dist/boldvideo.js"), "viewers", ...args], {
		...options,
		env: {
			BOLDVIDEO_API_KEY: "bold_test_viewers_2037",
			BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}/api/v1`,
			XDG_CONFIG_HOME: temporary,
			APPDATA: temporary,
			...options.env,
		},
	});
}
const writes = () => requests.filter((row) => row.method !== "GET");

test("list bounds pages, preserves fields/profile in continuation, and formats terminal columns", async () => {
	const result = await cli([
		"list",
		"--limit",
		"1",
		"--fields",
		"id,email",
		"--profile",
		"Acme's team",
		"--json",
	]);
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	const page = JSON.parse(result.stdout);
	expect(page.items).toEqual([
		{ id: fixture.list.data[0]?.id, email: "maria@acme.com" },
	]);
	expect(page.has_more).toBe(true);
	expect(page.next).toContain("--profile 'Acme'\\''s team'");
	const next = await run(
		[
			"sh",
			"-c",
			page.next.replace(/^boldvideo/, `node '${resolve("dist/boldvideo.js")}'`),
		],
		{
			env: {
				BOLDVIDEO_API_KEY: "bold_test_viewers_2037",
				BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}/api/v1`,
			},
		},
	);
	expect(next.status).toBe(0);
	expect(JSON.parse(next.stdout)).toEqual({
		items: [{ id: fixture.list.data[1]?.id, email: "alex@acme.com" }],
		has_more: false,
	});
	const terminal = await cli(["list"], { tty: true });
	expect(terminal.status).toBe(0);
	expect(terminal.stdout).toMatch(/ID\s+EXTERNAL_ID\s+EMAIL\s+NAME\s+CREATED/);
	expect(terminal.stdout).toContain(fixture.list.data[0]?.id ?? "");
	for (const page of ["0", "1.5", "-1"])
		expect((await cli(["list", `--page=${page}`])).status).toBe(2);
});

test("get resolves UUID, email and external ID without changing API record keys", async () => {
	for (const id of [
		"12345678-1234-1234-1234-123456789abc",
		"maria@acme.com",
		"member_2048",
	]) {
		const result = await cli(["get", id]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual(fixture.list.data[0]);
	}
	expect(
		requests
			.filter((row) => row.path === "/viewers/lookup")
			.map((row) => row.query),
	).toEqual([{ email: "maria@acme.com" }, { external_id: "member_2048" }]);
	expect((await cli(["get", "absent_member"])).status).toBe(4);
});

test("sync applies creates/updates, compares nested traits independent of key order, and continues failures", async () => {
	const result = await cli(["sync", "test/fixtures/viewers-sync.json"]);
	expect(result.status).toBe(1);
	expect(result.stderr).toBe("");
	const rows = JSON.parse(result.stdout);
	expect(rows.map((row: Row) => row.action)).toEqual([
		"created",
		"updated",
		"unchanged",
		"failed",
		"failed",
	]);
	expect(rows[3].error).toMatchObject({
		code: "not_permitted",
		message: "Member is blocked",
		request_id: "req_sync_rejected",
		hint: "boldvideo viewers sync --help",
		docs: "https://docs.boldvideo.com/cli#not-permitted",
	});
	expect(rows[4].error.code).toBe("usage_error");
	expect(
		viewers.find((row) => row.external_id === "member_2050"),
	).toMatchObject(members[0] as object);
	expect(
		viewers.find((row) => row.external_id === "member_2049"),
	).toMatchObject(members[1] as object);
	expect(viewers.find((row) => row.external_id === "member_2048")).toEqual(
		fixture.list.data[0],
	);
	expect(writes()).toHaveLength(2);
	expect(peak).toBeGreaterThan(1);
	expect(peak).toBeLessThanOrEqual(4);
});

test("sync dry-run shows ordered actions without writes, in JSON and terminal summary", async () => {
	for (const tty of [false, true]) {
		const result = await cli(
			["sync", "test/fixtures/viewers-sync.json", "--dry-run"],
			{ tty },
		);
		expect(result.status).toBe(1);
		if (!tty)
			expect(JSON.parse(result.stdout).map((row: Row) => row.action)).toEqual([
				"created",
				"updated",
				"unchanged",
				"failed",
				"failed",
			]);
		else
			expect(result.stdout).toContain(
				"Dry run: 1 created, 1 updated, 1 unchanged, 2 failed.",
			);
	}
	expect(writes()).toHaveLength(0);
	expect(viewers).toEqual(fixture.list.data);
});

test("sync accepts CSV file and stdin with quotes/traits, JSON stdin, and safe duplicate IDs", async () => {
	const result = await cli(["sync", "test/fixtures/viewers-sync.csv"]);
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout).map((row: Row) => row.action)).toEqual([
		"created",
		"unchanged",
	]);
	expect(viewers[2]).toMatchObject({
		name: 'Sam "Coach", Rivera',
		traits: { plan: "pro" },
	});
	const piped = await cli(["sync", "-"], {
		input: readFileSync("test/fixtures/viewers-sync.csv", "utf8"),
	});
	expect(piped.status).toBe(0);
	expect(JSON.parse(piped.stdout).map((row: Row) => row.action)).toEqual([
		"unchanged",
		"unchanged",
	]);
	const duplicate = [
		{ external_id: "member_new", name: "New Member" },
		{ external_id: "member_new", name: "New Member" },
		{ external_id: "member_new", name: "Updated Member" },
	];
	for (const dry of [true, false]) {
		const result = await cli(["sync", "-", ...(dry ? ["--dry-run"] : [])], {
			input: JSON.stringify(duplicate),
		});
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).map((row: Row) => row.action)).toEqual([
			"created",
			"unchanged",
			"updated",
		]);
	}
	expect(viewers.filter((row) => row.external_id === "member_new")).toEqual([
		expect.objectContaining({ name: "Updated Member" }),
	]);
	const multiline = await cli(["sync", "-"], {
		input: '\uFEFFexternal_id,name\r\nmember_multiline,"Sam\nRivera"\r\n',
	});
	expect(multiline.status).toBe(0);
	expect(
		viewers.find((row) => row.external_id === "member_multiline")?.name,
	).toBe("Sam\nRivera");
});

test("sync rejects malformed files without writes and continues invalid JSON rows", async () => {
	for (const input of [
		'external_id,name\nmember_1,"unclosed',
		"external_id,name\nmember_1",
		'{"viewers":[]}',
		"external_id,external_id\na,b",
	]) {
		const result = await cli(["sync", "-"], { input });
		expect(result.status).toBe(2);
		expect(JSON.parse(result.stderr).code).toBe("usage_error");
	}
	const result = await cli(["sync", "-"], {
		input: JSON.stringify([
			null,
			42,
			[],
			{ external_id: "", name: "Invalid" },
			{ external_id: "valid_member", name: "Valid Member" },
		]),
	});
	expect(result.status).toBe(1);
	expect(JSON.parse(result.stdout).map((row: Row) => row.action)).toEqual([
		"failed",
		"failed",
		"failed",
		"failed",
		"created",
	]);
	expect(writes()).toHaveLength(1);
	const csv = await cli(["sync", "-"], {
		input:
			'external_id,name,traits\ninvalid_traits,Invalid Member,not-json\nvalid_traits,Valid Member,"{}"\n',
	});
	expect(csv.status).toBe(1);
	expect(JSON.parse(csv.stdout).map((row: Row) => row.action)).toEqual([
		"failed",
		"created",
	]);
	expect(JSON.parse(csv.stdout)[0].error.code).toBe("usage_error");
	expect(
		viewers.find((row) => row.external_id === "valid_traits")?.traits,
	).toEqual({});
});

test("sync retries 429 once with Retry-After seconds and HTTP date, never retries other failures", async () => {
	for (const [id, retry] of [
		["seconds", "0.12"],
		["date", new Date(Date.now() + 2200).toUTCString()],
	]) {
		rates.set(id as string, { remaining: 1, retry: retry as string });
		const result = await cli(["sync", "-"], {
			input: JSON.stringify([{ external_id: id, name: "Rate Limited Member" }]),
		});
		expect(result.status).toBe(0);
		const attempts = requests.filter((row) => row.query.external_id === id);
		expect(attempts).toHaveLength(2);
		expect(
			(attempts[1]?.at ?? 0) - (attempts[0]?.at ?? 0),
		).toBeGreaterThanOrEqual(id === "seconds" ? 120 : 500);
	}
	for (const status of [429, 500]) {
		const id = `failed_${status}`;
		rates.set(id, { remaining: 5, retry: "0", status });
		const result = await cli(["sync", "-"], {
			input: JSON.stringify([{ external_id: id, name: "Failed Member" }]),
		});
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout)[0]).toMatchObject({
			action: "failed",
			error: { code: "api_error", request_id: "req_sync_rate" },
		});
		expect(requests.filter((row) => row.query.external_id === id)).toHaveLength(
			status === 429 ? 2 : 1,
		);
	}
	// The retry applies to writes too, not only the lookup.
	rates.set("/viewers", { remaining: 1, retry: "0" });
	const result = await cli(["sync", "-"], {
		input: '[{"external_id":"write_retry","name":"Retry Member"}]',
	});
	expect(result.status).toBe(0);
	expect(
		viewers.filter((row) => row.external_id === "write_retry"),
	).toHaveLength(1);
});

test("progress prints one or all progress rows, with terminal percentage and title", async () => {
	for (const args of [
		[],
		["--video", "87654321-4321-4321-4321-987654321cba"],
	]) {
		const result = await cli(["progress", "member_2048", ...args]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual(
			args.length ? fixture.progress.data.slice(0, 1) : fixture.progress.data,
		);
	}
	const result = await cli(["progress", "member_2048"], { tty: true });
	expect(result.stdout).toMatch(
		/VIDEO\s+TITLE\s+PERCENT\s+COMPLETED\s+UPDATED/,
	);
	expect(result.stdout).toContain("Agency onboarding");
	expect(result.stdout).toContain("30");
});

test("memory reads, toggles without replacing content, and refuses unconfirmed clears before requests", async () => {
	const read = await cli(["memory", "member_2048"]);
	expect(read.status).toBe(0);
	expect(JSON.parse(read.stdout)).toEqual(fixture.memory.data);
	for (const flag of ["--disable", "--enable"]) {
		const result = await cli(["memory", "member_2048", flag]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			...fixture.memory.data,
			enabled: flag === "--enable",
		});
	}
	for (const extra of [[], ["--dry-run"]]) {
		const count = requests.length;
		const result = await cli(["memory", "member_2048", "--clear", ...extra]);
		expect(result.status).toBe(2);
		expect(JSON.parse(result.stderr).code).toBe("confirmation_required");
		expect(requests).toHaveLength(count);
	}
	const before = writes().length;
	for (const flag of ["--enable", "--disable", "--clear"]) {
		expect(
			(await cli(["memory", "member_2048", flag, "--dry-run", "--yes"])).status,
		).toBe(0);
	}
	expect(writes()).toHaveLength(before);
	expect(
		(await cli(["memory", "member_2048", "--enable", "--disable"])).status,
	).toBe(2);
	const cleared = await cli(["memory", "member_2048", "--clear", "--yes"]);
	expect(cleared.status).toBe(0);
	expect(JSON.parse(cleared.stdout)).toEqual({
		viewer_id: "12345678-1234-1234-1234-123456789abc",
		cleared: true,
	});
	expect(memory.content).toBeNull();
});

test("feature-disabled hints stop all viewer requests, but unavailable identity does not block them", async () => {
	for (const [feature, args, setting] of [
		["viewers", ["list"], "Viewers"],
		["viewer_memory", ["memory", "member_2048"], "Viewer Memory"],
	] as const) {
		features[feature] = false;
		const result = await cli([...args]);
		expect(result.status).toBe(3);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "not_permitted",
			hint: expect.stringContaining(`Enable ${setting} in Bold Settings`),
		});
		expect(requests.every((row) => row.path === "/me")).toBe(true);
		features[feature] = true;
	}
	identityStatus = 503;
	expect((await cli(["list"])).status).toBe(0);
});
