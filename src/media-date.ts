import { type FileHandle, open } from "node:fs/promises";

// When a recording was made, read from the file itself. MP4 and QuickTime files
// (mp4, m4v, mov, 3gp, 3g2) carry a creation time in their movie header; cameras,
// phones and Zoom fill it in, and it survives copying and downloading, which a
// file's modified time often does not.

const CONTAINERS = /\.(mp4|m4v|mov|3gp|3g2)$/i;
/** Seconds between 1904-01-01, where these containers count from, and 1970-01-01. */
const EPOCH_1904 = 2_082_844_800;
const EARLIEST = Date.UTC(1990, 0, 1);

interface Box {
	type: string;
	/** Where the box's content starts and where the box ends. */
	start: number;
	end: number;
}

async function findBox(
	file: FileHandle,
	from: number,
	to: number,
	type: string,
): Promise<Box | undefined> {
	const head = Buffer.alloc(16);
	// A file is a short list of boxes; anything longer is not one of these containers.
	for (let offset = from, seen = 0; offset + 8 <= to && seen < 256; seen++) {
		const { bytesRead } = await file.read(head, 0, 16, offset);
		if (bytesRead < 8) return;
		let length = head.readUInt32BE(0);
		let header = 8;
		if (length === 1) {
			if (bytesRead < 16) return;
			length = Number(head.readBigUInt64BE(8));
			header = 16;
		} else if (length === 0) length = to - offset;
		if (length < header || offset + length > to) return;
		if (head.toString("latin1", 4, 8) === type)
			return { type, start: offset + header, end: offset + length };
		offset += length;
	}
}

/** The recording date inside the file, or undefined when it has none worth trusting. */
export async function recordedAt(path: string): Promise<Date | undefined> {
	if (!CONTAINERS.test(path)) return;
	let file: FileHandle | undefined;
	try {
		file = await open(path, "r");
		const { size } = await file.stat();
		const movie = await findBox(file, 0, size, "moov");
		const header =
			movie && (await findBox(file, movie.start, movie.end, "mvhd"));
		if (!header) return;
		const bytes = Buffer.alloc(12);
		if ((await file.read(bytes, 0, 12, header.start)).bytesRead < 12) return;
		// Version 1 headers hold 64-bit times; version 0 holds 32-bit ones.
		const seconds =
			bytes[0] === 1 ? Number(bytes.readBigUInt64BE(4)) : bytes.readUInt32BE(4);
		const time = (seconds - EPOCH_1904) * 1000;
		// Many encoders write zero (1904) or nonsense. A date from before digital
		// video or from the future is not a recording date.
		if (time < EARLIEST || time > Date.now() + 86_400_000) return;
		return new Date(time);
	} catch {
		// A file that cannot be read here fails later, where the upload reports it.
		return;
	} finally {
		await file?.close();
	}
}
