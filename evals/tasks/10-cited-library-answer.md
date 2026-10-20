---
id: 10-cited-library-answer
version: 1
prompt: 'According to our Workshops material, should my first workshop be priced by hours or by the outcome? Include the supporting recording title and minute-and-second timestamp.'
starting_state: reset
min_calls: 1
check:
  kind: answer
  contains: ['Pricing foundations', '00:42']
  regex: '(?is).*(?:price|priced|charge|pricing)\s+(?:it\s+)?(?:by|for|based on|according to)\s+(?:the\s+)?outcome.*'
trap: false
chain: false
---

According to our Workshops material, should my first workshop be priced by hours or by the outcome? Include the supporting recording title and minute-and-second timestamp.

This measures a library answer grounded in one of the ten authored citation fixtures. Merely mentioning pricing without the correct source and timestamp cannot pass.
