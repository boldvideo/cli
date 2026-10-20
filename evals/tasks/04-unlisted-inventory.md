---
id: 04-unlisted-inventory
version: 2
prompt: 'Which recordings are still unlisted? Return only their titles, one per line in alphabetical order.'
starting_state: reset
min_calls: 1
check:
  kind: answer
  regex: '^Discovery calls\r?\nPricing foundations\r?\nWorkshop follow-up\s*$'
trap: false
chain: false
---

Which recordings are still unlisted? Return only their titles, one per line in alphabetical order.

This measures accurate visibility inventory across the known seed library. Public and private recordings must not be confused with unlisted recordings or silently omitted by using tenant credentials.
