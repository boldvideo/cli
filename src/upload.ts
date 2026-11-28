import { open } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { apiError, type CliError, error } from "./errors";
import { importFetch, importVideo } from "./import-api";

// Uploading a local file through the admin API: start (or pick up) an upload,
// send the parts storage does not hold yet, complete. Every step can be repeated,
// so an interrupted file continues where it stopped.

interface Upload {
	id: string;
	part_size: number;
	uploaded_parts: { part_number: number; size: number }[];
}

export interface Uploaded {
	video: Record<string, unknown>;
	/** False when the file was already in and nothing had to be sent. */
	sent: boolean;
	deduplicated: boolean;
}

const HELP = "boldvideo import dir --help";
const ATTEMPTS = 6;
/** The API signs at most 100 part URLs per request; a small batch keeps them fresh. */
const URL_BATCH = 8;
const PART_TIMEOUT = 15 * 60_000;

/** Runs at most `max` tasks at once; the rest wait their turn. */
export function limiter(max: number) {
	let active = 0;
	const waiting: (() => void)[] = [];
	return async <T>(task: () => Promise<T>): Promise<T> => {
		// A released slot is handed straight to the next waiter, never back to the pool.
		if (active >= max) await new Promise<void>((next) => waiting.push(next));
		else active++;
		try {
			return await task();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
	};
}

const backoff = (attempt: number, signal: AbortSignal) =>
	sleep(Math.min(500 * 2 ** attempt, 8000), undefined, { signal });

function refused(
	status: number,
	data: unknown,
	requestId: string | undefined,
): CliError {
	const payload = data as {
		error?: string;
		details?: Record<string, unknown>;
	} | null;
	const failure = apiError(status, data, requestId, HELP);
	if (status !== 422) return failure;
	const reasons = Object.entries(payload?.details ?? {}).map(
		([field, messages]) =>
			`${field} ${Array.isArray(messages) ? messages.join(", ") : messages}`,
	);
	return {
		...error(
			"validation_error",
			`Upload refused: ${reasons.join("; ") || payload?.error || "invalid request"}.`,
			HELP,
			2,
		),
		...(failure.request_id ? { request_id: failure.request_id } : {}),
	};
}

const code = (data: unknown) => (data as { error?: unknown } | null)?.error;

// The API tells a client to come back in three cases: another request holds the
// same upload (409 upload_busy, told apart from 409 no_upload by its code),
// storage or processing hiccuped (502), or the request never arrived.
async function call(
	method: "GET" | "POST",
	key: string,
	path: string,
	body: unknown,
	signal: AbortSignal,
) {
	for (let attempt = 0; ; attempt++) {
		signal.throwIfAborted();
		const last = attempt === ATTEMPTS - 1;
		try {
			const answer = await importFetch(method, key, path, body, signal);
			const again =
				(answer.status === 409 && code(answer.data) === "upload_busy") ||
				[502, 503, 504].includes(answer.status);
			if (!again || last) return answer;
		} catch (cause) {
			if (signal.aborted || last) throw cause;
		}
		await backoff(attempt, signal);
	}
}

function missingParts(upload: Upload, size: number) {
	const count = Math.ceil(size / upload.part_size);
	const stored = new Map(
		upload.uploaded_parts.map((part) => [part.part_number, part.size]),
	);
	const parts: { number: number; start: number; length: number }[] = [];
	for (let number = 1; number <= count; number++) {
		const start = (number - 1) * upload.part_size;
		const length = Math.min(upload.part_size, size - start);
		// A part of the wrong size is from another file or a broken send: replace it.
		if (stored.get(number) !== length) parts.push({ number, start, length });
	}
	return parts;
}

async function partUrls(
	key: string,
	id: string,
	numbers: number[],
	signal: AbortSignal,
) {
	const answer = await call(
		"POST",
		key,
		`/admin/uploads/${id}/parts`,
		{ part_numbers: numbers },
		signal,
	);
	if (!answer.ok) throw refused(answer.status, answer.data, answer.requestId);
	const parts = (
		answer.data as { parts?: { part_number: number; url: string }[] } | null
	)?.parts;
	if (!Array.isArray(parts) || parts.length !== numbers.length)
		throw error("api_error", "The Bold API returned invalid part URLs.", HELP);
	return new Map(parts.map((part) => [part.part_number, part.url]));
}

export interface UploadOptions {
	key: string;
	/** Absolute or working-directory path of the file. */
	path: string;
	size: number;
	/** The start request: filename, size and metadata, with an external_id to resume by. */
	body: Record<string, unknown>;
	signal: AbortSignal;
	/** Shared by every file of a run, so memory holds a fixed number of parts. */
	slots: ReturnType<typeof limiter>;
	onBytes?: (bytes: number) => void;
}

export async function uploadFile(options: UploadOptions): Promise<Uploaded> {
	const { key, path, size, body, signal, slots } = options;

	const start = async () => {
		const answer = await call("POST", key, "/admin/uploads", body, signal);
		if (!answer.ok) throw refused(answer.status, answer.data, answer.requestId);
		const data = answer.data as {
			upload?: Upload | null;
			deduplicated?: boolean;
		};
		return {
			video: importVideo(answer.data),
			upload: data.upload ?? null,
			deduplicated: data.deduplicated === true,
		};
	};

	const started = await start();
	const { video, deduplicated } = started;
	let upload = started.upload;
	// Nothing left to send: the file is already in.
	if (!upload) return { video, sent: false, deduplicated };
	const id = String(video.internal_id);

	const file = await open(path, "r");
	try {
		const send = async (
			part: { number: number; start: number; length: number },
			url: string,
		) => {
			// One part in memory per slot; the rest of the file stays on disk.
			const bytes = Buffer.allocUnsafe(part.length);
			for (let read = 0; read < part.length; ) {
				const { bytesRead } = await file.read(
					bytes,
					read,
					part.length - read,
					part.start + read,
				);
				if (!bytesRead)
					throw error(
						"file_changed",
						"The file got shorter while it was being uploaded.",
						HELP,
					);
				read += bytesRead;
			}
			for (let attempt = 0; ; attempt++) {
				signal.throwIfAborted();
				try {
					const response = await fetch(url, {
						method: "PUT",
						body: bytes,
						signal: AbortSignal.any([
							signal,
							AbortSignal.timeout(PART_TIMEOUT),
						]),
					});
					await response.arrayBuffer();
					if (response.ok) break;
				} catch {
					signal.throwIfAborted();
				}
				if (attempt === ATTEMPTS - 1)
					throw error(
						"upload_failed",
						`Part ${part.number} could not be sent to storage.`,
						HELP,
					);
				await backoff(attempt, signal);
				// The URL may be the problem (they expire after an hour): get a new one.
				url = (await partUrls(key, id, [part.number], signal)).get(
					part.number,
				) as string;
			}
			options.onBytes?.(part.length);
		};

		for (let round = 0; ; round++) {
			const missing = missingParts(upload, size);
			for (let i = 0; i < missing.length; i += URL_BATCH) {
				const batch = missing.slice(i, i + URL_BATCH);
				const urls = await partUrls(
					key,
					id,
					batch.map((part) => part.number),
					signal,
				);
				const sent = await Promise.allSettled(
					batch.map((part) =>
						slots(() => send(part, urls.get(part.number) as string)),
					),
				);
				const broken = sent.find((result) => result.status === "rejected");
				if (broken) throw (broken as PromiseRejectedResult).reason;
			}

			const done = await call(
				"POST",
				key,
				`/admin/uploads/${id}/complete`,
				{ size },
				signal,
			);
			if (done.ok)
				return { video: importVideo(done.data), sent: true, deduplicated };
			if (round === 2) throw refused(done.status, done.data, done.requestId);

			if (done.status === 422 && code(done.data) === "incomplete_upload") {
				// Storage holds less than we sent: ask what it has and send the rest.
				const state = await call(
					"GET",
					key,
					`/admin/uploads/${id}`,
					undefined,
					signal,
				);
				if (!state.ok) throw refused(state.status, state.data, state.requestId);
				const current = (state.data as { upload?: Upload | null }).upload;
				if (!current)
					return { video: importVideo(state.data), sent: true, deduplicated };
				upload = current;
			} else if (done.status === 409 && code(done.data) === "no_upload") {
				// The upload on the storage side is gone (they expire): start over.
				const again = await start();
				if (!again.upload)
					return { video: again.video, sent: true, deduplicated };
				upload = again.upload;
			} else throw refused(done.status, done.data, done.requestId);
		}
	} finally {
		await file.close();
	}
}
