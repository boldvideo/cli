# AGENTS.md

How this repo is built, in the order an agent needs it.

## What this is

`boldvideo` is one binary that does everything the Bold admin UI can, built so an agent with a shell and nothing else can run a video library. `--help` is the only documentation a cold agent gets, so help text is product, not decoration.

One name everywhere: the binary, the npm package, the docs term and the env prefix are all `boldvideo`. No alias, no second name.

## Stack (decided 2026-10-19, do not relitigate inside a ticket)

- TypeScript, strict. ESM only.
- Runtime floor: Node 22. Stated in `package.json` `engines` and in the README.
- Package manager: pnpm. Same as `@boldvideo/bold-js`.
- Build: tsup, one bundled file at `dist/boldvideo.js` with a shebang. Cold start of `boldvideo --version` stays under 300 ms.
- Tests: `node --test`. No test framework.
- Arg parsing: `node:util.parseArgs`. No CLI framework. Commands are plain data (see below) and a small dispatcher walks them.
- Color: `picocolors`. Honors `NO_COLOR` and non-TTY automatically.
- Tables: a hand-written column padder in `src/output.ts`. No table library.
- API client: `@boldvideo/bold-js` for what it covers. `boldvideo api` uses `fetch` directly because its job is arbitrary paths. If a curated command needs an endpoint bold-js lacks, call `fetch` through `src/api.ts` for now and leave a `// TODO(bold-js)` so it can move into the SDK; do not block a command on an SDK release.
- Standalone binaries and Homebrew come later (BOLD-2048) via `bun build --compile` or Node SEA. Nothing in this repo should make that harder; nothing should prepare for it either.

Dependencies are a cost. Before adding one, ask whether thirty lines of our own code would do. Usually yes.

## Commands are data

Every command is one object in `src/commands/<group>.ts` following the shape in `src/spec.ts`: name, one-line purpose, flags (with type, default, description), exactly two copy-paste examples with realistic values, and a `run` function. Help text, `boldvideo help --json`, the docs reference and the example tests all read that one object. Nothing is written twice.

Grammar is `boldvideo <noun> <verb>`. Three verbs sit at the top level because they are the main path: `import`, `ask`, `search`.

```
boldvideo login | whoami | profiles
boldvideo import youtube|url <src> [--collection] [--title --published-at --type --tags --privacy] [--wait]
boldvideo import dir <path> [--map meta.csv]
boldvideo videos list|get|transcript|update|publish|unpublish|delete
boldvideo collections list|create|add|remove
boldvideo viewers list|get|sync|progress|memory
boldvideo ask "<prompt>" [--collection] [--as <viewer>]
boldvideo search "<query>"
boldvideo insights questions --since 7d
boldvideo api <METHOD> <path>
boldvideo docs [topic]
```

## Contracts every command keeps

- Output: JSON when stdout is not a terminal or `--json` is passed, and nothing else on stdout. Readable tables when it is a terminal. `--json`, `--fields`, `--limit` on every list. Bounded by default; when more exists, say so and print the exact next command.
- Errors: one JSON object on stderr (text on a terminal) with a stable `code`, a one-line `message`, a `hint` naming the next command to run, and a `docs` URL. The API's request ID is included when present.
- Exit codes: documented and stable. `boldvideo help exit-codes` prints the table.
- Progress, spinners, hints: stderr only, suppressed when stderr is not a terminal.
- Async: anything that goes through ingest takes `--wait`.
- Re-runs: imports dedupe on source URL. Running a command twice is safe.
- Safety: `--dry-run` on every write. `--yes` required for destructive calls when stdin is not a terminal.
- IDs: UUID, hashid or slug accepted everywhere. Never truncated in output.
- Auth: `BOLDVIDEO_API_KEY` wins over stored profiles. `BOLDVIDEO_API_URL` overrides the base URL. The key never appears in any output, including `--debug`.
- Base URL: `https://app.boldvideo.io/api/v1`. OpenAPI: `https://app.boldvideo.io/api/openapi`.

The full contract lives in `docs/contract.md` and is enforced by tests every command runs through automatically.

## Help text is tuned by evals

Help wording is measured against a cold-agent task suite (project milestone M3). Do not reword help or error text without a failing eval transcript as the reason. Examples use realistic values, never `foo` or a bare `<id>`.

## Taste

Write the code DHH would merge, with the pragmatism of Dave Thomas and the data-first simplicity of Rich Hickey. Concretely:

- No abstractions for one caller. No plugin systems, no DI, no base classes. Functions and plain objects.
- Small files named after what they hold. A reader should find any command by its name in the file tree.
- Errors are values with a code; throw them at the edge, format them once in `src/errors.ts`.
- Tests exercise the built CLI through its public behavior (argv in, stdout/stderr/exit code out), plus unit tests where logic is dense. Record API responses as fixtures under `test/fixtures/`; no network in tests.
- Prettier and the TypeScript compiler are the linters. No ESLint config to maintain.
- If a ticket's acceptance criteria and this file disagree, this file wins; say so in the PR.

## Checks

```sh
pnpm install
pnpm build          # tsup → dist/boldvideo.js
pnpm test           # node --test, runs against dist
pnpm typecheck      # tsc --noEmit
pnpm format         # prettier --write
node dist/boldvideo.js --help
```

CI runs build, typecheck, test and format check on every pull request, and smoke-runs `npx` from a packed tarball on Node 22 and 24.

## Working here

- Branch per Linear ticket, named `bold-<number>-<slug>`. One PR per ticket. The PR title starts with the ticket ID.
- Commits: plain, imperative, no attribution trailers.
- Do not publish to npm from a laptop. Publishing happens from CI on a version tag.
