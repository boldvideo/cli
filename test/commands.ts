import { writeFileSync } from "node:fs";
import { apiError } from "../src/errors";
import { hint, output, outputList } from "../src/output";
import type { Command } from "../src/spec";
import apiFailure from "./fixtures/api-error.json";

// These commands are bundled only into the test runner, never the published entry.
export const fixture: Command = {
	name: "fixture",
	summary: "Exercise the CLI contract without network access.",
	examples: [
		{ cmd: "boldvideo fixture --help", note: "Inspect test commands." },
		{
			cmd: "boldvideo fixture list --limit 2",
			note: "Read a bounded test page.",
		},
	],
	seeAlso: ["boldvideo --help"],
	subcommands: [
		{
			name: "list",
			summary: "List recorded workshop videos.",
			list: true,
			flags: [
				{
					name: "offset",
					type: "number",
					default: 0,
					description: "Start at this record.",
				},
			],
			examples: [
				{
					cmd: "boldvideo fixture list --limit 2 --fields id,title",
					note: "Select API fields.",
				},
				{
					cmd: "boldvideo fixture list --offset 20",
					note: "Read the final page.",
				},
			],
			seeAlso: ["boldvideo fixture --help"],
			run(_ctx, _args, flags) {
				const items = Array.from({ length: 23 }, (_, i) => ({
					id: `workshop-recording-${i + 1}`,
					title: `Paid workshops ${i + 1}`,
					published_at: "2026-10-19",
				}));
				const offset = Number(flags.offset);
				const limit = Number(flags.limit);
				const next =
					offset + limit < items.length
						? `boldvideo fixture list --offset ${offset + limit} --limit ${limit}${(flags.fields as string[] | undefined)?.length ? ` --fields ${(flags.fields as string[]).join(",")}` : ""}`
						: undefined;
				outputList(items.slice(offset, offset + limit), flags, next);
			},
		},
		{
			name: "delete",
			summary: "Delete a test video.",
			destructive: true,
			args: [{ name: "video", description: "Video ID or slug." }],
			flags: [
				{
					name: "reason",
					type: "string",
					required: true,
					description: "Reason for removing the video.",
				},
			],
			examples: [
				{
					cmd: 'boldvideo fixture delete paid-workshops --reason "Duplicate recording" --dry-run --yes',
					note: "Preview deletion.",
				},
				{
					cmd: 'boldvideo fixture delete paid-workshops --reason "Duplicate recording" --yes',
					note: "Confirm deletion.",
				},
			],
			seeAlso: ["boldvideo fixture list --help"],
			run(ctx, args, flags) {
				if (!flags["dry-run"] && process.env.BOLDVIDEO_TEST_WRITE)
					writeFileSync(process.env.BOLDVIDEO_TEST_WRITE, args[0] ?? "");
				output(
					{ id: args[0], dry_run: flags["dry-run"] },
					flags["dry-run"] ? "Would delete video." : "Deleted video.",
					ctx.json,
				);
			},
		},
		{
			name: "echo",
			summary: "Exercise typed flags and redacted output.",
			write: true,
			args: [{ name: "title", description: "Workshop title." }],
			flags: [
				{
					name: "rating",
					type: "number",
					default: 2.5,
					description: "Workshop rating.",
				},
				{ name: "tags", type: "list", description: "Workshop tags." },
			],
			examples: [
				{
					cmd: 'boldvideo fixture echo "Paid workshops" --rating=-3.5 --tags sales,coaching --tags pricing',
					note: "Parse typed values.",
				},
				{
					cmd: "boldvideo fixture echo -- --private-workshop",
					note: "Pass a title beginning with a dash.",
				},
			],
			seeAlso: ["boldvideo fixture --help"],
			run(ctx, args, flags) {
				if (ctx.debug) hint(`Debug title: ${args[0]}`);
				output(
					{ title: args[0], rating: flags.rating, tags: flags.tags },
					args[0] ?? "",
					ctx.json,
				);
			},
		},
		{
			name: "fail",
			summary: "Format a recorded API error.",
			flags: [
				{
					name: "status",
					type: "number",
					default: 403,
					description: "HTTP status to translate.",
				},
				{
					name: "internal",
					type: "boolean",
					default: false,
					description: "Throw an unexpected error.",
				},
				{
					name: "request-id",
					type: "string",
					description: "Request ID from the response header.",
				},
			],
			examples: [
				{
					cmd: "boldvideo fixture fail --status 401",
					note: "Simulate missing authentication.",
				},
				{
					cmd: "boldvideo fixture fail --status 404",
					note: "Simulate a missing video.",
				},
			],
			seeAlso: ["boldvideo help exit-codes"],
			run(_ctx, _args, flags) {
				if (flags.internal)
					throw new Error(
						`Unexpected failure: ${process.env.BOLDVIDEO_API_KEY ?? "no key"}`,
					);
				throw apiError(
					Number(flags.status),
					apiFailure,
					flags["request-id"] as string | undefined,
				);
			},
		},
	],
};
