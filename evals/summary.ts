export type Row = {
	task: string;
	version: number | string;
	repeat: number;
	pass: boolean;
	calls: number | null;
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

export function summarize(rows: Row[]) {
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
	return {
		pass_rate,
		median_calls_ratio,
		markdown: [
			"# Cold-agent eval results",
			"",
			`Pass rate: ${(pass_rate * 100).toFixed(1)}% (${rows.filter((row) => row.pass).length}/${rows.length})`,
			`Median calls: ${median(rows.flatMap((row) => (row.calls === null ? [] : [row.calls]))) ?? "n/a"}; median min_calls: ${median(rows.map((row) => row.min_calls))}; median calls/min_calls: ${median_calls_ratio?.toFixed(2) ?? "n/a"}`,
			`Median tokens (input + output, including cached input): ${tokens ?? "n/a"}`,
			`Missing measurements: ${rows.filter((row) => row.calls === null || row.input_tokens === null || row.output_tokens === null).length} (excluded from medians, never treated as zero).`,
			"",
			"| Task | Version | Repeat | Pass | Calls / min | Input | Output | ms | Transcript |",
			"| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
			...rows.map(
				(row) =>
					`| ${cell(row.task)} | ${cell(String(row.version))} | ${row.repeat} | ${row.pass ? "yes" : "no"} | ${row.calls ?? "n/a"} / ${row.min_calls} | ${row.input_tokens ?? "n/a"} | ${row.output_tokens ?? "n/a"} | ${row.duration_ms} | ${cell(row.transcript_path)} |`,
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
		].join("\n"),
	};
}
