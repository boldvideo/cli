## Quick start

Planned workflow: `import` and `ask` are not registered in this base version.
These three invocations show the intended import, wait, ask sequence, not
commands you can execute yet. The second invocation repeats the same source
with `--wait`; imports deduplicate by source URL. There is no separate `wait`
command. Confirm support with `boldvideo help --json` after the sibling commands
merge, then parser-check this block before treating it as runnable shell.

```text
boldvideo import youtube https://www.youtube.com/@takimoore
boldvideo import youtube https://www.youtube.com/@takimoore --wait
boldvideo ask "What does Taki say about paid workshops versus free webinars?"
```

The command sections below document only the registered surface. Each uses a
plain heading with a predictable anchor: for example,
[`boldvideo profiles list`](#boldvideo-profiles-list). An eventual heading
`boldvideo videos list` will have the anchor `#boldvideo-videos-list`.
