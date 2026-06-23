/**
 * BehaviorTreeEngine — BT execution engine
 *
 * Uses the following from app object:
 *   app.getNodeByPath(path, this.runId)
 *   this._runState  (Map)
 *   app.state.pipelineRun.running
 *   app.renderTree()
 *   app.outputMessage(msg)
 *   app.processPrompt()
 *   app.state.selectedOpPath, app.state.currentNodePath
 */
class BehaviorTreeEngine {
    constructor(app) {
        this._app = app;
        this._ctrl = null;
        this._stepResolve = null;
        this._leafCallback = null;      // kept for back-compat, single callback (deprecated)
        this._pendingCallbacks = new Map();  // Phase A: requestId → callback (concurrent-safe)
        this._nextRequestId = 1;        // counter for generating unique requestIds
        this._blackboard = this._createBbProxy({}, 'run');        // run scope (reset each run/cycle)
        this._tabBlackboard = this._createBbProxy({}, 'tab');     // tab scope (persists across runs within a tab)
        // project scope lives on app (shared across tabs); accessed via _projScope()
        // Execution config: mode='single'|'cycle', count=repeat count (0=infinite)
        this._config = { mode: 'single', count: 1 };
        this._runState = new Map();
        this._promptTokens = 0;
        this._completionTokens = 0;
        this._lastLeafError = null;   // set when a leaf fails with a real error (not semantic false)
        this._actionCleanups = null;   // cleanup hooks for registered actions
        if (this._app && this._app.addLog) {
            this._app.outputTrace('[BT Engine] Using custom BehaviorTreeEngine (bt.js)');
        }
        console.log('[BT Engine] Using custom BehaviorTreeEngine (bt.js)');
    }

    _createBbProxy(store, label) {
        const self = this;
        return new Proxy(store, {
            get(target, prop, receiver) {
                if (typeof prop === 'string' && !prop.startsWith('_') && prop !== 'constructor' && prop !== 'toJSON') {
                    self._bbNotifyChange();
                }
                const value = Reflect.get(target, prop, receiver);
                if (value !== null && typeof value === 'object') {
                    return new Proxy(value, {
                        set(subTarget, subProp, subValue, subReceiver) {
                            const res = Reflect.set(subTarget, subProp, subValue, subReceiver);
                            self._bbNotifyChange();
                            return res;
                        },
                        deleteProperty(subTarget, subProp) {
                            const res = Reflect.deleteProperty(subTarget, subProp);
                            self._bbNotifyChange();
                            return res;
                        }
                    });
                }
                return value;
            },
            set(target, prop, value, receiver) {
                const res = Reflect.set(target, prop, value, receiver);
                self._bbNotifyChange();
                return res;
            },
            deleteProperty(target, prop) {
                const res = Reflect.deleteProperty(target, prop);
                self._bbNotifyChange();
                return res;
            }
        });
    }

    /** Get a copy of the current blackboard contents (for debug/display) */
    getBlackboard() { return JSON.parse(JSON.stringify(this._blackboard)); }

    _bbNotifyChange() {
        if (this._bbChangeCallback) this._bbChangeCallback();
    }

    /** Manually set text from variable management dialog */
    bbSetText(key, value) {
        if (!this._blackboard[key]) this._blackboard[key] = {};
        this._blackboard[key].text = value;
        this._bbNotifyChange();
    }

    /** Manually set media from variable management dialog */
    bbSetMedia(key, mediaArray) {
        if (!this._blackboard[key]) this._blackboard[key] = {};
        this._blackboard[key].media = mediaArray;
        this._bbNotifyChange();
    }

    /** Clear a specific slot of a variable */
    bbClearSlot(key, type) {
        if (!this._blackboard[key]) return;
        if (type === 'text')  delete this._blackboard[key].text;
        if (type === 'media') delete this._blackboard[key].media;
        if (!Object.keys(this._blackboard[key]).length) delete this._blackboard[key];
        this._bbNotifyChange();
    }

    /** Clear an entire variable */
    bbClearKey(key) { delete this._blackboard[key]; this._bbNotifyChange(); }

    /** Project-scope store (shared across tabs, lives on app). */
    _projScope() {
        if (this._app) {
            if (!this._app._projectBlackboard) this._app._projectBlackboard = {};
            if (!this._app._projectBlackboardProxy) {
                this._app._projectBlackboardProxy = this._createBbProxy(this._app._projectBlackboard, 'project');
            }
            return this._app._projectBlackboardProxy;
        }
        // Fallback when no app (tests)
        if (!this.__projFallback) this.__projFallback = {};
        if (!this.__projFallbackProxy) {
            this.__projFallbackProxy = this._createBbProxy(this.__projFallback, 'project');
        }
        return this.__projFallbackProxy;
    }

    /** Resolve the store object for a given scope name. */
    _scopeStore(scope) {
        switch (scope) {
            case 'tab':     return this._tabBlackboard;
            case 'project': return this._projScope();
            case 'run':
            default:        return this._blackboard;
        }
    }

    /**
     * Read a slot's text by key, searching run → tab → project (first hit wins).
     * Returns null when nothing found.
     */
    _bbReadText(key) {
        for (const store of [this._blackboard, this._tabBlackboard, this._projScope()]) {
            const slot = store[key];
            if (slot) {
                if (slot.text != null) return slot.text;
                if (slot.data != null) return typeof slot.data === 'string' ? slot.data : JSON.stringify(slot.data);
            }
        }
        return null;
    }

