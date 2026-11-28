import { apiUrl } from "../api";
import { type Credential, identity } from "../auth";
import { output, table } from "../output";
import type { Command } from "../spec";

export const whoami: Command = {
	name: "whoami",
	aliases: ["me"],
	summary: "Show who is signed in, the account, key kind and profile.",
	description:
		"A null profile means BOLDVIDEO_API_KEY supplied the key. The API base URL comes from BOLDVIDEO_API_URL or the Bold production default.",
	examples: [
		{ cmd: "boldvideo whoami", note: "Check the current account." },
		{
			cmd: "boldvideo whoami --profile customer-demo --json",
			note: "Inspect a named profile without switching the default.",
		},
	],
	seeAlso: ["boldvideo login --help", "boldvideo profiles list"],
	async run(ctx) {
		const credential = ctx.credential as Credential;
		const me = await identity(credential.key);
		const result = {
			account_slug: me.account.slug,
			account_name: me.account.name,
			key_kind: me.key.kind,
			profile: credential.profile,
			api_url: apiUrl(),
			...(me.user ? { user: me.user.email } : {}),
		};
		output(result, table([result]), ctx.json);
	},
};
