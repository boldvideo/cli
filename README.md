# boldvideo

Run your [Bold](https://boldvideo.com) video library from a shell, or hand it to an agent.

## Install

Pick one:

```sh
# npx: no global install, needs Node 22+
npx --yes boldvideo@latest --help

# npm: global install, needs Node 22+
npm install -g boldvideo

# Homebrew: standalone binary, no Node required
brew install boldvideo/tap/boldvideo

# Install script: no Node or Homebrew (URL not yet live)
curl -fsSL https://boldvideo.com/install.sh | sh
```

See [installation requirements and release status](docs/install.md).
`boldvideo upgrade` prints the right upgrade command for how you installed; it
never replaces files itself. Use `--no-check` to stay offline.

Authenticate with a Bold API key:

```sh
export BOLDVIDEO_API_KEY='your-bold-api-key'
```

Bold has two kinds of key. An API key from **Settings → Developer** covers
`whoami`, `ask`, `search`, `api`, `viewers`, and reading published videos,
transcripts and collections. `import`, changes to videos and collections, and
`insights` need an admin key, which Bold issues on request.
`boldvideo whoami` shows which kind is active.

## Three commands: import, ask, search

The v0.1 flow: import a YouTube channel and wait for processing (admin key),
ask a question with cited video timestamps, then find related material:

```sh
boldvideo import youtube https://www.youtube.com/@takimoore --wait
boldvideo ask "What does Taki say about paid workshops versus free webinars? Cite video timestamps."
boldvideo search "paid workshops"
```

## v0.1 commands

Run [`boldvideo --help`](https://docs.boldvideo.com/cli) for the installed binary's
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
| `videos update` | Edit a video's metadata. |
| `videos publish` | Publish a video. |
| `videos unpublish` | Unpublish a video. |
| `videos delete` | Delete a video with confirmation. |
| `collections …` | List, create, rename, and add or remove videos. |
| `viewers …` | List, get, sync, progress and memory. |
| `insights questions` | What viewers asked, since a date or duration. |
| `ask` | Ask the library a question with cited timestamps. |
| `search` | Find relevant video content. |
| `api` | Call an arbitrary API method and path. |
| `docs` | Read documentation, including `docs cli`. |
| `help` | Read command metadata and examples. |
| `help exit-codes` | Look up stable process exit codes. |
| `upgrade` | Print the upgrade command for this installation. |
| `--version` | Print the installed version. |

Folder import (`import dir`) is not in the v0.1.0 cut.

## For agents

- JSON automatically when piped; readable tables in a terminal. Use `--json`
  to request JSON explicitly. Errors go to stderr, never stdout.
- `--help` works everywhere; `boldvideo help --json` exposes command metadata.
- `boldvideo docs cli` prints the CLI reference, offline.
- Stable exit codes: **0** success, **1** general failure, **2** usage,
  **3** auth/permissions, **4** not found, **5** timeout.
  Run `boldvideo help exit-codes` for details.

[CLI reference](https://docs.boldvideo.com/cli) ·
[Repository](https://github.com/boldvideo/cli) ·
[Command contract](docs/contract.md) · [Releasing](docs/releasing.md) ·
[Install paths](docs/install.md)

MIT.
