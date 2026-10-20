---
id: 12-viewer-questions
version: 1
prompt: 'What did Maria Santos want to know about our Workshops material during October 2026? Return only her two question texts, oldest first, one per line.'
starting_state: reset
min_calls: 1
check:
  kind: answer
  regex: '^How should I price my first workshop\?\r?\nWhen should I send the follow-up\?\s*$'
trap: false
chain: false
---

What did Maria Santos want to know about our Workshops material during October 2026? Return only her two question texts, oldest first, one per line.

This measures operator access to viewer question history with a fixed date window and collection scope. Other viewers and the Coaching question are deliberate distractors.
