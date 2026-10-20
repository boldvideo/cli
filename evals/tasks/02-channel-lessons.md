---
id: 02-channel-lessons
version: 1
prompt: 'Bring the newest three recordings from https://www.youtube.com/@BoldEvalLibrary into our library under Coaching, preserving their original release dates and marking them with the eval-channel tag.'
starting_state: reset
min_calls: 1
check:
  kind: api
  method: GET
  path: /admin/videos?tag=eval-channel&page_size=100
  jq: '.meta.total_entries == 3 and (.data | map(.title) | sort == ["Channel lesson 1", "Channel lesson 2", "Channel lesson 3"]) and (.data | map(.published_at) | sort == ["2026-10-01T10:00:00Z", "2026-10-02T10:00:00Z", "2026-10-03T10:00:00Z"]) and (.data | map(.collections | map(.name)) == [["Coaching"], ["Coaching"], ["Coaching"]])'
trap: false
chain: false
---

Bring the newest three recordings from https://www.youtube.com/@BoldEvalLibrary into our library under Coaching, preserving their original release dates and marking them with the eval-channel tag.

This measures channel ingestion with a bound and source-date preservation rather than a single-video shortcut. The sandbox channel fixture has four recordings so choosing all of them or the oldest three cannot pass.
