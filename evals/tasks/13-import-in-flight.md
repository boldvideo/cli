---
id: 13-import-in-flight
version: 1
prompt: 'How far along is the channel job run_eval_inflight? Tell me whether it is finished and how many recordings are done and failed, without starting another job.'
starting_state: in-flight
min_calls: 1
check:
  kind: answer
  regex: '(?is)^(?=.*(?:running|not finished|still in progress))(?=.*2\s+(?:recordings?\s+)?done)(?=.*1\s+(?:recordings?\s+)?failed).*$'
trap: false
chain: false
---

How far along is the channel job run_eval_inflight? Tell me whether it is finished and how many recordings are done and failed, without starting another job.

This measures observation of an existing asynchronous job rather than resubmission of its source. The named variant freezes a running job with two done items and one failed item.
