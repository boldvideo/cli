---
id: 19-coaching-chain
version: 1
prompt: 'Bring https://eval-media.bold.video/coaching-intro.mp4 into the library as "Coaching introduction" with reference eval-coaching-chain, then file it under Coaching, then explain the first exercise from that material with its supporting title and timestamp. In your final reply say where you filed it too.'
starting_state: reset
min_calls: 3
check:
  kind: api
  method: GET
  path: /admin/videos/coaching-introduction
  jq: '.data.external_id == "eval-coaching-chain" and .data.title == "Coaching introduction" and .data.ready == true and (.data.collections | map(.name) == ["Coaching"])'
  answer:
    contains: ['Coaching introduction', 'Coaching', '00:30', 'three goals']
trap: false
chain: true
---

Bring https://eval-media.bold.video/coaching-intro.mp4 into the library as "Coaching introduction" with reference eval-coaching-chain, then file it under Coaching, then explain the first exercise from that material with its supporting title and timestamp. In your final reply say where you filed it too.

This measures the same three-stage workflow with a different collection and answer fixture. The asymmetric content catches an agent that reuses the pricing answer instead of querying the newly available material.
