---
id: 00-example
version: 1
prompt: Report the installed boldvideo version. You have the boldvideo CLI available in your shell.
starting_state: empty
min_calls: 1
check:
  kind: answer
  contains: 0.1.0
trap: Do not guess the version.
chain: []
---

Local smoke task. No Bold credentials or remote reset are necessary.
