## Authenticate

Sign in with your browser:

```sh
boldvideo login
```

It shows a short code and opens Bold. Check the code matches, pick the workspaces to allow, and approve. The CLI can then do what you can do in the admin. Each workspace is saved as a profile named after its slug: `boldvideo profiles use <slug>` switches the default, and `-t <slug>` runs one command in another workspace. `boldvideo logout` ends the sign-in.

For servers and CI, where nobody can open a browser, use a key instead: set `BOLDVIDEO_API_KEY`, or pipe it to `boldvideo login --token -`. Inject it from a secret store, never from a committed script or logged argument.

| Key | Where it comes from | What it covers |
| --- | --- | --- |
| Admin key (`bold_admin_…`) | **Settings → Developer → Admin keys**, or `boldvideo login`. | Everything: import, edit and delete videos, manage collections, read viewer questions. |
| API key (`bold_live_…`) | **Settings → Developer → API keys**. | `whoami`, `ask`, `search`, `api`, `viewers`, and reading published videos, transcripts and collections. |
