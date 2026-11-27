# Releasing boldvideo

A release is staged by GitHub Actions and approved by a person. Nobody runs
`npm publish`, and no npm token is stored anywhere.

## How it works

1. A `vX.Y.Z` tag starts **Release** (`.github/workflows/release.yml`).
2. It checks the tag against `package.json`, runs CI on Linux and macOS, then
   stages `boldvideo` and `@boldvideo/cli` on npm with `npm stage publish`.
   npm trusts the workflow directly (trusted publishing over OIDC).
3. Nothing is public yet. A maintainer approves both staged versions on
   npmjs.com under **Staged Packages**, or with `npm stage list` and
   `npm stage approve <stage-id>`. Approval asks for 2FA.
4. `release-binaries.yml` runs on the same tag: standalone binaries, checksums,
   the GitHub release, and a Homebrew tap PR when `TAP_GITHUB_TOKEN` is set.

Both npm packages are configured as stage-only: the workflow can stage, and
cannot publish or move dist-tags by itself.

## One-time setup

On npmjs.com, for `boldvideo` and for `@boldvideo/cli`: Settings → Trusted
Publisher → GitHub Actions, organization `boldvideo`, repository `cli`, workflow
`release.yml`, no extra allowed actions.

A new trusted publisher has to see its first successful run within two days or
it expires. If it has expired, delete it, create it again, then tag.

The repository must be public: npm only attaches provenance to packages built
from a public repository.

## Each release

1. Start from an up-to-date `main` with the intended changes merged.
2. On a PR: bump `version` in `package.json`, and set the same version and the
   same `boldvideo` dependency in `packages/cli-alias/package.json` (CI rejects
   a mismatch). Date the entry in `CHANGELOG.md`. Regenerate the reference with
   `bun run docs:reference`.
3. Run the checks and merge:

   ```sh
   bun install --frozen-lockfile
   bun run build
   bun run typecheck
   bun test
   bun run ci:lint
   bun run release:check
   ```

4. Tag the merged commit:

   ```sh
   git switch main
   git pull --ff-only origin main
   version=$(node -p 'require("./package.json").version')
   git tag -a "v$version" -m "boldvideo $version"
   git push origin "v$version"
   ```

5. Watch **Actions → Release**. When it is green, approve `boldvideo` first and
   `@boldvideo/cli` second on npmjs.com.
6. Verify:

   ```sh
   npm view boldvideo version
   npm view @boldvideo/cli version
   npx --yes boldvideo@latest --version
   ```

7. Run **Actions → Smoke** with the version. It installs that version from npm
   and, when the `BOLDVIDEO_SMOKE_*` secrets point at a non-customer account,
   runs import, ask and search against it.
8. Copy `docs/cli-reference.md` to the docs site.

## If something goes wrong

- A staged version that should not ship: `npm stage reject <stage-id>`, fix,
  and tag a new version. A version number can be staged or published only once.
- A published version cannot be replaced. Publish a fix as the next version.
