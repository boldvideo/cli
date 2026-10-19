Check the process exit status before parsing a success response. Exit 3 covers
both missing/invalid authentication and insufficient permissions. HTTP 404 maps
to exit 4; HTTP 408/504 and wait deadlines map to exit 5. Other API failures use
exit 1. Errors include a stable code and a next-command hint on stderr; scripts
should branch on the exit status or code, not the human-readable message.

```sh
boldvideo help exit-codes --json
```
