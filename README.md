# boldvideo

Run your [Bold](https://boldvideo.com) video library from a terminal, or hand it to your coding agent.

```text
$ boldvideo login

  ████████▄▄▄     ▄██████▄▄   █████████    ▄███████▄▄
  ███████████▄  ████████████  █████████    ███████████▄
  ███████████▀ ██████████████ █████████    █████████████
  ███████████  ████████████████████████    █████████████
  ████████████▄██████████████▀█████████    █████████████
  ███████████████████████████ ████████████ ████████████▀
  ████████████  ▀███████████  ▀███████████ ███████████▀

  Sign in to Bold
  Run your video library from this terminal.

  Code   KTRM-4XQ9
  Open   https://app.boldvideo.io/cli/KTRM-4XQ9

  ⠹ Waiting for approval
```

Everything you do in the Bold admin, as commands: import a channel, fix a title, build a collection, pull a transcript, ask the library a question. Each command prints a table in a terminal and JSON in a pipe, so the same tool works for you and for an agent.

## Install

Needs Node 22 or newer.

```sh
npm install -g boldvideo
```

Or run it without installing:

```sh
npx boldvideo@latest --help
```

Installing also gives you `bold`, the same command under a shorter name:
`bold login`, `bold videos list`. Docs and help say `boldvideo` throughout.

## Type less

Tab completion covers commands, flags, flag values, your workspaces and file names, in zsh, bash and fish. Add one line to your shell's startup file:

```sh
echo 'eval "$(boldvideo completion zsh)"' >> ~/.zshrc      # after compinit
echo 'eval "$(boldvideo completion bash)"' >> ~/.bashrc
echo 'boldvideo completion fish | source' >> ~/.config/fish/config.fish
```

Everyday commands have shorthands, and a group on its own lists:

```sh
bold v                           # boldvideo videos list
bold v --privacy private -n 5    # list flags work without "list"
bold v show paid-workshops       # videos get
bold c                           # collections list
bold vw                          # viewers list
bold s "paid workshops"          # search
bold a "What do we say about pricing?"    # ask
bold me                          # whoami
bold p switch acme               # profiles use
```

`-h`, `-j` (`--json`), `-n` (`--limit`), `-y` (`--yes`), `-p` (`--profile`) and `-t` (`--tenant`) work wherever the long flag does. `boldvideo <command> --help` shows each shorthand next to the command it stands for.

## Sign in

```sh
boldvideo login
```

It shows a short code and opens Bold in your browser. Check the code matches, approve, and you are in. The CLI can then do what you can do in the admin. There is no key to create or copy.

```sh
boldvideo whoami     # who is signed in, and to which workspace
boldvideo logout     # ends the sign-in, here and on the server
```

## The first five minutes

```sh
# Bring in a whole YouTube channel and wait until it is searchable
boldvideo import youtube https://www.youtube.com/@yourchannel --wait

# Ask the library, with timestamps you can click
boldvideo ask "What do we say about paid workshops versus free webinars?"

# Find the moments
boldvideo search "paid workshops"

# See what members are asking
boldvideo insights questions --since 7d
```

Imports skip anything already in the library, so running one twice is safe.

## What it does

| | |
| --- | --- |
| **Import** | `import youtube` for a video, playlist or channel. `import url` for a file or page. `--wait` holds until transcripts and search are ready; `import status` and `import cancel` follow a run. |
| **Videos** | `videos list`, `get` and `transcript` (txt, srt, vtt, json). `videos update`, `publish`, `unpublish` and `delete`. |
| **Collections** | `collections list`, `create`, `rename`, `add`, `remove` and `videos`. |
| **Answers** | `ask` answers from your transcripts and cites the moments. `search` finds them. |
| **Members** | `viewers list`, `get`, `sync` and `progress`; `viewers memory` to read or clear what the assistant remembers. |
| **Insights** | `insights questions`: what members asked, since any date. |
| **Everything else** | `api` calls any endpoint with your sign-in. `docs` prints any docs page as markdown. |

Run `boldvideo --help` for the full tree and `boldvideo <command> --help` for flags and examples. The same reference is online at [docs.boldvideo.com/cli](https://docs.boldvideo.com/cli).

## Several workspaces

If you belong to more than one workspace, tick the ones you want when you approve the sign-in. Each is saved under its slug.

```sh
boldvideo profiles list              # the workspaces this terminal is signed in to
boldvideo profiles use acme          # switch the default
boldvideo videos list -t acme        # or run one command somewhere else
```

Run `boldvideo login` again to add more.

## Careful by default

- Every command that changes something takes `--dry-run` and shows what it would do.
- Deleting asks first. In a script, pass `--yes`.
- Lists are short unless you ask: `--limit`, `--fields`, and a ready-to-run command for the next page.

## For agents

The CLI is built so an agent with a shell and nothing else can run a library.

- **JSON when piped.** Tables in a terminal, JSON everywhere else, `--json` to force it. Errors go to stderr with a stable `code`, a `hint` naming the next command, and a docs link.
- **`--help` is the manual.** Every command carries examples. `boldvideo help --json` returns the whole command tree, and `boldvideo docs cli` prints the reference offline.
- **Exit codes mean something.** `0` success, `1` failure, `2` usage, `3` sign-in or permission, `4` not found, `5` timeout.
- **Sign-in works without a terminal.** `boldvideo login` prints the link and code to stderr and waits, so an agent can hand the link to a person.
- **A skill file ships with it.** [`skill/SKILL.md`](skill/SKILL.md) and three recipes: a Kajabi migration, a weekly questions digest, and onboarding a customer.

## Servers and CI

Where nobody can open a browser, use an admin key. Create one in Bold under **Settings → Developer → Admin keys**.

```sh
export BOLDVIDEO_API_KEY='bold_admin_…'
```

Or save it as a profile without it touching your shell history:

```sh
echo "$KEY" | boldvideo login --token -
```

An admin key has full control of the workspace. Keep it in a secret store, never in a website or app.

## More

[CLI reference](https://docs.boldvideo.com/cli) ·
[Command contract](docs/contract.md) ·
[Install details](docs/install.md) ·
[Releasing](docs/releasing.md) ·
[Changelog](CHANGELOG.md)

MIT.
