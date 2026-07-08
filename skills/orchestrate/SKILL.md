---
name: orchestrate
description: Core orchestration skill. Analyzes codebase, decomposes tasks into waves of parallel agents, creates wmux layout, spawns agents, monitors progress, triggers reviewer.
---

# wmux Orchestration Skill

You are the orchestrator. Your job is to decompose the user's task into parallel subtasks, create a wave-based execution plan, and launch Claude Code agents to execute it.

## Phase 0: Resolve Plugin Root

`CLAUDE_PLUGIN_ROOT` is set by Claude Code only inside hook execution, NOT in the main session's shell environment. You MUST resolve the plugin root path before running any scripts.

Run this to find and export the plugin root:

```bash
PLUGIN_ROOT=$(find "$HOME/.claude/plugins/cache/wmux-orchestrator" -name "plugin.json" -path "*/.claude-plugin/*" 2>/dev/null | sort -V | tail -1 | sed 's|/.claude-plugin/plugin.json||')
echo "PLUGIN_ROOT=$PLUGIN_ROOT"
ls "$PLUGIN_ROOT/scripts/" | head -5
```

If the `find` returns empty, the plugin is not installed. Tell the user:
> "wmux-orchestrator plugin not found. Install it with: `claude plugins install wmux-orchestrator@wmux-orchestrator`"

**Store `PLUGIN_ROOT` and use it for ALL subsequent `bash` commands in this orchestration.** Every script reference below uses `$PLUGIN_ROOT` — you must prefix every bash command that references plugin scripts with the same export or pass the resolved path directly.

## Phase 1: Detect wmux

Run the detection script:

```bash
bash "$PLUGIN_ROOT/scripts/detect-wmux.sh"
```

Store the result as `WMUX_MODE`:
- If output is `"available"` → `WMUX_MODE=wmux` — agents spawn in visible terminal panes via `wmux agent spawn`
- If output is `"unavailable"` → `WMUX_MODE=degraded` — agents spawn as invisible Claude Code subagents via the Agent tool

**This decision is binding for the entire orchestration.** Do not switch modes mid-orchestration.

If degraded, log to the user:
> "wmux not detected. Running in degraded mode — agents will use Claude Code's native subagent system. Install wmux for the full multi-pane experience: https://wmux.org"

If wmux mode, log to the user:
> "wmux detected. Agents will spawn in visible terminal panes."

## Phase 2: Analyze the Codebase

Before decomposing, understand what the task involves:

1. **Map relevant files**: Use Glob and Grep to find all files related to the task
2. **Trace dependencies**: For each relevant file, check its imports and exports to understand coupling
3. **Identify conflict zones**: Files that would need to be touched by multiple subtasks — these MUST be assigned to a single agent or sequenced across waves
4. **Check git context**: Read recent commits for relevant context

Be thorough but efficient. You need enough understanding to make good decomposition decisions, not a complete codebase map.

## Phase 3: Decompose into Subtasks

