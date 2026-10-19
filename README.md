# boldvideo

The command-line door to [Bold](https://boldvideo.com), for operators and their coding agents.

```sh
npx boldvideo import youtube https://www.youtube.com/@takimoore --wait
npx boldvideo ask "What does Taki say about paid workshops versus free webinars?"
```

Install once:

```sh
npm install -g boldvideo
export BOLDVIDEO_API_KEY=...   # Settings → Developer in your Bold account
boldvideo --help
```

Everything the admin UI can do, from a shell. JSON when piped, tables when not. `--help` on every command, with examples that work.

Status: pre-release. Commands land one at a time; see `boldvideo --help` for what exists today.

## Requirements and current commands

Node **22 or newer** is required. Version 0.1.0 implements only `--version`,
`--help`, `help --json` and `help exit-codes`; the import and ask examples above
describe the planned interface, not commands available in this release.

Help and version are JSON when piped, like every other success response. In a
terminal they print readable text. Read the [command contract](docs/contract.md)
for streams, exit codes, pagination, write safety and the auth integration point.

## Development

Use Bun 1.3.10 and TypeScript 6. Linux terminal tests also use `script` from
util-linux (included on the CI runners).

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
workflow is configured. Dependency declaration checking is skipped because Bun
and Node ambient declarations overlap; all source and tests remain strict.

MIT.
