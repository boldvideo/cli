import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { amp, claude, type Mode, manual } from "./adapters";
import { execute } from "./process";
import { sandbox } from "./sandbox";
import { type Row, summarize } from "./summary";
import { readTask } from "./tasks";

const repo = resolve(import.meta.dir, "..");

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			agent: { type: "string", default: "claude" },
			mode: { type: "string", default: "cold" },
			model: { type: "string" },
			tasks: { type: "string", default: "evals/tasks/*.md" },
			repeat: { type: "string", default: "3" },
			timeout: { type: "string", default: "600" },
			concurrency: { type: "string", default: "1" },
			answer: { type: "string" },
		},
	});
	const agent = values.agent as "claude" | "amp" | "manual";
	const mode = values.mode as Mode;
	if (!["cold", "one-search", "skill"].includes(mode))
		throw new Error("Unknown --mode");
	if (!["claude", "amp", "manual"].includes(agent))
		throw new Error("Unknown --agent");
	for (const name of [
		"BOLDVIDEO_API_KEY",
		"BOLDVIDEO_API_URL",
		"EVAL_SANDBOX_SLUG",
	])
		if (!process.env[name]?.trim())
			throw new Error(`Safety preflight requires ${name}`);
	for (const name of ["repeat", "timeout", "concurrency"] as const)
		if (!Number.isSafeInteger(Number(values[name])) || Number(values[name]) < 1)
			throw new Error(`--${name} must be a positive integer`);
	if (agent === "manual" && !values.answer)
		throw new Error("manual requires --answer file");
	const executable = agent === "manual" ? "" : Bun.which(agent);
	if (executable === null)
		throw new Error(`Install ${agent} before running evals`);
	const tasks = (
		await Array.fromAsync(
			new Bun.Glob(values.tasks).scan({ cwd: repo, absolute: true }),
		)
	).sort();
	if (!tasks.length) throw new Error("No tasks matched --tasks");
	// Fail before any reset if the suite or targets are malformed.
	const suite = await Promise.all(
		tasks.map(async (path) => ({ path, task: await readTask(path) })),
	);
	const targets = await Bun.file(join(repo, "evals/targets.json")).json();
	const prices: Record<
		string,
		{ input_per_million: number; output_per_million: number }
	> = await Bun.file(join(repo, "evals/prices.json")).json();
	if (
		!prices.default ||
		Object.values(prices).some(
			(price) =>
				![price.input_per_million, price.output_per_million].every(
					(value) => Number.isFinite(value) && value >= 0,
				),
		)
	)
		throw new Error("Invalid eval prices");
	if (
		!(targets.pass_rate >= 0 && targets.pass_rate <= 1) ||
		!(targets.median_calls_ratio > 0)
	)
		throw new Error("Invalid eval targets");
	const timestamp = new Date().toISOString().replaceAll(":", "-");
	const resultDir = join(repo, "evals/results");
	await mkdir(resultDir, { recursive: true, mode: 0o700 });
	let previous: Row[] = [];
	let previousFile: string | null = null;
	const history = (
		await Array.fromAsync(
			new Bun.Glob("*.json").scan({ cwd: resultDir, absolute: true }),
		)
	)
		.sort()
		.reverse();
	for (const path of history) {
		const result = await Bun.file(path).json();
		if (result.agent === agent && (result.mode ?? "cold") === mode) {
			previous = result.results;
			previousFile = path;
			break;
		}
	}
	const transcripts = join(resultDir, timestamp);
	await mkdir(transcripts, { recursive: true, mode: 0o700 });
	const jobs = Array.from({ length: Number(values.repeat) }, (_, repeat) =>
		suite.map((entry) => ({ ...entry, repeat: repeat + 1 })),
	).flat();
	const rows: Row[] = new Array(jobs.length);
	let next = 0;
	if (Number(values.concurrency) > 1)
		console.error(
			"Warning: concurrent resets require independently isolated sandbox accounts.",
		);
	await Promise.all(
		Array.from(
			{ length: Math.min(Number(values.concurrency), jobs.length) },
			async () => {
				for (;;) {
					const index = next++;
					const job = jobs[index];
					if (!job) return;
					const { task, path, repeat } = job;
					const prefix = join(transcripts, String(index + 1).padStart(3, "0"));
					const row: Row = {
						task: task.id,
						version: task.version,
						mode,
						model: values.model ?? (agent === "manual" ? "manual" : null),
						repeat,
						pass: false,
						valid: false,
						calls: null,
						cli_calls: null,
						searches: null,
						cost_usd: null,
						min_calls: task.min_calls,
						input_tokens: null,
						output_tokens: null,
						duration_ms: 0,
						transcript_path: `${prefix}.jsonl`,
					};
					const start = performance.now();
					const controller = new AbortController();
					const timer = setTimeout(
						() => controller.abort(new Error("Task timed out")),
						Number(values.timeout) * 1000,
					);
					let root: string | undefined;
					try {
						await Bun.write(row.transcript_path, "");
						root = await mkdtemp(join(tmpdir(), "boldvideo-eval-"));
						const isolated = await sandbox(
							root,
							join(repo, "dist/boldvideo.js"),
							mode,
						);
						const identity = JSON.parse(
							await execute(
								[join(root, "bin/boldvideo"), "whoami", "--json"],
								isolated.cwd,
								isolated.env,
								controller.signal,
								`${prefix}.whoami`,
							),
						);
						if (identity.account_slug !== process.env.EVAL_SANDBOX_SLUG)
							throw new Error(
								"Safety preflight refused: account slug does not match EVAL_SANDBOX_SLUG",
							);
						row.valid = true;
						await execute(
							["/bin/sh", "-c", process.env.EVAL_RESET_CMD ?? "echo skip"],
							repo,
							{
								...process.env,
								EVAL_STARTING_STATE: JSON.stringify(task.starting_state),
								EVAL_TASK_ID: task.id,
							},
							controller.signal,
							`${prefix}.reset`,
						);
						let prompt = task.prompt;
						if (mode === "one-search")
							prompt += "\n\nYou may use web search at most once.";
						if (mode === "skill")
							prompt += `\n\nUse the skill installed at skill/SKILL.md:\n${await Bun.file(join(isolated.cwd, "skill/SKILL.md")).text()}`;
						let processError: unknown;
						const run = async (args: string[]) => {
							try {
								return await execute(
									[executable as string, ...args],
									isolated.cwd,
									isolated.env,
									controller.signal,
									row.transcript_path,
								);
							} catch (error) {
								processError = error;
								return Bun.file(row.transcript_path).text();
							}
						};
						const result =
							agent === "manual"
								? await manual(resolve(values.answer as string), prompt)
								: agent === "claude"
									? await claude(run, prompt, mode, values.model)
									: await amp(run, prompt);
						Object.assign(row, {
							calls: result.calls,
							cli_calls: result.cli_calls,
							searches: result.searches,
							model: result.model ?? row.model,
							input_tokens: result.input_tokens,
							output_tokens: result.output_tokens,
						});
						const price = prices[row.model ?? "default"] ?? prices.default;
						if (
							price &&
							row.input_tokens !== null &&
							row.output_tokens !== null
						)
							row.cost_usd =
								(row.input_tokens * price.input_per_million +
									row.output_tokens * price.output_per_million) /
								1_000_000;
						await Bun.write(`${prefix}.answer.txt`, result.answer);
						if (agent === "manual")
							await Bun.write(
								row.transcript_path,
								`${JSON.stringify({ prompt, answer: result.answer, agent, mode })}\n`,
							);
						if (result.searches > (mode === "one-search" ? 1 : 0)) {
							row.valid = false;
							throw new Error(
								`Invalid ${mode} run: ${result.searches} web searches exceeds the allowed budget`,
							);
						}
						if (!row.model) {
							row.valid = false;
							throw new Error(
								"Agent stream omitted the model name; supply --model for reporting",
							);
						}
						if (processError) throw processError;
						if ("error" in result && result.error)
							throw new Error(String(result.error));
						await execute(
							[
								process.execPath,
								join(repo, "evals/check.ts"),
								path,
								"--answer",
								`${prefix}.answer.txt`,
							],
							repo,
							process.env,
							controller.signal,
							`${prefix}.check`,
						);
						row.pass = true;
					} catch (error) {
						row.reason = (
							error instanceof Error ? error.message : String(error)
						).replace(/[\r\n]+/g, " ");
					} finally {
						clearTimeout(timer);
						if (root) await rm(root, { recursive: true, force: true });
						row.duration_ms = Math.round(performance.now() - start);
						rows[index] = row;
					}
				}
			},
		),
	);
	const summary = summarize(rows, previous);
	const targetPass =
		rows.every((row) => row.valid) &&
		summary.pass_rate >= targets.pass_rate &&
		summary.median_calls_ratio !== null &&
		summary.median_calls_ratio <= targets.median_calls_ratio;
	const markdown = `${summary.markdown}\nAgent: ${agent}. Mode: ${mode}. Previous results: ${previousFile ?? "none"}. Targets: ${targetPass ? "met" : "MISSED"} (pass rate ≥ ${targets.pass_rate}, calls ratio ≤ ${targets.median_calls_ratio}).\n`;
	await Bun.write(
		join(resultDir, `${timestamp}.json`),
		`${JSON.stringify({ agent, mode, model: values.model ?? null, prices, targets, target_pass: targetPass, previous_file: previousFile, results: rows, summary }, null, 2)}\n`,
	);
	await Bun.write(join(resultDir, "latest.md"), markdown);
	console.log(markdown);
	if (!targetPass) process.exitCode = 1;
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
