---
id: 11-viewer-roster
version: 1
prompt: 'Apply this customer roster without dropping anyone else: external_id,email,name,plan followed by a newline and customer-1042,maria@example.test,Maria Santos,pro. Keep those four column names and treat the second line as the only customer row.'
starting_state: reset
min_calls: 1
check:
  kind: api
  method: GET
  path: /viewers/lookup?external_id=customer-1042
  key: tenant
  jq: '.data.external_id == "customer-1042" and .data.email == "maria@example.test" and .data.name == "Maria Santos" and .data.traits.plan == "pro" and .data.traits.region == "ES"'
trap: false
chain: false
---

Apply this customer roster without dropping anyone else: external_id,email,name,plan followed by a newline and customer-1042,maria@example.test,Maria Santos,pro. Keep those four column names and treat the second line as the only customer row.

This measures CSV ingestion into viewer records with extra columns mapped to traits. Maria's existing region trait must survive the supplied plan change.
