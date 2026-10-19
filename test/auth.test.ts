import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { json } from "node:stream/consumers";
import me from "./fixtures/me.json";

const temporary = mkdtempSync(join(tmpdir(), "boldvideo-auth-"));
const runner = join(temporary, "runner.mjs");
const tenant = "bold_test_tenant_2028";
const admin = "bold_test_admin_2028";
let home: string;
let override: Response | undefined;
const writes: unknown[] = [];
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const key = request.headers.get("authorization")?.replace(/^Bearer /, "");
		if (url.pathname === "/api/v1/me") {
			if (override) return override.clone();
			if (key !== tenant && key !== admin)
				return Response.json(
					{ message: `Invalid key: ${key}`, request_id: "req_body_2028" },
					{ status: 401 },
				);
			return Response.json(
				key === admin
					? {
							...me,
							account: { slug: "bold", name: "Bold Admin" },
							key: { kind: "admin", short_id: "key_admin" },
						}
					: me,
			);
		}
		if (url.pathname === "/api/v1/admin-test" && request.method === "POST") {
			const result = {
				body: await request.json(),
				query: Object.fromEntries(url.searchParams),
				content_type: request.headers.get("content-type"),
			};
			writes.push(result);
			return Response.json(result);
		}
		return new Response("Not found", { status: 404 });
	},
});
const base = `http://127.0.0.1:${server.port}/api/v1`;
const profileFile = () => join(home, "boldvideo", "profiles.json");
const stored = () => JSON.parse(readFileSync(profileFile(), "utf8"));

beforeAll(async () => {
	const build = await Bun.build({
		entrypoints: [resolve("test/runner.ts")],
		target: "node",
	});
	expect(build.success).toBe(true);
	const artifact = build.outputs[0];
	if (!artifact) throw new Error("Missing runner bundle");
	await Bun.write(runner, artifact);
});
beforeEach(() => {
	home = mkdtempSync(join(temporary, "config-"));
	override = undefined;
	writes.length = 0;
});
afterAll(() => {
	server.stop(true);
	rmSync(temporary, { recursive: true, force: true });
});

function run(
	args: string[],
	options: {
		key?: string;
		tty?: boolean;
		input?: string;
		fixture?: boolean;
		env?: Record<string, string>;
	} = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
	const argv = [
		"node",
		options.fixture ? runner : resolve("dist/boldvideo.js"),
		...args,
	];
	const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;
	const child = spawn(
		options.tty ? "script" : "node",
		options.tty
			? process.platform === "darwin"
				? ["-q", "/dev/null", ...argv]
				: ["-qefc", argv.map(quote).join(" "), "/dev/null"]
			: argv.slice(1),
		{
			env: {
				...process.env,
				NO_COLOR: "1",
				FORCE_COLOR: undefined,
				BOLDVIDEO_API_KEY: options.key ?? "",
				BOLDVIDEO_API_URL: `${base}/`,
				XDG_CONFIG_HOME: home,
				APPDATA: home,
				...options.env,
			},
			stdio: "pipe",
		},
	);
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let sent = false;
		child.stdout.on("data", (data) => {
			stdout += data;
			if (
				options.tty &&
				options.input !== undefined &&
				!sent &&
				stdout.includes("API key (input hidden):")
			) {
				sent = true;
				child.stdin.end(options.input);
			}
		});
		child.stderr.on("data", (data) => {
			stderr += data;
		});
		child.once("error", reject);
		child.once("close", (status) => {
			stdout = stdout.replaceAll("\r\n", "\n");
			if (
				options.tty &&
				process.platform === "darwin" &&
				stdout.startsWith("^D")
			)
				stdout = stdout.slice(stdout.startsWith("^D\b\b") ? 4 : 2);
			resolve({ status, stdout, stderr });
		});
		if (!options.tty || options.input === undefined)
			child.stdin.end(options.input ?? "");
	});
}

test("env authentication works alone and whoami formats JSON and terminal tables", async () => {
	const result = await run(["whoami", "--debug"], { key: tenant });
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toEqual({
		account_slug: "acme",
		account_name: "Acme Academy",
		key_kind: "tenant",
		profile: null,
		api_url: base,
	});
	const terminal = await run(["whoami"], { key: tenant, tty: true });
	expect(terminal.status).toBe(0);
	expect(terminal.stdout).toContain(
		"ACCOUNT_SLUG  ACCOUNT_NAME  KEY_KIND  PROFILE  API_URL\nacme          Acme Academy  tenant",
	);
	expect(terminal.stdout).toContain(base);
	expect(terminal.stdout).not.toContain(tenant);
	expect(
		JSON.parse(
			(await run(["whoami", "--json"], { key: tenant, tty: true })).stdout,
		).account_slug,
	).toBe("acme");
});

