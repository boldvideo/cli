// CSV quoting follows RFC 4180, including escaped quotes and embedded newlines.
// Rows whose cells are all empty are dropped.
export function csvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	let closed = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
				closed = true;
			} else cell += char;
		} else if (char === "," || char === "\n" || char === "\r") {
			row.push(cell);
			cell = "";
			closed = false;
			if (char !== ",") {
				if (char === "\r" && text[i + 1] === "\n") i++;
				if (row.some((value) => value !== "")) rows.push(row);
				row = [];
			}
		} else if (char === '"' && !cell && !closed) quoted = true;
		else if (closed || char === '"') throw new Error("Invalid CSV quoting.");
		else cell += char;
	}
	if (quoted) throw new Error("Unclosed CSV quote.");
	row.push(cell);
	if (row.some((value) => value !== "")) rows.push(row);
	return rows;
}

export function csvText(rows: string[][]): string {
	return rows
		.map((row) =>
			row
				.map((cell) =>
					/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell,
				)
				.join(","),
		)
		.join("\n")
		.concat("\n");
}
