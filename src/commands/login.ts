import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { identity, loadProfiles, saveProfiles } from "../auth";
import { error, registerSecret } from "../errors";
import { hint, output } from "../output";
import type { Command } from "../spec";

async function readToken(): Promise<string> {
	if (!process.stdin.isTTY) {
		let input = "";
		for await (const chunk of process.stdin) input += chunk;
		return input.trim();
	}
	// Readline handles editing and restores the terminal; its echo goes nowhere.
	const silent = new Writable({
		write(_chunk, _encoding, done) {
			done();
		},
	});
	const reader = createInterface({
		input: process.stdin,
		output: silent,
		terminal: true,
	});
	hint("API key (input hidden):");
	try {
		return await new Promise<string>((resolve, reject) => {
			const cancelled = () =>
				reject(error("usage_error", "Login cancelled.", "boldvideo login", 2));
			reader.once("SIGINT", cancelled);
			reader.once("close", cancelled);
			reader.question("", resolve);
		});
	} finally {
		reader.close();
		silent.end();
	}
}

export const login: Command = {
	name: "login",
	summary: "Verify an API key and save it as the active profile.",
	description:
		"Create keys in Bold: Settings → Developer. Omit --token to read stdin or prompt without echo. --profile names the saved profile; otherwise use the account slug. BOLDVIDEO_API_KEY still overrides saved profiles.",
	auth: "none",
	write: true,
	flags: [
		{
			name: "token",
			type: "string",
			description: "API key to verify and store; omit to read it privately.",
		},
	],
	examples: [
		{
			cmd: "boldvideo login",
			note: "Enter a key privately, or supply it through stdin.",
		},
		{
			cmd: "boldvideo login --token bold_demo_key_2026 --profile customer-demo",
			note: "Verify a key and activate a named profile.",
		},
	],
	seeAlso: ["boldvideo whoami", "boldvideo profiles list"],
	async run(ctx, _args, flags) {
		const key = (
			(flags.token as string | undefined) ?? (await readToken())
		).trim();
		registerSecret(key);
		if (!key)
			throw error(
				"not_authenticated",
				"No API key was supplied.",
				"Set BOLDVIDEO_API_KEY or run boldvideo login --token <key>. Create a key in Bold: Settings → Developer.",
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
	},
};
