## Recipes

The three video workflows below depend on sibling command branches. They are
not executable in this reference's current base: it registers auth, profiles,
help and docs, but not videos, insights, import or ask. No speculative flags or
unsupported command lines are supplied. After those commands merge, replace
these pending workflows with parser-checked shell recipes and regenerate the
page before publishing a release. `jq` is needed for the list pipeline.

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
`https://www.youtube.com/@takimoore` into a collection and wait for ingest to
finish with `--wait`. Then ask “What does Taki say about paid workshops versus
free webinars?” scoped to that collection. Reruns deduplicate by source URL;
waiting avoids asking before content is ready.
