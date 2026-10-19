## Authenticate

Create a key in Bold under **Settings → Developer**, then run `boldvideo login` and enter it at the hidden prompt; for automation, inject `BOLDVIDEO_API_KEY` from a secret store (it overrides `--profile` and the active saved profile), never from a committed script or logged argument.
