# Install the boldvideo skill

From a checkout of this branch (the CLI itself must also be installed):

- Claude Code: `mkdir -p ~/.claude/skills/boldvideo && cp -R skill/. ~/.claude/skills/boldvideo/`
- Amp: `amp skill add --global ./skill --name boldvideo`

Both install the complete directory, including recipes, under the frontmatter
name `boldvideo`. Start a new session after installing.

The eval harness installs this directory in its isolated workspace in `skill`
mode and supplies `SKILL.md` to the agent. Cold mode does not install it.
Recipes use Bash, Python 3 and jq; the harness's restricted runtime does not
promise these recipe dependencies. It evaluates CLI guidance, not a migration
against a customer's live library.
