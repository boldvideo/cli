# Kajabi recordings → a finished Bold library

Requires Bash, Python 3, jq, a secret-injected admin `BOLDVIDEO_API_KEY`, and
the import, collections, videos-read and videos-write commands installed.
Run blocks in order in the same Bash session. Do not use `import dir`: these
are URL manifests, not local video files.

Export recordings you are authorized to migrate into `kajabi-export/recordings.csv`
(or several CSV files in that folder), with this UTF-8 header and real media
URLs, not Kajabi lesson-page URLs. Replace the illustrative CDN URLs with your
exported, downloadable URLs; refresh expired signed links before starting.

```csv
url,title,published_at,type,tags,collection
https://media.coachgrowth.com/kajabi/2026-09-07-pricing.mp4,Pricing your first workshop,2026-09-07,workshop,"pricing,kajabi-migration",Paid workshops
https://media.coachgrowth.com/kajabi/2026-09-14-sales.mp4,Following up after a workshop,2026-09-14,workshop,"sales,kajabi-migration",Paid workshops
```

Dates are ISO dates or timezone-qualified datetimes; types must already exist.
Use exact collection names (no commas in names), creating each distinct
destination first. Here both rows go into one collection:

```bash
set -euo pipefail
boldvideo --help
boldvideo whoami
boldvideo collections create "Paid workshops" --dry-run
```

Review the account and preview, then create the destination. Repeat for other
collection names in your export. CSV parsing below preserves quoted commas.

```bash
boldvideo collections create "Paid workshops"
python3 - <<'PY' > recordings.jsonl
import csv, glob, json
for path in sorted(glob.glob('kajabi-export/*.csv')):
    with open(path, newline='', encoding='utf-8-sig') as source:
        for row in csv.DictReader(source):
            assert all(row.get(k) for k in ('url', 'title', 'published_at', 'type', 'tags', 'collection')), row
            print(json.dumps(row))
PY
test -s recordings.jsonl
```

Define the import loop. Preview every row first; after reviewing, run the same
loop in apply mode. Each successful import waits until ready and contributes
its exact ID to a publication manifest. A failure stops the loop, before publish.
Re-running with stable source URLs is safe; metadata on deduplicated existing
videos must be checked, not assumed to have been overwritten.

```bash
migrate() {
  while IFS= read -r row; do
    url=$(jq -r '.url' <<< "$row")
    title=$(jq -r '.title' <<< "$row")
    published_at=$(jq -r '.published_at' <<< "$row")
    type=$(jq -r '.type' <<< "$row")
    tags=$(jq -r '.tags' <<< "$row")
    collection=$(jq -r '.collection' <<< "$row")
    if [[ $1 == preview ]]; then
      boldvideo import url "$url" --title "$title" --published-at "$published_at" --type "$type" --tags "$tags" --collection "$collection" --privacy private --wait --dry-run
    else
      boldvideo import url "$url" --title "$title" --published-at "$published_at" --type "$type" --tags "$tags" --collection "$collection" --privacy private --wait > imported-video.json
      jq -er '.internal_id' imported-video.json >> imported-ids.txt
    fi
  done < recordings.jsonl
}
migrate preview
```

After approval, apply and verify. Follow every `next` command in the list
response, saving subsequent pages separately; reconcile titles, dates, type,
tags, collection membership and readiness against **every** exported row. Check
duplicate CSV URLs separately: multiple rows may deduplicate to one video.

```bash
: > imported-ids.txt
migrate apply
sort -u imported-ids.txt > publish-ids.txt
boldvideo videos list --collection "Paid workshops" --limit 100 --fields internal_id,title,published_at,video_type,tags,collections,status,privacy_level > migration-page-1.json
jq . migration-page-1.json
wc -l recordings.jsonl publish-ids.txt
```

Do not publish until counts and metadata reconcile and every imported video is
ready. Bulk publish reads only this migration's IDs, **not** every existing video
in the collection; omission of `--published-at` preserves the CSV dates.

```bash
boldvideo videos publish --dry-run < publish-ids.txt
```

Review the publication preview and confirm the intended visibility/access with
the customer, then apply. Inspect per-ID results and exit status; partial failures
need reconciliation before learner cutover.

```bash
boldvideo videos publish < publish-ids.txt
boldvideo videos list --collection "Paid workshops" --limit 100 > published-page-1.json
jq . published-page-1.json
```

Follow pagination again and open the customer portal as a learner before retiring
Kajabi. Keep the export and ID manifest privately; URL manifests may contain
signed media credentials. The parser test does not verify URL access or backend
deployment.