test("login verifies and activates profiles; env wins over explicit and active selection", async () => {
	expect((await run(["login", "--token", tenant])).status).toBe(0);
	expect(stored()).toEqual({
		active: "acme",
		profiles: { acme: { key: tenant } },
	});
	expect(
		(
			await run(["login", "--profile", "customer-demo"], {
				input: `${admin}\n`,
			})
		).status,
	).toBe(0);
	expect(stored().active).toBe("customer-demo");
	expect(JSON.parse((await run(["whoami"])).stdout)).toMatchObject({
		account_slug: "bold",
		key_kind: "admin",
		profile: "customer-demo",
	});
	expect(
		JSON.parse((await run(["--profile", "acme", "whoami"])).stdout),
	).toMatchObject({ account_slug: "acme", profile: "acme" });
	expect(stored().active).toBe("customer-demo");
	for (const profile of ["customer-demo", "missing"])
		expect(
			JSON.parse(
				(await run(["whoami", "--profile", profile], { key: tenant })).stdout,
			),
		).toMatchObject({ account_slug: "acme", profile: null });
	expect((await run(["profiles", "use", "acme"])).status).toBe(0);
	expect(JSON.parse((await run(["whoami"])).stdout).profile).toBe("acme");
	expect((await run(["whoami", "--profile", "missing"])).status).toBe(3);
	expect((await run(["profiles", "use", "missing"])).status).toBe(4);
});

test("profile writes are private, replace old modes, and support the home fallback", async () => {
	expect((await run(["login", "--token", tenant])).status).toBe(0);
	expect(statSync(join(home, "boldvideo")).mode & 0o777).toBe(0o700);
	expect(statSync(profileFile()).mode & 0o777).toBe(0o600);
	chmodSync(profileFile(), 0o644);
	chmodSync(join(home, "boldvideo"), 0o755);
	expect((await run(["login", "--token", admin])).status).toBe(0);
	expect(statSync(profileFile()).mode & 0o777).toBe(0o600);
	expect(statSync(join(home, "boldvideo")).mode & 0o777).toBe(0o700);
	expect(
		(
			await run(["login", "--token", tenant], {
				env: { XDG_CONFIG_HOME: "", HOME: home },
			})
		).status,
	).toBe(0);
	expect(existsSync(join(home, ".config", "boldvideo", "profiles.json"))).toBe(
		true,
	);
});

test("missing keys exit 3 with actionable setup instructions; help needs no key", async () => {
	const result = await run(["whoami"]);
	expect(result.status).toBe(3);
	expect(result.stdout).toBe("");
	const failure = JSON.parse(result.stderr);
	expect(failure.code).toBe("not_authenticated");
	for (const text of [
		"BOLDVIDEO_API_KEY",
		"boldvideo login --token",
		"Settings → Developer",
	])
		expect(failure.hint).toContain(text);
	expect((await run(["help"])).status).toBe(0);
	expect((await run(["login"], { input: "\n" })).status).toBe(3);
});

test("admin authorization prevents writes with tenant keys, including stored keys", async () => {
	expect((await run(["login", "--token", tenant])).status).toBe(0);
	for (const key of [tenant, undefined]) {
		const denied = await run(["fixture", "admin-write"], {
			fixture: true,
			key,
		});
		expect(denied.status).toBe(3);
		expect(JSON.parse(denied.stderr)).toMatchObject({
			code: "not_permitted",
			hint: expect.stringContaining("admin key is required"),
		});
	}
	expect(writes).toHaveLength(0);
	expect(
		(
			await run(["fixture", "admin-write", "--dry-run"], {
				fixture: true,
				key: admin,
			})
		).status,
	).toBe(0);
	expect(writes).toHaveLength(0);
	const allowed = await run(["fixture", "admin-write"], {
		fixture: true,
		key: admin,
	});
	expect(allowed.status).toBe(0);
	expect(JSON.parse(allowed.stdout)).toEqual({
		body: { title: "Paid workshops" },
		query: { notify: "false", count: "2" },
		content_type: "application/json",
	});
	expect(writes).toHaveLength(1);
});

