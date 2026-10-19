import { chmod, copyFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Mode } from "./adapters";

export async function sandbox(
	root: string,
	binary: string,
	mode: Mode = "cold",
) {
	const bin = join(root, "bin");
	const system = join(root, "system");
	const home = join(root, "home");
	const cwd = join(root, "work");
	for (const dir of [bin, system, home, cwd]) await mkdir(dir);
	await copyFile(binary, join(bin, "boldvideo"));
	await chmod(join(bin, "boldvideo"), 0o755);
	for (const name of ["sh", "bash", "env", "node"]) {
		const executable = Bun.which(name);
		if (!executable) throw new Error(`Required runtime missing: ${name}`);
		await symlink(executable, join(system, name));
	}
	const env: Record<string, string> = {
		PATH: `${bin}:${system}`,
		HOME: home,
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_CACHE_HOME: join(home, ".cache"),
		CLAUDE_CONFIG_DIR: join(home, ".claude"),
		SHELL: join(system, "bash"),
		TMPDIR: root,
		NO_COLOR: "1",
	};
	for (const [key, value] of Object.entries(process.env))
		if (
			value &&
			/^(BOLDVIDEO_.*|ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|CLAUDE_CODE_OAUTH_TOKEN|AMP_API_KEY|AMP_URL|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/i.test(
				key,
			)
		)
			env[key] = value;
	const settings = join(root, "amp-settings.json");
	// Amp's public shell names and its internal async aliases must both be enabled.
	const shellTools = [
		"Bash",
		"shell_command",
		"shell_command_status",
		"shell_command_kill",
		"async_shell_command",
		"async_shell_command_status",
		"async_shell_command_kill",
	];
	if (mode === "one-search") shellTools.push("web_search");
	if (mode === "skill") {
		await mkdir(join(cwd, "skill"));
		await copyFile(
			join(import.meta.dir, "../skill/SKILL.md"),
			join(cwd, "skill/SKILL.md"),
		);
	}
	await writeFile(
		settings,
		JSON.stringify({
			"amp.tools.enable": shellTools,
			"amp.permissions": shellTools.map((tool) => ({ tool, action: "allow" })),
			"amp.mcpServers": {},
			"amp.updates.mode": "disabled",
			"amp.skills.disableClaudeCodeSkills": true,
			"amp.skills.disableGlobalAgentsSkills": true,
		}),
	);
	env.AMP_SETTINGS_FILE = settings;
	return { cwd, env };
}
