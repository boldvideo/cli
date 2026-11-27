import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
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
import me from "./fixtures/me.json";
import { run as execute } from "./run";

const temporary = mkdtempSync(join(tmpdir(), "boldvideo-auth-"));
const runner = join(temporary, "runner.mjs");
const tenant = "bold_test_tenant_2028";
const admin = "bold_test_admin_2028";
let home: string;
let override: Response | undefined;
const writes: unknown[] = [];
// Browser sign-in: what the mock answers to each poll, and what it saw.
const workspaces = [
	{ slug: "hrtu", name: "HRT University", key: "bold_admin_cli_hrtu_2039" },
	{
		slug: "viva",
		name: "VIVA Financial Tuition",
		key: "bold_admin_cli_viva_2039",
	},
];
const deviceCode = "device_secret_2039";
let polls: { status: number; body: unknown }[] = [];
let expiresIn = 600;
const started: unknown[] = [];
const ended: (string | undefined)[] = [];
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const key = request.headers.get("authorization")?.replace(/^Bearer /, "");
		if (url.pathname === "/api/v1/cli/logins" && request.method === "POST") {
			started.push(await request.json());
			return Response.json(
				{
					device_code: deviceCode,
					user_code: "KTRM-4XQ9",
					verification_url: `${url.origin}/cli/KTRM-4XQ9`,
					expires_in: expiresIn,
					interval: 0.05,
				},
				{ status: 201 },
			);
		}
		if (url.pathname === "/api/v1/cli/logins/token") {
			const next = polls.length > 1 ? polls.shift() : polls[0];
			return Response.json(next?.body ?? {}, { status: next?.status ?? 500 });
		}
		if (url.pathname === "/api/v1/cli/session" && request.method === "DELETE") {
			ended.push(key);
			const personal = workspaces.some((workspace) => workspace.key === key);
			return new Response(null, { status: personal ? 204 : 403 });
		}
		const signedIn = workspaces.find((workspace) => workspace.key === key);
		if (url.pathname === "/api/v1/me" && signedIn)
			return Response.json({
				data: {
					...me.data,
					account: { slug: signedIn.slug, name: signedIn.name },
					key: { kind: "admin", short_id: "key_cli" },
					user: { email: "dana@example.com" },
				},
			});
		if (url.pathname === "/api/v1/me") {
			if (override) return override.clone();
			if (key !== tenant && key !== admin)
				return Response.json(
					{
						error: { code: "unauthorized", message: `Invalid key: ${key}` },
						request_id: "req_body_2028",
					},
					{ status: 401 },
				);
			return Response.json(
				key === admin
					? {
							data: {
								...me.data,
								account: { slug: "bold", name: "Bold Admin" },
								key: { kind: "admin", short_id: "key_admin" },
							},
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
	polls = [];
	expiresIn = 600;
	started.length = 0;
	ended.length = 0;
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
		waitFor?: string;
		stderr?: "tty" | "pipe";
	} = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
	const argv = [
		"node",
		options.fixture ? runner : resolve("dist/boldvideo.js"),
		...args,
	];
	return execute(argv, {
		tty: options.tty,
		input: options.input,
		waitFor: options.waitFor,
		stderr: options.stderr,
		env: {
			// A test must never open a real browser tab.
			BOLDVIDEO_NO_BROWSER: "1",
			BOLDVIDEO_API_KEY: options.key ?? "",
			BOLDVIDEO_API_URL: `${base}/`,
			XDG_CONFIG_HOME: home,
			APPDATA: home,
			...options.env,
		},
	});
}

test("env authentication works alone and whoami formats JSON and terminal tables", async () => {
	const result = await run(["whoami", "--debug"], { key: tenant });
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toEqual({
		account_slug: "acme",
		account_name: "Acme",
		key_kind: "tenant",
		profile: null,
		api_url: base,
	});
	const terminal = await run(["whoami"], { key: tenant, tty: true });
	expect(terminal).toMatchObject({ status: 0 });
	expect(terminal.stdout).toContain(
		"ACCOUNT_SLUG  ACCOUNT_NAME  KEY_KIND  PROFILE  API_URL\nacme          Acme          tenant",
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
			await run(["login", "--token", "-", "--profile", "customer-demo"], {
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
	for (const text of ["boldvideo login", "BOLDVIDEO_API_KEY"])
		expect(failure.hint).toContain(text);
	expect((await run(["help"])).status).toBe(0);
	expect((await run(["login", "--token", "-"], { input: "\n" })).status).toBe(
		3,
	);
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
			hint: expect.stringContaining("Run boldvideo login to sign in"),
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
		Response.json({ data: { account: me.data.account } }),
		Response.json(me.data),
		Response.json(null),
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

test("flat and nested 401 errors keep the auth hint and prevent admin writes", async () => {
	for (const body of [
		{
			type: "error",
			code: "unauthorized",
			message: "Unauthorized",
			retryable: false,
		},
		{ error: { code: "unauthorized", message: "Unauthorized" } },
	]) {
		override = Response.json(body, {
			status: 401,
			headers: { "x-request-id": "req_auth" },
		});
		for (const args of [["whoami"], ["fixture", "admin-write"]]) {
			const result = await run(args, { key: admin, fixture: true });
			expect(result.status).toBe(3);
			expect(result.stdout).toBe("");
			expect(JSON.parse(result.stderr)).toEqual({
				code: "not_authenticated",
				message: "Unauthorized",
				hint: "Run boldvideo login to sign in, or set BOLDVIDEO_API_KEY.\nRead: boldvideo docs cli",
				docs: "https://docs.boldvideo.com/cli#not-authenticated",
				request_id: "req_auth",
			});
		}
	}
	expect(writes).toHaveLength(0);
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
	const next = await execute(
		[
			"sh",
			"-c",
			first.next.replace("boldvideo", `node '${resolve("dist/boldvideo.js")}'`),
		],
		{ env: { XDG_CONFIG_HOME: home } },
	);
	expect(next.status).toBe(0);
	const page = JSON.parse(next.stdout);
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

const approved = (list = workspaces) => ({
	status: 200,
	body: {
		status: "approved",
		user: { email: "dana@example.com" },
		workspaces: list,
	},
});
const pending = { status: 200, body: { status: "pending" } };

test("terminal login signs in through the browser and never prints a key", async () => {
	polls = [pending, pending, approved(workspaces.slice(0, 1))];
	const result = await run(["login"], { tty: true });
	expect(result).toMatchObject({ status: 0 });
	expect(result.stdout).toContain("████████▄▄▄");
	expect(result.stdout).toContain("Sign in to Bold");
	expect(result.stdout).toContain("KTRM-4XQ9");
	expect(result.stdout).toContain("/cli/KTRM-4XQ9");
	expect(result.stdout).toContain("Open the link in a browser.");
	expect(result.stdout).toContain("Signed in as dana@example.com");
	expect(result.stdout).toContain("HRT University · hrtu");
	expect(result.stdout).toContain("boldvideo videos list");
	expect(result.stdout).not.toContain(workspaces[0]?.key as string);
	expect(result.stdout).not.toContain(deviceCode);
	expect(started).toHaveLength(1);
	expect(stored()).toEqual({
		active: "hrtu",
		profiles: {
			hrtu: {
				key: workspaces[0]?.key,
				name: "HRT University",
				user: "dana@example.com",
			},
		},
	});
	expect(JSON.parse((await run(["whoami"])).stdout)).toMatchObject({
		account_slug: "hrtu",
		key_kind: "admin",
		profile: "hrtu",
		user: "dana@example.com",
	});
});

test("several workspaces become profiles, and -t runs one call in another", async () => {
	polls = [approved()];
	const result = await run(["login"], { tty: true });
	expect(result).toMatchObject({ status: 0 });
	expect(result.stdout).toContain("Workspaces");
	expect(result.stdout).toMatch(/● hrtu\s+HRT University\s+active/);
	expect(result.stdout).toMatch(/viva\s+VIVA Financial Tuition/);
	expect(result.stdout).toContain("boldvideo profiles use viva");
	expect(result.stdout).toContain("boldvideo videos list -t viva");
	expect(stored().active).toBe("hrtu");
	expect(Object.keys(stored().profiles)).toEqual(["hrtu", "viva"]);
	for (const flag of ["-t", "--tenant", "--profile"])
		expect(
			JSON.parse((await run(["whoami", flag, "viva"])).stdout).account_slug,
		).toBe("viva");
	expect(JSON.parse((await run(["whoami"])).stdout).account_slug).toBe("hrtu");
	const named = await run(["whoami", "-t", "viva"], { tty: true });
	expect(named.stdout).toContain("viva · VIVA Financial Tuition");
});

test("signing in again keeps the active workspace and existing profiles", async () => {
	await run(["login", "--token", tenant]);
	polls = [approved()];
	expect((await run(["login"], { tty: true })).status).toBe(0);
	expect(stored().active).toBe("hrtu");
	expect(Object.keys(stored().profiles).sort()).toEqual([
		"acme",
		"hrtu",
		"viva",
	]);
	await run(["profiles", "use", "viva"]);
	polls = [approved()];
	expect((await run(["login"], { tty: true })).status).toBe(0);
	expect(stored().active).toBe("viva");
});

test("login prints JSON on stdout and the link on stderr when asked for JSON", async () => {
	polls = [approved(workspaces.slice(0, 1))];
	const result = await run(["login", "--json"], { tty: true, stderr: "pipe" });
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout.trim())).toEqual({
		profile: "hrtu",
		account: { slug: "hrtu", name: "HRT University" },
		key_kind: "admin",
		user: { email: "dana@example.com" },
		workspaces: [{ profile: "hrtu", slug: "hrtu", name: "HRT University" }],
		dry_run: false,
	});
	expect(result.stderr).toContain(
		"Open http://127.0.0.1:" +
			server.port +
			"/cli/KTRM-4XQ9 and approve code KTRM-4XQ9.",
	);
});

test("without a terminal, login still starts the browser sign-in and hands over the link", async () => {
	polls = [pending, approved(workspaces.slice(0, 1))];
	const result = await run(["login"]);
	expect(result.status).toBe(0);
	expect(result.stderr).toBe(
		`Open http://127.0.0.1:${server.port}/cli/KTRM-4XQ9 and approve code KTRM-4XQ9.\n`,
	);
	expect(JSON.parse(result.stdout).profile).toBe("hrtu");
	expect(result.stdout + result.stderr).not.toContain(
		workspaces[0]?.key as string,
	);
	expect(stored().active).toBe("hrtu");
});

test("a refused, expired or cancelled sign-in saves nothing", async () => {
	polls = [pending, { status: 410, body: { code: "denied" } }];
	const refused = await run(["login"], { tty: true });
	expect(refused.status).toBe(3);
	expect(refused.stdout).toContain("cancelled in the browser");
	polls = [{ status: 410, body: { code: "expired" } }];
	expect((await run(["login"], { tty: true })).status).toBe(5);
	polls = [pending];
	expiresIn = 0.2;
	expect((await run(["login"], { tty: true })).status).toBe(5);
	expiresIn = 600;
	const cancelled = await run(["login"], {
		tty: true,
		input: "\x03",
		waitFor: "Waiting for approval",
	});
	expect(cancelled.status).toBe(2);
	expect(cancelled.stdout).toContain("Login cancelled.");
	expect(existsSync(profileFile())).toBe(false);
	expect((await run(["login", "--dry-run"], { tty: true })).status).toBe(2);
});

test("logout ends a browser sign-in on the server and leaves other keys alone", async () => {
	polls = [approved()];
	await run(["login"], { tty: true });
	expect((await run(["logout", "--yes"])).status).toBe(0);
	expect(ended).toEqual([workspaces[0]?.key]);
	expect(stored().active).toBeNull();
	expect(Object.keys(stored().profiles)).toEqual(["viva"]);
	expect((await run(["profiles", "remove", "viva", "--yes"])).status).toBe(0);
	expect(ended).toEqual([workspaces[0]?.key, workspaces[1]?.key]);
	await run(["login", "--token", tenant]);
	expect((await run(["logout", "--yes"])).status).toBe(0);
	expect(ended.at(-1)).toBe(tenant);
	expect(stored()).toEqual({ active: null, profiles: {} });
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
