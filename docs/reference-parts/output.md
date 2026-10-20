### Output and safety contract

- Success is one JSON value on stdout when piped or when `--json` is passed;
  terminals receive readable text or tables. IDs are never truncated.
- Exception: `boldvideo docs <topic>` prints raw markdown even when piped.
  Use `--json` for an object with `url`, `title` and `markdown` instead.
- Lists accept `--limit` (default 20) and `--fields` (comma-separated or repeated).
  A page is `{ "items": [], "has_more": false }`; when more exists, `has_more`
  is true and `next` contains the exact command for the next page. Follow it
  explicitly; the CLI does not silently fetch the whole library.
- Progress and continuation hints go to terminal stderr only. `--debug` never
  dumps API keys. Nonempty `NO_COLOR` disables color; pipes never receive ANSI
  color escapes.
- Every write supports `--dry-run`. Destructive commands require `--yes` when
  stdin is not a terminal, including previews (`--dry-run --yes`). Preview first
  and check the target account with `boldvideo whoami` before applying a write.
- Ingest commands, when registered, expose `--wait`. Imports deduplicate on
  source URL so rerunning an import is safe.

To discover the exact installed surface as structured data:

```sh
boldvideo help --json
```
