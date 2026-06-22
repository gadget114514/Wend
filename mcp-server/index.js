import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ResourcesListRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BT_API_BASE = 'http://127.0.0.1:18765';

async function btApiCall(endpoint, method = 'GET', payload = null) {
    const url = BT_API_BASE + endpoint;
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };

    if (payload && method === 'POST') {
        options.body = JSON.stringify(payload);
    }

    const response = await fetch(url, options);
    return await response.json();
}

const server = new Server(
    {
        name: 'wend-bt-mcp-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
            resources: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            // ── BT file operations ──────────────────────────────
            {
                name: 'load_sample',
                description: 'Load a Behavior Tree JSON file into the Wend app',
                inputSchema: {
                    type: 'object',
                    properties: {
                        filePath: {
                            type: 'string',
                            description: 'Absolute or relative path to the radio.json / BT JSON file',
                        },
                    },
                    required: ['filePath'],
                },
            },
            {
                name: 'create_bt',
                description: 'Create a new Behavior Tree JSON file and load it into the Wend app',
                inputSchema: {
                    type: 'object',
                    properties: {
                        filePath: {
                            type: 'string',
                            description: 'Absolute path where the BT JSON file will be saved',
                        },
                        tree: {
                            type: 'object',
                            description: 'BT JSON tree object (nodeType, btType, children, etc.)',
                        },
                    },
                    required: ['filePath', 'tree'],
                },
            },
            // ── BT execution control ────────────────────────────
            {
                name: 'run_bt',
                description: 'Start Behavior Tree execution from the specified target path',
                inputSchema: {
                    type: 'object',
                    properties: {
                        targetPath: {
                            type: 'string',
                            description: 'Node path to start execution from. Empty string for root.',
                        },
                    },
                },
            },
            {
                name: 'step_bt',
                description: 'Advance Behavior Tree execution by one step',
                inputSchema: { type: 'object', properties: {} },
            },
            {
                name: 'pause_bt',
                description: 'Pause Behavior Tree execution',
                inputSchema: { type: 'object', properties: {} },
            },
            {
                name: 'stop_bt',
                description: 'Stop Behavior Tree execution',
                inputSchema: { type: 'object', properties: {} },
            },
            // ── BT state ────────────────────────────────────────
            {
                name: 'get_status',
                description: 'Get current Behavior Tree execution status (mode, targetPath)',
                inputSchema: { type: 'object', properties: {} },
            },
            {
                name: 'get_blackboard',
                description: 'Get blackboard contents for a scope (run | tab | project)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        scope: {
                            type: 'string',
                            enum: ['run', 'tab', 'project'],
                            description: 'Scope to read (default: run). project is persisted across tabs.',
                        },
                    },
                },
            },
            {
                name: 'set_blackboard',
                description: 'Set a blackboard value (text/media/data) in a scope',
                inputSchema: {
                    type: 'object',
                    properties: {
                        key: { type: 'string', description: 'Blackboard key name' },
                        text: { type: 'string', description: 'Text value to set' },
                        media: { type: 'array', description: 'Media attachments array' },
                        data: { description: 'Structured JSON value (array/object/number)' },
                        scope: {
                            type: 'string',
                            enum: ['run', 'tab', 'project', 'chest'],
                            description: 'Target scope (default: run)',
                        },
                    },
                    required: ['key'],
                },
            },
            // ── Project management ──────────────────────────────
            {
                name: 'list_projects',
                description: 'List all projects and the currently active project',
                inputSchema: { type: 'object', properties: {} },
            },
            {
                name: 'create_project',
                description: 'Create a new project and switch to it',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Project name' },
                    },
                    required: ['name'],
                },
            },
            {
                name: 'switch_project',
                description: 'Switch to an existing project',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Project name to switch to' },
                    },
                    required: ['name'],
                },
            },
            // ── Tab management ──────────────────────────────────
            {
                name: 'list_tabs',
                description: 'List open tabs and available BT files in the current project',
                inputSchema: { type: 'object', properties: {} },
            },
            // ── Recipe management ───────────────────────────────
            {
                name: 'list_recipes',
                description: 'List default and project-level recipes (AI providers, models, prompts)',
                inputSchema: { type: 'object', properties: {} },
            },
            {
                name: 'save_recipes',
                description: 'Save project-level recipes',
                inputSchema: {
                    type: 'object',
                    properties: {
                        recipes: {
                            type: 'array',
                            description: 'Array of recipe objects to save as project recipes',
                        },
                    },
                    required: ['recipes'],
                },
            },
            // ── Provider management ─────────────────────────────
            {
                name: 'list_providers',
                description: 'List configured providers (API keys are masked)',
                inputSchema: { type: 'object', properties: {} },
            },
            // ── Phase B: Multi-run execution ────────────────────
            {
                name: 'spawn_run',
                description: 'Spawn a new independent BT run (returns runId)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        file: { type: 'string', description: 'Path to BT JSON file' },
                        tree: { type: 'object', description: 'BT tree object' },
                        group: { type: 'string', description: 'Optional group ID for collective operations' },
                        outputKey: { type: 'string', description: 'Blackboard key where output goes' },
                    },
                },
            },
            {
                name: 'list_runs',
                description: 'List all active and completed BT runs with status',
                inputSchema: { type: 'object', properties: {} },
            },
            {
                name: 'get_run_details',
                description: 'Get detailed information about a specific run including metrics',
                inputSchema: {
                    type: 'object',
                    properties: {
                        runId: { type: 'string', description: 'Run ID to get details for' },
                    },
                    required: ['runId'],
                },
            },
            {
                name: 'stop_run',
                description: 'Stop a running BT execution by runId',
                inputSchema: {
                    type: 'object',
                    properties: {
                        runId: { type: 'string', description: 'Run ID to stop', required: true },
                    },
                    required: ['runId'],
                },
            },
            // ── Phase F-A: Configuration ────────────────────────
            {
                name: 'get_config',
                description: 'Get runtime configuration (maxParallel, queue status)',
                inputSchema: { type: 'object', properties: {} },
            },
            {
                name: 'set_config',
                description: 'Set runtime configuration (BT parallelism and HTTP concurrency)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        maxParallel: { type: 'number', description: 'Max concurrent BT executions (1-16, default: 4)' },
                        maxConcurrentLLMCalls: { type: 'number', description: 'Max concurrent HTTP LLM requests (1-32, default: 4). Independent control for API rate limiting.' },
                    },
                },
            },
            {
                name: 'get_metrics',
                description: 'Get performance metrics for a group or all runs',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group: { type: 'string', description: 'Optional: group ID to filter metrics' },
                    },
                },
            },
            // ── Phase F-C: Advanced Features ────────────────────────
            {
                name: 'cancel_run',
                description: 'Cancel a running BT execution (cooperative cancellation)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        runId: { type: 'string', description: 'Run ID to cancel' },
                    },
                    required: ['runId'],
                },
            },
            {
                name: 'set_retry_policy',
                description: 'Set retry policy for failed executions',
                inputSchema: {
                    type: 'object',
                    properties: {
                        maxRetries: { type: 'number', description: 'Max retry attempts (0-10, default: 3)' },
                        retryDelay: { type: 'number', description: 'Delay between retries in ms (default: 1000)' },
                    },
                },
            },
            // ── Phase C: Parallel primitives ──────────────────────
            {
                name: 'run_parallel',
                description: 'Execute multiple different BTs in parallel (task parallelism)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        specs: {
                            type: 'array',
                            description: 'Array of BT specifications: {file|tree, inputs?, outputKey?}',
                            items: {
                                type: 'object',
                                properties: {
                                    file: { type: 'string', description: 'Path to BT file' },
                                    tree: { type: 'object', description: 'BT tree object' },
                                    inputs: { description: 'Input values for this BT' },
                                    outputKey: { type: 'string', description: 'Blackboard key for output' },
                                }
                            }
                        },
                        group: { type: 'string', description: 'Group ID for collective operations' },
                    },
                    required: ['specs'],
                },
            },
            {
                name: 'map_bt',
                description: 'Map same BT over multiple inputs (data parallelism)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        file: { type: 'string', description: 'Path to BT JSON file' },
                        tree: { type: 'object', description: 'BT tree object' },
                        items: { type: 'array', description: 'Array of input items' },
                        itemKey: { type: 'string', description: 'Blackboard key for each item (default: item)' },
                        group: { type: 'string', description: 'Group ID for collective operations' },
                        outputKey: { type: 'string', description: 'Where to collect results' },
                    },
                    required: ['items'],
                },
            },
            {
                name: 'join_runs',
                description: 'Wait for and collect results from a group of runs',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group: { type: 'string', description: 'Group ID' },
                        policy: {
                            type: 'string',
                            enum: ['all', 'allSettled', 'any'],
                            description: 'Failure policy: all=any fail→fail, allSettled=collect all, any=first N succeed'
                        },
                        minSuccess: { type: 'number', description: 'For any policy: min successful runs' },
                        timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
                    },
                    required: ['group'],
                },
            },
            {
                name: 'race_runs',
                description: 'Return the first successful result from a group',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group: { type: 'string', description: 'Group ID' },
                    },
                    required: ['group'],
                },
            },
            {
                name: 'reduce_results',
                description: 'Aggregate results via fold or AI mode',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group: { type: 'string', description: 'Group ID to reduce' },
                        array: { type: 'array', description: 'Alternatively, reduce this array directly' },
                        mode: {
                            type: 'string',
                            enum: ['fold', 'ai'],
                            description: 'fold=JS expression, ai=LLM aggregation'
                        },
                        btReduceExpr: { type: 'string', description: 'For fold: JavaScript expression (acc, item)' },
                        initial: { description: 'Initial value for fold' },
                        prompt: { type: 'string', description: 'For ai: aggregation prompt (default: auto-synthesize)' },
                        provider: { type: 'string', description: 'For ai: LLM provider (default: openai)' },
                        model: { type: 'string', description: 'For ai: model name (default: gpt-4)' },
                        saveAs: { type: 'string', description: 'Save result to project blackboard with this key' },
                    },
                },
            },
            // ── Phase H: BT Capabilities Discovery ───────────────
            {
                name: 'get_behavior_tree_capabilities',
                description: 'Retrieve Behavior Tree runtime specifications: supported node types (Composite, Decorator, Leaf, Condition, Action), available AI recipe models, blackboard variable schemas, and execution constraints. Call this first before creating or editing trees to understand the environment capabilities.',
                inputSchema: { type: 'object', properties: {} },
            },
            // ── Screenshot ──────────────────────────────────────
            {
                name: 'screenshot',
                description: 'Capture the current Wend application window as an image',
                inputSchema: {
                    type: 'object',
                    properties: {
                        format: {
                            type: 'string',
                            enum: ['png', 'jpeg'],
                            description: 'Image format (default: png)',
                        },
                        quality: {
                            type: 'number',
                            description: 'JPEG quality 0-100 (default: 80, only used for jpeg)',
                        },
                    },
                },
            },
        ],
    };
});

