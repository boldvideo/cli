import { apiUrl } from "../api";
import { loadProfiles, saveProfiles } from "../auth";
import { error } from "../errors";
import { output, outputList } from "../output";
import type { Command, Context, Flags } from "../spec";

// Ends a browser sign-in on the server too. Other keys answer 403 and stay valid;
// offline or not, the local profile is removed either way.
async function endSession(key: string): Promise<void> {
	try {
		await fetch(`${apiUrl()}/cli/session`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		// Best effort.
	}
}

async function remove(
	ctx: Context,
	args: string[],
	flags: Flags,
): Promise<void> {
	const stored = loadProfiles();
	const name =
		args[0] ??
		((flags.tenant ?? flags.profile) as string | undefined) ??
		stored.active;
	if (name === null || !Object.hasOwn(stored.profiles, name))
		throw error(
			"not_found",
			"No matching stored profile exists.",
			"boldvideo profiles list",
			4,
		);
	if (!flags["dry-run"]) {
		const key = stored.profiles[name]?.key;
		if (key) await endSession(key);
		delete stored.profiles[name];
		if (stored.active === name) stored.active = null;
		saveProfiles(stored);
	}
	output(
		{ profile: name, removed: !flags["dry-run"], dry_run: flags["dry-run"] },
		flags["dry-run"]
			? `Would remove profile ${name}.`
			: `Removed profile ${name}.`,
		ctx.json,
	);
}

export const logout: Command = {
	name: "logout",
	summary: "Sign out: remove the active stored profile and end its sign-in.",
	description:
		"A browser sign-in is also ended on the server. --profile removes that profile instead. Environment variables are unchanged; unset BOLDVIDEO_API_KEY separately. Removing the active profile leaves no active profile.",
	auth: "none",
	destructive: true,
	examples: [
		{ cmd: "boldvideo logout --yes", note: "Remove the active stored key." },
		{
			cmd: "boldvideo logout --profile customer-demo --dry-run --yes",
			note: "Preview removing a named profile.",
		},
	],
	seeAlso: ["boldvideo login --help", "boldvideo profiles list"],
	run: remove,
};

export const profiles: Command = {
	name: "profiles",
	summary: "List, switch and remove stored account profiles.",
	auth: "none",
	examples: [
		{ cmd: "boldvideo profiles list", note: "Find saved accounts." },
		{
			cmd: "boldvideo profiles use customer-demo",
			note: "Switch the default account.",
		},
	],
	seeAlso: ["boldvideo login --help", "boldvideo whoami"],
	subcommands: [
		{
			name: "list",
			summary: "List saved profile names without exposing keys.",
			auth: "none",
			list: true,
			flags: [
				{
					name: "offset",
					type: "number",
					default: 0,
					description: "Start at this profile (nonnegative integer).",
				},
			],
			examples: [
				{
					cmd: "boldvideo profiles list",
					note: "Show saved profiles and the active default.",
				},
				{
					cmd: "boldvideo profiles list --limit 5 --fields name,active",
					note: "Read a bounded page of profile names.",
				},
			],
			seeAlso: ["boldvideo profiles use --help", "boldvideo login --help"],
			run(_ctx, _args, flags) {
				const stored = loadProfiles();
				const offset = Number(flags.offset);
				const limit = Number(flags.limit);
				if (!Number.isSafeInteger(offset) || offset < 0)
					throw error(
						"usage_error",
						"--offset must be a nonnegative integer.",
						"boldvideo profiles list --help",
						2,
					);
				const names = Object.keys(stored.profiles).sort();
				const fields = flags.fields as string[] | undefined;
				const next =
					offset + limit < names.length
						? `boldvideo profiles list --offset ${offset + limit} --limit ${limit}${fields?.length ? ` --fields '${fields.join(",").replaceAll("'", "'\\''")}'` : ""}${flags.json ? " --json" : ""}`
						: undefined;
				outputList(
					names
						.slice(offset, offset + limit)
						.map((name) => ({ name, active: name === stored.active })),
					flags,
					next,
				);
			},
		},
		{
			name: "use",
			summary: "Make a saved profile the default for future commands.",
			description:
				"BOLDVIDEO_API_KEY takes precedence even after switching the stored default.",
			auth: "none",
			write: true,
			args: [{ name: "name", description: "Stored profile name." }],
			examples: [
				{
					cmd: "boldvideo profiles use customer-demo",
					note: "Switch to a demo account.",
				},
				{
					cmd: "boldvideo profiles use production --dry-run",
					note: "Preview switching to production.",
				},
			],
			seeAlso: ["boldvideo profiles list", "boldvideo whoami"],
			run(ctx, args, flags) {
				const stored = loadProfiles();
				const name = args[0] as string;
				if (!Object.hasOwn(stored.profiles, name))
					throw error(
						"not_found",
						`Profile '${name}' does not exist.`,
						"boldvideo profiles list",
						4,
					);
				if (!flags["dry-run"]) saveProfiles({ ...stored, active: name });
				output(
					{ profile: name, dry_run: flags["dry-run"] },
					flags["dry-run"]
						? `Would activate profile ${name}.`
						: `Active profile: ${name}.`,
					ctx.json,
				);
			},
		},
		{
			name: "remove",
			summary: "Remove a saved profile and its key.",
			auth: "none",
			destructive: true,
			args: [{ name: "name", description: "Stored profile name." }],
			examples: [
				{
					cmd: "boldvideo profiles remove customer-demo --yes",
					note: "Remove a demo account's key.",
				},
				{
					cmd: "boldvideo profiles remove production --dry-run --yes",
					note: "Preview removing a production profile.",
				},
			],
			seeAlso: ["boldvideo profiles list", "boldvideo logout --help"],
			run: remove,
		},
	],
};
