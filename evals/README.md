# Cold-agent evaluations

Run from the repository root with Bun, Node 22+, and the selected agent CLI
installed on the host PATH. No additional packages are needed.

```sh
bun install
bun run build
bun evals/run.ts --agent claude --tasks 'evals/tasks/*.md' --repeat 3
bun evals/run.ts --agent amp --timeout 600 --concurrency 1
```

Use a **disposable Bold sandbox account**, never production. Real agents cost money
and may perform every write requested by the task. Tests never invoke real agents.

## Environment and reset

- `BOLDVIDEO_API_KEY`, `BOLDVIDEO_API_URL`: sandbox credentials and API base URL.
  The example version task needs neither; API checks require both.
- Claude: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`; optionally
  `ANTHROPIC_BASE_URL`. Amp: `AMP_API_KEY`, optionally `AMP_URL`.
  Existing login files are deliberately not inherited.
- `EVAL_RESET_CMD`: trusted shell command, default `echo skip`. Runs **before each
  attempt**, including repeats, with the host environment and repository cwd.
  It receives `EVAL_STARTING_STATE` (JSON-encoded front matter value) and
  `EVAL_TASK_ID`. It must reset the account and exit nonzero on failure.
  A skipped reset does not establish the task's state; only use it for stateless
  tasks or when state has already been prepared outside the harness.

Each attempt gets an empty working directory, fresh HOME/config/cache and a PATH
with just the built `boldvideo` plus curated `sh`, `bash`, `env`, and `node`
runtime links. Adding `/usr/bin` would accidentally enable curl and other tools.
Only Bold credentials, agent credentials, proxy and CA variables pass through;
repository paths, reset state, saved profiles and host settings do not.
Agents are launched by absolute path resolved before isolation. Claude exposes
only Bash and no MCP servers/settings; Amp uses fresh settings enabling only shell tools,
with no inherited MCP servers or skills. Do not add Bold instructions to the agent
prompt: it receives only the task's `prompt`.

This is PATH/context isolation, **not an OS security boundary**. Absolute paths,
shell login profiles, runtime networking and model training knowledge cannot be
blocked this way. Run untrusted tasks in an external container/VM. Amp's built-in
system prompt still applies; fresh task context is not a blank system prompt.

`--timeout` is positive integer seconds (default 600), covering reset + agent +
checker. Timed-out process groups, including shell children, are killed. Raw partial
transcripts remain. `--concurrency` defaults to 1 because the API sandbox is shared;
raising it permits overlapping resets/checks and invalidates measurements unless
your reset/API arrangement independently isolates each attempt.

## Manual debugging

```sh
printf 'Installed version: 0.1.0\n' > /tmp/boldvideo-answer.txt
bun evals/run.ts --agent manual --tasks 'evals/tasks/00-example.md' \
  --answer /tmp/boldvideo-answer.txt
bun evals/check.ts evals/tasks/00-example.md --answer /tmp/boldvideo-answer.txt
```

Manual prints the prompt and reads the existing answer file (the same file for
every selected task/repeat). Calls/tokens are zero placeholders: **manual scores
are debugging output, not agent performance**.

## Tasks and checks

Tasks are Markdown with YAML front matter: `id`, `version`, `prompt`,
`starting_state`, `min_calls`, `check`, `trap`, `chain`. Bun's built-in YAML parser
handles multiline prompts and nested values. Only `prompt` goes to the agent;
trap/chain are suite metadata, not extra instructions or dependencies to execute.
Every task/repeat starts a fresh agent, including tasks with chain metadata.

The runner delegates scoring to `bun evals/check.ts <task> --answer <file>`.
Exit 0 passes; nonzero fails and the first stderr line becomes the failure reason.
This interface allows the sibling BOLD-2041 suite to supply its own checker.
The fallback checker supplied here accepts:

```yaml
check:
  kind: answer
  contains: 0.1.0
# Or exact answer text (including newlines): equals: "0.1.0\n"
```

```yaml
check:
  kind: api
  path: /admin/videos/workshop-intro
  field: privacy_level # dot-separated JSON field; omit to compare whole response
  equals: private
```

API checks issue a read-only GET under `BOLDVIDEO_API_URL`, refusing redirects.
The example branch was absent when work started, so `00-example.md` is intentionally
kept as a stateless local smoke task; it is not a representative benchmark suite.

## Results and targets

Each run writes `evals/results/<timestamp>.json`, transcripts under a matching
directory, and overwrites `evals/results/latest.md` with the printed Markdown
summary. Results are gitignored; transcripts can contain sensitive task/API output.
Keep them private. Each attempt saves raw JSONL, stderr, final `.answer.txt`, reset
and check output separately. Numeric filenames map to `transcript_path` in JSON.

- Pass rate: passed attempts / all attempts, including reset/agent/check failures.
- Calls: unique assistant `tool_use` IDs (tool invocations, not shell commands).
- Calls ratio: median of each attempt's calls / its task's `min_calls`, not a ratio
  of medians. Smaller is better. Both raw call and baseline medians are shown.
- Tokens: median input + output; input includes cache-read/cache-creation tokens.
  Final aggregate usage takes precedence over assistant-message usage; repeated
  message/tool IDs are not counted twice. Dollar costs vary by agent/model and
  cache pricing, so tokens are the portable cost measure, not a billing estimate.
- Missing metrics are null, excluded from medians and explicitly reported, not
  silently scored as zero. Failed attempts retain any parseable partial usage.
- Duration: wall-clock milliseconds including reset, agent, check and cleanup.

`targets.json` contains minimum `pass_rate` (0–1) and maximum
`median_calls_ratio`. Initial **placeholders** are 0 and 999; Marcel must set real
targets before using this as a quality gate. Exit 1 means a target was missed,
there are no call measurements, or setup was invalid; otherwise exit 0.
With placeholder targets, individual failed tasks need not make a run exit 1.

## Adapters and tests

`adapters.ts` keeps one function per agent. Claude runs print/verbose stream-json
with Bash only. Amp runs execute/stream-json with shell-only isolated settings
(current `shell_command` tools and internal async aliases, plus legacy `Bash`).
Both use the Claude-compatible JSONL parser: assistant text/tool blocks plus final
result/usage. A missing result, error result or missing usage cannot pass a task.
To add an adapter, add one small process-to-result function, select it in `run.ts`,
and add a sanitized stream fixture with explicit expected metrics. Do not add an
adapter class or framework. `*-recorded.jsonl` fixtures are minimized recordings
from live stateless version smoke runs on 2026-10-19 (Claude Code 2.1.303 and the
installed Amp CLI). Session IDs, paths and unrelated metadata were removed or
normalized; answers and usage are unchanged. The other fixtures are synthetic
edge cases for deduplication and usage fallback. No test launches a real agent.

```sh
bun run build
bun test evals
bun run typecheck
bunx biome ci .
```

Tests cover both streams, duplicate IDs, cached usage, incomplete/error output,
PATH isolation with a shell test agent, process timeouts and summary math/rendering.
