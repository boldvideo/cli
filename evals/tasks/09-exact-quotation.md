---
id: 09-exact-quotation
version: 1
prompt: 'What are the exact spoken words in "Pricing foundations" between 00:42 and 00:49? Return just that sentence.'
starting_state: reset
min_calls: 2
check:
  kind: answer
  regex: '^\s*Price the outcome, not the hours you spend delivering it\.\s*$'
trap: false
chain: false
---

What are the exact spoken words in "Pricing foundations" between 00:42 and 00:49? Return just that sentence.

This measures retrieval of authored speech rather than a plausible paraphrase from a title. The seed transcript supplies a distinctive sentence at a fixed timestamp.
