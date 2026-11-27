## Authenticate

Bold has two kinds of API key. The CLI accepts either, and `boldvideo whoami`
shows which kind is active (`key_kind`).

| Key | Where it comes from | What it covers |
| --- | --- | --- |
| API key | Create it in Bold under **Settings → Developer**. | `whoami`, `ask`, `search`, `api`, `viewers`, and reading published videos, transcripts and collections. |
| Admin key | Bold issues it on request. It cannot be created in Settings. | Everything above, plus `import`, `videos update`, `publish`, `unpublish` and `delete`, `collections create`, `rename`, `add` and `remove`, `insights`, and listing private or unpublished videos. |

Run `boldvideo login` and enter the key at the hidden prompt. For automation, inject `BOLDVIDEO_API_KEY` from a secret store (it overrides `--profile` and the active saved profile), never from a committed script or logged argument.
