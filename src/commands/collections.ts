import { request } from "../api";
import type { Credential } from "../auth";
import { error } from "../errors";
import { hint, output, outputList, table } from "../output";
import type { Command, Context, Flags } from "../spec";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function list(ctx: Context, args: string[], flags: Flags) {
	const offset = Number(flags.offset);
	const limit = Number(flags.limit);
	if (!Number.isSafeInteger(offset) || offset < 0)
		throw error(
			"usage_error",
			"--offset must be a nonnegative integer.",
			`boldvideo collections ${ctx.path.at(-1)} --help`,
			2,
		);
	if (limit > 1000)
		throw error(
			"usage_error",
			"--limit must not exceed 1000.",
			`boldvideo collections ${ctx.path.at(-1)} --help`,
			2,
		);
	const videos = ctx.path.at(-1) === "videos";
	const path = videos
		? `/collections/${encodeURIComponent(args[0] as string)}/videos`
		: "/collections";
	const key = (ctx.credential as Credential).key;
	// TODO(bold-js): use the SDK when it exposes collection reads.
	const page = (await request("GET", path, {
		key,
		query: { limit, offset },
	})) as { data: Record<string, unknown>[] };
	// These endpoints have no pagination metadata. Probe only full pages so the
	// continuation is accurate even when the last page is exactly limit items.
	const more =
		page.data.length === limit &&
		(
			(await request("GET", path, {
				key,
				query: { limit: 1, offset: offset + limit },
			})) as { data: unknown[] }
		).data.length > 0;
	const next = more
		? `boldvideo collections ${videos ? `videos ${quote(args[0] as string)}` : "list"} --offset ${offset + limit} --limit ${limit}${(flags.fields as string[] | undefined)?.length ? ` --fields ${quote((flags.fields as string[]).join(","))}` : ""}${flags.profile ? ` --profile ${quote(flags.profile as string)}` : ""}${flags.json ? " --json" : ""}`
		: undefined;
	const defaultTable =
		!ctx.json && !(flags.fields as string[] | undefined)?.length;
	outputList(
		defaultTable && !videos
			? page.data.map((item) => ({ ...item, videos: item.video_count }))
			: page.data,
		{
			...flags,
			fields: defaultTable
				? videos
					? ["id", "title"]
					: ["id", "name", "slug", "videos"]
				: flags.fields,
		},
		next,
	);
}

async function write(
	ctx: Context,
	flags: Flags,
	method: string,
	path: string,
	body: Record<string, unknown>,
) {
	if (flags["dry-run"]) {
		const preview = { dry_run: true, method, path, body };
		output(preview, `Would ${method} ${path}\n${table([body])}`, ctx.json);
		return;
	}
	// TODO(bold-js): use the SDK when it exposes admin collection writes.
	const result = (await request(method, path, {
		key: (ctx.credential as Credential).key,
		body,
	})) as {
		data: Record<string, unknown>;
		existing?: boolean;
		membership_count?: number;
		already_member_ids?: string[];
	};
	if (result.existing) hint("Collection already exists.");
	output(
		result,
		result.membership_count === undefined
			? table([result.data], ["id", "name", "slug"])
			: table([
					{
						membership_count: result.membership_count,
						already_member_ids: result.already_member_ids?.join(", "),
					},
				]),
		ctx.json,
	);
}

const offsetFlag = {
	name: "offset",
	type: "number" as const,
	default: 0,
	description: "Start at this result (nonnegative integer).",
};

