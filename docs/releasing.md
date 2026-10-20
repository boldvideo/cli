# Releasing boldvideo

Publish only through GitHub Actions. Never run `npm publish` locally.

## One-time setup (Marcel)

1. Ensure the npm account can publish the public, unscoped package `boldvideo`.
   Create a granular npm access token with package write permission (including
   permission to create the package for its first release) and **Bypass 2FA**
   enabled for noninteractive publishing. Keep account 2FA enabled. The package's
   publishing policy must allow token-based publishing, not require interactive
   2FA or disallow tokens. Store the token as the GitHub repository Actions
   secret **`NPM_TOKEN`**. Never commit it or paste it into logs.
2. Provenance requires a public GitHub repository and public npm package. This
   repository is currently private: arrange approval to make it public before
   the first release. Keep `package.json`'s repository URL matching
   `https://github.com/boldvideo/cli.git`.
   The workflow uses GitHub-hosted runners, `id-token: write`, and
   `npm publish --provenance --access public`; `publishConfig` also enables both.
   No npm trusted-publisher configuration is needed for this token-based flow.
   After publishing, verify the provenance badge on npm.
3. Marcel reserves the `@boldvideo` scope and grants the same token publish
   access to `@boldvideo/cli`. This compatibility package pins the exact
   `boldvideo` version and exposes the same binary. Both packages are public
   and published with provenance, main package first.
4. For the post-publish demo smoke, set repository Actions secrets
   **`BOLDVIDEO_SMOKE_API_KEY`**, **`BOLDVIDEO_SMOKE_API_URL`**, and
   **`BOLDVIDEO_SMOKE_YOUTUBE_URL`**. Use a dedicated **non-customer account**
   and a small, reusable YouTube source that the account may import. These
   credentials authorize a real import; never point them at customer data.
   If any secret is missing, live smoke steps are skipped with a notice.

## Each release

1. Start from up-to-date `main`. Wait until the intended commands have merged.
   Bump `version` in `package.json` on a PR; do not use `npm version` to create
   an unchecked tag. For the first release, the existing `0.1.0` is correct.
   Set `packages/cli-alias/package.json`'s version and `boldvideo` dependency
   to the identical version; CI rejects mismatches.
2. Update `CHANGELOG.md`: replace the version's **Unreleased** label with its
   release date and confirm the listed commands actually ship. Remove the README
   pre-release note and stale baseline warnings only when v0.1.0 ships.
   Video edits, collections, folder import, viewers and insights are excluded
   unless merged into this cut. Generate the final 0.1.0 stability baseline with
   `bun run baseline:generate`, review it, and freeze the shipped command/flag
   list. Do not regenerate it later to hide removals.
3. Run the checks and merge the reviewed release-preparation PR:

   ```sh
   bun install --frozen-lockfile
   bun run build
   bun run typecheck
   bun test
   bun run ci:lint
   bun run release:check
   ```

4. On the merged commit, create and push the matching version tag:

   ```sh
   git switch main
   git pull --ff-only origin main
   version=$(node -p 'require("./package.json").version')
   git tag -a "v$version" -m "boldvideo $version"
   git push origin "v$version"
   ```

5. Watch **Actions → Release** (or `gh run list --workflow release.yml`, then
   `gh run watch <run-id>`). A mismatched tag fails before checks. The workflow
   runs CI on Linux/macOS and package smoke tests on Node 22/24, then publishes
   both checked tarballs with provenance. Missing `NPM_TOKEN` fails with a named
   error and prevents publication. After publishing, the live smoke installs
   the exact tagged `boldvideo` version from npm and runs the README import
   (with `--wait`), ask, and search demo against the smoke account. Any failed
   command fails the workflow and blocks GitHub release creation. If credentials
   are absent, it emits a notice and allows release creation without live smoke.
   Ordinary branch pushes never run this workflow. `release-binaries.yml` runs
   on the same tag, builds standalone binaries, attaches them to the same GitHub
   release and opens the Homebrew tap PR when `TAP_GITHUB_TOKEN` is set.
6. Verify publication:

   ```sh
   npm view boldvideo version
   npm view @boldvideo/cli version
   npx --yes boldvideo --version
   npx --yes @boldvideo/cli --version
   ```

   Confirm the registry version matches the tag, inspect npm's provenance badge,
   and check that the GitHub release has generated notes and the matching
   `boldvideo-<version>.tgz` and `boldvideo-cli-<version>.tgz` assets.

Publishing cannot be rolled back if the alias publication, live smoke, or GitHub
release creation fails. Do not blindly rerun the publish job or move the tag:
npm versions are immutable. Inspect the logs and arrange recovery of only the
failed stage. A failed live smoke should be rerun by itself once resolved.
