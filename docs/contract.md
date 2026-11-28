# boldvideo command contract

This contract applies to every command. The registered command objects in
`src/commands/` are the source of truth for command reference material; read them
with `boldvideo help --json`, rather than maintaining a second command reference.
The rules below govern shipped commands and future additions.

## Streams and color

- Success is one JSON value followed by a newline when stdout is not a terminal,
  or whenever `--json` is passed. No prose, ANSI escapes or progress on stdout in
  JSON mode. This includes help and version: piped `--version` returns
  `{"version":"0.2.0"}`; piped help returns command metadata.
- `insights questions --format md` explicitly selects Markdown even when piped
  for report exports; `--json` still takes precedence. Markdown is a question
  list, so it cannot combine with `--group-by` or `--fields` unless JSON is selected.
- Exception: `docs <topic>` prints raw markdown even when piped; `--json` wraps
  it as `{url, title, markdown}`. Its first line identifies the canonical page URL.
  `docs cli` renders the installed tree offline via `commandTreeToMarkdown(tree)` in `src/docs-markdown.ts`; known `docs` URLs append their `boldvideo docs <topic>` command to error hints.
- Exception: `completion` prints the shell script even when piped, because it is
  meant for `eval` or a file; `--json` wraps it as `{shell, script}`.
- Terminal output is plain text or a space-padded table with bold headers,
  two spaces between columns and no box drawing. Values and IDs are never
  truncated. Empty results without known columns say `No results.`.
- Progress, diagnostics and continuation hints go through `hint()` to stderr;
  they are dim and suppressed if stderr is not a terminal. `--debug` enables
  command diagnostics, not a raw credential-bearing dump. It never changes the
  success or error format.
  Viewer diagnostics must not include emails or traits; explicitly requested
  viewer records on stdout remain unchanged by `--debug`.
- Stdout and stderr detect terminals independently. `--json` controls success
  output; errors follow stderr's terminal status. A nonempty `NO_COLOR` disables
  color on both streams. Color conveys meaning: red error codes, cyan error
  hints, bold table headers. No color is emitted to pipes.
- Use `output()`, `outputList()` and `hint()`, not direct writes from commands.
  Their final output and the error formatter redact environment, stored and
  supplied login keys, including their JSON-escaped representations.
  `output(data, text, "text")` explicitly selects redacted text on any stream.

## Lists and identifiers

Set `list: true` on list commands. The dispatcher adds `--json`, `--limit` (a
positive safe integer, default **20**) and `--fields` (comma-separated or repeated
API field names). Shared flags must not be redeclared by a command.

The command requests at most `flags.limit` records from the API and passes that
page to `outputList(items, flags, next)`. The formatter projects `--fields` without
renaming API keys. It does not fetch, slice or guess API pagination. Commands must
supply the exact next shell command, preserving filters, fields and page size and
quoting user-controlled values. Omit `next` only when no more records exist.

```json
{"items":[{"id":"paid-workshops","title":"Paid workshops"}],"has_more":true,"next":"boldvideo videos list --limit 1 --cursor c_9d7a"}
```

This illustrates a future list command, not one shipped in 0.1.0. On the final
page `has_more` is false and `next` is absent. A terminal stderr receives
`More results: <exact next command>`. JSON stays bounded; commands must never
silently fetch an entire library. IDs remain API UUIDs, hashids or slugs, accepted
without local format restrictions and printed in full.

## Errors and exits

Throw the plain value from `error(code, message, hint, exitCode)` at a command
boundary. `src/main.ts` catches it, calls `writeError()` once and sets the process
exit code. Unexpected exceptions become `internal_error` with exit 1; stack
traces are not printed, including with `--debug`.

Nonterminal stderr receives exactly one newline-terminated JSON object:

```json
{"code":"unknown_command","message":"Unknown command 'hlep'.","hint":"boldvideo help --help\nRead: boldvideo docs cli","docs":"https://docs.boldvideo.com/cli#unknown-command"}
```

- `code`: stable snake_case; never depend on an API's mutable message.
- `message`: a single line (line breaks are flattened).
- `hint`: a runnable next command, not generic advice.
- `docs`: a URL under `https://docs.boldvideo.com/cli#...`.
- `request_id`: included when supplied by the API, omitted otherwise.

Terminal stderr prints the same fields on separate lines; the hint is visibly
set apart. Failures do not produce success output. `--json` does not change error
stream selection. Bulk video mutations are the exception: stdout contains one
result per supplied ID, including per-item errors. Any failed item produces a
single `bulk_failed` error on stderr with exit 1 and the failed IDs in its hint.

Batch sync is the exception: it emits one ordered result array with a standard
error object on each failed row, continues processing other rows, and exits 1 if
any row failed. Terminal output includes the action table and summary. Dry-run
reports planned actions without writing; it cannot predict server-side write
validation failures.

