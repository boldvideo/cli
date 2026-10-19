# Publish the CLI reference

1. In `boldvideo/cli`, run `bun install --frozen-lockfile` and
   `bun run docs:reference`. Review and commit `docs/cli-reference.md` alongside
   any spec or editorial changes. Re-run on every release and after command
   branches merge. Before publishing runnable video recipes, replace the pending
   workflows in `recipes.md` once their commands are registered and check them
   with the real parser.
2. Copy `docs/cli-reference.md` unchanged into `boldvideo/docs` at
   `content/docs/cli.mdx`. The YAML front matter must remain first for Fumadocs;
   its first line is the generated/version comment (HTML comments are invalid
   MDX). The body is plain Markdown, with no MDX imports or components.
3. Open a PR in `boldvideo/docs` with the copied page. Review it there before
   merging; this generator does not publish the site automatically.

Edit the Markdown parts in this directory, not the generated file. Command
names, arguments, flags, examples and the exit-code table come from the shared
renderer and registry. `exit-codes.md` adds explanation below that table. This
README is publishing guidance and is not included in the generated page.
