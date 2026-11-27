import pc from "picocolors";
import { request } from "../api";
import { identity, loadProfiles, saveProfiles } from "../auth";
import { mint } from "../brand";
import { browserLogin, type SignIn } from "../browser-login";
import { error, registerSecret } from "../errors";
import { output } from "../output";
import type { Command, Context, Flags } from "../spec";

async function readStdin(): Promise<string> {
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	return input.trim();
}

/** Verifies a key someone already holds and saves it as the active profile. */
async function tokenLogin(ctx: Context, flags: Flags, key: string) {
	registerSecret(key);
	if (!key)
		throw error(
			"not_authenticated",
			"No API key was supplied.",
			"Run boldvideo login to sign in with your browser, or pass a key with --token.",
			3,
		);
	const me = await identity(key);
	const name = (flags.profile as string | undefined) ?? me.account.slug;
	if (!name.trim())
		throw error(
			"usage_error",
			"Profile names must not be empty.",
			"boldvideo login --help",
			2,
		);
	const stored = loadProfiles();
	if (!flags["dry-run"])
		saveProfiles({
			active: name,
			profiles: { ...stored.profiles, [name]: { key } },
		});
	output(
		{
			profile: name,
			account: me.account,
			key_kind: me.key.kind,
			dry_run: flags["dry-run"],
		},
		flags["dry-run"]
			? `Would activate profile ${name}.`
			: `Active profile: ${name}.`,
		ctx.json,
	);
}

// Best effort: the count is a nicety on the welcome screen, never a reason to fail.
async function videoCount(key: string): Promise<number | undefined> {
	try {
		const page = (await request("GET", "/admin/videos", {
			key,
			query: { page: 1, page_size: 1 },
		})) as { meta?: { total_pages?: number } };
		return Number.isSafeInteger(page.meta?.total_pages)
			? page.meta?.total_pages
			: undefined;
	} catch {
		return undefined;
	}
}

function welcome(
	signIn: SignIn,
	active: string,
	names: Map<string, string>,
	videos?: number,
): string {
	const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
	const colors = pc.createColors(color);
	const lines = [
		"",
		`  ${mint("✓", color)} ${colors.bold("Signed in")} as ${signIn.user.email}`,
		"",
	];
	const [only] = signIn.workspaces;
	if (signIn.workspaces.length === 1 && only) {
		lines.push(
			`  ${colors.dim("Workspace  ")}${only.name} ${colors.dim(`· ${names.get(only.slug)}`)}`,
		);
		if (videos !== undefined)
			lines.push(`  ${colors.dim("Videos     ")}${videos}`);
		lines.push(
			"",
			`  ${colors.dim("Try")}`,
			"    boldvideo videos list",
			'    boldvideo ask "What do we say about pricing?"',
		);
	} else {
		const width = Math.max(...[...names.values()].map((name) => name.length));
		const nameWidth = Math.max(
			...signIn.workspaces.map((workspace) => workspace.name.length),
		);
		lines.push(`  ${colors.dim("Workspaces")}`);
		for (const workspace of signIn.workspaces) {
			const profile = names.get(workspace.slug) as string;
			const current = profile === active;
			lines.push(
				`  ${current ? mint("●", color) : " "} ${profile.padEnd(width)}   ${current ? `${workspace.name.padEnd(nameWidth)}   ${colors.dim("active")}` : workspace.name}`,
			);
		}
		const other = signIn.workspaces
			.map((workspace) => names.get(workspace.slug) as string)
			.find((profile) => profile !== active);
		if (other)
			lines.push(
				"",
				`  ${colors.dim("Switch     ")}boldvideo profiles use ${other}`,
				`  ${colors.dim("Just once  ")}boldvideo videos list -t ${other}`,
			);
	}
	lines.push("");
	return lines.join("\n");
}

/** Signs in through the browser and saves one profile per approved workspace. */
async function signIn(ctx: Context, flags: Flags) {
	if (flags["dry-run"])
		throw error(
			"usage_error",
			"--dry-run needs --token: a browser sign-in cannot be previewed.",
			"boldvideo login --help",
			2,
		);
	const result = await browserLogin({ openBrowser: !flags["no-browser"] });
	const [first] = result.workspaces;
	if (!first)
		throw error(
			"api_error",
			"The sign-in returned no workspace.",
			"boldvideo login",
		);
	// --profile names the profile when one workspace was approved; otherwise slugs.
	const custom = flags.profile as string | undefined;
	const names = new Map(
		result.workspaces.map((workspace) => [
			workspace.slug,
			result.workspaces.length === 1 && custom?.trim()
				? custom
				: workspace.slug,
		]),
	);
	const stored = loadProfiles();
	const profiles = { ...stored.profiles };
	for (const workspace of result.workspaces)
		profiles[names.get(workspace.slug) as string] = {
			key: workspace.key,
			name: workspace.name,
			user: result.user.email,
		};
	const signedIn = new Set(names.values());
	const active =
		stored.active !== null && signedIn.has(stored.active)
			? stored.active
			: (names.get(first.slug) as string);
	saveProfiles({ active, profiles });

	const current =
		result.workspaces.find(
			(workspace) => names.get(workspace.slug) === active,
		) ?? first;
	const terminal = Boolean(process.stdout.isTTY) && !ctx.json;
	const videos =
		terminal && result.workspaces.length === 1
			? await videoCount(current.key)
			: undefined;
	output(
		{
			profile: active,
			account: { slug: current.slug, name: current.name },
			key_kind: "admin",
			user: result.user,
			workspaces: result.workspaces.map((workspace) => ({
				profile: names.get(workspace.slug),
				slug: workspace.slug,
				name: workspace.name,
			})),
			dry_run: false,
		},
		welcome(result, active, names, videos),
		ctx.json,
	);
}

export const login: Command = {
	name: "login",
	summary: "Sign in with your browser, or verify and save an API key.",
	description:
		"Opens Bold in your browser to approve this terminal; each workspace you approve is saved as a profile named after its slug. No browser on this machine? The link and code are printed: open them anywhere. For servers and CI, pass a key with --token (--token - reads it from stdin), or set BOLDVIDEO_API_KEY, which overrides saved profiles. --profile names the saved profile.",
	auth: "none",
	write: true,
	flags: [
		{
			name: "token",
			type: "string",
			description:
				"API key to verify and store instead of signing in with the browser; use - to read it from stdin.",
		},
		{
			name: "no-browser",
			type: "boolean",
			default: false,
			description: "Print the sign-in link without opening a browser.",
		},
	],
	examples: [
		{
			cmd: "boldvideo login",
			note: "Sign in with your browser.",
		},
		{
			cmd: "boldvideo login --token bold_demo_key_2026 --profile customer-demo",
			note: "Verify a key and activate a named profile.",
		},
	],
	seeAlso: ["boldvideo whoami", "boldvideo profiles list"],
	async run(ctx, _args, flags) {
		const token = flags.token as string | undefined;
		// `--token -` reads the key from stdin, so it never appears in a process list.
		if (token === "-") return tokenLogin(ctx, flags, await readStdin());
		if (token !== undefined) return tokenLogin(ctx, flags, token.trim());
		// Terminal or not: an agent without a terminal still gets the link to hand on.
		return signIn(ctx, flags);
	},
};
