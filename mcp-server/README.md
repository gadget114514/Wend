# Wend BT MCP Server

**Phase H**: Complete MCP integration for Behavior Tree execution and management.

## Overview

The Wend BT MCP Server exposes the complete Behavior Tree execution engine as MCP tools, enabling Claude to:
- Load, create, and execute Behavior Trees
- Manage projects, recipes, and providers
- Execute BTs in parallel with sophisticated primitives
- Monitor execution metrics and control flow
- Access and manipulate blackboard state across scopes

## Tool Summary

**BT Operations** (6 tools)
- load_sample, create_bt, run_bt, step_bt, pause_bt, stop_bt

**BT State** (4 tools)
- get_status, get_blackboard, set_blackboard, get_run_details

**Project/Tab/Recipe** (7 tools)
- list_projects, create_project, switch_project, list_tabs, list_recipes, save_recipes, list_providers

**Multi-Run Execution** (3 tools)
- spawn_run, list_runs, stop_run

**Configuration** (4 tools)
- get_config, set_config, get_metrics, set_retry_policy, cancel_run

**Parallel Primitives** (5 tools)
- run_parallel, map_bt, join_runs, race_runs, reduce_results

**Screenshot** (1 tool)
- screenshot

**Total: 30 MCP tools**

## BT Actions

Leaf nodes use `btAction` to control behavior. Key actions:

| `btAction` | Path Source | Output | Use Case |
|---|---|---|---|
| `loadLocalFile` | `btLocalFilePath` (node config — **static**) | Configurable `btOutputType` (default `media`) | Load a known file at tree-authoring time |
| `fileToMedia` | `btInputKey` (blackboard — **dynamic**) | Always `media` in `run` scope | Load a file whose path was computed at runtime |
| `mediaToFile` | `btInputKey` (blackboard media) | Text (temp file path) | Save media to disk |
| `playAudio` | `btInputKey` (blackboard media) | — | Play audio |
| `playVideo` | `btInputKey` (blackboard media) | — | Play video |

**Load local file vs File → Media:** `loadLocalFile` reads the file path from the node's own `btLocalFilePath` property (you type it on the node). `fileToMedia` reads the path from a blackboard key — it was written by a prior node. Use `loadLocalFile` for static assets, `fileToMedia` when the path is determined at runtime (e.g., an LLM decides which file to load).

## Key Features

### Blackboard Scopes (Part 3)
- **run**: Current execution scope
- **tab**: Tab-level persistent state
- **project**: Cross-tab persisted to disk
- **chest**: Independent named storage

Read fallback chain: run → tab → project

### Parallel Execution (Phase C)
- **Data parallelism**: map_bt (same BT, multiple inputs)
- **Task parallelism**: run_parallel (different BTs)
- **Collection**: join_runs (wait for group, various policies)
- **Racing**: race_runs (first successful result)
- **Aggregation**: reduce_results (fold or AI mode)

### Advanced Control (Phase F)
- Cooperative cancellation via cancel_run
- Configurable retry policy (maxRetries, retryDelay)
- Performance metrics per run (duration, tokens)
- Queue management with maxParallel limit

## Phase H Status

✅ All Phase A-G features now MCP-exposed
✅ Added get_run_details for individual run metrics (Phase H)
✅ Added screenshot tool for window capture
✅ Complete documentation
✅ 30 comprehensive tools covering:
  - Single BT execution
  - Multi-run job management
  - Parallel execution primitives
  - Blackboard scoping and persistence
  - Project/recipe management
  - Configuration and monitoring
  - Window screenshot capture

See mcp-server/index.js for complete tool definitions and examples.