export const collections: Command = {
	name: "collections",
	summary: "Organize the video library into collections.",
	examples: [
		{
			cmd: "boldvideo collections list",
			note: "Find collections in the library.",
		},
		{
			cmd: 'boldvideo collections create "Customer workshops"',
			note: "Create a collection for customer workshops.",
		},
	],
	seeAlso: ["boldvideo whoami", "boldvideo collections list --help"],
	subcommands: [
		{
			name: "list",
			summary: "List collections, including empty collections.",
			list: true,
			flags: [offsetFlag],
			examples: [
				{
					cmd: "boldvideo collections list",
					note: "Show the first page of collections.",
				},
				{
					cmd: "boldvideo collections list --limit 5 --fields id,name,video_count",
					note: "Select collection fields for a bounded page.",
				},
			],
			seeAlso: [
				"boldvideo collections videos --help",
				"boldvideo collections create --help",
			],
			run: list,
		},
		{
			name: "create",
			summary: "Create a collection or return the existing collection by name.",
			auth: "admin",
			write: true,
			args: [{ name: "name", description: "Collection name." }],
			flags: [
				{
					name: "parent",
					type: "string",
					description: "Parent collection UUID or slug.",
				},
			],
			examples: [
				{
					cmd: 'boldvideo collections create "Customer workshops"',
					note: "Create a root collection.",
				},
				{
					cmd: 'boldvideo collections create "Pricing lessons" --parent customer-workshops --dry-run',
					note: "Preview a nested collection.",
				},
			],
			seeAlso: [
				"boldvideo collections list",
				"boldvideo collections rename --help",
			],
			async run(ctx, args, flags) {
				let parent = flags.parent as string | undefined;
				if (parent && !flags["dry-run"]) {
					// TODO(bold-js): resolve parent slugs to the UUID required by admin writes.
					const result = (await request(
						"GET",
						`/collections/${encodeURIComponent(parent)}`,
						{
							key: (ctx.credential as Credential).key,
						},
					)) as { data: { id: string } };
					parent = result.data.id;
				}
				await write(ctx, flags, "POST", "/admin/collections", {
					name: args[0],
					...(parent ? { parent_id: parent } : {}),
				});
			},
		},
		{
			name: "rename",
			summary: "Rename a collection without changing its memberships.",
			auth: "admin",
			write: true,
			args: [
				{ name: "id", description: "Collection UUID or slug." },
				{ name: "name", description: "New collection name." },
			],
			examples: [
				{
					cmd: 'boldvideo collections rename customer-workshops "Customer training"',
					note: "Rename a collection by slug.",
				},
				{
					cmd: 'boldvideo collections rename 8c36b95c-7be2-4b7e-bf63-2ee639f7a246 "Advanced lessons" --dry-run',
					note: "Preview a rename by UUID.",
				},
			],
			seeAlso: [
				"boldvideo collections list",
				"boldvideo collections create --help",
			],
			run: (ctx, args, flags) =>
				write(
					ctx,
					flags,
					"PATCH",
					`/admin/collections/${encodeURIComponent(args[0] as string)}`,
					{ name: args[1] },
				),
		},
		...(["add", "remove"] as const).map(
			(action): Command => ({
				name: action,
				summary:
					action === "add"
						? "Add videos to a collection without duplicating memberships."
						: "Remove collection memberships without deleting videos.",
				description:
					"When no video arguments are given, read one video UUID, hashid or slug per line from piped stdin.",
				auth: "admin",
				write: true,
				args: [
					{ name: "collection", description: "Collection UUID or slug." },
					{
						name: "video",
						description: "Video UUIDs, hashids or slugs; otherwise read stdin.",
						required: false,
						variadic: true,
					},
				],
				examples: [
					{
						cmd: `boldvideo collections ${action} customer-workshops pricing-masterclass onboarding-basics`,
						note: `${action === "add" ? "Add" : "Remove"} two video memberships.`,
					},
					{
						cmd: `boldvideo collections ${action} customer-workshops aB12cD34 --dry-run`,
						note: "Preview a membership change using a video hashid.",
					},
				],
				seeAlso: [
					"boldvideo collections videos --help",
					"boldvideo collections list",
				],
				async run(ctx, args, flags) {
					let ids = args.slice(1);
					if (!ids.length && !process.stdin.isTTY) {
						process.stdin.setEncoding("utf8");
						let input = "";
						for await (const chunk of process.stdin) input += chunk;
						ids = input
							.split(/\r?\n/)
							.map((line) => line.trim())
							.filter(Boolean);
					}
					if (!ids.length)
						throw error(
							"usage_error",
							"Provide video IDs as arguments or one per line on stdin.",
							`boldvideo collections ${action} --help`,
							2,
						);
					await write(
						ctx,
						flags,
						action === "add" ? "POST" : "DELETE",
						`/admin/collections/${encodeURIComponent(args[0] as string)}/videos`,
						{ video_ids: ids },
					);
				},
			}),
		),
		{
			name: "videos",
			summary: "List videos in a collection.",
			list: true,
			args: [{ name: "collection", description: "Collection UUID or slug." }],
			flags: [offsetFlag],
			examples: [
				{
					cmd: "boldvideo collections videos customer-workshops",
					note: "Browse a collection's videos.",
				},
				{
					cmd: "boldvideo collections videos customer-workshops --limit 5 --fields id,title",
					note: "Select video identifiers and titles.",
				},
			],
			seeAlso: [
				"boldvideo collections add --help",
				"boldvideo collections remove --help",
			],
			run: list,
		},
	],
};