Based on your analysis, break the task into subtasks. Each subtask must have:
- A clear, bounded scope described in 2-3 sentences
- An explicit list of files it may modify (allowed files)
- An explicit list of files it must NOT modify (other agents' zones)
- No circular dependencies with other subtasks

**Rules for decomposition:**
- Files that are tightly coupled (heavy imports between them) belong in the same subtask
- Shared types/interfaces should be in the earliest wave (other agents depend on them)
- Tests should generally be in the last wave (they depend on implementation)
- Prefer fewer, larger subtasks over many tiny ones — agent startup has overhead
- A single-line fix does NOT need an orchestration. If the task is trivial, just do it directly.

Reference the decomposition guide for patterns:
```bash
cat "$PLUGIN_ROOT/skills/orchestrate/references/decomposition-guide.md"
```

## Phase 4: Build the Wave Plan

Organize subtasks into sequential waves based on dependencies:

- **Wave 1**: Foundation work — types, models, shared interfaces. No dependencies on other subtasks.
- **Wave 2+**: Work that depends on previous wave output. Agents within a wave run in parallel.
- **Final wave**: Tests, documentation, or anything that depends on all previous work.

Determine agent count per wave based on:
- Number of truly independent subtasks in that wave
- If wmux is available, check layout capacity: `wmux list-panes`
- Maximum practical limit: 5 agents per wave (more causes diminishing returns from context overhead)
- If only 1 subtask exists, skip orchestration and do it directly

## Phase 4.5: Detect Coupling & Generate Contracts

Before presenting the plan, audit each wave for **coupling**: cases where multiple parallel agents must agree on names, types, shapes, or IDs for the final output to work. Coupling that isn't explicitly coordinated causes drift — agents independently invent different names for the same concept and the integration breaks. (This actually happened on a past run: two parallel agents building HTML and CSS invented different class names like `.hero__grid` vs `.hero__inner` for the same element, and 510 lines of alias CSS were needed to reconcile after the fact.)

### Coupling triggers

A wave has coupled agents when any of these apply:
- Two or more agents touch files of the same domain that reference each other by name:
  - HTML + CSS of the same component (class names must match)
  - HTML + JS of the same component (mount-point IDs and selectors must match)
  - Frontend client + backend server for the same feature (endpoint paths, request/response shapes must match)
  - Schema producer + schema consumer (exported type signatures must match)
  - Multiple agents adding methods/fields to the same exported module
- Two or more agents fill slots in a shared top-level structure (e.g., one writes the HTML skeleton, others write the component markup that plugs into it)
- Two or more agents read from or write to a common config/constants file

### Resolution paths

For each coupled group, choose ONE resolution:

1. **Merge into a single agent.** Use when the coupled work is small enough for one agent (roughly < 800 lines of final output) AND the work is naturally cohesive. Prefer this when possible — fewest moving parts.

2. **Sequence across waves.** Move one agent to an earlier wave; the later wave's prompt includes the earlier wave's result file so the dependent agent reads real names from real files. Use when the coupling is directional (types → consumers, schema → migrations, API → clients) and large enough that merging would make one agent unwieldy.

3. **Generate a shared contract file.** Write a single source-of-truth document that BOTH agents read before writing any code. Use when the work MUST run in parallel AND the coupling is naming-only, not logic-level.

### Generating the contract file (path 3)

When you choose path 3, write `{orch-dir}/wave-{N}-contract.md` BEFORE spawning the wave. Every shared name must appear in it. If an agent needs a name not in the contract, that's a bug — the agent must stop and flag disagreement (see injection below), not silently invent.

Template (omit sections that don't apply — don't include placeholder text, only real names):

````markdown
# Wave {N} Contract — [short description]

> This is the single source of truth for names shared by parallel agents in wave {N}.
> All agents listed below MUST read this file before writing any code and use these
> names verbatim. Do not invent alternatives.

## Agents bound by this contract
- agent-a ([role])
- agent-b ([role])

## Shared HTML class names
_(fill this section when at least one agent writes HTML and another writes CSS)_
- Site header: `.site-header`, `.site-header__brand`, `.site-header__nav`, `.site-header__link`
- Hero: `.hero`, `.hero__grid`, `.hero__title`, `.hero__title__line`, `.hero__cta`

## Shared DOM IDs and mount points
_(fill when one agent writes HTML scaffolding that another agent fills via JS)_
- `#wave-sim-root` — empty div in hero; agent-c mounts the simulator into it
- `aside.activity-rail` — empty aside in hero; agent-e appends log lines to it

## Shared CSS custom properties
_(fill when CSS declares variables that JS reads/writes)_
- `--scroll` — 0..1 fractional page scroll, written by motion agent, read by CSS
- `--mouse-x`, `--mouse-y` — **pixel** values (not normalized), written by ambient agent, read by CSS `top`/`left`

## Shared TypeScript/JavaScript exports
_(fill when one agent declares types/functions used by another in the same wave)_
- `export type User = { id: string; email: string; role: 'admin' | 'user' }` in `src/shared/types.ts`
- `export function formatDate(d: Date): string` in `src/shared/format.ts`

## Shared API endpoints
_(fill when frontend and backend are coupled)_
- `POST /api/auth/login` — request `{ email, password }`, response `{ token, user: User }`
- `GET /api/users/:id` — response `User`

## Shared file structure
_(fill when multiple agents place files in a coordinated layout)_
- `src/components/Hero/Hero.tsx` — structure (agent-a)
- `src/components/Hero/hero.module.css` — styles (agent-b)
````

### Injecting the contract into agent prompts

For EVERY coupled agent in the wave, add this block to their prompt file (in Phase 6c), placed right after the `## Orchestration Context` section and before `## Your Zone of Work`:

````markdown
## Shared Contract — READ BEFORE WRITING ANY CODE

You share this wave with other agents who depend on the same names. To prevent naming drift, a shared contract has been written at:

`{orch-dir}/wave-{N}-contract.md`

**Before writing any code, use the Read tool to read that file in full.** It defines every class name, mount point, type, and API shape that you and the other agents must use identically. Use these names verbatim — do not invent alternatives, do not translate them, do not simplify them.

If a name in the contract seems wrong or missing:
1. Stop implementation.
2. Write to your result file with status `contract_disagreement`.
3. Describe the specific name at issue and your proposed alternative.
4. Do NOT silently invent a different name and proceed.

The reviewer will pick up any `contract_disagreement` result and reconcile before the next wave.
````

Agents NOT in a coupled group skip this block — their work is independent and doesn't need the extra read.

## Phase 5: Present the Plan

Show the user a structured plan. Format it clearly:

```
Orchestration Plan: [task description]
Agents: [total] in [N] waves
Estimated complexity: [low/medium/high]

Wave 1 — [description]
  Agent A: "[subtask label]"
    Allowed files: [list]
    Excluded files: [list]

Wave 2 (after Wave 1) — [description]
  Agent B: "[subtask label]"
    Allowed files: [list]
    Excluded files: [list]
  Agent C: "[subtask label]"
    Allowed files: [list]
    Excluded files: [list]

Wave 3 (after Wave 2) — [description]
  Agent D: "[subtask label]"
    Allowed files: [list]
    Excluded files: [list]

Options:
  --worktree: Isolate each agent in a git worktree (default: no)
  --no-review: Skip the automated reviewer (default: review enabled)
```

Ask the user: **"Validate this plan? (yes / adjust / cancel)"**

Wait for user approval. If they want adjustments, modify the plan and re-present. Do NOT proceed without explicit approval.

## Phase 6: Initialize Orchestration

Once the user validates:

### 6a. Generate orchestration ID

```bash
ORCH_ID="orch-$(date +%s | tail -c 7)"
echo $ORCH_ID
```

### 6b. Create orchestration directory and state file

Create the directory:
```bash
mkdir -p "${TMPDIR:-/tmp}/wmux-orch-$ORCH_ID"
```

Write `state.json` using the Write tool. Schema:
```json
{
  "id": "orch-XXXXXX",
  "task": "the user's task description",
  "status": "running",
  "startedAt": "ISO-8601 UTC timestamp",
  "cwd": "project working directory",
  "workspaceId": null,
  "dashboardSurfaceId": null,
  "useWorktrees": false,
  "waves": [
    {
      "index": 0,
      "status": "running",
      "blockedBy": [],
      "agents": [
        {
          "id": "agent-a",
          "label": "Subtask label",
          "subtask": "Full subtask description",
          "files": ["allowed/file/paths"],
          "excludeFiles": ["excluded/patterns/*"],
          "paneId": null,
          "surfaceId": null,
          "status": "pending",
          "exitCode": null,
          "toolUses": 0,
          "resultFile": "/tmp/wmux-orch-XXXXXX/agent-a-result.md",
          "startedAt": null,
          "finishedAt": null
        }
      ]
    }
  ],
  "reviewer": {
    "status": "pending",
    "agentId": null,
    "reportFile": "/tmp/wmux-orch-XXXXXX/review-report.md"
  }
}
```

Use short agent IDs like "agent-a", "agent-b", etc. Set the first wave's status to "running", all others to "pending".

**Resolve the target workspace NOW and record it in `workspaceId`.** Do not leave it `null` in wmux mode: the coordinator's `WMUX_SURFACE_ID` env var can be stale (background or resumed sessions point at a dead surface), so nothing downstream can safely infer the workspace implicitly. Run:

```bash
wmux list-workspaces
```

Each entry has `{ id, title, isActive, cwd }`. Pick the workspace whose `cwd` matches the project — but note multiple workspaces can share the same `cwd`; when ambiguous, resolve by `title` or ask the user. Record the **id** (not the title) in `state.json`'s `workspaceId`. Later phases use it to pin the layout, scope pane/agent listings, and keep the orchestration out of whatever workspace the user happens to be looking at.

### 6c. Generate agent prompt files

For EACH agent, create a prompt file at `{orch-dir}/agent-{id}-prompt.md` with:

```markdown
# Mission: [subtask label]

## Orchestration Context
You are [Agent ID] in orchestration [ORCH_ID].
[N] other agents are working on the same project in parallel.
You are in Wave [N] of [total waves].

[If this agent is in a coupled group per Phase 4.5, inject the Shared Contract block here — see Phase 4.5 template. Skip for non-coupled agents.]

[If wave 2+:]
## Previous Wave Results
The following agents completed before you. Their results:
[Paste contents of previous agents' result files here]

## Your Zone of Work
Allowed files (you MAY modify these):
- [list each file]

Excluded files (you MUST NOT modify these):
- [list patterns]

## Your Mission
[Detailed subtask description with specific steps]

## When You Finish
Create your result file at: [orch-dir]/agent-[id]-result.md

Use this format:
### Summary
[2-3 sentences]
### Files Modified
- `path` — [description]
### Interfaces/Types Changed
[Any exported types that changed signature]
### Tests
[Test results or "Out of scope"]
### Risks
[Points of attention for other agents or reviewer]
```

### 6d. Create wmux layout (if available)

**IMPORTANT: Do NOT create or close workspaces — that hides agent panes from the user.**

The spawn script (`spawn-agents.sh`) automatically creates panes via `wmux layout grid`, anchored to the caller's `$WMUX_SURFACE_ID`.

**Pin the workspace BEFORE spawning.** `wmux layout grid` anchors to the caller's `WMUX_SURFACE_ID`; in background or resumed sessions that env var is often stale, and the app then falls back to whatever workspace the user currently has active. The spawn script passes no `--workspace` either — so without pinning, the entire grid plus agents can land in an unrelated workspace the user is working in (their `--cwd` still governs where they work, but it hijacks the user's screen and breaks pane counting). Two ways to pin, using the `workspaceId` recorded in Phase 6b:

