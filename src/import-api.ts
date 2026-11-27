import { apiUrl, request } from "./api";
import { apiError, error } from "./errors";

export interface ImportRun extends Record<string, unknown> {
	run_id: string;
	source_url: string;
	status_url: string;
	status: "queued" | "running" | "completed" | "failed" | "canceled";
	counts: {
		total: number | null;
		queued: number;
		running: number;
		done: number;
		failed: number;
		skipped: number;
		canceled: number;
	};
	videos: {
		source_url: string;
		status: string;
		internal_id?: string;
		error?: unknown;
	}[];
	meta: {
		page: number;
		page_size: number;
		total_entries: number;
		total_pages: number;
	};
}

// The pending #724/#725 envelopes are confined to this module. Admin GET video
// currently returns a bare record; the readiness contract adds a data envelope.
export function importVideo(body: unknown): Record<string, unknown> {
	const value = body as { data?: Record<string, unknown> } | null;
	const video = value?.data ?? (body as Record<string, unknown>);
	if (
		!video ||
		typeof video.internal_id !== "string" ||
		typeof video.status !== "string"
	)
		throw error(
			"api_error",
			"The Bold API returned an invalid import video.",
			"boldvideo import --help",
		);
	return video;
}

export function importRun(body: unknown): ImportRun {
	const run = (body as { data?: ImportRun } | null)?.data;
	if (
		!run ||
		typeof run.run_id !== "string" ||
		!["queued", "running", "completed", "failed", "canceled"].includes(
			run.status,
		) ||
		!run.counts ||
		!Array.isArray(run.videos) ||
		!Number.isSafeInteger(run.meta?.page) ||
		run.meta.page < 1 ||
		!Number.isSafeInteger(run.meta?.total_pages) ||
		run.meta.total_pages < 0
	)
		throw error(
			"api_error",
			"The Bold API returned an invalid import run.",
			"boldvideo import status --help",
		);
	return run;
}

export async function getRun(
	key: string,
	id: string,
	page = 1,
	signal?: AbortSignal,
): Promise<ImportRun> {
	// TODO(bold-js): use the SDK when it exposes import runs and their video pages.
	const path = `/admin/imports/${encodeURIComponent(id)}`;
	return importRun(
		signal
			? (
					await importResponse(
						"GET",
						key,
						`${path}?page=${page}`,
						undefined,
						signal,
					)
				).data
			: await request("GET", path, {
					key,
					query: { page },
				}),
	);
}

export async function getVideo(key: string, id: string, signal?: AbortSignal) {
	const path = `/admin/videos/${encodeURIComponent(id)}`;
	// TODO(bold-js): use the SDK when it exposes admin readiness and failure_reason.
	return importVideo(
		signal
			? (await importResponse("GET", key, path, undefined, signal)).data
			: await request("GET", path, { key }),
	);
}

export async function resolveCollections(
	key: string,
	values: string[],
): Promise<string[]> {
	const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
	if (values.every((value) => uuid.test(value))) return values;
	// TODO(bold-js): use the SDK when it exposes collection lookup at the API cap.
	const body = await request("GET", "/collections", {
		key,
		query: { limit: 1000 },
	});
	const collections = (
		body as { data?: { id: string; name: string; slug: string }[] } | null
	)?.data;
	if (!Array.isArray(collections))
		throw error(
			"api_error",
			"The Bold API returned an invalid collection list.",
			"boldvideo collections list",
		);
	return values.map((value) => {
		if (uuid.test(value)) return value;
		const byId = collections.find(
			(collection) => collection.id === value || collection.slug === value,
		);
		if (byId) return byId.id;
		const matches = collections.filter(
			(collection) => collection.name === value,
		);
		if (matches.length > 1)
			throw error(
				"usage_error",
				`Collection name '${value}' is ambiguous; use an ID.`,
				"boldvideo collections list",
				2,
			);
		if (matches[0]) return matches[0].id;
		throw error(
			"not_found",
			`Collection '${value}' was not found.`,
			"boldvideo collections list",
			4,
		);
	});
}

// request() discards response status and 422 details and cannot abort a read
// at the wait deadline. Keep that transport here, without changing shared API code.
// Returns every HTTP answer, so a caller can act on a refusal it knows how to handle.
export async function importFetch(
	method: "GET" | "POST",
	key: string,
	path: string,
	body?: unknown,
	waitSignal?: AbortSignal,
) {
	const signal = AbortSignal.any([
		AbortSignal.timeout(30_000),
		...(waitSignal ? [waitSignal] : []),
	]);
	let response: Response;
	let text: string;
	try {
		// TODO(bold-js): use the SDK when it exposes admin imports and response status.
		response = await fetch(`${apiUrl()}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${key}`,
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			redirect: "error",
			signal,
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
	return {
		data,
		status: response.status,
		ok: response.ok,
		requestId: response.headers.get("x-request-id") ?? undefined,
	};
}

export async function importResponse(
	method: "GET" | "POST",
	key: string,
	path: string,
	body?: unknown,
	waitSignal?: AbortSignal,
) {
	const { data, status, ok, requestId } = await importFetch(
		method,
		key,
		path,
		body,
		waitSignal,
	);
	if (!ok) {
		const failure = apiError(
			status,
			data,
			requestId,
			"boldvideo import --help",
		);
		if (status === 422) {
			const payload = data as {
				error?: string;
				details?: Record<string, unknown>;
			} | null;
			const preflight = payload?.error === "managed_youtube_preflight_required";
			const mapped = error(
				preflight ? "managed_youtube_preflight_required" : "validation_error",
				preflight
					? "Managed YouTube requires a preflight in Mission Control."
					: `Import validation failed: ${Object.keys(payload?.details ?? {}).join(", ") || payload?.error || "invalid request"}.`,
				preflight
					? "Open Mission Control in Bold to complete YouTube preflight, then run boldvideo import youtube --help."
					: "boldvideo import --help",
				preflight ? 3 : 2,
			);
			throw {
				...mapped,
				...(failure.request_id ? { request_id: failure.request_id } : {}),
			};
		}
		throw failure;
	}
	return { data, status };
}
