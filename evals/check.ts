import { resolve } from "node:path";
import { parseArgs } from "node:util";

type AnswerRule = { contains?: string[]; regex?: string };
type ApiCheck = {
	kind: "api";
	method: "GET";
	path: string;
	jq: string;
	key?: "admin" | "tenant";
	answer?: AnswerRule;
};
export type Task = {
	id: string;
	version: number;
	prompt: string;
	starting_state: string;
	min_calls: number;
	check: ApiCheck | (AnswerRule & { kind: "answer" });
	trap: boolean;
	chain: boolean;
};

function requireValue(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function answerRegex(pattern: string) {
	const prefix = /^\(\?([is]+)\)/.exec(pattern);
	return new RegExp(
		prefix ? pattern.slice(prefix[0].length) : pattern,
		prefix?.[1],
	);
}

function validateAnswer(rule: AnswerRule) {
	requireValue(rule && typeof rule === "object", "Invalid answer rule.");
	requireValue(
		(typeof rule.regex === "string" && rule.regex.length > 0) ||
			(Array.isArray(rule.contains) && rule.contains.length > 0),
		"An answer rule needs regex or contains.",
	);
	if (rule.regex !== undefined) {
		requireValue(typeof rule.regex === "string", "Invalid answer regex.");
		answerRegex(rule.regex);
	}
	if (rule.contains !== undefined)
		requireValue(
			Array.isArray(rule.contains) &&
				rule.contains.every((text) => typeof text === "string" && text.length),
			"Invalid answer contains rule.",
		);
}

export async function loadTask(path: string): Promise<Task> {
	const source = await Bun.file(path).text();
	const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n([\s\S]*)$/.exec(source);
	requireValue(front, "Task needs YAML front matter and a body.");
	const task = Bun.YAML.parse(front[1] as string) as Task;
	requireValue(task && typeof task === "object", "Invalid task metadata.");
	requireValue(/^\d{2}-[a-z0-9-]+$/.test(task.id), "Invalid task id.");
	for (const key of ["version", "min_calls"] as const)
		requireValue(
			Number.isSafeInteger(task[key]) && task[key] >= 1,
			`Invalid ${key}.`,
		);
	for (const key of ["prompt", "starting_state"] as const)
		requireValue(
			typeof task[key] === "string" && task[key].trim(),
			`Invalid ${key}.`,
		);
	for (const key of ["trap", "chain"] as const)
		requireValue(typeof task[key] === "boolean", `Invalid ${key}.`);
	requireValue(
		front[2]?.startsWith(`${task.prompt}\n\n`),
		"Body must begin with the verbatim prompt.",
	);
	const check = task.check;
	requireValue(check && typeof check === "object", "Missing check.");
	if (check.kind === "answer") validateAnswer(check);
	else {
		requireValue(
			check.kind === "api" && check.method === "GET",
			"API checks must use GET.",
		);
		requireValue(
			typeof check.path === "string" && /^\/(?!\/)/.test(check.path),
			"Invalid API path.",
		);
		requireValue(
			typeof check.jq === "string" && check.jq.trim(),
			"Missing jq expression.",
		);
		requireValue(
			check.key === undefined || ["admin", "tenant"].includes(check.key),
			"Invalid check key.",
		);
		if (check.answer) validateAnswer(check.answer);
	}
	return task;
}

// A deliberately bounded jq subset, not JavaScript eval or a dependency on jq.
// Split operators only outside strings, arrays and parentheses.
function split(expression: string, operator: string): string[] {
	const parts: string[] = [];
	let start = 0;
	let depth = 0;
	let quoted = false;
	for (let i = 0; i < expression.length; i++) {
		const char = expression[i];
		if (quoted && char === "\\") {
			i++;
			continue;
		}
		if (char === '"') quoted = !quoted;
		if (quoted) continue;
		if (char === "(" || char === "[" || char === "{") depth++;
		if (char === ")" || char === "]" || char === "}") depth--;
		if (depth === 0 && expression.startsWith(operator, i)) {
			parts.push(expression.slice(start, i).trim());
			i += operator.length - 1;
			start = i + 1;
		}
		requireValue(depth >= 0, "Unbalanced jq expression.");
	}
	requireValue(!quoted && depth === 0, "Unbalanced jq expression.");
	parts.push(expression.slice(start).trim());
	return parts;
}

function jq(expression: string, input: unknown): unknown {
	expression = expression.trim();
	if (expression.startsWith("(") && expression.endsWith(")")) {
		// Strip only a pair enclosing the entire expression.
		try {
			split(expression.slice(1, -1), "|");
			return jq(expression.slice(1, -1), input);
		} catch (cause) {
			if (
				!(cause instanceof Error) ||
				cause.message !== "Unbalanced jq expression."
			)
				throw cause;
		}
	}
	const conjunction = split(expression, " and ");
	if (conjunction.length > 1)
		return conjunction
			.map((part) => jq(part, input))
			.every((value) => value === true);
	const pipeline = split(expression, "|");
	if (pipeline.length > 1)
		return pipeline.reduce<unknown>((value, part) => jq(part, value), input);
	const equality = split(expression, " == ");
	if (equality.length === 2)
		return (
			JSON.stringify(jq(equality[0] as string, input)) ===
			JSON.stringify(JSON.parse(equality[1] as string))
		);
	if (/^\.[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*$/.test(expression)) {
		return expression
			.slice(1)
			.split(".")
			.reduce<unknown>((value, key) => {
				requireValue(
					value !== null &&
						typeof value === "object" &&
						Object.hasOwn(value, key),
					`Missing jq field: ${key}.`,
				);
				return (value as Record<string, unknown>)[key];
			}, input);
	}
	if (
		expression === "length" ||
		expression === "sort" ||
		expression.startsWith("map(")
	) {
		requireValue(Array.isArray(input), "jq array operation requires an array.");
		if (expression === "length") return input.length;
		if (expression === "sort") {
			requireValue(
				input.every((value) => typeof value === "string"),
				"jq sort supports string arrays only.",
			);
			return [...input].sort();
		}
		requireValue(expression.endsWith(")"), "Invalid jq map.");
		const inner = expression.slice(4, -1);
		if (inner.startsWith("select(") && inner.endsWith(")"))
			return input.filter((value) => jq(inner.slice(7, -1), value) === true);
		return input.map((value) => jq(inner, value));
	}
	throw new Error(`Unsupported jq expression: ${expression}`);
}

function checkAnswer(rule: AnswerRule, answer: string) {
	const contains =
		rule.contains?.map((text) => ({ text, pass: answer.includes(text) })) ?? [];
	const regex =
		rule.regex === undefined
			? undefined
			: { pattern: rule.regex, pass: answerRegex(rule.regex).test(answer) };
	return {
		pass: contains.every((item) => item.pass) && (regex?.pass ?? true),
		contains,
		regex,
		answer,
	};
}

async function check(task: Task, answer: string | undefined) {
	const rule = task.check.kind === "answer" ? task.check : task.check.answer;
	requireValue(
		!rule || answer !== undefined,
		"This task requires --answer file.",
	);
	const answerEvidence = rule ? checkAnswer(rule, answer as string) : undefined;
	if (task.check.kind === "answer")
		return { pass: answerEvidence?.pass === true, answer: answerEvidence };
	const spec = task.check;
	const base = process.env.BOLDVIDEO_API_URL;
	requireValue(base, "Set BOLDVIDEO_API_URL to the sandbox API base URL.");
	const key =
		process.env[
			spec.key === "tenant" ? "BOLDVIDEO_TENANT_KEY" : "BOLDVIDEO_API_KEY"
		];
	requireValue(
		key,
		`Missing ${spec.key === "tenant" ? "tenant" : "admin"} credential.`,
	);
	const root = new URL(`${base.replace(/\/+$/, "")}/`);
	const url = new URL(spec.path.slice(1), root);
	requireValue(
		["http:", "https:"].includes(root.protocol) &&
			!root.username &&
			!root.password &&
			url.origin === root.origin &&
			url.pathname.startsWith(root.pathname),
		"API path must stay under the sandbox base URL.",
	);
	const response = await fetch(url, {
		method: spec.method,
		headers:
			spec.key === "tenant"
				? { Authorization: `Bearer ${key}` }
				: { "X-Bold-Admin-Api-Key": key, Authorization: `Bearer ${key}` },
		redirect: "error",
		signal: AbortSignal.timeout(30_000),
	});
	const body: unknown = await response.json();
	const result = response.ok ? jq(spec.jq, body) : false;
	return {
		pass: result === true && (answerEvidence?.pass ?? true),
		api: {
			method: spec.method,
			path: spec.path,
			status: response.status,
			jq: spec.jq,
			result,
			body,
		},
		...(answerEvidence ? { answer: answerEvidence } : {}),
	};
}

// One line on stderr when a check fails, so runner summaries say why.
function reason(report: object): string {
	if ("error" in report) return String(report.error);
	const evidence = (report as { evidence: Awaited<ReturnType<typeof check>> })
		.evidence;
	const missing =
		evidence.answer?.contains
			.filter((item) => !item.pass)
			.map((item) => item.text) ?? [];
	if (missing.length)
		return `Answer missing expected text: ${missing.join(", ")}`;
	if (evidence.answer?.regex && !evidence.answer.regex.pass)
		return `Answer does not match ${evidence.answer.regex.pattern}`;
	if ("api" in evidence)
		return `API check ${evidence.api.jq} returned ${JSON.stringify(evidence.api.result)} (HTTP ${evidence.api.status})`;
	return "Check failed.";
}

if (import.meta.main) {
	let report: object;
	let exit = 2;
	try {
		const { positionals, values } = parseArgs({
			args: Bun.argv.slice(2),
			allowPositionals: true,
			options: { answer: { type: "string" } },
		});
		requireValue(
			positionals.length === 1,
			"Usage: bun evals/check.ts <task> [--answer file]",
		);
		const name = positionals[0] as string;
		const path =
			name.includes("/") || name.endsWith(".md")
				? resolve(name)
				: resolve(import.meta.dir, "tasks", `${name}.md`);
		const task = await loadTask(path);
		const evidence = await check(
			task,
			values.answer ? await Bun.file(values.answer).text() : undefined,
		);
		exit = evidence.pass ? 0 : 1;
		report = {
			task: task.id,
			version: task.version,
			result: evidence.pass ? "pass" : "fail",
			evidence,
		};
	} catch (cause) {
		report = {
			result: "fail",
			error: cause instanceof Error ? cause.message : "Checker error.",
		};
	}
	if (exit !== 0) console.error(reason(report));
	let output = JSON.stringify(report);
	for (const key of [
		process.env.BOLDVIDEO_API_KEY,
		process.env.BOLDVIDEO_TENANT_KEY,
	]) {
		if (key) {
			output = output.replaceAll(
				JSON.stringify(key).slice(1, -1),
				"[REDACTED]",
			);
		}
	}
	console.log(output);
	process.exitCode = exit;
}
