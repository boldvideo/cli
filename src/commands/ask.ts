import { request } from "../api";
import { type Credential, identity } from "../auth";
import { hint } from "../output";
import type { Command } from "../spec";
import { type AiResult, outputAi } from "./ai-results";

export const ask: Command = {
	name: "ask",
	aliases: ["a"],
	summary: "Ask your library a question and show cited moments.",
	description:
		"Sources keep their original citation numbers. --limit bounds displayed sources, not retrieval; increasing it regenerates the answer.",
	list: true,
	args: [
		{ name: "prompt", description: "Question to ask your video library." },
	],
	flags: [
		{
			name: "collection",
			type: "string",
			description: "Restrict the question to this collection ID or slug.",
		},
		{
			name: "as",
			type: "string",
			description: "Personalize for a viewer UUID or external ID.",
		},
		{
			name: "conversation",
			type: "string",
			description: "Continue this conversation ID.",
		},
		{
			name: "no-sources",
			type: "boolean",
			default: false,
			description: "Omit sources from output; JSON reports the omitted count.",
		},
	],
	examples: [
		{
			cmd: 'boldvideo ask "How should I price my first workshop?" --collection paid-workshops',
			note: "Ask a collection and show timestamped sources.",
		},
		{
			cmd: 'boldvideo ask "What should I try next?" --as customer-1042 --conversation 8f92bc73-391c-45e1-908d-b6acb7ba02fb',
			note: "Continue a personalized conversation.",
		},
	],
	seeAlso: ["boldvideo search --help", "boldvideo whoami"],
	async run(ctx, args, flags) {
		const { key } = ctx.credential as Credential;
		const body = {
			prompt: args[0],
			stream: false,
			...(flags.collection ? { collection_id: flags.collection } : {}),
			...(flags.as ? { viewer: flags.as } : {}),
			...(flags.conversation ? { conversation_id: flags.conversation } : {}),
		};
		if (flags.as && !(await identity(key)).features.viewers)
			hint(
				"Warning: this account has viewers disabled; --as will be ignored. Check the viewers account setting, then run boldvideo whoami.",
			);
		// TODO(bold-js): use the SDK when it forwards viewer and preserves structured AI errors.
		const result = (await request("POST", "/ai/chat", {
			key,
			body,
		})) as AiResult;
		outputAi(result, ctx, args, flags);
	},
};