    /** Read a slot's .data (structured) by key, run → tab → project. */
    _bbReadData(key) {
        for (const store of [this._blackboard, this._tabBlackboard, this._projScope()]) {
            const slot = store[key];
            if (slot && slot.data != null) return slot.data;
        }
        return null;
    }

    /** Read a slot's .reasoning (AI comment) by key, run → tab → project. */
    _bbReadReasoning(key) {
        for (const store of [this._blackboard, this._tabBlackboard, this._projScope()]) {
            const slot = store[key];
            if (slot && slot.reasoning != null) return slot.reasoning;
        }
        return null;
    }

    /** Read a slot's .media by key, run → tab → project. */
    _bbReadMedia(key) {
        for (const store of [this._blackboard, this._tabBlackboard, this._projScope()]) {
            const slot = store[key];
            if (slot && slot.media != null) return slot.media;
        }
        return null;
    }

    /**
     * Write a value into a slot at the given scope.
     * field: 'text' | 'media' | 'data'. Default scope 'run'.
     * Persists project scope to disk via app when scope==='project'.
     */
    bbWrite(key, value, scope = 'run', field = 'text') {
        this._app.outputDebug(`app ` + key + value + scope + field );
    
        if (scope === 'chest') {
            if (this._app && typeof this._app.btChestPut === 'function') {
                this._app.btChestPut(key, typeof value === 'string' ? value : JSON.stringify(value));
                if (this._app.addLog) this._app.outputDebug(`📋 Chest["${key}"] ← ${String(value).slice(0, 80)}`);
            }
            return;
        }
        const store = this._scopeStore(scope);
        if (!store[key]) store[key] = {};
        store[key][field] = value;
        if (scope === 'project' && this._app && typeof this._app.saveProjectBlackboard === 'function') {
            this._app.saveProjectBlackboard();
        }
        const preview = field === 'media'
            ? `${Array.isArray(value) ? value.length : 0} item(s)`
            : `"${String(value).slice(0, 80)}${String(value).length > 80 ? '…' : ''}"`;
        if (this._app && this._app.addLog) this._app.outputDebug(`📋 BB[${scope}:"${key}"].${field} ← ${preview}`);
        this._bbNotifyChange();
    }

    _findSlot(key) {
        for (const store of [this._blackboard, this._tabBlackboard, this._projScope()]) {
            if (store && store[key] !== undefined) {
                return store[key];
            }
        }
        return null;
    }

