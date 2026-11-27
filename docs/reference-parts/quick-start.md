## Quick start

Sign in, import a YouTube channel and wait for processing, ask a question with
cited video timestamps, then find related material:

```sh
boldvideo login
boldvideo import youtube https://www.youtube.com/@yourchannel --wait
boldvideo ask "What do we say about paid workshops versus free webinars? Cite video timestamps."
boldvideo search "paid workshops"
```

Imports deduplicate by source URL, so running the import again is safe.
Each command below has a plain heading with a predictable anchor, for example
[`boldvideo videos list`](#boldvideo-videos-list).
