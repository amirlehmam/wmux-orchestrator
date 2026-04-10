# Task Decomposition Guide

## Decomposition Patterns

### Pattern 1: Layer-Based Split
Split by architectural layers when the task spans multiple layers.
- Wave 1: Data layer (models, types, schemas)
- Wave 2: Logic layer (services, middleware, utilities)
- Wave 3: Interface layer (routes, controllers, UI components)
- Wave 4: Tests and documentation

### Pattern 2: Feature-Based Split
Split by independent features when the task involves multiple features.
- Wave 1: Shared infrastructure (types, config, utilities)
- Wave 2+: Each feature as a separate agent (parallel)
- Final wave: Integration tests

### Pattern 3: Component-Based Split
Split by UI components when the task is frontend-heavy.
- Wave 1: Shared state/store changes
- Wave 2: Independent component implementations (parallel)
- Wave 3: Integration and E2E tests

### Pattern 4: Migration Split
For data or API migrations.
- Wave 1: New schema/types/interfaces
- Wave 2: Migration logic + backward compatibility
- Wave 3: Consumer updates (parallel per consumer)
- Wave 4: Remove old code + tests

## File Conflict Resolution

When two subtasks need the same file:
1. **Prefer sequencing**: Put them in different waves
2. **Prefer merging**: Combine into one subtask if small enough
3. **Split the file**: If the file is large, the first agent can split it, second agent modifies the new file
4. **Accept shared read**: Multiple agents CAN read the same file, just not write to it

## Sizing Guidelines

- **1 agent**: Task touches 1-3 files, straightforward changes — skip orchestration, do it directly
- **2 agents**: Task has 2 independent concerns (e.g., backend + frontend)
- **3 agents**: Task spans 3+ layers or features
- **4-5 agents**: Large refactor or migration across many files
- **>5 agents**: Consider breaking into separate orchestrations

## Anti-Patterns

- Don't create agents for trivial changes (1-line fix doesn't need an agent)
- Don't split tightly coupled files across agents
- Don't put test-writing in wave 1 (tests depend on implementation)
- Don't create circular dependencies between waves
- Don't over-decompose — 2 focused agents beat 5 scattered ones

## Coupling Detection

Some decompositions look safe to parallelize but aren't — two agents can each do correct work in isolation and still produce output that fails to integrate because they independently invented different names for the same concept. Check every wave for coupling before committing to the plan.

### Strong coupling — NEVER parallelize without a contract or sequencing

These are cases where a matching name, ID, type, or shape is required for the integration to work:

- **HTML + CSS of the same component.** Class names must match. Don't split `Header.html` and `header.css` across two wave-1 agents unless you give them a shared contract file.
- **HTML + JS mount points.** Element IDs and selectors must match. Don't split `index.html` (writing `<div id="app">`) and `main.js` (doing `document.getElementById('app')`) across parallel agents without a contract.
- **API client + API server** for the same feature. Endpoint path, HTTP method, request shape, and response shape must all match.
- **Schema/types + schema consumer.** Exported type signatures must match. If one agent writes `src/types.ts` and another imports from it, the consumer MUST be in a later wave or the type names must come from a contract.
- **Multi-file tests + implementation.** Test imports must match implementation exports.

### Weak coupling — safe to parallelize with a shared contract

These agents can work in parallel IF given a shared contract but would drift without one:

- Multiple CSS files styling different components but sharing design tokens (`--bg`, `--accent`, spacing scale).
- Multiple backend endpoints sharing types from a common file that already exists.
- Multiple React components consuming the same hook or context whose signature is already fixed.

### No coupling — fully safe to parallelize

- Unrelated features in different subsystems (e.g., `auth/` and `billing/`).
- Independent bugfixes in different modules.
- Documentation + code (docs are always written after code in a later wave).
- One agent writes code, another writes tests in a later wave reading from the code.

### Resolution flowchart

When you detect strong or weak coupling in a wave, walk this flowchart:

1. **Can you merge the coupled agents into one?** If the combined output is under ~800 lines and the work is cohesive (e.g., HTML + CSS of a single small component), merge. Fewest moving parts wins.
2. **Is the coupling directional?** If one side clearly depends on the other's output (types → consumers, schema → migrations, API → clients), sequence them across waves. Wave N produces the contract AS ACTUAL CODE; wave N+1 reads it.
3. **Must they run in parallel for real speedup?** Generate a shared contract file at `{orch-dir}/wave-{N}-contract.md` and inject the MUST-READ block into every coupled agent's prompt (see Phase 4.5 in SKILL.md). Every shared name must appear in the contract.

### Never do this

- Do NOT duplicate the class-name list (or type list, or API schema) into each coupled agent's prompt and hope they converge. They won't. Two Claudes reading the same instruction file still produce different code when asked to "use names like these." The contract must be ONE file on disk that all agents Read.
- Do NOT assume that listing "expected classes" in an agent's prompt is the same as a contract. It is not. A contract is a real file on disk, referenced by path, that every coupled agent Reads before writing code.
