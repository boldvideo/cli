---
name: boldvideo
description: Runs a Bold video library with the boldvideo CLI. Use when the user wants to import, upload or migrate recordings into Bold, ask what their videos say, see what members are asking, or manage Bold videos, collections and viewers.
---

# boldvideo

`boldvideo` (also installed as `bold`) runs a Bold video library from a shell.

Its help is the manual. `boldvideo <command> --help` has the flags and two
examples for that command; `boldvideo help --json` returns every command at
once. Installed versions differ, so take flags from the installed help.

## Before the first command

1. Run `boldvideo whoami`. It names the workspace and the key kind; writes need
   an admin key.
2. Signed out? Run `boldvideo login`, give the user the link and code it prints,
   and wait for it to return. Where nobody can open a browser, the user supplies
   `BOLDVIDEO_API_KEY` from a secret store. A key belongs in the environment,
   never in an argument, a file you commit, or your answer.

Done when `whoami` shows the workspace the user meant.

## Every write

1. Run the command with `--dry-run` and read what it would do.
2. Run it for real.

A delete in a pipe needs `--yes`, its dry run included.

## Reading output

Piped output is JSON.

- A list is `{items, has_more, next}`. `next` is the exact command for the
  following page: run it until `has_more` is false, or you have only the first 20.
- An error is one object on stderr: `code`, `message`, `hint`, sometimes
  `request_id`. Branch on `code`, run the `hint`, and quote the `request_id`
  when you report a failure.
- A bulk command can exit 1 and still list every item on stdout. Read the items.

`boldvideo help exit-codes` explains the exit codes.

## Import

`--wait` holds the command until the videos are transcribed and searchable.
Without it the command returns while they are still processing, and `ask` finds
nothing in them yet.

```sh
boldvideo import youtube https://www.youtube.com/@yourchannel --collection paid-workshops --wait
```

A folder of recordings, each published on the day it was recorded:

```sh
boldvideo import dir ./recordings --published-at source --dry-run
boldvideo import dir ./recordings --published-at source --wait
```

The dry run shows each file's date and whether it was `recorded` (read from the
file) or `modified` (the file's timestamp, often just the download date). For
titles, dates and collections per file, pass `--map meta.csv`.

Name the source's command: `import youtube`, `import url`, `import dir`,
`import file`. A bare path also works, but then the output shape depends on what
the path turns out to be.

Running an import again is safe. Sources already in the library are skipped, and
a folder upload continues where it stopped.

## Ask and search

```sh
boldvideo ask "What do we say about paid workshops versus free webinars?" --collection paid-workshops
boldvideo search "pricing a first paid workshop"
```

Cite the timestamps a source carries. A source without one stays untimed.

## Recipes

Open the one that matches the job:

- Moving a course off Kajabi: [Kajabi migration](recipes/kajabi-migration.md)
- A weekly report of member questions: [weekly questions digest](recipes/weekly-questions-digest.md)
- Setting up a new customer's library: [customer onboarding](recipes/customer-onboarding.md)

The recipes use Bash, Python 3 and jq.
