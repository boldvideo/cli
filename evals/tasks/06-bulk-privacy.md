---
id: 06-bulk-privacy
version: 1
prompt: 'Make "Discovery calls" and "Workshop follow-up" private while leaving every other recording alone.'
starting_state: reset
min_calls: 2
check:
  kind: api
  method: GET
  path: /admin/videos?page_size=100
  jq: '.meta.total_entries == 12 and (.data | map(select(.privacy_level == "unlisted")) | map(.title) == ["Pricing foundations"]) and (.data | map(select(.privacy_level == "private")) | map(.title) | sort == ["Discovery calls", "Internal roadmap", "Leadership clinic", "Workshop follow-up"]) and (.data | map(select(.privacy_level == "public")) | length == 7)'
trap: false
chain: false
---

Make "Discovery calls" and "Workshop follow-up" private while leaving every other recording alone.

This measures a targeted bulk visibility change with a control group. The expected inventory catches broad edits that accidentally hide unrelated recordings.
