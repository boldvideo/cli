# Install the boldvideo skill

The skill teaches a coding agent to run a Bold library with the `boldvideo` CLI.
Install the CLI first (`npm install -g boldvideo`), then the skill:

```sh
npx skills add boldvideo/cli
```

That finds `skills/boldvideo/` in this repository and installs it for the agents
on your machine. To place it by hand, copy the whole directory, recipes included:

- Claude Code: `mkdir -p ~/.claude/skills/boldvideo && cp -R skills/boldvideo/. ~/.claude/skills/boldvideo/`
- Codex, Cursor, Gemini CLI, Amp: `mkdir -p ~/.agents/skills/boldvideo && cp -R skills/boldvideo/. ~/.agents/skills/boldvideo/`

Start a new session after installing. The directory name and the `name` in
`SKILL.md` must stay `boldvideo`.

The eval harness installs this directory in its isolated workspace in `skill`
mode and supplies `SKILL.md` to the agent. Cold mode does not install it.
Recipes use Bash, Python 3 and jq; the harness's restricted runtime does not
promise these recipe dependencies. It evaluates CLI guidance, not a migration
against a customer's live library.
