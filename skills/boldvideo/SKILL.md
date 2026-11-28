---
name: boldvideo
description: Runs a Bold video library from a shell with the boldvideo CLI (also installed as bold). Imports recordings from YouTube, URLs or local folders, answers questions from transcripts with cited timestamps, organizes collections, syncs viewers and reads what members ask. Use when the user mentions Bold, boldvideo or a video library, wants to import, upload or migrate recordings or a course (Kajabi, Vimeo, Zoom exports), or asks what their members are asking.
---

# boldvideo

One CLI for the Bold admin UI: ingest videos, organize collections, manage
viewers, ask questions, search, and inspect audience insights.

## Four habits

1. Run `boldvideo --help` first, then `<command> --help` for exact arguments.
   Installed versions differ; never invent flags. `boldvideo help --json`
   exposes the installed command tree.
2. Pipe for JSON (or use `--json`). Lists return `{items, has_more, next}`;
   follow the exact `next` command until done, not just the first 20 records.
   Progress goes to stderr. Explicit Markdown formats and docs are exceptions.
3. Check `boldvideo whoami`, then use `--dry-run` before writes. Review the
   preview before applying. Destructive calls need `--yes` with nonterminal
   stdin, even for previews; confirm only after reviewing the action.
4. Use `--wait` on imports: wait for transcription/indexing, not just upload.
   Imports deduplicate by source URL; reuse stable URLs on retries. Folder
   uploads continue where they stopped when the same command runs again.

## Check install and auth

Run `boldvideo --version` to check installation, then `boldvideo whoami` to
check the account and key kind. Inject `BOLDVIDEO_API_KEY` from a secret store
(overrides profiles), or run `boldvideo login` and enter it privately. Never
print, commit, or put keys in arguments. Admin writes require an admin key.

## Main path

Import a channel into an existing collection and wait:

```sh
boldvideo import youtube https://www.youtube.com/@yourchannel --collection paid-workshops --wait
```

Upload a folder of recordings, each published on the day it was recorded:

```sh
boldvideo import dir ./recordings --published-at source --dry-run
boldvideo import dir ./recordings --published-at source --wait
```

`--map meta.csv` sets title, date, type, tags, collection and privacy per file.
Name the command (`import dir`, `import file`, `import url`) rather than a bare
path, so the output shape is the one you expect. Shorthands such as `bold v`
exist for people; use the full names in scripts.

Ask with cited moments:

```sh
boldvideo ask "What do we say about paid workshops versus free webinars?" --collection paid-workshops
```

Find relevant content:

```sh
boldvideo search "pricing a first paid workshop"
```

## Five common mistakes

Provisional contract-based guesses; to be replaced from eval transcripts, BOLD-2049.

1. Asking before ingest is ready: import with `--wait` first.
2. Parsing tables: pipe for JSON or pass `--json` instead.
3. Deleting without preview: use `--dry-run --yes`, review, then confirm.
4. Assuming a tenant key can perform admin writes: check `boldvideo whoami`.
5. Inventing citation timestamps: use only timestamps present in sources;
   leave untimed sources untimed.

Errors: nonterminal stderr is `{code, message, hint, docs, request_id?}`; follow hints, preserve request IDs, branch on code (bulk failures may return partial stdout).
Exits: 0 success, 1 failure, 2 usage, 3 auth/permission, 4 not found, 5 wait timeout; see `boldvideo help exit-codes`.

Read `boldvideo docs cli` for the reference. Open only the needed recipe:
[Kajabi migration](recipes/kajabi-migration.md),
[weekly questions digest](recipes/weekly-questions-digest.md), or
[customer onboarding](recipes/customer-onboarding.md). Recipes need the sibling
commands and stated shell tools; parser checks do not prove backend deployment.
