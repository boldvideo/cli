# Cold-agent evaluations

Run from the repository root with Bun, Node 22+, and the selected agent CLI
installed on the host PATH. No additional packages are needed.

```sh
bun install
bun run build
bun evals/run.ts --agent claude --mode cold --tasks 'evals/tasks/*.md'
bun evals/run.ts --agent amp --model "$AMP_EVAL_MODEL" --timeout 600 --concurrency 1
```

Use a **disposable Bold sandbox account**, never production. Real agents cost money
and may perform every write requested by the task. Tests never invoke real agents.

## Environment and reset

- `BOLDVIDEO_API_KEY`, `BOLDVIDEO_API_URL`, `EVAL_SANDBOX_SLUG`: required for
  **every run**, including the example and manual mode. Before every attempt,
  the harness calls the built `boldvideo whoami --json` with the configured key.
  It refuses to run the reset command or agent unless `account_slug` exactly
  matches `EVAL_SANDBOX_SLUG`. Missing credentials, HTTP errors and mismatches
  invalidate the run and exit 1 even with permissive scoring targets.
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
with no inherited MCP servers or skills. In cold mode, the agent receives only
the task's `prompt`.

## Modes, repeats and models

- `--mode cold` (default): no web search or skill instructions.
- `--mode one-search`: additionally enables Claude's `WebSearch` or Amp's
  `web_search` and appends “You may use web search at most once.” Zero or one
  search is valid. Unique search tool IDs and provider-reported search totals
  are counted without double-counting. More than one invalidates the attempt
  and exits 1 regardless of targets, even if the answer check would pass.
- `--mode skill`: copies the repository's `skill/SKILL.md` into `skill/SKILL.md`
  in the temporary working directory, and includes that file's instructions in
  the prompt so shell-only agents can use it without a separate read tool.
  BOLD-2046 will replace the checked-in placeholder. Web search stays disabled.

`--repeat` defaults to **3** independent attempts per task. The report groups
pass rate and median total tool calls per task/version/mode/model and per mode
overall. Each invocation selects one mode; run again with another mode to compare.

`--model` selects the Claude model and provides a reporting fallback if a stream
omits its model name. Stream-reported names take precedence over the flag.
The installed Amp CLI has no model-selection flag and omits model names in its
stream; for Amp, supply its actual configured model using `--model` (for example
through `$AMP_EVAL_MODEL`). This labels the run, **not** a model override for Amp.
A non-manual agent run without a reported/fallback model is invalid, not silently
priced as an unknown model. Manual mode is labeled `manual`.

This is PATH/context isolation, **not an OS security boundary**. Absolute paths,
shell login profiles, runtime networking and model training knowledge cannot be
blocked this way. Run untrusted tasks in an external container/VM. Amp's built-in
system prompt still applies; fresh task context is not a blank system prompt.

`--timeout` is positive integer seconds (default 600), covering identity preflight,
reset, agent and checker. Timed-out process groups, including shell children, are killed. Raw partial
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
- Calls: unique assistant `tool_use`/`server_tool_use` IDs (tool invocations, not
  shell commands). `cli_calls` separately counts shell tool calls whose command
  starts with `boldvideo` followed by whitespace or end-of-string. A shell call
  containing several CLI commands still counts once. Identity preflights, reset
  commands and checkers are harness overhead, not agent CLI/tool calls.
- Calls ratio: median of each attempt's calls / its task's `min_calls`, not a ratio
  of medians. Smaller is better. Both raw call and baseline medians are shown.
- Tokens: median input + output; input includes cache-read/cache-creation tokens.
  Final aggregate usage takes precedence over assistant-message usage; repeated
  message/tool IDs are not counted twice.
- Estimated USD cost: `(input_tokens × input_per_million + output_tokens ×
  output_per_million) / 1,000,000`, using the model entry in `prices.json`, or
  `default` for unmatched model names. Prices are **placeholders Marcel must
  fill**, not current vendor prices. Cached input uses the same blended input
  rate; search fees and other non-token costs are excluded. Each attempt records
  `cost_usd`; the report prints the total, identifies unpriced attempts, and the
  JSON snapshots the price table for reproducibility.
- Missing metrics are null, excluded from medians and explicitly reported, not
  silently scored as zero. Failed attempts retain any parseable partial usage.
- Duration: wall-clock milliseconds including reset, agent, check and cleanup.

`targets.json` contains minimum `pass_rate` (0–1) and maximum
`median_calls_ratio`. Initial **placeholders** are 0 and 999; Marcel must set real
targets before using this as a quality gate. Exit 1 means a target was missed,
there are no call measurements, or setup was invalid; otherwise exit 0.
With placeholder targets, individual failed tasks need not make a run exit 1;
invalid safety/search/model attempts always do.

The runner compares against the most recent results JSON for the same agent and
mode. Matching task versions and model names are compared across repeats:
lower pass rate, higher median tool calls or higher median tokens are called out
as regressions. A different task version/mode/model is not a comparable baseline.
Regressions are informational; targets and validity determine exit status.

## Nightly runs and just

`just eval` delegates to `bun evals/run.ts`; `just eval-one
evals/tasks/00-example.md` selects one task (still three repeats by default).

`.github/workflows/eval-nightly.yml` runs cold mode at 03:17 UTC daily, serially,
with three repeats. Configure repository secrets `BOLDVIDEO_API_KEY`,
`BOLDVIDEO_API_URL`, `EVAL_SANDBOX_SLUG` and `ANTHROPIC_API_KEY`. If any are absent,
it emits a notice and skips without failing the default branch. An optional
`EVAL_RESET_CMD` secret supplies sandbox reset logic; the default is still
`echo skip`, suitable only for stateless or externally prepared tasks.

The workflow restores the previous JSON baseline from an Actions cache, saves
the latest baseline even when a score fails, and uploads `evals/results/` for
14 days even on failure. No agent runs or secrets are needed for normal PR tests.

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
