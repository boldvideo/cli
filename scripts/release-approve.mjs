// Approve a staged release in one go: find what the Release run staged for this
// version, show it, approve `boldvideo` and then `@boldvideo/cli`, check npm, and
// start the Smoke workflow. A person runs this; CI can only stage.
//
//   bun run release:approve            the version in package.json
//   bun run release:approve 0.2.1      another version
//   bun run release:approve --dry-run  show what would be approved, change nothing
//   bun run release:approve --yes      skip the Enter prompt
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes");
const version =
	args.find((arg) => !arg.startsWith("-")) ??
	JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `v${version}`;
const repo = "boldvideo/cli";
// The alias depends on this exact version of boldvideo, so boldvideo goes first.
const order = ["boldvideo", "@boldvideo/cli"];

const fail = (message) => {
	console.error(`✋ ${message}`);
	process.exit(1);
};
const gh = (...command) =>
	execFileSync("gh", command, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
// `npm stage` needs npm 11.15 or newer; npx fetches one whatever is installed.
const npm = (command, options = {}) =>
	spawnSync("npx", ["--yes", "npm@latest", ...command], {
		encoding: "utf8",
		...options,
	});

const runs = JSON.parse(
	gh(
		"run",
		"list",
		"--repo",
		repo,
		"--workflow",
		"release.yml",
		"--branch",
		tag,
		"--event",
		"push",
		"--limit",
		"1",
		"--json",
		"databaseId,conclusion,status,headSha,url",
	),
);
const [run] = runs;
if (!run) fail(`No Release run for ${tag}. Has the tag been pushed?`);
if (run.status !== "completed")
	fail(`The Release run for ${tag} is still going: ${run.url}`);
if (run.conclusion !== "success")
	fail(`The Release run for ${tag} did not succeed: ${run.url}`);

// The staging job prints one line per package: "+ name@version (staged with id …)".
const log = gh("run", "view", String(run.databaseId), "--repo", repo, "--log");
const staged = new Map(
	[...log.matchAll(/\+ (\S+)@(\d[^\s@]*) \(staged with id ([0-9a-f-]{36})\)/g)]
		.filter(([, , found]) => found === version)
		.map(([, name, , id]) => [name, id]),
);
const missing = order.filter((name) => !staged.has(name));
if (missing.length)
	fail(`The run staged no ${missing.join(" or ")} at ${version}: ${run.url}`);

const live = (name) =>
	npm(["view", `${name}@${version}`, "version"]).stdout.trim() === version;

console.log(`Staged by ${run.url}`);
console.log(`Built from ${run.headSha.slice(0, 7)} (${tag})\n`);
for (const name of order)
	console.log(
		`  ${name}@${version}  ${staged.get(name)}${live(name) ? "  (already on npm)" : ""}`,
	);
console.log("");
if (dryRun) {
	console.log("Dry run: nothing approved.");
	process.exit(0);
}
if (!yes) {
	const prompt = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	await prompt.question("Enter publishes both to npm. Ctrl+C stops. ");
	prompt.close();
}

for (const name of order) {
	if (live(name)) {
		console.log(`${name}@${version} is already on npm.`);
		continue;
	}
	// Inherit the terminal so npm can ask for a passkey or a code if it wants one.
	const approved = npm(["stage", "approve", staged.get(name)], {
		stdio: "inherit",
	});
	if (approved.status !== 0)
		fail(
			`npm did not approve ${name}@${version}. Nothing after it was published.`,
		);
	// The registry can take a few seconds to serve what it just accepted.
	for (let tries = 0; !live(name); tries++) {
		if (tries === 12)
			fail(
				`${name}@${version} was approved but npm does not serve it yet. Check, then run this again.`,
			);
		await new Promise((resolve) => setTimeout(resolve, 5000));
	}
	console.log(`✓ ${name}@${version} is on npm.`);
}

gh(
	"workflow",
	"run",
	"smoke.yml",
	"--repo",
	repo,
	"--ref",
	"main",
	"-f",
	`version=${version}`,
);
console.log(
	`\nSmoke started for ${version}: gh run list --repo ${repo} --workflow smoke.yml --limit 1`,
);
