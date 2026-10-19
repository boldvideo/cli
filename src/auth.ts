import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { request } from "./api";
import { error, registerSecret } from "./errors";

export interface Profiles {
	active: string | null;
	profiles: Record<string, { key: string }>;
}

export interface Credential {
	key: string;
	profile: string | null;
}

export interface Identity {
	account: { slug: string; name: string };
	key: { kind: "tenant" | "admin"; short_id: string };
	features: { viewers: boolean; viewer_memory: boolean; mcp: boolean };
}

function configDirectory(): string {
	return join(
		(process.platform === "win32"
			? process.env.APPDATA
			: process.env.XDG_CONFIG_HOME) || join(homedir(), ".config"),
		"boldvideo",
	);
}

export function loadProfiles(): Profiles {
	try {
		const data = JSON.parse(
			readFileSync(join(configDirectory(), "profiles.json"), "utf8"),
		) as Profiles;
		if (
			!data ||
			(data.active !== null && typeof data.active !== "string") ||
			!data.profiles ||
			typeof data.profiles !== "object" ||
			Array.isArray(data.profiles)
		)
			throw new Error("Invalid profiles");
		for (const profile of Object.values(data.profiles)) {
			if (!profile || typeof profile.key !== "string" || !profile.key)
				throw new Error("Invalid key");
			registerSecret(profile.key);
		}
		return data;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT")
			return { active: null, profiles: {} };
		throw error(
			"profile_error",
			"Could not read the profile file.",
			"Check the boldvideo config directory, then run boldvideo profiles list.",
		);
	}
}

export function saveProfiles(data: Profiles): void {
	const directory = configDirectory();
	let temporary: string | undefined;
	try {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		chmodSync(directory, 0o700);
		temporary = mkdtempSync(join(directory, ".profiles-"));
		const file = join(temporary, "profiles.json");
		writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
		renameSync(file, join(directory, "profiles.json"));
	} catch {
		throw error(
			"profile_error",
			"Could not save the profile file.",
			"Check permissions on the boldvideo config directory, then run boldvideo login.",
		);
	} finally {
		if (temporary) rmSync(temporary, { recursive: true, force: true });
	}
}

export function resolveKey(profile?: string): Credential {
	const key = process.env.BOLDVIDEO_API_KEY;
	if (key) {
		registerSecret(key);
		return { key, profile: null };
	}
	const stored = loadProfiles();
	const name = profile ?? stored.active;
	const saved =
		name !== null && Object.hasOwn(stored.profiles, name)
			? stored.profiles[name]
			: undefined;
	if (saved) return { key: saved.key, profile: name };
	throw error(
		"not_authenticated",
		profile === undefined
			? "No API key is configured."
			: `No key is stored for profile '${profile}'.`,
		"Set BOLDVIDEO_API_KEY or run boldvideo login --token <key>. Create a key in Bold: Settings → Developer.",
		3,
	);
}

// Keep the evolving /me wire format in one place.
function parseIdentity(data: unknown): Identity {
	const value = (data as { data?: Identity } | null)?.data;
	if (
		!value ||
		typeof value.account?.slug !== "string" ||
		!value.account.slug ||
		typeof value.account.name !== "string" ||
		(value.key?.kind !== "tenant" && value.key?.kind !== "admin") ||
		typeof value.key.short_id !== "string" ||
		typeof value.features?.viewers !== "boolean" ||
		typeof value.features.viewer_memory !== "boolean" ||
		typeof value.features.mcp !== "boolean"
	)
		throw error(
			"api_error",
			"The Bold API returned an invalid identity.",
			"boldvideo whoami",
		);
	return {
		account: { slug: value.account.slug, name: value.account.name },
		key: { kind: value.key.kind, short_id: value.key.short_id },
		features: {
			viewers: value.features.viewers,
			viewer_memory: value.features.viewer_memory,
			mcp: value.features.mcp,
		},
	};
}

export async function identity(key: string): Promise<Identity> {
	// TODO(bold-js): use the SDK when it exposes GET /me for both key kinds.
	return parseIdentity(await request("GET", "/me", { key }));
}
