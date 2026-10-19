import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../test/run";
import { amp, claude, parseStream } from "./adapters";
import { execute } from "./process";
import { sandbox } from "./sandbox";
import { type Row, summarize } from "./summary";

test("recorded smoke streams preserve actual Claude aggregate and Amp per-message usage", async () => {
	const claudeStream = await Bun.file(
		join(import.meta.dir, "fixtures/claude-recorded.jsonl"),
	).text();
	expect(await claude(async () => claudeStream, "Report the version")).toEqual({
		answer:
			'The installed boldvideo CLI is version **0.1.0**. Running `boldvideo --version` returned `{"version":"0.1.0"}`.',
		calls: 1,
		input_tokens: 8424,
		output_tokens: 152,
	});
	const ampStream = await Bun.file(
		join(import.meta.dir, "fixtures/amp-recorded.jsonl"),
	).text();
	expect(await amp(async () => ampStream, "Report the version")).toEqual({
		answer: "The installed boldvideo version is **0.1.0**.",
		calls: 1,
		input_tokens: 10382,
		output_tokens: 75,
	});
});

test("Claude counts unique tools and uses aggregate usage without double-counting", async () => {
	const stream = await Bun.file(
		join(import.meta.dir, "fixtures/claude.jsonl"),
	).text();
	expect(await claude(async () => stream, "Report the version")).toEqual({
		answer: "Installed version: 0.1.0",
		calls: 2,
		input_tokens: 111,
		output_tokens: 19,
	});
});

test("Amp extracts final text and usage; message usage is a fallback", async () => {
	const stream = await Bun.file(
		join(import.meta.dir, "fixtures/amp.jsonl"),
	).text();
	expect(await amp(async () => stream, "Report the version")).toEqual({
		answer: "boldvideo version 0.1.0",
		calls: 1,
		input_tokens: 67,
		output_tokens: 20,
	});
	const withoutResultUsage = stream.replace(
		/,"usage":\{"input_tokens":60,"cache_read_input_tokens":7,"output_tokens":20\}/,
		"",
	);
	expect(parseStream(withoutResultUsage)).toEqual({
		answer: "boldvideo version 0.1.0",
		calls: 1,
		input_tokens: 67,
		output_tokens: 20,
	});
});

test("failed and truncated streams retain measured work but cannot pass", () => {
	const stream =
		'{"type":"assistant","message":{"id":"m","content":[{"type":"tool_use","id":"t"}],"usage":{"input_tokens":12,"output_tokens":5}}}\n';
	expect(parseStream(stream)).toEqual({
		answer: "",
		calls: 1,
		input_tokens: 12,
		output_tokens: 5,
		error: "Agent stream ended without a result event",
	});
	expect(
		parseStream(
			`${stream}{"type":"result","is_error":true,"result":"limit reached"}\n`,
		).error,
	).toContain("limit reached");
	expect(
		parseStream('{"type":"result","subtype":"success"}\n').input_tokens,
	).toBeNull();
	expect(() => parseStream("not json\n")).toThrow();
});