// Phase H: Server capabilities and schema resources
server.setRequestHandler(ResourcesListRequestSchema, async () => {
    return {
        resources: [
            {
                uri: 'mcp://prompts-bt/capabilities',
                name: 'Server Capabilities',
                description: 'Overview of Wend BT MCP server features, version, and status',
                mimeType: 'application/json',
            },
            {
                uri: 'mcp://prompts-bt/schema',
                name: 'Tool Schema Reference',
                description: 'Complete JSON schema for all 29 MCP tools with descriptions and parameters',
                mimeType: 'application/json',
            },
            {
                uri: 'mcp://prompts-bt/parallel-guide',
                name: 'Parallel Execution Guide',
                description: 'Usage guide for data-parallel (map_bt) and task-parallel (run_parallel) execution patterns',
                mimeType: 'text/plain',
            },
        ],
    };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    switch (uri) {
        case 'mcp://prompts-bt/capabilities':
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify({
                            server: 'prompts-bt',
                            version: '1.0.0',
                            description: 'Complete MCP integration for Behavior Tree execution, monitoring, and management',
                            features: {
                                'BT Operations': 'Load, create, run, step, pause, stop Behavior Trees',
                                'State Management': 'Monitor status, access/manipulate blackboard across scopes',
                                'Multi-Run Execution': 'Spawn independent runs, track job registry, control execution',
                                'Parallel Primitives': 'Data parallelism (map_bt), task parallelism (run_parallel), aggregation (reduce_results)',
                                'Project Management': 'Create/switch projects, manage recipes and providers',
                                'Advanced Control': 'Cooperative cancellation, retry policies, performance metrics',
                                'Blackboard Scoping': '4-tier hierarchy (run/tab/project/chest) with read-side fallback',
                            },
                            toolCount: 30,
                            phases: 'Part 1-3 + Phase A-G',
                            httpApi: 'http://127.0.0.1:18765',
                            documentation: 'See mcp-server/README.md for detailed tool reference',
                        }, null, 2),
                    },
                ],
            };

        case 'mcp://prompts-bt/schema':
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify({
                            toolCategories: {
                                'BT Operations': ['load_sample', 'create_bt', 'run_bt', 'step_bt', 'pause_bt', 'stop_bt'],
                                'BT State': ['get_status', 'get_blackboard', 'set_blackboard', 'get_run_details'],
                                'Project/Tab/Recipe': ['list_projects', 'create_project', 'switch_project', 'list_tabs', 'list_recipes', 'save_recipes', 'list_providers'],
                                'Multi-Run Execution': ['spawn_run', 'list_runs', 'stop_run'],
                                'Configuration': ['get_config', 'set_config', 'get_metrics', 'cancel_run', 'set_retry_policy'],
                                'Parallel Primitives': ['run_parallel', 'map_bt', 'join_runs', 'race_runs', 'reduce_results'],
                                'Screenshot': ['screenshot'],
                            },
                            blackboardScopes: {
                                'run': 'Current execution scope (session-only)',
                                'tab': 'Tab-level persistent state',
                                'project': 'Cross-tab persisted to disk',
                                'chest': 'Independent named storage',
                            },
                            parallelPatterns: {
                                'Data Parallelism': 'map_bt(file, items[], itemKey, group, outputKey)',
                                'Task Parallelism': 'run_parallel(specs[], group)',
                                'Collection': 'join_runs(group, policy: all|allSettled|any)',
                                'Racing': 'race_runs(group) → first success',
                                'Aggregation': 'reduce_results(group, mode: fold|ai)',
                            },
                            totalTools: 30,
                        }, null, 2),
                    },
                ],
            };

        case 'mcp://prompts-bt/parallel-guide':
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'text/plain',
                        text: `PROMPTS BT - PARALLEL EXECUTION GUIDE
=====================================

Phase H: Comprehensive parallel execution support via MCP tools.

## Data Parallelism Pattern

Use map_bt() to process same BT over multiple inputs:

  1. map_bt({
       file: "process.json",
       items: ["input1", "input2", "input3"],
       itemKey: "item",
       group: "batch1"
     })
     → Returns: { groupId, runIds: [...] }

  2. join_runs({
       group: "batch1",
       policy: "allSettled"  // or "all" / "any"
     })
     → Returns: { results: [...], failures: [...] }

  3. reduce_results({
       group: "batch1",
       mode: "ai",
       prompt: "Summarize these results"
     })
     → Returns: { value: <aggregated result> }

## Task Parallelism Pattern

Use run_parallel() to execute different BTs simultaneously:

  1. run_parallel({
       specs: [
         { file: "fetch.json", outputKey: "data" },
         { file: "validate.json", outputKey: "validation" }
       ],
       group: "workflow"
     })
     → Returns: { groupId, runIds: [...] }

  2. join_runs({
       group: "workflow",
       policy: "all"  // Wait for ALL to complete
     })
     → Returns: { results: [...] }

## Failure Policies

  - "all": Any failure fails entire group
  - "allSettled": Collect all (successes + failures)
  - "any": Return on Nth success (requires minSuccess)

## Performance Configuration

  set_config({ maxParallel: 4 })  // Default: 4 concurrent runs
  set_retry_policy({ maxRetries: 3, retryDelay: 1000 })

## Monitoring

  get_metrics()                     // Overall metrics
  get_run_details({ runId: "..." }) // Individual run details
  list_runs()                       // All active/completed runs

## Blackboard Coordination

  - Use set_blackboard(scope: "project") for cross-run data sharing
  - Read via get_blackboard(scope: "project")
  - Fallback chain: run → tab → project

For complete tool reference, see mcp-server/README.md
`,
                    },
                ],
            };

        default:
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'text/plain',
                        text: `Unknown resource: ${uri}

Available resources:
  - mcp://prompts-bt/capabilities
  - mcp://prompts-bt/schema
  - mcp://prompts-bt/parallel-guide
`,
                    },
                ],
            };
    }
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        let result;

        switch (name) {
            // ── BT file operations ──────────────────────────────
            case 'load_sample':
                result = await btApiCall('/bt/load', 'POST', { filePath: args.filePath });
                break;

            case 'create_bt':
                result = await btApiCall('/bt/create', 'POST', { filePath: args.filePath, tree: args.tree });
                if (result.success) {
                    const loaded = await btApiCall('/bt/load', 'POST', { filePath: args.filePath });
                    result = { ...result, loaded };
                }
                break;

            // ── BT execution control ────────────────────────────
            case 'run_bt':
                result = await btApiCall('/bt/run', 'POST', { targetPath: args.targetPath || '' });
                break;

            case 'step_bt':
                result = await btApiCall('/bt/step', 'POST');
                break;

            case 'pause_bt':
                result = await btApiCall('/bt/pause', 'POST');
                break;

            case 'stop_bt':
                result = await btApiCall('/bt/stop', 'POST');
                break;

            // ── BT state ────────────────────────────────────────
            case 'get_status':
                result = await btApiCall('/bt/status', 'GET');
                break;

            case 'get_blackboard': {
                const q = args.scope ? `?scope=${encodeURIComponent(args.scope)}` : '';
                result = await btApiCall('/bt/blackboard' + q, 'GET');
                break;
            }

            case 'set_blackboard':
                result = await btApiCall('/bt/blackboard', 'POST', {
                    key: args.key,
                    text: args.text,
                    media: args.media,
                    data: args.data,
                    scope: args.scope,
                });
                break;

            // ── Project management ──────────────────────────────
            case 'list_projects':
                result = await btApiCall('/projects', 'GET');
                break;

            case 'create_project':
                result = await btApiCall('/projects', 'POST', { name: args.name });
                break;

            case 'switch_project':
                result = await btApiCall('/projects', 'POST', { action: 'switch', name: args.name });
                break;

            // ── Tab management ──────────────────────────────────
            case 'list_tabs':
                result = await btApiCall('/tabs', 'GET');
                break;

            // ── Recipe management ───────────────────────────────
            case 'list_recipes':
                result = await btApiCall('/recipes', 'GET');
                break;

            case 'save_recipes':
                result = await btApiCall('/recipes', 'POST', { recipes: args.recipes });
                break;

            // ── Provider management ─────────────────────────────
            case 'list_providers':
                result = await btApiCall('/providers', 'GET');
                break;

            // ── Phase B: Multi-run execution ────────────────────
            case 'spawn_run':
                result = await btApiCall('/bt/run', 'POST', {
                    file: args.file,
                    tree: args.tree,
                    group: args.group,
                    outputKey: args.outputKey,
                });
                break;

            case 'list_runs':
                result = await btApiCall('/runs', 'GET');
                break;

            case 'get_run_details':
                result = await btApiCall(`/runs/${encodeURIComponent(args.runId)}`, 'GET');
                break;

            case 'stop_run':
                result = await btApiCall(`/runs/${encodeURIComponent(args.runId)}/stop`, 'POST');
                break;

            // ── Phase F-A: Configuration ────────────────────────
            case 'get_config':
                result = await btApiCall('/config', 'GET');
                break;

            case 'set_config':
                result = await btApiCall('/config', 'POST', {
                    maxParallel: args.maxParallel,
                    maxConcurrentLLMCalls: args.maxConcurrentLLMCalls,
                });
                break;

            case 'get_metrics': {
                const q = args.group ? `?group=${encodeURIComponent(args.group)}` : '';
                result = await btApiCall('/metrics' + q, 'GET');
                break;
            }

            // ── Phase F-C: Advanced Features ────────────────────────
            case 'cancel_run':
                result = await btApiCall(`/runs/${encodeURIComponent(args.runId)}/stop`, 'POST');
                break;

            case 'set_retry_policy':
                result = await btApiCall('/config', 'POST', {
                    retry: {
                        maxRetries: args.maxRetries,
                        retryDelay: args.retryDelay,
                    }
                });
                break;

            // ── Phase C: Parallel primitives ──────────────────────
            case 'run_parallel':
                result = await btApiCall('/parallel/run', 'POST', {
                    specs: args.specs,
                    group: args.group,
                });
                break;

            case 'map_bt':
                result = await btApiCall('/parallel/map', 'POST', {
                    file: args.file,
                    tree: args.tree,
                    items: args.items,
                    itemKey: args.itemKey,
                    group: args.group,
                    outputKey: args.outputKey,
                });
                break;

            case 'join_runs':
                result = await btApiCall('/parallel/join', 'POST', {
                    group: args.group,
                    policy: args.policy,
                    minSuccess: args.minSuccess,
                    timeoutMs: args.timeoutMs,
                });
                break;

            case 'race_runs':
                result = await btApiCall('/parallel/race', 'POST', {
                    group: args.group,
                });
                break;

            case 'reduce_results':
                result = await btApiCall('/parallel/reduce', 'POST', {
                    group: args.group,
                    array: args.array,
                    mode: args.mode,
                    btReduceExpr: args.btReduceExpr,
                    initial: args.initial,
                    prompt: args.prompt,
                    provider: args.provider,
                    model: args.model,
                    saveAs: args.saveAs,
                });
                break;

            case 'get_behavior_tree_capabilities':
                result = await btApiCall('/bt/capabilities', 'GET');
                break;

            // ── Screenshot ──────────────────────────────────────
            case 'screenshot':
                result = await btApiCall('/screenshot', 'POST', {
                    format: args.format || 'png',
                    quality: args.quality,
                });
                if (result.screenshot) {
                    const mimeType = args.format === 'jpeg' ? 'image/jpeg' : 'image/png';
                    return {
                        content: [
                            {
                                type: 'image',
                                data: result.screenshot,
                                mimeType,
                            },
                        ],
                    };
                }
                return {
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                };

            default:
                throw new Error(`Unknown tool: ${name}`);
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    } catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Wend BT MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
