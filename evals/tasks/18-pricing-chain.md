---
id: 18-pricing-chain
version: 2
prompt: 'Bring https://eval-media.bold.video/pricing-lab.mp4 into the library as "Pricing lab" with reference eval-pricing-chain, then put it under Workshops, then tell me the recommended pilot price from that material with its supporting title and timestamp. In your final reply say where you filed it too.'
starting_state: reset
min_calls: 3
check:
  kind: api
  method: GET
  path: /admin/videos/pricing-lab
  jq: '.data.external_id == "eval-pricing-chain" and .data.title == "Pricing lab" and .data.ready == true and (.data.collections | map(.name) == ["Workshops"])'
  answer:
    contains: ['Pricing lab', 'Workshops', '01:15', '250']
trap: false
chain: true
---

Bring https://eval-media.bold.video/pricing-lab.mp4 into the library as "Pricing lab" with reference eval-pricing-chain, then put it under Workshops, then tell me the recommended pilot price from that material with its supporting title and timestamp. In your final reply say where you filed it too.

This measures ingestion followed by organization and a grounded library question in one operator request. The check requires both persisted membership and the authored pilot-price citation, so metadata-only completion is insufficient.
