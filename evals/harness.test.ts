import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
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
	expect(
		await claude(async () => claudeStream, "Report the version"),
	).toMatchObject({
		answer:
			'The installed boldvideo CLI is version **0.1.0**. Running `boldvideo --version` returned `{"version":"0.1.0"}`.',
		calls: 1,
		input_tokens: 8424,
		output_tokens: 152,
	});
	const ampStream = await Bun.file(
		join(import.meta.dir, "fixtures/amp-recorded.jsonl"),
	).text();
	expect(await amp(async () => ampStream, "Report the version")).toMatchObject({
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
	expect(await claude(async () => stream, "Report the version")).toMatchObject({
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
	expect(await amp(async () => stream, "Report the version")).toMatchObject({
		answer: "boldvideo version 0.1.0",
		calls: 1,
		input_tokens: 67,
		output_tokens: 20,
	});
	const withoutResultUsage = stream.replace(
		/,"usage":\{"input_tokens":60,"cache_read_input_tokens":7,"output_tokens":20\}/,
		"",
	);
	expect(parseStream(withoutResultUsage)).toMatchObject({
		answer: "boldvideo version 0.1.0",
		calls: 1,
		input_tokens: 67,
		output_tokens: 20,
	});
});

test("failed and truncated streams retain measured work but cannot pass", () => {
	const stream =
		'{"type":"assistant","message":{"id":"m","content":[{"type":"tool_use","id":"t"}],"usage":{"input_tokens":12,"output_tokens":5}}}\n';
	expect(parseStream(stream)).toMatchObject({
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

test("streams distinguish CLI calls from other tools, deduplicate searches and discover models", () => {
	const events = [
		{ type: "system", model: "initial-model" },
		{
			type: "assistant",
			message: {
				model: "actual-model",
				content: [
					{
						type: "tool_use",
						id: "cli",
						name: "Bash",
						input: { command: "boldvideo videos list" },
					},
					{
						type: "tool_use",
						id: "not-cli",
						name: "Bash",
						input: { command: "echo boldvideo" },
					},
					{
						type: "tool_use",
						id: "prefix",
						name: "Bash",
						input: { command: "boldvideo-other --version" },
					},
					{
						type: "tool_use",
						id: "amp-cli",
						name: "shell_command",
						input: { command: "boldvideo --help" },
					},
					{ type: "tool_use", id: "amp-search", name: "web_search", input: {} },
					{
						type: "server_tool_use",
						id: "claude-search",
						name: "web_search",
						input: {},
					},
					{
						type: "server_tool_use",
						id: "claude-search",
						name: "web_search",
						input: {},
					},
				],
			},
		},
		{
			type: "result",
			subtype: "success",
			usage: {
				input_tokens: 40,
				output_tokens: 7,
				server_tool_use: { web_search_requests: 2 },
			},
		},
	];
	expect(
		parseStream(events.map((event) => JSON.stringify(event)).join("\n")),
	).toMatchObject({
		calls: 6,
		cli_calls: 2,
		searches: 2,
		model: "actual-model",
	});
	expect(
		parseStream(
			JSON.stringify({
				type: "result",
				modelUsage: { "result-model": {} },
				usage: { input_tokens: 1, output_tokens: 2 },
			}),
		).model,
	).toBe("result-model");
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
		mode: "cold",
		model: "test-model",
		valid: true,
		cli_calls: 1,
		searches: 0,
		cost_usd: 0.005,
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
		"| import | 2 | cold | test-model | 1 | yes | yes | 2 / 1 | 1 | 0 | 90 | 10 | 0.005000 | 70 | run/001.jsonl |",
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
	const previous = [
		row,
		{ ...row, calls: 4, repeat: 2 },
		{ ...row, calls: 6, repeat: 3 },
	];
	const current: Row[] = [
		{ ...row, calls: 4, input_tokens: 100 },
		{ ...row, calls: 6, input_tokens: 100, repeat: 2 },
		{ ...row, calls: 8, input_tokens: 100, repeat: 3, pass: false },
		{ ...row, mode: "skill", calls: 100, pass: false },
		{ ...row, model: "different-model", calls: 100, pass: false },
		{ ...row, version: 3, calls: 100, pass: false },
	];
	const comparison = summarize(current, previous);
	expect(comparison.per_task[0]).toMatchObject({
		pass_rate: 2 / 3,
		median_calls: 6,
		attempts: 3,
		mode: "cold",
	});
	expect(comparison.regressions).toEqual([
		"import (cold, test-model): pass rate 100.0% → 66.7%; median calls 4 → 6; median tokens 100 → 110",
	]);
	expect(comparison.markdown).toContain("| skill | 0.0% | 100 | 1 |");
	expect(comparison.total_cost_usd).toBeCloseTo(0.03);
	expect(comparison.markdown).toContain(
		"Total estimated cost (placeholder prices): $0.030000 USD",
	);
});

test("runner resets every repeat, checks answers, saves metrics and gates targets without a real agent", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "boldvideo-run-test-"));
	const root = join(temporary, "configured");
	await mkdir(join(temporary, "actual"));
	await symlink(join(temporary, "actual"), root, "dir");
	const me = await Bun.file(resolve("test/fixtures/me.json")).json();
	let accountSlug = "acme";
	let identities = 0;
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			if (
				request.headers.get("authorization") !== "Bearer fixture-key" ||
				new URL(request.url).pathname !== "/me"
			)
				return new Response(null, { status: 401 });
			identities++;
			return Response.json({
				data: {
					...me.data,
					account: { ...me.data.account, slug: accountSlug },
				},
			});
		},
	});
	try {
		await cp(import.meta.dir, join(root, "evals"), {
			recursive: true,
			filter: (path) => !path.includes("/results"),
		});
		await cp(resolve("dist"), join(root, "dist"), { recursive: true });
		await cp(resolve("skill"), join(root, "skill"), { recursive: true });
		await Bun.write(
			join(root, "evals/prices.json"),
			JSON.stringify({
				default: { input_per_million: 1, output_per_million: 5 },
				"test-model": { input_per_million: 2, output_per_million: 11 },
			}),
		);
		const bin = join(root, "fake-bin");
		await mkdir(bin);
		const stream = await Bun.file(
			join(import.meta.dir, "fixtures/claude.jsonl"),
		).text();
		await Bun.write(
			join(bin, "claude"),
			String.raw`#!/usr/bin/env node
const {execFileSync, spawnSync} = require('node:child_process');
const {readdirSync, existsSync, readFileSync} = require('node:fs');
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1];
const skill = existsSync('skill/SKILL.md');
if ((readdirSync('.').length && !skill) || process.env.EVAL_STARTING_STATE) process.exit(2);
if (skill && !prompt.includes(readFileSync('skill/SKILL.md', 'utf8'))) process.exit(5);
const searchAllowed = args.includes('Bash,WebSearch');
if (searchAllowed && !prompt.includes('You may use web search at most once.')) process.exit(6);
if (!spawnSync('curl', ['--version']).error) process.exit(3);
if (JSON.parse(execFileSync('boldvideo', ['--version'], {encoding:'utf8'})).version !== '0.1.0') process.exit(4);
const events = ${JSON.stringify(stream)}.trim().split('\n');
const searches = prompt.includes('Use two searches') ? 2 : searchAllowed ? 1 : 0;
const blocks = Array.from({length: searches}, (_, id) => ({type:'tool_use', id:'search-' + id, name:'WebSearch', input:{query:'boldvideo'}}));
events.splice(events.length - 1, 0, JSON.stringify({type:'assistant', message:{content:blocks}}));
process.stdout.write(searches ? events.join('\n') + '\n' : ${JSON.stringify(stream)});
`,
		);
		await Bun.$`chmod +x ${join(bin, "claude")}`.quiet();
		const env = {
			PATH: `${bin}:${process.env.PATH}`,
			BOLDVIDEO_API_KEY: "fixture-key",
			BOLDVIDEO_API_URL: `http://127.0.0.1:${server.port}`,
			EVAL_SANDBOX_SLUG: "acme",
			EVAL_RESET_CMD: `printf '%s\\n' "$EVAL_STARTING_STATE" >> '${join(root, "resets")}'`,
		};
		const command = [
			process.execPath,
			join(root, "evals/run.ts"),
			"--agent",
			"claude",
			"--model",
			"test-model",
			"--repeat",
			"2",
			"--concurrency",
			"2",
		];
		const first = await run(command, { env });
		expect(first.status).toBe(0);
		expect(identities).toBe(2);
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
		expect(result.results[0]).toMatchObject({
			model: "test-model",
			mode: "cold",
			cli_calls: 2,
			searches: 0,
			cost_usd: 0.000431,
			valid: true,
		});
		await Bun.write(
			join(root, "evals/targets.json"),
			JSON.stringify({ pass_rate: 1, median_calls_ratio: 1 }),
		);
		const missed = await run(command, { env });
		expect(missed.status).toBe(1);
		expect(missed.stdout).toContain("Targets: MISSED");
		const previousFile = missed.stdout.match(
			/Previous results: (.+)\. Targets:/,
		)?.[1];
		if (!previousFile) throw new Error("Summary omitted previous results");
		expect(realpathSync(previousFile)).toBe(
			realpathSync(join(root, "evals/results", files[0] as string)),
		);
		await Bun.write(
			join(root, "evals/targets.json"),
			JSON.stringify({ pass_rate: 0, median_calls_ratio: 999 }),
		);
		const defaults = command.slice(0, 6);
		const defaultRun = await run(defaults, { env });
		expect(defaultRun.status).toBe(0);
		expect(defaultRun.stdout).toContain("Pass rate: 100.0% (3/3)");
		expect(defaultRun.stdout).toContain(
			"Total estimated cost (placeholder prices): $0.001293 USD",
		);
		const skillRun = await run(
			[...defaults, "--mode", "skill", "--repeat", "1"],
			{ env },
		);
		expect(skillRun.status).toBe(0);
		expect(skillRun.stdout).toContain("| skill | 100.0% | 2 | 1 |");
		const searchRun = await run(
			[...defaults, "--mode", "one-search", "--repeat", "1"],
			{ env },
		);
		expect(searchRun.status).toBe(0);
		expect(searchRun.stdout).toContain("| one-search | 100.0% | 3 | 1 |");
		const examplePath = join(root, "evals/tasks/00-example.md");
		const example = await Bun.file(examplePath).text();
		await Bun.write(
			examplePath,
			example.replace(
				"Report the installed",
				"Use two searches. Report the installed",
			),
		);
		const excessive = await run(
			[...defaults, "--mode", "one-search", "--repeat", "1"],
			{ env },
		);
		expect(excessive.status).toBe(1);
		expect(excessive.stdout).toContain(
			"Invalid one-search run: 2 web searches",
		);
		expect(excessive.stdout).toContain("| one-search | 0.0% | 4 | 1 |");
		await Bun.write(examplePath, example);
		const missingModel = await run(
			[
				process.execPath,
				join(root, "evals/run.ts"),
				"--agent",
				"claude",
				"--repeat",
				"1",
			],
			{ env },
		);
		expect(missingModel.status).toBe(1);
		expect(missingModel.stdout).toContain(
			"Agent stream omitted the model name",
		);
		await Bun.write(
			join(root, "evals/targets.json"),
			JSON.stringify({ pass_rate: 1, median_calls_ratio: 999 }),
		);
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
				"--repeat",
				"1",
			],
			{ env: { ...env, EVAL_RESET_CMD: "echo skip" } },
		);
		expect(failedCheck.status).toBe(1);
		expect(failedCheck.stdout).toContain("Answer missing expected text: 0.1.0");
		const resetCount = (await Bun.file(join(root, "resets")).text()).split(
			"\n",
		).length;
		accountSlug = "production";
		const unsafe = await run(command, { env });
		expect(unsafe.status).toBe(1);
		expect(unsafe.stdout).toContain("Safety preflight refused");
		expect(
			(await Bun.file(join(root, "resets")).text()).split("\n").length,
		).toBe(resetCount);
		const missingSlug = await run(command, {
			env: { ...env, EVAL_SANDBOX_SLUG: "" },
		});
		expect(missingSlug.status).toBe(1);
		expect(missingSlug.stderr).toContain(
			"Safety preflight requires EVAL_SANDBOX_SLUG",
		);
	} finally {
		server.stop(true);
		await rm(temporary, { recursive: true, force: true });
	}
}, 60000);

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