Sync never deletes by default. Explicit prune snapshots all viewer pages before
writes and matches against the input's external IDs. If any input row fails,
pruning is skipped. Deletion failures are reported individually and do not stop
the remaining deletions. Confirmed empty input prunes all viewers; dry-run plans
the same deletions without writing.

Bulk imports from stdin or `--from` are the partial-success exception: stdout
contains one ordered array of per-URL results, even for one URL. Successes have
`source_url`, `ok: true` and `video` or `run`; failures have `source_url`,
`ok: false` and `error` with the standard fields (without `exitCode`). Dry-run
successes contain `dry_run`, `method`, `path` and `body` instead. Every URL is
attempted sequentially, including repeated URLs. Any item failure produces an
aggregate `bulk_failed` error on stderr and exit 1 after all results are printed.
With `--wait`, each item's readiness wait has its own timeout; a timeout is a
per-item failure, not a reason to abandon the rest. Positional single-URL imports
retain their record output and specific failure exit codes. Input/authentication
and collection-resolution errors before processing remain command-wide failures.

`import <word>` without a subcommand routes by the word: an http(s) URL to
`import url`, an existing folder to `import dir`, an existing file to
`import file`; a word written like a path that does not exist goes to the file
commands, which report it. Output and exit codes are those of the command it
routed to, so scripts that need one shape name the command. A terminal's stderr
shows the chosen command; nothing is added to stdout. Subcommand names win over
a path of the same name.

Folder uploads (`import dir`) follow the same partial-success rule with one
object on stdout: `items`, one entry per file in map order and then path order,
and `results`, the result CSV's path when one is written. Each item has `file`
(the path inside the folder), `ok` and `status`: `uploaded`, `already_uploaded`,
`failed`, `missing` (in the map, not in the folder) or `skipped` (in the map
and on disk, but not selected). Successes carry `video`, failures `error` with
the standard fields. Dry-run prints `dry_run: true` and items with `action`
(`upload`, `missing` or `skipped`), `size` and the start request as `body`. An
item whose publication date came from the file (`--published-at source`) also
has `published_at_from`: `recorded` or `modified`. Any
failed or missing file produces one `bulk_failed` error on stderr and exit 1
after every file was attempted; its hint is the command to run again. A map
that cannot be used (unknown column, invalid value) is a `usage_error` before
anything is sent. `import file` keeps the single-record output and specific
exit codes of a positional import. Ctrl-C exits 130 with `interrupted`; parts
already sent stay, and the same command continues from them.

`apiError(status, body, requestId?, hint?)` translates an HTTP response into this
value. Pass the response header's request ID when available; otherwise the
adapter uses `body.request_id`. It reads `body.error.message` for nested errors
or `body.message` for flat errors, keeping CLI codes determined by HTTP status. Auth/API
commands remain responsible for making requests and adapting any SDK-specific
exception shape; `src/api.ts` handles fetch responses.

