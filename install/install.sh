#!/usr/bin/env bash
# Installs X Growth for the current user on macOS or Linux. No sudo needed.
#
# Grok Bot runs this on the user's computer (the user approves it). It:
#   1. installs Bun in ~/.bun if it's missing
#   2. downloads the latest release bundle for this OS/arch and verifies its SHA-256
#   3. unpacks it to <install dir>/app; data lives in <install dir>/data,
#      which updates never touch
#        macOS  ~/Library/Application Support/XGrowth
#        Linux  ${XDG_DATA_HOME:-~/.local/share}/XGrowth
#   4. runs `xstats setup`, `xstats autostart enable` and `xstats start`
#   5. opens http://127.0.0.1:3000/setup in the default browser
#
#   curl -fsSL https://github.com/karthi-98/x-growth/releases/latest/download/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --handle designwkarthick --timezone Asia/Kolkata --json
#
# See install/README.md.
set -euo pipefail

REPO="karthi-98/x-growth"
VERSION="latest"
INSTALL_DIR=""
PORT=""
HANDLE=""
TIMEZONE=""
FROM_FILE=""
AUTOSTART=1
START=1
OPEN=1
JSON=0

usage() {
  cat <<'EOF'
Usage: install.sh [options]
  --version <x.y.z>      release to install (default: latest)
  --install-dir <path>   folder that gets app/ and data/
  --port <n>             port on 127.0.0.1 (default 3000)
  --handle <handle>      passed to `xstats setup`
  --timezone <iana tz>   passed to `xstats setup`
  --from-file <archive>  install this bundle (SHA256SUMS must sit next to it)
  --no-autostart         don't start X Growth at login
  --no-start             don't start it now
  --no-open              don't open the browser
  --json                 print one JSON object at the end
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --handle) HANDLE="$2"; shift 2 ;;
    --timezone) TIMEZONE="$2"; shift 2 ;;
    --from-file) FROM_FILE="$2"; shift 2 ;;
    --no-autostart) AUTOSTART=0; shift ;;
    --no-start) START=0; shift ;;
    --no-open) OPEN=0; shift ;;
    --json) JSON=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

step() { [ "$JSON" = 1 ] || printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed."; }

need curl
need tar

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) platform_os="mac"; default_dir="$HOME/Library/Application Support/XGrowth" ;;
  Linux) platform_os="linux"; default_dir="${XDG_DATA_HOME:-$HOME/.local/share}/XGrowth" ;;
  *) die "Unsupported OS: $os. On Windows, use install.ps1." ;;
esac
case "$arch" in
  x86_64 | amd64) platform_arch="x64" ;;
  arm64 | aarch64) platform_arch="arm64" ;;
  *) die "Unsupported CPU: $arch" ;;
esac
# An x64 shell under Rosetta on Apple silicon: Bun installs natively, so use the arm64 build.
if [ "$os" = "Darwin" ] && [ "$platform_arch" = "x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  platform_arch="arm64"
fi
platform="$platform_os-$platform_arch"
case "$platform" in
  mac-arm64 | mac-x64 | linux-x64) ;;
  *) die "There is no X Growth build for $platform yet." ;;
esac
INSTALL_DIR="${INSTALL_DIR:-$default_dir}"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/xgrowth-install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# 1. Bun ----------------------------------------------------------------------
find_bun() {
  if command -v bun >/dev/null 2>&1; then command -v bun
  elif [ -x "$HOME/.bun/bin/bun" ]; then echo "$HOME/.bun/bin/bun"
  fi
}
BUN="$(find_bun)"
if [ -z "$BUN" ]; then
  [ "$platform_os" = "linux" ] && need unzip # Bun's installer needs it
  step "Installing Bun in ~/.bun (no sudo needed)"
  curl -fsSL https://bun.sh/install | bash >"$tmp/bun-install.log" 2>&1 || { cat "$tmp/bun-install.log" >&2; die "Bun did not install."; }
  BUN="$(find_bun)"
  [ -n "$BUN" ] || die "Bun did not install. Install it from https://bun.sh, then run this again."
fi
step "Using Bun $("$BUN" --version) at $BUN"

# Small JSON reads without jq: Bun is here anyway.
json_get() { "$BUN" -e "const v = JSON.parse(await Bun.stdin.text())$1; if (v !== undefined && v !== null) console.log(v)"; }

# 2. Download and verify --------------------------------------------------------
if [ -n "$FROM_FILE" ]; then
  archive="$(cd "$(dirname "$FROM_FILE")" && pwd)/$(basename "$FROM_FILE")"
  sums="$(dirname "$archive")/SHA256SUMS"
