# Changelog

## Unreleased

- Tab completion: `completion bash|zsh|fish` prints a script that completes
  commands, flags, flag values, saved workspaces and file names, for `boldvideo`
  and `bold`. It reads local files only and never calls the API.
- Shorthands: `v` (videos), `c` (collections), `vw` (viewers), `i` (import),
  `ins` (insights), `s` (search), `a` (ask), `p` (profiles), `me` (whoami), and
  `ls`, `show`, `rm`, `edit`, `new`, `mv`, `yt`, `st`, `q`, `switch` for the
  commands under them. `--help` lists them; `help --json` carries them as `aliases`.
- A group run without a command lists: `boldvideo videos` is `boldvideo videos list`,
  and list flags work there (`bold v --privacy private`). `--help` still shows help.
- Short flags: `-h`, `-j` (`--json`), `-n` (`--limit`), `-y` (`--yes`),
  `-p` (`--profile`), `-v` (`--version`).
- `help --json` lists known values for a flag or argument as `choices`.
- Folder upload: `import dir <path>` uploads every video file in a folder
  (`--recursive`, `--include`, `--exclude`), and `import file <path>` uploads one.
  `--map meta.csv` sets title, date, type, tags, collection, privacy and
  external ID per file, over the same metadata flags as `import url`. A result
  CSV (`<map name>.results.csv`, or `--results`) records `status`, `bold_id`
  and `error_msg` per file. Running the same command again continues an
  interrupted run and uploads nothing twice. `--concurrency` sets the files in
  flight (default 3); `--wait` and `--dry-run` work as elsewhere.

## 0.1.0 — 2026-11-27

First release. Every command below is in the stability baseline
(`docs/baseline-0.1.0.md`): from here on, commands and flags are only added.

- Authentication: `login` signs in with your browser and saves one profile per
  workspace you approve; `-t`/`--tenant` runs one command in another workspace.
  `whoami`, `profiles list|use|remove`, `logout` (also ends the sign-in on the server).
  For servers and CI: `login --token` (`--token -` reads stdin) or `BOLDVIDEO_API_KEY`.
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
- The command is installed as `boldvideo` and as `bold`.
- Distribution: npm `boldvideo` with provenance, compatibility package
  `@boldvideo/cli`, standalone binaries with checksums, Homebrew tap, install script.

### Not in 0.1.0

Folder upload (`import dir`).