- **Primary (works with the spawn script as-is):** select the target workspace immediately before spawning:
  ```bash
  wmux select-workspace <workspaceId>
  bash "$PLUGIN_ROOT/scripts/spawn-agents.sh" "[orch-dir]" 0
  ```
  Side effect: this flips the user's visible workspace — usually desirable, since the grid is about to appear there.

- **Alternative (focus-preserving):** skip the script's gridding and target the workspace explicitly — create the grid with `wmux layout grid --workspace <workspaceId> --count <N> --type terminal`, then spawn each agent into a returned pane with `wmux agent spawn --pane <paneId> --cwd <dir> --label <label> --cmd <cmd>`. The user's active workspace is never disturbed.

Pane-hygiene checks in this phase (and later) must count panes in the TARGET workspace, not the active one: `wmux list-panes --workspace <workspaceId>`.

### 6e. Spawn Wave 1 agents

**CRITICAL RULE: When wmux is available, you MUST use `wmux agent spawn` to create agents in visible terminal panes. Do NOT use Claude Code's `Agent` tool when wmux is available — the Agent tool creates invisible subagents that the user cannot see. The `Agent` tool is ONLY for degraded mode (no wmux).**

**If wmux IS available:**

Spawn agents using the spawn script:
```bash
bash "$PLUGIN_ROOT/scripts/spawn-agents.sh" "[orch-dir]" 0
```

