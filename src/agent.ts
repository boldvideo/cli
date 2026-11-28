import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import onboarding from "../skills/boldvideo/recipes/customer-onboarding.md" with {
	type: "text",
};
import kajabi from "../skills/boldvideo/recipes/kajabi-migration.md" with {
	type: "text",
};
import digest from "../skills/boldvideo/recipes/weekly-questions-digest.md" with {
	type: "text",
};
import skill from "../skills/boldvideo/SKILL.md" with { type: "text" };

// What `boldvideo agent setup` puts in front of a coding agent: the skill, for
// agents that load skills, and a short pointer in the project's instructions
// file, which every agent reads on every turn.

/** The skill as installed: the same files `npx skills add boldvideo/cli` copies. */
export const skillFiles: Record<string, string> = {
	"SKILL.md": skill,
	"recipes/customer-onboarding.md": onboarding,
	"recipes/kajabi-migration.md": kajabi,
	"recipes/weekly-questions-digest.md": digest,
};

/** Where agents look for skills, under a home directory or a project. */
export const skillHomes = [
	".claude/skills/boldvideo",
	".agents/skills/boldvideo",
];

const START = "<!-- boldvideo:start -->";
const END = "<!-- boldvideo:end -->";

/** The pointer. It is read on every turn, so every line has to earn its place. */
export const pointer = `${START}
## Bold

This project's video library lives in Bold. Reach it with the \`boldvideo\` CLI:

- **Import** recordings from YouTube, a URL or a local folder: \`boldvideo import --help\`
- **Ask** what the videos say, with cited timestamps: \`boldvideo ask\`, \`boldvideo search\`
- **Insights** into what members ask: \`boldvideo insights questions\`
- **Manage** videos, collections and viewers: \`boldvideo help --json\` lists every command and flag

Preview every write with \`--dry-run\`, then run it. \`boldvideo docs cli\` prints the full manual offline.
${END}`;

export type Action = "created" | "updated" | "unchanged" | "skipped";

export interface Change {
	path: string;
	action: Action;
	note?: string;
}

/** Copy the skill into one directory, touching only files that differ. */
export function installSkill(directory: string, write: boolean): Change {
	const existed = existsSync(directory);
	let changed = false;
	for (const [name, content] of Object.entries(skillFiles)) {
		const path = join(directory, name);
		if (existsSync(path) && readFileSync(path, "utf8") === content) continue;
		changed = true;
		if (!write) continue;
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}
	return {
		path: directory,
		action: !existed ? "created" : changed ? "updated" : "unchanged",
	};
}

/** The pointer goes between its markers, so a later run replaces it in place. */
export function withPointer(text: string): string {
	const start = text.indexOf(START);
	const end = text.indexOf(END);
	if (start >= 0 && end > start)
		return text.slice(0, start) + pointer + text.slice(end + END.length);
	return `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${pointer}\n`;
}

/**
 * Add the pointer to the project's instructions. AGENTS.md is the shared file;
 * CLAUDE.md gets it too unless it already pulls AGENTS.md in.
 */
export function writePointer(project: string, write: boolean): Change[] {
	const agents = join(project, "AGENTS.md");
	const claude = join(project, "CLAUDE.md");
	const read = (path: string) =>
		statSync(path, { throwIfNoEntry: false })?.isFile()
			? readFileSync(path, "utf8")
			: undefined;
	const existing = { [agents]: read(agents), [claude]: read(claude) };
	if (
		existing[agents] === undefined &&
		existing[claude] === undefined &&
		!existsSync(join(project, ".git"))
	)
		return [
			{
				path: agents,
				action: "skipped",
				note: "Not a project: no AGENTS.md, CLAUDE.md or .git here. Run this in a project to add the pointer.",
			},
		];
	const targets =
		existing[claude] === undefined ||
		(existing[agents] !== undefined && /AGENTS\.md/.test(existing[claude]))
			? [agents]
			: existing[agents] === undefined
				? [claude]
				: [agents, claude];
	return targets.map((path) => {
		const before = existing[path];
		const after = withPointer(before ?? "");
		if (write && after !== before) writeFileSync(path, after);
		return {
			path,
			action:
				before === undefined
					? "created"
					: after === before
						? "unchanged"
						: "updated",
		};
	});
}
