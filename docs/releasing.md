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

## Each release

1. Start from up-to-date `main`. Wait until the intended commands have merged.
   Bump `version` in `package.json` on a PR; do not use `npm version` to create
   an unchecked tag. For the first release, the existing `0.1.0` is correct.
2. Update `CHANGELOG.md`: replace the version's **Unreleased** label with its
   release date and confirm the listed commands actually ship. Remove the README
   pre-release note and stale baseline warnings only when v0.1.0 ships.
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
   the checked tarball. Missing `NPM_TOKEN` fails with a named error and prevents
   GitHub release creation. Ordinary branch pushes never run this workflow.
6. Verify publication:

   ```sh
   npm view boldvideo version
   npx --yes boldvideo --version
   ```

   Confirm the registry version matches the tag, inspect npm's provenance badge,
   and check that the GitHub release has generated notes and the matching
   `boldvideo-<version>.tgz` asset.

If npm published successfully but GitHub release creation failed, do not rerun
the publish job or move the tag: npm versions are immutable. Inspect the logs
and arrange recovery of the GitHub release separately.
