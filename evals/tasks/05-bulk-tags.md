---
id: 05-bulk-tags
version: 1
prompt: 'Mark both "Discovery calls" and "Workshop follow-up" with the sprint-review tag without losing their existing tags.'
starting_state: reset
min_calls: 2
check:
  kind: api
  method: GET
  path: /admin/videos?tag=eval-bulk&page_size=100
  jq: '.meta.total_entries == 2 and (.data | map(.tags | map(.name) | sort) == [["eval-bulk", "sales", "sprint-review"], ["eval-bulk", "sales", "sprint-review"]])'
trap: false
chain: false
---

Mark both "Discovery calls" and "Workshop follow-up" with the sprint-review tag without losing their existing tags.

This measures a bulk additive edit rather than replacing a recording's entire tag set. The two targets deliberately already carry two tags so a destructive replacement cannot pass.
