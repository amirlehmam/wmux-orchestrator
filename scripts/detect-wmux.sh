#!/usr/bin/env bash
# Detect if wmux is running and available via named pipe.
# Exit 0 + print "available" if wmux responds to ping.
# Exit 1 + print "unavailable" if not.

# Make bare `wmux` resolvable when it isn't on PATH (falls back to $WMUX_CLI),
# so detection succeeds via the injected CLI even on an un-patched wmux.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/wmux-resolve.sh"

if command -v wmux &>/dev/null; then
  result=$(wmux ping 2>/dev/null)
  if [ "$result" = "pong" ]; then
    echo "available"
    exit 0
  fi
fi

# Fallback: try connecting to the pipe directly
if [ -e "//./pipe/wmux" ] 2>/dev/null; then
  echo "available"
  exit 0
fi

echo "unavailable"
exit 1
