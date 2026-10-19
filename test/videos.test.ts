import { afterAll, beforeEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import me from "./fixtures/me.json";
import publicVideo from "./fixtures/public-video.json";
import transcripts from "./fixtures/transcripts.json";
import videos from "./fixtures/videos.json";

const temporary = mkdtempSync(join(tmpdir(), "boldvideo-videos-"));
const video = { ...videos.data[0], ready: true, failure_reason: null };
const calls: URL[] = [];
let unpaginated = false;
let publicCount = 23;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		calls.push(url);
		const admin =
			request.headers.get("authorization") === "Bearer bold_test_admin_2032";
		if (url.pathname === "/api/v1/me")
			return Response.json({
				...me,
				key: { ...me.key, kind: admin ? "admin" : "tenant" },
			});
		const path = url.pathname.replace("/api/v1", "");
		const root = admin ? "/admin/videos" : "/videos";
		if (path === root) {
			if (unpaginated)
				return Response.json({
					data: Array.from({ length: publicCount }, (_, index) => ({
						...publicVideo.data,
						id: `public-workshop-${index + 1}`,
					})),
				});
			const page = Number(url.searchParams.get("page"));
			return Response.json(
				{
					...videos,
					data: admin ? videos.data : [publicVideo.data],
					// Proposed bounded public-list envelope; current backend omits meta.
					meta: { ...videos.meta, page },
				},
				{ headers: { Link: '</api/v1/admin/videos?page=2>; rel="next"' } },
			);
		}
		if (path === "/videos/processing/transcript")
			return Response.json(
				{ code: "transcript_not_ready", message: "Processing transcript." },
				{ status: 404, headers: { "x-request-id": "req_transcript_2032" } },
			);
		if (path === "/videos/paid-workshops/transcript") {
			const format = url.searchParams.get("format") as keyof typeof transcripts;
			const body = transcripts[format];
			return format === "json"
				? Response.json(body)
				: new Response(body as string, {
						headers: {
							"content-type": {
								txt: "text/plain",
								srt: "application/x-subrip",
								vtt: "text/vtt",
							}[format],
						},
					});
		}
		if (
			[video.internal_id, video.id, video.slug].some(
				(id) => path === `${root}/${id}`,
			)
		)
			return Response.json(admin ? video : publicVideo);
		return Response.json(
			{ message: "Video not found." },
			{ status: 404, headers: { "x-request-id": "req_missing_2032" } },
		);
	},
});
beforeEach(() => {
	calls.length = 0;
	unpaginated = false;
	publicCount = 23;
});
afterAll(() => {
	server.stop(true);
	rmSync(temporary, { recursive: true, force: true });
});
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
async function run(
	args: string[],
	options: { tenant?: boolean; tty?: boolean; shell?: string } = {},
) {
	const argv = ["node", resolve("dist/boldvideo.js"), ...args];
	const child = spawn(
		options.tty ? "script" : options.shell ? "sh" : "node",
		options.tty
			? ["-qefc", argv.map(quote).join(" "), "/dev/null"]
			: options.shell
				? [
						"-c",
						options.shell.replace(
							"boldvideo",
							`node ${quote(resolve("dist/boldvideo.js"))}`,
						),
					]
				: argv.slice(1),
		{
			env: {
				...process.env,
				NO_COLOR: "1",
				FORCE_COLOR: undefined,
				BOLDVIDEO_API_KEY: options.tenant
					? "bold_test_tenant_2032"
					: "bold_test_admin_2032",
				BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}/api/v1`,
				XDG_CONFIG_HOME: temporary,
				APPDATA: temporary,
			},
			stdio: "pipe",
		},
	);
	let stdout = "",
		stderr = "";
	child.stdout.on("data", (data) => {
		stdout += data;
	});
	child.stderr.on("data", (data) => {
		stderr += data;
	});
	child.stdin.end();
	const status = await new Promise<number | null>((resolve, reject) => {
		child.on("close", resolve);
		child.on("error", reject);
	});
	return { status, stdout: stdout.replaceAll("\r\n", "\n"), stderr };
}

test("admin filters, bounded pages, fields and executable continuation preserve shell quoting", async () => {
	const args = [
		"videos",
		"list",
		"--status",
		"ready",
		"--privacy",
		"private",
		"--collection",
		"Director's workshops",
		"--tag",
		"sales",
		"--type",
		"workshop",
		"--since",
		"2026-10-01T00:00:00Z",
		"--limit",
		"1",
		"--fields",
		"internal_id,title",
		"--profile",
		"customer-demo",
		"--json",
	];
	const first = await run(args);
	expect(first.status).toBe(0);
	expect(first.stderr).toBe("");
	const page = JSON.parse(first.stdout);
	expect(page.items).toEqual([
		{ internal_id: video.internal_id, title: "Paid workshops" },
	]);
	expect(page.has_more).toBe(true);
	expect(page.next).toContain("--page 2 --limit 1");
	expect(page.next).toContain("--profile 'customer-demo'");
	expect(page.next).toEndWith("--json");
	expect(calls.map((url) => url.pathname)).toEqual([
		"/api/v1/me",
		"/api/v1/admin/videos",
	]);
	expect(Object.fromEntries(calls[1]?.searchParams ?? [])).toEqual({
		page: "1",
		page_size: "1",
		status: "ready",
		privacy: "private",
		collection: "Director's workshops",
		tag: "sales",
		type: "workshop",
		updated_since: "2026-10-01T00:00:00Z",
	});
	const last = await run([], { shell: page.next });
	expect(last.status).toBe(0);
	expect(JSON.parse(last.stdout)).toEqual({
		items: page.items,
		has_more: false,
	});
	expect(calls[3]?.searchParams.get("collection")).toBe("Director's workshops");
	expect(calls[3]?.searchParams.get("page")).toBe("2");
});

test("terminal list uses full IDs, mm:ss duration and continuation; tenant notice is terminal-only", async () => {
	const admin = await run(["videos", "list"], { tty: true });
	expect(admin.status).toBe(0);
	expect(admin.stdout).toContain("ID");
	for (const value of [
		video.internal_id,
		"TITLE",
		"STATUS",
		"PRIVACY",
		"PUBLISHED",
		"DURATION",
		"2:05",
		"More results: boldvideo videos list --page 2 --limit 20",
	])
		expect(admin.stdout).toContain(value as string);
	const tenant = await run(["videos", "list"], { tenant: true, tty: true });
	expect(tenant.status).toBe(0);
	expect(
		tenant.stdout.split("Tenant keys list public videos only."),
	).toHaveLength(2);
	expect(calls.at(-1)?.pathname).toBe("/api/v1/videos");
	const piped = await run(["videos", "list"], { tenant: true });
	expect(piped.stderr).toBe("");
	expect(JSON.parse(piped.stdout).items).toEqual([publicVideo.data]);
	const fields = await run(["videos", "list", "--fields", "id,title"], {
		tty: true,
	});
	expect(fields.stdout).toContain("ID      TITLE\nk8N2pQ  Paid workshops");
});

test("get accepts UUID, hashid and slug, chooses public/admin paths and displays readiness", async () => {
	for (const tenant of [false, true])
		for (const id of [video.internal_id, video.id, video.slug]) {
			const result = await run(["videos", "get", id as string], { tenant });
			expect(result.status).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual(
				tenant ? publicVideo.data : video,
			);
			expect(calls.at(-1)?.pathname).toBe(
				`/api/v1${tenant ? "" : "/admin"}/videos/${id}`,
			);
		}
	const terminal = await run(["videos", "get", "paid-workshops"], {
		tty: true,
	});
	expect(terminal.status).toBe(0);
	expect(terminal.stdout).toContain("KEY");
	expect(terminal.stdout).toContain("VALUE");
	expect(terminal.stdout).toMatch(/ready\s+true/);
	expect(terminal.stdout).toMatch(/failure_reason\s+null/);
});

test("transcripts support every format, defaults, public route for both keys and raw file output", async () => {
	for (const tenant of [false, true])
		for (const format of ["txt", "srt", "vtt", "json"] as const) {
			const args = [
				"videos",
				"transcript",
				"paid-workshops",
				"--format",
				format,
			];
			const result = await run(args, { tenant });
			expect(result.status).toBe(0);
			expect(result.stderr).toBe("");
			expect(JSON.parse(result.stdout)).toEqual(transcripts[format]);
			expect(calls.at(-1)?.pathname).toBe(
				"/api/v1/videos/paid-workshops/transcript",
			);
			const out = join(temporary, `workshops.${format}`);
			const saved = await run([...args, "--out", out], { tenant });
			expect(saved.status).toBe(0);
			expect(JSON.parse(saved.stdout)).toEqual({ out, format });
			expect(readFileSync(out, "utf8")).toBe(
				format === "json"
					? JSON.stringify(transcripts.json)
					: transcripts[format],
			);
		}
	expect(
		JSON.parse((await run(["videos", "transcript", "paid-workshops"])).stdout),
	).toEqual(transcripts.json);
	expect(
		(await run(["videos", "transcript", "paid-workshops"], { tty: true }))
			.stdout,
	).toBe(transcripts.txt);
	expect(calls.at(-1)?.searchParams.get("format")).toBe("txt");
});

test("transcript dry-run preserves existing files and does not fetch a transcript", async () => {
	for (const exists of [false, true]) {
		const out = join(temporary, exists ? "existing.srt" : "preview.srt");
		if (exists) writeFileSync(out, "Existing subtitles\n");
		const preview = await run([
			"videos",
			"transcript",
			"paid-workshops",
			"--format",
			"srt",
			"--out",
			out,
			"--dry-run",
		]);
		expect(preview.status).toBe(0);
		expect(JSON.parse(preview.stdout)).toEqual({
			out,
			format: "srt",
			dry_run: true,
		});
		expect(existsSync(out)).toBe(exists);
		if (exists) expect(readFileSync(out, "utf8")).toBe("Existing subtitles\n");
	}
	expect(calls).toHaveLength(0);
});

test("unpaginated public lists default to 20 and continue by increasing the limit, not the page", async () => {
	unpaginated = true;
	const result = await run(["videos", "list"], { tenant: true });
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	const first = JSON.parse(result.stdout);
	expect(first.items.map((item: { id: string }) => item.id)).toEqual(
		Array.from({ length: 20 }, (_, index) => `public-workshop-${index + 1}`),
	);
	expect(first).toMatchObject({
		has_more: true,
		next: "boldvideo videos list --page 1 --limit 23",
	});
	const last = await run([], { tenant: true, shell: first.next });
	expect(last.status).toBe(0);
	const complete = JSON.parse(last.stdout);
	expect(complete.items).toHaveLength(23);
	expect(complete.items[22].id).toBe("public-workshop-23");
	expect(complete.has_more).toBe(false);
	expect(complete.next).toBeUndefined();
	const projected = await run(
		[
			"videos",
			"list",
			"--limit",
			"1",
			"--page",
			"3",
			"--tag",
			"Director's picks",
			"--fields",
			"id,title",
			"--profile",
			"customer-demo",
			"--json",
		],
		{ tenant: true },
	);
	const small = JSON.parse(projected.stdout);
	expect(small.items).toEqual([
		{ id: "public-workshop-1", title: "Paid workshops" },
	]);
	expect(small.next).toContain("--page 3 --limit 2");
	expect(small.next).toContain("--profile 'customer-demo'");
	expect(small.next).toContain("--fields 'id,title'");
	expect(small.next).toEndWith("--json");
	const continued = await run([], { tenant: true, shell: small.next });
	expect(continued.status).toBe(0);
	expect(JSON.parse(continued.stdout).items).toEqual([
		{ id: "public-workshop-1", title: "Paid workshops" },
		{ id: "public-workshop-2", title: "Paid workshops" },
	]);
	expect(calls.at(-1)?.searchParams.get("tag")).toBe("Director's picks");
	const terminal = await run(["videos", "list"], { tenant: true, tty: true });
	expect(terminal.status).toBe(0);
	expect(terminal.stdout).toContain(
		"More results: boldvideo videos list --page 1 --limit 23",
	);
	for (const count of [0, 20]) {
		publicCount = count;
		const page = await run(["videos", "list"], { tenant: true });
		expect(page.status).toBe(0);
		const data = JSON.parse(page.stdout);
		expect(data.items).toHaveLength(count);
		expect(data.has_more).toBe(false);
		expect(data.next).toBeUndefined();
	}
	unpaginated = false;
	const paginated = await run(["videos", "list", "--limit", "1"], {
		tenant: true,
	});
	expect(JSON.parse(paginated.stdout).next).toBe(
		"boldvideo videos list --page 2 --limit 1",
	);
});

test("missing videos and pending transcripts exit 4 with actionable hints and request IDs", async () => {
	for (const command of ["get", "transcript"]) {
		const missing = await run(["videos", command, "missing-video"]);
		expect(missing.status).toBe(4);
		expect(missing.stdout).toBe("");
		expect(JSON.parse(missing.stderr)).toMatchObject({
			code: "not_found",
			hint: "boldvideo videos list",
			request_id: "req_missing_2032",
		});
	}
	const pending = await run(["videos", "transcript", "processing"]);
	expect(pending.status).toBe(4);
	expect(pending.stdout).toBe("");
	expect(JSON.parse(pending.stderr)).toMatchObject({
		code: "transcript_not_ready",
		hint: expect.stringContaining("boldvideo videos get 'processing'"),
		request_id: "req_transcript_2032",
	});
	expect(JSON.parse(pending.stderr).hint).toContain("--wait");
});

test("invalid pages and formats fail before requesting the API", async () => {
	for (const page of ["0", "-1", "1.5", "9007199254740992"])
		expect((await run(["videos", "list", `--page=${page}`])).status).toBe(2);
	expect(
		(await run(["videos", "transcript", "paid-workshops", "--format", "html"]))
			.status,
	).toBe(2);
	expect(calls).toHaveLength(0);
});