    /**
     * Expand placeholders in a prompt:
     *   {bb:key}   run→tab→project text fallback
     *   {tab:key}  tab scope text
     *   {proj:key} project scope text
     *   {chest:nm} named chest content (sync via app cache)
     *   {bb:key:json} JSON.stringify of .data
     */
    _expandPlaceholders(text) {
        if (!text) return text;
        const app = this._app;
        return text
            .replace(/\{bb:([^}:]+):json\}/g, (_, k) => {
                const d = this._bbReadData(k);
                if (d != null && app?.outputDebug) app.outputDebug(`📖 BB["${k}"].data → ${JSON.stringify(d).slice(0, 80)}`);
                return d != null ? JSON.stringify(d) : '';
            })
            .replace(/\{bb:([^}:]+):reasoning\}/g, (_, k) => {
                const r = this._bbReadReasoning(k);
                if (r != null && app?.outputDebug) app.outputDebug(`📖 BB["${k}"].reasoning → "${String(r).slice(0, 80)}…"`);
                return r != null ? r : '';
            })
            .replace(/\{bb:([^}]+)\}/g, (_, k) => {
                const slot = this._findSlot(k);
                if (slot) {
                    if (slot.text == null && (slot.media != null || slot.data != null)) {
                        const errorMsg = `Blackboard variable "${k}" is not of type "text"`;
                        if (app?.outputDebug) app.outputDebug(`❌ Error: ${errorMsg}`);
                        return `[ERROR: ${errorMsg}]`;
                    }
                }
                const v = this._bbReadText(k);
                if (v != null && app?.outputDebug) app.outputDebug(`📖 BB["${k}"].text → "${String(v).slice(0, 80)}${String(v).length > 80 ? '…' : ''}"`);
                return v != null ? v : '';
            })
            .replace(/\{tab:([^}]+)\}/g, (_, k) => {
                const slot = this._tabBlackboard[k];
                if (slot) {
                    if (slot.text == null && (slot.media != null || slot.data != null)) {
                        const errorMsg = `Tab blackboard variable "${k}" is not of type "text"`;
                        if (app?.outputDebug) app.outputDebug(`❌ Error: ${errorMsg}`);
                        return `[ERROR: ${errorMsg}]`;
                    }
                }
                const v = (slot && slot.text != null) ? slot.text : '';
                if (v && app?.outputDebug) app.outputDebug(`📖 Tab["${k}"].text → "${String(v).slice(0, 80)}${String(v).length > 80 ? '…' : ''}"`);
                return v;
            })
            .replace(/\{proj:([^}]+)\}/g, (_, k) => {
                const slot = this._projScope()[k];
                if (slot) {
                    if (slot.text == null && (slot.media != null || slot.data != null)) {
                        const errorMsg = `Project blackboard variable "${k}" is not of type "text"`;
                        if (app?.outputDebug) app.outputDebug(`❌ Error: ${errorMsg}`);
                        return `[ERROR: ${errorMsg}]`;
                    }
                }
                const v = (slot && slot.text != null) ? slot.text : '';
                if (v && app?.outputDebug) app.outputDebug(`📖 Proj["${k}"].text → "${String(v).slice(0, 80)}${String(v).length > 80 ? '…' : ''}"`);
                return v;
            })
            .replace(/\{chest:([^}]+)\}/g, (_, k) => {
                if (this._app && typeof this._app.btChestGet === 'function') {
                    const v = this._app.btChestGet(k);
                    if (v != null && app?.outputDebug) app.outputDebug(`📖 Chest["${k}"] → "${String(v).slice(0, 80)}${String(v).length > 80 ? '…' : ''}"`);
                    return v != null ? v : '';
                }
                return '';
            });
    }

    getConfig() { return Object.assign({}, this._config); }

    setConfig(cfg) {
        this._config = {
            mode: cfg.mode === 'cycle' ? 'cycle' : 'single',
            count: Math.max(0, parseInt(cfg.count) || 1),
        };
        this._updateCycleBadge();
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    setTarget(path) {
        const app = this._app;
        const node = app.getNodeByPath(path, this.runId);
        if (!node) return;
        this._ctrl = { targetPath: path, mode: 'idle' };
        this._stepResolve = null;
        this._runState.clear();
        app.renderTree();
        this._updateToolbar();
        const label = node.title ? atob(node.title) : path;
        const el = document.getElementById('bt-target-label');
        if (el) el.textContent = label;
        this._updateCycleBadge();
        app.outputMessage(`🎯 BT target: ${label}`);
    }

    run() {
        const ctrl = this._ctrl;
        if (!ctrl || ctrl.targetPath === null || ctrl.targetPath === undefined) return;
        if (ctrl.mode === 'running') return;
        if (ctrl.mode === 'stepping' && this._stepResolve) {
            ctrl.mode = 'running';
            this._updateToolbar();
            this._stepResolve('run');
            this._stepResolve = null;
            return;
        }
        ctrl.mode = 'running';
        this._updateToolbar();
        this._execute(ctrl.targetPath);
    }

    step() {
        const ctrl = this._ctrl;
        if (!ctrl || ctrl.targetPath === null || ctrl.targetPath === undefined) return;
        if (ctrl.mode === 'stepping' && this._stepResolve) {
            ctrl.mode = 'stepping';
            this._updateToolbar();
            this._stepResolve('step');
            this._stepResolve = null;
            return;
        }
        if (ctrl.mode === 'idle') {
            ctrl.mode = 'stepping';
            this._updateToolbar();
            this._execute(ctrl.targetPath);
        }
    }

    pause() {
        const ctrl = this._ctrl;
        if (!ctrl || ctrl.mode !== 'running') return;
        ctrl.mode = 'pausing';
        this._updateToolbar();
    }

    stop() {
        const ctrl = this._ctrl;
        if (!ctrl) return;
        ctrl.mode = 'stopped';
        this._updateToolbar();
        if (this._stepResolve) {
            this._stepResolve('stop');
            this._stepResolve = null;
        }
        if (this._leafCallback) {
            const cb = this._leafCallback;
            this._leafCallback = null;
            cb({ outputContent: '', error: true, _stopped: true });
        }
        // Fire action cleanup hooks (playAudio, playVideo, etc.)
        if (this._actionCleanups) {
            for (const fn of this._actionCleanups) {
                try { fn(); } catch (e) { /* ignore */ }
            }
            this._actionCleanups = null;
        }
    }

    retryNode() {
        const ctrl = this._ctrl;
        if (!ctrl || ctrl.mode !== 'error_paused') return;
        if (this._stepResolve) {
            this._stepResolve('retry');
            this._stepResolve = null;
        }
    }

    /** Called from onPipelineCompleted. Notify BT engine of leaf completion. Returns true = BT received it */
    notifyLeafComplete(meta) {
        // Phase A: requestId-based callback lookup (concurrent-safe)
        if (meta?.requestId) {
            const cb = this._pendingCallbacks.get(meta.requestId);
            if (cb) {
                cb(meta);
                return true;
            }
        }
        // Back-compat: fall back to single _leafCallback slot
        if (!this._leafCallback) return false;
        const cb = this._leafCallback;
        this._leafCallback = null;
        cb(meta);
        return true;
    }

    // ── Internal implementation ──────────────────────────────────────────────────────────────

    _updateToolbar() {
        const ctrl = this._ctrl;
        const hasTarget = !!(ctrl && ctrl.targetPath !== null && ctrl.targetPath !== undefined);
        const btnRun   = document.getElementById('btn-bt-run');
        const btnStep  = document.getElementById('btn-bt-step');
        const btnPause = document.getElementById('btn-bt-pause');
        const btnStop  = document.getElementById('btn-bt-stop');
        const btnRetry = document.getElementById('btn-bt-retry-node');
        if (!btnRun) return;
        if (!hasTarget) {
            btnRun.disabled = btnStep.disabled = btnPause.disabled = btnStop.disabled = true;
            if (btnRetry) btnRetry.style.display = 'none';
            return;
        }
        const mode = ctrl.mode;
        const isActive   = mode === 'running' || mode === 'pausing';
        const isErrPause = mode === 'error_paused';
        btnRun.disabled   = isActive || isErrPause;
        btnStep.disabled  = isActive || isErrPause;
        btnPause.disabled = !isActive;
        btnStop.disabled  = mode === 'idle';
        if (btnRetry) btnRetry.style.display = isErrPause ? '' : 'none';
    }

    _updateCycleBadge() {
        const el = document.getElementById('bt-cycle-badge');
        if (!el) return;
        const cfg = this._config;
        if (cfg.mode === 'cycle') {
            const label = cfg.count === 0 ? '♾️ ∞' : `🔄 ×${cfg.count}`;
            el.textContent = label;
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    }

    async _execute(path) {
        this._promptTokens = 0;
        this._completionTokens = 0;
        const app = this._app;
        if (app.state.pipelineRun.running) {
            app.outputMessage('⚠ Pipeline is already running');
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

        app.outputTrace(`▶ BT execution started${cycleLabel}`);

        let iter = 0;
        try {
            while (iter < maxIter) {
                iter++;
                this._blackboard = this._createBbProxy({}, 'run');  // Reset blackboard for each cycle
                this._runState.clear();
                app.renderTree();
                if (isCycle && maxIter !== Infinity) {
                    app.outputTrace(`🔁 Cycle ${iter}/${cfg.count}`);
                } else if (isCycle) {
                    app.outputTrace(`🔁 Cycle ${iter}`);
                }

                const success = await this._runNode(path);
                const ctrl = this._ctrl;
                if (ctrl && ctrl.mode === 'stopped') {
                    app.outputTrace('⏹ BT stopped');
                    break;
                }
                app.outputMessage(success ? `✅ Cycle ${iter} succeeded` : `❌ Cycle ${iter} failed`);

                if (iter < maxIter) {
                    // Check for stop between cycles
                    const ctrl2 = this._ctrl;
                    if (ctrl2 && (ctrl2.mode === 'stopped' || ctrl2.mode === 'pausing')) {
                        if (ctrl2.mode === 'pausing') {
                            ctrl2.mode = 'stepping';
                            this._updateToolbar();
                            const sig = await new Promise(r => { this._stepResolve = r; });
                            if (sig === 'stop') { app.outputTrace('⏹ BT stopped'); break; }
                            if (sig === 'run') { ctrl2.mode = 'running'; this._updateToolbar(); }
                        } else {
                    app.outputTrace('⏹ BT stopped');
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            if (e && e.message === 'BT_STOPPED') {
                app.outputTrace('⏹ BT stopped');
            } else {
                app.outputMessage('❌ BT error: ' + (e.message || e));
            }
        }

        // If interrupted by error or stop, change any remaining 'running' nodes to 'ng'
        if (this._runState) {
            for (const [k, v] of this._runState) {
                if (v === 'running') this._runState.set(k, 'ng');
            }
        }

        if (this._ctrl) this._ctrl.mode = 'idle';
        this._updateToolbar();
        app.renderTree();
    }

    async _runNode(path) {
        const app = this._app;
        const node = app.getNodeByPath(path, this.runId);
        if (!node) return false;

        if (!this._runState) this._runState.clear();

        const ctrl = this._ctrl;

        const nt = node.nodeType;
        if (nt === 'data' || nt === 'placeholder') {
            this._runState.set(path, 'ok');
            app.renderTree();
            return true;
        }

        const isRoot = nt === 'root' || (!nt && path === '');
        const effectiveBtType = node.btType || (isRoot ? 'sequence' : 'leaf');
        const _leafTypes = ['leaf', 'leaf_ai', 'leaf_math', 'leaf_file', 'leaf_web', 'leaf_misc', 'leaf_next', 'math', 'file', 'web', 'misc'];
        const _decoratorTypes = ['invert', 'repeater', 'retry', 'alwaysSucceed', 'alwaysFail', 'guard', 'delay', 'maxTime'];
        const _compositeTypes = ['sequence', 'selector', 'parallel', 'memSequence', 'memSelector'];
        const _memCompositeTypes = ['memSequence', 'memSelector'];
        const isLeaf = _leafTypes.includes(effectiveBtType);
        const isDecorator = _decoratorTypes.includes(effectiveBtType);

        if (isLeaf) {
            if (ctrl) {
                if (ctrl.mode === 'stopped') throw new Error('BT_STOPPED');
                if (ctrl.mode === 'stepping' || ctrl.mode === 'pausing') {
                    ctrl.mode = 'stepping';
                    this._updateToolbar();
                    const signal = await new Promise(res => { this._stepResolve = res; });
                    if (signal === 'stop') throw new Error('BT_STOPPED');
                    if (signal === 'run') { ctrl.mode = 'running'; this._updateToolbar(); }
                }
            }
            this._runState.set(path, 'running');
            app.renderTree();
            this._lastLeafError = null;
            let ok = await this._runLeaf(path);
            if (ctrl && ctrl.mode === 'stopped') throw new Error('BT_STOPPED');

            // If a real error occurred (not just semantic false), pause here for human intervention
            while (!ok && this._lastLeafError && ctrl && ctrl.mode !== 'stopped') {
                const errMsg = this._lastLeafError;
                this._lastLeafError = null;
                ctrl.mode = 'error_paused';
                this._updateToolbar();
                this._runState.set(path, 'error');
                app.renderTree();
                app.outputMessage(`⏸ Paused at error node [${path}]\n${errMsg}\n→ Fix the issue then click ↺ Retry Node, or ⏹ Stop`);

                const signal = await new Promise(res => { this._stepResolve = res; });
                if (signal === 'stop') throw new Error('BT_STOPPED');

                if (signal === 'retry') {
                    // Re-run this exact leaf in-place, blackboard state intact
                    ctrl.mode = 'running';
                    this._updateToolbar();
                    this._runState.set(path, 'running');
                    app.renderTree();
                    this._lastLeafError = null;
                    ok = await this._runLeaf(path);
                    if (ctrl && ctrl.mode === 'stopped') throw new Error('BT_STOPPED');
                    // loop: if it errors again, pause again
                } else {
                    // 'run' or 'step' — resume with current result (ok=false, let parent handle)
                    if (signal === 'run') { ctrl.mode = 'running'; this._updateToolbar(); }
                    break;
                }
            }

            this._runState.set(path, ok ? 'ok' : 'ng');
            app.renderTree();
            return ok;
        }

        if (isDecorator) {
            this._runState.set(path, 'running');
            app.renderTree();
            const ok = await this._runDecorator(effectiveBtType, path, node);
            if (ctrl && ctrl.mode === 'stopped') throw new Error('BT_STOPPED');
            this._runState.set(path, ok ? 'ok' : 'ng');
            app.renderTree();
            return ok;
        }

        // Compound type: decorator chain + composite (e.g. repeater+selector, repeater+retry+invert+selector)
        const plusIdx = effectiveBtType.indexOf('+');
        if (plusIdx > 0) {
            const parts = effectiveBtType.split('+');
            const compositePart = parts.pop();
            const decoratorParts = parts;
            if (decoratorParts.every(d => _decoratorTypes.includes(d)) && _compositeTypes.includes(compositePart)) {
                this._runState.set(path, 'running');
                app.renderTree();
                const ok = await this._runDecoratedComposite(decoratorParts, compositePart, path, node);
                if (ctrl && ctrl.mode === 'stopped') throw new Error('BT_STOPPED');
                this._runState.set(path, ok ? 'ok' : 'ng');
                app.renderTree();
                return ok;
            }
        }

        if (ctrl && ctrl.mode === 'stopped') throw new Error('BT_STOPPED');

        this._runState.set(path, 'running');
        app.renderTree();

        const childEntries = (node.children || []).map((c, i) => ({ c, i }));
        const makePath = i => path + '/' + i;

        if (effectiveBtType === 'sequence') {
            for (const { i } of childEntries) {
                const ok = await this._runNode(makePath(i));
                if (!ok) {
                    for (const { i: j } of childEntries.filter(e => e.i > i)) {
                        this._runState.set(makePath(j), 'skipped');
                    }
                    this._runState.set(path, 'ng');
                    app.renderTree();
                    return false;
                }
            }
            this._runState.set(path, 'ok');
            app.renderTree();
            return true;
        }

        if (effectiveBtType === 'selector') {
            for (const { i } of childEntries) {
                const ok = await this._runNode(makePath(i));
                if (ok) {
                    for (const { i: j } of childEntries.filter(e => e.i > i)) {
                        this._runState.set(makePath(j), 'skipped');
                    }
                    this._runState.set(path, 'ok');
                    app.renderTree();
                    return true;
                }
            }
            this._runState.set(path, 'ng');
            app.renderTree();
            return false;
        }

        if (effectiveBtType === 'parallel') {
            const promises = childEntries.map(({ i }) => this._runNode(makePath(i)));
            const results = await Promise.all(promises);
            const success = results.every(r => r);
            this._runState.set(path, success ? 'ok' : 'ng');
            app.renderTree();
            return success;
        }

        if (effectiveBtType === 'memSequence') {
            const startIndex = this._runState.get(path + '/_index') || 0;
            for (let i = startIndex; i < childEntries.length; i++) {
                const ok = await this._runNode(makePath(i));
                if (!ok) {
                    this._runState.set(path + '/_index', i);
                    for (const { i: j } of childEntries.filter(e => e.i > i)) {
                        this._runState.set(makePath(j), 'skipped');
                    }
                    this._runState.set(path, 'ng');
                    app.renderTree();
                    return false;
                }
            }
            this._runState.delete(path + '/_index');
            this._runState.set(path, 'ok');
            app.renderTree();
            return true;
        }

        if (effectiveBtType === 'memSelector') {
            const startIndex = this._runState.get(path + '/_index') || 0;
            for (let i = startIndex; i < childEntries.length; i++) {
                const ok = await this._runNode(makePath(i));
                if (ok) {
                    this._runState.delete(path + '/_index');
                    for (const { i: j } of childEntries.filter(e => e.i > i)) {
                        this._runState.set(makePath(j), 'skipped');
                    }
                    this._runState.set(path, 'ok');
                    app.renderTree();
                    return true;
                }
            }
            this._runState.delete(path + '/_index');
            this._runState.set(path, 'ng');
            app.renderTree();
            return false;
        }

        return false;
    }

    async _runDecorator(type, path, node) {
        const app = this._app;
        const hasMultipleChildren = node.children && node.children.length > 1;
        const childPath = path + '/0';
        const ctrl = this._ctrl;

        const runChild = hasMultipleChildren
            ? () => this._runChildrenAsComposite(path, 'sequence', node)
            : () => this._runNode(childPath);

        const checkStop = () => {
            if (ctrl && ctrl.mode === 'stopped') throw new Error('BT_STOPPED');
        };

        switch (type) {
            case 'invert': {
                const ok = await runChild();
                return !ok;
            }
            case 'alwaysSucceed': {
                await runChild();
                return true;
            }
            case 'alwaysFail': {
                await runChild();
                return false;
            }
            case 'repeater': {
                const count = parseInt(node.btRepeatCount) || 1;
                for (let i = 0; i < count; i++) {
                    checkStop();
                    const ok = await runChild();
                    if (!ok) return false;
                }
                return true;
            }
            case 'retry': {
                const maxRetries = parseInt(node.btRetryCount) || 1;
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    checkStop();
                    const ok = await runChild();
                    if (ok) return true;
                }
                return false;
            }
            case 'delay': {
                const ms = parseInt(node.btDelay) || 1000;
                await new Promise(r => setTimeout(r, ms));
                checkStop();
                return await runChild();
            }
            case 'maxTime': {
                const timeout = parseInt(node.btTimeout) || 5000;
                let timeoutId;
                const timer = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('MAXTIME_TIMEOUT')), timeout);
                });
                try {
                    const result = await Promise.race([
                        runChild(),
                        timer
                    ]);
                    clearTimeout(timeoutId);
                    return result;
                } catch (e) {
                    clearTimeout(timeoutId);
                    if (e && e.message === 'MAXTIME_TIMEOUT') {
                        app.outputMessage('⚠ MaxTime timeout (' + timeout + 'ms) exceeded');
                        return false;
                    }
                    throw e;
                }
            }
            case 'guard': {
                const condition = node.btCondition || node.btInputKey;
                const value = condition ? this._bbReadText(condition) : null;
                const expected = node.btExpectedValue;
                const negate = !!node.btNegate;
                let passes = expected !== undefined
                    ? String(value) === String(expected)
                    : !!value;
                if (negate) passes = !passes;
                if (!passes) {
                    app.outputTrace('⛔ Guard "' + condition + '" failed (value=' + JSON.stringify(value) + ')');
                    return false;
                }
                app.outputTrace('✅ Guard "' + condition + '" passed');
                return await runChild();
            }
            default:
                return false;
        }
    }

    async _runChildrenAsComposite(path, compositeType, node) {
        const childEntries = (node.children || []).map((c, i) => ({ c, i }));
        const makePath = i => path + '/' + i;

        if (compositeType === 'sequence' || compositeType === 'memSequence') {
            const startIndex = compositeType === 'memSequence' ? (this._runState.get(path + '/_index') || 0) : 0;
            for (let i = startIndex; i < childEntries.length; i++) {
                const ok = await this._runNode(makePath(i));
                if (!ok) {
                    if (compositeType === 'memSequence') this._runState.set(path + '/_index', i);
                    return false;
                }
            }
            if (compositeType === 'memSequence') this._runState.delete(path + '/_index');
            return true;
        }

        if (compositeType === 'selector' || compositeType === 'memSelector') {
            const startIndex = compositeType === 'memSelector' ? (this._runState.get(path + '/_index') || 0) : 0;
            for (let i = startIndex; i < childEntries.length; i++) {
                const ok = await this._runNode(makePath(i));
                if (ok) {
                    if (compositeType === 'memSelector') this._runState.delete(path + '/_index');
                    return true;
                }
            }
            if (compositeType === 'memSelector') this._runState.delete(path + '/_index');
            return false;
        }

        if (compositeType === 'parallel') {
            const results = await Promise.all(childEntries.map(({ i }) => this._runNode(makePath(i))));
            return results.every(r => r);
        }

        return false;
    }

    async _runDecoratedComposite(decorators, compositeType, path, node) {
        // Base case: no decorators — run children as the composite directly
        if (decorators.length === 0) {
            return this._runChildrenAsComposite(path, compositeType, node);
        }

        const app = this._app;
        const ctrl = this._ctrl;
        const currentDecorator = decorators[0];
        const remainingDecorators = decorators.slice(1);

        // Child is either the next decorator level or the composite
        const runChild = remainingDecorators.length > 0
            ? () => this._runDecoratedComposite(remainingDecorators, compositeType, path, node)
            : () => this._runChildrenAsComposite(path, compositeType, node);

        const checkStop = () => {
            if (ctrl && ctrl.mode === 'stopped') throw new Error('BT_STOPPED');
        };

        switch (currentDecorator) {
            case 'invert': {
                const ok = await runChild();
                return !ok;
            }
            case 'alwaysSucceed': {
                await runChild();
                return true;
            }
            case 'alwaysFail': {
                await runChild();
                return false;
            }
            case 'repeater': {
                const count = parseInt(node.btRepeatCount) || 1;
                for (let i = 0; i < count; i++) {
                    checkStop();
                    const ok = await runChild();
                    if (!ok) return false;
                }
                return true;
            }
            case 'retry': {
                const maxRetries = parseInt(node.btRetryCount) || 1;
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    checkStop();
                    const ok = await runChild();
                    if (ok) return true;
                }
                return false;
            }
            case 'delay': {
                const ms = parseInt(node.btDelay) || 1000;
                await new Promise(r => setTimeout(r, ms));
                checkStop();
                return await runChild();
            }
            case 'maxTime': {
                const timeout = parseInt(node.btTimeout) || 5000;
                let timeoutId;
                const timer = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('MAXTIME_TIMEOUT')), timeout);
                });
                try {
                    const result = await Promise.race([runChild(), timer]);
                    clearTimeout(timeoutId);
                    return result;
                } catch (e) {
                    clearTimeout(timeoutId);
                    if (e && e.message === 'MAXTIME_TIMEOUT') {
                        app.outputMessage('⚠ MaxTime timeout (' + timeout + 'ms) exceeded');
                        return false;
                    }
                    throw e;
                }
            }
            case 'guard': {
                const condition = node.btCondition || node.btInputKey;
                const value = condition ? this._bbReadText(condition) : null;
                const expected = node.btExpectedValue;
                const negate = !!node.btNegate;
                let passes = expected !== undefined ? String(value) === String(expected) : !!value;
                if (negate) passes = !passes;
                if (!passes) {
                    app.outputTrace('⛔ Guard "' + condition + '" failed');
                    return false;
                }
                return await runChild();
            }
            default:
                return false;
        }
    }

    _runLeaf(path) {
        const app  = this._app;
        const node = app.getNodeByPath(path, this.runId);

        const btType = node?.btType || 'leaf';

        // Legacy btType → btAction name mapping for backward compat
        const typeToAction = {
            'leaf_file': 'loadLocalFile', 'file': 'loadLocalFile',
            'leaf_audio': 'playAudio',    'audio': 'playAudio',
            'leaf_video': 'playVideo',    'video': 'playVideo',
            'leaf_math':  'math',         'math':  'math',
            'leaf_web':   'web',          'web':   'web',
            'leaf_misc':  'misc',         'misc':  'misc',
        };
        const actionName = node?.btAction || typeToAction[btType] || '';

        if (actionName && window.btActions.has(actionName)) {
            return this._runAction(path, node);
        }

        if (btType === 'leaf_next') {
            return this._runNext(path, node);
        }
        return this._runAI(path, node);
    }

    async _runAction(path, node) {
        const app = this._app;
        app.state.selectedOpPath = path;
        app.state.currentNodePath = path;
        app.renderTree();

        const btType = node?.btType || 'leaf';
        const typeToAction = {
            'leaf_file': 'loadLocalFile', 'file': 'loadLocalFile',
            'leaf_audio': 'playAudio',    'audio': 'playAudio',
            'leaf_video': 'playVideo',    'video': 'playVideo',
            'leaf_math':  'math',         'math':  'math',
            'leaf_web':   'web',          'web':   'web',
            'leaf_misc':  'misc',         'misc':  'misc',
        };
        const actionName = node?.btAction || typeToAction[btType] || '';
        const config = window.btActions.get(actionName);
        if (!config) {
            app.outputMessage(`❌ Unknown action "${actionName}"`);
            return false;
        }

        const inputKey   = node?.btInputKey  || '';
        const outputKey  = node?.btOutputKey || '';
        const outputType = node?.btOutputType || 'text';

        // Resolve prompt with BB expansion
        const btPromptRaw = node?.btPrompt || '';
        const btPromptDecoded = btPromptRaw
            ? (() => { try { return atob(btPromptRaw); } catch { return btPromptRaw; } })()
            : '';
        const prompt = btPromptDecoded
            ? this._expandPlaceholders(btPromptDecoded)
            : '';

        // Read media from blackboard if input key exists
        const mediaArr = inputKey ? this._bbReadMedia(inputKey) : null;

        // Read text from blackboard if input key exists
        const textInput = inputKey ? this._bbReadText(inputKey) : null;

        // Action lifecycle: store cleanup hooks so stop() can fire them
        const cleanups = [];
        this._actionCleanups = cleanups;

        const setCleanup = (fn) => { cleanups.push(fn); };

        const ctx = {
            bt: this, app, path, node,
            inputKey, outputKey, outputType,
            prompt, textInput, mediaArr,
            setCleanup,
        };

        try {
            const result = await config.handler(ctx);
            return result !== false;
        } catch (e) {
            app.outputMessage(`❌ Action "${config.label}" error: ${e.message}`);
            return false;
        } finally {
            if (this._actionCleanups === cleanups) this._actionCleanups = null;
            app.state.currentNodePath = '';
            app.renderTree();
        }
    }

    _runAI(path, node) {
        const app = this._app;
        const inputKey   = node?.btInputKey  || '';
        const inputType  = node?.btInputType || 'text';
        const outputKey  = node?.btOutputKey || '';
        let   outputType = node?.btOutputType || 'text';
        // Auto-derive audio (t2a) from the recipe usecase so a Text-to-Audio
        // recipe never produces a text/t2t-typed node with a wav attached.
        if (outputType === 'text' && node?.selectedRecipe && typeof app._classifyRecipeUsecase === 'function') {
            const rec = (app.state.recipes || []).find(r => r.name === node.selectedRecipe);
            if (rec && app._classifyRecipeUsecase(rec) === 'Text-to-Audio (T2A)') outputType = 't2a';
        }
        const btPromptRaw = node?.btPrompt   || '';
        const btPromptDecoded = btPromptRaw
            ? (() => { try { return atob(btPromptRaw); } catch { return btPromptRaw; } })()
            : '';

        const outputScope = node?.btOutputScope || 'run';

        // Expand {bb:}/{tab:}/{proj:}/{chest:} placeholders
        const resolvedPrompt = btPromptDecoded
            ? this._expandPlaceholders(btPromptDecoded)
            : null;

        // Resolve input from blackboard (run→tab→project fallback). Input
        // modality is auto-detected from what the slot actually holds: if it
        // carries media (audio/image/video) we feed it as media, otherwise as
        // text. This makes a2t/v2t/i2t "just work" as ordinary t2*-looking
        // recipes — the engine switches on the real input, not a fixed type.
        // An explicit btInputType still forces a single modality when set.
        // Feed every modality the slot actually holds (text AND media together
        // when both are present) so multimodal services receive everything;
        // the provider drops what it can't consume (provider-capability filter).
        const forcedType = node?.btInputType;
        const bbMediaInput = (inputKey && forcedType !== 'text')  ? this._bbReadMedia(inputKey) : null;
        const bbTextInput  = (inputKey && forcedType !== 'media') ? this._bbReadText(inputKey)  : null;

        // Phase A: Generate unique requestId for concurrent LLM calls
        const requestId = String(this._nextRequestId++);
        const targetNodePath = path;  // pass the node path through the request

        // Set BT-specific context that processPrompt() will read
        app.state.btRunContext = {
            requestId,        // Phase A: added for concurrent-safe callback routing
            targetNodePath,   // Phase A: where output goes (not selectedOpPath)
            prompt:       resolvedPrompt,
            bbTextInput:  bbTextInput,
            bbMediaInput: bbMediaInput,
            outputKey:    outputKey || null,
        };

        return new Promise(resolve => {
            app.state.selectedOpPath  = path;
            app.state.currentNodePath = path;
            app.renderTree();

            // Phase A: Store callback in Map, keyed by requestId (concurrent-safe)
            const callback = (meta) => {
                app.state.btRunContext = null;
                this._pendingCallbacks.delete(requestId);  // cleanup
                if (meta.steps && Array.isArray(meta.steps)) {
                    for (const step of meta.steps) {
                        this._promptTokens += step.promptTokens || 0;
                        this._completionTokens += step.completionTokens || 0;
                    }
                }
                if (meta?._stopped) { resolve(false); return; }
                
                if (!meta.error && outputKey) {
                    const outMedia = Array.isArray(meta.outputAttachments) ? meta.outputAttachments : [];
                    if (outputType === 't2a' || outputType === 'media') {
                        // Audio/media output (t2a): store the media payload only.
                        // Do NOT also write a text slot — that dual write mis-typed
                        // the data node as t2t with an attached wav.
                        if (outMedia.length > 0) {
                            this.bbWrite(outputKey, outMedia, outputScope, 'media');
                        } else if (meta.outputContent != null) {
                            this.bbWrite(outputKey, meta.outputContent, outputScope, 'text');
                        }
                    } else {
                        if (meta.outputContent != null) {
                            this.bbWrite(outputKey, meta.outputContent, outputScope, outputType);
                        }
                        if (outMedia.length > 0) {
                            this.bbWrite(outputKey, outMedia, outputScope, 'media');
                        }
                    }
                    // Reasoning is a separate channel: stored on the slot's
                    // .reasoning sub-field, referenceable via {bb:key:reasoning}.
                    if (meta.reasoning) {
                        this.bbWrite(outputKey, meta.reasoning, outputScope, 'reasoning');
                    }
                }
                const outText = (meta && meta.outputContent) ? String(meta.outputContent).trim() : '';
                let isSuccess = !meta.error;
                const normalized = outText.toLowerCase().replace(/[^a-z]/g, '');
                if (normalized === 'false') {
                    isSuccess = false;
                }
                // Track real errors (API/network failures) so _runNode can pause
                if (meta.error) {
                    this._lastLeafError = meta.message || meta.errorMessage || 'Leaf execution error';
                }
                resolve(isSuccess);
            };
            this._pendingCallbacks.set(requestId, callback);
            this._leafCallback = callback;  // back-compat: keep single-slot reference
            app.processPrompt();
        });
    }

    async _runNext(path, node) {
        const app = this._app;
        app.state.selectedOpPath = path;
        app.state.currentNodePath = path;
        app.renderTree();

        const fsmName = node.btFsmName?.trim() || 'main';
        const fsmState = node.btFsmState?.trim() || '';

        if (!fsmState) {
            app.outputMessage(`❌ leaf_next [${path}]: btFsmState is required`);
            return false;
        }

        // Find tab whose name matches the target state
        const tabIndex = app.state.tabs.findIndex(t => t.name === fsmState);
        if (tabIndex < 0) {
            app.outputMessage(`❌ leaf_next: no tab named "${fsmState}" found`);
            return false;
        }

        // Write state register to project BB
        const bbKey = `fsm.${fsmName}`;
        this.bbWrite(bbKey, fsmState, 'project', 'text');
        app.outputTrace(`🔀 FSM[${fsmName}] → "${fsmState}"`);

        // Switch to the target tab and run its BT from root
        app.switchTab(tabIndex);
        app.btCtrlSetTarget('');
        app.btCtrlRun();
        return true;
    }
}
