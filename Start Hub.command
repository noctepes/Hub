#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Start Hub — serves this folder over HTTP and opens it in Chrome.
#
#  Why this exists: several Hub tools (Image Compressor above all) rely on Web
#  Workers and WebAssembly module loading. Chrome blocks both on file:// URLs,
#  so double-clicking an .html file gives a broken tool with a confusing error.
#  This wrapper makes double-clicking work by putting a real HTTP origin under
#  the folder first.
#
#  Bound to 127.0.0.1 on purpose — this serves the whole Hub folder, and it has
#  no business being reachable from the office network.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
ROOT="$(pwd)"
LANDING="index.html"
START_PORT=8080
HOST=127.0.0.1

c_dim=$'\033[2m'; c_b=$'\033[1m'; c_org=$'\033[38;5;202m'; c_grn=$'\033[38;5;35m'
c_red=$'\033[38;5;167m'; c_off=$'\033[0m'

banner() {
  printf '\n%s  IMGPRESS · HUB%s\n' "$c_org$c_b" "$c_off"
  printf '%s  %s%s\n\n' "$c_dim" "$ROOT" "$c_off"
}

# Port is free if nothing accepts a TCP connection on it.
port_free() {
  ! (exec 3<>"/dev/tcp/$HOST/$1") 2>/dev/null
}

find_port() {
  local p=$START_PORT
  local limit=$((START_PORT + 40))
  while [ "$p" -lt "$limit" ]; do
    if port_free "$p"; then echo "$p"; return 0; fi
    p=$((p + 1))
  done
  return 1
}

open_browser() {
  local url="$1"
  for app in "Google Chrome" "Microsoft Edge" "Chromium" "Brave Browser"; do
    if open -a "$app" "$url" 2>/dev/null; then
      printf '  %s→%s opened in %s%s%s\n' "$c_grn" "$c_off" "$c_b" "$app" "$c_off"
      return 0
    fi
  done
  printf '  %s!%s Chrome/Edge not found — falling back to the default browser.\n' "$c_org" "$c_off"
  printf '    Some tools need a Chromium engine and may not work.\n'
  open "$url" 2>/dev/null || printf '    Open manually: %s\n' "$url"
}

banner

if [ ! -f "$LANDING" ]; then
  printf '  %s✕ %s not found in this folder.%s\n' "$c_red" "$LANDING" "$c_off"
  printf '    Keep this launcher next to the Hub html files.\n\n'
  read -r -p "  Press Return to close… " _; exit 1
fi

# Already serving from a previous launch? Reuse it instead of starting a second.
for p in $(seq "$START_PORT" $((START_PORT + 5))); do
  if ! port_free "$p"; then
    URL="http://$HOST:$p/$LANDING"
    printf '  %sA server is already listening on port %s.%s\n' "$c_dim" "$p" "$c_off"
    open_browser "$URL"
    printf '\n  %sThis window can be closed. The original launcher window owns the server.%s\n\n' "$c_dim" "$c_off"
    exit 0
  fi
done

PORT="$(find_port)" || {
  printf '  %s✕ No free port between %s and %s.%s\n\n' "$c_red" "$START_PORT" "$((START_PORT + 40))" "$c_off"
  read -r -p "  Press Return to close… " _; exit 1
}
URL="http://$HOST:$PORT/$LANDING"

# Pick whatever static server this machine actually has. python3 ships with the
# Xcode Command Line Tools; node is common on design machines; php is gone from
# macOS 12+ but still present on some setups.
SERVER_NAME=""
start_server() {
  if command -v python3 >/dev/null 2>&1; then
    SERVER_NAME="python3 http.server"
    python3 -m http.server "$PORT" --bind "$HOST" >/dev/null 2>&1 &
  elif command -v python >/dev/null 2>&1 && python -c 'import sys;sys.exit(0 if sys.version_info[0]==3 else 1)' 2>/dev/null; then
    SERVER_NAME="python http.server"
    python -m http.server "$PORT" --bind "$HOST" >/dev/null 2>&1 &
  elif command -v npx >/dev/null 2>&1; then
    SERVER_NAME="npx serve"
    npx --yes serve --listen "tcp://$HOST:$PORT" . >/dev/null 2>&1 &
  elif command -v php >/dev/null 2>&1; then
    SERVER_NAME="php built-in"
    php -S "$HOST:$PORT" -t . >/dev/null 2>&1 &
  else
    return 1
  fi
  SRV_PID=$!
  return 0
}

if ! start_server; then
  printf '  %s✕ No static web server available.%s\n\n' "$c_red" "$c_off"
  printf '    Install either one, then run this launcher again:\n'
  printf '      %sxcode-select --install%s   (gives you python3)\n' "$c_b" "$c_off"
  printf '      %sbrew install node%s        (gives you npx)\n\n' "$c_b" "$c_off"
  read -r -p "  Press Return to close… " _; exit 1
fi

cleanup() {
  printf '\n  %sstopping server…%s\n' "$c_dim" "$c_off"
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
  wait "${SRV_PID:-}" 2>/dev/null
  exit 0
}
trap cleanup INT TERM HUP EXIT

# Wait for the socket to actually accept before opening the browser, otherwise
# Chrome races the server and shows ERR_CONNECTION_REFUSED.
for _ in $(seq 1 50); do
  port_free "$PORT" || break
  sleep 0.1
done

if port_free "$PORT"; then
  printf '  %s✕ %s failed to start on port %s.%s\n\n' "$c_red" "$SERVER_NAME" "$PORT" "$c_off"
  read -r -p "  Press Return to close… " _; exit 1
fi

printf '  %sserver%s  %s  %s(%s)%s\n' "$c_dim" "$c_off" "$URL" "$c_dim" "$SERVER_NAME" "$c_off"
open_browser "$URL"
printf '\n  %sLeave this window open while you work.%s\n' "$c_b" "$c_off"
printf '  %sPress Ctrl-C, or just close the window, to stop the server.%s\n\n' "$c_dim" "$c_off"

wait "$SRV_PID"
