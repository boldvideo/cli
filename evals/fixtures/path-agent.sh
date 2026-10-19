#!/bin/sh
if curl --version 2>/dev/null; then
  echo 'curl leaked onto PATH' >&2
  exit 1
fi
if command -v git || command -v amp || command -v claude; then
  echo 'extra tooling leaked onto PATH' >&2
  exit 1
fi
boldvideo --version
