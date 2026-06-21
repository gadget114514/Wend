/**
 * behavior3js Adapter for Wend
 * Wraps b3 execution engine and provides execution loop
 */

class Behavior3Adapter {
    constructor(app) {
        this._app = app;
        this._ctrl = null;
        this._stepResolve = null;
        this._blackboard = null;  // b3.Blackboard instance
        this._tree = null;
        this._config = { mode: 'single', count: 1 };
        this._executionTrace = [];
        this._tickResolve = null;  // Promise resolver for waiting on RUNNING nodes
        this._isTickWaiting = false;
        this._log('🔧 Behavior3Adapter initialized');
    }

    _log(msg) {
        const timestamp = new Date().toLocaleTimeString();
        const fullMsg = `[${timestamp}] [B3] ${msg}`;

        // Log to app message window
        if (this._app && this._app.addLog) {
            this._app.addLog(fullMsg);
        }

        // Log to browser/electron console
        console.log(fullMsg);

        // For errors, also log with warn/error level
        if (msg.includes('❌') || msg.includes('Error') || msg.includes('failed')) {
            console.error(fullMsg);
        }
    }

    _logError(msg, error) {
        const timestamp = new Date().toLocaleTimeString();
        const errorMsg = `[${timestamp}] [B3] ❌ ${msg}`;
        const errorDetail = error ? `\n  ${error.message}\n  ${error.stack}` : '';

        // Log to app message window
        if (this._app && this._app.addLog) {
            this._app.addLog(errorMsg);
            if (errorDetail) {
                this._app.addLog(`  Details: ${error.message}`);
            }
        }

        // Log to console with full stack trace
        console.error(errorMsg);
        if (error) {
            console.error('  Error:', error.message);
            console.error('  Stack:', error.stack);
        }
    }

    /**
     * Set execution target (tree root)
     */
    setTarget(path) {
        this._log(`setTarget(${path})`);
        const node = this._app.getNodeByPath(path);
        if (!node) {
            this._logError(`Node not found at path: ${path}`);
            return;
        }

        this._log(`✅ Node found: ${node.title ? this._app.safeAtob(node.title) : 'untitled'}`);
        this._ctrl = { targetPath: path, mode: 'idle' };
        this._stepResolve = null;
        this._app.state.btRunState = new Map();
        this._executionTrace = [];

        // Convert tree to b3 format
        this._log(`Converting tree to B3 format...`);
        try {
            this._tree = B3TreeConverter.wendToB3(node, 'target-' + path);
            this._log(`✅ Tree converted: ${Object.keys(this._tree.nodes).length} nodes`);
        } catch (e) {
            this._logError(`Conversion failed`, e);
            return;
        }

        this._registerCustomActions();

        this._app.renderTree();
        this._updateToolbar();

        const label = node.title ? this._app.safeAtob(node.title) : path;
        const el = document.getElementById('bt-target-label');
        if (el) el.textContent = label;
        this._log(`🎯 BT target set: ${label}`);
    }

    /**
     * Register custom action nodes with b3 registry
     * @private
     */
    _registerCustomActions() {
        this._log('Registering custom action nodes...');

        // Register ProcessPromptAction if available
        try {
            if (typeof ProcessPromptAction !== 'undefined') {
                b3NodeRegistry.register('ProcessPromptAction', ProcessPromptAction);
                this._log('✅ ProcessPromptAction registered');
            } else if (window.ProcessPromptAction) {
                b3NodeRegistry.register('ProcessPromptAction', window.ProcessPromptAction);
                this._log('✅ ProcessPromptAction registered (from window)');
            } else {
                this._log('⚠️ ProcessPromptAction not found');
            }
        } catch (e) {
            this._logError('Failed to register ProcessPromptAction', e);
        }

        // Register LoadLocalFileAction if available
        try {
            if (typeof LoadLocalFileAction !== 'undefined') {
                b3NodeRegistry.register('LoadLocalFileAction', LoadLocalFileAction);
                this._log('✅ LoadLocalFileAction registered');
            } else if (window.LoadLocalFileAction) {
                b3NodeRegistry.register('LoadLocalFileAction', window.LoadLocalFileAction);
                this._log('✅ LoadLocalFileAction registered (from window)');
            } else {
                this._log('⚠️ LoadLocalFileAction not found');
            }
        } catch (e) {
            this._logError('Failed to register LoadLocalFileAction', e);
        }
    }

    /**
     * Run execution
     */
    run() {
        this._log('run() called');
        const ctrl = this._ctrl;
        if (!ctrl || ctrl.targetPath === null || ctrl.targetPath === undefined) {
            this._log('❌ No target set');
            return;
        }
        if (ctrl.mode === 'running') {
            this._log('⚠️ Already running');
            return;
        }
        if (ctrl.mode === 'stepping' && this._stepResolve) {
            this._log('Resuming from step...');
            ctrl.mode = 'running';
            this._updateToolbar();
            this._stepResolve('run');
            this._stepResolve = null;
            return;
        }
        this._log('Starting execution...');
        ctrl.mode = 'running';
        this._updateToolbar();
        this._execute(ctrl.targetPath);
    }

