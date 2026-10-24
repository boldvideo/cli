# Changelog

## 0.1.0 — 2026-10-24

First release. Every command below is in the stability baseline
(`docs/baseline-0.1.0.md`): from here on, commands and flags are only added.

- Authentication: `login --token`, `whoami`, `profiles list|use|remove`, `logout`.
  Keys come from `BOLDVIDEO_API_KEY` or a saved profile.
- Import: `import youtube` and `import url` with metadata flags and `--wait`,
  `import status`, `import cancel` (cancel stops new dispatch; the current batch drains).
- Videos: `videos list|get|transcript|update|publish|unpublish|delete`.
  Transcripts in txt, srt, vtt and json.
- Collections: `collections list|create|rename|add|remove|videos`.
- Viewers: `viewers list|get|sync|progress`, `viewers memory get|clear`.
- Insights: `insights questions`, the stream of what viewers ask.
- Answers and discovery: `ask` and `search` with cited video timestamps.
- Raw API access: `api`, an authenticated request against any endpoint.
- Reference: `docs` (the `cli` topic works offline), `help`, `help --json`,
  `help exit-codes`, `--version`, `upgrade`.
- JSON when piped or with `--json`, structured errors on stderr, stable exit codes.
- Distribution: npm `boldvideo` with provenance, compatibility package
  `@boldvideo/cli`, standalone binaries with checksums, Homebrew tap, install script.

### Not in 0.1.0

Folder upload (`import dir`) and browser login (device flow).