test("nightly secret guard skips successfully for each missing secret", async () => {
	const workflow = Bun.YAML.parse(
		await Bun.file(resolve(".github/workflows/eval-nightly.yml")).text(),
	) as { jobs: { eval: { steps: { id?: string; run?: string }[] } } };
	const guard = workflow.jobs.eval.steps.find(
		(step) => step.id === "secrets",
	)?.run;
	if (!guard) throw new Error("Missing nightly guard");
	const root = await mkdtemp(join(tmpdir(), "boldvideo-nightly-test-"));
	const configured: Record<string, string> = {
		BOLDVIDEO_API_KEY: "fixture-key",
		BOLDVIDEO_API_URL: "https://sandbox.example/api/v1",
		EVAL_SANDBOX_SLUG: "sandbox",
		ANTHROPIC_API_KEY: "fixture-agent-key",
	};
	try {
		for (const missing of Object.keys(configured)) {
			const output = join(root, missing);
			const skipped = await run(["bash", "-c", guard], {
				env: { ...configured, [missing]: "", GITHUB_OUTPUT: output },
			});
			expect(skipped.status).toBe(0);
			expect(skipped.stdout).toContain("::notice::Skipping nightly eval");
			expect(await Bun.file(output).text()).toBe("ready=false\n");
		}
		const output = join(root, "configured");
		expect(
			(
				await run(["bash", "-c", guard], {
					env: { ...configured, GITHUB_OUTPUT: output },
				})
			).status,
		).toBe(0);
		expect(await Bun.file(output).text()).toBe("ready=true\n");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
