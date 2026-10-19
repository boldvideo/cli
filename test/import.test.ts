import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import collections from "./fixtures/import-collections.json";
import fixtures from "./fixtures/imports.json";
import me from "./fixtures/me.json";
import { run as execute, type RunOptions } from "./run";

const temporary = mkdtempSync(join(tmpdir(), "boldvideo-import-"));
const calls: { method: string; path: string; body: unknown }[] = [];
let dedupe = false;
let active = false;
let postError = 0;
let preflight = false;
let runPolls = 0;
let videoPolls = new Map<string, number>();
let failure = false;
let stalled = false;
let slow = false;
let mixed = false;
let terminalStatus = "completed";
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const path = url.pathname.replace("/api/v1", "");
		const body = request.method === "POST" ? await request.text() : "";
		calls.push({
			method: request.method,
			path: path + url.search,
			body: body ? JSON.parse(body) : undefined,
		});
		if (path === "/me")
			return Response.json({
				data: {
					...me.data,
					key: {
						...me.data.key,
						kind:
							request.headers.get("authorization") ===
							"Bearer bold_test_admin_2031"
								? "admin"
								: "tenant",
					},
				},
			});
		if (path === "/collections") return Response.json(collections);
		if (request.method === "POST") {
			if (postError)
				return Response.json(
					postError === 422
						? preflight
							? fixtures.preflight
							: fixtures.validation
						: { message: "Import refused." },
					{ status: postError, headers: { "x-request-id": "req_import_2031" } },
				);
			if (path.endsWith("/cancel"))
				return Response.json({
					data: { ...fixtures.running.data, status: "canceled" },
				});
			if (path === "/admin/videos")
				return Response.json(
					{ ...fixtures.created, deduplicated: dedupe },
					{ status: dedupe ? 200 : 201 },
				);
			if (path === "/admin/imports")
				return Response.json(fixtures.queued, {
					status: active ? 200 : 202,
					headers: { Location: fixtures.queued.data.status_url },
				});
		}
		if (path.startsWith("/admin/imports/")) {
			if (!path.endsWith("/run_taki_20261019"))
				return Response.json({ message: "Run not found." }, { status: 404 });
			if (slow) {
				await Bun.sleep(2000);
				return Response.json(fixtures.running);
			}
			if (mixed) return Response.json(fixtures.mixed_run);
			if (url.searchParams.get("page") === "2")
				return Response.json(fixtures.second_page);
			runPolls++;
			return Response.json(
				stalled || runPolls === 1
					? fixtures.running
					: { data: { ...fixtures.completed.data, status: terminalStatus } },
			);
		}
		if (path.startsWith("/admin/videos/")) {
			const id = decodeURIComponent(path.split("/").at(-1) as string);
			if (id === "missing-video")
				return Response.json({ message: "Video not found." }, { status: 404 });
			const count = (videoPolls.get(id) ?? 0) + 1;
			videoPolls.set(id, count);
			let result: typeof fixtures.ready | typeof fixtures.failed =
				stalled || count === 1 ? fixtures.processing : fixtures.ready;
			if (failure) {
				if (id === "sales-follow-up" || (!runPolls && count > 1))
					result = fixtures.failed;
				else if (count < 3) result = fixtures.processing;
			}
			return Response.json({ data: { ...result.data, internal_id: id } });
		}
		return Response.json({ message: "Not found." }, { status: 404 });
	},
});
beforeEach(() => {
	calls.length = 0;
	dedupe = active = preflight = failure = stalled = slow = mixed = false;
	postError = runPolls = 0;
	videoPolls = new Map();
	terminalStatus = "completed";
});
afterAll(() => {
	server.stop(true);
	rmSync(temporary, { recursive: true, force: true });
});
function run(args: string[], options: RunOptions = {}) {
	return execute(["node", resolve("dist/boldvideo.js"), "import", ...args], {
		...options,
		env: {
			BOLDVIDEO_API_KEY: "bold_test_admin_2031",
			BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}/api/v1`,
			XDG_CONFIG_HOME: temporary,
			APPDATA: temporary,
			...options.env,
		},
	});
}
const single = [
	"url",
	"https://cdn.example.com/paid-workshops.mp4",
	"--title",
	"Paid workshops",
];
const channel = ["youtube", "https://www.youtube.com/@takimoore"];
const waiting = ["--wait", "--poll-interval", "0.01", "--timeout", "2"];

test("direct URL metadata preserves API names and returns the full admin record", async () => {
	const result = await run([
		...single,
		"--description",
		"Turn workshops into sales.",
		"--tags",
		"sales,coaching",
		"--collection",
		"workshops",
		"--collection",
		"coaching",
		"--type",
		"workshop",
		"--privacy",
		"private",
		"--published-at",
		"2026-10-18T11:30:00+02:00",
		"--external-id",
		"workshop-2026-10",
		"--language",
		"en",
	]);
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toEqual({
		...fixtures.created.data,
		deduplicated: false,
	});
	expect(calls.at(-1)).toEqual({
		method: "POST",
		path: "/admin/videos",
		body: {
			source_url: single[1],
			title: "Paid workshops",
			description: "Turn workshops into sales.",
			tags: ["sales", "coaching"],
			collection_ids: [
				"b1c5296d-caf9-4bf4-a037-dcf191650350",
				"3df0cf1c-b63d-4ab4-b9e1-e2767f2cd075",
			],
			video_type: "workshop",
			privacy: "private",
			published_at: "2026-10-18T09:30:00.000Z",
			external_id: "workshop-2026-10",
			language: "en",
		},
	});
});

test("YouTube forms route to runs or single-video imports without a mode flag; Vimeo needs no title", async () => {
	for (const source of [
		"https://www.youtube.com/watch?v=aqz-KE-bpKQ",
		"https://youtu.be/aqz-KE-bpKQ",
		"https://m.youtube.com/shorts/aqz-KE-bpKQ",
		"https://vimeo.com/76979871",
		"https://player.vimeo.com/video/76979871",
	]) {
		const result = await run([
			source.includes("vimeo") ? "url" : "youtube",
			source,
		]);
		expect(result.status).toBe(0);
		expect(calls.at(-1)).toMatchObject({
			path: "/admin/videos",
			body: { source_url: source, privacy: "unlisted" },
		});
	}
	for (const source of [
		"https://youtube.com/watch?v=aqz-KE-bpKQ&list=PLcoaching2026",
		"https://youtube.com/playlist?list=PLcoaching2026",
		"https://youtube.com/@takimoore/videos",
		"https://youtube.com/channel/UCcoach2026",
		"https://youtube.com/c/takimoore",
		"https://youtube.com/user/takimoore",
	]) {
		const result = await run([
			"youtube",
			source,
			"--max",
			"12",
			"--order",
			"oldest",
			"--published-at",
			"none",
			"--tags",
			"coaching",
			"--collection",
			"workshops",
			"--type",
			"workshop",
		]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			...fixtures.queued.data,
			already_active: false,
		});
		expect(calls.at(-1)).toEqual({
			method: "POST",
			path: "/admin/imports",
			body: {
				source_url: source,
				privacy: "unlisted",
				published_at_strategy: "none",
				limit: 12,
				order: "oldest",
				tags: ["coaching"],
				collection_ids: ["b1c5296d-caf9-4bf4-a037-dcf191650350"],
				video_type: "workshop",
			},
		});
	}
});

test("dedupe and already-active reports survive JSON mode and are terminal-only diagnostics", async () => {
	dedupe = active = true;
	for (const args of [single, channel]) {
		const piped = await run(args);
		expect(piped.status).toBe(0);
		expect(piped.stderr).toBe("");
		expect(
			JSON.parse(piped.stdout)[
				args === single ? "deduplicated" : "already_active"
			],
		).toBe(true);
		const terminal = await run(args, { tty: true });
		expect(terminal.status).toBe(0);
		expect(terminal.stdout).toContain(
			args === single ? "deduplicated" : "already active",
		);
		expect(terminal.stdout).toContain("KEY");
		const jsonTerminal = await run([...args, "--json"], {
			tty: true,
			stderr: "pipe",
		});
		expect(jsonTerminal.stderr).toBe("");
		expect(
			JSON.parse(jsonTerminal.stdout)[
				args === single ? "deduplicated" : "already_active"
			],
		).toBe(true);
	}
});

test("single wait distinguishes processing from ready and propagates failure_reason", async () => {
	const result = await run([...single, ...waiting]);
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toEqual({
		...fixtures.ready.data,
		deduplicated: false,
	});
	failure = true;
	videoPolls.clear();
	const failed = await run([...single, ...waiting]);
	expect(failed.status).toBe(1);
	expect(failed.stdout).toBe("");
	expect(JSON.parse(failed.stderr)).toMatchObject({
		code: "import_failed",
		message: expect.stringContaining("Audio could not be transcribed."),
	});
});

test("run wait checks readiness after terminal status, follows every video page and resumes with status", async () => {
	for (const args of [channel, ["status", "run_taki_20261019"]]) {
		runPolls = 0;
		videoPolls.clear();
		const result = await run([...args, ...waiting]);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "completed",
			readiness: { ready: 2, failed: 0 },
		});
		expect(JSON.parse(result.stdout).videos).toHaveLength(1);
		expect(calls.some((call) => call.path.endsWith("?page=2"))).toBe(true);
		expect([...videoPolls.keys()].sort()).toEqual(
			[fixtures.ready.data.internal_id, "sales-follow-up"].sort(),
		);
	}
});

test("mixed run finishes observing healthy videos but exits 1 for failed readiness", async () => {
	failure = true;
	const result = await run([...channel, ...waiting], { tty: true });
	expect(result.status).toBe(1);
	expect(result.stdout).toContain("1/2 done, 0 ready, 0 failed");
	expect(result.stdout).toContain("2/2 done, 0 ready, 1 failed");
	expect(result.stdout).toContain("2/2 done, 1 ready, 1 failed");
	expect(result.stdout).toContain("Audio could not be transcribed.");
	expect(result.stdout).not.toContain("KEY");
});

test("completed run with mixed submission results still waits for readiness and reports ingestion failure", async () => {
	mixed = true;
	const result = await run(["status", "run_taki_20261019", ...waiting]);
	expect(result.status).toBe(1);
	expect(result.stdout).toBe("");
	expect(JSON.parse(result.stderr)).toMatchObject({
		code: "import_failed",
		message: "Import completed: 1 ready, 1 failed. Source video is private.",
	});
});

test("failed and canceled runs cannot report success even when submitted videos become ready", async () => {
	for (const status of ["failed", "canceled"]) {
		terminalStatus = status;
		runPolls = 0;
		const result = await run(["status", "run_taki_20261019", ...waiting]);
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stderr).message).toContain(`Import ${status}`);
	}
});

test("wait deadline interrupts sleeps and in-flight reads with exit 5 and a status hint", async () => {
	stalled = true;
	for (const delayed of [false, true]) {
		slow = delayed;
		const start = Date.now();
		const result = await run([
			...channel,
			"--wait",
			"--timeout",
			"0.08",
			"--profile",
			"customer-demo",
		]);
		expect(Date.now() - start).toBeLessThan(1500);
		expect(result.status).toBe(5);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "timed_out",
			hint: "boldvideo import status 'run_taki_20261019' --profile 'customer-demo'",
		});
	}
});

test("Ctrl-C stops waiting with exit 130 and does not cancel the remote import", async () => {
	stalled = true;
	const result = await run([...channel, "--wait"], {
		tty: true,
		waitFor: "1/2 done",
		input: "\x03",
	});
	expect(result.status).toBe(130);
	expect(result.stdout).toContain(
		"boldvideo import status 'run_taki_20261019'",
	);
	expect(result.stdout).toContain("without cancellation");
	expect(calls.filter((call) => call.path.endsWith("/cancel"))).toHaveLength(0);
});

test("status stays paginated and cancel requires confirmation and reports draining", async () => {
	const status = await run(["status", "run_taki_20261019"]);
	expect(status.status).toBe(0);
	expect(JSON.parse(status.stdout)).toMatchObject({
		...fixtures.running.data,
		next: "boldvideo import status 'run_taki_20261019' --page 2",
	});
	const last = await run(["status", "run_taki_20261019", "--page", "2"]);
	expect(JSON.parse(last.stdout)).toEqual(fixtures.second_page.data);
	const refused = await run(["cancel", "run_taki_20261019"]);
	expect(refused.status).toBe(2);
	expect(JSON.parse(refused.stderr).code).toBe("confirmation_required");
	const canceled = await run(["cancel", "run_taki_20261019", "--yes"]);
	expect(canceled.status).toBe(0);
	expect(JSON.parse(canceled.stdout).message).toContain(
		"already-submitted batch drains",
	);
	expect(calls.filter((call) => call.method === "POST")).toEqual([
		{
			method: "POST",
			path: "/admin/imports/run_taki_20261019/cancel",
			body: undefined,
		},
	]);
});

test("dry-run describes the exact request without writes; date-only uses UTC", async () => {
	const preview = await run([
		...single,
		"--published-at",
		"2026-10-18",
		"--dry-run",
	]);
	expect(preview.status).toBe(0);
	expect(JSON.parse(preview.stdout)).toEqual({
		dry_run: true,
		method: "POST",
		path: "/admin/videos",
		body: {
			source_url: single[1],
			title: "Paid workshops",
			privacy: "unlisted",
			published_at: "2026-10-18T00:00:00.000Z",
		},
	});
	const batch = await run([...channel, "--dry-run"]);
	expect(JSON.parse(batch.stdout).body.published_at_strategy).toBe("source");
	const cancel = await run([
		"cancel",
		"run_taki_20261019",
		"--dry-run",
		"--yes",
	]);
	expect(JSON.parse(cancel.stdout)).toEqual({
		dry_run: true,
		method: "POST",
		path: "/admin/imports/run_taki_20261019/cancel",
	});
	expect(calls.every((call) => call.path === "/me")).toBe(true);
});

test("422 fields, managed preflight, auth HTTP errors and request IDs use standard errors", async () => {
	for (const status of [422, 401, 403]) {
		postError = status;
		const result = await run(channel);
		expect(result.status).toBe(status === 422 ? 2 : 3);
		expect(result.stdout).toBe("");
		const failure = JSON.parse(result.stderr);
		expect(failure.request_id).toBe("req_import_2031");
		expect(failure.docs).toStartWith("https://docs.boldvideo.com/cli#");
		if (status === 422) {
			expect(failure.code).toBe("validation_error");
			expect(failure.message).toContain("collection_ids");
			expect(failure.message).toContain("video_type");
		}
	}
	postError = 422;
	preflight = true;
	const result = await run(channel);
	expect(result.status).toBe(3);
	expect(JSON.parse(result.stderr)).toMatchObject({
		code: "managed_youtube_preflight_required",
		hint: expect.stringContaining("Mission Control"),
		request_id: "req_import_2031",
	});
});

test("tenant credentials are rejected after identity lookup and before any import request", async () => {
	const result = await run(channel, {
		env: { BOLDVIDEO_API_KEY: "bold_test_tenant_2031" },
	});
	expect(result.status).toBe(3);
	expect(JSON.parse(result.stderr).hint).toContain("admin key");
	expect(calls.map((call) => call.path)).toEqual(["/me"]);
});

test("invalid metadata is rejected without writing or silently dropping flags", async () => {
	for (const args of [
		["url", "https://cdn.example.com/workshop.mp4"],
		["url", "https://youtube.com.evil.example/watch?v=aqz-KE-bpKQ"],
		["youtube", "https://vimeo.com/76979871"],
		[...single, "--published-at", "2026-02-30"],
		[...single, "--published-at", "2026-10-19T12:00:00"],
		[...single, "--published-at", "source"],
		[...single, "--limit", "5"],
		[...channel, "--limit", "5"],
		[...single, "--max", "5"],
		[...channel, "--title", "Ignored title"],
		[...channel, "--published-at", "2026-10-19"],
		[...channel, "--max", "1.5"],
		[...channel, "--max", "0"],
		[...channel, "--order", "popular"],
		[...channel, "--privacy", "secret"],
		[...channel, "--poll-interval", "0"],
		[...channel, "--timeout=-1"],
	]) {
		const result = await run(args);
		expect(result.status).toBe(2);
		expect(JSON.parse(result.stderr).code).toBe("usage_error");
	}
	expect(calls.every((call) => call.path === "/me")).toBe(true);
});

test("collections resolve exact names, IDs and slugs with one lookup; missing and ambiguous names never write", async () => {
	const preview = await run([
		...channel,
		"--collection",
		"Paid workshops",
		"--collection",
		"3df0cf1c-b63d-4ab4-b9e1-e2767f2cd075",
		"--dry-run",
	]);
	expect(preview.status).toBe(0);
	expect(JSON.parse(preview.stdout).body.collection_ids).toEqual([
		"b1c5296d-caf9-4bf4-a037-dcf191650350",
		"3df0cf1c-b63d-4ab4-b9e1-e2767f2cd075",
	]);
	expect(calls.filter((call) => call.path.startsWith("/collections"))).toEqual([
		{ method: "GET", path: "/collections?limit=1000", body: undefined },
	]);
	for (const [name, status] of [
		["Missing collection", 4],
		["paid workshops", 4],
		["Archive", 2],
	] as const) {
		const result = await run([...channel, "--collection", name]);
		expect(result.status).toBe(status);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			message: expect.stringContaining(name),
			hint: "boldvideo collections list",
		});
	}
	expect(calls.some((call) => call.method === "POST")).toBe(false);
});

test("status accepts video identifiers, waits for readiness and preserves not-found errors", async () => {
	for (const id of [
		fixtures.ready.data.internal_id,
		"k8N2pQ",
		"paid-workshops",
	]) {
		const result = await run(["status", id]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			...fixtures.processing.data,
			internal_id: id,
		});
		const ready = await run(["status", id, ...waiting]);
		expect(ready.status).toBe(0);
		expect(JSON.parse(ready.stdout)).toEqual({
			...fixtures.ready.data,
			internal_id: id,
		});
	}
	const missing = await run(["status", "missing-video"]);
	expect(missing.status).toBe(4);
	expect(JSON.parse(missing.stderr).code).toBe("not_found");
	stalled = true;
	const timeout = await run([
		"status",
		"paid-workshops",
		"--wait",
		"--timeout",
		"0.05",
	]);
	expect(timeout.status).toBe(5);
	expect(JSON.parse(timeout.stderr).hint).toBe(
		"boldvideo import status 'paid-workshops'",
	);
});
