#!/usr/bin/env bash
# wmux-resolve.sh — make `wmux` callable even where it isn't on PATH.
#
# The orchestrator calls bare `wmux` from non-interactive shells (Claude Code's
# Bash tool, these hook scripts). A patched wmux puts a `wmux` shim on those
# shells' PATH automatically, but on an un-patched/upstream wmux it isn't there.
# In that case fall back to the $WMUX_CLI script wmux injects into every shell it
# spawns, so `wmux ...` still works. No-op when a real `wmux` is already on PATH.
#
# Defining a function makes `command -v wmux` succeed too, so the callers'
# existing `command -v wmux` guards pass without change.
if ! command -v wmux >/dev/null 2>&1 && [ -n "${WMUX_CLI:-}" ]; then
  wmux() { node "$WMUX_CLI" "$@"; }
fi