    /**
     * Step execution
     */
    step() {
        this._log('step() called');
        const ctrl = this._ctrl;
        if (!ctrl || ctrl.targetPath === null || ctrl.targetPath === undefined) {
            this._log('❌ No target set');
            return;
        }
        if (ctrl.mode === 'stepping' && this._stepResolve) {
            this._log('Resuming step...');
            ctrl.mode = 'stepping';
            this._updateToolbar();
            this._stepResolve('step');
            this._stepResolve = null;
            return;
        }
        if (ctrl.mode === 'idle') {
            this._log('Starting step-through mode...');
            ctrl.mode = 'stepping';
            this._updateToolbar();
            this._execute(ctrl.targetPath);
        }
    }

    /**
     * Pause execution
     */
    pause() {
        this._log('pause() called');
        const ctrl = this._ctrl;
        if (!ctrl || ctrl.mode !== 'running') {
            this._log('⚠️ Cannot pause (not running)');
            return;
        }
        this._log('Pausing execution...');
        ctrl.mode = 'pausing';
        this._updateToolbar();
    }

    /**
     * Stop execution
     */
    stop() {
        this._log('stop() called');
        const ctrl = this._ctrl;
        if (!ctrl) {
            this._log('⚠️ No active execution');
            return;
        }
        this._log('Stopping execution...');
        ctrl.mode = 'stopped';
        this._updateToolbar();
        if (this._stepResolve) {
            this._stepResolve('stop');
            this._stepResolve = null;
        }
    }

    /**
     * Notify leaf action completion (from pipeline)
     * CRITICAL: Called when processPrompt finishes
     */
    notifyLeafComplete(meta) {
        this._log(`notifyLeafComplete: error=${meta.error}, output="${String(meta.outputContent || '').slice(0, 30)}..."`);

        // Store result in blackboard for leaf to pick up
        if (this._app.state.btRunContext) {
            const nodeId = this._app.state.btRunContext.btActionNodeId;
            this._log(`  Storing result for nodeId: ${nodeId}`);
            if (nodeId && this._blackboard) {
                const resultStatus = !meta.error ? b3.Status.SUCCESS : b3.Status.FAILURE;
                this._blackboard.set(`_result_${nodeId}`, resultStatus);
                this._log(`  ✅ Stored result: ${resultStatus === b3.Status.SUCCESS ? 'SUCCESS' : 'FAILURE'}`);
            }
        }
        this._app.state.btRunContext = null;

        // CRITICAL: If we're waiting on a RUNNING node, resume the tick
        if (this._isTickWaiting && this._tickResolve) {
            this._log(`  🔄 Resuming tick after RUNNING...`);
            this._isTickWaiting = false;
            this._tickResolve();
            this._tickResolve = null;
        }

        return true;
    }

    /**
     * Get current blackboard state (copy for inspection)
     */
    getBlackboard() {
        const obj = {};
        if (this._blackboard) {
            for (const [key, value] of Object.entries(this._blackboard)) {
                if (!key.startsWith('_')) {
                    obj[key] = value;
                }
            }
        }
        return JSON.parse(JSON.stringify(obj));
    }

    /**
     * Manually set text in blackboard from UI dialog
     */
    bbSetText(key, value) {
        if (!this._blackboard) this._blackboard = new b3.Blackboard();
        const slot = this._blackboard.get(key) || {};
        slot.text = value;
        this._blackboard.set(key, slot);
        this._log(`bbSetText("${key}", "${String(value).slice(0, 20)}...")`);
    }

    /**
     * Manually set media in blackboard from UI dialog
     */
    bbSetMedia(key, mediaArray) {
        if (!this._blackboard) this._blackboard = new b3.Blackboard();
        const slot = this._blackboard.get(key) || {};
        slot.media = mediaArray;
        this._blackboard.set(key, slot);
        this._log(`bbSetMedia("${key}", ${mediaArray ? mediaArray.length : 0} items)`);
    }

    /**
     * Clear a specific slot (text or media) from blackboard
     */
    bbClearSlot(key, type) {
        if (!this._blackboard) return;
        const slot = this._blackboard.get(key);
        if (!slot) return;

        if (type === 'text') delete slot.text;
        if (type === 'media') delete slot.media;

        // Remove empty object
        if (!Object.keys(slot).length) {
            this._blackboard.set(key, undefined);
        } else {
            this._blackboard.set(key, slot);
        }
    }

