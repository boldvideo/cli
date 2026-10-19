import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import fixtures from "./fixtures/collections.json";
import me from "./fixtures/me.json";
import { type RunOptions, run } from "./run";

const home = mkdtempSync(join(tmpdir(), "boldvideo-collections-"));
const admin = "bold_test_admin_2035";
const tenant = "bold_test_tenant_2035";
const writes: {
	method: string;
	path: string;
	body: Record<string, unknown>;
}[] = [];
const reads: { path: string; limit: number; offset: number }[] = [];
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const path = decodeURIComponent(url.pathname.replace("/api/v1", ""));
		if (path === "/me")
			return Response.json({
				data: {
					...me.data,
					key: {
						...me.data.key,
						kind:
							request.headers.get("authorization") === `Bearer ${admin}`
								? "admin"
								: "tenant",
					},
				},
			});
		if (request.method === "GET") {
			if (!request.headers.get("authorization"))
				return new Response(null, { status: 401 });
			if (path === "/collections/customer-workshops")
				return Response.json({ data: fixtures.data[0] });
			const limit = Number(url.searchParams.get("limit"));
			const offset = Number(url.searchParams.get("offset"));
			reads.push({ path, limit, offset });
			const data = path === "/collections" ? fixtures.data : fixtures.videos;
			return Response.json({ data: data.slice(offset, offset + limit) });
		}
		// Match PR #722: Bearer alone does not authenticate admin routes.
		if (request.headers.get("x-bold-admin-api-key") !== admin)
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		const body = (await request.json()) as Record<string, unknown>;
		if ((body.video_ids as string[] | undefined)?.includes("missing-video"))
			return Response.json(fixtures.unknown_video, {
				status: 404,
				headers: { "x-request-id": "req_collections_2035" },
			});
		writes.push({ method: request.method, path, body });
		if (path === "/admin/collections")
			return Response.json(
				body.name === "Customer workshops"
					? { data: fixtures.data[0], existing: true }
					: fixtures.created,
				{ status: body.name === "Customer workshops" ? 200 : 201 },
			);
		if (request.method === "PATCH")
			return Response.json({ data: { ...fixtures.data[0], name: body.name } });
		return Response.json(
			request.method === "POST" ? fixtures.added : fixtures.removed,
		);
	},
});
const env = {
	BOLDVIDEO_API_KEY: admin,
	BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}/api/v1`,
	XDG_CONFIG_HOME: home,
	APPDATA: home,
};
const cli = (args: string[], options: RunOptions = {}) =>
	run(["node", resolve("dist/boldvideo.js"), "collections", ...args], {
		...options,
		env: { ...env, ...options.env },
	});

beforeEach(() => {
	writes.length = 0;
	reads.length = 0;
});
afterAll(() => {
	server.stop(true);
	rmSync(home, { recursive: true, force: true });
});

test("list preserves empty collections, API fields and optional video counts", async () => {
	const result = await cli(["list"], { env: { BOLDVIDEO_API_KEY: tenant } });
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toEqual({
		items: fixtures.data,
		has_more: false,
	});
	expect(reads).toEqual([{ path: "/collections", limit: 20, offset: 0 }]);
	const terminal = await cli(["list"], { tty: true });
	expect(terminal.status).toBe(0);
	expect(terminal.stdout).toMatch(/ID\s+NAME\s+SLUG\s+VIDEOS\n/);
	expect(terminal.stdout).toMatch(/empty-collection\s+0/);
	expect(terminal.stdout).toContain("8c36b95c-7be2-4b7e-bf63-2ee639f7a246");
	expect(terminal.stdout).toContain("draft-lessons");
	const json = await cli(["list", "--json"], { tty: true });
	expect(JSON.parse(json.stdout).items).toEqual(fixtures.data);
});

test("pagination projects fields and returns executable continuations without false final pages", async () => {
	const first = await cli([
		"list",
		"--limit",
		"2",
		"--fields",
		"id",
		"--fields",
		"video_count",
		"--profile",
		"Director's demo",
		"--json",
	]);
	expect(first.status).toBe(0);
	const page = JSON.parse(first.stdout);
	expect(page.items).toEqual([
		{ id: "8c36b95c-7be2-4b7e-bf63-2ee639f7a246", video_count: 2 },
		{ id: "b7acef65-0165-48f3-9555-845c343779ee", video_count: 0 },
	]);
	expect(page.has_more).toBe(true);
	expect(reads).toEqual([
		{ path: "/collections", limit: 2, offset: 0 },
		{ path: "/collections", limit: 1, offset: 2 },
	]);
	const next = await run(
		[
			"sh",
			"-c",
			page.next.replace("boldvideo", `node '${resolve("dist/boldvideo.js")}'`),
		],
		{ env },
	);
	expect(next.status).toBe(0);
	expect(JSON.parse(next.stdout)).toEqual({
		items: [{ id: "aa879c56-16eb-4852-81b9-a78aaf158b3f" }],
		has_more: false,
	});
	const exact = await cli(["list", "--limit", "3"]);
	expect(JSON.parse(exact.stdout).has_more).toBe(false);
	const empty = await cli(["list", "--offset", "3"]);
	expect(JSON.parse(empty.stdout)).toEqual({ items: [], has_more: false });
	for (const args of [
		["list", "--offset=-1"],
		["videos", "customer-workshops", "--offset=1.5"],
		["list", "--limit=1001"],
	])
		expect((await cli(args)).status).toBe(2);
});

test("videos lists ID/TITLE and preserves collection quoting in pagination", async () => {
	const result = await cli(["videos", "customer-workshops"]);
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({
		items: fixtures.videos,
		has_more: false,
	});
	const terminal = await cli(["videos", "customer-workshops"], { tty: true });
	expect(terminal.stdout).toMatch(/ID\s+TITLE\n/);
	expect(terminal.stdout).toContain("Pricing masterclass");
	const page = JSON.parse(
		(
			await cli([
				"videos",
				"Director's picks",
				"--limit",
				"1",
				"--fields",
				"id,title",
			])
		).stdout,
	);
	const next = await run(
		[
			"sh",
			"-c",
			page.next.replace("boldvideo", `node '${resolve("dist/boldvideo.js")}'`),
		],
		{ env },
	);
	expect(next.status).toBe(0);
	expect(JSON.parse(next.stdout)).toEqual({
		items: [{ id: "eF56gH78", title: "Onboarding basics" }],
		has_more: false,
	});
	expect(reads.at(-1)?.path).toBe("/collections/Director's picks/videos");
});

test("create handles new and existing collections and resolves parent slugs", async () => {
	const created = await cli([
		"create",
		"Pricing lessons",
		"--parent",
		"customer-workshops",
	]);
	expect(created.status).toBe(0);
	expect(JSON.parse(created.stdout)).toEqual(fixtures.created);
	expect(writes[0]).toEqual({
		method: "POST",
		path: "/admin/collections",
		body: {
			name: "Pricing lessons",
			parent_id: "8c36b95c-7be2-4b7e-bf63-2ee639f7a246",
		},
	});
	const existing = await cli(["create", "Customer workshops"]);
	expect(existing.status).toBe(0);
	expect(existing.stderr).toBe("");
	expect(JSON.parse(existing.stdout)).toEqual({
		data: fixtures.data[0],
		existing: true,
	});
	const terminal = await cli(["create", "Customer workshops"], {
		tty: true,
		stderr: "pipe",
	});
	expect(terminal.stdout).toContain("Customer workshops");
	const hinted = await cli(["create", "Customer workshops"], { tty: true });
	expect(hinted.stdout).toContain("Collection already exists.");
});

test("rename patches only the name and prints the collection", async () => {
	const result = await cli([
		"rename",
		"customer-workshops",
		"Advanced lessons",
	]);
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout).data).toEqual({
		...fixtures.data[0],
		name: "Advanced lessons",
	});
	expect(writes).toEqual([
		{
			method: "PATCH",
			path: "/admin/collections/customer-workshops",
			body: { name: "Advanced lessons" },
		},
	]);
});

test("add and remove batch argv or stdin IDs and report membership results", async () => {
	for (const [action, method, expected] of [
		["add", "POST", fixtures.added],
		["remove", "DELETE", fixtures.removed],
	] as const) {
		const result = await cli([
			action,
			"customer-workshops",
			"aB12cD34",
			"onboarding-basics",
			"34e71a76-365f-4aef-bfcb-ae6dc960fbf3",
		]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual(expected);
		expect(writes.at(-1)).toEqual({
			method,
			path: "/admin/collections/customer-workshops/videos",
			body: {
				video_ids: [
					"aB12cD34",
					"onboarding-basics",
					"34e71a76-365f-4aef-bfcb-ae6dc960fbf3",
				],
			},
		});
		const stdin = await cli([action, "customer-workshops"], {
			input: " aB12cD34\r\n\nonboarding-basics\n",
		});
		expect(stdin.status).toBe(0);
		expect(writes.at(-1)?.body).toEqual({
			video_ids: ["aB12cD34", "onboarding-basics"],
		});
	}
	const terminal = await cli(["add", "customer-workshops", "aB12cD34"], {
		tty: true,
	});
	expect(terminal.stdout).toContain("MEMBERSHIP_COUNT  ALREADY_MEMBER_IDS");
	expect(terminal.stdout).toContain("fe117414-71d6-45cd-8138-24275b903e92");
	const explicit = await cli(["add", "customer-workshops", "aB12cD34"], {
		input: "ignored-video\n",
	});
	expect(explicit.status).toBe(0);
	expect(writes.at(-1)?.body).toEqual({ video_ids: ["aB12cD34"] });
});

test("dry-run never mutates; missing video input is a usage error", async () => {
	for (const args of [
		["create", "Pricing lessons", "--parent", "customer-workshops"],
		["rename", "customer-workshops", "Advanced lessons"],
		["add", "customer-workshops", "aB12cD34", "onboarding-basics"],
		["remove", "customer-workshops", "aB12cD34"],
	]) {
		const preview = await cli([...args, "--dry-run"]);
		expect(preview.status).toBe(0);
		expect(JSON.parse(preview.stdout)).toMatchObject({
			dry_run: true,
			path: expect.stringContaining("/admin/collections"),
			body: expect.any(Object),
		});
	}
	expect(writes).toHaveLength(0);
	for (const action of ["add", "remove"]) {
		const empty = await cli([action, "customer-workshops"], { input: "\n \n" });
		expect(empty.status).toBe(2);
		expect(JSON.parse(empty.stderr).code).toBe("usage_error");
	}
});

test("unknown video errors map to exit 4 with no partial write", async () => {
	for (const action of ["add", "remove"]) {
		const result = await cli([
			action,
			"customer-workshops",
			"aB12cD34",
			"missing-video",
		]);
		expect(result.status).toBe(4);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "not_found",
			request_id: "req_collections_2035",
			docs: "https://docs.boldvideo.com/cli#not-found",
		});
	}
	expect(writes).toHaveLength(0);
});

test("tenant keys cannot write and receive the shared admin key hint", async () => {
	for (const args of [
		["create", "Pricing lessons"],
		["rename", "customer-workshops", "Advanced lessons"],
		["add", "customer-workshops", "aB12cD34"],
		["remove", "customer-workshops", "aB12cD34"],
	]) {
		const result = await cli(args, { env: { BOLDVIDEO_API_KEY: tenant } });
		expect(result.status).toBe(3);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "not_permitted",
			hint: expect.stringContaining("admin key"),
		});
	}
	expect(writes).toHaveLength(0);
});
