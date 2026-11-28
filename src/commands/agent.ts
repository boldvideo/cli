import { homedir } from "node:os";
import { join } from "node:path";
import { type Change, installSkill, skillHomes, writePointer } from "../agent";
import { output, table } from "../output";
import type { Command } from "../spec";

export const agent: Command = {
	name: "agent",
	summary: "Set up coding agents to run this library.",
	auth: "none",
	examples: [
		{
			cmd: "boldvideo agent setup",
			note: "Install the skill and add a pointer to this project's instructions.",
		},
		{
			cmd: "boldvideo agent setup --dry-run",
			note: "See which files it would write.",
		},
	],
	seeAlso: ["boldvideo help --json", "boldvideo docs cli"],
	subcommands: [
		{
			name: "setup",
			summary:
				"Install the boldvideo skill and point this project's agent at the CLI.",
			description:
				"Does two things, and running it again brings both up to date. It installs the boldvideo skill, as shipped with this version, into ~/.claude/skills and ~/.agents/skills, where Claude Code, Codex, Cursor, Gemini CLI and Amp load skills from. And it adds a short section to the instructions file in the current directory, between <!-- boldvideo:start --> and <!-- boldvideo:end --> markers: AGENTS.md, and CLAUDE.md when that file does not already pull AGENTS.md in. Text outside the markers is never touched. Outside a project (no AGENTS.md, CLAUDE.md or .git) the section is skipped. Start a new agent session afterwards.",
			auth: "none",
			write: true,
			flags: [
				{
					name: "project",
					type: "boolean",
					default: false,
					description:
						"Install the skill into this project (.claude/skills, .agents/skills) to commit it for the team, instead of your home directory.",
				},
				{
					name: "no-skill",
					type: "boolean",
					default: false,
					description: "Leave the skill alone; only write the instructions.",
				},
				{
					name: "no-instructions",
					type: "boolean",
					default: false,
					description:
						"Leave AGENTS.md and CLAUDE.md alone; only install the skill.",
				},
			],
			examples: [
				{
					cmd: "boldvideo agent setup",
					note: "Install the skill for you and add the pointer to this project.",
				},
				{
					cmd: "boldvideo agent setup --project --dry-run",
					note: "Preview a team install that lives in the repository.",
				},
			],
			seeAlso: ["boldvideo help --json", "boldvideo docs cli"],
			run(ctx, _args, flags) {
				const write = !flags["dry-run"];
				const project = process.cwd();
				const base = flags.project ? project : homedir();
				const skill: Change[] = flags["no-skill"]
					? []
					: skillHomes.map((home) => installSkill(join(base, home), write));
				const instructions: Change[] = flags["no-instructions"]
					? []
					: writePointer(project, write);
				output(
					{ ...(write ? {} : { dry_run: true }), skill, instructions },
					table(
						[
							...skill.map((change) => ({ what: "skill", ...change })),
							...instructions.map((change) => ({
								what: "instructions",
								...change,
							})),
						].map((row) => ({
							what: row.what,
							action: write ? row.action : `${row.action} (dry run)`,
							path: row.path,
							note: row.note ?? "",
						})),
					),
					ctx.json,
				);
			},
		},
	],
};
