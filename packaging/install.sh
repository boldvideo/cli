#!/bin/sh
set -eu

fail() { printf 'boldvideo: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "Supported systems: macOS and Linux." ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) fail "Supported architectures: arm64 and x64." ;;
esac
command -v curl >/dev/null 2>&1 || fail "Install curl first."
if command -v sha256sum >/dev/null 2>&1; then
  checksum=sha256sum
elif command -v shasum >/dev/null 2>&1; then
  checksum=shasum
else
  fail "Install sha256sum or shasum first."
fi

install_dir=${BOLDVIDEO_INSTALL_DIR:-"$HOME/.local/bin"}
temporary=$(mktemp -d)
staged=
cleanup() {
  rm -rf "$temporary"
  if [ -n "$staged" ]; then rm -f "$staged"; fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

# Resolve latest once so a concurrent release cannot mix binary/checksum versions.
release_url=$(curl -fsSL --proto '=https' --proto-redir '=https' \
  -o /dev/null -w '%{url_effective}' https://github.com/boldvideo/cli/releases/latest)
tag=${release_url##*/}
case "$tag" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) fail "Cannot resolve the latest stable release." ;;
esac
base="https://github.com/boldvideo/cli/releases/download/$tag"
asset="boldvideo-$os-$arch"
curl -fsSL --proto '=https' --proto-redir '=https' "$base/$asset" -o "$temporary/$asset"
curl -fsSL --proto '=https' --proto-redir '=https' "$base/checksums.txt" -o "$temporary/checksums.txt"
expected=$(awk -v name="$asset" '$2 == name && NF == 2 { print $1 }' "$temporary/checksums.txt")
case "$expected" in
  ''|*[!0-9a-f]*) fail "Missing or invalid checksum for $asset." ;;
esac
[ "${#expected}" -eq 64 ] || fail "Invalid SHA-256 length for $asset."
if [ "$checksum" = sha256sum ]; then
  actual=$(sha256sum "$temporary/$asset")
else
  actual=$(shasum -a 256 "$temporary/$asset")
fi
[ "${actual%% *}" = "$expected" ] || fail "Checksum verification failed; nothing installed."

# Stage on the destination filesystem, then replace atomically. Never invoke sudo.
mkdir -p "$install_dir"
staged=$(mktemp "$install_dir/.boldvideo.XXXXXX")
cp "$temporary/$asset" "$staged"
chmod 755 "$staged"
mv -f "$staged" "$install_dir/boldvideo"
# The short name, unless something else called bold already lives here.
if [ ! -e "$install_dir/bold" ] || [ -L "$install_dir/bold" ]; then
  ln -sf boldvideo "$install_dir/bold"
fi
staged=
printf 'Installed boldvideo %s to %s/boldvideo\n' "$tag" "$install_dir"
case ":$PATH:" in
  *:"$install_dir":*) ;;
  *) printf 'Add %s to PATH in your shell profile, then run boldvideo --help.\n' "$install_dir" ;;
esac
