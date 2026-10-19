---
id: 07-new-collection
version: 1
prompt: 'Set up an empty collection called "Autumn onboarding" for next month, leaving the existing two collections intact.'
starting_state: reset
min_calls: 1
check:
  kind: api
  method: GET
  path: /collections?limit=1000
  jq: '(.data | length == 3) and (.data | map(.name) | sort == ["Autumn onboarding", "Coaching", "Workshops"]) and (.data | map(select(.name == "Autumn onboarding")) | map(.video_count) == [0])'
trap: false
chain: false
---

Set up an empty collection called "Autumn onboarding" for next month, leaving the existing two collections intact.

This measures collection creation without accidental video membership or replacement of existing collections. The collection command is a sibling dependency rather than an excuse to rewrite this task around an API spelling.
