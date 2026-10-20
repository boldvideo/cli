import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import me from "./fixtures/me.json";
import video from "./fixtures/video-write.json";
import { run as execute, type RunOptions } from "./run";

const temporary = mkdtempSync(join(tmpdir(), "boldvideo-video-write-"));
const calls: { method: string; path: string; body: unknown }[] = [];
let malformed = false;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const path = new URL(request.url).pathname.replace("/api/v1", "");
		const body = await request.text();
		calls.push({
			method: request.method,
			path,
			body: body ? JSON.parse(body) : null,
		});
		if (path === "/me")
			return Response.json({
				data: {
					...me.data,
					key: {
						...me.data.key,
						kind:
							request.headers.get("authorization") ===
							"Bearer bold_test_tenant_2034"
								? "tenant"
								: "admin",
					},
				},
			});
		if (path.startsWith("/admin/videos/missing-video"))
			return Response.json(
				{ message: "Video not found." },
				{ status: 404, headers: { "x-request-id": "req_missing_2034" } },
			);
		if (!path.startsWith("/admin/videos/"))
			return new Response(null, { status: 500 });
		if (malformed) return Response.json({ data: video });
		const id = decodeURIComponent(path.split("/")[3] as string);
		return Response.json({
			...video,
			...(id === "sales-onboarding"
				? {
						internal_id: "a370140b-2b3c-450f-93ca-36ddf0473511",
						slug: id,
						title: "Sales onboarding",
					}
				: {}),
			...(body ? JSON.parse(body) : {}),
		});
	},
});

