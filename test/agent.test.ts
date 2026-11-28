import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pointer, skillFiles, withPointer } from "../src/agent";

// Every test starts node processes; this machine may be busy.
setDefaultTimeout(60_000);

// The CLI reports the working directory as the system resolves it.
const temporary = realpathSync(mkdtempSync(join(tmpdir(), "boldvideo-agent-")));
const built = resolve("dist/boldvideo.js");
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

let places = 0;
/** A home directory and a project, each empty unless files are given. */
function place(files: Record<string, string> = { ".git/HEAD": "" }) {
	const root = join(temporary, `place-${++places}`);
	const home = join(root, "home");
	const project = join(root, "project");
	mkdirSync(home, { recursive: true });
	mkdirSync(project, { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(project, name, ".."), { recursive: true });
		writeFileSync(join(project, name), content);
	}
	const run = (...args: string[]) => {
		const result = Bun.spawnSync(["node", built, "agent", "setup", ...args], {
			cwd: project,
			env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" },
		});
		return {
			status: result.exitCode,
			stderr: result.stderr.toString(),
			data: JSON.parse(result.stdout.toString() || "null") as {
				dry_run?: boolean;
				skill: { path: string; action: string }[];
				instructions: { path: string; action: string; note?: string }[];
			},
		};
	};
	const read = (path: string) => readFileSync(join(root, path), "utf8");
	return { root, home, project, run, read };
}
const actions = (changes: { action: string }[]) =>
	changes.map((change) => change.action);

test("the shipped skill is the one in the repository, named after its folder", () => {
	for (const [name, content] of Object.entries(skillFiles))
		expect(content, name).toBe(
			readFileSync(join("skills/boldvideo", name), "utf8"),
		);
	expect(skillFiles["SKILL.md"]).toMatch(
		/^---\nname: boldvideo\ndescription: .+\n---\n/,
	);
	// Every recipe the skill points at is installed with it.
	for (const [, link] of (skillFiles["SKILL.md"] ?? "").matchAll(
		/\]\((recipes\/[^)]+)\)/g,
	))
		expect(Object.keys(skillFiles)).toContain(link as string);
});

test("setup installs the skill for both kinds of agent and adds the pointer; again changes nothing", () => {
	const { run, read, home, project } = place();
	const first = run();
	expect(first.stderr).toBe("");
	expect(first.status).toBe(0);
	expect(first.data.skill).toEqual([
		{ path: join(home, ".claude/skills/boldvideo"), action: "created" },
		{ path: join(home, ".agents/skills/boldvideo"), action: "created" },
	]);
	expect(first.data.instructions).toEqual([
		{ path: join(project, "AGENTS.md"), action: "created" },
	]);
	for (const agents of [".claude", ".agents"])
		for (const [name, content] of Object.entries(skillFiles))
			expect(read(`home/${agents}/skills/boldvideo/${name}`)).toBe(content);
	expect(read("project/AGENTS.md")).toBe(`${pointer}\n`);
	const second = run();
	expect(actions(second.data.skill)).toEqual(["unchanged", "unchanged"]);
	expect(actions(second.data.instructions)).toEqual(["unchanged"]);
});

test("a later version replaces its own section and files, and nothing else", () => {
	const mine = "# House rules\n\nUse pnpm.\n";
	const { run, read, home } = place({
		"AGENTS.md": `${mine}\n<!-- boldvideo:start -->\nold words\n<!-- boldvideo:end -->\n\n## After\n\nKeep me.\n`,
	});
	mkdirSync(join(home, ".claude/skills/boldvideo"), { recursive: true });
	writeFileSync(
		join(home, ".claude/skills/boldvideo/SKILL.md"),
		"an old skill",
	);
	writeFileSync(join(home, ".claude/skills/boldvideo/notes.md"), "mine");
	const result = run();
	expect(actions(result.data.skill)).toEqual(["updated", "created"]);
	expect(actions(result.data.instructions)).toEqual(["updated"]);
	expect(read("project/AGENTS.md")).toBe(
		`${mine}\n${pointer}\n\n## After\n\nKeep me.\n`,
	);
	expect(read("home/.claude/skills/boldvideo/SKILL.md")).toBe(
		skillFiles["SKILL.md"] as string,
	);
	expect(read("home/.claude/skills/boldvideo/notes.md")).toBe("mine");
	// Text without the section gets it at the end, one blank line apart.
	expect(withPointer(mine)).toBe(`${mine}\n${pointer}\n`);
});

test("the pointer goes where the project's agents read: AGENTS.md, and CLAUDE.md unless it pulls AGENTS.md in", () => {
	const only = place({ "CLAUDE.md": "# Claude\n" });
	expect(only.run().data.instructions).toEqual([
		{ path: join(only.project, "CLAUDE.md"), action: "updated" },
	]);
	expect(existsSync(join(only.project, "AGENTS.md"))).toBe(false);

	const both = place({ "CLAUDE.md": "# Claude\n", "AGENTS.md": "# Agents\n" });
	expect(actions(both.run().data.instructions)).toEqual(["updated", "updated"]);
	expect(both.read("project/CLAUDE.md")).toContain(pointer);

	const linked = place({
		"CLAUDE.md": "@AGENTS.md\n",
		"AGENTS.md": "# Agents\n",
	});
	expect(linked.run().data.instructions).toEqual([
		{ path: join(linked.project, "AGENTS.md"), action: "updated" },
	]);
	expect(linked.read("project/CLAUDE.md")).toBe("@AGENTS.md\n");
});

test("outside a project the skill is installed and no instructions file appears", () => {
	const { run, project } = place({});
	const result = run();
	expect(actions(result.data.skill)).toEqual(["created", "created"]);
	expect(result.data.instructions).toEqual([
		{
			path: join(project, "AGENTS.md"),
			action: "skipped",
			note: expect.stringContaining("Not a project"),
		},
	]);
	expect(existsSync(join(project, "AGENTS.md"))).toBe(false);
});

test("--dry-run writes nothing; --project, --no-skill and --no-instructions narrow the work", () => {
	const { run, home, project } = place();
	const plan = run("--dry-run");
	expect(plan.data.dry_run).toBe(true);
	expect(actions(plan.data.skill)).toEqual(["created", "created"]);
	expect(actions(plan.data.instructions)).toEqual(["created"]);
	expect(existsSync(join(home, ".claude"))).toBe(false);
	expect(existsSync(join(project, "AGENTS.md"))).toBe(false);

	const team = run("--project", "--no-instructions");
	expect(team.data.instructions).toEqual([]);
	expect(team.data.skill.map((change) => change.path)).toEqual([
		join(project, ".claude/skills/boldvideo"),
		join(project, ".agents/skills/boldvideo"),
	]);
	expect(existsSync(join(home, ".claude"))).toBe(false);
	expect(existsSync(join(project, ".agents/skills/boldvideo/SKILL.md"))).toBe(
		true,
	);

	const words = run("--no-skill");
	expect(words.data.skill).toEqual([]);
	expect(actions(words.data.instructions)).toEqual(["created"]);
});
