export type Task = {
	id: string;
	version: number | string;
	prompt: string;
	starting_state: unknown;
	min_calls: number;
	check: { kind: "api" | "answer"; [key: string]: unknown };
	trap: unknown;
	chain: unknown;
};

export async function readTask(path: string): Promise<Task> {
	const text = await Bun.file(path).text();
	const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!front) throw new Error(`${path}: missing YAML front matter`);
	const task = Bun.YAML.parse(front[1] as string) as Task;
	if (
		!task.id ||
		!task.version ||
		!task.prompt ||
		!(task.min_calls > 0) ||
		!["api", "answer"].includes(task.check?.kind) ||
		!["starting_state", "trap", "chain"].every((key) =>
			Object.hasOwn(task, key),
		)
	)
		throw new Error(`${path}: invalid task metadata`);
	return task;
}
