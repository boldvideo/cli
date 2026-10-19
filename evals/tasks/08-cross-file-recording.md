---
id: 08-cross-file-recording
version: 1
prompt: 'File "Pricing foundations" under Coaching too, keeping it in Workshops.'
starting_state: reset
min_calls: 3
check:
  kind: api
  method: GET
  path: /admin/videos/pricing-foundations
  jq: '.data.title == "Pricing foundations" and (.data.collections | map(.name) | sort == ["Coaching", "Workshops"])'
trap: false
chain: false
---

File "Pricing foundations" under Coaching too, keeping it in Workshops.

This measures additive collection membership after resolving human-readable references. A move that drops the original membership is not an acceptable shortcut.
