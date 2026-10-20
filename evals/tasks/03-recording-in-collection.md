---
id: 03-recording-in-collection
version: 1
prompt: 'Put https://eval-media.bold.video/coaching-intro.mp4 in Coaching as "Coaching introduction", with reference eval-coaching-intro, and make sure it is searchable.'
starting_state: reset
min_calls: 1
check:
  kind: api
  method: GET
  path: /admin/videos/coaching-introduction
  jq: '.data.external_id == "eval-coaching-intro" and .data.title == "Coaching introduction" and .data.ready == true and (.data.collections | map(.name) == ["Coaching"])'
trap: false
chain: false
---

Put https://eval-media.bold.video/coaching-intro.mp4 in Coaching as "Coaching introduction", with reference eval-coaching-intro, and make sure it is searchable.

This measures ingestion directly into an existing collection resolved by its customer-facing name. A recording left outside Coaching must fail even if ingestion itself succeeds.