    /**
     * Clear entire variable from blackboard
     */
    bbClearKey(key) {
        if (this._blackboard) {
            this._blackboard.set(key, undefined);
        }
    }

    /**
     * Set configuration
     */
    setConfig(cfg) {
        // Preserve count=0 for infinite loop mode
        let count = 1; // default
        console.log('setConfig called with cfg.count=', cfg.count, 'type=', typeof cfg.count, 'strict-0=', cfg.count === 0);
        if (cfg.count === 0) {
            count = 0; // infinite loop
            console.log('✓ count set to 0 (infinite loop)');
        } else if (cfg.count) {
            count = Math.max(0, parseInt(cfg.count) || 1);
            console.log('✓ count set to', count, '(parsed from', cfg.count, ')');
        } else {
            console.log('✓ count stays default: 1');
        }

        this._config = {
            mode: cfg.mode === 'cycle' ? 'cycle' : 'single',
            count: count,
        };
        console.log('setConfig result: this._config.count=', this._config.count);
    }

    /**
     * Get configuration
     */
    getConfig() {
        return Object.assign({}, this._config);
    }

    // ── Private methods ──

    /**
     * Main execution loop
     * @private
     */
    async _execute(path) {
        const app = this._app;
        if (app.state.pipelineRun.running) {
            app.addLog('⚠ Pipeline is already running');
            if (this._ctrl) this._ctrl.mode = 'idle';
            this._updateToolbar();
            return;
        }

        const cfg = this._config;
        const isCycle = cfg.mode === 'cycle';
        const maxIter = isCycle ? (cfg.count === 0 ? Infinity : cfg.count) : 1;
        const cycleLabel = isCycle
            ? (cfg.count === 0 ? ' (infinite loop)' : ` (${cfg.count} repeats)`)
            : '';

        app.addLog(`▶ BT execution started${cycleLabel}`);

        let iter = 0;
        try {
            while (iter < maxIter) {
                iter++;

                // Reset blackboard for each cycle (non-persistent mode)
                this._blackboard = new b3.Blackboard();
                app.state.btRunState = new Map();
                this._executionTrace = [];
                this._log(`🔄 Cycle ${iter}: Blackboard reset`);
                app.renderTree();

                if (isCycle && maxIter !== Infinity) {
                    app.addLog(`🔁 Cycle ${iter}/${cfg.count}`);
                } else if (isCycle) {
                    app.addLog(`🔁 Cycle ${iter}`);
                }

                // Execute tree
                const success = await this._executeTreeTick(app);
                const ctrl = this._ctrl;

                if (ctrl && ctrl.mode === 'stopped') {
                    app.addLog('⏹ BT stopped');
                    break;
                }

                app.addLog(success ? `✅ Cycle ${iter} succeeded` : `❌ Cycle ${iter} failed`);

                // Check pause between cycles
                if (iter < maxIter) {
                    const ctrl2 = this._ctrl;
                    if (ctrl2 && (ctrl2.mode === 'stopped' || ctrl2.mode === 'pausing')) {
                        if (ctrl2.mode === 'pausing') {
                            ctrl2.mode = 'stepping';
                            this._updateToolbar();
                            const sig = await new Promise(r => { this._stepResolve = r; });
                            if (sig === 'stop') {
                                app.addLog('⏹ BT stopped');
                                break;
                            }
                            if (sig === 'run') {
                                ctrl2.mode = 'running';
                                this._updateToolbar();
                            }
                        } else {
                            app.addLog('⏹ BT stopped');
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            if (e && e.message === 'BT_STOPPED') {
                app.addLog('⏹ BT stopped');
            } else {
                app.addLog('❌ BT error: ' + (e.message || e));
            }
        }

        // Cleanup
        if (app.state.btRunState) {
            for (const [k, v] of app.state.btRunState) {
                if (v === 'running') app.state.btRunState.set(k, 'ng');
            }
        }

        if (this._ctrl) this._ctrl.mode = 'idle';
        this._updateToolbar();
        app.renderTree();
    }

    /**
     * Execute one tick of the tree
     * @private
     */
    async _executeTreeTick(app) {
        this._log('_executeTreeTick: Building b3 tree...');
        // Build b3 tree instance from flat node registry
        let tree;
        try {
            tree = this._buildB3Tree();
            this._log(`✅ B3 tree built successfully`);
        } catch (e) {
            this._logError(`Failed to build b3 tree`, e);
            throw e;
        }

        // CRITICAL: Keep ticking until tree returns SUCCESS or FAILURE (not RUNNING)
        let tickCount = 0;
        let status;
        const maxTicks = 1000; // Safety limit

        while (tickCount < maxTicks) {
            tickCount++;
            this._log(`Executing tree tick #${tickCount}...`);

            try {
                status = tree.tick(this._blackboard);
                this._log(`  Tree tick returned status: ${status} (SUCCESS=${b3.Status.SUCCESS}, RUNNING=${b3.Status.RUNNING}, FAILURE=${b3.Status.FAILURE})`);
            } catch (e) {
                this._logError(`Tree tick failed`, e);
                throw e;
            }

            // Check control flow
            const ctrl = this._ctrl;
            if (ctrl && ctrl.mode === 'stopped') {
                this._log('⏹ Execution stopped by user');
                throw new Error('BT_STOPPED');
            }

            // If tree is running, wait for pipeline to complete
            if (status === b3.Status.RUNNING) {
                this._log('⏳ Tree returned RUNNING - waiting for pipeline completion...');
                this._isTickWaiting = true;

                // Wait for notifyLeafComplete to call us back
                await new Promise(res => { this._tickResolve = res; });
                this._log('✅ Pipeline completed, continuing tree tick...');
                // Loop will call tree.tick() again
                continue;
            }

            // Tree finished (success or failure)
            break;
        }

        if (tickCount >= maxTicks) {
            this._logError(`Tree tick loop exceeded max iterations (${maxTicks})`);
            throw new Error('Tree tick loop timeout');
        }

        // Handle stepping
        if (this._ctrl && (this._ctrl.mode === 'pausing' || this._ctrl.mode === 'stepping')) {
            this._log('⏸️ Paused, waiting for user input...');
            this._ctrl.mode = 'stepping';
            this._updateToolbar();
            const signal = await new Promise(res => { this._stepResolve = res; });
            this._log(`Resumed with signal: ${signal}`);
            if (signal === 'stop') throw new Error('BT_STOPPED');
            if (signal === 'run') {
                this._ctrl.mode = 'running';
                this._updateToolbar();
            }
        }

        // Update UI
        app.renderTree();

        // Return true if success, false if failure
        const result = status === b3.Status.SUCCESS;
        this._log(`Tick completed: ${result ? '✅ SUCCESS' : '❌ FAILURE'}`);
        return result;
    }

    /**
     * Build a b3 Tree instance from the flat node registry
     * Handles proper instantiation of decorator+composite nodes
     * @private
     */
    _buildB3Tree() {
        this._log(`Building B3 tree: root=${this._tree.root}, nodes=${Object.keys(this._tree.nodes).length}`);

        const nodeMap = this._tree.nodes;
        const rootId = this._tree.root;

        if (!nodeMap[rootId]) {
            this._logError(`Root node not found: ${rootId}`);
            throw new Error(`Root node not found: ${rootId}`);
        }

        // Create a closure to instantiate nodes on-demand
        const instantiateNode = (nodeId) => {
            const nodeDef = nodeMap[nodeId];
            if (!nodeDef) {
                this._log(`⚠️ Node definition not found: ${nodeId}`);
                return null;
            }

            const NodeClass = b3NodeRegistry.get(nodeDef.name);
            if (!NodeClass) {
                this._log(`⚠️ Unknown node type: ${nodeDef.name}`);
                return null;
            }

            // Instantiate the node
            let node;
            try {
                node = new NodeClass(nodeDef.properties || {});
                node.id = nodeId;
                node.title = nodeDef.title || nodeDef.name;
                this._log(`  ✓ Instantiated ${nodeDef.name} (${nodeId})`);
            } catch (e) {
                this._logError(`Failed to instantiate ${nodeDef.name}`, e);
                return null;
            }

            // Recursively attach children
            if (nodeDef.children && nodeDef.children.length > 0) {
                node.children = nodeDef.children
                    .map(childId => instantiateNode(childId))
                    .filter(child => child !== null);
            }

            return node;
        };

        // Build tree starting from root
        const rootNode = instantiateNode(rootId);
        if (!rootNode) {
            throw new Error(`Failed to build b3 tree: root node ${rootId} is invalid`);
        }

        // Create and return b3 tree
        return new b3.Tree({ root: rootNode });
    }

    /**
     * Update toolbar button states
     * @private
     */
    _updateToolbar() {
        const ctrl = this._ctrl;
        const hasTarget = !!(ctrl && ctrl.targetPath !== null && ctrl.targetPath !== undefined);
        const btnRun = document.getElementById('btn-bt-run');
        const btnStep = document.getElementById('btn-bt-step');
        const btnPause = document.getElementById('btn-bt-pause');
        const btnStop = document.getElementById('btn-bt-stop');

        if (!btnRun) return;

        if (!hasTarget) {
            btnRun.disabled = btnStep.disabled = btnPause.disabled = btnStop.disabled = true;
            return;
        }

        const mode = ctrl.mode;
        const isActive = mode === 'running' || mode === 'pausing';
        btnRun.disabled = isActive;
        btnStep.disabled = isActive;
        btnPause.disabled = !isActive;
        btnStop.disabled = mode === 'idle';
    }
}
