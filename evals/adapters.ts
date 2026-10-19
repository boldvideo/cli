export type AgentResult = {
	answer: string;
	calls: number;
	input_tokens: number | null;
	output_tokens: number | null;
	error?: string;
};

// Both CLIs emit Claude-compatible JSONL. Count tool IDs once, not stream deltas.
export function parseStream(stream: string): AgentResult {
	let answer = "";
	let input_tokens = 0;
	let output_tokens = 0;
	let resultUsage = false;
	let completed = false;
	let error: string | undefined;
	const tools = new Set<string>();
	const messages = new Map<string, { input: number; output: number }>();
	for (const line of stream.split("\n").filter(Boolean)) {
		const event = JSON.parse(line);
		if (event.type === "assistant") {
			const blocks = event.message.content;
			for (const block of blocks)
				if (block.type === "tool_use") tools.add(block.id);
			const text = blocks
				.filter((block: { type: string }) => block.type === "text")
				.map((block: { text: string }) => block.text)
				.join("\n");
			if (text) answer = text;
			const usage = event.message.usage;
			if (usage)
				messages.set(
					event.message.id ?? event.uuid ?? `event-${messages.size}`,
					{
						input:
							(usage.input_tokens ?? 0) +
							(usage.cache_read_input_tokens ?? 0) +
							(usage.cache_creation_input_tokens ?? 0),
						output: usage.output_tokens ?? 0,
					},
				);
		}
		if (event.type === "result") {
			completed = true;
			if (event.is_error || (event.subtype && event.subtype !== "success"))
				error = `Agent failed: ${event.result ?? event.subtype}`;
			if (typeof event.result === "string") answer = event.result;
			if (event.usage) {
				resultUsage = true;
				input_tokens =
					(event.usage.input_tokens ?? 0) +
					(event.usage.cache_read_input_tokens ?? 0) +
					(event.usage.cache_creation_input_tokens ?? 0);
				output_tokens = event.usage.output_tokens ?? 0;
			}
		}
	}
	if (!completed) error = "Agent stream ended without a result event";
	if (!resultUsage) {
		if (!messages.size) error ??= "Agent stream has no token usage";
		for (const usage of messages.values()) {
			input_tokens += usage.input;
			output_tokens += usage.output;
		}
	}
	return {
		answer,
		calls: tools.size,
		input_tokens: resultUsage || messages.size ? input_tokens : null,
		output_tokens: resultUsage || messages.size ? output_tokens : null,
		...(error ? { error } : {}),
	};
}

export async function claude(
	run: (args: string[]) => Promise<string>,
	prompt: string,
) {
	return parseStream(
		await run([
			"-p",
			prompt,
			"--output-format",
			"stream-json",
			"--verbose",
			"--tools",
			"Bash",
			"--allowedTools",
			"Bash",
			"--strict-mcp-config",
			"--mcp-config",
			'{"mcpServers":{}}',
			"--setting-sources",
			"",
		]),
	);
}

export async function amp(
	run: (args: string[]) => Promise<string>,
	prompt: string,
) {
	return parseStream(await run(["-x", prompt, "--stream-json", "--no-ide"]));
}

export async function manual(answerFile: string, prompt: string) {
	console.log(`Manual task:\n${prompt}\nAnswer file: ${answerFile}`);
	return {
		answer: await Bun.file(answerFile).text(),
		calls: 0,
		input_tokens: 0,
		output_tokens: 0,
	};
}
