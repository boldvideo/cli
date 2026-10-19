# Changelog

## 0.1.0 — Unreleased

Intended v0.1 surface. Most commands are still landing on sibling branches;
the current main baseline implements help and version only.

- Authentication: `login`, `whoami`, `profiles`.
- Import: `import youtube`, `import url`, with `--wait` for ingest.
- Videos: `videos list|get|transcript|publish|unpublish|delete`.
- Answers and discovery: `ask`, `search`.
- Raw API access: `api`.
- Reference: `docs`, `help`, `help --json`, `help exit-codes`, `--version`.
- JSON output when piped, structured errors and stable exit codes.
- Tag-triggered npm publishing with provenance and a GitHub release tarball.
- Compatibility npm package `@boldvideo/cli`, forwarding to the same binary.
- Additions-only command and flag baseline generated from `help --json`.

### Not included in the 0.1.0 cut yet

Video edits (`videos update`), collections, folder import (`import dir`),
viewers, and insights are not included unless their branches merge before the
release cut. Branch existence does not mean a feature ships. Reconcile this
list and the generated baseline with the final merged registry before tagging.