test("failed login preserves profiles and errors redact keys and preserve API request IDs", async () => {
	await run(["login", "--token", tenant]);
	const original = readFileSync(profileFile(), "utf8");
	const badKey = 'bold_invalid_"quoted"\\secret';
	const rejected = await run(["login", "--token", badKey, "--debug"]);
	expect(rejected.status).toBe(3);
	expect(JSON.parse(rejected.stderr)).toMatchObject({
		code: "not_authenticated",
		request_id: "req_body_2028",
		message: "Invalid key: [REDACTED]",
	});
	expect(readFileSync(profileFile(), "utf8")).toBe(original);
	override = Response.json(
		{ message: `Forbidden ${tenant}`, request_id: "req_body" },
		{ status: 403, headers: { "x-request-id": "req_header" } },
	);
	const failure = await run(["whoami", "--debug"]);
	expect(failure.status).toBe(3);
	expect(JSON.parse(failure.stderr)).toMatchObject({
		request_id: "req_header",
		message: "Forbidden [REDACTED]",
	});
	for (const response of [
		Response.json({ account: me.account }),
		new Response("not json"),
	]) {
		override = response;
		expect((await run(["login", "--token", admin])).status).toBe(1);
		expect(readFileSync(profileFile(), "utf8")).toBe(original);
	}
	override = new Response("Unavailable", {
		status: 503,
		headers: { "x-request-id": "req_unavailable" },
	});
	expect(JSON.parse((await run(["whoami"])).stderr)).toMatchObject({
		code: "api_error",
		request_id: "req_unavailable",
	});
});

test("profile pagination, dry-run, removal and logout preserve unrelated keys", async () => {
	await run(["login", "--token", tenant]);
	await run(["login", "--token", admin, "--profile", "customer-demo"]);
	const original = readFileSync(profileFile(), "utf8");
	for (const args of [
		["login", "--token", tenant, "--profile", "preview"],
		["profiles", "use", "acme"],
		["profiles", "remove", "customer-demo", "--yes"],
		["logout", "--yes"],
	]) {
		expect((await run([...args, "--dry-run"])).status).toBe(0);
		expect(readFileSync(profileFile(), "utf8")).toBe(original);
	}
	const first = JSON.parse(
		(await run(["profiles", "list", "--limit", "1", "--fields", "name"]))
			.stdout,
	);
	expect(first).toEqual({
		items: [{ name: "acme" }],
		has_more: true,
		next: "boldvideo profiles list --offset 1 --limit 1 --fields 'name'",
	});
	// Execute the returned continuation, including its shell quoting.
	const next = spawn(
		"sh",
		[
			"-c",
			first.next.replace("boldvideo", `node '${resolve("dist/boldvideo.js")}'`),
		],
		{ env: { ...process.env, XDG_CONFIG_HOME: home, BOLDVIDEO_API_KEY: "" } },
	);
	const page = await json(next.stdout);
	expect(page).toEqual({ items: [{ name: "customer-demo" }], has_more: false });
	expect((await run(["profiles", "remove", "acme"])).status).toBe(2);
	expect((await run(["profiles", "remove", "acme", "--yes"])).status).toBe(0);
	expect(stored()).toEqual({
		active: "customer-demo",
		profiles: { "customer-demo": { key: admin } },
	});
	expect((await run(["logout"])).status).toBe(2);
	expect((await run(["logout", "--yes"], { key: tenant })).status).toBe(0);
	expect(stored()).toEqual({ active: null, profiles: {} });
	expect((await run(["whoami"])).status).toBe(3);
});

test("terminal login hides input and cancellation does not save a key", async () => {
	const result = await run(["login"], { tty: true, input: `${tenant}\n` });
	expect(result.status).toBe(0);
	expect(result.stdout).toContain("API key (input hidden):");
	expect(result.stdout).toContain("Active profile: acme.");
	expect(result.stdout + result.stderr).not.toContain(tenant);
	expect(stored().profiles.acme.key).toBe(tenant);
	const cancelled = await run(["login"], { tty: true, input: "\x03" });
	expect(cancelled.status).toBe(2);
	expect(cancelled.stdout).toContain("Login cancelled.");
	expect(stored().active).toBe("acme");
});

test("corrupt storage is not overwritten but does not block env keys or help", async () => {
	await run(["login", "--token", tenant]);
	writeFileSync(profileFile(), "broken JSON");
	expect((await run(["whoami"], { key: admin })).status).toBe(0);
	expect((await run(["--help"])).status).toBe(0);
	expect(JSON.parse((await run(["whoami"])).stderr).code).toBe("profile_error");
	expect((await run(["login", "--token", admin])).status).toBe(1);
	expect(readFileSync(profileFile(), "utf8")).toBe("broken JSON");
});
