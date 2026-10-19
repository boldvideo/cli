# Changelog

## 0.1.0 — Unreleased

Intended v0.1 surface. Most commands are still landing on sibling branches;
the current main baseline implements help and version only.

- Authentication: `login`, `whoami`, `profiles`.
- Import: `import youtube`, `import url`, `import dir`, with `--wait` for ingest.
- Videos: `videos list|get|transcript|update|publish|unpublish|delete`.
- Collections: `collections list|create|add|remove`.
- Viewers: `viewers list|get|sync|progress|memory`.
- Answers and discovery: `ask`, `search`.
- Insights: `insights questions`.
- Raw API access: `api`.
- Reference: `docs`, `help`, `help --json`, `help exit-codes`, `--version`.
- JSON output when piped, structured errors and stable exit codes.
- Tag-triggered npm publishing with provenance and a GitHub release tarball.