test("cold shell cannot find curl but can execute the built CLI", async () => {
	const root = await mkdtemp(join(tmpdir(), "boldvideo-path-test-"));
	try {
		const isolated = await sandbox(root, resolve("dist/boldvideo.js"));
		expect(await readdir(isolated.cwd)).toEqual([]);
		expect(await readdir(isolated.env.HOME as string)).toEqual([]);
		expect(isolated.env.EVAL_RESET_CMD).toBeUndefined();
		const stdout = await execute(
			["/bin/sh", join(import.meta.dir, "fixtures/path-agent.sh")],
			isolated.cwd,
			isolated.env,
			AbortSignal.timeout(5000),
			join(root, "transcript"),
		);
		expect(JSON.parse(stdout)).toEqual({ version: "0.1.0" });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("process timeout preserves transcript and bounds child shells", async () => {
	const root = await mkdtemp(join(tmpdir(), "boldvideo-timeout-test-"));
	try {
		await expect(
			execute(
				["/bin/sh", "-c", "echo started; sleep 30"],
				root,
				process.env,
				AbortSignal.timeout(100),
				join(root, "transcript"),
			),
		).rejects.toThrow();
		expect(await Bun.file(join(root, "transcript")).text()).toBe("started\n");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("summary uses median of per-task ratios, includes failures and escapes reasons", () => {
	const row: Row = {
		task: "import",
		version: 2,
		repeat: 1,
		pass: true,
		calls: 2,
		min_calls: 1,
		input_tokens: 90,
		output_tokens: 10,
		duration_ms: 70,
		transcript_path: "run/001.jsonl",
	};
	const summary = summarize([
		row,
		{
			...row,
			task: "read",
			pass: false,
			calls: 9,
			min_calls: 9,
			input_tokens: 900,
			output_tokens: 100,
			reason: "Not found | retry\nnext",
		},
	]);
	expect(summary.pass_rate).toBe(0.5);
	expect(summary.median_calls_ratio).toBe(1.5);
	expect(summary.markdown).toContain(
		"Median calls: 5.5; median min_calls: 5; median calls/min_calls: 1.50",
	);
	expect(summary.markdown).toContain(
		"Median tokens (input + output, including cached input): 550",
	);
	expect(summary.markdown).toContain(
		"- read (repeat 1): Not found \\| retry next",
	);
	expect(summary.markdown).toContain(
		"| import | 2 | 1 | yes | 2 / 1 | 90 | 10 | 70 | run/001.jsonl |",
	);
	expect(
		summarize([
			{
				...row,
				pass: false,
				calls: null,
				input_tokens: null,
				output_tokens: null,
			},
		]).median_calls_ratio,
	).toBeNull();
});

test("runner resets every repeat, checks answers, saves metrics and gates targets without a real agent", async () => {
	const root = await mkdtemp(join(tmpdir(), "boldvideo-run-test-"));
	try {
		await cp(import.meta.dir, join(root, "evals"), {
			recursive: true,
			filter: (path) => !path.includes("/results"),
		});
		await cp(resolve("dist"), join(root, "dist"), { recursive: true });
		const bin = join(root, "fake-bin");
		await mkdir(bin);
		const stream = await Bun.file(
			join(import.meta.dir, "fixtures/claude.jsonl"),
		).text();
		await Bun.write(
			join(bin, "claude"),
			`#!/usr/bin/env node
const {execFileSync, spawnSync} = require('node:child_process');
const {readdirSync} = require('node:fs');
if (readdirSync('.').length || process.env.EVAL_STARTING_STATE) process.exit(2);
if (!spawnSync('curl', ['--version']).error) process.exit(3);
if (JSON.parse(execFileSync('boldvideo', ['--version'], {encoding:'utf8'})).version !== '0.1.0') process.exit(4);
process.stdout.write(${JSON.stringify(stream)});
`,
		);
		await Bun.$`chmod +x ${join(bin, "claude")}`.quiet();
		const env = {
			PATH: `${bin}:${process.env.PATH}`,
			EVAL_RESET_CMD: `printf '%s\\n' "$EVAL_STARTING_STATE" >> '${join(root, "resets")}'`,
		};
		const command = [
			process.execPath,
			join(root, "evals/run.ts"),
			"--agent",
			"claude",
			"--repeat",
			"2",
			"--concurrency",
			"2",
		];
		const first = await run(command, { env });
		expect(first.status).toBe(0);
		expect(first.stdout).toContain("Pass rate: 100.0% (2/2)");
		expect(
			(await Bun.file(join(root, "resets")).text()).trim().split("\n"),
		).toEqual(['"empty"', '"empty"']);
		const files = (await readdir(join(root, "evals/results"))).filter((path) =>
			path.endsWith(".json"),
		);
		const result = await Bun.file(
			join(root, "evals/results", files[0] as string),
		).json();
		expect(
			result.results.map((row: Row) => [
				row.pass,
				row.calls,
				row.input_tokens,
				row.output_tokens,
			]),
		).toEqual([
			[true, 2, 111, 19],
			[true, 2, 111, 19],
		]);
		for (const row of result.results)
			expect(await Bun.file(row.transcript_path).text()).toBe(stream);
		await Bun.write(
			join(root, "evals/targets.json"),
			JSON.stringify({ pass_rate: 1, median_calls_ratio: 1 }),
		);
		const missed = await run(command, { env });
		expect(missed.status).toBe(1);
		expect(missed.stdout).toContain("Targets: MISSED");
		const resetFailed = await run(command, {
			env: { ...env, EVAL_RESET_CMD: "echo reset-broken >&2; exit 9" },
		});
		expect(resetFailed.status).toBe(1);
		expect(resetFailed.stdout).toContain("Pass rate: 0.0% (0/2)");
		expect(resetFailed.stdout).toContain("Process exited 9: reset-broken");
		const answer = join(root, "answer.txt");
		await Bun.write(answer, "wrong version");
		const failedCheck = await run(
			[
				process.execPath,
				join(root, "evals/run.ts"),
				"--agent",
				"manual",
				"--answer",
				answer,
			],
			{ env: { EVAL_RESET_CMD: "echo skip" } },
		);
		expect(failedCheck.status).toBe(1);
		expect(failedCheck.stdout).toContain("Answer missing expected text: 0.1.0");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("API checker scores the requested sandbox field and rejects a mismatch", async () => {
	const root = await mkdtemp(join(tmpdir(), "boldvideo-check-test-"));
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			if (
				request.headers.get("authorization") !== "Bearer fixture-key" ||
				new URL(request.url).pathname !== "/api/v1/admin/videos/workshop"
			)
				return new Response(null, { status: 401 });
			return Response.json({ data: { privacy_level: "private" } });
		},
	});
	try {
		const path = join(root, "task.md");
		const task = {
			id: "api-test",
			version: 1,
			prompt: "Make the workshop private",
			starting_state: "workshop",
			min_calls: 2,
			trap: null,
			chain: [],
			check: {
				kind: "api",
				path: "/admin/videos/workshop",
				field: "data.privacy_level",
				equals: "private",
			},
		};
		await Bun.write(path, `---\n${JSON.stringify(task)}\n---\n`);
		const command = [process.execPath, join(import.meta.dir, "check.ts"), path];
		const env = {
			BOLDVIDEO_API_KEY: "fixture-key",
			BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}/api/v1`,
		};
		expect((await run(command, { env })).status).toBe(0);
		task.check.equals = "public";
		await Bun.write(path, `---\n${JSON.stringify(task)}\n---\n`);
		const mismatch = await run(command, { env });
		expect(mismatch.status).toBe(1);
		expect(mismatch.stderr).toContain("does not equal expected value");
	} finally {
		server.stop(true);
		await rm(root, { recursive: true, force: true });
	}
});
