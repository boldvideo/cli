# boldvideo

The command-line door to [Bold](https://boldvideo.com), for operators and their coding agents.

```sh
npx boldvideo import youtube https://www.youtube.com/@takimoore --wait
npx boldvideo ask "What does Taki say about paid workshops versus free webinars?"
```

## Install

After the first publication, choose in this order:

```sh
# 1. npx: use Node 22+ without a global install
npx --yes boldvideo@latest --help

# 2. Homebrew: managed standalone binary, no Node required
brew install boldvideo/tap/boldvideo

# 3. Install script: no Node or Homebrew (URL not yet live)
curl -fsSL https://boldvideo.com/install.sh | sh
```

See [installation requirements and release status](docs/install.md). Global npm
installation is also available for Node users: `npm install -g boldvideo`.
Run `boldvideo upgrade` to print the right upgrade command for your installation;
it never upgrades or replaces files itself. Use `--no-check` to stay offline.

Everything the admin UI can do, from a shell. JSON when piped, tables when not. `--help` on every command, with examples that work.

Status: pre-release. Commands land one at a time; see `boldvideo --help` for what exists today.

## Requirements and current commands

Node **22 or newer** is required for npx/npm, but not standalone installations.
Version 0.1.0 implements `--version`, `--help`, `help --json`, `help exit-codes`
and `upgrade`; the import and ask examples above
describe the planned interface, not commands available in this release.

Help and version are JSON when piped, like every other success response. In a
terminal they print readable text. Read the [command contract](docs/contract.md)
for streams, exit codes, pagination, write safety and the auth integration point.

## Development

Use Bun 1.3.10 and TypeScript 6. Terminal tests use the platform's `script`
utility: util-linux on Linux or the built-in BSD version on macOS. CI runs the
suite on both platforms.

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun test
bun run check
bun run ci:lint
npm pack
npx ./boldvideo-0.1.0.tgz --version
npx ./boldvideo-0.1.0.tgz --help
```

The Node-targeted build is one bundled executable; end users do not need Bun or
TypeScript. CI smoke-tests the packed package on Node 22 and 24. No publish
workflow for npm is configured; the tag-triggered binary release pipeline is
prepared but has not been run. See [install paths and release preparation](docs/install.md)
for npx, Homebrew, and the install script (not yet live).
Dependency declaration checking is skipped because Bun
and Node ambient declarations overlap; all source and tests remain strict.

MIT.
