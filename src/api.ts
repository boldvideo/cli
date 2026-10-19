import { apiError, error, registerSecret } from "./errors";

export function apiUrl(): string {
	return (
		process.env.BOLDVIDEO_API_URL || "https://app.boldvideo.io/api/v1"
	).replace(/\/+$/, "");
}

export async function request(
	method: string,
	path: string,
	options: {
		key: string;
		body?: unknown;
		query?: Record<string, string | number | boolean | undefined>;
	},
): Promise<unknown> {
	registerSecret(options.key);
	const base = new URL(`${apiUrl()}/`);
	const url = new URL(path.replace(/^\/+/, ""), base);
	if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
		throw error(
			"usage_error",
			"API paths must stay under the API base URL.",
			"boldvideo --help",
			2,
		);
	for (const [name, value] of Object.entries(options.query ?? {}))
		if (value !== undefined) url.searchParams.set(name, String(value));
	let response: Response;
	let text: string;
	const signal = AbortSignal.timeout(30_000);
	try {
		response = await fetch(url, {
			method,
			headers: {
				Authorization: `Bearer ${options.key}`,
				...(path.startsWith("/admin")
					? { "X-Bold-Admin-Api-Key": options.key }
					: {}),
				Accept: "application/json",
				...(options.body === undefined
					? {}
					: { "Content-Type": "application/json" }),
			},
			body:
				options.body === undefined ? undefined : JSON.stringify(options.body),
			redirect: "error",
			signal,
		});
		text = await response.text();
	} catch {
		if (signal.aborted)
			throw error(
				"timed_out",
				"The Bold API request timed out.",
				"boldvideo whoami",
				5,
			);
		throw error(
			"api_error",
			"Could not reach the Bold API.",
			"Check BOLDVIDEO_API_URL, then run boldvideo whoami.",
		);
	}
	let data: unknown;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		if (response.ok)
			throw error(
				"api_error",
				"The Bold API returned invalid JSON.",
				"boldvideo whoami",
			);
	}
	if (!response.ok)
		throw apiError(
			response.status,
			data,
			response.headers.get("x-request-id") ?? undefined,
			response.status === 401 || response.status === 403
				? "boldvideo login --help"
				: "boldvideo whoami",
		);
	return data;
}
