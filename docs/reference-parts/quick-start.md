## Quick start

Import a YouTube channel and wait for processing, ask a question with cited
video timestamps, then find related material. `import` needs an admin key;
`ask` and `search` work with any key.

```sh
boldvideo import youtube https://www.youtube.com/@takimoore --wait
boldvideo ask "What does Taki say about paid workshops versus free webinars? Cite video timestamps."
boldvideo search "paid workshops"
```

Imports deduplicate by source URL, so running the first command again is safe.
Each command below has a plain heading with a predictable anchor, for example
[`boldvideo videos list`](#boldvideo-videos-list).
