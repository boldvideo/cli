import { expect } from "bun:test";

// A shell-word tokenizer, not a shell: examples are parsed, never executed.
export function words(example: string): string[] {
	const result: string[] = [];
	let word = "";
	let quote = "";
	let started = false;
	for (let i = 0; i < example.length; i++) {
		const char = example[i] ?? "";
		if (char === "\\" && quote !== "'") {
			const next = example[++i];
			if (next === undefined) throw new Error("Trailing escape in example");
			word += next;
			started = true;
		} else if (quote) {
			if (char === quote) quote = "";
			else word += char;
		} else if (char === "'" || char === '"') {
			quote = char;
			started = true;
		} else if (/\s/.test(char)) {
			if (started) result.push(word);
			word = "";
			started = false;
		} else {
			word += char;
			started = true;
		}
	}
	if (quote) throw new Error("Unclosed quote in example");
	if (started) result.push(word);
	expect(result.shift()).toBe("boldvideo");
	return result;
}
