// The Bold wordmark, rasterized from the brand SVG into half-block characters.
// 54 columns by 7 rows; every terminal font that has block elements draws it.
export const wordmark = [
	"████████▄▄▄     ▄██████▄▄   █████████    ▄███████▄▄",
	"███████████▄  ████████████  █████████    ███████████▄",
	"███████████▀ ██████████████ █████████    █████████████",
	"███████████  ████████████████████████    █████████████",
	"████████████▄██████████████▀█████████    █████████████",
	"███████████████████████████ ████████████ ████████████▀",
	"████████████  ▀███████████  ▀███████████ ███████████▀",
];

/** Bold's signal mint (#41C6A6), with a plain-green fallback for 16-colour terminals. */
export function mint(text: string, enabled: boolean): string {
	if (!enabled) return text;
	const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? "");
	return `${truecolor ? "\x1b[38;2;65;198;166m" : "\x1b[32m"}${text}\x1b[39m`;
}
