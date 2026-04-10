---
name: wmux-detect
description: Detect if wmux terminal multiplexer is running. Used internally by orchestrate skill to decide between wmux multi-pane mode and degraded subagent mode.
---

# wmux Detection

Run the detection script to check if wmux is available:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/detect-wmux.sh"
```

**If output is "available":**
- wmux is running and the named pipe is accessible
- The orchestrator can use `wmux split`, `wmux agent spawn`, `wmux markdown set` etc.
- Full multi-pane visual experience is available

**If output is "unavailable":**
- wmux is not running or not installed
- Fall back to Claude Code's native `Agent` tool for parallel workers
- No visual dashboard — use text summaries in the terminal instead
- Log: "wmux not detected. Running in degraded mode — agents will use Claude Code's native subagent system. Install wmux for the full multi-pane experience: https://wmux.org"

Store the detection result so other skills can check it without re-running:

```bash
export WMUX_AVAILABLE=$( bash "${CLAUDE_PLUGIN_ROOT}/scripts/detect-wmux.sh" 2>/dev/null && echo "true" || echo "false" )
```

**ENFORCEMENT:**
- When `WMUX_AVAILABLE=true`: ALL agents MUST be spawned via `wmux agent spawn`. Do NOT use Claude Code's `Agent` tool. The Agent tool creates invisible subagents — the user chose wmux specifically to SEE agents in panes.
- When `WMUX_AVAILABLE=false`: Use Claude Code's `Agent` tool with `subagent_type: "wmux-orchestrator:wmux-worker"`.
- Never mix modes within an orchestration.
