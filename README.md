# boldvideo

The command-line door to [Bold](https://boldvideo.com), for operators and their coding agents.

```sh
npx boldvideo import youtube https://www.youtube.com/@takimoore --wait
npx boldvideo ask "What does Taki say about paid workshops versus free webinars?"
```

Install once:

```sh
npm install -g boldvideo
export BOLDVIDEO_API_KEY=...   # Settings → Developer in your Bold account
boldvideo --help
```

Everything the admin UI can do, from a shell. JSON when piped, tables when not. `--help` on every command, with examples that work.

Status: pre-release. Commands land one at a time; see `boldvideo --help` for what exists today.

MIT.