| Exit | Meaning | Codes currently used |
| --- | --- | --- |
| 0 | Success | — |
| 1 | General failure | `internal_error`, `api_error` |
| 2 | Usage error | `usage_error`, `unknown_command`, `confirmation_required` |
| 3 | Not authenticated or not permitted | `not_authenticated` (401), `not_permitted` (403) |
| 4 | Not found | `not_found` (404) |
| 5 | Timed out while waiting | `timed_out` (408/504, or a command's wait deadline) |

Other HTTP failures use exit 1. `boldvideo help exit-codes` displays the same exit
meanings from `src/exit-codes.ts`.

## Writes and asynchronous work

- `write: true` or `destructive: true` automatically adds boolean `--dry-run` and
  `--yes`, both false by default. `destructive: true` implies a write for flags.
- A boolean flag may declare `destructive: true` on a `write: true` command.
  Confirmation is then required only when that flag is set (for example, sync
  `--prune`), not for other invocations of the same command.
- Before running a destructive handler, the dispatcher requires `--yes` when
  stdin is not a terminal. This also applies to previews: use `--dry-run --yes`.
  Help never requires confirmation. The refusal hint reproduces the original
  invocation with shell quoting and adds `--yes` before any `--` terminator.
- The handler must honor `flags["dry-run"]`: describe the intended action without
  issuing a write. The dispatcher cannot infer a command's mutation boundary.
- Any ingest operation must expose `--wait`. Imports deduplicate by source URL;
  rerunning an import must be safe. Those behaviors land with their commands.

## Help, parsing and examples

`src/spec.ts` defines plain command data: name, one-line summary, optional
description, positional args, typed flags, exactly two `{ cmd, note }` examples,
related command invocations, optional list/write/destructive markers, subcommands
and `run(ctx, args, flags)`. Groups can omit `run`; invoking one then displays its
help. The help group has a handler because `help --json` returns the whole tree.

Positionals are required unless marked `required: false`. A final argument marked
`variadic: true` accepts all remaining positionals and appears as `id...` in help.
Bulk video mutations make it optional so IDs can also come from piped stdin, one
per line, when no positional IDs are supplied. With the bounded list envelope,
use `boldvideo videos list --json | jq -r '.items[].internal_id' | boldvideo videos publish`.
Flag types are
`string`, `number`, `boolean` and `list`; defaults and required flags are enforced
by the dispatcher. Number values must be finite. Following `node:util.parseArgs`,
use `--rating=-3.5` for a negative flag value, and `--` before a positional that
starts with a dash. Shared boolean flags may precede the command; put
command-specific value flags after the command path. Group-specific flags are
not implicitly inherited by children.

No arguments and `--help` show the same index (at most 40 lines). The index lists
one row per registered top-level command, prioritizing `import`, `ask`, `search`
once those commands exist. Groups list only their immediate children, not the
entire descendant tree. Command help includes synopsis, flags with types and
defaults (`—` means unset), arguments, exactly two examples and related commands.
The root is a compact index; its two examples remain in JSON metadata.

`test/contract.test.ts` recursively checks every registered command for complete
metadata, shared flags, flag-name collisions, valid examples and JSON/text help.
Examples are tokenized and passed to the actual parser without executing a
handler. Test-only command objects exercise effects and errors in a separately
bundled runner; they are absent from `dist/boldvideo.js` and the tarball. API
errors use a synthetic fixture; tests require no network. Terminal tests use
the platform's `script` utility (util-linux on Linux, BSD on macOS) for real
pseudo-terminals, with platform-specific arguments confined to the test helper.

Import `run(argv, options)` from `test/run.ts` for all process-based tests.
It takes a full executable argv and asynchronously returns
`{ status, stdout, stderr }`, allowing loopback servers to keep responding.
Options are `env`, `tty`, `columns`, `stderr: "tty" | "pipe"`, and `input`. `waitFor` delays
input until a stdout prompt appears. For shell continuation commands, pass
`["sh", "-c", command]`. Suites supply their isolated config directories through
`env`. Keep all `script` spawning and platform handling in this helper.

Examples must be realistic and copy-pasteable, never `foo` or placeholders like
`<id>`. After this initial baseline, help and error wording change only in
response to a failing cold-agent eval transcript.

## Authentication

Commands default to `auth: "any"`. The dispatcher resolves a credential before
calling the handler and supplies it as `ctx.credential`. Set `auth: "admin"` to
check the live `/me` identity before the handler can write. Set `auth: "none"` on
local commands such as login, help and profile management. Help and version
always work without credentials. Auth requirements are not inherited by children.

`src/auth.ts` exports:

- `resolveKey(profile?)`: environment key, then explicit profile, then active
  profile; returns `{ key, profile }`, with `profile: null` for environment auth.
  An explicit missing profile never falls back to another stored profile.
- `loadProfiles()` / `saveProfiles(data)`: read and atomically replace
  `profiles.json` under `$XDG_CONFIG_HOME/boldvideo`, `~/.config/boldvideo`, or
  `%APPDATA%/boldvideo` on Windows. POSIX modes are 0700 for the directory and
  0600 for the file. The shape is `{ active: string | null, profiles: { [name]:
  { key: string } } }`. Corrupt files fail without being overwritten.
- `identity(key)`: fetch and parse `/me`; its wire-format adapter is isolated
  in `parseIdentity`, which unwraps `data`. The response from BOLD_admin PR #717
  is recorded in `test/fixtures/me.json`; callers still receive `Identity` directly.
- `Credential`, `Profiles`, `Identity`: the types for those return values.

Login verifies the supplied key, saves it under the account slug (or `--profile`)
and activates that profile. With no token flag it reads piped stdin or prompts
without echo. Profile switching does not override `BOLDVIDEO_API_KEY`. Removing
the active profile clears the default rather than silently switching accounts.
Logout removes a stored key, not an environment variable. All local writes
support dry-run; logout and profile removal require `--yes` on piped stdin.

`src/api.ts` exports `apiUrl()` and
`request(method, path, { key, body?, query? })`. Requests use Bearer auth, stay
under the API base URL, refuse redirects, parse JSON (null for empty responses),
and translate HTTP errors and request IDs through `apiError`. A request times
out after 30 seconds with exit 5. `BOLDVIDEO_API_URL` overrides
`https://app.boldvideo.io/api/v1`. OpenAPI is at
`https://app.boldvideo.io/api/openapi`.

Never log credentials, request headers or SDK error objects. Load
`@boldvideo/bold-js` inside commands that need it, never in the dispatcher or at
module top level. SDK-uncovered endpoints use `request` with a `// TODO(bold-js)`
comment at the call site. Tests use fixtures and a loopback server, never the
live API. BOLD-2013 still owns deployment of `/me`. Missing, invalid, revoked
or expired keys and inactive accounts all return HTTP 401, which maps to
`not_authenticated`, exit 3, and the same setup hint as missing local credentials.
