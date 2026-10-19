export type Mode = "cold" | "one-search" | "skill";

export type AgentResult = {
	answer: string;
	calls: number;
	cli_calls: number;
	searches: number;
	model: string | null;
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
	let model: string | null = null;
	const tools = new Set<string>();
	const cli = new Set<string>();
	const searches = new Set<string>();
	let serverSearches = 0;
	const messages = new Map<string, { input: number; output: number }>();
	for (const line of stream.split("\n").filter(Boolean)) {
		const event = JSON.parse(line);
		model = event.model ?? event.message?.model ?? model;
		if (event.modelUsage && !model)
			model = Object.keys(event.modelUsage)[0] ?? null;
		if (event.type === "assistant") {
			const blocks = event.message.content;
			for (const block of blocks) {
				if (!["tool_use", "server_tool_use"].includes(block.type)) continue;
				tools.add(block.id);
				if (["WebSearch", "web_search"].includes(block.name))
					searches.add(block.id);
				if (
					["Bash", "shell_command", "async_shell_command"].includes(
						block.name,
					) &&
					/^boldvideo(?:\s|$)/.test(
						block.input?.command ?? block.input?.cmd ?? "",
					)
				)
					cli.add(block.id);
			}
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
				serverSearches = event.usage.server_tool_use?.web_search_requests ?? 0;
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
		cli_calls: cli.size,
		searches: Math.max(searches.size, serverSearches),
		model,
		input_tokens: resultUsage || messages.size ? input_tokens : null,
		output_tokens: resultUsage || messages.size ? output_tokens : null,
		...(error ? { error } : {}),
	};
}

export async function claude(
	run: (args: string[]) => Promise<string>,
	prompt: string,
	mode: Mode = "cold",
	model?: string,
) {
	const tools = mode === "one-search" ? "Bash,WebSearch" : "Bash";
	return parseStream(
		await run([
			"-p",
			prompt,
			"--output-format",
			"stream-json",
			"--verbose",
			"--tools",
			tools,
			"--allowedTools",
			tools,
			"--strict-mcp-config",
			"--mcp-config",
			'{"mcpServers":{}}',
			"--setting-sources",
			"",
			...(model ? ["--model", model] : []),
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
		cli_calls: 0,
		searches: 0,
		model: "manual",
		input_tokens: 0,
		output_tokens: 0,
	};
}
