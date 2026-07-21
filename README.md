# wmux-orchestrator

Claude Code plugin that decomposes complex dev tasks into parallel agents coordinated through dependency-aware waves with automated review.

**With wmux**: Each agent gets its own visible terminal pane — watch them work in real-time.
**Without wmux**: Falls back to native Claude Code subagents.

## Install

Add the marketplace, then install the plugin from it:

```bash
claude plugin marketplace add amirlehmam/wmux-orchestrator
claude plugin install wmux-orchestrator@wmux-orchestrator
```

Verify it's enabled with `claude plugin list`. To update later:

```bash
claude plugin marketplace update wmux-orchestrator
claude plugin update wmux-orchestrator@wmux-orchestrator
```

## Usage

In Claude Code:
```
/wmux-orchestrator:orchestrate <your task description>
```

## How it works

1. Analyzes your codebase structure
2. Decomposes the task into waves of parallel agents
3. Spawns agents (wmux panes or subagents)
4. Monitors progress and drives wave transitions
5. Runs automated review when all agents complete

## Requirements

- Claude Code CLI
- wmux (optional, for visual multi-pane mode)

## License

MIT
