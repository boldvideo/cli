---
name: boldvideo
description: Manages Bold video libraries with the boldvideo CLI when importing recordings, finding answers, migrating courses, reviewing audience questions, or onboarding customers.
---

# boldvideo

One CLI for the Bold admin UI: ingest videos, organize collections, manage
viewers, ask questions, search, and inspect audience insights.

## Four habits

1. Run `boldvideo --help` first, then `<command> --help` for exact arguments.
   Installed versions differ; never invent a flag or assume a recipe's commands
   are registered. `boldvideo help --json` exposes the whole command tree.
2. Pipe for JSON (or use `--json`). Lists return `{items, has_more, next}`;
   follow the exact `next` command until done, not just the first 20 records.
   Progress goes to stderr. Explicit Markdown formats and docs are exceptions.
3. Check `boldvideo whoami`, then use `--dry-run` before writes. Review the
   preview before applying. Destructive calls need `--yes` with nonterminal
   stdin, even for previews. Never add confirmation merely to bypass a refusal.
4. Use `--wait` on imports: wait for transcription/indexing, not just upload.
   Imports deduplicate by source URL; reuse stable URLs on retries.

## Authentication

Inject `BOLDVIDEO_API_KEY` from a secret store; it overrides stored profiles.
Alternatively run `boldvideo login` and enter the key privately. Never print,
commit, or put keys in command arguments. Admin operations require an admin
key; check the account before touching customer data.

## Main path

Import a channel into an existing collection and wait:

```sh
boldvideo import youtube https://www.youtube.com/@takimoore --collection paid-workshops --wait
```

Ask with cited moments:

```sh
boldvideo ask "What does Taki say about paid workshops versus free webinars?" --collection paid-workshops
```

Find relevant content:

```sh
boldvideo search "pricing a first paid workshop"
```

Errors: nonterminal stderr is `{code, message, hint, docs, request_id?}`; follow the hint, preserve request IDs, and branch on code rather than message (bulk failures may also return partial stdout results).
Exits: 0 success, 1 failure, 2 usage, 3 auth/permission, 4 not found, 5 wait timeout; inspect `boldvideo help exit-codes` rather than retrying every failure.

Read `boldvideo docs cli` for the installed reference. Open only the recipe
needed: [Kajabi migration](recipes/kajabi-migration.md),
[weekly questions digest](recipes/weekly-questions-digest.md), or
[customer onboarding](recipes/customer-onboarding.md). Recipes need the sibling
commands installed and their stated shell tools; parser checks are not a claim
that pending backend endpoints are deployed.
