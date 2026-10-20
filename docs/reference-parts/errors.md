## Error shape

On nonterminal stderr, failures produce exactly one newline-terminated JSON
object and no success output on stdout. For example, an unknown command returns
exit 2 and:

```json
{
  "code": "unknown_command",
  "message": "Unknown command 'hlep'.",
  "hint": "boldvideo help --help\nRead: boldvideo docs cli",
  "docs": "https://docs.boldvideo.com/cli#unknown-command"
}
```

`code` is stable snake_case; `message` is a single human-readable line; `hint`
names the next command to run; `docs` points to the relevant documentation.
`request_id` is an additional string when supplied by the API and is omitted
otherwise. Preserve it when reporting an API failure. Terminal stderr prints
the same fields as text. `--json` changes success output, not error formatting.
