import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { amp, claude, manual } from "./adapters";
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
			tasks: { type: "string", default: "evals/tasks/*.md" },
			repeat: { type: "string", default: "1" },
			timeout: { type: "string", default: "600" },
			concurrency: { type: "string", default: "1" },
			answer: { type: "string" },
		},
	});
	const agent = values.agent as "claude" | "amp" | "manual";
	if (!["claude", "amp", "manual"].includes(agent))
		throw new Error("Unknown --agent");
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
	if (
		!(targets.pass_rate >= 0 && targets.pass_rate <= 1) ||
		!(targets.median_calls_ratio > 0)
	)
		throw new Error("Invalid eval targets");
	const timestamp = new Date().toISOString().replaceAll(":", "-");
	const resultDir = join(repo, "evals/results");
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
						repeat,
						pass: false,
						calls: null,
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
						root = await mkdtemp(join(tmpdir(), "boldvideo-eval-"));
						const isolated = await sandbox(
							root,
							join(repo, "dist/boldvideo.js"),
						);
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
								? await manual(resolve(values.answer as string), task.prompt)
								: await (agent === "claude" ? claude : amp)(run, task.prompt);
						Object.assign(row, {
							calls: result.calls,
							input_tokens: result.input_tokens,
							output_tokens: result.output_tokens,
						});
						await Bun.write(`${prefix}.answer.txt`, result.answer);
						if (agent === "manual")
							await Bun.write(
								row.transcript_path,
								`${JSON.stringify({ prompt: task.prompt, answer: result.answer, agent })}\n`,
							);
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
	const summary = summarize(rows);
	const targetPass =
		summary.pass_rate >= targets.pass_rate &&
		summary.median_calls_ratio !== null &&
		summary.median_calls_ratio <= targets.median_calls_ratio;
	const markdown = `${summary.markdown}\nAgent: ${agent}. Targets: ${targetPass ? "met" : "MISSED"} (pass rate ≥ ${targets.pass_rate}, calls ratio ≤ ${targets.median_calls_ratio}).\n`;
	await Bun.write(
		join(resultDir, `${timestamp}.json`),
		`${JSON.stringify({ agent, targets, target_pass: targetPass, results: rows }, null, 2)}\n`,
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
