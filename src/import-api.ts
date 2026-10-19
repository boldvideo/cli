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
): Promise<ImportRun> {
	// TODO(bold-js): use the SDK when it exposes import runs and their video pages.
	return importRun(
		await request("GET", `/admin/imports/${encodeURIComponent(id)}`, {
			key,
			query: { page },
		}),
	);
}

export async function resolveCollections(
	key: string,
	values: string[],
): Promise<string[]> {
	if (!values.length) return [];
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

// request() discards the status (200 already-active vs 202 created) and 422
// details. Keep this POST transport local, as videos does for raw transcripts.
export async function postImport(key: string, path: string, body?: unknown) {
	const signal = AbortSignal.timeout(30_000);
	let response: Response;
	let text: string;
	try {
		// TODO(bold-js): use the SDK when it exposes admin imports and response status.
		response = await fetch(`${apiUrl()}${path}`, {
			method: "POST",
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
	if (!response.ok) {
		const failure = apiError(
			response.status,
			data,
			response.headers.get("x-request-id") ?? undefined,
			"boldvideo import --help",
		);
		if (response.status === 422) {
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
	return { data, status: response.status };
}
