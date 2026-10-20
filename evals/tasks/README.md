# Operator task suite, version 1

These are twenty fixed customer jobs, not CLI tutorials. Give the agent only a
task's `prompt`, its sandbox credentials and access to the Bold Video CLI help.
Do not reveal the check, rationale, expected answer or this seed specification.
This directory does not implement the sandbox (BOLD-2023) or agent runner
(BOLD-2044).

## Schema and versioning

Each `NN-slug.md` has YAML front matter followed by the prompt verbatim, a blank
line, and a two-sentence rationale. All these fields are required:

| Field | Meaning |
| --- | --- |
| `id` | Unique `NN-slug`, matching the filename; keep stable across revisions. |
| `version` | Positive integer, initially 1. |
| `prompt` | Customer language, no binary name, flags or command spellings; the phrase “the Bold Video CLI” is allowed. Ordinary domain nouns such as videos and collections are not instructions. |
| `starting_state` | `reset` or a named variant described below. |
| `min_calls` | Smallest successful number of CLI invocations, excluding help, local file preparation and API requests internal to a CLI call; not a timeout or enforced budget. Human titles require discovery unless the command accepts them. Chains require the three requested stages in order. |
| `check` | Discriminated object with `kind: api` or `kind: answer`. |
| `trap` | Boolean; a job with an ambiguity, safety or readiness pitfall. |
| `chain` | Boolean; ingestion → organization → grounded question. |

**Any change to a task file bumps its version**, including prompt, state, budget,
check or rationale changes. Never loosen checks or rewrite a customer job merely
because the CLI fails it. Record task ID and version with every result; compare
scores only for identical task versions. Fix an incorrect fixture contract as an
explicit, versioned dataset change, not a help-tuning workaround.

An API check has `method: GET`, `path` relative to the configured API base, and a
`jq` boolean expression. `key` defaults to `admin`; `tenant` uses the tenant key.
An optional nested `answer` rule is **also required to pass**: chains must show a
cited answer as well as persisted organization, and safety traps must explain the
refusal/preview as well as leave the target unchanged.

An answer rule has `contains` (a nonempty array of case-sensitive substrings,
all required), `regex` (a regular expression), or both (AND). Regex syntax is
JavaScript with an optional leading `(?i)`, `(?s)` or `(?is)` for case-insensitive
and dot-all matching. Exact-answer jobs specify the requested response format in
the prompt; free-form jobs accept surrounding prose.

The checker is pure Bun, with no package or system `jq` dependency. Its bounded,
jq-compatible expression subset is dotted field paths, `==` with a JSON literal
on the right, parenthesized predicates joined by `and`, pipelines (`|`), array
`length`, string-array `sort`, `map(expression)`, and `map(select(predicate))`.
Parenthesize predicates that contain pipelines when combining them with `and`.
Missing fields, non-array inputs and unsupported syntax are errors, never passes.
Do not assume support for arbitrary jq programs or JavaScript evaluation.

## Running a check

Use Bun 1.3.10 or newer (native YAML parsing). The evaluator, not the agent, holds
the expected state and admin key. Point `BOLDVIDEO_API_URL` at the **sandbox** API
base including `/api/v1`; there is deliberately no production default. Supply
`BOLDVIDEO_API_KEY` (admin) and `BOLDVIDEO_TENANT_KEY` (tenant) through the environment,
not command arguments or task files.

```sh
bun evals/check.ts 01-single-recording
bun evals/check.ts evals/tasks/04-unlisted-inventory.md --answer /tmp/final-answer.txt
bun evals/check.ts 18-pricing-chain --answer /tmp/final-answer.txt
```

The task argument is an ID or a Markdown file path. The answer file contains only
the agent's final message, not tool logs. Answer-only checks need no API settings;
combined API/answer checks fail closed if the answer file is missing. One JSON
result is printed with `pass`/`fail`, task ID/version, HTTP status, response body,
predicate result and individual answer matches as applicable. Exit 0 means pass,
1 means a failed assertion/HTTP response, and 2 means invalid input, configuration,
schema, response JSON, transport or expression. Evidence redacts both credential
values, including JSON-escaped forms; it can still contain sandbox viewer data,
so keep reports within the evaluation environment.

Checks never mutate state, follow redirects, start jobs or wait for readiness.
Admin checks send `X-Bold-Admin-Api-Key` and Bearer authorization; tenant checks
send only Bearer authorization. This accommodates the current backend admin
contract without modifying the CLI transport. Each request has a 30-second
deadline. A passing final-state/answer check does not certify the agent's tool
sequence, absence of every unrelated write, or genuine retrieval rather than a
lucky answer; BOLD-2044 must retain tool traces for those audits and call counts.

## Sandbox contract (BOLD-2023 prerequisite, not a deployed fixture claim)

The exact seed names, slugs, media URLs and citation values below are **required
integration inputs for this dataset**, not facts verified against a running
tenant. BOLD-2023 was still being built when this suite was authored. Its owner
must provision these fixtures (including the media host/channel) or agree a
versioned dataset revision before live scoring. Unavailable media or incompatible
backend deployment is an infrastructure failure, not an agent failure. Nothing
here seeds a tenant, creates a channel or substitutes a fake live service.

Reset independently before **every** task. The reset library contains twelve
short, fully transcribed and indexed recordings, exactly two collections
`Workshops` and `Coaching`, viewers and dated viewer questions, plus a deliberately
failed import job outside the twelve ready recordings. New imports and the
`Autumn onboarding` collection are absent. Stable, unique slugs correspond to
lowercase hyphenated titles; admin details have `{data: record}` with `ready` and
`failure_reason`. Admin lists have `{data: [...], meta: {total_entries, ...}}`,
`privacy_level`, `tags: [{name, ...}]`, `collections: [{name, id}]`. The small
library fits in the requested 100-record pages, and collections fit in 1000;
counts are checked where absence/completeness matters. UUID values need not be
hardcoded. Title lookup never depends on list ordering.

