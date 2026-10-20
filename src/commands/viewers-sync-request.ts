import { setTimeout as sleep } from "node:timers/promises";
import { apiUrl } from "../api";
import { apiError, error } from "../errors";

// TODO(bold-js): sync needs all API viewer fields and access to Retry-After.
// request() intentionally hides headers; keep this transport limited to sync.
export async function syncRequest(
	key: string,
	method: string,
	path: string,
	body?: unknown,
	query?: Record<string, string>,
): Promise<unknown> {
	const url = new URL(`${apiUrl()}${path}`);
	for (const [name, value] of Object.entries(query ?? {}))
		url.searchParams.set(name, value);
	for (let attempt = 0; ; attempt++) {
		const signal = AbortSignal.timeout(30_000);
		let response: Response;
		let text: string;
		try {
			response = await fetch(url, {
				method,
				signal,
				redirect: "error",
				headers: {
					Authorization: `Bearer ${key}`,
					Accept: "application/json",
					...(body === undefined ? {} : { "Content-Type": "application/json" }),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			text = await response.text();
		} catch {
			throw error(
				signal.aborted ? "timed_out" : "api_error",
				signal.aborted
					? "The Bold API request timed out."
					: "Could not reach the Bold API.",
				"boldvideo whoami",
				signal.aborted ? 5 : 1,
			);
		}
		if (response.status === 429 && attempt === 0) {
			const retry = response.headers.get("retry-after");
			let delay =
				retry === null
					? 0
					: /^\d+(\.\d+)?$/.test(retry.trim())
						? Number(retry) * 1000
						: Math.max(0, Date.parse(retry) - Date.now());
			if (!Number.isFinite(delay)) delay = 0;
			while (delay > 0) {
				const chunk = Math.min(delay, 2_147_483_647);
				await sleep(chunk);
				delay -= chunk;
			}
			continue;
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
				"boldvideo viewers sync --help",
			);
		return data;
	}
}