else
  if [ "$VERSION" = "latest" ]; then api="https://api.github.com/repos/$REPO/releases/latest"
  else api="https://api.github.com/repos/$REPO/releases/tags/v${VERSION#v}"
  fi
  release="$(curl -fsSL -H "Accept: application/vnd.github+json" -H "User-Agent: x-growth-installer" "$api")" || die "Could not read the release from GitHub ($api)."
  tag="$(printf '%s' "$release" | json_get '.tag_name')"
  [ -n "$tag" ] || die "GitHub returned no release."
  name="x-growth-${tag#v}-$platform.tar.gz"
  base="https://github.com/$REPO/releases/download/$tag"
  step "Downloading $name"
  curl -fL --retry 3 -o "$tmp/$name" "$base/$name" || die "Could not download $name (is there a $platform bundle in $tag?)."
  curl -fsSL --retry 3 -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" || die "Could not download SHA256SUMS."
  archive="$tmp/$name"
  sums="$tmp/SHA256SUMS"
fi
name="$(basename "$archive")"
[ -f "$sums" ] || die "No SHA256SUMS next to $name; refusing to install it unverified."
expected="$(awk -v n="$name" '$2 == n || $2 == "*" n { print tolower($1); exit }' "$sums")"
[ -n "$expected" ] || die "SHA256SUMS has no entry for $name."
if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$archive" | awk '{ print $1 }')"
else actual="$(shasum -a 256 "$archive" | awk '{ print $1 }')"
fi
[ "$actual" = "$expected" ] || die "Checksum mismatch for $name (expected $expected, got $actual). Nothing was installed."
step "Checksum verified"

# 3. Unpack -----------------------------------------------------------------------
app="$INSTALL_DIR/app"
data="$INSTALL_DIR/data"
staging="$INSTALL_DIR/app.new"
mkdir -p "$INSTALL_DIR"
rm -rf "$staging"
mkdir -p "$staging"
step "Unpacking to $app"
tar -xzf "$archive" -C "$staging" || die "Could not unpack $name."
[ -f "$staging/release.json" ] || die "$name is not an X Growth bundle."
version="$(json_get '.version' <"$staging/release.json")"
bundle_platform="$(json_get '.platform' <"$staging/release.json")"
[ "$bundle_platform" = "$platform" ] || die "$name is for $bundle_platform, not $platform."

if [ -d "$app" ]; then
  # Reinstalling: stop the running copy, swap folders, keep data.
  step "Replacing the installed app (your data stays)"
  [ -f "$app/xstats.js" ] && "$BUN" "$app/xstats.js" stop >/dev/null 2>&1 || true
  rm -rf "$INSTALL_DIR/app.old"
  mv "$app" "$INSTALL_DIR/app.old"
  mv "$staging" "$app"
  rm -rf "$INSTALL_DIR/app.old"
else
  mv "$staging" "$app"
fi

# 4. Set up, start at login, start ---------------------------------------------------
export XSTATS_DATA_DIR="$data"
cli="$app/xstats.js"

step "Setting up the data folder"
setup_args=(setup)
[ -n "$HANDLE" ] && setup_args+=(--handle "$HANDLE")
[ -n "$TIMEZONE" ] && setup_args+=(--timezone "$TIMEZONE")
setup_ok=true
"$BUN" "$cli" "${setup_args[@]}" >&2 || { setup_ok=false; warn "xstats setup did not finish. The app still starts; run \"$app/xstats\" setup again later."; }

autostart=false
if [ "$AUTOSTART" = 1 ]; then
  step "Starting X Growth at login"
  if "$BUN" "$cli" autostart enable >&2; then autostart=true
  else warn "Could not set up start at login; turn it on later in Settings > App."
  fi
fi

url=""
if [ "$START" = 1 ]; then
  step "Starting X Growth"
  start_args=(start --detach --json)
  [ -n "$PORT" ] && start_args+=(--port "$PORT")
  out="$("$BUN" "$cli" "${start_args[@]}")" || die "X Growth did not start: $out. Logs: $data/logs/xstats.log"
  url="$(printf '%s' "$out" | tail -n 1 | json_get '.url')/setup"
  if [ "$OPEN" = 1 ]; then
    if [ "$platform_os" = "mac" ]; then open "$url" >/dev/null 2>&1 || true
    elif [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 &
    fi
  fi
fi

if [ "$JSON" = 1 ]; then
  STATUS_VERSION="$version" STATUS_APP="$app" STATUS_DATA="$data" STATUS_URL="$url" STATUS_SETUP="$setup_ok" STATUS_AUTOSTART="$autostart" \
    "$BUN" -e 'const e = process.env; console.log(JSON.stringify({ status: "installed", version: e.STATUS_VERSION, app: e.STATUS_APP, data: e.STATUS_DATA, inbox: e.STATUS_DATA + "/inbox", cli: e.STATUS_APP + "/xstats", url: e.STATUS_URL || null, setup: e.STATUS_SETUP === "true", autostart: e.STATUS_AUTOSTART === "true" }))'
else
  echo
  printf '\033[32mX Growth %s is installed.\033[0m\n' "$version"
  echo "  App:    $app"
  echo "  Data:   $data"
  if [ -n "$url" ]; then echo "  Open:   $url"; fi
  echo "  CLI:    \"$app/xstats\" help"
fi
