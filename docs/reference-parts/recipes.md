## Recipes

The five video workflows below depend on sibling command branches. They are
not executable in this reference's current base: it registers auth, profiles,
help and docs, but not videos, insights, import, ask, collections or viewers.
No speculative flags or unsupported shell commands are supplied. After those
commands merge, replace these pending workflows with parser-checked shell
recipes and regenerate the page before publishing a release. `jq` is needed
for the list pipeline.

Check the installed commands before starting:

```sh
boldvideo help --json
boldvideo whoami
```

### Bulk-edit from a list pipeline

Pending `videos list` and `videos update`. Request a bounded page with only the
IDs and fields needed to select videos. Pipe the JSON `items` through `jq` to
select IDs, then loop over the IDs with quoted arguments and preview each update
using `--dry-run`. Review the previews before applying the same updates. Follow
the exact `next` command if another page exists; do not assume the first page is
the entire library.

### Weekly questions digest

Pending `insights questions`. Request questions from the last seven days, save
the JSON response to a dated file and format the returned questions into a
digest. Follow pagination when present. Schedule the read-only invocation in
your own weekly job with a secret-injected key; do not put a key in the job's
command line or digest.

### Import a channel and ask

Pending `import youtube` and `ask`. Import the channel
`https://www.youtube.com/@yourchannel` into a collection and wait for ingest to
finish with `--wait`. Then ask “What do we say about paid workshops versus
free webinars?” scoped to that collection. Reruns deduplicate by source URL;
waiting avoids asking before content is ready.

### Kajabi migration from a folder of URLs

Pending `import url`. Export the Kajabi lesson media URLs you are allowed to
download into UTF-8 text files under `kajabi-urls/`, one URL per line. Iterate
through the files and URLs, preserving each URL as one quoted argument; import
each source into the destination course collection and wait for ingest with
`--wait`. Use stable source URLs so reruns can deduplicate, and resolve expiring
or inaccessible links before retrying. Keep a migration log and reconcile its
successful imports with the exported lesson count before switching learners.
Do not assume `import dir` reads URL lists; its input contract must be checked
when that command lands.

### Customer onboarding: create collections, import, sync viewers

Pending `collections create`, `import url` and `viewers sync`. Check the customer
account with `boldvideo whoami`, create a collection for the onboarding course,
and record its returned ID. Import the welcome and training videos into that
collection, waiting for ingest before inviting learners. Preview the viewer
sync with `--dry-run`, review the customer roster and collection assignments,
then apply the sync. Verify the resulting viewers before sharing access. The
roster format and assignment flags must come from the registered command spec,
not an assumed CSV schema.
