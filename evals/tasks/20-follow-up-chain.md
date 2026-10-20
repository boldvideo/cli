---
id: 20-follow-up-chain
version: 1
prompt: 'Bring https://eval-media.bold.video/follow-up-lab.mp4 into the library as "Follow-up lab" with reference eval-follow-up-chain, then file it under Workshops, then tell me when to contact attendees according to that material with its supporting title and timestamp. In your final reply say where you filed it too.'
starting_state: reset
min_calls: 3
check:
  kind: api
  method: GET
  path: /admin/videos/follow-up-lab
  jq: '.data.external_id == "eval-follow-up-chain" and .data.title == "Follow-up lab" and .data.ready == true and (.data.collections | map(.name) == ["Workshops"])'
  answer:
    contains: ['Follow-up lab', 'Workshops', '00:55', '24 hours']
trap: false
chain: true
---

Bring https://eval-media.bold.video/follow-up-lab.mp4 into the library as "Follow-up lab" with reference eval-follow-up-chain, then file it under Workshops, then tell me when to contact attendees according to that material with its supporting title and timestamp. In your final reply say where you filed it too.

This measures whether the agent completes the question step after a third ingestion-and-organization workflow. The timestamp and timing recommendation must come from the new recording rather than a similarly named seed recording.
