## Authentication and keys

Create an API key in Bold under **Settings → Developer**. Do not put real keys
in shell history, scripts, source control or shared logs. To verify and store a
key, run the following in a terminal and enter the key at the hidden prompt:

```sh
boldvideo login
boldvideo whoami
```

For automation, inject `BOLDVIDEO_API_KEY` through your runner's secret store.
It takes precedence over both `--profile` and the active saved profile. Login
also accepts a key on stdin, so a secret manager can pipe it directly without
putting it in an argument. `--token` is available but exposes the key in process
arguments and potentially shell history.

Use named profiles to keep accounts separate:

```sh
boldvideo login --profile customer-demo
boldvideo profiles list
boldvideo profiles use customer-demo
boldvideo whoami --profile customer-demo
```

Login verifies the key before saving it; without `--profile`, the account slug
becomes the profile name. Profiles live in `boldvideo/profiles.json` under
`$XDG_CONFIG_HOME`, `~/.config` by default, or `%APPDATA%` on Windows. On POSIX,
the directory is mode 0700 and the file is mode 0600. Treat this file as a secret.

`boldvideo logout --yes` removes the active stored profile, not an environment
key. Unset `BOLDVIDEO_API_KEY` separately. Removing the active profile leaves no
active default; it does not switch to another account. Revocation of a leaked
key must happen in Bold, not just by removing the local copy.

Authenticated commands use the resolved key; admin commands require an admin
key. Help, version, login, local profile management and docs work without a key.
`BOLDVIDEO_API_URL` overrides `https://app.boldvideo.io/api/v1`; use it only for
a trusted server because authenticated requests send the key there. The OpenAPI
schema is at `https://app.boldvideo.io/api/openapi`.

`boldvideo docs cli` renders the installed command reference offline. Other docs
topics require network access; `BOLDVIDEO_DOCS_URL` overrides the docs origin
(`https://docs.boldvideo.com`). Documentation requests never send API credentials.
