import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseChecksums, writeChecksums } from "../scripts/checksums";

const fixture = await readFile("test/fixtures/checksums.txt", "utf8");
const formula = await readFile("packaging/homebrew/boldvideo.rb", "utf8");

test("checksum manifest uses sha256sum format and hashes every named binary", async () => {
	const directory = await mkdtemp(join(tmpdir(), "boldvideo-checksums-"));
	try {
		// Fixture hashes were independently computed with sha256sum for a\n through d\n.
		const names = fixture
			.trim()
			.split("\n")
			.map((line) => line.split("  ")[1]);
		for (const [index, name] of names.entries()) {
			if (!name) throw new Error("Invalid fixture");
			await writeFile(
				join(directory, name),
				`${String.fromCharCode(97 + index)}\n`,
			);
		}
		await writeChecksums(directory);
		expect(await readFile(join(directory, "checksums.txt"), "utf8")).toBe(
			fixture,
		);
		expect(Object.keys(parseChecksums(fixture))).toHaveLength(4);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test.each([
	["missing target", fixture.split("\n").slice(1).join("\n")],
	["duplicate target", fixture + fixture.split("\n")[0]],
	["invalid digest", fixture.replace("87428", "zzzzz")],
	[
		"unsafe filename",
		fixture.replace("boldvideo-darwin-arm64", "../boldvideo"),
	],
])("rejects a manifest with %s", (_, text) => {
	expect(() => parseChecksums(text ?? "")).toThrow();
});

test("formula updater matches each platform, accepts v tags, and is repeatable", async () => {
	const directory = await mkdtemp(join(tmpdir(), "boldvideo-formula-"));
	const path = join(directory, "boldvideo.rb");
	try {
		await writeFile(path, formula);
		for (const version of ["v2.3.4", "2.3.4"]) {
			const result = spawnSync(
				process.execPath,
				[
					"scripts/update-formula.ts",
					version,
					"test/fixtures/checksums.txt",
					path,
				],
				{ encoding: "utf8" },
			);
			expect(result.stderr).toBe("");
			expect(result.status).toBe(0);
			const updated = await readFile(path, "utf8");
			expect(updated).toContain('version "2.3.4"');
			for (const line of fixture.trim().split("\n")) {
				const [hash, name] = line.split("  ");
				expect(updated).toContain(`${name}"\n      sha256 "${hash}"`);
			}
			expect(updated.slice(updated.indexOf("  def install"))).toBe(
				formula.slice(formula.indexOf("  def install")),
			);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("invalid formula updates fail without modifying the formula", async () => {
	const directory = await mkdtemp(join(tmpdir(), "boldvideo-formula-"));
	const path = join(directory, "boldvideo.rb");
	const checksums = join(directory, "checksums.txt");
	try {
		for (const [version, manifest, template] of [
			["2.3.4-rc.1", fixture, formula],
			["2.3.4", fixture.split("\n").slice(1).join("\n"), formula],
			["2.3.4", fixture, formula.replace("boldvideo-linux-x64", "wrong-asset")],
		] as const) {
			await writeFile(path, template);
			await writeFile(checksums, manifest);
			const result = spawnSync(process.execPath, [
				resolve("scripts/update-formula.ts"),
				version,
				checksums,
				path,
			]);
			expect(result.status).not.toBe(0);
			expect(await readFile(path, "utf8")).toBe(template);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("installer checks downloads before replacing an existing installation", async () => {
	const directory = await mkdtemp(join(tmpdir(), "boldvideo install "));
	const tools = join(directory, "tools");
	const installed = join(directory, ".local/bin/boldvideo");
	try {
		await mkdir(tools);
		await writeFile(
			join(tools, "uname"),
			'#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n',
			{ mode: 0o755 },
		);
		await writeFile(
			join(tools, "curl"),
			`#!/bin/sh
set -eu
url= destination=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) destination=$2; shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  https://github.com/boldvideo/cli/releases/latest)
    printf 'https://github.com/boldvideo/cli/releases/tag/v0.1.0' ;;
  https://github.com/boldvideo/cli/releases/download/v0.1.0/checksums.txt)
    cp "$CHECKSUM_FIXTURE" "$destination" ;;
  https://github.com/boldvideo/cli/releases/download/v0.1.0/boldvideo-linux-x64)
    printf '%s\\n' "$DOWNLOAD_CONTENT" > "$destination" ;;
  *) exit 99 ;;
esac
`,
			{ mode: 0o755 },
		);
		for (const content of ["c", "tampered"]) {
			const result = spawnSync("sh", ["packaging/install.sh"], {
				encoding: "utf8",
				env: {
					...process.env,
					HOME: directory,
					PATH: `${tools}:${process.env.PATH}`,
					BOLDVIDEO_INSTALL_DIR: "",
					CHECKSUM_FIXTURE: resolve("test/fixtures/checksums.txt"),
					DOWNLOAD_CONTENT: content,
				},
			});
			if (content === "c") {
				expect(result.stderr).toBe("");
				expect(result.status).toBe(0);
				expect(result.stdout).toContain("to PATH");
			} else {
				expect(result.status).toBe(1);
				expect(result.stderr).toContain("Checksum verification failed");
			}
			expect(await readFile(installed, "utf8")).toBe("c\n");
			expect((await stat(installed)).mode & 0o777).toBe(0o755);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