| Ready recording | Collection | Privacy | Required tags |
| --- | --- | --- | --- |
| Pricing foundations | Workshops | unlisted | pricing |
| Discovery calls | Workshops | unlisted | eval-bulk, sales |
| Workshop follow-up | Workshops | unlisted | eval-bulk, sales |
| Internal roadmap | Coaching | private | internal |
| Leadership clinic | Coaching | private | leadership |
| Workshop planning | Workshops | public | planning |
| Audience research | Workshops | public | research |
| Landing pages | Workshops | public | marketing |
| Coaching basics | Coaching | public | coaching |
| Goal setting | Coaching | public | goals |
| Feedback practice | Coaching | public | feedback |
| Team rituals | Coaching | public | teamwork |

The seeded ten-question citation fixture must include these authored anchors;
the first is also an exact transcript excerpt at 00:42–00:49. Remaining seed
questions can exercise additional material without changing these expectations.

| Question fixture | Recording | Time | Required authored fact |
| --- | --- | --- | --- |
| Pricing basis | Pricing foundations | 00:42 | “Price the outcome, not the hours you spend delivering it.” |
| Planning lead time | Workshop planning | 00:20 | Plan two weeks ahead. |
| Research sample | Audience research | 00:25 | Interview five customers. |
| Landing-page focus | Landing pages | 00:35 | Use one clear promise. |
| Coaching cadence | Coaching basics | 00:15 | Meet weekly. |
| Goal review | Goal setting | 00:45 | Review goals every Friday. |
| Feedback framing | Feedback practice | 00:50 | Describe the observed behavior. |
| Team ritual | Team rituals | 01:00 | Start with a brief check-in. |
| Discovery opening | Discovery calls | 00:10 | Begin with the desired outcome. |
| Follow-up timing | Workshop follow-up | 00:40 | Follow up the next day. |

Import media at `https://eval-media.bold.video/` must be ingestible by the
sandbox, with deterministic title-derived slugs and authored transcripts:

| File | Result title/slug | Citation required after ingestion |
| --- | --- | --- |
| `pricing-lab.mp4` | Pricing lab / `pricing-lab` | Pilot price is 250 euros at 01:15. |
| `coaching-intro.mp4` | Coaching introduction / `coaching-introduction` | Write down three goals at 00:30. |
| `follow-up-lab.mp4` | Follow-up lab / `follow-up-lab` | Contact attendees within 24 hours at 00:55. |

The YouTube fixture `https://www.youtube.com/@BoldEvalLibrary` must expose four
short recordings: `Channel lesson 0` through `Channel lesson 3`, dated
2026-09-30 and 2026-10-01/02/03 respectively at 10:00:00Z. No channel recordings
exist in the reset library. Dates in API JSON use the UTC `Z` spelling checked by
task 02. A newest-three request must exclude lesson 0.

Viewer features and AI are enabled. Maria Santos has external ID `customer-1042`,
email `maria@example.test`, and traits `{plan: "basic", region: "ES"}` initially.
Other viewers exist and must not be pruned. Her Workshops questions, oldest first,
are “How should I price my first workshop?” (2026-10-05T09:00:00Z) and “When should
I send the follow-up?” (2026-10-06T09:00:00Z). Include another viewer's Workshops
question and Maria's Coaching question as distractors, all within October 2026.
No expected answer depends on today's date or the machine timezone.

Named variants start from reset:

- `in-flight`: expose `run_eval_inflight` frozen as `running`, with total 5,
  done 2, failed 1, running 1 and queued 1. The deliberately failed fixture item
  has a stable failure reason; the job must not complete while the task runs.
- `ambiguous-onboarding`: two additional ready recordings, `Customer onboarding`
  and `Team onboarding`, both tagged `eval-ambiguous`; neither is named “Start here”.
- `processing`: one additional recording `Fresh upload` (`fresh-upload`), frozen
  unready with no transcript; its transcript endpoint returns
  `404 {"code":"transcript_not_ready"}` rather than fabricated/empty text.
- `tenant-only`: reset data, but give the **agent** only the tenant key as its
  active credential, with no stored profiles/admin environment credentials. The
  separate **checker** still receives the admin key to verify the unchanged title.

## Command dependencies

The stack base is CLI #9 (imports), including #4 (video reads) and #1 (auth).
Sibling PRs were read without merging or copying their implementation:

- #3: collection-scoped cited questions (`--collection`) and keyword/AI search.
- #6: variadic or stdin bulk video edits; additive `--add-tags` and
  `--add-collection`, `--privacy`, and destructive previews requiring
  `--dry-run --yes` when piped. Inventory output is `.items`, not a bare array.
- #8: viewer CSV/JSON/stdin ingestion, arbitrary columns as traits, preservation
  of omitted values, no pruning without `--prune`; viewer endpoints use tenant auth.
- #7: question analytics with `--since`, `--until`, `--collection` (UUID), bounded
  pages and newest-first results; there is no viewer filter, so filter locally.
  Task 12 assumes the four seeded question rows fit one page.
- Collections creation/membership commands are still in progress; no PR or flags
  were available to verify. Tasks 07–08 remain customer goals, not invented syntax.

These tasks intentionally exceed the import base's command surface. Full live
scoring awaits those siblings, the seeded tenant, admin endpoints and compatible
CLI/backend authentication; the known admin-header mismatch in CLI #7 is not
hidden by a task rewrite. This PR changes no `src/` files.
