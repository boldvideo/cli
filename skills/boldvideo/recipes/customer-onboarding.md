# Onboard a coaching customer

Requires Bash, jq, collections, import, viewers and ask commands. Inject the
customer's admin `BOLDVIDEO_API_KEY` privately. Run blocks in order, inspecting
each preview before applying. Use a channel you have permission to import;
this example uses a placeholder channel and a bounded first 25 videos.

```bash
set -euo pipefail
boldvideo --help
boldvideo whoami
boldvideo collections create "Coach Growth training" --dry-run
boldvideo collections create "Coach Growth welcome" --dry-run
```

Confirm the account, then create both collections and capture returned IDs.

```bash
boldvideo collections create "Coach Growth training" > training-collection.json
boldvideo collections create "Coach Growth welcome" > welcome-collection.json
training=$(jq -er '.data.id' training-collection.json)
welcome=$(jq -er '.data.id' welcome-collection.json)
boldvideo import youtube https://www.youtube.com/@yourchannel --collection "$training" --collection "$welcome" --max 25 --wait --dry-run
```

Both collections will contain the selected channel videos; for a larger channel,
agree the cap with the customer instead of silently importing everything.
Channel runs do not accept per-video titles. Apply, wait for readiness, then
inspect membership (follow every `next` command).

```bash
boldvideo import youtube https://www.youtube.com/@yourchannel --collection "$training" --collection "$welcome" --max 25 --wait
boldvideo collections videos "$training" --limit 100
boldvideo collections videos "$welcome" --limit 100
```

Export the member roster as `coach-growth-members.csv`. `external_id` is stable
across exports; use your customer's actual IDs and emails. Extra columns become
traits, **not** collection access rules. Sync does not provision invitations,
portal passwords or entitlements. Configure access in the customer frontend.

```csv
external_id,email,name,cohort
member-1042,ana@coachgrowth.com,Ana Garcia,autumn-2026
member-1043,luis@coachgrowth.com,Luis Martin,autumn-2026
```

Preview, review, then apply without `--prune` (never delete members as part of
onboarding). Check per-row failures and verify the first member.

```bash
boldvideo viewers sync coach-growth-members.csv --dry-run
```

```bash
boldvideo viewers sync coach-growth-members.csv
boldvideo viewers get member-1042
boldvideo ask "What do we say about paid workshops versus free webinars?" --collection "$training" --as member-1042 --json > onboarding-answer.json
jq '{content, sources}' onboarding-answer.json
```

Check that the answer is useful and cites imported videos. Viewer personalization
requires the account's viewers feature; it is not proof of access enforcement.

## Hand over learner links, not admin or API links

Collect the actual canonical viewer URLs from the smoke answer. Do not invent
collection routes or share stream/download URLs or UUID player capability links:
those are not access-controlled portal pages.

```bash
jq -er '.sources[] | .canonical_url // empty' onboarding-answer.json | sort -u > learner-video-urls.txt
cat learner-video-urls.txt
```

If sources/URLs are absent or null, stop the handover and confirm the configured
frontend URL with the customer. Hosted portals normally use
`https://<account-slug>.bold.video`, but custom frontends override that; the CLI
does not supply a collection-page URL. Open the **confirmed** portal in a learner
session, navigate to both collections, and copy their actual URLs into the
handover alongside `learner-video-urls.txt`. Test every link as a learner, including
login and permissions; viewer sync alone proves neither. Hand over the portal
entry URL, verified collection links, cited video links and the customer's access
instructions—never the admin key or roster file. If videos require publication
under that portal's policy, preview and apply the scoped publication workflow in
the Kajabi recipe before inviting learners.
