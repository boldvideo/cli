import type { Mode } from "./adapters";

export type Row = {
	task: string;
	version: number | string;
	mode: Mode;
	model: string | null;
	repeat: number;
	pass: boolean;
	valid: boolean;
	calls: number | null;
	cli_calls: number | null;
	searches: number | null;
	cost_usd: number | null;
	min_calls: number;
	input_tokens: number | null;
	output_tokens: number | null;
	duration_ms: number;
	transcript_path: string;
	reason?: string;
};

export function median(values: number[]) {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length
		? ((sorted[middle] as number) +
				(sorted[(sorted.length - 1) >> 1] as number)) /
				2
		: null;
}

export function summarize(rows: Row[], previous: Row[] = []) {
	const pass_rate = rows.filter((row) => row.pass).length / rows.length;
	const median_calls_ratio = median(
		rows.flatMap((row) =>
			row.calls === null ? [] : [row.calls / row.min_calls],
		),
	);
	const tokens = median(
		rows.flatMap((row) =>
			row.input_tokens === null || row.output_tokens === null
				? []
				: [row.input_tokens + row.output_tokens],
		),
	);
	const cell = (text: string) =>
		text.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
	const groups = (attempts: Row[]) => {
		const grouped = new Map<string, Row[]>();
		for (const row of attempts) {
			const key = JSON.stringify([
				row.task,
				row.version,
				row.mode ?? "cold",
				row.model ?? null,
			]);
			grouped.set(key, [...(grouped.get(key) ?? []), row]);
		}
		return [...grouped].map(([key, attempts]) => ({
			key,
			task: attempts[0]?.task,
			version: attempts[0]?.version,
			mode: attempts[0]?.mode ?? "cold",
			model: attempts[0]?.model ?? null,
			pass_rate: attempts.filter((row) => row.pass).length / attempts.length,
			median_calls: median(
				attempts.flatMap((row) => (row.calls === null ? [] : [row.calls])),
			),
			median_tokens: median(
				attempts.flatMap((row) =>
					row.input_tokens === null || row.output_tokens === null
						? []
						: [row.input_tokens + row.output_tokens],
				),
			),
			attempts: attempts.length,
		}));
	};
	const per_task = groups(rows);
	const prior = new Map(groups(previous).map((group) => [group.key, group]));
	const regressions: string[] = [];
	for (const group of per_task) {
		const old = prior.get(group.key);
		if (!old) continue;
		const changes: string[] = [];
		if (group.pass_rate < old.pass_rate)
			changes.push(
				`pass rate ${(old.pass_rate * 100).toFixed(1)}% → ${(group.pass_rate * 100).toFixed(1)}%`,
			);
		if (
			group.median_calls !== null &&
			old.median_calls !== null &&
			group.median_calls > old.median_calls
		)
			changes.push(`median calls ${old.median_calls} → ${group.median_calls}`);
		if (
			group.median_tokens !== null &&
			old.median_tokens !== null &&
			group.median_tokens > old.median_tokens
		)
			changes.push(
				`median tokens ${old.median_tokens} → ${group.median_tokens}`,
			);
		if (changes.length)
			regressions.push(
				`${group.task} (${group.mode}, ${group.model ?? "unknown model"}): ${changes.join("; ")}`,
			);
	}
	const total_cost_usd = rows.reduce(
		(sum, row) => sum + (row.cost_usd ?? 0),
		0,
	);
	return {
		pass_rate,
		median_calls_ratio,
		per_task,
		regressions,
		total_cost_usd,
		markdown: [
			"# Cold-agent eval results",
			"",
			`Pass rate: ${(pass_rate * 100).toFixed(1)}% (${rows.filter((row) => row.pass).length}/${rows.length})`,
			`Median calls: ${median(rows.flatMap((row) => (row.calls === null ? [] : [row.calls]))) ?? "n/a"}; median min_calls: ${median(rows.map((row) => row.min_calls))}; median calls/min_calls: ${median_calls_ratio?.toFixed(2) ?? "n/a"}`,
			`Median tokens (input + output, including cached input): ${tokens ?? "n/a"}`,
			`Missing measurements: ${rows.filter((row) => row.calls === null || row.input_tokens === null || row.output_tokens === null).length} (excluded from medians, never treated as zero).`,
			"",
			"## Per-mode totals",
			"| Mode | Pass rate | Median tool calls | Attempts |",
			"| --- | --- | --- | --- |",
			...[...new Set(rows.map((row) => row.mode))].map((mode) => {
				const attempts = rows.filter((row) => row.mode === mode);
				return `| ${mode} | ${((attempts.filter((row) => row.pass).length / attempts.length) * 100).toFixed(1)}% | ${median(attempts.flatMap((row) => (row.calls === null ? [] : [row.calls]))) ?? "n/a"} | ${attempts.length} |`;
			}),
			"",
			"## Per-task aggregates",
			"| Task | Version | Mode | Model | Pass rate | Median tool calls | Attempts |",
			"| --- | --- | --- | --- | --- | --- | --- |",
			...per_task.map(
				(group) =>
					`| ${cell(String(group.task))} | ${cell(String(group.version))} | ${group.mode} | ${cell(group.model ?? "unknown")} | ${(group.pass_rate * 100).toFixed(1)}% | ${group.median_calls ?? "n/a"} | ${group.attempts} |`,
			),
			"",
			"## Attempts",
			"| Task | Version | Mode | Model | Repeat | Pass | Valid | Calls / min | CLI calls | Searches | Input | Output | Cost USD | ms | Transcript |",
			"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
			...rows.map(
				(row) =>
					`| ${cell(row.task)} | ${cell(String(row.version))} | ${row.mode} | ${cell(row.model ?? "unknown")} | ${row.repeat} | ${row.pass ? "yes" : "no"} | ${row.valid ? "yes" : "no"} | ${row.calls ?? "n/a"} / ${row.min_calls} | ${row.cli_calls ?? "n/a"} | ${row.searches ?? "n/a"} | ${row.input_tokens ?? "n/a"} | ${row.output_tokens ?? "n/a"} | ${row.cost_usd?.toFixed(6) ?? "n/a"} | ${row.duration_ms} | ${cell(row.transcript_path)} |`,
			),
			"",
			"## Failed tasks",
			...rows
				.filter((row) => !row.pass)
				.map(
					(row) =>
						`- ${cell(row.task)} (repeat ${row.repeat}): ${cell(row.reason ?? "Check failed")}`,
				),
			...(rows.every((row) => row.pass) ? ["None."] : []),
			"",
			"## Regressions",
			...(previous.length
				? regressions.length
					? regressions.map((reason) => `- ${cell(reason)}`)
					: ["None for comparable task versions, modes and models."]
				: ["No previous comparable results file."]),
			"",
			`Total estimated cost (placeholder prices): $${total_cost_usd.toFixed(6)} USD; ${rows.filter((row) => row.cost_usd == null).length} unpriced attempt(s), excluded from the total.`,
			"",
		].join("\n"),
	};
}
