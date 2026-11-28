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

Working with a coding agent? Run `boldvideo agent setup` in your project. It
installs the boldvideo skill for Claude Code, Codex, Cursor, Gemini CLI and Amp,
and adds a short section to `AGENTS.md` that tells the agent this library exists
and which commands to start from. Then ask the agent for what you want.
Each command below has a plain heading with a predictable anchor, for example
[`boldvideo videos list`](#boldvideo-videos-list).