beforeEach(() => {
	calls.length = 0;
	malformed = false;
});
afterAll(() => {
	server.stop(true);
	rmSync(temporary, { recursive: true, force: true });
});
function run(args: string[], options: RunOptions = {}) {
	return execute(["node", resolve("dist/boldvideo.js"), "videos", ...args], {
		...options,
		env: {
			BOLDVIDEO_API_KEY: "bold_test_admin_2034",
			BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}/api/v1`,
			XDG_CONFIG_HOME: temporary,
			APPDATA: temporary,
			...options.env,
		},
	});
}

test("single update maps every metadata flag and preserves the returned admin record", async () => {
	const result = await run([
		"update",
		video.internal_id,
		"--title",
		"October workshops",
		"--description",
		"",
		"--published-at",
		"none",
		"--type",
		"masterclass",
		"--privacy",
		"unlisted",
		"--tags",
		"sales, training",
		"--tags",
		"october",
		"--add-tags",
		"new",
		"--remove-tags",
		"old",
		"--collections",
		"workshops,team",
		"--add-collection",
		"featured",
		"--add-collection",
		"autumn",
		"--remove-collection",
		"archived",
	]);
	const body = {
		title: "October workshops",
		description: "",
		published_at: null,
		video_type: "masterclass",
		privacy: "unlisted",
		tags: ["sales", "training", "october"],
		add_tags: ["new"],
		remove_tags: ["old"],
		collection_ids: ["workshops", "team"],
		add_collection_ids: ["featured", "autumn"],
		remove_collection_ids: ["archived"],
	};
	expect(result).toMatchObject({ status: 0, stderr: "" });
	expect(calls).toEqual([
		{ method: "GET", path: "/me", body: null },
		{ method: "PATCH", path: `/admin/videos/${video.internal_id}`, body },
	]);
	expect(JSON.parse(result.stdout)).toEqual([
		{ id: video.internal_id, ok: true, video: { ...video, ...body } },
	]);
});

test("multi-ID updates process UUID, hashid and slug in order with the same changes", async () => {
	const ids = [video.internal_id, video.id, video.slug];
	const result = await run([
		"update",
		...ids,
		"--tags=",
		"--collections=",
		"--published-at",
		"2024-02-29",
	]);
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual(
		ids.map((id) => ({
			id,
			ok: true,
			video: {
				...video,
				tags: [],
				collection_ids: [],
				published_at: "2024-02-29T00:00:00.000Z",
			},
		})),
	);
	expect(calls.slice(1)).toEqual(
		ids.map((id) => ({
			method: "PATCH",
			path: `/admin/videos/${id}`,
			body: {
				tags: [],
				collection_ids: [],
				published_at: "2024-02-29T00:00:00.000Z",
			},
		})),
	);
});

test("partial failures retain request IDs, continue after failures and exit 1 with failed IDs", async () => {
	for (const action of ["update", "publish", "unpublish", "delete"]) {
		calls.length = 0;
		const result = await run([
			action,
			video.slug,
			"missing-video",
			"sales-onboarding",
			...(action === "update"
				? ["--title", "Sales training"]
				: action === "delete"
					? ["--yes"]
					: []),
		]);
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout)).toEqual([
			{
				id: video.slug,
				ok: true,
				video: expect.objectContaining({
					title: action === "update" ? "Sales training" : video.title,
				}),
			},
			{
				id: "missing-video",
				ok: false,
				error: {
					code: "not_found",
					message: "Video not found.",
					hint: "boldvideo whoami",
					docs: "https://docs.boldvideo.com/cli#not-found",
					request_id: "req_missing_2034",
				},
			},
			{
				id: "sales-onboarding",
				ok: true,
				video: expect.objectContaining({
					title: action === "update" ? "Sales training" : "Sales onboarding",
				}),
			},
		]);
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "bulk_failed",
			hint: expect.stringContaining("'missing-video'"),
			docs: "https://docs.boldvideo.com/cli#bulk-failed",
		});
		expect(calls.at(-1)?.path).toContain("sales-onboarding");
	}
});

test("publish normalizes dates and unpublish sends no metadata", async () => {
	for (const [action, flags, body] of [
		["publish", [], {}],
		[
			"publish",
			["--published-at", "2026-10-19T10:30:00+02:00"],
			{ published_at: "2026-10-19T08:30:00.000Z" },
		],
		[
			"publish",
			["--published-at", "2026-10-19T10:30"],
			{ published_at: "2026-10-19T10:30:00.000Z" },
		],
		["unpublish", [], null],
	] as const) {
		const result = await run([action, video.slug, video.id, ...flags]);
		expect(result).toMatchObject({ status: 0, stderr: "" });
		expect(
			JSON.parse(result.stdout).map((row: { ok: boolean }) => row.ok),
		).toEqual([true, true]);
		expect(calls.slice(-2)).toEqual(
			[video.slug, video.id].map((id) => ({
				method: "POST",
				path: `/admin/videos/${id}/${action}`,
				body,
			})),
		);
	}
});

test("piped deletion refuses without --yes, including previews, without any request", async () => {
	for (const flags of [[], ["--dry-run"]]) {
		const result = await run(["delete", video.slug, ...flags]);
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "confirmation_required",
			hint: expect.stringContaining("--yes"),
		});
	}
	expect(calls).toHaveLength(0);
});

test("dry-runs preview each action without mutations and deletion includes titles", async () => {
	for (const action of ["update", "publish", "unpublish", "delete"]) {
		calls.length = 0;
		const result = await run([
			action,
			video.slug,
			"sales-onboarding",
			"--dry-run",
			...(action === "delete"
				? ["--yes"]
				: action === "update"
					? ["--privacy", "public"]
					: []),
		]);
		expect(result).toMatchObject({ status: 0, stderr: "" });
		const rows = JSON.parse(result.stdout);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			id: video.slug,
			ok: true,
			dry_run: true,
			method:
				action === "delete" ? "DELETE" : action === "update" ? "PATCH" : "POST",
			path: `/admin/videos/${video.slug}${["publish", "unpublish"].includes(action) ? `/${action}` : ""}`,
		});
		if (action === "delete") expect(rows[0].video).toEqual(video);
		if (action === "update")
			expect(rows[0].body).toEqual({ privacy: "public" });
		expect(calls.every((call) => call.method === "GET")).toBe(true);
	}
});

test("stdin IDs work for every mutation, ignore blanks and are ignored when positionals exist", async () => {
	for (const action of ["update", "publish", "unpublish", "delete"]) {
		const flags =
			action === "delete"
				? ["--yes"]
				: action === "update"
					? ["--title", "Autumn training"]
					: [];
		const result = await run([action, ...flags], {
			input: `  ${video.slug}\r\n\n sales-onboarding \n`,
		});
		expect(result.status).toBe(0);
		expect(
			JSON.parse(result.stdout).map((row: { id: string }) => row.id),
		).toEqual([video.slug, "sales-onboarding"]);
	}
	const result = await run(["publish", video.id], { input: "missing-video\n" });
	expect(result.status).toBe(0);
	expect(
		JSON.parse(result.stdout).map((row: { id: string }) => row.id),
	).toEqual([video.id]);
});

test("invalid flags and empty ID input fail without video requests", async () => {
	for (const args of [
		["update", video.slug],
		["update", video.slug, "--privacy", "secret"],
		...[
			"tomorrow",
			"2026-02-29",
			"2026-04-31",
			"2026-10-19T24:00:00Z",
			"2026-13-01",
			"2026-10-19T10:61:00Z",
		].map((date) => ["update", video.slug, "--published-at", date]),
		["publish", video.slug, "--published-at", "none"],
		["unpublish", video.slug, "--title", "Autumn"],
		["update", video.slug, "--unknown", "value"],
		["publish"],
		["get", video.slug, video.id],
	]) {
		const result = await run(args);
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr).code).toBe("usage_error");
	}
	expect(calls.every((call) => call.path === "/me")).toBe(true);
});

test("tenant keys are refused by the shared admin gate before any video request", async () => {
	for (const action of ["update", "publish", "unpublish", "delete"]) {
		const result = await run(
			[
				action,
				video.slug,
				...(action === "update"
					? ["--title", "Autumn"]
					: action === "delete"
						? ["--yes"]
						: []),
			],
			{ env: { BOLDVIDEO_API_KEY: "bold_test_tenant_2034" } },
		);
		expect(result.status).toBe(3);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			code: "not_permitted",
			hint: expect.stringContaining("admin key"),
		});
	}
	expect(calls.every((call) => call.path === "/me")).toBe(true);
});

test("terminal results show all five columns and full IDs for multiple videos", async () => {
	const result = await run(["publish", video.internal_id, "sales-onboarding"], {
		tty: true,
	});
	expect(result.status).toBe(0);
	expect(
		result.stdout
			.trim()
			.split("\n")
			.map((line) => line.split(/ {2,}/)),
	).toEqual([
		["ID", "TITLE", "STATUS", "PRIVACY", "RESULT"],
		[video.internal_id, "Paid workshops", "ready", "private", "ok"],
		["sales-onboarding", "Sales onboarding", "ready", "private", "ok"],
	]);
});

test("terminal deletion asks once listing all titles, and cancellation never deletes", async () => {
	for (const answer of ["no\n", "yes\n"]) {
		calls.length = 0;
		const result = await run(["delete", video.slug, "sales-onboarding"], {
			tty: true,
			input: answer,
			waitFor: "Type yes to delete:",
		});
		expect(result.stdout.split("Type yes to delete:")).toHaveLength(2);
		expect(result.stdout).toContain(
			`${video.slug}: Paid workshops\nsales-onboarding: Sales onboarding`,
		);
		expect(result.status).toBe(answer === "yes\n" ? 0 : 2);
		expect(
			calls.filter((call) => call.method === "DELETE").map((call) => call.path),
		).toEqual(
			answer === "yes\n"
				? [`/admin/videos/${video.slug}`, "/admin/videos/sales-onboarding"]
				: [],
		);
	}
	const partial = await run(["delete", "missing-video", video.slug], {
		tty: true,
		input: "yes\n",
		waitFor: "Type yes to delete:",
	});
	expect(partial.status).toBe(1);
	expect(partial.stdout).toContain("not_found");
	expect(calls.at(-1)).toEqual({
		method: "DELETE",
		path: `/admin/videos/${video.slug}`,
		body: null,
	});
	const missing = await run(["delete", "missing-video"], { tty: true });
	expect(missing.status).toBe(1);
	expect(missing.stdout).not.toContain("Type yes to delete:");
});

test("malformed pending backend responses are per-item failures, not false success", async () => {
	malformed = true;
	const result = await run(["publish", video.slug, video.id]);
	expect(result.status).toBe(1);
	expect(JSON.parse(result.stdout)).toEqual(
		[video.slug, video.id].map((id) => ({
			id,
			ok: false,
			error: {
				code: "api_error",
				message: "The Bold API returned an invalid video record.",
				hint: "boldvideo videos list",
				docs: "https://docs.boldvideo.com/cli#api-error",
			},
		})),
	);
});
