import {
	afterAll,
	beforeEach,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { csvRows } from "../src/csv";
import collections from "./fixtures/import-collections.json";
import me from "./fixtures/me.json";
import { run as execute, type RunOptions } from "./run";

// Every test starts node processes; this machine may be busy.
setDefaultTimeout(120_000);

const PART = 4;
const temporary = mkdtempSync(join(tmpdir(), "boldvideo-import-files-"));

// A stand-in for the admin upload routes and for storage. A video is found again
// by its external_id; storage keeps each part's bytes so tests can read the file back.
interface Video {
	id: string;
	body: Record<string, unknown>;
	parts: Map<number, string>;
	open: boolean;
	done: boolean;
	polls: number;
}
const calls: { method: string; path: string; body: unknown }[] = [];
let videos = new Map<string, Video>();
/** Answers to give before behaving normally, by route. */
let scripted: Record<string, { status: number; body: unknown }[]> = {};
let failingFile = "";
let slowPuts = 0;
let dropPut = "";
let failPut = "";
let active = 0;
let mostActive = 0;
let putsInFlight = 0;
let mostPutsInFlight = 0;
let onPut: (() => void) | undefined;
let brokenVideo = "";

const byId = (id: string) =>
	[...videos.values()].find((video) => video.id === id) as Video;
const record = (video: Video) => ({
	internal_id: video.id,
	title: video.body.title ?? String(video.body.filename).replace(/\.\w+$/, ""),
	status: video.done ? "preparing" : "uploading",
	ready: false,
	failure_reason: null,
});
const upload = (video: Video) =>
	video.open
		? {
				id: video.id,
				part_size: PART,
				uploaded_parts: [...video.parts]
					.sort(([a], [b]) => a - b)
					.map(([part_number, bytes]) => ({ part_number, size: bytes.length })),
			}
		: null;
const stored = (video: Video) =>
	[...video.parts]
		.sort(([a], [b]) => a - b)
		.map(([, bytes]) => bytes)
		.join("");

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/storage/")) {
			const [, , id, number] = url.pathname.split("/");
			const bytes = await request.text();
			const video = byId(id as string);
			calls.push({ method: "PUT", path: url.pathname, body: bytes });
			putsInFlight++;
			mostPutsInFlight = Math.max(mostPutsInFlight, putsInFlight);
			onPut?.();
			if (slowPuts) await Bun.sleep(slowPuts);
			putsInFlight--;
			if (failPut === url.pathname) {
				failPut = "";
				return new Response("SlowDown", { status: 503 });
			}
			if (dropPut === url.pathname) dropPut = "";
			else video.parts.set(Number(number), bytes);
			return new Response(null, { headers: { ETag: `"etag-${number}"` } });
		}
		const path = url.pathname.replace("/api/v1", "");
		const text = request.method === "POST" ? await request.text() : "";
		const body = text ? JSON.parse(text) : undefined;
		calls.push({ method: request.method, path, body });
		if (path === "/me")
			return Response.json({
				data: {
					...me.data,
					key: {
						...me.data.key,
						kind:
							request.headers.get("authorization") ===
							"Bearer bold_test_admin_2036"
								? "admin"
								: "tenant",
					},
				},
			});
		if (path === "/collections") return Response.json(collections);
		const route = path
			.replace(/^\/admin\/uploads\/[^/]+/, "/admin/uploads/:id")
			.replace(/^\/admin\/videos\/[^/]+/, "/admin/videos/:id");
		const next = scripted[`${request.method} ${route}`]?.shift();
		if (next)
			return Response.json(next.body, {
				status: next.status,
				headers: { "x-request-id": "req_upload_2036" },
			});
		if (request.method === "POST" && path === "/admin/uploads") {
			if (body.filename === failingFile)
				return Response.json(
					{
						error: "validation_error",
						details: {
							size: ["is larger than this account allows (300000000 bytes)"],
						},
					},
					{ status: 422 },
				);
			let video = videos.get(body.external_id);
			const existed = Boolean(video);
			if (!video) {
				video = {
					id: `video-${videos.size + 1}`,
					body,
					parts: new Map(),
					open: true,
					done: false,
					polls: 0,
				};
				videos.set(body.external_id, video);
			}
			if (!video.done) {
				video.open = true;
				active++;
				mostActive = Math.max(mostActive, active);
			}
			return Response.json(
				{ data: record(video), deduplicated: existed, upload: upload(video) },
				{ status: existed ? 200 : 201 },
			);
		}
		const id = path.split("/")[3] as string;
		if (route === "/admin/uploads/:id/parts") {
			const video = byId(id);
			if (!video.open)
				return Response.json(
					{ error: "no_upload", details: {} },
					{ status: 409 },
				);
			return Response.json({
				expires_in: 3600,
				parts: body.part_numbers.map((part_number: number) => ({
					part_number,
					url: `http://127.0.0.1:${server.port}/storage/${id}/${part_number}`,
				})),
			});
		}
		if (route === "/admin/uploads/:id/complete") {
			const video = byId(id);
			if (!video.done) {
				const uploaded = stored(video).length;
				if (uploaded !== body.size)
					return Response.json(
						{
							error: "incomplete_upload",
							details: { uploaded_bytes: uploaded, expected_bytes: body.size },
						},
						{ status: 422 },
					);
				video.done = true;
				video.open = false;
				active--;
			}
			return Response.json({ data: record(video), upload: null });
		}
		if (route === "/admin/uploads/:id") {
			const video = byId(id);
			return Response.json({ data: record(video), upload: upload(video) });
		}
		if (route === "/admin/videos/:id") {
			const video = byId(id);
			video.polls++;
			return Response.json({
				data:
					video.id === brokenVideo
						? {
								...record(video),
								status: "failed",
								failure_reason: "Audio could not be transcribed.",
							}
						: { ...record(video), status: "ready", ready: video.polls > 1 },
			});
		}
		return Response.json({ message: "Not found." }, { status: 404 });
	},
});

