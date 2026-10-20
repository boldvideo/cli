import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadTask } from "../evals/check";
import { commands } from "../src/commands";
import type { Command } from "../src/spec";
import { run } from "./run";

const directory = resolve(import.meta.dir, "../evals/tasks");
const checker = resolve(import.meta.dir, "../evals/check.ts");
const files = readdirSync(directory)
	.filter((name) => /^\d{2}-.*\.md$/.test(name))
	.sort();

test("all twenty tasks validate, cover traps/chains and avoid command hints", async () => {
	expect(files).toHaveLength(20);
	const leaves = (items: Command[]): string[] =>
		items.flatMap((command) =>
			command.subcommands ? leaves(command.subcommands) : [command.name],
		);
	const forbidden = new Set([
		...leaves(commands),
		"ask",
		"search",
		"update",
		"publish",
		"unpublish",
		"delete",
		"create",
		"add",
		"remove",
		"sync",
		"progress",
		"memory",
		"questions",
	]);
	const ids = new Set<string>();
	let traps = 0;
	let chains = 0;
	for (const file of files) {
		const task = await loadTask(join(directory, file));
		expect(`${task.id}.md`).toBe(file);
		expect(ids.has(task.id)).toBe(false);
		ids.add(task.id);
		expect(task.version).toBeGreaterThanOrEqual(1);
		expect(task.min_calls).toBeGreaterThanOrEqual(1);
		expect(task.prompt).not.toMatch(/\bboldvideo\b|--[\w-]+/i);
		// Service names in URLs are not subcommand hints.
		const words =
			task.prompt
				.replace(/https?:\/\/\S+/g, "")
				.replaceAll("the Bold Video CLI", "")
				.toLowerCase()
				.match(/[a-z][a-z-]*/g) ?? [];
		for (const word of words)
			expect(forbidden.has(word), `${task.id}: ${word}`).toBe(false);
		traps += Number(task.trap);
		chains += Number(task.chain);
	}
	expect(traps).toBeGreaterThanOrEqual(4);
	expect(chains).toBeGreaterThanOrEqual(3);
});

test("API checks use sandbox envelopes and reject wrong results, HTTP failures and leaked keys", async () => {
	let body: unknown = {
		data: {
			external_id: "eval-coaching-intro",
			title: "Coaching introduction",
			ready: true,
			collections: [{ name: "Coaching" }],
		},
	};
	let status = 200;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (
				request.method !== "GET" ||
				!url.pathname.startsWith("/api/v1/") ||
				request.headers.get("x-bold-admin-api-key") !== "fixture-admin-key"
			)
				return new Response(null, { status: 403 });
			return Response.json(body, { status });
		},
	});
	const invoke = (task: string) =>
		run([process.execPath, checker, task], {
			env: {
				BOLDVIDEO_API_URL: `${server.url}api/v1`,
				BOLDVIDEO_API_KEY: "fixture-admin-key",
				BOLDVIDEO_TENANT_KEY: "fixture-tenant-key",
			},
		});
	try {
		let result = await invoke("03-recording-in-collection");
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).evidence.api.result).toBe(true);
		body = {
			data: {
				external_id: "eval-coaching-intro",
				title: "Coaching introduction",
				ready: false,
				collections: [{ name: "Coaching" }],
			},
		};
		result = await invoke("03-recording-in-collection");
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout).result).toBe("fail");
		body = {
			data: {
				title: "Pricing foundations",
				collections: [{ name: "Workshops" }, { name: "Coaching" }],
			},
		};
		expect((await invoke("08-cross-file-recording")).status).toBe(0);
		body = {
			data: {
				title: "Pricing foundations",
				collections: [{ name: "Coaching" }],
			},
		};
		expect((await invoke("08-cross-file-recording")).status).toBe(1);
		body = {
			data: [
				{ name: "Workshops", video_count: 6 },
				{ name: "Autumn onboarding", video_count: 0 },
				{ name: "Coaching", video_count: 6 },
			],
		};
		expect((await invoke("07-new-collection")).status).toBe(0);
		body = {
			data: [
				{ name: "Workshops", video_count: 6 },
				{ name: "Autumn onboarding", video_count: 1 },
				{ name: "Coaching", video_count: 6 },
			],
		};
		expect((await invoke("07-new-collection")).status).toBe(1);
		status = 403;
		body = { error: "fixture-admin-key", nested: "fixture-tenant-key" };
		result = await invoke("08-cross-file-recording");
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout).evidence.api.status).toBe(403);
		expect(result.stdout).not.toContain("fixture-admin-key");
		expect(result.stdout).not.toContain("fixture-tenant-key");
	} finally {
		await server.stop(true);
	}
});

test("answer checks accept correct citations and reject wrong timestamps and missing files", async () => {
	const temp = mkdtempSync(join(tmpdir(), "boldvideo-eval-"));
	const answer = join(temp, "answer.txt");
	try {
		await Bun.write(
			answer,
			"Price by the outcome, not by hours. Pricing foundations (00:42).",
		);
		let result = await run([
			process.execPath,
			checker,
			"10-cited-library-answer",
			"--answer",
			answer,
		]);
		expect(result.status).toBe(0);
		expect(
			JSON.parse(result.stdout).evidence.answer.contains.every(
				(item: { pass: boolean }) => item.pass,
			),
		).toBe(true);
		await Bun.write(
			answer,
			"Price by the outcome. Pricing foundations (00:43).",
		);
		result = await run([
			process.execPath,
			checker,
			"10-cited-library-answer",
			"--answer",
			answer,
		]);
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout).result).toBe("fail");
		result = await run([process.execPath, checker, "10-cited-library-answer"]);
		expect(result.status).toBe(2);
		expect(JSON.parse(result.stdout).error).toContain("--answer");
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("chain checks require both persisted readiness/membership and a final cited answer", async () => {
	const temp = mkdtempSync(join(tmpdir(), "boldvideo-eval-chain-"));
	const answer = join(temp, "answer.txt");
	let ready = true;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch() {
			return Response.json({
				data: {
					external_id: "eval-pricing-chain",
					title: "Pricing lab",
					ready,
					collections: [{ name: "Workshops" }],
				},
			});
		},
	});
	const invoke = () =>
		run([process.execPath, checker, "18-pricing-chain", "--answer", answer], {
			env: {
				BOLDVIDEO_API_URL: `${server.url}api/v1`,
				BOLDVIDEO_API_KEY: "fixture-admin-key",
			},
		});
	try {
		await Bun.write(
			answer,
			"Filed Pricing lab in Workshops. The pilot price is 250 euros (Pricing lab, 01:15).",
		);
		expect((await invoke()).status).toBe(0);
		ready = false;
		expect((await invoke()).status).toBe(1);
		ready = true;
		await Bun.write(answer, "Filed Pricing lab in Workshops.");
		expect((await invoke()).status).toBe(1);
	} finally {
		await server.stop(true);
		rmSync(temp, { recursive: true, force: true });
	}
});
