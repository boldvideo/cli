# boldvideo

Run your [Bold](https://boldvideo.com) video library from a shell, or hand it to an agent.

**Pre-release:** v0.1.0 has not shipped. The demo below is the intended v0.1
surface; commands are landing on sibling branches. This checkout currently
implements help and version only. Check `boldvideo --help` for what is available.

Requires Node **22 or newer**. Install once (after launch), or use `npx boldvideo`:

```sh
npm install -g boldvideo
```

Authenticate with your API key from **Settings → Developer** in Bold:

```sh
export BOLDVIDEO_API_KEY='your-bold-api-key'
```

## Three commands: import, ask, search

Intended v0.1 surface: import a YouTube channel and wait for processing, ask a
question with cited video timestamps, then find related material:

```sh
boldvideo import youtube https://www.youtube.com/@takimoore --wait
boldvideo ask "What does Taki say about paid workshops versus free webinars? Cite video timestamps."
boldvideo search "paid workshops"
```

## v0.1 commands

Intended cut, not a claim that sibling branches have shipped. Run
[`boldvideo --help`](https://docs.boldvideo.com/cli) for the installed binary's
source of truth, then `<command> --help` for its flags.

| Command | Purpose |
| --- | --- |
| `login` | Store credentials for a Bold account. |
| `whoami` | Show the active account. |
| `profiles` | Manage stored account profiles. |
| `import youtube` | Import a YouTube video or channel; `--wait` waits for ingest. |
| `import url` | Import a video from its source URL. |
| `videos list` | List a bounded page of videos. |
| `videos get` | Read one video's details. |
| `videos transcript` | Read a video's transcript. |
| `videos publish` | Publish a video. |
| `videos unpublish` | Unpublish a video. |
| `videos delete` | Delete a video with confirmation. |
| `ask` | Ask the library a question with cited timestamps. |
| `search` | Find relevant video content. |
| `api` | Call an arbitrary API method and path. |
| `docs` | Read documentation, including `docs cli`. |
| `help` | Read command metadata and examples. |
| `help exit-codes` | Look up stable process exit codes. |
| `--version` | Print the installed version. |

Not in the v0.1.0 cut unless merged before release: video edits (`videos update`),
collections, folder import (`import dir`), viewers, and insights.

## For agents

- JSON automatically when piped; readable tables in a terminal. Use `--json`
  to request JSON explicitly. Errors go to stderr, never stdout.
- `--help` works everywhere; `boldvideo help --json` exposes command metadata.
- `boldvideo docs cli` opens the CLI reference (intended v0.1 surface).
- Stable exit codes: **0** success, **1** general failure, **2** usage,
  **3** auth/permissions, **4** not found, **5** timeout.
  Run `boldvideo help exit-codes` for details.

[CLI reference](https://docs.boldvideo.com/cli) ·
[Repository](https://github.com/boldvideo/cli) ·
[Command contract](docs/contract.md) · [Releasing](docs/releasing.md)

MIT.