This script:
1. Creates a pane per agent via `wmux layout grid`
2. Runs `node launch-agent.js <prompt-file>` in each pane
3. `launch-agent.js` uses `execFileSync` with `'--'` separator to pass the full prompt as a positional argument — this bypasses all shell quoting issues
4. Claude starts in **interactive mode with full TUI** — the prompt auto-submits and Claude begins working immediately
5. The user can watch agents in real-time by clicking their pane tabs, and can type into any agent to intervene

After spawning, verify agents are running:
```bash
wmux agent list
```

You should see agents with `"status": "running"`.

**If wmux is NOT available (degraded mode only):**

Spawn each agent using Claude Code's native Agent tool:
- For each agent in Wave 1, use the Agent tool with `subagent_type: "wmux-orchestrator:wmux-worker"`
- Pass the prompt file content as the prompt
- Use `description: "[agent label]"` for tracking
- Wait for all agents to complete before proceeding to next wave

## Phase 7: Monitor and Transition (Orchestrator Loop)

**You are the orchestrator.** Your job is to monitor agent progress and coordinate wave transitions. This is where the real orchestration happens.

### Live dashboard visibility

Before entering the loop, note how the user sees progress:

- **In wmux mode**: wmux's sidebar automatically watches `{TMPDIR}/wmux-orch-*/state.json` and renders a live cockpit (task, elapsed time, per-wave progress bars, per-agent state dots, tool counts). You don't need to do anything to keep it updated — the hooks already update state.json on tool-use and wave transitions, and the sidebar polls every second. Do NOT call the dashboard manually in wmux mode; it would be redundant and noisy.