beforeEach(() => {
	calls.length = 0;
	videos = new Map();
	scripted = {};
	failingFile = dropPut = failPut = brokenVideo = "";
	slowPuts = active = mostActive = putsInFlight = mostPutsInFlight = 0;
	onPut = undefined;
});
afterAll(() => {
	server.stop(true);
	rmSync(temporary, { recursive: true, force: true });
});

function run(args: string[], options: RunOptions = {}) {
	return execute(["node", resolve("dist/boldvideo.js"), "import", ...args], {
		...options,
		env: {
			BOLDVIDEO_API_KEY: "bold_test_admin_2036",
			BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}/api/v1`,
			XDG_CONFIG_HOME: temporary,
			APPDATA: temporary,
			...options.env,
		},
	});
}

let folders = 0;
/** A folder of files, each given as its content. */
function folder(files: Record<string, string>) {
	const root = join(temporary, `recordings-${++folders}`);
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(root, name, ".."), { recursive: true });
		writeFileSync(join(root, name), content);
	}
	return root;
}
const posts = (route: string) =>
	calls.filter((call) => call.method === "POST" && call.path === route);
const puts = () =>
	calls.filter((call) => call.method === "PUT").map((call) => call.path);
const named = (filename: string) =>
	[...videos.values()].find(
		(video) => video.body.filename === filename,
	) as Video;

test("a plain folder uploads every video file, in parts, and nothing else", async () => {
	const root = folder({
		"group-call-12.mp4": "0123456789",
		"intro.MOV": "abc",
		"notes.txt": "not a video",
		".hidden.mp4": "skip",
		"sub/deep.mp4": "not without --recursive",
	});
	const result = await run(["dir", root]);
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
	const data = JSON.parse(result.stdout);
	expect(data.items.map((item: { file: string }) => item.file)).toEqual([
		"group-call-12.mp4",
		"intro.MOV",
	]);
	expect(data.items[0]).toMatchObject({
		ok: true,
		status: "uploaded",
		video: { internal_id: "video-1", status: "preparing", deduplicated: false },
	});
	expect(data.results).toBeUndefined();
	expect(stored(named("group-call-12.mp4"))).toBe("0123456789");
	expect(named("group-call-12.mp4").parts.size).toBe(3);
	expect(stored(named("intro.MOV"))).toBe("abc");
	expect(named("group-call-12.mp4").body).toMatchObject({
		filename: "group-call-12.mp4",
		size: 10,
		privacy: "unlisted",
	});
	// No title is sent: the server names the video after the file.
	expect(named("group-call-12.mp4").body.title).toBeUndefined();
	expect(named("group-call-12.mp4").body.external_id).toMatch(
		/^cli-[\da-f]{24}$/,
	);
	expect(posts("/admin/uploads/video-1/complete").at(-1)?.body).toEqual({
		size: 10,
	});

	const terminal = await run(["dir", root], { tty: true });
	expect(terminal.status).toBe(0);
	expect(terminal.stdout).toContain("FILE");
	expect(terminal.stdout).toContain("already_uploaded");
});

test("--recursive, --include and --exclude choose the files", async () => {
	const root = folder({
		"a.mp4": "aaaa",
		"week1/b.mp4": "bbbb",
		"week1/draft-c.mp4": "cccc",
		"week2/d.mts": "dddd",
		"week2/e.mp4": "eeee",
	});
	const files = async (...args: string[]) =>
		JSON.parse(
			(await run(["dir", root, "--dry-run", ...args])).stdout,
		).items.map((item: { file: string }) => item.file);
	expect(await files()).toEqual(["a.mp4"]);
	expect(await files("--recursive")).toEqual([
		"a.mp4",
		"week1/b.mp4",
		"week1/draft-c.mp4",
		"week2/e.mp4",
	]);
	expect(await files("-r", "--exclude", "draft-*")).toEqual([
		"a.mp4",
		"week1/b.mp4",
		"week2/e.mp4",
	]);
	expect(await files("-r", "--include", "week1/*")).toEqual([
		"week1/b.mp4",
		"week1/draft-c.mp4",
	]);
	// --include replaces the video-extension filter, so other file types can be named.
	expect(await files("-r", "--include", "*.mts,a.*")).toEqual([
		"a.mp4",
		"week2/d.mts",
	]);
	expect(await files("-r", "--include", "**/e.mp4")).toEqual(["week2/e.mp4"]);

	const none = await run(["dir", root, "--include", "*.wav"]);
	expect(none.status).toBe(2);
	expect(JSON.parse(none.stderr).message).toContain("No video files");
	expect(posts("/admin/uploads")).toEqual([]);
});

test("a map sets metadata per file over the command-line defaults and gets a result CSV", async () => {
	const root = folder({
		"call-12.mp4": "0123456789",
		"call-13.mp4": "abcdef",
		"extra.mp4": "zz",
	});
	const map = join(root, "meta.csv");
	writeFileSync(
		map,
		[
			"file,title,published_at,type,tags,collection,privacy,external_id",
			'call-12.mp4,"Call 12: pricing, live",2026-11-20,workshop,"pricing, calls",Coaching,private,kajabi-441',
			"call-13.mp4,,,,,,,",
		].join("\n"),
	);
	const result = await run([
		"dir",
		root,
		"--map",
		map,
		"--tags",
		"archive",
		"--collection",
		"workshops",
		"--privacy",
		"public",
		"--language",
		"de",
	]);
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
	expect(named("call-12.mp4").body).toEqual({
		filename: "call-12.mp4",
		size: 10,
		title: "Call 12: pricing, live",
		published_at: "2026-11-20T00:00:00.000Z",
		video_type: "workshop",
		tags: ["pricing", "calls"],
		collection_ids: ["3df0cf1c-b63d-4ab4-b9e1-e2767f2cd075"],
		privacy: "private",
		external_id: "kajabi-441",
		language: "de",
	});
	// A row's empty cells, and a file the map does not name, take the defaults.
	for (const filename of ["call-13.mp4", "extra.mp4"])
		expect(named(filename).body).toMatchObject({
			tags: ["archive"],
			collection_ids: ["b1c5296d-caf9-4bf4-a037-dcf191650350"],
			privacy: "public",
			language: "de",
		});
	expect(posts("/collections")).toEqual([]);
	expect(calls.filter((call) => call.path === "/collections")).toHaveLength(1);

	const results = join(root, "meta.results.csv");
	expect(JSON.parse(result.stdout).results).toBe(results);
	expect(csvRows(readFileSync(results, "utf8"))).toEqual([
		[
			"file",
			"title",
			"published_at",
			"type",
			"tags",
			"collection",
			"privacy",
			"external_id",
			"status",
			"bold_id",
			"error_msg",
		],
		[
			"call-12.mp4",
			"Call 12: pricing, live",
			"2026-11-20",
			"workshop",
			"pricing, calls",
			"Coaching",
			"private",
			"kajabi-441",
			"uploaded",
			named("call-12.mp4").id,
			"",
		],
		[
			"call-13.mp4",
			"",
			"",
			"",
			"",
			"",
			"",
			"",
			"uploaded",
			named("call-13.mp4").id,
			"",
		],
		[
			"extra.mp4",
			"",
			"",
			"",
			"",
			"",
			"",
			"",
			"uploaded",
			named("extra.mp4").id,
			"",
		],
	]);

	// The result CSV works as the next map: its result columns are rewritten, not doubled.
	const again = await run([
		"dir",
		root,
		"--map",
		results,
		"--results",
		results,
	]);
	expect(again.status).toBe(0);
	const rows = csvRows(readFileSync(results, "utf8"));
	expect(rows[0]?.filter((column) => column === "status")).toHaveLength(1);
	expect(rows.slice(1).map((row) => row.at(-3))).toEqual([
		"already_uploaded",
		"already_uploaded",
		"already_uploaded",
	]);
});

test("a map with unknown columns, bad values or no file column stops before anything is sent", async () => {
	const root = folder({ "call-12.mp4": "0123456789" });
	const map = join(root, "meta.csv");
	const refuse = async (content: string) => {
		writeFileSync(map, content);
		const result = await run(["dir", root, "--map", map]);
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		return JSON.parse(result.stderr);
	};
	expect(
		(await refuse("file,titel,speaker\ncall-12.mp4,Call 12,Dan")).message,
	).toBe(
		"Unknown map column(s): titel, speaker. Allowed: file, title, published_at, type, tags, collection, privacy, external_id.",
	);
	expect((await refuse("title\nCall 12")).message).toContain("file column");
	expect((await refuse("file,privacy\ncall-12.mp4,secret")).message).toBe(
		"Map row for 'call-12.mp4': privacy must be public, unlisted or private.",
	);
	expect(
		(await refuse("file,published_at\ncall-12.mp4,20 Nov")).message,
	).toContain(
		"Map row for 'call-12.mp4': published_at must be a valid ISO date",
	);
	expect((await refuse("file\ncall-12.mp4\ncall-12.mp4")).message).toContain(
		"more than once",
	);
	const missing = await run(["dir", root, "--map", join(root, "nope.csv")]);
	expect(missing.status).toBe(2);
	expect(JSON.parse(missing.stderr).code).toBe("usage_error");
	expect(posts("/admin/uploads")).toEqual([]);
	expect(existsSync(join(root, "meta.results.csv"))).toBe(false);
});

test("--dry-run checks the map against the folder, names missing files and writes nothing", async () => {
	const root = folder({ "call-12.mp4": "0123456789", "sub/call-14.mp4": "x" });
	const map = join(root, "meta.csv");
	writeFileSync(
		map,
		"file,title\ncall-12.mp4,Call 12\ncall-13.mp4,Call 13\nsub/call-14.mp4,Call 14\n",
	);
	const result = await run(["dir", root, "--map", map, "--dry-run"]);
	expect(result.status).toBe(1);
	const data = JSON.parse(result.stdout);
	expect(data.dry_run).toBe(true);
	expect(data.items).toMatchObject([
		{
			file: "call-12.mp4",
			ok: true,
			action: "upload",
			size: 10,
			body: { filename: "call-12.mp4", size: 10, title: "Call 12" },
		},
		{
			file: "call-13.mp4",
			ok: false,
			action: "missing",
			error: { code: "not_found" },
		},
		// On disk, but in a subfolder and --recursive was not given.
		{ file: "sub/call-14.mp4", ok: true, action: "skipped" },
	]);
	expect(JSON.parse(result.stderr)).toMatchObject({
		code: "bulk_failed",
		message: "1 of 3 file(s) failed: call-13.mp4.",
	});
	expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
	expect(existsSync(join(root, "meta.results.csv"))).toBe(false);

	const text = await run(["dir", root, "--map", map, "--dry-run"], {
		tty: true,
	});
	expect(text.stdout).toContain("ACTION");
	expect(text.stdout).toContain("missing");
});

test("a real run reports a file missing from the folder and still uploads the rest", async () => {
	const root = folder({ "call-12.mp4": "0123456789" });
	const map = join(root, "meta.csv");
	writeFileSync(map, "file,title\ncall-13.mp4,Call 13\ncall-12.mp4,Call 12\n");
	const result = await run(["dir", root, "--map", map]);
	expect(result.status).toBe(1);
	expect(JSON.parse(result.stdout).items).toMatchObject([
		{ file: "call-13.mp4", ok: false, status: "missing" },
		{ file: "call-12.mp4", ok: true, status: "uploaded" },
	]);
	expect(csvRows(readFileSync(join(root, "meta.results.csv"), "utf8"))).toEqual(
		[
			["file", "title", "status", "bold_id", "error_msg"],
			[
				"call-13.mp4",
				"Call 13",
				"missing",
				"",
				"'call-13.mp4' is in the map but not in the folder.",
			],
			["call-12.mp4", "Call 12", "uploaded", "video-1", ""],
		],
	);
});

test("a second run sends only the parts storage is missing or holds at the wrong size", async () => {
	const root = folder({ "call-12.mp4": "0123456789ABCDEF" });
	// An earlier run got two parts in; one of them is cut short.
	const first = await run(["dir", root, "--dry-run"]);
	const { external_id } = JSON.parse(first.stdout).items[0].body;
	videos.set(external_id, {
		id: "video-1",
		body: { filename: "call-12.mp4", external_id },
		parts: new Map([
			[1, "0123"],
			[3, "89"],
		]),
		open: true,
		done: false,
		polls: 0,
	});
	const result = await run(["dir", root]);
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout).items[0]).toMatchObject({
		status: "uploaded",
		video: { internal_id: "video-1", deduplicated: true },
	});
	expect(puts().sort()).toEqual([
		"/storage/video-1/2",
		"/storage/video-1/3",
		"/storage/video-1/4",
	]);
	expect(stored(byId("video-1"))).toBe("0123456789ABCDEF");
	expect(videos.size).toBe(1);
});

test("a file that is already in counts as done and sends nothing", async () => {
	const root = folder({ "call-12.mp4": "0123456789" });
	expect((await run(["dir", root])).status).toBe(0);
	calls.length = 0;
	const result = await run(["dir", root, "--results", join(root, "out.csv")]);
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout).items).toMatchObject([
		{ file: "call-12.mp4", ok: true, status: "already_uploaded" },
	]);
	expect(puts()).toEqual([]);
	expect(posts("/admin/uploads/video-1/complete")).toEqual([]);
	// --results works without a map.
	expect(csvRows(readFileSync(join(root, "out.csv"), "utf8"))).toEqual([
		["file", "status", "bold_id", "error_msg"],
		["call-12.mp4", "already_uploaded", "video-1", ""],
	]);
});

test("upload_busy, 502 and a refused part are repeated until they pass", async () => {
	const root = folder({ "call-12.mp4": "0123456789" });
	const busy = {
		status: 409,
		body: {
			error: "upload_busy",
			details: {
				upload: [
					"Another request is working on this upload. Try again shortly.",
				],
			},
		},
	};
	scripted = {
		"POST /admin/uploads": [busy],
		"POST /admin/uploads/:id/parts": [
			{ status: 502, body: { error: "storage_unavailable", details: {} } },
		],
		"POST /admin/uploads/:id/complete": [
			busy,
			{ status: 502, body: { error: "processing_failed", details: {} } },
		],
	};
	failPut = "/storage/video-1/2";
	const result = await run(["dir", root]);
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
	expect(stored(byId("video-1"))).toBe("0123456789");
	expect(posts("/admin/uploads")).toHaveLength(2);
	expect(posts("/admin/uploads/video-1/complete")).toHaveLength(3);
	expect(puts().filter((path) => path === "/storage/video-1/2")).toHaveLength(
		2,
	);
});

test("409 no_upload is not mistaken for busy: the upload starts over", async () => {
	const root = folder({ "call-12.mp4": "0123456789" });
	scripted = {
		"POST /admin/uploads/:id/complete": [
			{ status: 409, body: { error: "no_upload", details: {} } },
		],
	};
	const result = await run(["dir", root]);
	expect(result.status).toBe(0);
	expect(posts("/admin/uploads")).toHaveLength(2);
	expect(posts("/admin/uploads/video-1/complete")).toHaveLength(2);
});

test("when storage holds less than was sent, the missing part is sent and completion repeated", async () => {
	const root = folder({ "call-12.mp4": "0123456789" });
	dropPut = "/storage/video-1/2";
	const result = await run(["dir", root]);
	expect(result.status).toBe(0);
	expect(stored(byId("video-1"))).toBe("0123456789");
	expect(calls.map((call) => `${call.method} ${call.path}`)).toContain(
		"GET /admin/uploads/video-1",
	);
	expect(puts().filter((path) => path === "/storage/video-1/2")).toHaveLength(
		2,
	);
	expect(posts("/admin/uploads/video-1/complete")).toHaveLength(2);
});

test("one failing file does not stop the others; exit 1 and every file is listed", async () => {
	const root = folder({
		"a.mp4": "aaaa",
		"too-big.mp4": "bbbbbbbb",
		"c.mp4": "cccc",
		"empty.mp4": "",
	});
	failingFile = "too-big.mp4";
	const results = join(root, "out.csv");
	const result = await run(["dir", root, "--results", results]);
	expect(result.status).toBe(1);
	const { items } = JSON.parse(result.stdout);
	expect(items).toMatchObject([
		{ file: "a.mp4", ok: true, status: "uploaded" },
		{ file: "c.mp4", ok: true, status: "uploaded" },
		{
			file: "empty.mp4",
			ok: false,
			status: "failed",
			error: { code: "validation_error", message: "The file is empty." },
		},
		{
			file: "too-big.mp4",
			ok: false,
			status: "failed",
			error: {
				code: "validation_error",
				message:
					"Upload refused: size is larger than this account allows (300000000 bytes).",
			},
		},
	]);
	expect(items[3].error.exitCode).toBeUndefined();
	const failure = JSON.parse(result.stderr);
	expect(failure).toMatchObject({
		code: "bulk_failed",
		message: "2 of 4 file(s) failed: empty.mp4, too-big.mp4.",
	});
	// The hint is the command to run again.
	expect(failure.hint).toContain(`boldvideo import dir ${root} --results`);
	expect(csvRows(readFileSync(results, "utf8")).map((row) => row[1])).toEqual([
		"status",
		"uploaded",
		"uploaded",
		"failed",
		"failed",
	]);
});

test("--concurrency bounds the files in flight, and parts in memory stay bounded", async () => {
	const files = Object.fromEntries(
		Array.from({ length: 6 }, (_, i) => [
			`call-${i}.mp4`,
			"0123456789ABCDEFGHIJ",
		]),
	);
	const root = folder(files);
	slowPuts = 40;
	const result = await run(["dir", root, "--concurrency", "2"]);
	expect(result.status).toBe(0);
	expect(mostActive).toBe(2);
	expect(mostPutsInFlight).toBeLessThanOrEqual(4);
	expect(videos.size).toBe(6);
	for (const video of videos.values())
		expect(stored(video)).toBe("0123456789ABCDEFGHIJ");

	for (const value of ["0", "17", "1.5"]) {
		const refused = await run(["dir", root, "--concurrency", value]);
		expect(refused.status).toBe(2);
		expect(JSON.parse(refused.stderr).message).toContain("--concurrency");
	}
});

test("one large file sends several parts at once, never more than four", async () => {
	const root = folder({ "long.mp4": "x".repeat(PART * 12) });
	slowPuts = 30;
	const result = await run(["file", join(root, "long.mp4")]);
	expect(result.status).toBe(0);
	expect(mostPutsInFlight).toBeGreaterThan(1);
	expect(mostPutsInFlight).toBeLessThanOrEqual(4);
	// Part URLs are asked for in small batches, close to when they are used.
	const batches = posts("/admin/uploads/video-1/parts").map(
		(call) => (call.body as { part_numbers: number[] }).part_numbers.length,
	);
	expect(Math.max(...batches)).toBeLessThanOrEqual(8);
	expect(batches.length).toBeGreaterThan(1);
});

test("Ctrl-C leaves a result CSV and says how to continue; the same command finishes the run", async () => {
	const root = folder({
		"a.mp4": "0123456789ABCDEF",
		"b.mp4": "0123456789ABCDEF",
	});
	const results = join(root, "out.csv");
	slowPuts = 400;
	let reached = 0;
	const args = ["dir", root, "--concurrency", "1", "--results", results];
	const stopped = await run(args, {
		interruptWhen: new Promise<void>((seen) => {
			onPut = () => {
				// The first batch is in flight; the first part will have landed by the third PUT's start.
				if (++reached === 4) seen();
			};
		}),
	});
	expect(stopped.status).toBe(130);
	expect(stopped.stdout).toBe("");
	const failure = JSON.parse(stopped.stderr);
	expect(failure.code).toBe("interrupted");
	expect(failure.hint).toContain(
		`boldvideo import dir ${root} --concurrency 1`,
	);
	expect(csvRows(readFileSync(results, "utf8")).slice(1)).toEqual([
		["a.mp4", "pending", "", ""],
		["b.mp4", "pending", "", ""],
	]);
	await Bun.sleep(600);
	const held = byId("video-1").parts.size;
	expect(held).toBeGreaterThan(0);

	slowPuts = 0;
	onPut = undefined;
	calls.length = 0;
	const resumed = await run(args);
	expect(resumed.status).toBe(0);
	expect(
		puts().filter((path) => path.startsWith("/storage/video-1/")),
	).toHaveLength(4 - held);
	expect(videos.size).toBe(2);
	for (const video of videos.values())
		expect(stored(video)).toBe("0123456789ABCDEF");
	expect(csvRows(readFileSync(results, "utf8")).map((row) => row[1])).toEqual([
		"status",
		"uploaded",
		"uploaded",
	]);
});

test("--wait holds until every upload is searchable and reports the ones that fail", async () => {
	const root = folder({ "a.mp4": "aaaa", "b.mp4": "bbbb" });
	const waiting = ["--wait", "--poll-interval", "0.01", "--timeout", "20"];
	const ready = await run(["dir", root, ...waiting]);
	expect(ready.status).toBe(0);
	expect(
		JSON.parse(ready.stdout).items.map(
			(item: { video: { ready: boolean } }) => item.video.ready,
		),
	).toEqual([true, true]);

	brokenVideo = "video-2";
	const broken = await run(["dir", root, ...waiting]);
	expect(broken.status).toBe(1);
	expect(JSON.parse(broken.stdout).items).toMatchObject([
		{ file: "a.mp4", ok: true, status: "already_uploaded" },
		{
			file: "b.mp4",
			ok: false,
			status: "failed",
			error: {
				code: "import_failed",
				message: "Video import failed: Audio could not be transcribed..",
			},
		},
	]);

	const refused = await run(["dir", root, "--wait", "--timeout", "0"]);
	expect(refused.status).toBe(2);
});

test("import file uploads one file, returns its record and keeps its own exit codes", async () => {
	const root = folder({ "group-call-12.mp4": "0123456789", "odd.bin": "abc" });
	const file = join(root, "group-call-12.mp4");
	const result = await run([
		"file",
		file,
		"--title",
		"Group call 12: pricing",
		"--description",
		"Recorded live",
		"--external-id",
		"kajabi-441",
		"--collection",
		"Coaching",
		"--published-at",
		"2026-11-20T10:00:00+01:00",
	]);
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({
		internal_id: "video-1",
		title: "Group call 12: pricing",
		status: "preparing",
		ready: false,
		failure_reason: null,
		deduplicated: false,
	});
	expect(named("group-call-12.mp4").body).toEqual({
		filename: "group-call-12.mp4",
		size: 10,
		title: "Group call 12: pricing",
		description: "Recorded live",
		external_id: "kajabi-441",
		collection_ids: ["3df0cf1c-b63d-4ab4-b9e1-e2767f2cd075"],
		published_at: "2026-11-20T09:00:00.000Z",
		privacy: "unlisted",
	});

	// Any file type goes: the extension filter is for folders.
	expect((await run(["file", join(root, "odd.bin")])).status).toBe(0);
	// The same file through a folder run is the same video.
	const viaFolder = await run(["dir", root, "--include", "odd.bin"]);
	expect(JSON.parse(viaFolder.stdout).items[0].status).toBe("already_uploaded");

	const dry = await run(["file", file, "--privacy", "private", "--dry-run"]);
	expect(JSON.parse(dry.stdout)).toMatchObject({
		dry_run: true,
		method: "POST",
		path: "/admin/uploads",
		body: { filename: "group-call-12.mp4", size: 10, privacy: "private" },
	});

	failingFile = "group-call-12.mp4";
	const refused = await run(["file", file, "--external-id", "another"]);
	expect(refused.status).toBe(2);
	expect(refused.stdout).toBe("");
	expect(JSON.parse(refused.stderr)).toMatchObject({
		code: "validation_error",
		message:
			"Upload refused: size is larger than this account allows (300000000 bytes).",
	});

	for (const args of [
		["file", root],
		["file", join(root, "nope.mp4")],
		["dir", file],
		["dir", root, "--title", "One title for all"],
	]) {
		const usage = await run(args);
		expect(usage.status).toBe(2);
		expect(JSON.parse(usage.stderr).code).toBe("usage_error");
	}
});

test("import file reads its row from a map and writes results only when asked", async () => {
	const root = folder({ "call-12.mp4": "0123456789", "call-13.mp4": "abc" });
	const map = join(root, "meta.csv");
	writeFileSync(map, "file,title\ncall-12.mp4,Call 12\ncall-13.mp4,Call 13\n");
	const result = await run(["file", join(root, "call-13.mp4"), "--map", map]);
	expect(result.status).toBe(0);
	expect(named("call-13.mp4").body.title).toBe("Call 13");
	expect(videos.size).toBe(1);
	expect(existsSync(join(root, "meta.results.csv"))).toBe(false);
});

test("uploads need an admin key, checked before any file is read or sent", async () => {
	const root = folder({ "call-12.mp4": "0123456789" });
	for (const args of [
		["dir", root],
		["file", join(root, "call-12.mp4")],
	]) {
		const result = await run(args, {
			env: { BOLDVIDEO_API_KEY: "bold_test_tenant_2036" },
		});
		expect(result.status).toBe(3);
		expect(JSON.parse(result.stderr)).toMatchObject({ code: "not_permitted" });
		expect(JSON.parse(result.stderr).hint).toContain("admin key");
	}
	expect(calls.filter((call) => call.path !== "/me")).toEqual([]);
});

test("a terminal shows progress and the result path on stderr, never on stdout", async () => {
	const root = folder({ "a.mp4": "aaaa", "b.mp4": "bbbb" });
	const results = join(root, "out.csv");
	const result = await run(["dir", root, "--results", results, "--json"], {
		tty: true,
		stderr: "pipe",
	});
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout).items).toHaveLength(2);
	// Piped stderr gets no progress at all.
	expect(result.stderr).toBe("");
	const terminal = await run(["dir", root, "--results", results], {
		tty: true,
	});
	expect(terminal.stdout).toContain("2/2 b.mp4: already uploaded");
	expect(terminal.stdout).toContain(`Results: ${results}`);
});
