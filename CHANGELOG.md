# Changelog

## 0.2.2 — 2026-11-28

- Fixed: `videos update`, `publish`, `unpublish` and `delete` reported
  `api_error` although the change had been made. The admin API answers with the
  video inside a `data` envelope, and the CLI only read a bare record. A change
  that 0.2.1 reported as failed was applied; check with `videos get`.
- Fixed: `videos get` with an admin key printed that envelope (`{"data": …}`)
  where it documents the record itself.
- `import file` and `import dir` now report the real `ready` state for a file
  that was already uploaded.

## 0.2.1 — 2026-11-28

- Fixed: every `import` command (`youtube`, `url`, `dir`, `file`, `status`,
  `cancel`) was refused with `not_authenticated: Unauthorized`. They sent the key
  only as a Bearer token; the admin API reads it from `X-Bold-Admin-Api-Key`.
  0.2.0 cannot import; upgrade.
- A verb typed before its group (`boldvideo list videos`) now answers with the
  command the right way round (`boldvideo videos list`).

## 0.2.0 — 2026-11-28

The first version on npm.

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
- `agent setup` installs the boldvideo skill for coding agents
  (`~/.claude/skills`, `~/.agents/skills`, or the project with `--project`) and
  adds a short, marker-fenced section to the project's `AGENTS.md` / `CLAUDE.md`.
  The skill ships inside the CLI, so it matches the installed version.
- `import <path or URL>` picks the command from what it is given: a folder runs
  `import dir`, a file `import file`, an http(s) URL `import url`. Naming the
  command still works and is the form for scripts.
- `import dir` and `import file`: `--published-at source` publishes each video
  on its file's own date: the recording time inside mp4/mov files, otherwise the
  last-modified time. `now` and `none` work too, also in a map's `published_at`
  column. `--dry-run` shows the date and whether it was `recorded` or `modified`.
- Folder upload: `import dir <path>` uploads every video file in a folder
  (`--recursive`, `--include`, `--exclude`), and `import file <path>` uploads one.
  `--map meta.csv` sets title, date, type, tags, collection, privacy and
  external ID per file, over the same metadata flags as `import url`. A result
  CSV (`<map name>.results.csv`, or `--results`) records `status`, `bold_id`
  and `error_msg` per file. Running the same command again continues an
  interrupted run and uploads nothing twice. `--concurrency` sets the files in
  flight (default 3); `--wait` and `--dry-run` work as elsewhere.

## 0.1.0 — 2026-11-27

Tagged and released on GitHub with binaries; never published to npm. Every
command below is in the stability baseline (`docs/baseline-0.1.0.md`): from
here on, commands and flags are only added.

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