- **In degraded mode (no wmux)**: you must print the text dashboard into Claude Code's conversation at each wave transition so the user can see progress. Run:
  ```bash
  node "$PLUGIN_ROOT/scripts/dashboard-text.js" "[orch-dir]"
  ```
  Call it ONCE after spawning each wave, and ONCE after each wave completes. Do not call it inside the monitoring loop (that would spam the session). If the user asks "how's it going", you can also call it then.

### With wmux (poll-based monitoring):

After spawning Wave N agents, enter a monitoring loop. Poll every 15-20 seconds:

```bash
wmux agent list --workspace <workspaceId>
```

Without `--workspace`, `agent list` returns agents from ALL workspaces — including ones the user spawned themselves in other sessions. Only ever act on (nudge, kill) agents whose ids appear in this orchestration's `state.json`; **never kill an agent this orchestration didn't spawn.**

For each agent, check the `"status"` field:
- `"running"` → agent is still working
- `"exited"` → agent has finished (check `"exitCode"`: 0 = success, non-zero = failure)

**While agents are running, report status to the user:**
- Tell the user which agents are still working and which have finished
- Example: "Wave 1: Agent A (HTML+CSS) still running, Agent B (i18n) finished (exit 0)"

**When ALL agents in the current wave show `"status": "exited"`:**

1. Read each agent's result file (if they created one):
   ```
   [orch-dir]/agent-[id]-result.md
   ```
2. Report results to the user: which agents succeeded, which failed, what they produced
3. If there are more waves:
   a. If you close finished agents' panes to make room, reap in this order: `wmux agent kill <agentId>` FIRST, `wmux close-pane <paneId>` second (see Phase 9 for why the order matters)
   b. Generate prompt files for Wave N+1 (inject previous wave results into the "Previous Wave Results" section)
   c. Spawn Wave N+1 agents: `bash "$PLUGIN_ROOT/scripts/spawn-agents.sh" "[orch-dir]" [N+1]`
   d. Verify agents spawned with `wmux agent list --workspace <workspaceId>`
   e. Continue monitoring loop
4. If all waves are done, proceed to Phase 8

### Without wmux (degraded mode — Agent tool returns):
1. Wait for all Wave N agents to complete (their Agent tool calls return)
2. Read their result files
3. Generate Wave N+1 agent prompts (inject previous wave results)
4. Spawn Wave N+1 agents using Agent tool
5. Repeat until all waves complete

## Phase 8: Launch Reviewer

When all waves are complete:

1. Aggregate results:
```bash
bash "$PLUGIN_ROOT/scripts/collect-results.sh" "[orch-dir]"
```

2. Invoke the reviewer skill to analyze all changes and produce a final report.

## Phase 9: Finalize

**Teardown order matters: `wmux agent kill <agentId>` BEFORE `wmux close-pane <paneId>` — for every agent, every time.** Closing an agent's pane first leaves the agent registry stale: `wmux agent list` keeps reporting the agent as `running`, but `wmux agent kill <id>` then fails with "Agent not found" — and the agent's launcher process tree (shell → node → claude) SURVIVES the pane close, invisibly burning CPU and tokens. If that happens, recover by taking the `pid` from `wmux agent list` and killing the process TREE (Windows: `taskkill /F /T /PID <pid>`); judge liveness by the process, not the registry status. And per Phase 7: only kill agents this orchestration spawned.

After the reviewer completes, present a summary:
- Total time elapsed
- Agents used, waves completed
- Files modified (from `git diff --stat`)
- Test results (if reviewer ran tests)
- Reviewer findings and corrections
- Offer actions: **commit** / **view full diff** / **abort all changes**
