# Install boldvideo

Standalone binaries and the Homebrew formula are produced for every tagged
release. The install script URL, `https://boldvideo.com/install.sh`, is **not yet live**.

All paths install the same CLI, as `boldvideo` and under the shorter name `bold`. Run `boldvideo --help` to see every command. Piped help/version return JSON.

| Path | Best for | Requirements |
| --- | --- | --- |
| npx (recommended first) | Agents and developers already using Node | Node 22+ and npm |
| Homebrew | People who want managed installs and upgrades | Homebrew; no Node or Bun |
| Install script | Machines without Node or Homebrew | macOS or glibc Linux, curl, sha256sum or shasum |

## npx / npm

With Node 22 or newer:

```sh
npx --yes boldvideo@latest --help
# Optional persistent global installation:
npm install -g boldvideo
boldvideo --help
```

Only `dist/boldvideo.js` is shipped in the npm package, not the standalone
executables. Node is required at runtime; Bun is not.

## Homebrew

```sh
brew tap boldvideo/tap
brew install boldvideo/tap/boldvideo
boldvideo --version
# Later:
brew upgrade boldvideo
```

The `boldvideo/homebrew-tap` repository is currently private: you need repository
access and Git authentication to tap it until it is made public. The formula
selects macOS or Linux and arm64 or x64, downloads one executable from the tagged
GitHub release, and verifies its SHA-256. No Node or Bun runtime is needed.

## Install script (intended URL, not yet live)

After `packaging/install.sh` is hosted at the URL below:

```sh
curl -fsSL https://boldvideo.com/install.sh | sh
```

The script resolves the latest stable GitHub release once, downloads the matching
macOS/Linux arm64/x64 executable and `checksums.txt`, and verifies SHA-256 before
replacing anything. Linux binaries require glibc (not Alpine/musl). It installs
to `~/.local/bin` without sudo and prints a PATH hint if needed:

```sh
export PATH="$HOME/.local/bin:$PATH"
boldvideo --help
```

To use `/usr/local/bin`, if your account can write there:

```sh
curl -fsSL https://boldvideo.com/install.sh | BOLDVIDEO_INSTALL_DIR=/usr/local/bin sh
```

To inspect before running, download the script to a file, read it, then run
`sh install.sh`. Rerun to upgrade; checksum or download failures leave an existing
installation intact. The script never invokes sudo. GitHub assets must be
publicly downloadable for this unauthenticated script to work.

## Upgrade advice (never self-updates)

```sh
boldvideo upgrade
boldvideo upgrade --no-check --json
```

The command resolves its own executable path, including symlinks, and prints
instructions for the detected channel. It never runs those instructions or
replaces itself. JSON always has exactly `channel`, `current_version`, and
`upgrade_command`; channel is `npx`, `npm`, `homebrew`, `script`, or `source`.
Homebrew paths take precedence over inherited npm environment variables. npm's
cache path or `npm_command=exec` identifies npx when running from an npm package.
Other standalone locations use the script channel, preserving their directory
in the printed command. Checkout builds print a source pull/install/build command.

By default it makes a best-effort check of the npm registry's latest version,
limited to 3 seconds. A terminal receives the latest version on stderr; JSON
keeps the same three fields. Offline, timeout, HTTP, or invalid registry responses
do not fail the command. `--no-check` skips the request entirely. The installer
URL in script-channel advice is still **not live** during this preparation.

## Release preparation (maintainers)

- `bun run build:binaries` cross-compiles four executables into `dist/bin` and
  writes the sha256sum-compatible `checksums.txt`. The x64 Linux build uses Bun's
  baseline CPU target. `bun run build` still produces the Node/npm bundle.
- On a future `vX.Y.Z` tag, `release.yml` checks that the stable tag matches
  `package.json`, runs checks, builds binaries, smoke-tests the Linux x64 host,
  and creates/updates the GitHub release with all five assets. npm publishing
  is separate (BOLD-2043's branch was absent when this was prepared).
- Set the CLI repo's **`TAP_GITHUB_TOKEN` Actions secret** to a token with Contents
  read/write and Pull requests read/write on `boldvideo/homebrew-tap`. Without it,
  the workflow skips the tap update with a notice. With it, the workflow updates
  the formula and opens a tap PR; it never merges it. If the tap cannot be cloned,
  it instead commits `Formula/boldvideo.rb` to the CLI repo's `homebrew-tap` branch
  using the workflow's `GITHUB_TOKEN`. No force-pushes are used.
- The checked-in formula is a preparation template. Its initial hashes come from
  the local preparation build, not a published release; the release job replaces
  them with that release's actual hashes before opening the tap update PR.
- To regenerate manually:

  ```sh
  bun scripts/update-formula.ts v0.1.0 dist/bin/checksums.txt packaging/homebrew/boldvideo.rb
  ```

- Host `packaging/install.sh` as `https://boldvideo.com/install.sh` over HTTPS
  before advertising the one-liner. Do not tag, publish, or merge as part of this
  preparation ticket.
