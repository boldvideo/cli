---
id: 01-single-recording
version: 1
prompt: 'Bring https://eval-media.bold.video/pricing-lab.mp4 into our library as "Pricing lab", with reference eval-pricing-lab, and do not finish until it is searchable.'
starting_state: reset
min_calls: 1
check:
  kind: api
  method: GET
  path: /admin/videos/pricing-lab
  jq: '.data.external_id == "eval-pricing-lab" and .data.title == "Pricing lab" and .data.ready == true'
trap: false
chain: false
---

Bring https://eval-media.bold.video/pricing-lab.mp4 into our library as "Pricing lab", with reference eval-pricing-lab, and do not finish until it is searchable.

This measures whether an operator can ingest a single recording with identifying metadata and wait for completion. A successful submission alone cannot pass the explicit transcription-and-index readiness check.
