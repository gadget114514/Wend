// Wend App - Vanilla JS frontend

const app = {
    state: {
        tabs: [],
        activeTab: 0,
        currentNode: null,
        currentNodePath: '',
        selectedOpPath: '',
        selectedDataPath: '',
        selectedDataPaths: [],
        placeholderArchiveName: 'archive',
        language: 'en',
        testMode: false,
        translations: {},
        searchTimeout: null,
        navHistory: [],   // [{tabIndex, path}]
        navFuture: [],    // [{tabIndex, path}]
        viewMode: 'node', // "node" | "pipeline"
        outputTab: 'history', // "history" | "run"
        currentRunId: '',
        pipelineRun: {
            running: false,
            steps: [],       // [{index, name, type, completed, input, output, outputAttachments, artifacts}]
            selectedStep: -1
        },
        activeTreeTab: 'pipeline',
        fileTree: [],
        projects: [],
        activeProject: 'default',
        incompleteRuns: [],
        chestList: [],
        historyRetention: 50,
        defaultProvider: 'openai',
        defaultModel: '',
        defaultImageFit: 'contain',
        projectsRoot: '',
        projectsRootDefault: '',
        defaultRecipes: [],
        projectRecipes: [],
        selectedRecipe: '',
        editingRecipeIndex: -1,
        providerModels: {},
        collapsedPaths: new Set(),
        btLocked: false,
        btRunContext: null,    // Leaf context during BT execution {btPrompt, bbInput, outputKey}
        maintainRecipe: '',
        logHttpHeaders: false,
        viewOnlyMode: false
    },

    init() {
        this._bt = new BehaviorTreeEngine(this);
        this.addLog('[BT Engine] Active engine: custom BehaviorTreeEngine');
        this._engines = new Map();      // Phase B: runId → BehaviorTreeEngine (multi-instance)
        this._engines.set('__default__', this._bt);  // default engine for single-run mode
        this._messageListeners = [];
        this._projectBlackboard = {};   // project-scope BB (shared across tabs, persisted)
        this._chestCache = {};          // name → text cache for {chest:} placeholder reads
        this._projBbSaveTimer = null;   // debounce handle for saveProjectBlackboard
        this._taskMetricsInterval = null;  // Phase G: Task Manager auto-update timer
        this._taskMetrics = { activeCount: 0, queuedCount: 0, completedCount: 0, failedCount: 0, groups: {}, runs: {} };  // Task Manager state
        this.setupBridge();
        this.loadLanguage(this.state.language);
        this.loadDefaults();
        this.setupHints();
        this.initMessagesResizer();
        this.initPaneResizers();
        this.initOutputResizer();
        this.setupButtonJuice();
        window.addEventListener('beforeunload', () => {
            this.updateNode();
        });
        document.addEventListener('click', () => {
            this.hideTreeContextMenu();
            this.hideTabContextMenu();
        });
    },

    setupButtonJuice() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (btn && !btn.disabled) {
                btn.classList.add('btn-pressed');
                setTimeout(() => btn.classList.remove('btn-pressed'), 120);
            }
        }, true);
    },

    loadDefaults() {
        fetch('defaults/appproviders.json')
            .then(r => r.json())
            .then(list => { this.state.defaultProviders = list; })
            .catch(() => { this.state.defaultProviders = []; });
    },

    setupBridge() {
        const bridge = window.__promptsBridge || window.chrome?.webview;
        if (!bridge) { console.error('No IPC bridge available'); return; }
        bridge.addEventListener('message', (e) => {
            const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            this.handleBridge(msg);
        });
    },

    handleBridge(msg) {
        switch (msg.type) {
            case 'init':
                this.state.language = msg.payload.language || 'en';
                this.state.embedded = msg.payload.embedded || false;
                this.state.appDataPath = msg.payload.appDataPath || '';
                this.state.frontendRoot = msg.payload.frontendRoot || '';
                this.state.activeProject = msg.payload.currentProject || 'Default';
                this.loadLanguage(this.state.language);
                if (msg.payload.tabs && msg.payload.tabs.length > 0) {
                    this.state.tabs = msg.payload.tabs.map(t => ({
                        name: t.name,
                        file: t.file,
                        root: (msg.payload.nodes && msg.payload.nodes[t.file])
                              || { title:'', content:'', mimetype:'text/plain', attachments:[], children:[], nodeType: 'root' }
                    }));
                    this.state.tabs.forEach(t => this.patchNodeTypes(t.root, true));
                    this.renderTabs();
                    this.renderTree();
                    this.renderList();
                    if (this._bt) this._bt.setTarget('');
                }
                if (msg.payload.pipelines) {
                    this.state.pipelines = msg.payload.pipelines;
                }
                if (msg.payload.providers) {
                    this.state.providers = msg.payload.providers;
                }
                if (msg.payload.providerCapabilities) {
                    this.state.providerCapabilities = msg.payload.providerCapabilities;
                }
                if (msg.payload.config) {
                    if (msg.payload.config.historyRetention)
                        this.state.historyRetention = msg.payload.config.historyRetention;
                    if (msg.payload.config.chestList)
                        this.state.chestList = msg.payload.config.chestList;
                    if (msg.payload.config.defaultProvider)
                        this.state.defaultProvider = msg.payload.config.defaultProvider;
                    if (msg.payload.config.defaultModel !== undefined)
                        this.state.defaultModel = msg.payload.config.defaultModel;
                    if (msg.payload.config.defaultImageFit)
                        this.state.defaultImageFit = msg.payload.config.defaultImageFit;
                    if (msg.payload.config.logHttpHeaders !== undefined)
                        this.state.logHttpHeaders = msg.payload.config.logHttpHeaders;
                    if (msg.payload.config.viewOnlyMode !== undefined)
                        this.state.viewOnlyMode = msg.payload.config.viewOnlyMode;
                    if (msg.payload.config.maintainRecipe)
                        this.state.maintainRecipe = msg.payload.config.maintainRecipe;
                    if (msg.payload.config.customThemeColors) {
                        this.themes.custom.colors = {
                            ...this.themes.custom.colors,
                            ...msg.payload.config.customThemeColors
                        };
                    }
                    if (msg.payload.config.theme) {
                        this.state.theme = msg.payload.config.theme;
                        this.applyTheme(this.state.theme);
                    }
                    if (msg.payload.config.projectsRoot !== undefined)
                        this.state.projectsRoot = msg.payload.config.projectsRoot;
                    if (msg.payload.config.projectsRootDefault !== undefined)
                        this.state.projectsRootDefault = msg.payload.config.projectsRootDefault;
                }
                if (msg.payload.appIconDataUrl)
                    this.state.appIconDataUrl = msg.payload.appIconDataUrl;
                if (msg.payload.defaultRecipes) {
                    this.state.defaultRecipes = msg.payload.defaultRecipes;
                }
                if (msg.payload.projectRecipes) {
                    this.state.projectRecipes = msg.payload.projectRecipes;
                }
                this._projectBlackboard = msg.payload.projectBlackboard || {};
                if (msg.payload.placeholderArchiveName) {
                    this.state.placeholderArchiveName = msg.payload.placeholderArchiveName;
                }
                if (msg.payload.collapsedPaths) {
                    this.state.collapsedPaths = new Set(msg.payload.collapsedPaths);
                } else {
                    this.state.collapsedPaths = new Set();
                }
                if (msg.payload.demos) {
                    this.state.demos = msg.payload.demos;
                }
                // Always show hamburger (embedded: replaces menubar; standalone: supplement)
                const hb = document.getElementById('btn-hamburger');
                if (hb) hb.style.display = '';
                this.addLog('✅ ' + this.t('AppReady'));
                // Show wizard on first run
                if (!localStorage.getItem('prompts_wizard_done')) {
                    setTimeout(() => this.showWizard(), 400);
                }
                break;
            case 'node_updated':
                this.updateNodeUI(msg.payload);
                break;
            case 'stream_chunk':
                this.appendStreamOutput(msg.payload);
                break;
            case 'pipeline_init':
                this.onPipelineInit(msg.payload);
                break;
            case 'step_done':
                this.onStepDone(msg.payload);
                break;
            case 'step_started':
                this.highlightStep(msg.payload);
                break;
            case 'pipeline_error':
                this.showError(msg.payload.message);
                // Check if this is a recipe-related error and offer AI fix
                if (this.state.maintainRecipe && this._isRecipeError(msg.payload.message)) {
                    // Try to parse the recipe name from the error message
                    const recipeMatch = msg.payload.message.match(/Recipe:\s*([^\n\r]+)/);
                    const parsedRecipeName = recipeMatch ? recipeMatch[1].trim() : null;
                    let recipe = null;
                    if (parsedRecipeName) {
                        recipe = (this.state.recipes || []).find(r => r.name === parsedRecipeName);
                    }
                    if (!recipe) {
                        recipe = this.getRecipeSettings();
                    }
                    this.offerAIFix(msg.payload.message, recipe, 'Pipeline execution error');
                }
                if (this._bt) {
                    this._bt.notifyLeafComplete({ error: true, outputContent: '', message: msg.payload.message });
                }
                break;
            case 'rtf_position':
                this.onRtfPosition(msg.payload);
                break;
            case 'search_results':
                this.showSearchResults(msg.payload.results);
                break;
            case 'ready':
                this.sendInitData();
                break;
            case 'app_version':
                const verEl = document.getElementById('about-ver');
                if (verEl) verEl.textContent = msg.payload.version;
                break;
            case 'open_file_dialog_result':
                this.onFileSelected(msg.payload);
                break;
            case 'file_dialog_result':
                if (msg.payload && msg.payload.purpose === 'import_pipeline') {
                    this.onImportPipelineResult(msg.payload);
                } else {
                    this.onMediaFileDialogResult(msg.payload);
                }
                break;
            case 'create_parallel_tab':
                // Phase C-D: Backend requests tab creation for parallel debug view
                this.createParallelTab(msg.payload.runId, msg.payload.btFile);
                break;
            case 'pipeline_completed':
                this.onPipelineCompleted(msg.payload);
                break;
            case 'manual_step_pause':
                this.showManualStep(msg.payload);
                break;
            case 'wizard_step_pause':
                this.showPipelineWizardStep(msg.payload);
                break;
            case 'providers_result': {
                let payloadProviders = msg.payload;
                let customMetadata = null;
                if (msg.payload && typeof msg.payload === 'object' && msg.payload.hasOwnProperty('customMetadata') && msg.payload.hasOwnProperty('providers')) {
                    payloadProviders = msg.payload.providers;
                    customMetadata = msg.payload.customMetadata;
                }
                this.state.providers = payloadProviders || {};
                this.onProvidersResult(this.state.providers, customMetadata);
                // Re-render Recipe Manager if it's open
                if (document.getElementById('recipe-modal')?.classList.contains('visible')) {
                    this.renderRecipeManager();
                }
                break;
            }
            case 'model_list':
                if (msg.payload && msg.payload.models) {
                    if (!this.state.providerModels) this.state.providerModels = {};
                    this.state.providerModels[msg.payload.provider] = msg.payload.models;
                    // Update model inputs in Recipe Manager if open
                    if (document.getElementById('recipe-modal')?.classList.contains('visible')) {
                        this.updateRecipeManagerModels(msg.payload.provider);
                    }
                }
                break;
            case 'menu_command':
                this.handleMenuCommand(msg.payload);
                break;
            case 'open_file_result':
                this.onFileSelected(msg.payload.path);
                break;
            case 'file_tree_result':
                this.state.fileTree = msg.payload.tree || [];
                this.renderFileTree();
                break;
            case 'file_data_result':
                this.onFileDataResult(msg.payload.path, msg.payload.root, msg.payload.localRecipes);
                break;
            case 'rename_file_result':
                this.onRenameFileResult(msg.payload);
                break;
            case 'save_as_result':
                this.onSaveAsResult(msg.payload.path);
                break;
            case 'file_saved':
                this.addLog('💾 ' + msg.payload.path);
                break;
            case 'ai_maintain_result':
                this.onAIMaintainResult(msg.payload);
                break;
            case 'pipeline_list':
                this.state.pipelines = msg.payload.pipelines || [];
                // If pipeline manager is open, sync its local list
                if (this.pmState_) {
                    this.pmState_.pipelines = this.state.pipelines.slice();
                    this.pmRenderPipelineList();
                }
                this.addLog('📋 ' + this.t('PipelinesUpdated'));
                break;
            case 'history_list_result':
                this.onHistoryListResult(msg.payload);
                break;
            case 'history_detail_result':
                this.onHistoryDetailResult(msg.payload);
                break;
            case 'evaluation_saved':
                this.onEvaluationSaved(msg.payload);
                break;
            case 'optimize_proposals':
                this.onOptimizeProposals(msg.payload);
                break;
            case 'optimize_applied':
                this.onOptimizeApplied(msg.payload);
                break;
            case 'optimize_version_changed':
                this.onOptimizeVersionChanged(msg.payload);
                break;
            case 'optimize_version_list_result':
                this.onOptimizeVersionListResult(msg.payload);
                break;
            case 'optimize_error':
                this.onOptimizeError(msg.payload);
                break;
            case 'optimize_progress':
                this.onOptimizeProgress(msg.payload);
                break;
            case 'test_connection_result':
                this.onTestConnectionResult(msg.payload);
                break;
            case 'log':
                this.addLog('📋 ' + (msg.payload.message || ''));
                break;
            case 'http_log':
                this.addHttpLog(msg.payload);
                break;
            // ── Stream Model Extensions ──
            case 'step_filter_pause':
                this.showFilterStep(msg.payload);
                break;
            case 'step_filter_result':
                this.addLog(`🔍 ${this.t('FilterTitle')}: ${msg.payload.approved} ${this.t('Save')}, ${msg.payload.rejected} ${this.t('Discard')}`);
                break;
            case 'evaluate_result':
                this.showEvaluateResult(msg.payload);
                break;
            case 'chest_put':
                this.addLog(`📦 Sending to chest: ${msg.payload.chestName}`);
                this.postMessage({ type: 'send_to_chest', payload: msg.payload });
                if (!this._chestCache) this._chestCache = {};
                if (msg.payload.content != null) this._chestCache[msg.payload.chestName] = msg.payload.content;
                if (!this.state.chestList) this.state.chestList = [];
                if (!this.state.chestList.includes(msg.payload.chestName)) this.state.chestList.push(msg.payload.chestName);
                break;
            case 'chest_take':
                this.addLog(`📦 Loading from chest: ${msg.payload.chestName}`);
                this.postMessage({ type: 'select_input_source', payload: { source: 'chest', chestName: msg.payload.chestName } });
                break;
            case 'chest_view':
                if (!this._chestCache) this._chestCache = {};
                if (msg.payload.content != null) this._chestCache[msg.payload.name] = msg.payload.content;
                this.showChestContent(msg.payload.name, msg.payload.content);
                break;
            case 'save_run_state':
                this.postMessage({ type: 'save_run_state', payload: msg.payload });
                break;
            case 'incomplete_run_detected':
                this.state.incompleteRuns = msg.payload.runs || [];
                this.showIncompleteRuns();
                break;
            case 'save_before_close':
                this._flushAndClose();
                break;
            case 'project_changed':
                this.state.activeProject = msg.payload.projectName;
                if (msg.payload.tabs) {
                    this.state.tabs = msg.payload.tabs.map(t => ({
                        name: t.name,
                        file: t.file,
                        root: (msg.payload.nodes && msg.payload.nodes[t.file])
                              || { title:'', content:'', mimetype:'text/plain', attachments:[], children:[], nodeType: 'root' }
                    }));
                    this.state.tabs.forEach(t => this.patchNodeTypes(t.root, true));
                }
                if (msg.payload.pipelines) this.state.pipelines = msg.payload.pipelines;
                if (msg.payload.defaultRecipes) this.state.defaultRecipes = msg.payload.defaultRecipes;
                if (msg.payload.projectRecipes) this.state.projectRecipes = msg.payload.projectRecipes;
                // Project-scope blackboard (shared across tabs)
                this._projectBlackboard = msg.payload.projectBlackboard || {};
                if (this._bt) this._bt._tabBlackboard = {};  // reset tab scope on project switch
                if (msg.payload.placeholderArchiveName) this.state.placeholderArchiveName = msg.payload.placeholderArchiveName;
                if (msg.payload.collapsedPaths) {
                    this.state.collapsedPaths = new Set(msg.payload.collapsedPaths);
                } else {
                    this.state.collapsedPaths = new Set();
                }
                this.renderTabs();
                this.renderTree();
                this.addLog(`📁 Switched to project: ${msg.payload.projectName}`);
                break;
            case 'setup_demo_result': {
                const { sampleSubDir, success, projectName, count, error } = msg.payload;
                const btn = document.getElementById('btn-setup-demo-' + sampleSubDir);
                if (success) {
                    this.addLog(`✅ Demo setup complete: ${count} samples loaded into ${projectName} project`);
                    if (btn) { btn.textContent = '✅ Ready'; btn.disabled = true; }
                } else {
                    this.addLog(`Demo Setup Error\nOperation: setup_demo_result\nSample: ${sampleSubDir}\nError: ${error}\nAction: Verify sample files exist and are accessible`);
                    if (btn) { btn.textContent = '🎬 Setup Demo'; btn.disabled = false; }
                }
                break;
            }
            case 'project_list':
                console.log('[ProjectList] project_list received:', msg.payload.projects);
                // Only show dialog if not already open (refresh case)
                const modal = document.getElementById('project-list-modal');
                if (modal && modal.classList.contains('visible')) {
                    this._allProjects = msg.payload.projects.map(p => ({
                        name: p,
                        path: this.getProjectPath(p)
                    }));
                    this.filterProjectList();
                } else {
                    this.showProjectListDialog(msg.payload.projects || []);
                }
                break;
            case 'project_renamed':
                this.addLog(`📝 Project renamed: ${msg.payload.oldName} → ${msg.payload.newName}`);
                if (this.state.activeProject === msg.payload.oldName) {
                    this.state.activeProject = msg.payload.newName;
                }
                break;
            case 'project_duplicated':
                this.addLog(`📋 Project duplicated: ${msg.payload.sourceName} → ${msg.payload.newName}`);
                break;
            case 'project_deleted':
                this.addLog(`🗑️ Project deleted: ${msg.payload.name}`);
                break;
            case 'project_verified': {
                const v = msg.payload;
                let logMsg = `✓ Verify "${v.name}": ${v.status}`;
                if (v.issues.length > 0) logMsg += `\n  Issues: ${v.issues.join(', ')}`;
                if (v.fixes.length > 0) logMsg += `\n  Fixed: ${v.fixes.join(', ')}`;
                this.addLog(logMsg);
                break;
            }
            case 'project_error':
                this.addLog(`Project Error\nError: ${msg.payload.message}`);
                alert(`Project Error\n\n${msg.payload.message}`);
                break;
            case 'projects_root_result':
                this.showProjectsRootDialog(msg.payload.current, msg.payload.default);
                break;
            case 'projects_root_confirm':
                if (confirm(`Folder does not exist:\n${msg.payload.path}\n\nCreate it?`)) {
                    this.postMessage({ type: 'confirm_projects_root', payload: { path: msg.payload.path, create: true } });
                } else {
                    this.postMessage({ type: 'confirm_projects_root', payload: { create: false } });
                }
                break;
            case 'projects_root_changed':
                if (msg.payload.success) {
                    this.addLog('✅ ' + this.t('ProjectsRootUpdated'));
                    alert('Projects root folder updated.\nPlease restart the app for changes to take effect.');
                }
                break;
            case 'browse_folder_result':
                if (msg.payload?.path) {
                    const input = document.getElementById('config-projects-root');
                    if (input) input.value = msg.payload.path;
                }
                break;
            case 'bt_run_request':
                if (this._bt) {
                    if (msg.payload.targetPath) {
                        this._bt.setTarget(msg.payload.targetPath);
                    }
                    if (!this.state.btLocked) this._bt.run();
                }
                break;
            case 'bt_step_request':
                if (this._bt && !this.state.btLocked) this._bt.step();
                break;
            case 'bt_pause_request':
                if (this._bt) this._bt.pause();
                break;
            case 'bt_stop_request':
                if (this._bt) this._bt.stop();
                break;
            case 'bt_status_request':
                if (this._bt) {
                    const status = {
                        mode: this._bt._ctrl?.mode || 'idle',
                        targetPath: this._bt._ctrl?.targetPath || '',
                    };
                    this.postMessage({ type: 'bt_status_response', payload: status });
                }
                break;
            case 'bt_blackboard_request':
                if (this._bt) {
                    const scope = msg.payload?.scope || 'run';
                    let bb;
                    if (scope === 'tab')          bb = JSON.parse(JSON.stringify(this._bt._tabBlackboard || {}));
                    else if (scope === 'project') bb = JSON.parse(JSON.stringify(this._projectBlackboard || {}));
                    else                          bb = this._bt.getBlackboard();
                    this.postMessage({ type: 'bt_blackboard_response', payload: bb });
                }
                break;
            case 'bt_blackboard_set':
                if (this._bt) {
                    const { key, text, media, data, scope } = msg.payload;
                    const sc = scope || 'run';
                    if (text !== undefined)  this._bt.bbWrite(key, text, sc, 'text');
                    if (media !== undefined) this._bt.bbWrite(key, media, sc, 'media');
                    if (data !== undefined)  this._bt.bbWrite(key, data, sc, 'data');
                }
                break;
        }

        // Notify message listeners
        for (const handler of this._messageListeners) {
            try { handler(msg); } catch (e) { console.error('Message listener error:', e); }
        }
    },

    _addMessageListener(handler) {
        this._messageListeners.push(handler);
    },

    _removeMessageListener(handler) {
        this._messageListeners = this._messageListeners.filter(h => h !== handler);
    },

    postMessage(obj) {
        const bridge = window.__promptsBridge || window.chrome?.webview;
        if (bridge) bridge.postMessage(obj);
    },

    /** Persist project-scope blackboard to disk (debounced). Called by BT engine. */
    saveProjectBlackboard() {
        if (this._projBbSaveTimer) clearTimeout(this._projBbSaveTimer);
        this._projBbSaveTimer = setTimeout(() => {
            this._projBbSaveTimer = null;
            this.postMessage({ type: 'save_project_blackboard', payload: { data: this._projectBlackboard || {} } });
        }, 300);
    },

    /** Synchronous chest read for {chest:name} placeholder (cache-backed, best-effort). */
    btChestGet(name) {
        return (this._chestCache && this._chestCache[name] != null) ? this._chestCache[name] : null;
    },

    /** Write to a named chest (BT chest-scope output). */
    btChestPut(name, content) {
        if (!this._chestCache) this._chestCache = {};
        this._chestCache[name] = content;
        this.postMessage({ type: 'send_to_chest', payload: { chestName: name, content } });
        if (!this.state.chestList) this.state.chestList = [];
        if (!this.state.chestList.includes(name)) this.state.chestList.push(name);
    },

    // ── Phase B: Multi-engine support ────────────────────────
    /** Create a new BT engine instance for a specific runId. */
    createEngine(runId) {
        if (!this._engines) this._engines = new Map();
        const engine = new BehaviorTreeEngine(this);
        this._engines.set(runId, engine);
        return engine;
    },

    /** Get engine by runId, or the default engine. */
    getEngine(runId) {
        if (!this._engines) return this._bt;
        return this._engines.get(runId) || this._bt;
    },

    /** Set the active engine (for UI focus). */
    setActiveEngine(runId) {
        const engine = this.getEngine(runId);
        if (engine) {
            this._bt = engine;  // update active reference
            this.renderTree();
        }
    },

    // ── Phase C-D: Dynamic tab creation for parallel debugging ────
    /** Create a new tab for a parallel run (debug view). */
    createParallelTab(runId, btFile) {
        if (!this.state.tabs) this.state.tabs = [];
        if (!this._runIdToTabIndex) this._runIdToTabIndex = new Map();

        const tabName = `[${runId.slice(0, 8)}] ${btFile ? btFile.split('/').pop() : 'BT'}`;
        const tabFile = `parallel_${runId}.tab`;

        const newTab = {
            name: tabName,
            file: tabFile,
            runId: runId,  // Phase C-D: link tab to runId
            root: {
                title: '', content: '', mimetype: 'text/plain', attachments: [],
                children: [], nodeType: 'root', btType: 'sequence'
            }
        };

        this.state.tabs.push(newTab);
        const tabIndex = this.state.tabs.length - 1;
        this._runIdToTabIndex.set(runId, tabIndex);

        // Create engine for this runId if not exists
        if (!this._engines.has(runId)) {
            this.createEngine(runId);
        }

        // Switch to the new tab
        this.state.activeTab = tabIndex;
        this.renderTabs();
        this.renderTree();

        return tabIndex;
    },

    /** Get tab index for a runId. */
    getTabForRun(runId) {
        if (!this._runIdToTabIndex) return null;
        return this._runIdToTabIndex.get(runId);
    },

    // Flush any unsaved in-memory edits to main process, then signal ready to close
    _flushAndClose() {
        // Commit current node-content textarea if it's visible
        const nodeContentEl = document.getElementById('node-content');
        if (nodeContentEl) {
            const tab = this.state.tabs[this.state.selectedTabIndex];
            const node = tab && this.getNodeByPath(this.state.selectedOpPath);
            if (node) {
                node.content = nodeContentEl.value;
                this.postMessage({ type: 'save_node', payload: { tabFile: tab.file, root: tab.root } });
            }
        }
        // Commit input-textarea (tempInputAttachments text)
        const inputEl = document.getElementById('input-textarea');
        if (inputEl) {
            const srcPath = this.state.selectedOpPath || this.state.selectedDataPath;
            const srcNode = srcPath ? this.getNodeByPath(srcPath) : null;
            if (srcNode) {
                if (!srcNode.tempInputAttachments) srcNode.tempInputAttachments = {};
                srcNode.tempInputAttachments.text = inputEl.value;
                const tab = this.state.tabs[this.state.selectedTabIndex];
                if (tab) this.postMessage({ type: 'save_node', payload: { tabFile: tab.file, root: tab.root } });
            }
        }
        // Tell main process it's safe to close
        this.postMessage({ type: 'close_ready', payload: {} });
    },

    sendInitData() {
        this.postMessage({
            type: 'init_complete',
            language: this.state.language
        });
        this.addLog('✅ ' + this.t('AppInitialized'));
    },

    loadLanguage(lang) {
        this.state.language = lang;
        fetch(`lang/${lang}.json`)
            .then(r => r.json())
            .then(t => {
                this.state.translations = t;
                this.applyTranslations();
            })
            .catch(() => {
                if (lang !== 'en') this.loadLanguage('en');
            });
    },

    applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (this.state.translations[key]) {
                el.textContent = this.state.translations[key];
            }
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.dataset.i18nTitle;
            if (this.state.translations[key]) el.title = this.state.translations[key];
        });
        document.querySelectorAll('[data-i18n-hint]').forEach(el => {
            const key = el.dataset.i18nHint;
            if (this.state.translations[key]) el.dataset.hint = this.state.translations[key];
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            if (this.state.translations[key]) el.placeholder = this.state.translations[key];
        });
        document.title = this.state.translations.AppName || 'Wend';
    },

    // Tab management
    renderTabs() {
        const bar = document.getElementById('tab-bar');
        if (!bar) return;
        bar.innerHTML = '';

        // Add Hamburger menu button at the start of tab-bar
        const hb = document.createElement('button');
        hb.id = 'btn-hamburger';
        hb.textContent = '☰';
        hb.title = this.t('Menu') || 'Menu';
        hb.onclick = (e) => this.showHamburger(e);
        bar.appendChild(hb);

        this.state.tabs.forEach((tab, i) => {
            const el = document.createElement('div');
            el.className = 'tab' + (i === this.state.activeTab ? ' active' : '');
            let displayName = tab.name || 'Untitled';
            if (displayName.endsWith('.promptsbt')) {
                displayName = displayName.slice(0, -10);
            }
            el.textContent = displayName;

            // Set tooltip (hover title) to full path
            const appData = this.state.appDataPath || '';
            let fullPath = tab.file || '';
            if (fullPath && !fullPath.includes('\\') && !fullPath.includes('/')) {
                if (appData) {
                    const sep = appData.includes('\\') ? '\\' : '/';
                    fullPath = appData + sep + 'data' + sep + fullPath;
                }
            }
            el.title = fullPath;

            el.onclick = () => this.switchTab(i);
            el.oncontextmenu = (e) => {
                this.showTabContextMenu(e, i);
            };
            const close = document.createElement('span');
            close.className = 'close';
            close.textContent = '×';
            close.onclick = (e) => { e.stopPropagation(); this.closeTab(i); };
            el.appendChild(close);
            bar.appendChild(el);
        });
        // Add tab button
        const addBtn = document.createElement('div');
        addBtn.className = 'tab';
        addBtn.textContent = '+';
        addBtn.onclick = () => this.newTab();
        bar.appendChild(addBtn);
    },

	// switchTab means switch BT
    switchTab(index) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            this.clearAllSpeakingStyles();
        }
        this.state.activeTab = index;
        this.renderTabs();
        this.renderTree();
        this.renderList();
        if (this._bt) this._bt.setTarget('');
    },

	// closeTab means close BT
    closeTab(index) {
        if (this.state.tabs.length <= 1) return;
        this.state.tabs.splice(index, 1);
        if (this.state.activeTab >= this.state.tabs.length)
            this.state.activeTab = this.state.tabs.length - 1;
        this.postMessage({ type: 'save_session', payload: {
            tabs: this.state.tabs.map(t => ({ name: t.name, file: t.file }))
        }});
        this.renderTabs();
        this.renderTree();
        this.addLog(this.t('TabClosed'));
    },

	// renameTab means rename BT
    renameTab(index, newName) {
        if (!this.state.tabs[index]) return;
        let targetName = newName.trim();
        if (targetName === '') return;
        if (!targetName.endsWith('.promptsbt')) {
            targetName += '.promptsbt';
        }
        if (!this.isValidFileName(targetName)) {
            alert(this.t('InvalidFileName'));
            return;
        }
        const oldFile = this.state.tabs[index].file;
        let newFile = targetName;
        if (oldFile && (oldFile.includes('/') || oldFile.includes('\\'))) {
            const parts = oldFile.split(/[/\\]/);
            parts[parts.length - 1] = targetName;
            const sep = oldFile.includes('\\') ? '\\' : '/';
            newFile = parts.join(sep);
        }
        this.postMessage({ type: 'rename_file', payload: { oldFile, newFile } });
    },

	// newTab means create BT
    newTab() {
        const fileName = 'untitled_' + Date.now() + '.promptsbt';
        const rootNode = { title: '', content: '', mimetype: 'text/plain', attachments: [], children: [], nodeType: 'root' };
        this.state.tabs.push({ name: fileName, file: fileName, root: rootNode });
        this.state.activeTab = this.state.tabs.length - 1;
        this.state.currentNodePath = '';

        this.postMessage({ type: 'save_node', payload: { tabFile: fileName, root: rootNode } });
        this.postMessage({ type: 'save_session', payload: {
            tabs: this.state.tabs.map(t => ({ name: t.name, file: t.file }))
        }});

        this.renderTabs();
        this.renderTree();
        this.renderList();
        this.addLog('📄 ' + this.t('NewTabCreated'));
    },

    openFile() {
        this.postMessage({ type: 'open_file' });
    },

    onFileSelected(path) {
        if (path) {
            const idx = this.state.tabs.findIndex(t => t.file === path);
            if (idx >= 0) {
                this.switchTab(idx);
                return;
            }
            this.state.tabs.push({ name: path.split('/').pop().split('\\').pop(), file: path, root: { title: '', content: '', mimetype: 'text/plain', attachments: [], children: [], nodeType: 'root' } });
            this.state.activeTab = this.state.tabs.length - 1;
            this.renderTabs();
            this.addLog('📂 ' + this.t('Opened') + ': ' + path);
            this.postMessage({ type: 'load_file_data', payload: { path: path } });
        }
    },

    saveFile() {
        this.addLog('💾 ' + this.t('SaveRequested'));
        this.updateNode();
    },
    saveFileAs() {
        this.updateNode();
        this.postMessage({ type: 'save_file_as' });
        this.addLog('💾 ' + this.t('SaveAs'));
    },
    saveProject() {
        // Save all open BTs
        this.state.tabs.forEach((tab, i) => {
            if (tab.root) {
                this.postMessage({ type: 'save_node', payload: { tabFile: tab.file, root: tab.root } });
            }
        });
        // Save session (tab order and collapsed state)
        this.postMessage({ type: 'save_session', payload: {
            tabs: this.state.tabs.map(t => ({ name: t.name, file: t.file })),
            collapsedPaths: Array.from(this.state.collapsedPaths)
        }});
        // Save global config (recipes, providers, etc.)
        this.postMessage({ type: 'save_recipes', payload: this.state.recipes || [] });
        this.addLog('💾 ' + this.t('ProjectSaved'));
    },
    newProject() {
        this.showProjectInputModal(
            'New Project',
            'Enter a name for the new project:',
            '',
            (name) => {
                this.postMessage({ type: 'create_project', payload: { projectName: name } });
            }
        );
    },
    showProjectSwitcher() {
        // Get list of projects from backend
        this.postMessage({ type: 'list_projects' });
    },
    showProjectsRootConfig() {
        this.showConfig();
        // Switch to General tab and scroll to Projects Root section
        setTimeout(() => {
            const generalTab = document.querySelector('.config-tab:nth-child(2)');
            if (generalTab) generalTab.click();
        }, 100);
    },
    showProjectLifecycleInfo() {
        const info = `Project Lifecycle Information

A Project is the top-level container for organizing your work:

📁 Project Structure:
  • Each project has its own isolated storage for:
    - BT definitions (Behavior Trees)
    - Generated blobs (images, audio, etc.)
    - Recipes (AI configurations)
    - Execution history
    - Provider configurations

🔄 Project Switching:
  • Switch between projects to work on different tasks
  • Each project maintains its own state independently
  • Open BTs are saved per-project

💾 Save Semantics:
  • "Save Project" saves all open BTs + global config
  • "Save BT" saves only the current BT
  • "Save BT As..." creates a deep copy in a new location

📍 Projects Root Folder:
  • Configure where all projects are stored
  • Default: %APPDATA%/Wend
  • Change requires app restart

Current Project: ${this.state.activeProject || 'default'}
Data Path: ${this.state.appDataPath || '(not set)'}`;
        alert(info);
    },
    onPipelineCompleted(meta) {
        this.state.pipelineRun.running = false;
        this.addLog(`✅ Pipeline "${meta.pipelineName}" completed`);

        // Phase C-D: If this is a parallel run, route to the correct engine and tab
        if (meta.runId && this._runIdToTabIndex) {
            const tabIndex = this._runIdToTabIndex.get(meta.runId);
            if (tabIndex !== undefined) {
                this.state.activeTab = tabIndex;  // switch to parallel tab
            }
            const engine = this.getEngine(meta.runId);
            if (engine) engine.notifyLeafComplete(meta);
        } else {
            // Phase A: notifyLeafComplete will route via requestId if present, else fall back to state
            // If BT is running, notify leaf completion to BT engine (fall through to save output normally)
            if (this._bt) this._bt.notifyLeafComplete(meta);
        }

        const outputContent = meta.outputContent || '';
        const autoTitle = outputContent.replace(/\s+/g, ' ').trim().substring(0, 50) + (outputContent.length > 50 ? '...' : '');
        const tab = this.state.tabs[this.state.activeTab];
        // Phase A: Use targetNodePath from meta if available (from BT requestId correlation),
        // else fall back to selectedOpPath/currentNodePath (for non-BT or single-threaded execution)
        let opNodePath = meta.targetNodePath || (this.state.selectedOpPath || this.state.currentNodePath);
        opNodePath = this.getLogicalOpPath(opNodePath);
        let opNode = this.getNodeByPath(opNodePath);
        const opNodeCopy = opNode ? JSON.parse(JSON.stringify(opNode)) : null;
        if (opNodeCopy && opNodeCopy.children) {
            opNodeCopy.children = [];
        }
        const inputAttachmentsCopy = opNode && opNode.tempInputAttachments ? JSON.parse(JSON.stringify(opNode.tempInputAttachments)) : { text: '', files: [] };

        const recipeUsed = (opNode && opNode.selectedRecipe) || this.state.selectedRecipe || '';
        const outputNode = {
            title: this.safeB64(autoTitle || meta.pipelineName),
            content: this.safeB64(outputContent),
            mimetype: 'text/plain',
            attachments: [],
            children: [],
            pipelineMeta: JSON.stringify(meta),
            nodeType: 'data',
            originalOpNode: opNodeCopy,
            selectedRecipe: recipeUsed,
            input: inputAttachmentsCopy.text || '',
            inputAttachments: inputAttachmentsCopy.files || []
        };
        if (tab && opNode) {
            if (!opNode.children) opNode.children = [];

            let target = opNode;
            if (opNode.placeholderName) {
                let ph = opNode.children.find(c => c.nodeType === 'placeholder' || (!c.nodeType && c.title && this.safeAtob(c.title) === opNode.placeholderName));
                if (!ph) {
                    ph = { title: this.safeB64(opNode.placeholderName), nodeType: 'placeholder', children: [] };
                    opNode.children.push(ph);
                }
                target = ph;
            } else {
                const legacy = opNode.children.find(c => c.nodeType === 'placeholder' || (!c.nodeType && c.title && this.safeAtob(c.title) === 'Processed'));
                if (legacy) target = legacy;
            }
            if (!target.children) target.children = [];

            // Check for pending node first
            const pendingIdx = target.children.findIndex(c => c._pending);
            if (pendingIdx !== -1) {
                const pending = target.children[pendingIdx];
                pending.title = this.safeB64(autoTitle || meta.pipelineName);
                pending.content = this.safeB64(outputContent);
                pending.pipelineMeta = JSON.stringify(meta);
                pending.attachments = [];
                pending.originalOpNode = opNodeCopy;
                pending.selectedRecipe = recipeUsed;
                pending.input = inputAttachmentsCopy.text || '';
                delete pending._pending;
                this.state.selectedOutputRunIndex = 0;
                this.renderTree();
                this.renderList();
                if (tab.file && tab.root) {
                    this.postMessage({ type: 'save_node', payload: { tabFile: tab.file, root: tab.root } });
                }
                this.renderOutput();
                return;
            }

            target.children.unshift(outputNode);
            this.addLog(`📦 Child node saved: "${meta.pipelineName}"`);
            this.renderTree();
            this.renderList();
            if (tab.file && tab.root) {
                this.postMessage({ type: 'save_node', payload: { tabFile: tab.file, root: tab.root } });
            }
        }
        this.state.selectedOutputRunIndex = 0;
        this.renderOutput();

        // Phase D: Notify backend of run completion (for async execution tracking)
        if (meta.runId) {
            this.postMessage({
                type: 'bt_run_complete',
                payload: {
                    runId: meta.runId,
                    result: meta.outputContent || null,
                    error: meta.error || null
                }
            });
        }
    },

    renderPipelineMeta(node) {
        const el = document.getElementById('pipeline-meta-panel');
        if (!el) return;
        if (!node || !node.pipelineMeta) { el.style.display = 'none'; return; }

        let meta;
        try { meta = JSON.parse(node.pipelineMeta); } catch (e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: renderPipelineMeta\nNode: ${node.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); el.style.display = 'none'; return; }

        el.style.display = '';
        const stepsHtml = (meta.steps || []).map((s, i) => `
            <div class="meta-step">
                <span class="meta-step-num">${i + 1}</span>
                <span class="meta-step-name">${this.escapeHtml(s.name)}</span>
                <span class="meta-step-type">${this.escapeHtml(s.type)}</span>
                ${s.provider ? `<span class="meta-step-provider">${this.escapeHtml(s.provider)}</span>` : ''}
                ${s.model    ? `<span class="meta-step-model">${this.escapeHtml(s.model)}</span>` : ''}
                ${s.tokens   ? `<span class="meta-step-tokens">${s.tokens} tok</span>` : ''}
            </div>`).join('');

        el.innerHTML = `
            <div class="meta-header">
                <span class="meta-pipeline-name">📋 ${this.escapeHtml(meta.pipelineName)}</span>
                <span class="meta-date">${(meta.executedAt||'').replace('T',' ').replace('Z','')}</span>
                <button class="meta-reproduce-btn" data-pipeline="${this.escapeHtml(meta.pipelineName)}">▶ ${this.t('Reproduce')}</button>
                <button class="meta-save-btn">💾 ${this.t('SaveAsPipeline')}</button>
            </div>
            <div class="meta-steps">${stepsHtml}</div>`;
        // Attach click handlers
        const reproduceBtn = el.querySelector('.meta-reproduce-btn');
        if (reproduceBtn) {
            reproduceBtn.onclick = () => {
                const name = reproduceBtn.dataset.pipeline;
                if (name) this.reproducePipeline(name);
            };
        }
        const saveBtn = el.querySelector('.meta-save-btn');
        if (saveBtn) {
            saveBtn.onclick = () => {
                try {
                    const pipeline = {
                        name: meta.pipelineName || 'pipeline',
                        mode: 'basic',
                        outputMode: 'child',
                        outputNaming: '{pipeline_name}_{timestamp}',
                        steps: (meta.steps || []).map(s => {
                            const step = { name: s.name, type: s.type };
                            if (s.provider) step.provider = s.provider;
                            if (s.model) step.model = s.model;
                            if (s.systemPrompt) step.systemPrompt = s.systemPrompt;
                            if (s.userPrompt) step.userPrompt = s.userPrompt;
                            if (s.temperature) step.temperature = s.temperature;
                            return step;
                        })
                    };
                    this.postMessage({ type: 'save_pipeline', payload: pipeline });
                    this.addLog(`💾 ${this.t('PipelineSavedFromMeta').replace('{name}', pipeline.name)}`);
                } catch (e) {
                    this.addLog(`Pipeline Save Error\nOperation: renderPipelineMeta (save handler)\nError: ${e.message}\nAction: Check pipeline configuration and try saving again`);
                }
            };
        }
    },



    reproducePipeline(pipelineName) {
        if (!this.state.currentNode) { this.addLog('⚠ ' + this.t('PleaseSelectNode')); return; }
        const content = this.state.currentNode.content
            ? decodeURIComponent(escape(atob(this.state.currentNode.content))) : '';
        const tab = this.state.tabs[this.state.activeTab];
        this.postMessage({
            type: 'run_pipeline',
            payload: {
                pipelineName,
                nodeId: this.state.currentNodeId || '',
                tabFile: tab ? tab.file : '',
                content
            }
        });
        this.state.pipelineRun.running = true;
        this.addLog(`▶ Reproducing pipeline "${pipelineName}"...`);
    },

    showManualStep(payload) {
        const { index, mode, prompt, content, choices } = payload;
        const modal = document.getElementById('manual-modal');
        document.getElementById('manual-step-badge').textContent = `Step ${index + 1}`;
        document.getElementById('manual-prompt').textContent = prompt || '';
        document.getElementById('manual-prompt').style.display = prompt ? '' : 'none';

        const body = document.getElementById('manual-body');
        const actions = document.getElementById('manual-actions');

        if (mode === 'view') {
            document.getElementById('manual-title').textContent = this.t('Review');
            body.innerHTML = `<div class="manual-view-content">${this.escapeHtml(content)}</div>`;
            actions.innerHTML = `
                <button class="btn-primary" onclick="app.resumeManual(null)">Continue</button>
                <button onclick="app.cancelManual()">Cancel</button>`;

        } else if (mode === 'edit') {
            document.getElementById('manual-title').textContent = this.t('Edit');
            body.innerHTML = `<textarea id="manual-edit-area" class="manual-textarea">${this.escapeHtml(content)}</textarea>`;
            actions.innerHTML = `
                <button class="btn-primary" onclick="app.resumeManual(document.getElementById('manual-edit-area').value)">Continue</button>
                <button onclick="app.cancelManual()">Cancel</button>`;

        } else if (mode === 'compare') {
            document.getElementById('manual-title').textContent = this.t('CompareSelect');
            const branches = payload.branches || [];
            body.innerHTML = `<div class="compare-grid">${
                branches.map(b => `
                    <div class="compare-card">
                        <div class="compare-card-name">${this.escapeHtml(b.name)}</div>
                        <div class="compare-card-content">${this.escapeHtml(b.content)}</div>
                        <button class="btn-primary compare-select-btn"
                            onclick="app.resumeManual(${JSON.stringify(b.content)})">✓ ${this.t('SelectThis')}</button>
                    </div>`).join('')
            }</div>`;
            actions.innerHTML = `<button onclick="app.cancelManual()">Cancel</button>`;

        } else if (mode === 'select') {
            document.getElementById('manual-title').textContent = this.t('Select');
            // Show content preview if any
            body.innerHTML = content
                ? `<div class="manual-view-content">${this.escapeHtml(content)}</div>`
                : '';
            // Build choice buttons
            const list = (choices && choices.length) ? choices : [
                { label: 'Continue', action: 'next_step' },
                { label: 'Cancel',   action: 'cancel' }
            ];
            actions.innerHTML = list.map(c =>
                `<button class="${c.action === 'cancel' ? '' : 'btn-primary'}"
                    onclick="app.resumeManualChoice(${JSON.stringify(c)})"
                >${this.escapeHtml(c.label)}</button>`
            ).join('');
        }

        modal.classList.add('visible');
        this.addLog(`⏸ Manual step ${index + 1} — waiting for user (${mode})`);
    },

    resumeManual(content) {
        document.getElementById('manual-modal').classList.remove('visible');
        this.postMessage({ type: 'manual_step_resume', payload: { content: content ?? '' } });
    },

    resumeManualChoice(choice) {
        document.getElementById('manual-modal').classList.remove('visible');
        if (choice.action === 'cancel') {
            this.postMessage({ type: 'manual_step_cancel' });
        } else {
            this.postMessage({ type: 'manual_step_resume', payload: { content: choice.label, action: choice.action, gotoStep: choice.index } });
        }
    },

    cancelManual() {
        document.getElementById('manual-modal').classList.remove('visible');
        this.postMessage({ type: 'manual_step_cancel' });
    },

    // ── Pipeline Wizard Step ──────────────────────────────────────
    pwState_: { step: 0, values: {}, wizardData: null, index: 0 },

    showPipelineWizardStep(payload) {
        const { index, wizard, content } = payload;
        let wizardData = payload.wizardData;
        if (!wizardData && wizard) {
            // Try to fetch from frontend/wizards/
            this.addLog(`📋 ${this.t('LoadingWizard').replace('{wizard}', wizard)}`);
            fetch(`wizards/${wizard}.json`).then(r => r.json()).then(data => {
                this._renderPipelineWizard(index, data, content);
            }).catch(err => {
                this.addLog(`Wizard Load Error\nOperation: renderPipelineStep\nWizard: ${wizard}\nError: ${err.message}\nAction: Verify wizard file exists at wizards/${wizard}.json and is valid JSON`);
                this.postMessage({ type: 'wizard_step_resume', payload: { values: {} } });
            });
            return;
        }
        if (typeof wizardData === 'string') {
            try { wizardData = JSON.parse(wizardData); } catch { this.addLog('⚠ ' + this.t('FailedToParseWizardData')); }
        }
        this._renderPipelineWizard(index, wizardData, content);
    },

    _renderPipelineWizard(index, wizardData, content) {
        if (!wizardData || !wizardData.steps) {
            this.addLog('⚠ ' + this.t('InvalidWizardDefinition'));
            this.postMessage({ type: 'wizard_step_resume', payload: { values: {} } });
            return;
        }
        this.pwState_ = { step: 0, values: {}, wizardData, index };
        const modal = document.getElementById('wizard-modal');
        if (!modal) return;

        // Override wizard buttons for pipeline mode
        const skipBtn = document.getElementById('wizard-skip');
        const prevBtn = document.getElementById('wizard-prev');
        const nextBtn = document.getElementById('wizard-next');

        skipBtn.textContent = this.t('Cancel');
        skipBtn.onclick = () => {
            modal.classList.remove('visible');
            this.postMessage({ type: 'wizard_step_resume', payload: { values: {} } });
        };

        prevBtn.onclick = () => this.pwPrev();
        nextBtn.onclick = () => this.pwNext();
        prevBtn.style.visibility = 'hidden';

        modal.classList.add('visible');
        this.pwRenderStep();
    },

    pwRenderStep() {
        const s = this.pwState_;
        const stepDef = s.wizardData.steps[s.step];
        if (!stepDef) {
            // All steps done — submit
            this._pwFinish();
            return;
        }

        const total = s.wizardData.steps.length;
        const cur = s.step;

        // Progress dots
        const progressEl = document.getElementById('wizard-progress');
        if (progressEl) {
            progressEl.innerHTML = Array.from({length: total}, (_, i) =>
                `<span class="wizard-dot${i === cur ? ' active' : i < cur ? ' done' : ''}"></span>`
            ).join('');
        }

        const bodyEl = document.getElementById('wizard-body');
        if (!bodyEl) return;

        const icon = s.wizardData.name ? '🚀' : '📋';
        const title = stepDef.prompt || `Step ${cur + 1}`;
        const currentVal = s.values[stepDef.id] || stepDef.default || '';

        let inputHtml = '';
        if (stepDef.type === 'choice') {
            const opts = stepDef.options || {};
            inputHtml = Object.entries(opts).map(([k, v]) =>
                `<label class="pw-choice${currentVal === k ? ' selected' : ''}"
                    onclick="app.pwSetValue('${stepDef.id}','${k}')">
                    <input type="radio" name="pw-${stepDef.id}" value="${k}"${currentVal === k ? ' checked' : ''}>
                    ${v}
                </label>`
            ).join('');
        } else if (stepDef.type === 'confirm') {
            inputHtml = `
                <label class="pw-choice${currentVal === 'y' || currentVal === '' ? ' selected' : ''}"
                    onclick="app.pwSetValue('${stepDef.id}','y')">
                    <input type="radio" name="pw-${stepDef.id}" value="y"${currentVal === 'y' || currentVal === '' ? ' checked' : ''}> Yes
                </label>
                <label class="pw-choice${currentVal === 'n' ? ' selected' : ''}"
                    onclick="app.pwSetValue('${stepDef.id}','n')">
                    <input type="radio" name="pw-${stepDef.id}" value="n"${currentVal === 'n' ? ' checked' : ''}> No
                </label>`;
        } else if (stepDef.type === 'password') {
            inputHtml = `<input type="password" id="pw-input" class="sw-input" value="${this.escapeHtml(currentVal)}"
                oninput="app.pwSetValue('${stepDef.id}', this.value)" placeholder="${stepDef.default || ''}">`;
        } else {
            inputHtml = `<input type="text" id="pw-input" class="sw-input" value="${this.escapeHtml(currentVal)}"
                oninput="app.pwSetValue('${stepDef.id}', this.value)" placeholder="${stepDef.default || ''}">`;
        }

        bodyEl.innerHTML = `
            <div class="wizard-icon">${icon}</div>
            <h2 class="wizard-title">${this.escapeHtml(title)}</h2>
            <div class="pw-input-area">${inputHtml}</div>`;

        const prevBtn = document.getElementById('wizard-prev');
        const nextBtn = document.getElementById('wizard-next');
        if (prevBtn) prevBtn.style.visibility = cur === 0 ? 'hidden' : '';
        if (nextBtn) {
            nextBtn.textContent = cur === total - 1 ? '✓ ' + this.t('Done') : this.t('Next') + ' →';
        }
    },

    pwSetValue(id, value) {
        this.pwState_.values[id] = value;
        // Re-render choice highlights
        const input = document.getElementById('pw-input');
        if (input && input.id === 'pw-input') {
            // text input handled via oninput
        }
        // Update radio highlights
        document.querySelectorAll('.pw-choice').forEach(el => {
            const radio = el.querySelector('input[type="radio"]');
            if (radio && radio.checked) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });
    },

    pwNext() {
        // Validate current step
        const s = this.pwState_;
        const stepDef = s.wizardData.steps[s.step];
        const val = s.values[stepDef.id] !== undefined ? s.values[stepDef.id] : stepDef.default || '';
        if (stepDef.validate && val) {
            try {
                const re = new RegExp(stepDef.validate);
                if (!re.test(val)) {
                    this.addLog(`⚠ Invalid input for "${stepDef.id}"`);
                    return;
                }
            } catch { this.addLog('⚠ ' + this.t('FailedToParseWizardStepInput')); }
        }
        // Apply action
        if (stepDef.action === 'setLanguage') {
            this.state.language = val;
        }
        s.values[stepDef.id] = val;
        s.step++;
        this.pwRenderStep();
    },

    pwPrev() {
        const s = this.pwState_;
        if (s.step > 0) {
            s.step--;
            this.pwRenderStep();
        }
    },

    _pwFinish() {
        const s = this.pwState_;
        document.getElementById('wizard-modal').classList.remove('visible');
        // Apply output mapping
        if (s.wizardData.outputMapping) {
            for (const [targetField, mapping] of Object.entries(s.wizardData.outputMapping)) {
                const sourceVal = s.values[mapping.source];
                if (sourceVal && mapping.map && mapping.map[sourceVal]) {
                    s.values[targetField] = mapping.map[sourceVal];
                }
            }
        }
        this.addLog(`✅ ${this.t('WizardCompleted').replace('{name}', s.wizardData.name || 'pipeline')}`);
        this.postMessage({ type: 'wizard_step_resume', payload: { values: s.values } });
    },

    escapeHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },

    safeB64(str) {
        if (!str) return '';
        try {
            const bytes = new TextEncoder().encode(str);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        } catch {
            try { return btoa(unescape(encodeURIComponent(str))); }
            catch { return btoa(str); }
        }
    },

    safeAtob(str) {
        if (!str) return '';
        try {
            const binary = atob(str);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new TextDecoder().decode(bytes);
        } catch {
            try {
                return decodeURIComponent(escape(atob(str)));
            } catch {
                try { return atob(str); }
                catch { return str; }
            }
        }
    },

    patchNodeTypes(node, isRoot = false) {
        if (!node.nodeType) {
            if (isRoot) {
                node.nodeType = 'root';
            } else if (node.pipelineMeta !== undefined) {
                node.nodeType = 'data';
            } else if (node.title && this.safeAtob(node.title) === 'Processed') {
                node.nodeType = 'placeholder';
            } else {
                node.nodeType = 'assemble';
            }
        }
        if (node.children) {
            node.children.forEach(child => this.patchNodeTypes(child, false));
        }
    },

    isDataNodePath(path) {
        if (!path) return false;
        const node = this.getNodeByPath(path);
        if (node) {
            // If pipelineMeta exists, it's definitely a data node
            if (node.pipelineMeta !== undefined) return true;
            if (node.nodeType) return node.nodeType === 'data';
        }
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
            const ancestorPath = parts.slice(0, i).join('/');
            const ancestorNode = this.getNodeByPath(ancestorPath);
            if (ancestorNode && (ancestorNode.nodeType === 'placeholder' ||
                (!ancestorNode.nodeType && ancestorNode.title && this.safeAtob(ancestorNode.title) === 'Processed'))) {
                return true;
            }
        }
        return false;
    },

    _getDataNodeMediaType(node) {
        if (!node || !node.pipelineMeta) return '';
        try {
            const meta = JSON.parse(node.pipelineMeta);
            if (meta && meta.steps && meta.steps.length > 0) {
                const lastStep = meta.steps[meta.steps.length - 1];
                const attachments = lastStep.outputAttachments || lastStep.attachments || [];
                for (const a of attachments) {
                    const mime = a.mimetype || '';
                    if (mime.startsWith('image/')) return 'image';
                    if (mime.startsWith('audio/')) return 'audio';
                    if (mime.startsWith('video/')) return 'video';
                }
            }
        } catch (e) { /* ignore parse errors */ }
        return '';
    },

    getLogicalOpPath(path) {
        if (!path) return '';
        const node = this.getNodeByPath(path);
        if (node && (node.nodeType === 'data' || (!node.nodeType && node.pipelineMeta !== undefined))) {
            const lastSlash = path.lastIndexOf('/');
            if (lastSlash < 0) return '';
            const parentPath = lastSlash === 0 ? '' : path.substring(0, lastSlash);
            const parentNode = this.getNodeByPath(parentPath || null);
            if (parentNode && (parentNode.nodeType === 'placeholder' ||
                (!parentNode.nodeType && parentNode.title && this.safeAtob(parentNode.title) === 'Processed'))) {
                const lastSlash2 = parentPath.lastIndexOf('/');
                if (lastSlash2 < 0) return '';
                return lastSlash2 === 0 ? '' : parentPath.substring(0, lastSlash2);
            }
            return parentPath;
        }
        return path;
    },

    formatRunDate(isoString) {
        if (!isoString) return '';
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return isoString;

        const now = new Date();
        const isToday = d.getFullYear() === now.getFullYear() &&
                        d.getMonth() === now.getMonth() &&
                        d.getDate() === now.getDate();

        const pad = n => String(n).padStart(2, '0');
        const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        if (isToday) {
            return timeStr;
        } else {
            const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
            return `${dateStr} ${timeStr}`;
        }
    },

    isAncestor(ancestor, descendant) {
        if (!ancestor || !descendant) return false;
        const a = ancestor.split('/').filter(p => p !== '');
        const d = descendant.split('/').filter(p => p !== '');
        if (a.length >= d.length) return false;
        return a.every((p, i) => p === d[i]);
    },

    getDOMElementForPath(path) {
        if (path === '') return null;
        const escapedPath = path.replace(/'/g, "\\'");
        const els = document.querySelectorAll('.tree-node');
        for (let i = 0; i < els.length; i++) {
            const attr = els[i].getAttribute('onclick') || '';
            if (attr.includes(`selectNode('${escapedPath}')`) || attr.includes(`selectNode("${escapedPath}")`)) {
                return els[i];
            }
        }
        return null;
    },

    showConfigTab(name) {
        this.showConfig();
        setTimeout(() => {
            const btn = document.querySelector(`.config-tab[onclick*="'${name}'"]`);
            if (btn) this.switchConfigTab(name, btn);
        }, 50);
    },

    showConfig() {
        const panel = document.getElementById('config-panel');
        if (!panel) return;
        panel.classList.add('visible');
        this.postMessage({ type: 'get_providers' });
        this.initConfigDrag();
        this.addLog('⚙ ' + this.t('ConfigOpened'));
    },

    showAppConfig() {
        const panel = document.getElementById('app-config-panel');
        if (!panel) return;
        panel.classList.add('visible');
        this.initAppConfigDrag();
        this.renderGeneralConfig();
        this.renderThemeConfig();
        this.loadExecutionConfig();
        this.addLog('⚙ Application Config opened');
    },

    async loadExecutionConfig() {
        try {
            const response = await fetch('http://127.0.0.1:18765/config');
            const config = await response.json();
            if (config.btRunExecution) {
                document.getElementById('config-max-parallel').value = config.btRunExecution.maxParallel || 4;
            }
            if (config.httpLLMCalls) {
                document.getElementById('config-max-concurrent-llm').value = config.httpLLMCalls.maxConcurrentLLMCalls || 4;
            }
        } catch (e) {
            console.error('[Config] Error loading execution config:', e);
        }
    },

    async setMaxParallel(value) {
        const val = Math.max(1, Math.min(16, parseInt(value)));
        try {
            const response = await fetch('http://127.0.0.1:18765/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ maxParallel: val }),
            });
            const result = await response.json();
            this.addLog(`⚙ Max parallel BT runs set to ${val}`);
            document.getElementById('config-max-parallel').value = val;
        } catch (e) {
            this.addLog(`❌ Error setting maxParallel: ${e.message}`);
        }
    },

    async setMaxConcurrentLLM(value) {
        const val = Math.max(1, Math.min(32, parseInt(value)));
        try {
            const response = await fetch('http://127.0.0.1:18765/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ maxConcurrentLLMCalls: val }),
            });
            const result = await response.json();
            this.addLog(`⚙ Max concurrent HTTP calls set to ${val}`);
            document.getElementById('config-max-concurrent-llm').value = val;
        } catch (e) {
            this.addLog(`❌ Error setting maxConcurrentLLMCalls: ${e.message}`);
        }
    },

    adjustMaxParallel(delta) {
        const input = document.getElementById('config-max-parallel');
        if (!input) return;
        const newValue = Math.max(1, Math.min(16, parseInt(input.value) + delta));
        input.value = newValue;
        this.setMaxParallel(newValue);
    },

    adjustMaxConcurrentLLM(delta) {
        const input = document.getElementById('config-max-concurrent-llm');
        if (!input) return;
        const newValue = Math.max(1, Math.min(32, parseInt(input.value) + delta));
        input.value = newValue;
        this.setMaxConcurrentLLM(newValue);
    },

    closeAppConfig() {
        const panel = document.getElementById('app-config-panel');
        if (!panel) return;
        this.postMessage({ type: 'save_config', payload: {
            historyRetention: this.state.historyRetention,
            defaultProvider: this.state.defaultProvider,
            defaultModel: this.state.defaultModel,
            defaultImageFit: this.state.defaultImageFit,
            theme: this.state.theme,
            customThemeColors: this.themes.custom.colors,
        }});
        panel.classList.remove('visible');
    },

    closeConfig() {
        const panel = document.getElementById('config-panel');
        if (!panel) return;
        // Auto-save on close
        this.saveProviders();
        this.saveDefaultRecipes();
        this.saveProjectRecipes();
        this.postMessage({ type: 'save_config', payload: {
            historyRetention: this.state.historyRetention,
            defaultProvider: this.state.defaultProvider,
            defaultModel: this.state.defaultModel,
            defaultImageFit: this.state.defaultImageFit,
            theme: this.state.theme,
            customThemeColors: this.themes.custom.colors,
        }});
        panel.classList.remove('visible');
    },

    setMaintainRecipe(recipeName) {
        this.state.maintainRecipe = recipeName;
        this.postMessage({ type: 'save_maintain_config', payload: { maintainRecipe: recipeName }});
    },

    setLogHttpHeaders(enabled) {
        this.state.logHttpHeaders = enabled;
        this.postMessage({ type: 'save_config', payload: {
            historyRetention: this.state.historyRetention,
            defaultProvider: this.state.defaultProvider,
            defaultModel: this.state.defaultModel,
            defaultImageFit: this.state.defaultImageFit,
            theme: this.state.theme,
            customThemeColors: this.themes.custom.colors,
            logHttpHeaders: enabled
        }});
    },

    testMaintainAI() {
        if (!this.state.maintainRecipe) {
            alert('Please select a maintenance recipe first');
            return;
        }
        this.postMessage({
            type: 'ai_maintain_update_config',
            payload: {
                target: 'config',
                instructions: 'Add a test field "aiMaintenanceTest": true to verify the AI maintenance feature is working'
            }
        });
        this.addLog('🤖 Testing AI maintenance...');
    },

    _isRecipeError(message) {
        if (!message) return false;
        const lower = message.toLowerCase();
        return lower.includes('recipe') ||
               lower.includes('provider') ||
               lower.includes('model') ||
               lower.includes('api') ||
               lower.includes('invalid') ||
               lower.includes('not found') ||
               lower.includes('configuration');
    },

    offerAIFix(error, recipeConfig, context) {
        if (!this.state.maintainRecipe) {
            return;
        }
        const modal = document.createElement('div');
        modal.id = 'ai-fix-modal';
        modal.className = 'modal visible';
        modal.innerHTML = `
            <div class="modal-content" style="width:500px;padding:16px;">
                <h3 style="margin:0 0 12px;font-size:14px;">🤖 AI Fix Suggestion</h3>
                <div style="background:#1e1e1e;border:1px solid #333;border-radius:4px;padding:8px;margin-bottom:12px;max-height:200px;overflow-y:auto;">
                    <div style="font-size:11px;color:#f66;margin-bottom:8px;"><strong>Error:</strong> ${this.escapeHtml(error)}</div>
                    <div style="font-size:11px;color:#888;">Recipe: ${this.escapeHtml(recipeConfig?.name || 'Unknown')}</div>
                </div>
                <div style="font-size:12px;color:#ccc;margin-bottom:12px;">
                    Use AI to analyze and fix this error?
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button onclick="app.applyAIFix()" class="btn-primary" style="padding:6px 16px;">Fix with AI</button>
                    <button onclick="app.dismissAIFix()" style="padding:6px 16px;">Dismiss</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this._pendingAIFix = { error, recipeConfig, context };
    },

    applyAIFix() {
        if (!this._pendingAIFix) return;
        const { error, recipeConfig, context } = this._pendingAIFix;
        this.postMessage({
            type: 'ai_maintain_fix_error',
            payload: { error, recipeConfig, context }
        });
        this.addLog('🤖 Requesting AI fix...');
        this.dismissAIFix();
    },

    dismissAIFix() {
        document.getElementById('ai-fix-modal')?.remove();
        this._pendingAIFix = null;
    },

    onAIMaintainResult(result) {
        if (result.success) {
            if (result.suggestion) {
                this.addLog(`✅ AI Analysis: ${result.suggestion.analysis}`);
                if (result.suggestion.fixes && result.suggestion.fixes.length > 0) {
                    this.addLog(`🔧 Suggested fixes: ${result.suggestion.fixes.length}`);
                    result.suggestion.fixes.forEach(fix => {
                        this.addLog(`  - ${fix.field}: ${fix.oldValue} → ${fix.newValue} (${fix.reason})`);
                    });
                }
            } else if (result.updated) {
                this.addLog(`✅ Configuration updated by AI`);
                if (result.filePath) {
                    this.addLog(`📄 Saved to: ${result.filePath}`);
                }
                this.loadRecipes();
            }
        } else {
            this.addLog(`AI Maintenance Error\nOperation: onAIMaintainResult\nError: ${result.error}\nAction: Review the error details and check provider configuration`);
        }
    },

    showRecipeSelectDialog() {
        const modal = document.getElementById('recipe-select-modal');
        if (!modal) return;
        this._recipeSelectPending = this.state.selectedRecipe;
        this._selectedSelectProvider = this._selectedSelectProvider || 'all';
        document.getElementById('recipe-select-search').value = '';
        modal.classList.add('visible');
        this._renderRecipeSelectList('');
    },

    closeRecipeSelectDialog() {
        document.getElementById('recipe-select-modal')?.classList.remove('visible');
    },

    filterRecipeSelectDialog() {
        const q = document.getElementById('recipe-select-search')?.value || '';
        this._renderRecipeSelectList(q);
    },

    _classifyRecipeProvider(recipe) {
        if (recipe.type === 'command') return 'command';
        const provider = (recipe.provider || '').toLowerCase();
        if (provider.includes('gemini')) return 'gemini';
        if (provider.includes('openai')) return 'openai';
        if (provider.includes('anthropic')) return 'anthropic';
        if (provider.includes('replicate')) return 'replicate';
        if (provider.includes('ollama')) return 'ollama';
        return 'other';
    },

    _classifyRecipeUsecase(recipe) {
        if (recipe.type === 'command') return 'Command / CLI';
        
        // Map explicit usecase property if it exists
        const usecaseMap = {
            't2t': 'Text-to-Text (T2T)',
            't2i': 'Text-to-Image (T2I)',
            'i2i': 'Image-to-Image (I2I)',
            'i2i-multiref': 'Image-to-Image (Multi-Ref)',
            'grounding': 'Grounding / Search',
            'v2i': 'Video understanding to Image (V2I)',
            'tts': 'Text-to-Speech (TTS)',
            'music': 'Audio / Music Gen',
            'others': 'Others'
        };
        if (recipe.usecase && usecaseMap[recipe.usecase]) {
            return usecaseMap[recipe.usecase];
        }

        const name = (recipe.name || '').toLowerCase();
        const provider = (recipe.provider || '').toLowerCase();
        const model = (recipe.model || '').toLowerCase();
        
        // Grounding
        if (name.includes('grounding') || (recipe.customParams?.tools && JSON.stringify(recipe.customParams.tools).includes('google_search'))) {
            return 'Grounding / Search';
        }
        
        // V2I
        if (name.includes('v2i') || name.includes('video-to-image') || recipe.customParams?.file_data?.file_uri?.includes('youtube.com')) {
            return 'Video understanding to Image (V2I)';
        }

        // I2I
        if (name.includes('i2i') || name.includes('image-to-image') || name.includes('edit')) {
            if (name.includes('multiple') || name.includes('multi-ref') || name.includes('reference')) {
                return 'Image-to-Image (Multi-Ref)';
            }
            return 'Image-to-Image (I2I)';
        }

        // T2I
        if (name.includes('t2i') || name.includes('text-to-image') || provider === 'openai-image' || provider === 'gemini-image' || (provider === 'gemini' && (model.includes('image') || model.includes('imagen')))) {
            return 'Text-to-Image (T2I)';
        }

        // TTS / Audio
        if (name.includes('tts') || name.includes('text-to-speech') || name.includes('audio') || model.includes('tts')) {
            return 'Text-to-Speech (TTS)';
        }
        
        // Music Gen
        if (name.includes('music') || name.includes('sound') || model.includes('musicgen')) {
            return 'Audio / Music Gen';
        }

        // Default to T2T
        return 'Text-to-Text (T2T)';
    },

    setSelectProvider(providerKey) {
        this._selectedSelectProvider = providerKey;
        this._renderRecipeSelectList(document.getElementById('recipe-select-search')?.value || '');
    },

    setManagerProvider(providerKey) {
        this._selectedManagerProvider = providerKey;
        this.renderRecipeManager();
    },

    _renderRecipeSelectList(query) {
        const list = document.getElementById('recipe-select-list');
        const sidebar = document.getElementById('recipe-select-sidebar');
        if (!list || !sidebar) return;

        this._renderRecipePaths('recipe-select-path');

        const recipes = this.state.recipes || [];
        const q = query.toLowerCase();
        
        // Group & Filter recipes
        const providersList = [
            { key: 'all', label: 'All Providers', icon: '🌐' },
            { key: 'gemini', label: 'Gemini', icon: '♊' },
            { key: 'openai', label: 'OpenAI', icon: '🧠' },
            { key: 'anthropic', label: 'Anthropic', icon: '✉️' },
            { key: 'replicate', label: 'Replicate', icon: '🎨' },
            { key: 'ollama', label: 'Ollama', icon: '🦙' },
            { key: 'command', label: 'Command / CLI', icon: '⚙️' },
            { key: 'other', label: 'Others', icon: '❓' }
        ];

        // 1. Calculate matching recipe count per provider (incorporating the search filter)
        const providerCounts = {};
        providersList.forEach(p => providerCounts[p.key] = 0);
        
        const filteredRecipes = recipes.filter(r => {
            const matchesQuery = !q || 
                r.name.toLowerCase().includes(q) || 
                (r.model || '').toLowerCase().includes(q) || 
                (r.provider || '').toLowerCase().includes(q) ||
                (r.systemPrompt || '').toLowerCase().includes(q) ||
                (r.command || '').toLowerCase().includes(q);
            
            if (matchesQuery) {
                const pKey = this._classifyRecipeProvider(r);
                providerCounts[pKey] = (providerCounts[pKey] || 0) + 1;
                providerCounts['all']++;
                return true;
            }
            return false;
        });

        // Render Sidebar
        sidebar.innerHTML = providersList.map(p => {
            const count = providerCounts[p.key];
            if (p.key !== 'all' && count === 0 && p.key !== 'other') return '';
            if (p.key === 'other' && count === 0) return '';
            
            const isSel = p.key === this._selectedSelectProvider;
            return `
                <div class="sidebar-item ${isSel ? 'active' : ''}" onclick="app.setSelectProvider('${p.key}')"
                    style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;margin:0 8px 2px;border-radius:4px;
                           background:${isSel ? 'var(--theme-accent, #094771)' : 'transparent'};color:${isSel ? '#fff' : '#aaa'};font-size:12px;font-weight:${isSel ? 'bold' : 'normal'}">
                    <span style="display:flex;align-items:center;gap:8px">
                        <span>${p.icon}</span>
                        <span>${p.label}</span>
                    </span>
                    <span style="font-size:10px;background:${isSel ? 'rgba(255,255,255,0.2)' : '#2d2d2d'};color:${isSel ? '#fff' : '#888'};padding:1px 6px;border-radius:10px">${count}</span>
                </div>`;
        }).join('');

        // Ensure selected provider is still valid, else fall back to 'all'
        if (this._selectedSelectProvider !== 'all' && providerCounts[this._selectedSelectProvider] === 0) {
            this._selectedSelectProvider = 'all';
            this._renderRecipeSelectList(query);
            return;
        }

        // 2. Filter recipes by current provider selection
        const displayedRecipes = filteredRecipes.filter(r => {
            if (this._selectedSelectProvider === 'all') return true;
            return this._classifyRecipeProvider(r) === this._selectedSelectProvider;
        });

        if (displayedRecipes.length === 0) {
            list.innerHTML = `<div style="color:#666;font-size:12px;padding:30px;text-align:center">${this.t('NoRecipes')}</div>`;
            return;
        }

        // 3. Group by Usecase
        const groups = {};
        displayedRecipes.forEach(r => {
            const usecase = this._classifyRecipeUsecase(r);
            if (!groups[usecase]) groups[usecase] = [];
            groups[usecase].push(r);
        });

        // 4. Render Grouped List
        const usecasesOrder = [
            'Text-to-Text (T2T)',
            'Text-to-Image (T2I)',
            'Image-to-Image (I2I)',
            'Image-to-Image (Multi-Ref)',
            'Grounding / Search',
            'Video understanding to Image (V2I)',
            'Text-to-Speech (TTS)',
            'Audio / Music Gen',
            'Command / CLI',
            'Others'
        ];

        // Sort groups by predefined order or alphabetically
        const sortedUsecases = Object.keys(groups).sort((a, b) => {
            let idxA = usecasesOrder.indexOf(a);
            let idxB = usecasesOrder.indexOf(b);
            if (idxA === -1) idxA = 999;
            if (idxB === -1) idxB = 999;
            return idxA - idxB || a.localeCompare(b);
        });

        list.innerHTML = sortedUsecases.map(usecase => {
            const recipesInGroup = groups[usecase];
            const recipesInGroupHtml = recipesInGroup.map(r => {
                const origIdx = recipes.indexOf(r);
                const isSel = r.name === this._recipeSelectPending;
                const icon = r.type === 'command' ? '⚙️' : '🤖';
                let detail = r.type === 'command'
                    ? this.escapeHtml(r.command || '')
                    : this.escapeHtml(r.provider || '') + (r.model ? ' / ' + this.escapeHtml(r.model) : '');
                
                return `
                    <div class="recipe-select-item${isSel ? ' selected' : ''}" onclick="app._recipeSelectPick(${origIdx})"
                        style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:5px;cursor:pointer;margin-bottom:4px;
                               background:${isSel ? '#094771' : '#252526'};border:1px solid ${isSel ? '#106097' : '#2d2d2d'};transition:background 0.1s, border-color 0.1s">
                        <span style="font-size:16px">${icon}</span>
                        <span style="flex:1;min-width:0">
                            <div style="font-size:12px;color:#fff;font-weight:500;margin-bottom:2px">${this.escapeHtml(r.name)}</div>
                            <div style="font-size:10px;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${detail}</div>
                        </span>
                        ${isSel ? '<span style="color:#7ab0ff;font-size:14px;font-weight:bold">✓</span>' : ''}
                    </div>`;
            }).join('');

            return `
                <div class="usecase-group" style="margin-bottom:16px">
                    <div class="usecase-header" style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.8px;color:#858585;border-bottom:1px solid #333;padding-bottom:4px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
                        <span>${usecase}</span>
                        <span style="font-size:9px;color:#555;background:#2d2d2d;padding:1px 6px;border-radius:8px">${recipesInGroup.length}</span>
                    </div>
                    <div class="usecase-items" style="display:flex;flex-direction:column;gap:2px">
                        ${recipesInGroupHtml}
                    </div>
                </div>`;
        }).join('');
    },

    _recipeSelectPick(idx) {
        const recipes = this.state.recipes || [];
        if (idx >= 0 && idx < recipes.length) {
            this._recipeSelectPending = recipes[idx].name;
            const q = document.getElementById('recipe-select-search')?.value || '';
            this._renderRecipeSelectList(q);
        }
    },

    applyRecipeSelectDialog() {
        const name = this._recipeSelectPending || '';
        const idx = (this.state.recipes || []).findIndex(r => r.name === name);
        if (idx >= 0) {
            this.selectRecipe(idx);
        } else {
            this.state.selectedRecipe = '';
            this.updateRecipeBadge();
            this.renderPrompt();
        }
        this.closeRecipeSelectDialog();
    },

    showRecipeManager() {
        const modal = document.getElementById('recipe-modal');
        if (!modal) return;
        modal.classList.add('visible');
        this.postMessage({ type: 'get_providers' });
        this._selectedManagerProvider = this._selectedManagerProvider || 'all';
        this.state.editingRecipeIndex = -1;
        this.renderRecipeManager();
    },

    closeRecipeManager() {
        this.saveDefaultRecipes();
        this.saveProjectRecipes();
        document.getElementById('recipe-modal')?.classList.remove('visible');
    },

    _renderCapabilityBadge(provider) {
        const cap = (this.state.providerCapabilities || {})[provider];
        if (!cap) return '';
        const icons = { text: '📝', image: '🖼', video: '🎬', audio: '🎵' };
        const inputIcons = cap.input.map(t => icons[t] || t).join('');
        const outputIcons = cap.output.map(t => icons[t] || t).join('');
        const maxStr = cap.maxOutputs ? ` (max ${cap.maxOutputs})` : '';
        return `<span class="capability-badge" style="font-size:10px;color:#888;margin-left:6px">${inputIcons} → ${outputIcons}${maxStr}</span>`;
    },

    updateUrlPreview(prefix) {
        const provider = document.getElementById(`${prefix}-provider`)?.value || 'openai';
        const model = document.getElementById(`${prefix}-model`)?.value?.trim() || '(model)';
        const baseUrlInput = document.getElementById(`${prefix}-base-url`)?.value?.trim();
        const useCustom = document.getElementById(`${prefix}-use-custom-api-path`)?.checked || false;
        const apiPathInput = document.getElementById(`${prefix}-api-path`)?.value?.trim();

        // Get default configuration for this provider from our loaded appproviders.json
        const providerCfg = (this.state.defaultProviders || []).find(p => p.id === provider) || {};
        const defaultUrl = providerCfg.defaultUrl || '';
        const defaultApiPath = providerCfg.defaultApiPath || '';

        const activeProviderConfig = (this.state.providers || {})[provider] || {};
        const baseUrl = baseUrlInput || activeProviderConfig.baseUrl || defaultUrl;

        let resolvedUrl = '';
        if (useCustom) {
            const path = (apiPathInput || '').replace('{model}', model);
            resolvedUrl = baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
        } else {
            const path = defaultApiPath.replace('{model}', model);
            resolvedUrl = path ? baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '') : baseUrl;
        }

        const previewEl = document.getElementById(`${prefix}-url-preview`);
        if (previewEl) {
            previewEl.textContent = resolvedUrl;
        }
    },

    isPollingProvider(providerId) {
        const providerCfg = (this.state.defaultProviders || []).find(p => p.id === providerId) || {};
        return providerCfg.apiType === 'polling';
    },

    updateUrlCustomizationVisibility(prefix) {
        const provider = document.getElementById(`${prefix}-provider`)?.value || 'openai';
        const isPolling = this.isPollingProvider(provider);
        
        const baseUrlRow = document.getElementById(`${prefix}-base-url-row`);
        const previewRow = document.getElementById(`${prefix}-preview-row`);
        
        if (baseUrlRow) baseUrlRow.style.display = isPolling ? 'none' : '';
        if (previewRow) previewRow.style.display = isPolling ? 'none' : '';
    },

    _getProviderLabel(providerId) {
        const cfg = (this.state.providers || {})[providerId] || {};
        const apiFormat = cfg.apiFormat || providerId;
        const baseUrl = cfg.baseUrl || '';
        const shortUrl = baseUrl ? baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
        return shortUrl ? `${providerId} [${apiFormat}] ${shortUrl}` : `${providerId} [${apiFormat}]`;
    },

    updateEditCapabilityBadge() {
        const provider = document.getElementById('edit-provider')?.value;
        const badge = document.getElementById('edit-capability-badge');
        if (badge) badge.innerHTML = this._renderCapabilityBadge(provider);
    },

    updateAddCapabilityBadge() {
        const provider = document.getElementById('rm-provider')?.value;
        const badge = document.getElementById('rm-capability-badge');
        if (badge) badge.innerHTML = this._renderCapabilityBadge(provider);
    },

    _getRecipeFilePaths() {
        const appData = this.state.appDataPath || '';
        const project = this.state.activeProject || 'Default';
        const frontendRoot = this.state.frontendRoot || '';
        return {
            defaults: frontendRoot ? `${frontendRoot}\\defaults\\apprecipes.json` : '(defaults path unknown)',
            project: appData ? `${appData}\\projects\\${project}\\projectrecipes.json` : '(project path unknown)'
        };
    },

    _renderRecipePaths(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const paths = this._getRecipeFilePaths();
        el.innerHTML = `<span style="color:#888">Defaults:</span> ${this.escapeHtml(paths.defaults)}<br><span style="color:#888">Project:</span> ${this.escapeHtml(paths.project)}`;
    },

    renderRecipeManager() {
        const body = document.getElementById('recipe-modal-body');
        const sidebar = document.getElementById('recipe-manager-sidebar');
        if (!body) return;

        this._renderRecipePaths('recipe-manager-path');

        const recipes = this.state.recipes || [];
        const editingIdx = this.state.editingRecipeIndex;
        const providers = Object.keys(this.state.providers || {});

        const providersList = [
            { key: 'all', label: 'All Providers', icon: '🌐' },
            { key: 'gemini', label: 'Gemini', icon: '♊' },
            { key: 'openai', label: 'OpenAI', icon: '🧠' },
            { key: 'anthropic', label: 'Anthropic', icon: '✉️' },
            { key: 'replicate', label: 'Replicate', icon: '🎨' },
            { key: 'ollama', label: 'Ollama', icon: '🦙' },
            { key: 'command', label: 'Command / CLI', icon: '⚙️' },
            { key: 'other', label: 'Others', icon: '❓' }
        ];

        const providerCounts = {};
        providersList.forEach(p => providerCounts[p.key] = 0);
        recipes.forEach(r => {
            const pKey = this._classifyRecipeProvider(r);
            providerCounts[pKey] = (providerCounts[pKey] || 0) + 1;
            providerCounts['all']++;
        });

        // Render Sidebar
        if (sidebar) {
            sidebar.innerHTML = providersList.map(p => {
                const count = providerCounts[p.key];
                const isSel = p.key === this._selectedManagerProvider;
                return `
                    <div class="sidebar-item ${isSel ? 'active' : ''}" onclick="app.setManagerProvider('${p.key}')"
                        style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;margin:0 8px 2px;border-radius:4px;
                               background:${isSel ? 'var(--theme-accent, #094771)' : 'transparent'};color:${isSel ? '#fff' : '#aaa'};font-size:12px;font-weight:${isSel ? 'bold' : 'normal'}">
                        <span style="display:flex;align-items:center;gap:8px">
                            <span>${p.icon}</span>
                            <span>${p.label}</span>
                        </span>
                        <span style="font-size:10px;background:${isSel ? 'rgba(255,255,255,0.2)' : '#2d2d2d'};color:${isSel ? '#fff' : '#888'};padding:1px 6px;border-radius:10px">${count}</span>
                    </div>`;
            }).join('');
        }

        // Ensure selected manager provider is still valid, else fallback to 'all'
        if (this._selectedManagerProvider !== 'all' && !providersList.some(p => p.key === this._selectedManagerProvider)) {
            this._selectedManagerProvider = 'all';
        }

        // Filter recipes by current manager provider selection
        const displayedRecipes = recipes.filter(r => {
            if (this._selectedManagerProvider === 'all') return true;
            return this._classifyRecipeProvider(r) === this._selectedManagerProvider;
        });

        // Group displayed recipes by Usecase
        const groups = {};
        displayedRecipes.forEach(r => {
            const usecase = this._classifyRecipeUsecase(r);
            if (!groups[usecase]) groups[usecase] = [];
            groups[usecase].push(r);
        });

        const usecasesOrder = [
            'Text-to-Text (T2T)',
            'Text-to-Image (T2I)',
            'Image-to-Image (I2I)',
            'Image-to-Image (Multi-Ref)',
            'Grounding / Search',
            'Video understanding to Image (V2I)',
            'Text-to-Speech (TTS)',
            'Audio / Music Gen',
            'Command / CLI',
            'Others'
        ];

        const sortedUsecases = Object.keys(groups).sort((a, b) => {
            let idxA = usecasesOrder.indexOf(a);
            let idxB = usecasesOrder.indexOf(b);
            if (idxA === -1) idxA = 999;
            if (idxB === -1) idxB = 999;
            return idxA - idxB || a.localeCompare(b);
        });

        let html = '';
        if (displayedRecipes.length === 0) {
            html += `<div style="color:#666;font-size:12px;padding:30px;text-align:center">${this.t('NoRecipes')}</div>`;
        } else {
            html += sortedUsecases.map(usecase => {
                const recipesInGroup = groups[usecase];
                const recipesInGroupHtml = recipesInGroup.map(r => {
                    const origIdx = recipes.indexOf(r);
                    if (origIdx === editingIdx) {
                        return this._renderRecipeEditForm(r, origIdx, providers);
                    } else {
                        const isFirstInFilter = displayedRecipes[0] === r;
                        const isLastInFilter = displayedRecipes[displayedRecipes.length - 1] === r;
                        return this._renderRecipeCard(r, origIdx, isFirstInFilter, isLastInFilter);
                    }
                }).join('');

                return `
                    <div class="usecase-group" style="margin-bottom:16px">
                        <div class="usecase-header" style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.8px;color:#858585;border-bottom:1px solid #333;padding-bottom:4px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
                            <span>${usecase}</span>
                            <span style="font-size:9px;color:#555;background:#2d2d2d;padding:1px 6px;border-radius:8px">${recipesInGroup.length}</span>
                        </div>
                        <div class="usecase-items" style="display:flex;flex-direction:column;gap:6px">
                            ${recipesInGroupHtml}
                        </div>
                    </div>`;
            }).join('');
        }

        // Render Add Recipe Form
        html += this._renderRecipeAddForm(providers);
        body.innerHTML = html;

        if (editingIdx !== -1) {
            const editRecipe = recipes[editingIdx];
            if (editRecipe && editRecipe.type !== 'command') {
                this.updateUrlPreview('edit');
            }
        }
        this.updateUrlPreview('rm');
    },

    _renderRecipeCard(r, i, isFirstInFilter, isLastInFilter) {
        const typeIcon = r.type === 'command' ? '⚙️' : '🤖';
        let detail = '';
        if (r.type === 'command') {
            detail = `<span class="recipe-mgr-item-detail-text">⚙️ ${this.escapeHtml(r.command || '')}</span>`;
        } else {
            const capBadge = this._renderCapabilityBadge(r.provider);
            const urlInfo = r.baseUrl ? ` (${this.escapeHtml(r.baseUrl)})` : '';
            const pathInfo = (r.useCustomApiPath && r.apiPath) ? ` [${this.escapeHtml(r.apiPath)}]` : '';
            detail = `<span class="recipe-mgr-item-detail-text">${this.escapeHtml(r.provider)}${r.model ? ' / ' + this.escapeHtml(r.model) : ''}${urlInfo}${pathInfo}${capBadge}</span>`;
        }
        return `
            <div class="recipe-mgr-item">
                <div class="recipe-mgr-item-header">
                    <span class="recipe-mgr-item-name">${typeIcon} ${this.escapeHtml(r.name)}</span>
                    <span class="recipe-mgr-item-type-badge ${r.type === 'command' ? 'type-command' : 'type-ai'}">${r.type === 'command' ? '⚙️ CMD' : '🤖 AI'}</span>
                </div>
                <div class="recipe-mgr-item-detail">${detail}</div>
                <div class="recipe-mgr-item-actions">
                    <button class="recipe-btn" onclick="app.editRecipe(${i})">✏️ Edit</button>
                    <button class="recipe-btn recipe-btn-danger" onclick="app.deleteRecipe(${i});app.renderRecipeManager()">🗑 Delete</button>
                    <span class="recipe-mgr-item-reorder">
                        <button class="recipe-btn recipe-btn-sm" onclick="app.moveRecipeUp(${i});app.renderRecipeManager()" ${isFirstInFilter ? 'disabled' : ''}>▲</button>
                        <button class="recipe-btn recipe-btn-sm" onclick="app.moveRecipeDown(${i});app.renderRecipeManager()" ${isLastInFilter ? 'disabled' : ''}>▼</button>
                    </span>
                </div>
            </div>`;
    },

    _renderRecipeEditForm(r, i, providers) {
        const isCommand = r.type === 'command';
        let fields = '';
        if (isCommand) {
            fields = `<input type="text" id="edit-command" value="${this.escapeHtml(r.command || '')}" placeholder="Command (e.g. echo hello)" class="recipe-input" style="flex:3">`;
        } else {
            const capBadge = this._renderCapabilityBadge(r.provider);
            fields = `
                <select id="edit-provider" class="recipe-select" style="flex:1" onchange="app.fetchModelsForProvider(this.value);app.updateEditCapabilityBadge();app.updateUrlPreview('edit');app.updateUrlCustomizationVisibility('edit')">
                    ${providers.map(k => `<option value="${this.escapeHtml(k)}" ${k === r.provider ? 'selected' : ''}>${this.escapeHtml(this._getProviderLabel(k))}</option>`).join('')}
                </select>
                <span id="edit-capability-badge">${capBadge}</span>
                <input type="text" id="edit-model" value="${this.escapeHtml(r.model)}" placeholder="Model" class="recipe-input" style="flex:1" oninput="app.updateUrlPreview('edit')">
                <button class="recipe-btn" onclick="app.fetchModelsForProvider(document.getElementById('edit-provider')?.value)" style="font-size:10px;padding:2px 6px">🔄</button>`;
        }
        const isPolling = !isCommand && this.isPollingProvider(r.provider);
        return `
            <div class="recipe-mgr-item recipe-mgr-editing">
                <div class="recipe-edit-row">
                    <input type="text" id="edit-name" value="${this.escapeHtml(r.name)}" placeholder="Recipe name" class="recipe-input" style="flex:2">
                    ${fields}
                </div>
                ${!isCommand ? `
                <div class="recipe-edit-row">
                    <label style="font-size: 11px; color: var(--theme-text2); display: flex; align-items: center; gap: 4px; width: 100%;">
                        Modality Usecase:
                        <select id="edit-usecase" class="recipe-select" style="flex:1">
                            <option value="t2t" ${r.usecase === 't2t' ? 'selected' : ''}>📝 Text-to-Text (T2T)</option>
                            <option value="t2i" ${r.usecase === 't2i' ? 'selected' : ''}>🖼️ Text-to-Image (T2I)</option>
                            <option value="i2i" ${r.usecase === 'i2i' ? 'selected' : ''}>🎨 Image-to-Image (I2I)</option>
                            <option value="i2i-multiref" ${r.usecase === 'i2i-multiref' ? 'selected' : ''}>🖼️🎨 Multi-Ref Image-to-Image</option>
                            <option value="grounding" ${r.usecase === 'grounding' ? 'selected' : ''}>🔍 Grounding / Search</option>
                            <option value="v2i" ${r.usecase === 'v2i' ? 'selected' : ''}>🎬 Video-to-Image (V2I)</option>
                            <option value="tts" ${r.usecase === 'tts' ? 'selected' : ''}>🎵 Text-to-Speech (TTS)</option>
                            <option value="music" ${r.usecase === 'music' ? 'selected' : ''}>🎶 Audio / Music Gen</option>
                            <option value="others" ${r.usecase === 'others' ? 'selected' : ''}>📦 Others</option>
                        </select>
                    </label>
                </div>
                <div class="recipe-edit-row">
                    <textarea id="edit-system-prompt" placeholder="System prompt (optional)" class="recipe-textarea" style="flex:3">${this.escapeHtml(r.systemPrompt || '')}</textarea>
                    <input type="number" id="edit-temperature" value="${r.temperature ?? 0.7}" min="0" max="2" step="0.1" placeholder="Temp" class="recipe-input" style="width:60px">
                </div>
                <div class="recipe-edit-row" id="edit-base-url-row" style="gap: 8px; align-items: center; ${isPolling ? 'display: none;' : ''}">
                    <input type="text" id="edit-base-url" value="${this.escapeHtml(r.baseUrl || '')}" placeholder="Base URL override (optional, e.g. https://api.openai.com/v1)" class="recipe-input" style="flex:1" oninput="app.updateUrlPreview('edit')">
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                        <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; color: var(--theme-text2);">
                            <input type="checkbox" id="edit-use-custom-api-path" ${r.useCustomApiPath ? 'checked' : ''} onchange="document.getElementById('edit-api-path').style.display = this.checked ? '' : 'none';app.updateUrlPreview('edit')">
                            Use Custom API Path
                        </label>
                        <input type="text" id="edit-api-path" value="${this.escapeHtml(r.apiPath || '')}" placeholder="API Path (e.g. /v1beta/models/{model}:generateContent)" class="recipe-input" style="${r.useCustomApiPath ? '' : 'display: none;'}" oninput="app.updateUrlPreview('edit')">
                    </div>
                </div>
                <div class="recipe-edit-row" id="edit-preview-row" style="font-size: 10px; color: var(--theme-text2); margin-top: -4px; ${isPolling ? 'display: none;' : ''}">
                    <span style="font-weight: bold; margin-right: 4px;">Resolved Endpoint Preview:</span>
                    <span id="edit-url-preview" style="font-family: monospace; color: #4ec9b0; word-break: break-all;"></span>
                </div>
                <div class="recipe-edit-row">
                    <textarea id="edit-custom-params" placeholder="Custom parameters (JSON, e.g. {&quot;negative_prompt&quot;: &quot;ugly&quot;})" class="recipe-textarea" style="flex:3">${this.escapeHtml(r.customParams ? JSON.stringify(r.customParams) : '')}</textarea>
                </div>` : ''}
                <div class="recipe-edit-actions">
                    <button class="recipe-btn recipe-btn-primary" onclick="app.saveEditRecipe(${i})">Save</button>
                    <button class="recipe-btn" onclick="app.cancelEditRecipe()">Cancel</button>
                </div>
            </div>`;
    },

    _renderRecipeAddForm(providers) {
        const activeProv = this._selectedManagerProvider || 'all';
        const isCommand = activeProv === 'command';
        
        let defaultProv = providers[0] || 'openai';
        if (activeProv && activeProv !== 'all' && activeProv !== 'command' && activeProv !== 'other') {
            const matching = providers.find(k => {
                const classified = this._classifyRecipeProvider({ type: 'ai', provider: k });
                return classified === activeProv;
            });
            if (matching) {
                defaultProv = matching;
            } else if (providers.includes(activeProv)) {
                defaultProv = activeProv;
            }
        }
        
        const capBadge = this._renderCapabilityBadge(defaultProv);
        const isPolling = this.isPollingProvider(defaultProv);
        return `
            <div class="recipe-mgr-add">
                <div class="recipe-add-title">+ New Recipe</div>
                <div class="recipe-edit-row">
                    <input type="text" id="rm-name" placeholder="Recipe name" class="recipe-input" style="flex:2">
                    <select id="rm-type" class="recipe-select" style="flex:0 0 110px" onchange="app.onNewRecipeTypeChange()">
                        <option value="ai" ${!isCommand ? 'selected' : ''}>🤖 AI</option>
                        <option value="command" ${isCommand ? 'selected' : ''}>⚙️ Command</option>
                    </select>
                </div>
                <div id="rm-ai-fields" style="${isCommand ? 'display:none' : ''}">
                    <div class="recipe-edit-row">
                        <select id="rm-provider" class="recipe-select" style="flex:1" onchange="app.fetchModelsForProvider(this.value);app.updateAddCapabilityBadge();app.updateUrlPreview('rm');app.updateUrlCustomizationVisibility('rm')">
                            ${providers.map(k => `<option value="${this.escapeHtml(k)}" ${k === defaultProv ? 'selected' : ''}>${this.escapeHtml(this._getProviderLabel(k))}</option>`).join('')}
                        </select>
                        <span id="rm-capability-badge">${capBadge}</span>
                        <input type="text" id="rm-model" placeholder="Model" class="recipe-input" style="flex:1" oninput="app.updateUrlPreview('rm')">
                        <button class="recipe-btn" onclick="app.fetchModelsForProvider(document.getElementById('rm-provider')?.value)" style="font-size:10px;padding:2px 6px">🔄</button>
                        <input type="number" id="rm-temperature" placeholder="Temp" value="0.7" min="0" max="2" step="0.1" class="recipe-input" style="width:70px">
                    </div>
                    <div class="recipe-edit-row">
                        <label style="font-size: 11px; color: var(--theme-text2); display: flex; align-items: center; gap: 4px; width: 100%;">
                            Modality Usecase:
                            <select id="rm-usecase" class="recipe-select" style="flex:1">
                                <option value="t2t">📝 Text-to-Text (T2T)</option>
                                <option value="t2i">🖼️ Text-to-Image (T2I)</option>
                                <option value="i2i">🎨 Image-to-Image (I2I)</option>
                                <option value="i2i-multiref">🖼️🎨 Multi-Ref Image-to-Image</option>
                                <option value="grounding">🔍 Grounding / Search</option>
                                <option value="v2i">🎬 Video-to-Image (V2I)</option>
                                <option value="tts">🎵 Text-to-Speech (TTS)</option>
                                <option value="music">🎶 Audio / Music Gen</option>
                                <option value="others">📦 Others</option>
                            </select>
                        </label>
                    </div>
                    <div class="recipe-edit-row" id="rm-base-url-row" style="gap: 8px; align-items: center; ${isPolling ? 'display: none;' : ''}">
                        <input type="text" id="rm-base-url" placeholder="Base URL override (optional, e.g. https://api.openai.com/v1)" class="recipe-input" style="flex:1" oninput="app.updateUrlPreview('rm')">
                        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                            <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; color: var(--theme-text2);">
                                <input type="checkbox" id="rm-use-custom-api-path" onchange="document.getElementById('rm-api-path').style.display = this.checked ? '' : 'none';app.updateUrlPreview('rm')">
                                Use Custom API Path
                            </label>
                            <input type="text" id="rm-api-path" placeholder="API Path (e.g. /v1beta/models/{model}:generateContent)" class="recipe-input" style="display: none;" oninput="app.updateUrlPreview('rm')">
                        </div>
                    </div>
                    <div class="recipe-edit-row" id="rm-preview-row" style="font-size: 10px; color: var(--theme-text2); margin-top: -4px; ${isPolling ? 'display: none;' : ''}">
                        <span style="font-weight: bold; margin-right: 4px;">Resolved Endpoint Preview:</span>
                        <span id="rm-url-preview" style="font-family: monospace; color: #4ec9b0; word-break: break-all;"></span>
                    </div>
                    <div class="recipe-edit-row">
                        <textarea id="rm-system-prompt" placeholder="System prompt (optional)" class="recipe-textarea"></textarea>
                    </div>
                    <div class="recipe-edit-row">
                        <textarea id="rm-custom-params" placeholder="Custom parameters (JSON, e.g. {&quot;negative_prompt&quot;: &quot;ugly&quot;})" class="recipe-textarea"></textarea>
                    </div>
                </div>
                <div id="rm-cmd-fields" style="${isCommand ? '' : 'display:none'}">
                    <div class="recipe-edit-row">
                        <input type="text" id="rm-command" placeholder="Command (e.g. echo Hello World)" class="recipe-input" style="flex:1">
                    </div>
                </div>
                <div class="recipe-edit-actions">
                    <button class="recipe-btn recipe-btn-primary" onclick="app.addRecipeFromManager()">+ Add</button>
                </div>
            </div>`;
    },

    onNewRecipeTypeChange() {
        const type = document.getElementById('rm-type')?.value;
        const aiFields = document.getElementById('rm-ai-fields');
        const cmdFields = document.getElementById('rm-cmd-fields');
        if (!aiFields || !cmdFields) return;
        aiFields.style.display = type === 'command' ? 'none' : '';
        cmdFields.style.display = type === 'command' ? '' : 'none';
    },

    fetchModelsForProvider(provider) {
        if (!provider) return;
        this.postMessage({ type: 'fetch_models', payload: { provider } });
    },

    updateRecipeManagerModels(provider) {
        if (!provider) return;
        const models = (this.state.providerModels || {})[provider] || [];
        if (models.length === 0) return;
        for (const id of ['rm-model', 'edit-model']) {
            const el = document.getElementById(id);
            if (!el || el.tagName === 'SELECT') continue;
            const currentVal = el.value;
            const opts = '<option value="">Select model...</option>' +
                models.map(m => `<option value="${this.escapeHtml(m)}" ${m === currentVal ? 'selected' : ''}>${this.escapeHtml(m)}</option>`).join('');
            const sel = document.createElement('select');
            sel.id = id;
            sel.className = el.className;
            sel.style.cssText = el.style.cssText;
            sel.innerHTML = opts;
            el.parentNode.replaceChild(sel, el);
        }
    },

    addRecipeFromManager() {
        const name = document.getElementById('rm-name')?.value?.trim();
        if (!name) return;
        const type = document.getElementById('rm-type')?.value || 'ai';
        if (!this.state.projectRecipes) this.state.projectRecipes = [];
        if (type === 'command') {
            const command = document.getElementById('rm-command')?.value?.trim() || '';
            this.state.projectRecipes.push({ type, name, command, provider: '', model: '', temperature: 0.7, systemPrompt: '', baseUrl: '', useCustomApiPath: false, apiPath: '', customParams: {} });
        } else {
            const provider = document.getElementById('rm-provider')?.value || 'openai';
            const model = document.getElementById('rm-model')?.value?.trim() || '';
            const usecase = document.getElementById('rm-usecase')?.value || 't2t';
            const temp = parseFloat(document.getElementById('rm-temperature')?.value || '0.7');
            const systemPrompt = document.getElementById('rm-system-prompt')?.value?.trim() || '';
            const baseUrl = document.getElementById('rm-base-url')?.value?.trim() || '';
            const useCustomApiPath = document.getElementById('rm-use-custom-api-path')?.checked || false;
            const providerCfg = (this.state.defaultProviders || []).find(p => p.id === provider) || {};
            const apiPath = useCustomApiPath
                ? (document.getElementById('rm-api-path')?.value?.trim() || '')
                : (providerCfg.defaultApiPath || '');
            const apiType = providerCfg.apiType || 'simple';
            const customParamsStr = document.getElementById('rm-custom-params')?.value?.trim() || '';
            let customParams = {};
            if (customParamsStr) {
                try {
                    customParams = JSON.parse(customParamsStr);
                } catch (e) {
                    alert(this.t('InvalidJSONCustomParams'));
                    return;
                }
            }
            this.state.projectRecipes.push({ type, name, provider, model, usecase, temperature: temp, systemPrompt, baseUrl, useCustomApiPath, apiPath, apiType, command: '', customParams });
        }
        this.renderRecipeManager();
        this.saveProjectRecipes();
        this.addLog(`📋 Recipe added: ${name}`);
    },

    editRecipe(index) {
        this.state.editingRecipeIndex = index;
        this.renderRecipeManager();
    },

    saveEditRecipe(index) {
        const recipes = this.state.recipes || [];
        if (index < 0 || index >= recipes.length) return;
        const name = document.getElementById('edit-name')?.value?.trim();
        if (!name) return;
        const recipe = recipes[index];
        
        // Determine which source array this recipe belongs to
        const defaultIdx = this.state.defaultRecipes.indexOf(recipe);
        const projectIdx = this.state.projectRecipes.indexOf(recipe);
        const source = defaultIdx >= 0 ? 'defaults' : 'project';
        const oldName = recipe.name;
        if (oldName !== name) {
            const nameConflict = recipes.some((r, i2) => i2 !== index && r.name === name);
            if (nameConflict) {
                alert(`A recipe named "${name}" already exists.`);
                return;
            }
            recipe.name = name;
            
            if (this.state.selectedRecipe === oldName) {
                this.state.selectedRecipe = name;
            }
            if (this.state.tabs && Array.isArray(this.state.tabs)) {
                const updateRefs = (node) => {
                    if (!node) return;
                    if (node.selectedRecipe === oldName) {
                        node.selectedRecipe = name;
                    }
                    if (node.children && Array.isArray(node.children)) {
                        for (const child of node.children) {
                            updateRefs(child);
                        }
                    }
                };
                this.state.tabs.forEach(tab => {
                    if (tab.root) {
                        updateRefs(tab.root);
                    }
                });
            }
            this.saveCurrentTab();
        }
        if (recipe.type === 'command') {
            recipe.command = document.getElementById('edit-command')?.value?.trim() || '';
        } else {
            recipe.provider = document.getElementById('edit-provider')?.value || 'openai';
            recipe.model = document.getElementById('edit-model')?.value?.trim() || '';
            recipe.usecase = document.getElementById('edit-usecase')?.value || 't2t';
            recipe.systemPrompt = document.getElementById('edit-system-prompt')?.value?.trim() || '';
            recipe.temperature = parseFloat(document.getElementById('edit-temperature')?.value || '0.7');
            recipe.baseUrl = document.getElementById('edit-base-url')?.value?.trim() || '';
            recipe.useCustomApiPath = document.getElementById('edit-use-custom-api-path')?.checked || false;
            const providerCfg = (this.state.defaultProviders || []).find(p => p.id === recipe.provider) || {};
            recipe.apiPath = recipe.useCustomApiPath
                ? (document.getElementById('edit-api-path')?.value?.trim() || '')
                : (providerCfg.defaultApiPath || '');
            recipe.apiType = providerCfg.apiType || 'simple';
            const customParamsStr = document.getElementById('edit-custom-params')?.value?.trim() || '';
            let customParams = {};
            if (customParamsStr) {
                try {
                    customParams = JSON.parse(customParamsStr);
                } catch (e) {
                    alert(this.t('InvalidJSONCustomParams'));
                    return;
                }
            }
            recipe.customParams = customParams;
        }
        this.state.editingRecipeIndex = -1;
        this.renderRecipeManager();
        this.renderPrompt();
        if (source === 'defaults') {
            this.saveDefaultRecipes();
        } else {
            this.saveProjectRecipes();
        }
        this.addLog(`✏️ Recipe saved: ${name}`);
    },

    cancelEditRecipe() {
        this.state.editingRecipeIndex = -1;
        this.renderRecipeManager();
    },

    initConfigDrag() {
        const panel = document.getElementById('config-panel');
        const handle = document.getElementById('config-drag-handle');
        if (!panel || !handle) return;
        // Remove old listeners
        const newHandle = handle.cloneNode(true);
        handle.parentNode.replaceChild(newHandle, handle);
        let dragging = false, startX, startY, origX, origY;
        newHandle.onmousedown = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY;
            origX = rect.left; origY = rect.top;
            panel.style.left = origX + 'px';
            panel.style.top = origY + 'px';
            panel.style.right = 'auto';
            e.preventDefault();
        };
        document.onmousemove = (e) => {
            if (!dragging) return;
            panel.style.left = (origX + e.clientX - startX) + 'px';
            panel.style.top = (origY + e.clientY - startY) + 'px';
        };
        document.onmouseup = () => { dragging = false; };
    },

    initAppConfigDrag() {
        const panel = document.getElementById('app-config-panel');
        const handle = document.getElementById('app-config-drag-handle');
        if (!panel || !handle) return;
        // Remove old listeners
        const newHandle = handle.cloneNode(true);
        handle.parentNode.replaceChild(newHandle, handle);
        let dragging = false, startX, startY, origX, origY;
        newHandle.onmousedown = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY;
            origX = rect.left; origY = rect.top;
            panel.style.left = origX + 'px';
            panel.style.top = origY + 'px';
            panel.style.right = 'auto';
            e.preventDefault();
        };
        document.onmousemove = (e) => {
            if (!dragging) return;
            panel.style.left = (origX + e.clientX - startX) + 'px';
            panel.style.top = (origY + e.clientY - startY) + 'px';
        };
        document.onmouseup = () => { dragging = false; };
    },

    switchConfigTab(name, btn) {
        document.querySelectorAll('.config-tab-panel').forEach(p => p.style.display = 'none');
        document.querySelectorAll('.config-tab').forEach(b => b.classList.remove('active'));
        document.getElementById('config-tab-' + name).style.display = '';
        btn.classList.add('active');
        if (name === 'general') this.renderGeneralConfig();
        if (name === 'theme') this.renderThemeConfig();
    },

    renderGeneralConfig() {
        // Default provider/model
        const provEl = document.getElementById('config-default-provider');
        if (provEl) {
            const providers = this.state.providers || {};
            provEl.innerHTML = Object.keys(providers).map(k =>
                `<option value="${this.escapeHtml(k)}" ${k === this.state.defaultProvider ? 'selected' : ''}>${this.escapeHtml(k)}</option>`
            ).join('');
        }
        const modelEl = document.getElementById('config-default-model');
        if (modelEl) modelEl.value = this.state.defaultModel || '';
        // History retention
        const retentionEl = document.getElementById('config-history-retention');
        if (retentionEl) retentionEl.value = this.state.historyRetention || 50;
        // Image viewer default fit
        const fitEl = document.getElementById('config-default-image-fit');
        if (fitEl) fitEl.value = this.state.defaultImageFit || 'contain';
        // Projects root folder
        const projectsRootEl = document.getElementById('config-projects-root');
        if (projectsRootEl) projectsRootEl.value = this.state.projectsRoot || '';
        // Log HTTP headers
        const logHeadersEl = document.getElementById('config-log-http-headers');
        if (logHeadersEl) logHeadersEl.checked = this.state.logHttpHeaders || false;
        // Placeholder archive name
        const archiveNameEl = document.getElementById('config-placeholder-archive-name');
        if (archiveNameEl) archiveNameEl.value = this.state.placeholderArchiveName || 'archive';
        // Maintain recipe
        const maintainEl = document.getElementById('config-maintain-recipe');
        if (maintainEl) {
            const recipes = this.state.recipes || [];
            maintainEl.innerHTML = '<option value="">(none)</option>' + recipes.map(r =>
                `<option value="${this.escapeHtml(r.name)}" ${r.name === this.state.maintainRecipe ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`
            ).join('');
        }

        // List named chests
        const chestListEl = document.getElementById('config-chest-list');
        if (!chestListEl) return;
        const chestNames = this.state.chestList || [];
        if (chestNames.length === 0) {
            chestListEl.innerHTML = `<div class="empty" data-i18n="EmptyChests">No chests yet</div>`;
        } else {
            chestListEl.innerHTML = chestNames.map(n =>
                `<div class="chest-item"><span class="chest-name">📦 ${this.escapeHtml(n)}</span>
                <button class="chest-view-btn" onclick="app.viewChest('${this.escapeHtml(n)}')">👁 View</button>
                <button class="chest-load-btn" onclick="app.loadFromChestConfig('${this.escapeHtml(n)}')">📂 Load</button>
                <button class="chest-delete-btn" onclick="app.deleteChest('${this.escapeHtml(n)}')">✕</button></div>`
            ).join('');
        }
    },

    // ── Theme ────────────────────────────────────────────────
    themes: {
        dark: {
            name: 'Dark',
            colors: {
                bg: '#1e1e1e',
                bg2: '#252526',
                bg3: '#333333',
                text: '#cccccc',
                text2: '#aaaaaa',
                border: '#444444',
                accent: '#4a9eff',
                accentHover: '#5bb1ff',
                accentActive: '#3a8eef',
                danger: '#fc8181',
                dangerBg: '#6b2a2a'
            }
        },
        light: {
            name: 'Light',
            colors: {
                bg: '#f5f5f5',
                bg2: '#ffffff',
                bg3: '#eeeeee',
                text: '#333333',
                text2: '#666666',
                border: '#cccccc',
                accent: '#0066cc',
                accentHover: '#0052a3',
                accentActive: '#004080',
                danger: '#cc3333',
                dangerBg: '#ffcccc'
            }
        },
        blue: {
            name: 'Blue',
            colors: {
                bg: '#0d1b2a',
                bg2: '#1b263b',
                bg3: '#415a77',
                text: '#e0e1dd',
                text2: '#aaaaaa',
                border: '#778da9',
                accent: '#4a9eff',
                accentHover: '#5bb1ff',
                accentActive: '#3a8eef',
                danger: '#ff6b6b',
                dangerBg: '#6b2a2a'
            }
        },
        green: {
            name: 'Green',
            colors: {
                bg: '#1a1f1a',
                bg2: '#252c25',
                bg3: '#364436',
                text: '#d4dfd4',
                text2: '#a8b4a8',
                border: '#5a6d5a',
                accent: '#4aff7f',
                accentHover: '#5bff99',
                accentActive: '#3aef6f',
                danger: '#ff7f7f',
                dangerBg: '#6b3a3a'
            }
        },
        purple: {
            name: 'Purple',
            colors: {
                bg: '#1a0f2e',
                bg2: '#251b3d',
                bg3: '#3d2563',
                text: '#e0d5ff',
                text2: '#b8a8d8',
                border: '#6b5b95',
                accent: '#b48eff',
                accentHover: '#c79bff',
                accentActive: '#a37dff',
                danger: '#ff7ba8',
                dangerBg: '#6b2a4a'
            }
        },
        mono: {
            name: 'Mono',
            colors: {
                bg: '#f0f0f0',
                bg2: '#ffffff',
                bg3: '#e5e5e5',
                text: '#000000',
                text2: '#555555',
                border: '#cccccc',
                accent: '#000000',
                accentHover: '#333333',
                accentActive: '#111111',
                danger: '#cc3333',
                dangerBg: '#ffcccc'
            }
        },
        gray: {
            name: 'Gray & Black',
            colors: {
                bg: '#121212',
                bg2: '#1e1e1e',
                bg3: '#2d2d2d',
                text: '#e0e0e0',
                text2: '#888888',
                border: '#333333',
                accent: '#888888',
                accentHover: '#aaaaaa',
                accentActive: '#666666',
                danger: '#ff6b6b',
                dangerBg: '#3a1a1a'
            }
        },
        pink: {
            name: 'Pink & Black',
            colors: {
                bg: '#ffccd5',
                bg2: '#fff0f3',
                bg3: '#ffb3c1',
                text: '#000000',
                text2: '#590d22',
                border: '#ff85a1',
                accent: '#000000',
                accentHover: '#2b2d42',
                accentActive: '#1a1a24',
                danger: '#cc3333',
                dangerBg: '#ffcccc'
            }
        },
        custom: {
            name: 'Custom',
            colors: {
                bg: '#1e1e1e',
                bg2: '#252526',
                bg3: '#333333',
                text: '#cccccc',
                text2: '#aaaaaa',
                border: '#444444',
                accent: '#4a9eff',
                accentHover: '#5bb1ff',
                accentActive: '#3a8eef',
                danger: '#fc8181',
                dangerBg: '#6b2a2a'
            }
        }
    },

    loadTheme() {
        const saved = localStorage.getItem('appTheme') || 'dark';
        if (this.themes[saved]) {
            this.state.theme = saved;
            this.applyTheme(saved);
        }
    },

    applyTheme(themeName) {
        const theme = this.themes[themeName];
        if (!theme) return;
        const root = document.documentElement;
        Object.entries(theme.colors).forEach(([key, value]) => {
            root.style.setProperty(`--theme-${key}`, value);
        });
        document.body.className = `theme-${themeName}`;
        this.state.theme = themeName;
        this.renderThemeConfig();
    },

    renderThemeConfig() {
        const el = document.getElementById('theme-options');
        if (!el) return;
        el.innerHTML = Object.entries(this.themes).map(([key, theme]) => `
            <button class="theme-option ${this.state.theme === key ? 'active' : ''}"
                    onclick="app.applyTheme('${key}')"
                    title="${theme.name}">
                <span class="theme-option-name">${theme.name}</span>
                <span class="theme-option-preview">
                    <span class="preview-box" style="background-color: ${theme.colors.bg}"></span>
                    <span class="preview-box" style="background-color: ${theme.colors.accent}"></span>
                </span>
            </button>
        `).join('');

        const customEl = document.getElementById('custom-theme-colors');
        if (customEl) {
            if (this.state.theme === 'custom') {
                customEl.style.display = 'block';
                const grid = customEl.querySelector('.custom-color-pickers-grid');
                if (grid) {
                    const colorLabels = {
                        bg: 'Background',
                        bg2: 'Panel/Card',
                        bg3: 'Hover Background',
                        text: 'Main Text',
                        text2: 'Muted Text',
                        border: 'Border',
                        accent: 'Accent',
                        danger: 'Danger'
                    };
                    grid.innerHTML = Object.entries(this.themes.custom.colors)
                        .filter(([key]) => colorLabels[key])
                        .map(([key, val]) => `
                            <div style="display: flex; align-items: center; justify-content: space-between; background: var(--theme-bg3); padding: 6px 10px; border-radius: 4px; border: 1px solid var(--theme-border);">
                                <span style="font-size: 11px; color: var(--theme-text); font-weight: 500;">${colorLabels[key]}</span>
                                <input type="color" value="${val}" onchange="app.updateCustomColor('${key}', this.value)" style="border: none; background: none; width: 28px; height: 28px; cursor: pointer; padding: 0;">
                            </div>
                        `).join('');
                }
            } else {
                customEl.style.display = 'none';
            }
        }
    },

    updateCustomColor(key, value) {
        if (!this.themes.custom) return;
        this.themes.custom.colors[key] = value;
        
        if (key === 'accent') {
            this.themes.custom.colors.accentHover = this.adjustColorBrightness(value, 15);
            this.themes.custom.colors.accentActive = this.adjustColorBrightness(value, -15);
        }
        if (key === 'danger') {
            this.themes.custom.colors.dangerBg = value + '33';
        }

        this.applyTheme('custom');
    },

    adjustColorBrightness(hex, percent) {
        let R = parseInt(hex.substring(1, 3), 16);
        let G = parseInt(hex.substring(3, 5), 16);
        let B = parseInt(hex.substring(5, 7), 16);

        R = parseInt(R * (100 + percent) / 100);
        G = parseInt(G * (100 + percent) / 100);
        B = parseInt(B * (100 + percent) / 100);

        R = (R < 255) ? R : 255;
        G = (G < 255) ? G : 255;
        B = (B < 255) ? B : 255;

        R = (R > 0) ? R : 0;
        G = (G > 0) ? G : 0;
        B = (B > 0) ? B : 0;

        const rHex = R.toString(16).padStart(2, '0');
        const gHex = G.toString(16).padStart(2, '0');
        const bHex = B.toString(16).padStart(2, '0');

        return `#${rHex}${gHex}${bHex}`;
    },

    // ── Recipes ──────────────────────────────────────────────
    renderRecipesConfig() {
        const el = document.getElementById('recipe-list');
        if (!el) return;
        const recipes = this.state.recipes || [];
        let html = recipes.map((r, i) => `
            <div class="recipe-item">
                <div class="recipe-item-header">
                    <span class="recipe-item-name">${r.type === 'command' ? '⚙️' : '🤖'} ${this.escapeHtml(r.name)}</span>
                    <span class="recipe-item-type-badge ${r.type === 'command' ? 'type-command' : 'type-ai'}">${r.type === 'command' ? 'CMD' : 'AI'}</span>
                </div>
                <div class="recipe-item-detail">
                    ${r.type === 'command'
                        ? '⚙️ ' + this.escapeHtml(r.command || '')
                        : this.escapeHtml(r.provider) + (r.model ? ' / ' + this.escapeHtml(r.model) : '') + (r.baseUrl ? ` (${this.escapeHtml(r.baseUrl)})` : '') + ((r.useCustomApiPath && r.apiPath) ? ` [${this.escapeHtml(r.apiPath)}]` : '')}
                </div>
                <div class="recipe-item-actions">
                    <button class="recipe-sm-btn" onclick="app.editRecipe(${i})">✏️</button>
                    <button class="recipe-sm-btn recipe-sm-btn-danger" onclick="app.deleteRecipe(${i})">🗑</button>
                    <button class="recipe-sm-btn" onclick="app.moveRecipeUp(${i});app.renderRecipesConfig()" ${i === 0 ? 'disabled' : ''}>▲</button>
                    <button class="recipe-sm-btn" onclick="app.moveRecipeDown(${i});app.renderRecipesConfig()" ${i === recipes.length - 1 ? 'disabled' : ''}>▼</button>
                </div>
            </div>
        `).join('');
        const configProviders = Object.keys(this.state.providers || {});
        const firstProvider = configProviders[0] || 'openai';
        const isPolling = this.isPollingProvider(firstProvider);
        html += `
            <div class="recipe-add-row">
                <div class="recipe-add-title">+ New Recipe</div>
                <div class="recipe-config-row">
                    <input type="text" id="new-recipe-name" placeholder="Recipe name" class="recipe-config-input" style="flex:2">
                    <select id="new-recipe-type" class="recipe-config-select" style="flex:0 0 90px" onchange="app.onConfigRecipeTypeChange()">
                        <option value="ai">🤖 AI</option>
                        <option value="command">⚙️ CMD</option>
                    </select>
                </div>
                <div id="new-ai-fields">
                    <div class="recipe-config-row">
                        <select id="new-recipe-provider" class="recipe-config-select" style="flex:1" onchange="app.updateUrlPreview('new-recipe');app.updateUrlCustomizationVisibility('new-recipe')">
                            ${configProviders.map(k => `<option value="${this.escapeHtml(k)}">${this.escapeHtml(k)}</option>`).join('')}
                        </select>
                        <input type="text" id="new-recipe-model" placeholder="model" class="recipe-config-input" style="flex:1" oninput="app.updateUrlPreview('new-recipe')">
                        <input type="number" id="new-recipe-temperature" placeholder="Temp" value="0.7" min="0" max="2" step="0.1" class="recipe-config-input" style="width:60px">
                    </div>
                    <div class="recipe-config-row" id="new-recipe-base-url-row" style="gap: 8px; align-items: center; ${isPolling ? 'display: none;' : ''}">
                        <input type="text" id="new-recipe-base-url" placeholder="Base URL override (optional, e.g. https://api.openai.com/v1)" class="recipe-config-input" style="flex:1" oninput="app.updateUrlPreview('new-recipe')">
                        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                            <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; color: var(--theme-text2);">
                                <input type="checkbox" id="new-recipe-use-custom-api-path" onchange="document.getElementById('new-recipe-api-path').style.display = this.checked ? '' : 'none';app.updateUrlPreview('new-recipe')">
                                Use Custom API Path
                            </label>
                            <input type="text" id="new-recipe-api-path" placeholder="API Path" class="recipe-config-input" style="display: none;" oninput="app.updateUrlPreview('new-recipe')">
                        </div>
                    </div>
                    <div class="recipe-config-row" id="new-recipe-preview-row" style="font-size: 10px; color: var(--theme-text2); margin-top: -4px; ${isPolling ? 'display: none;' : ''}">
                        <span style="font-weight: bold; margin-right: 4px;">Resolved Endpoint Preview:</span>
                        <span id="new-recipe-url-preview" style="font-family: monospace; color: #4ec9b0; word-break: break-all;"></span>
                    </div>
                    <div class="recipe-config-row">
                        <input type="text" id="new-recipe-system-prompt" placeholder="System prompt (optional)" class="recipe-config-input" style="flex:3">
                    </div>
                </div>
                <div id="new-cmd-fields" style="display:none">
                    <div class="recipe-config-row">
                        <input type="text" id="new-recipe-command" placeholder="Command (e.g. echo Hello)" class="recipe-config-input" style="flex:1">
                    </div>
                </div>
                <div class="recipe-edit-actions" style="margin-top:4px">
                    <button class="recipe-btn recipe-btn-primary" style="font-size:11px;padding:2px 10px" onclick="app.addRecipe()">+ Add Recipe</button>
                </div>
            </div>`;
        el.innerHTML = html;
        this.updateUrlPreview('new-recipe');
        this.updateUrlCustomizationVisibility('new-recipe');
    },

    onConfigRecipeTypeChange() {
        const type = document.getElementById('new-recipe-type')?.value;
        const aiFields = document.getElementById('new-ai-fields');
        const cmdFields = document.getElementById('new-cmd-fields');
        if (type === 'command') {
            aiFields.style.display = 'none';
            cmdFields.style.display = '';
        } else {
            aiFields.style.display = '';
            cmdFields.style.display = 'none';
        }
    },

    addRecipe() {
        const name = document.getElementById('new-recipe-name')?.value?.trim();
        if (!name) return;
        const type = document.getElementById('new-recipe-type')?.value || 'ai';
        if (!this.state.projectRecipes) this.state.projectRecipes = [];
        if (type === 'command') {
            const command = document.getElementById('new-recipe-command')?.value?.trim() || '';
            this.state.projectRecipes.push({ type, name, command, provider: '', model: '', temperature: 0.7, systemPrompt: '', baseUrl: '', useCustomApiPath: false, apiPath: '', apiType: 'simple' });
        } else {
            const provider = document.getElementById('new-recipe-provider')?.value || 'openai';
            const model = document.getElementById('new-recipe-model')?.value?.trim() || '';
            const systemPrompt = document.getElementById('new-recipe-system-prompt')?.value?.trim() || '';
            const temp = parseFloat(document.getElementById('new-recipe-temperature')?.value || '0.7');
            const baseUrl = document.getElementById('new-recipe-base-url')?.value?.trim() || '';
            const useCustomApiPath = document.getElementById('new-recipe-use-custom-api-path')?.checked || false;
            const providerCfg = (this.state.defaultProviders || []).find(p => p.id === provider) || {};
            const apiPath = useCustomApiPath
                ? (document.getElementById('new-recipe-api-path')?.value?.trim() || '')
                : (providerCfg.defaultApiPath || '');
            const apiType = providerCfg.apiType || 'simple';
            this.state.projectRecipes.push({ type, name, provider, model, temperature: temp, systemPrompt, baseUrl, useCustomApiPath, apiPath, apiType, command: '' });
        }
        this.renderRecipesConfig();
        this.saveProjectRecipes();
        this.addLog(`📋 Recipe added: ${name}`);
    },

    deleteRecipe(index) {
        const recipes = this.state.recipes || [];
        if (index < 0 || index >= recipes.length) return;
        const recipe = recipes[index];
        const name = recipe.name;
        if (!confirm(`Delete recipe "${name}"?`)) return;
        
        // Determine which source array this recipe belongs to
        const defaultIdx = this.state.defaultRecipes.indexOf(recipe);
        const projectIdx = this.state.projectRecipes.indexOf(recipe);
        let source = '';
        if (defaultIdx >= 0) {
            this.state.defaultRecipes.splice(defaultIdx, 1);
            source = 'defaults';
        } else if (projectIdx >= 0) {
            this.state.projectRecipes.splice(projectIdx, 1);
            source = 'project';
        }
        
        if (this.state.selectedRecipe === name) this.state.selectedRecipe = '';
        this.renderRecipesConfig();
        this.renderPrompt();
        this.updateRecipeBadge();
        if (source === 'defaults') {
            this.saveDefaultRecipes();
        } else if (source === 'project') {
            this.saveProjectRecipes();
        }
        this.addLog(`🗑 Recipe deleted: ${name}`);
    },

    moveRecipeUp(index) {
        const recipes = this.state.recipes || [];
        if (index < 0 || index >= recipes.length) return;
        const recipe = recipes[index];
        
        // Determine which source array this recipe belongs to
        const defaultIdx = this.state.defaultRecipes.indexOf(recipe);
        const projectIdx = this.state.projectRecipes.indexOf(recipe);
        let sourceArr = null;
        let sourceName = '';
        if (defaultIdx >= 0) {
            sourceArr = this.state.defaultRecipes;
            sourceName = 'defaults';
        } else if (projectIdx >= 0) {
            sourceArr = this.state.projectRecipes;
            sourceName = 'project';
        }
        if (!sourceArr) return;
        
        const srcIdx = sourceArr.indexOf(recipe);
        if (srcIdx <= 0) return;
        
        // Swap within the source array
        [sourceArr[srcIdx - 1], sourceArr[srcIdx]] = [sourceArr[srcIdx], sourceArr[srcIdx - 1]];
        
        // Update editing index if needed
        const newIdx = this.state.recipes.indexOf(recipe);
        if (this.state.editingRecipeIndex === index) this.state.editingRecipeIndex = newIdx;
        
        if (sourceName === 'defaults') {
            this.saveDefaultRecipes();
        } else {
            this.saveProjectRecipes();
        }
    },

    moveRecipeDown(index) {
        const recipes = this.state.recipes || [];
        if (index < 0 || index >= recipes.length) return;
        const recipe = recipes[index];
        
        // Determine which source array this recipe belongs to
        const defaultIdx = this.state.defaultRecipes.indexOf(recipe);
        const projectIdx = this.state.projectRecipes.indexOf(recipe);
        let sourceArr = null;
        let sourceName = '';
        if (defaultIdx >= 0) {
            sourceArr = this.state.defaultRecipes;
            sourceName = 'defaults';
        } else if (projectIdx >= 0) {
            sourceArr = this.state.projectRecipes;
            sourceName = 'project';
        }
        if (!sourceArr) return;
        
        const srcIdx = sourceArr.indexOf(recipe);
        if (srcIdx < 0 || srcIdx >= sourceArr.length - 1) return;
        
        // Swap within the source array
        [sourceArr[srcIdx], sourceArr[srcIdx + 1]] = [sourceArr[srcIdx + 1], sourceArr[srcIdx]];
        
        // Update editing index if needed
        const newIdx = this.state.recipes.indexOf(recipe);
        if (this.state.editingRecipeIndex === index) this.state.editingRecipeIndex = newIdx;
        
        if (sourceName === 'defaults') {
            this.saveDefaultRecipes();
        } else {
            this.saveProjectRecipes();
        }
    },

    saveDefaultRecipes() {
        const recipes = this.state.defaultRecipes || [];
        this.postMessage({ type: 'save_default_recipes', payload: recipes });
    },

    saveProjectRecipes() {
        const recipes = this.state.projectRecipes || [];
        this.postMessage({ type: 'save_project_recipes', payload: recipes });
    },

    setDefaultProvider(val) {
        this.state.defaultProvider = val;
        this.renderRecipesConfig();
    },

    setDefaultModel(val) {
        this.state.defaultModel = val;
    },

    setDefaultImageFit(val) {
        this.state.defaultImageFit = val;
    },

    getRecipeSettings() {
        const recipeName = this.state.selectedRecipe;
        if (recipeName) {
            const recipe = (this.state.recipes || []).find(r => r.name === recipeName);
            if (recipe) return recipe;
        }
        return {
            type: 'ai',
            provider: this.state.defaultProvider || 'openai',
            model: this.state.defaultModel || '',
            temperature: 0.7,
            systemPrompt: '',
            baseUrl: '',
            useCustomApiPath: false,
            apiPath: '',
            command: ''
        };
    },

    selectRecipe(index) {
        const recipes = this.state.recipes || [];
        if (index < 0 || index >= recipes.length) return;
        this.state.selectedRecipe = recipes[index].name;
        // Persist per-node recipe selection on logical parent op node
        let node = this.getNodeByPath(this.state.selectedOpPath || this.state.currentNodePath);
        if (node) {
            if (node.nodeType === 'data' && node.originalOpNode) {
                node = node.originalOpNode;
            }
            node.selectedRecipe = this.state.selectedRecipe;
            this.saveCurrentTab();
        }
        this.renderPrompt();
        this.updateRecipeBadge();
        this.addLog(`📋 Recipe selected: ${this.state.selectedRecipe}`);
    },

    chooseRecipe() {
        const recipes = this.state.recipes || [];
        if (recipes.length === 0) {
            this.addLog('⚠ ' + this.t('NoRecipesDefined'));
            return;
        }
        const current = this.state.selectedRecipe;
        const names = recipes.map(r => r.name);
        const idx = current ? names.indexOf(current) : -1;
        const nextIdx = (idx + 1) % names.length;
        this.state.selectedRecipe = names[nextIdx];
        let node = this.getNodeByPath(this.state.selectedOpPath || this.state.currentNodePath);
        if (node) {
            if (node.nodeType === 'data' && node.originalOpNode) {
                node = node.originalOpNode;
            }
            node.selectedRecipe = this.state.selectedRecipe;
            this.saveCurrentTab();
        }
        this.renderPrompt();
        this.updateRecipeBadge();
        this.addLog(`📋 Recipe: ${this.state.selectedRecipe}`);
    },

    updateRecipeBadge() {
        const badge = document.getElementById('recipe-badge');
        if (!badge) return;
        const name = this.state.selectedRecipe;
        if (name) {
            const recipe = (this.state.recipes || []).find(r => r.name === name);
            const icon = recipe?.type === 'command' ? '⚙️' : '🤖';
            badge.textContent = ` ${icon} ${name}`;
            badge.style.display = '';
        } else {
            badge.textContent = '';
            badge.style.display = 'none';
        }
    },

    adjustRetention(delta) {
        const el = document.getElementById('config-history-retention');
        if (!el) return;
        let val = parseInt(el.value) || 50;
        val = Math.max(10, Math.min(500, val + delta));
        el.value = val;
        this.setHistoryRetention(val);
    },

    loadFromChestConfig(name) {
        this.addLog(`📂 Loading from chest "${name}"...`);
        this.postMessage({ type: 'select_input_source', payload: { source: 'chest', chestName: name } });
    },

    viewChest(name) {
        this.postMessage({ type: 'view_chest', payload: { chestName: name } });
    },

    showChestContent(name, content) {
        const preview = content.length > 2000 ? content.slice(0, 2000) + '\n\n... (truncated)' : content;
        alert(`📦 Chest: ${name}\n\n${preview}`);
    },

    deleteChest(name) {
        this.addLog(`🗑 Chest "${name}" will be deleted on next GC`);
    },

    showChestManager() {
        const modal = document.getElementById('chest-modal');
        if (!modal) return;
        modal.classList.add('visible');
        this.renderChestManager();
    },

    closeChestManager() {
        const modal = document.getElementById('chest-modal');
        if (modal) modal.classList.remove('visible');
    },

    renderChestManager() {
        const body = document.getElementById('chest-modal-body');
        if (!body) return;
        const chestNames = this.state.chestList || [];
        if (chestNames.length === 0) {
            body.innerHTML = '<div class="chest-empty">No chests yet. Send output to a chest to create one.</div>';
        } else {
            body.innerHTML = chestNames.map(n =>
                `<div class="chest-mgr-item">
                    <span class="chest-mgr-name">📦 ${this.escapeHtml(n)}</span>
                    <div class="chest-mgr-actions">
                        <button class="chest-view-btn" onclick="app.viewChest('${this.escapeHtml(n)}')">👁 View</button>
                        <button class="chest-load-btn" onclick="app.loadFromChestConfig('${this.escapeHtml(n)}')">📂 Load</button>
                        <button class="chest-delete-btn" onclick="app.deleteChest('${this.escapeHtml(n)}')">✕</button>
                    </div>
                </div>`
            ).join('');
        }
    },

    clearStorageChest() {
        if (!confirm('Empty Storage Chest? This will permanently delete all discarded data.')) return;
        this.addLog('🧹 ' + this.t('StorageChestCleared'));
    },

    onProvidersResult(providers, customMetadata) {
        if (customMetadata) {
            this.state.customMetadata = customMetadata;
        } else {
            customMetadata = this.state.customMetadata || {};
        }

        const DEFAULT_PROVIDERS = (this.state.defaultProviders || []).filter(p => !['mock','mock-http'].includes(p.id));
        // Collect all provider IDs: predefined + any custom ones from data
        const knownIds = DEFAULT_PROVIDERS.map(p => p.id);
        const allIds = [...knownIds];
        if (providers) {
            Object.keys(providers).forEach(id => {
                if (!allIds.includes(id)) allIds.push(id);
            });
        }
        const list = document.getElementById('provider-list');
        if (!list) return;

        let formats = (this.state.defaultProviders || []).filter(p => !['mock','mock-http'].includes(p.id)).map(p => ({ id: p.id, label: p.formatLabel || p.label }));

        // Add custom formats dynamically
        Object.keys(customMetadata).forEach(id => {
            if (!formats.some(f => f.id === id)) {
                formats.push({ id: id, label: `${customMetadata[id].name || id} (Custom)` });
            }
        });

        // Initialize providerModels for custom formats so that models can be selected
        if (!this.state.providerModels) this.state.providerModels = {};
        Object.keys(customMetadata).forEach(id => {
            if (!this.state.providerModels[id]) {
                this.state.providerModels[id] = customMetadata[id].defaultModels || [];
            }
        });

        list.innerHTML = allIds.map(id => {
            const def = DEFAULT_PROVIDERS.find(p => p.id === id);
            const cfg = (providers && providers[id]) || {};
            const label = def ? def.label : id.charAt(0).toUpperCase() + id.slice(1);
            const defaultUrl = def ? def.defaultUrl : 'https://api.openai.com/v1';
            const defaultFormat = def ? def.defaultFormat : 'openai';
            const currentFormat = cfg.apiFormat || defaultFormat;
            const isCustom = !knownIds.includes(id);
            return `<div class="provider-item${isCustom ? ' provider-custom' : ''}">
                <div class="provider-accordion-header" onclick="app.toggleProviderAccordion('${id}')">
                    <span class="accordion-toggle">▼</span>
                    <div class="provider-name-header">${label}${isCustom ? ' <span class="provider-custom-badge">custom</span>' : ''}</div>
                </div>
                <div class="provider-accordion-content" id="provider-content-${id}" style="display:none">
                    <label>Base URL</label>
                    <input type="text" id="url-${id}" value="${this.escapeHtml(cfg.baseUrl||defaultUrl)}" placeholder="${this.escapeHtml(defaultUrl)}">

                    <label>API Key</label>
                    <div class="api-key-row">
                        <input type="password" id="key-${id}" value="${this.escapeHtml(cfg.apiKey||'')}">
                        <button type="button" onclick="app.toggleKeyVisible('key-${id}',this)">👁</button>
                    </div>

                    <details class="provider-advanced">
                        <summary>Advanced Options</summary>
                        <label>API Format</label>
                        <select id="format-${id}" class="recipe-select" style="width:100%;margin-bottom:6px">
                            ${formats.map(f => `<option value="${f.id}" ${f.id === currentFormat ? 'selected' : ''}>${f.label}</option>`).join('')}
                        </select>
                    </details>

                    <div class="test-row">
                        <button type="button" class="btn-test" onclick="app.testProviderConnection('${id}')" data-i18n="Test">Test</button>
                        <span class="test-status" id="test-status-${id}"></span>
                    </div>
                    ${isCustom ? `<button class="provider-remove-btn" onclick="app.removeCustomProvider('${id}')">✕ remove</button>` : ''}
                </div>
            </div>`;
        }).join('');
        // Add custom provider button at the bottom
        list.innerHTML += `<div class="provider-add-row">
            <input type="text" id="new-custom-provider-id" placeholder="provider id (e.g. gpt4all)" style="flex:1">
            <button onclick="app.addCustomProvider()">+ Add Custom</button>
        </div>`;
    },

    addCustomProvider() {
        const input = document.getElementById('new-custom-provider-id');
        if (!input || !input.value.trim()) return;
        const id = input.value.trim().toLowerCase();
        if (!this.state.providers) this.state.providers = {};
        this.state.providers[id] = { apiKey: '', baseUrl: '' };
        this.onProvidersResult(this.state.providers);
        input.value = '';
        this.addLog(`➕ Custom provider added: ${id}`);
    },

    removeCustomProvider(id) {
        if (!this.state.providers || !this.state.providers[id]) return;
        delete this.state.providers[id];
        this.onProvidersResult(this.state.providers);
        this.addLog(`🗑 Custom provider removed: ${id}`);
    },

    toggleKeyVisible(id, btn) {
        const inp = document.getElementById(id);
        if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
        else { inp.type = 'password'; btn.textContent = '👁'; }
    },

    toggleProviderAccordion(id) {
        const content = document.getElementById(`provider-content-${id}`);
        const item = content?.closest('.provider-item');
        if (!content || !item) return;
        const toggle = item.querySelector('.accordion-toggle');
        if (content.style.display === 'none') {
            content.style.display = '';
            item.classList.add('provider-accordion-open');
            if (toggle) toggle.textContent = '▼';
        } else {
            content.style.display = 'none';
            item.classList.remove('provider-accordion-open');
            if (toggle) toggle.textContent = '▶';
        }
    },

    saveProviders() {
        const list = document.getElementById('provider-list');
        if (!list) return;
        const providers = {};
        list.querySelectorAll('.provider-item').forEach(item => {
            let keyInput = null;
            let urlInput = null;
            item.querySelectorAll('input').forEach(inp => {
                if (inp.id.startsWith('key-')) keyInput = inp;
                else if (inp.id.startsWith('url-')) urlInput = inp;
            });
            if (!keyInput || !urlInput) return;
            const id = keyInput.id.replace('key-', '');
            const formatSelect = item.querySelector('#format-' + id);
            const existing = (this.state.providers && this.state.providers[id]) || {};
            providers[id] = {
                apiKey:  keyInput.value || '',
                baseUrl: urlInput.value || '',
                apiFormat: formatSelect?.value || 'openai',
                models:  existing.models || []
            };
        });
        if (Object.keys(providers).length === 0) return;
        this.postMessage({ type: 'save_providers', payload: providers });
        this.state.providers = providers;
    },

    testProviderConnection(id) {
        const apiKey = document.getElementById('key-' + id)?.value || '';
        const urlEl = document.getElementById('url-' + id);
        const baseUrl = urlEl?.value || '';
        const formatSelect = document.getElementById('format-' + id);
        const apiFormat = formatSelect?.value || 'openai';
        const statusEl = document.getElementById('test-status-' + id);
        if (statusEl) {
            statusEl.textContent = '⏳ Testing...';
            statusEl.className = 'test-status';
        }
            this.addLog('🔌 ' + this.t('TestingConnection').replace('{id}', id));
        this.postMessage({ type: 'test_provider_connection', payload: { provider: id, apiFormat, apiKey, baseUrl } });
    },

    onTestConnectionResult(result) {
        const statusEl = document.getElementById('test-status-' + result.provider);
        if (!statusEl) return;
        if (result.success) {
            statusEl.textContent = '✅ ' + result.message;
            statusEl.className = 'test-status success';
            this.addLog('✅ ' + result.provider + ' ' + this.t('ConnectionOK'));
        } else {
            statusEl.textContent = '❌ ' + result.message;
            statusEl.className = 'test-status error';
            this.addLog(`Connection Test Failed\nProvider: ${result.provider}\nError: ${result.message}\nAction: Check API key, base URL, and network connectivity`);
        }
    },

    handleMenuCommand(cmd) {
        switch (cmd.action) {
            case 'new_tab':         this.newTab(); break;
            case 'save':            this.saveFile(); break;
            case 'save_as':         this.saveFileAs(); break;
            case 'save_project':    this.saveProject(); break;
            case 'new_project':     this.newProject(); break;
            case 'switch_project':  this.showProjectSwitcher(); break;
            case 'projects_root':   this.showProjectsRootConfig(); break;
            case 'about_project_lifecycle': this.showProjectLifecycleInfo(); break;
            case 'import_zip':      this.addLog('📦 ' + this.t('ImportZipComingSoon')); break;
            case 'export_node':     this.addLog('📤 ' + this.t('ExportNodeComingSoon')); break;
            case 'run_pipeline':    this.runPipeline(); break;
            case 'pipeline_manager': this.showPipelineManager(); break;
            case 'pipeline_history': this.showHistory(); break;
            case 'export_pipeline': this.exportPipeline(); break;
            case 'import_pipeline': this.importPipeline(); break;
            case 'send_to_chest_dialog': this.sendToChestDialog(); break;
            case 'chest_manager':   this.showChestManager(); break;
            case 'config':          this.showConfig(); break;
            case 'test_connection': this.showConfig(); break;
            case 'app_config':      this.showAppConfig(); break;
            case 'recipe_manager':  this.showRecipeManager(); break;
            case 'bt_run':          this.btCtrlRun(); break;
            case 'bt_step':         this.btCtrlStep(); break;
            case 'bt_pause':        this.btCtrlPause(); break;
            case 'bt_stop':         this.btCtrlStop(); break;
            case 'bt_toggle_lock':  this.btCtrlToggleLock(); break;
            case 'bt_blackboard':   this.btBlackboardDialog(); break;
            case 'bt_config':       this.btConfigDialog(); break;
            case 'toggle_pane':     this.togglePane(cmd.pane + '-pane'); break;
            case 'about':           this.showAbout(); break;
            case 'folder_help':     this.showFolderHelp(); break;
            case 'welcome_wizard':  this.showWizard(); break;
            case 'reset_wizard':    this.resetWizard(); break;
            case 'setup_wizard':    this.showSetupWizard(); break;
            default: this.addLog('⚠ ' + this.t('UnknownMenuCommand').replace('{action}', cmd.action));
        }
    },

    onSaveAsResult(path) {
        const tab = this.state.tabs[this.state.activeTab];
        if (tab && path) {
            tab.file = path.split('/').pop().split('\\').pop();
            this.addLog('💾 ' + this.t('SavedAs').replace('{path}', path));
        }
    },

    switchTreeTab(tab) {
        this.state.activeTreeTab = tab;
        const nodeBtn = document.getElementById('btn-tree-tab-pipeline');
        const fileBtn = document.getElementById('btn-tree-tab-file');
        const nodeContent = document.getElementById('tree-content');
        const fileContent = document.getElementById('file-tree-content');

        if (tab === 'pipeline' || tab === 'node') {
            nodeBtn?.classList.add('active');
            fileBtn?.classList.remove('active');
            if (nodeContent) nodeContent.style.display = '';
            if (fileContent) fileContent.style.display = 'none';
            this.renderTree();
        } else {
            nodeBtn?.classList.remove('active');
            fileBtn?.classList.add('active');
            if (nodeContent) nodeContent.style.display = 'none';
            if (fileContent) fileContent.style.display = '';
            this.requestFileTree();
        }
    },

    requestFileTree() {
        this.postMessage({ type: 'get_file_tree' });
    },

    renderFileTree() {
        const el = document.getElementById('file-tree-content');
        if (!el) return;
        if (!this.state.fileTree || this.state.fileTree.length === 0) {
            el.innerHTML = '<div class="empty">No files</div>';
            return;
        }
        el.innerHTML = this.buildFileTreeHTML(this.state.fileTree, 0);
    },

    buildFileTreeHTML(items, indent) {
        let html = '';
        const activeTab = this.state.tabs[this.state.activeTab];
        const activeFile = activeTab ? activeTab.file : '';
        
        items.forEach(item => {
            if (item.type === 'directory') {
                html += `<div class="file-tree-node directory" style="padding-left:${indent}px">${this.escapeHtml(item.name)}</div>`;
                if (item.children && item.children.length > 0) {
                    html += this.buildFileTreeHTML(item.children, indent + 16);
                }
            } else if (item.type === 'file') {
                const isSelected = item.path === activeFile;
                const cls = 'file-tree-node file' + (isSelected ? ' selected' : '');
                const escPath = this.escapeHtml(item.path);
                let displayName = item.name || '';
                if (displayName.endsWith('.promptsbt')) {
                    displayName = displayName.slice(0, -10);
                }
                html += `<div class="${cls}" style="padding-left:${indent}px" onclick="app.selectFileTreeItem('${escPath}')" oncontextmenu="event.preventDefault();event.stopPropagation();app.showFileTreeContextMenu(event,'${escPath}')">${this.escapeHtml(displayName)}</div>`;
            }
        });
        return html;
    },

    selectFileTreeItem(path) {
        const tabIndex = this.state.tabs.findIndex(t => t.file === path);
        if (tabIndex >= 0) {
            this.switchTab(tabIndex);
        } else {
            this.state.tabs.push({ name: path.split('/').pop().split('\\').pop(), file: path, root: { title: '', content: '', mimetype: 'text/plain', attachments: [], children: [], nodeType: 'root' } });
            this.state.activeTab = this.state.tabs.length - 1;
            this.renderTabs();
            this.postMessage({ type: 'load_file_data', payload: { path: path } });
        }
    },

    onFileDataResult(path, root, localRecipes) {
        const idx = this.state.tabs.findIndex(t => t.file === path);
        if (idx >= 0) {
            this.patchNodeTypes(root, true);
            this.state.tabs[idx].root = root;
            if (idx === this.state.activeTab) {
                this.renderTree();
                this.renderList();
                if (root && root.children && root.children.length > 0) {
                    this.selectNode(''); // Select root node by default
                }
            }
        }

        // Merge local recipes into projectRecipes
        if (localRecipes && Array.isArray(localRecipes)) {
            let added = 0, updated = 0;
            for (const local of localRecipes) {
                const idx = this.state.projectRecipes.findIndex(r => r.name === local.name);
                if (idx >= 0) {
                    this.state.projectRecipes[idx] = local;
                    updated++;
                } else {
                    this.state.projectRecipes.push(local);
                    added++;
                }
            }
            this.saveProjectRecipes();
            this.addLog(`📋 Loaded ${localRecipes.length} local recipes (${added} new, ${updated} updated)`);
        }
    },

    onRenameFileResult(payload) {
        if (!payload || !payload.success) {
            this.addLog(`File Rename Error\nOperation: onRenameFileResult\nError: ${payload ? payload.error : 'unknown'}\nAction: Check file permissions and path validity`);
            return;
        }
        const { oldFile, newFile } = payload;
        const index = this.state.tabs.findIndex(t => t.file === oldFile);
        if (index >= 0) {
            const newName = newFile.split('/').pop().split('\\').pop();
            this.state.tabs[index].name = newName;
            this.state.tabs[index].file = newFile;
            this.postMessage({ type: 'save_session', payload: {
                tabs: this.state.tabs.map(t => ({ name: t.name, file: t.file }))
            }});
            this.renderTabs();
            this.postMessage({ type: 'get_file_tree' });
            this.addLog(`✏️ Tab and file renamed to "${newName}"`);
        }
    },

    isValidFileName(name) {
        if (!name || name.trim() === '') return false;
        const forbiddenChars = /[\\/:*?"<>|]/;
        if (forbiddenChars.test(name)) return false;
        const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
        if (reservedNames.test(name)) return false;
        return true;
    },

    checkNodeColorInvariants() {
        const tab = this.state.tabs[this.state.activeTab];
        if (!tab || !tab.root) return;

        const checkNode = (node, path) => {
            const isRoot = node.nodeType === 'root' || (!node.nodeType && path === '');
            const isProcessed = node.nodeType === 'placeholder' || (!node.nodeType && node.title && this.safeAtob(node.title) === 'Processed');

            // 1. Virtual state logic check
            let colorCls = '';
            const selectedOpPath = this.state.selectedOpPath;
            const selectedDataPath = this.state.selectedDataPath;

            if (!isRoot && !isProcessed) {
                if (selectedOpPath !== '' && path === selectedOpPath) {
                    colorCls = 'selected';
                } else if (selectedDataPath !== '' && path === selectedDataPath) {
                    colorCls = 'selected-data';
                }
            }

            if (isRoot || isProcessed) {
                if (colorCls) {
                    console.error(`Runtime node color invariant violation (logic): Root/Processed node at path "${path}" has color class "${colorCls}"`);
                }
            } else if (this.isDataNodePath(path)) {
                if (colorCls === 'selected' || colorCls === 'selected-input') {
                    console.error(`Runtime node color invariant violation (logic): Data node at path "${path}" has op-node color class "${colorCls}"`);
                }
            } else {
                if (colorCls === 'selected-data' || colorCls === 'selected-result') {
                    console.error(`Runtime node color invariant violation (logic): Op-node at path "${path}" has data node color class "${colorCls}"`);
                }
            }
            // selected-linked is valid on both op and data nodes

            // 2. Real DOM element check
            if (path !== '') {
                const el = this.getDOMElementForPath(path);

                if (el) {
                    const classes = el.className.split(' ');
                    if (isProcessed) {
                        if (classes.includes('selected') || classes.includes('selected-input') ||
                            classes.includes('selected-data') || classes.includes('selected-result') ||
                            classes.includes('selected-linked')) {
                            console.error(`Runtime node color invariant violation (DOM): Processed node at "${path}" has color classes in DOM: ${el.className}`);
                        }
                    } else if (this.isDataNodePath(path)) {
                        if (classes.includes('selected') || classes.includes('selected-input')) {
                            console.error(`Runtime node color invariant violation (DOM): Data node at path "${path}" has op-node color classes in DOM: ${el.className}`);
                        }
                        // selected-linked and selected-multi are valid on data nodes
                    } else {
                        if (classes.includes('selected-data') || classes.includes('selected-result')) {
                            console.error(`Runtime node color invariant violation (DOM): Op-node at "${path}" has data node color classes in DOM: ${el.className}`);
                        }
                        // selected-linked is valid on op nodes
                    }
                }
            }

            if (node.children) {
                node.children.forEach((child, i) => {
                    checkNode(child, path + '/' + i);
                });
            }
        };

        checkNode(tab.root, '');


    },

    checkNodeTypeInvariants() {
        const tab = this.state.tabs[this.state.activeTab];
        if (!tab || !tab.root) return;

        const errors = [];

        const checkNode = (node, path, isRootLevel) => {
            const nt = node.nodeType;

            // nodeType must be set (patchNodeTypes should have set it)
            if (!nt) {
                errors.push(`path="${path}": nodeType not set`);
                if (node.children) node.children.forEach((c, i) => checkNode(c, path === '' ? String(i) : path + '/' + i, false));
                return;
            }

            // Check valid nodeType
            if (!['root', 'assemble', 'data', 'placeholder'].includes(nt)) {
                errors.push(`path="${path}": unknown nodeType="${nt}"`);
            }

            // root only at root level
            if (nt === 'root' && !isRootLevel) {
                errors.push(`path="${path}": root nodeType set on non-root node`);
            }
            if (isRootLevel && nt !== 'root') {
                errors.push(`path="${path}": root node has nodeType "${nt}" (expected "root")`);
            }

            // data node should have pipelineMeta
            if (nt === 'data' && node.pipelineMeta === undefined) {
                errors.push(`path="${path}": nodeType="data" but no pipelineMeta`);
            }

            // assemble node should not have pipelineMeta
            if (nt === 'assemble' && node.pipelineMeta !== undefined) {
                errors.push(`path="${path}": nodeType="assemble" but pipelineMeta is set (data node misconfigured)`);
            }

            // btType only valid on assemble / root nodes
            if (node.btType !== undefined && nt !== 'assemble' && nt !== 'root') {
                errors.push(`path="${path}": btType only valid on assemble/root nodes (nodeType="${nt}")`);
            }
            const _decoratorsList = ['invert', 'repeater', 'retry', 'alwaysSucceed', 'alwaysFail', 'guard', 'delay', 'maxTime'];
            const _compositesList = ['sequence', 'selector', 'parallel', 'memSequence', 'memSelector'];
            const _baseTypes = ['sequence', 'selector', 'parallel', 'memSequence', 'memSelector', ..._decoratorsList, 'leaf', 'leaf_ai', 'leaf_math', 'math', 'leaf_file', 'file', 'leaf_web', 'web', 'leaf_misc', 'misc'];
            const validBtTypes = _baseTypes.slice();
            if (node.btType !== undefined) {
                const isValid = validBtTypes.includes(node.btType)
                    // Accept decorator chains: all-but-last must be decorators, last must be composite
                    || (node.btType.includes('+') && (() => {
                        const parts = node.btType.split('+');
                        if (parts.length < 2) return false;
                        const composite = parts.pop();
                        return _compositesList.includes(composite) && parts.every(d => _decoratorsList.includes(d));
                    })());
                if (!isValid) {
                    errors.push(`path="${path}": unknown btType="${node.btType}"`);
                }
            }

            if (node.children) node.children.forEach((c, i) => checkNode(c, path === '' ? String(i) : path + '/' + i, false));
        };

        checkNode(tab.root, '', true);

        if (errors.length > 0) {
            const msg = `Node Type Validation Error\nOperation: checkNodeTypeInvariants\nTab: ${tab.name}\nIssues Found: ${errors.length}\nDetails:\n` + errors.map(e => '  • ' + e).join('\n') + `\nAction: Use repairNodeTypeInvariants() to auto-fix, or review node structure manually`;
            this.addLog('[RC-01] ' + msg);
            console.error('[RC-01] checkNodeTypeInvariants:', msg);
        }
    },

    // Tree rendering
    renderTree() {
        if (this.state.viewMode === 'pipeline') {
            this.renderPipelineSteps();
            return;
        }
        const el = document.getElementById('tree-content');
        if (!el) return;
        const tab = this.state.tabs[this.state.activeTab];
        if (!tab || !tab.root) { el.innerHTML = '<div class="empty">No data</div>'; return; }
        // Pre-compute whether the currently selected node is a leaf (data node)
        const selNode = this.getNodeByPath(this.state.currentNodePath);
        this._selectedIsLeaf = selNode ? (!selNode.children || selNode.children.length === 0) : false;
        
        // Pre-compute linked sources
        this._linkedSources = this.buildLinkedSources(tab.root);

        el.innerHTML = this.buildTreeHTML(tab.root, '');
        
        // Also sync file tree selections if visible
        if (this.state.activeTreeTab === 'file') {
            this.renderFileTree();
        }
    },

    buildTreeHTML(node, path) {
        let html = '';
        let displayStr = node.title ? this.safeAtob(node.title) : this.getTitleFallback(node);
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(displayStr)) {
            displayStr = this.formatRunDate(displayStr);
        }
        const display = this.escapeHtml(displayStr);
        const safePath = this.escapeHtml(path);
        const hasChildren = node.children && node.children.length > 0;
        const collapsed = this.state.collapsedPaths.has(path);

        // Compute color class based on relationship to selected node
        const selectedOpPath = this.state.selectedOpPath;
        const selectedDataPath = this.state.selectedDataPath;
        let colorCls = '';

        const isRoot = node.nodeType === 'root' || (!node.nodeType && path === '');
        const isProcessed = node.nodeType === 'placeholder' || (!node.nodeType && node.title && this.safeAtob(node.title) === 'Processed');

        const linkedSources = this._linkedSources || new Set();

        if (!isRoot && !isProcessed) {
            if (this.isDataNodePath(path)) {
                const resClass = this.resultNodeClass(path, this.state.currentNodePath, selectedDataPath, p => linkedSources.has(p));
                if (resClass) colorCls = ' ' + resClass;
            } else {
                const isSelected = this.state.currentNodePath === path;
                const stepClass = this.stepNodeClass(path, isSelected, this.state.currentNodePath, selectedDataPath, p => linkedSources.has(p));
                if (stepClass) {
                    if (stepClass === 'selected-input') {
                        colorCls = ' selected';
                    } else {
                        colorCls = ' ' + stepClass;
                    }
                }
            }
        }

        let extraCls = '';
        if (selectedOpPath !== '' && path === selectedOpPath) {
            extraCls += ' current-op';
        }
        if (selectedDataPath !== '' && path === selectedDataPath) {
            extraCls += ' current-data';
        }

        let typeCls = '';
        if (isProcessed) {
            typeCls = ' tree-processed-header';
            const isLinked = node.children && node.children.some((child, idx) => {
                const childPath = path + '/' + idx;
                return linkedSources.has(childPath);
            });
            if (isLinked) {
                typeCls += ' linked';
            }
        } else if (this.isDataNodePath(path)) {
            typeCls = ' result-node';
        }

        const btCls = node.btType ? ` bt-${node.btType}` : '';
        const btRunSt = this.state.btRunState ? (this.state.btRunState.get(path) || '') : '';
        const btRunCls = btRunSt ? ` bt-${btRunSt}` : '';
        const isMultiSelected = this.state.selectedDataPaths && this.state.selectedDataPaths.includes(path);
        const multiCls = isMultiSelected ? ' selected-multi' : '';
        const nodeTypeCls = node && node.nodeType ? ' nt-' + node.nodeType : '';
        const cls = 'tree-node' + (hasChildren ? ' branch' : ' leaf') + colorCls + extraCls + typeCls + btCls + btRunCls +
                    (collapsed ? ' collapsed' : '') + multiCls + nodeTypeCls;
        const collapseBtn = hasChildren
            ? `<span class="tree-collapse-btn" onclick="event.stopPropagation();app.treeToggleCollapse('${safePath}')">${collapsed ? '▶' : '▼'}</span>`
            : '<span class="tree-collapse-btn-spacer"></span>';
        const effectiveType = node.btType || (isRoot ? 'sequence' : '');
        const _iconMap = {
            'sequence': '<span class="bt-icon bt-icon-seq">➡️</span>',
            'selector': '<span class="bt-icon bt-icon-sel">🔀</span>',
            'parallel': '<span class="bt-icon bt-icon-par">⚡</span>',
            'memSequence': '<span class="bt-icon bt-icon-mem-seq">📋➡️</span>',
            'memSelector': '<span class="bt-icon bt-icon-mem-sel">📋🔀</span>',
            'invert': '<span class="bt-icon bt-icon-invert">🔄</span>',
            'repeater': '<span class="bt-icon bt-icon-repeater">🔁</span>',
            'retry': '<span class="bt-icon bt-icon-retry">🔂</span>',
            'alwaysSucceed': '<span class="bt-icon bt-icon-always-succeed">✅</span>',
            'alwaysFail': '<span class="bt-icon bt-icon-always-fail">❌</span>',
            'guard': '<span class="bt-icon bt-icon-guard">🛡️</span>',
            'delay': '<span class="bt-icon bt-icon-delay">⏳</span>',
            'maxTime': '<span class="bt-icon bt-icon-maxtime">⏰</span>',
            'leaf': '<span class="bt-icon bt-icon-leaf-ai">🤖</span>',
            'leaf_ai': '<span class="bt-icon bt-icon-leaf-ai">🤖</span>',
            'math': '<span class="bt-icon bt-icon-leaf-math">🔢</span>',
            'leaf_math': '<span class="bt-icon bt-icon-leaf-math">🔢</span>',
            'file': '<span class="bt-icon bt-icon-leaf-file">📁</span>',
            'leaf_file': '<span class="bt-icon bt-icon-leaf-file">📁</span>',
            'web': '<span class="bt-icon bt-icon-leaf-web">🌐</span>',
            'leaf_web': '<span class="bt-icon bt-icon-leaf-web">🌐</span>',
            'misc': '<span class="bt-icon bt-icon-leaf-misc">⚙️</span>',
            'leaf_misc': '<span class="bt-icon bt-icon-leaf-misc">⚙️</span>',
        };
        let typeIcon = _iconMap[effectiveType] || '';
        if (!typeIcon && effectiveType.includes('+')) {
            typeIcon = effectiveType.split('+').map(p => _iconMap[p] || '').join('');
        }
        const isData = !isRoot && !isProcessed && this.isDataNodePath(path);
        const isAssemble = !isRoot && !isProcessed && !isData && node.nodeType === 'assemble';
        const dataMediaType = isData ? this._getDataNodeMediaType(node) : '';
        const dataIcon = isData
            ? dataMediaType === 'image' ? '<span class="bt-icon bt-icon-data-image">🖼️</span>'
            : dataMediaType === 'audio' ? '<span class="bt-icon bt-icon-data-audio">🎵</span>'
            : dataMediaType === 'video' ? '<span class="bt-icon bt-icon-data-video">🎬</span>'
            : '<span class="bt-icon bt-icon-data">📄</span>'
            : '';
        const btIcon = isRoot
            ? '<span class="bt-icon bt-icon-root">🏠</span>' + typeIcon + (this._bt && this._bt.getConfig().mode === 'cycle' ? '<span class="bt-icon bt-icon-cycle">🔄</span>' : '')
            : typeIcon || (isProcessed ? '<span class="bt-icon bt-icon-processed">📦</span>' : '')
            || dataIcon
            || (isAssemble ? '<span class="bt-icon bt-icon-assemble">🔧</span>' : '');
        const btBadge = btRunSt ? '<span class="bt-status"></span>' : '';
        let dragDropAttrs = '';
        if (isProcessed) {
            dragDropAttrs = ` ondragover="event.preventDefault();event.stopPropagation();app.treeDragOver(event,'${safePath}')" ondragleave="app.treeDragLeave(event,'${safePath}')" ondrop="app.treeDrop(event,'${safePath}')"`;
        } else if (this.isDataNodePath(path)) {
            dragDropAttrs = ` draggable="true" ondragstart="app.treeDragStart(event,'${safePath}')"`;
        }
        html += `<div class="${cls}" onclick="app.selectNode('${safePath}',event)" oncontextmenu="event.preventDefault();event.stopPropagation();app.showTreeContextMenu(event,'${safePath}')"${dragDropAttrs}>${collapseBtn}${btIcon}${display}${btBadge}</div>`;
        if (hasChildren && !collapsed) {
            html += '<div class="tree-children">';
            node.children.forEach((child, i) => {
                html += this.buildTreeHTML(child, path + '/' + i);
            });
            html += '</div>';
        }
        return html;
    },

    treeToggleCollapse(path) {
        if (this.state.collapsedPaths.has(path)) {
            this.state.collapsedPaths.delete(path);
        } else {
            this.state.collapsedPaths.add(path);
        }
        this.renderTree();
    },

    showTreeContextMenu(event, path) {
        const node = this.getNodeByPath(path);
        const parts = path.split('/').filter(p => p !== '');
        const isRoot = parts.length === 0;
        const hasChildren = node && node.children && node.children.length > 0;
        const collapsed = this.state.collapsedPaths.has(path);

        let idx = -1, siblingCount = 0;
        if (!isRoot) {
            idx = parseInt(parts[parts.length - 1]);
            const parentPath = parts.slice(0, -1).join('/');
            const parent = this.getNodeByPath(parentPath ? '/' + parentPath : '');
            siblingCount = parent && parent.children ? parent.children.length : 0;
        }

        const menu = document.getElementById('tree-context-menu');
        let items = '';

        if (hasChildren) {
            const label = collapsed ? '▶ ' + this.t('Expand') : '▼ ' + this.t('Collapse');
            items += `<div class="ctx-item" onclick="app.treeToggleCollapse('${path}');app.hideTreeContextMenu()">${label}</div>`;
            items += '<div class="ctx-sep"></div>';
        }

        items += `<div class="ctx-item" onclick="app.treeCtxAddChild('${path}');app.hideTreeContextMenu()">➕ ${this.t('AddChildNode')}</div>`;

        // BT type submenu (assemble and root nodes)
        const isBtEligible = node && (node.nodeType === 'assemble' || node.nodeType === 'root');
        if (isBtEligible) {
            const curBt = node.btType || (node.nodeType === 'root' ? 'sequence' : 'leaf');
            const _labelMap = {
                'sequence': '➡️ Sequence', 'selector': '🔀 Selector', 'parallel': '⚡ Parallel',
                'memSequence': '📋➡️ MemSequence', 'memSelector': '📋🔀 MemSelector',
                'invert': '🔄 Invert', 'repeater': '🔁 Repeater', 'retry': '🔂 Retry',
                'alwaysSucceed': '✅ Always Succeed', 'alwaysFail': '❌ Always Fail',
                'guard': '🛡️ Guard', 'delay': '⏳ Delay', 'maxTime': '⏰ MaxTime',
                'leaf': '🤖 Leaf (AI)', 'leaf_ai': '🤖 Leaf (AI)',
                'leaf_math': '🔢 Leaf (Math)', 'math': '🔢 Leaf (Math)',
                'leaf_file': '📁 Leaf (File)', 'file': '📁 Leaf (File)',
                'leaf_web': '🌐 Leaf (Web)', 'web': '🌐 Leaf (Web)',
                'leaf_misc': '⚙️ Leaf (Misc)', 'misc': '⚙️ Leaf (Misc)',
            };
            let btLabel = curBt.includes('+')
                ? curBt.split('+').map(p => _labelMap[p] || p).join(' + ')
                : (_labelMap[curBt] || curBt);
            const _comps = ['sequence', 'selector', 'parallel', 'memSequence', 'memSelector'];
            const _decos = ['invert', 'repeater', 'retry', 'alwaysSucceed', 'alwaysFail', 'guard', 'delay', 'maxTime'];
            function _mkItem(type, label) {
                const checked = curBt === type ? ' ✓' : '';
                return `<div class="ctx-item" onclick="app.treeCtxSetBtType('${path}','${type}');app.hideTreeContextMenu()">${label}${checked}</div>`;
            }
            items += '<div class="ctx-sep"></div>';
            items += `<div class="ctx-submenu">` +
                `<div class="ctx-item">🌳 ${this.t('BTType')}: ${btLabel}</div>` +
                `<div class="ctx-submenu-panel" id="ctx-bt-panel">` +
                    _mkItem('sequence', '➡️ Sequence') +
                    _mkItem('selector', '🔀 Selector') +
                    _mkItem('parallel', '⚡ Parallel') +
                    _mkItem('memSequence', '📋➡️ MemSequence') +
                    _mkItem('memSelector', '📋🔀 MemSelector') +
                    `<div class="ctx-sep"></div>` +
                    _mkItem('invert', '🔄 Invert') +
                    _mkItem('repeater', '🔁 Repeater') +
                    _mkItem('retry', '🔂 Retry') +
                    _mkItem('alwaysSucceed', '✅ Always Succeed') +
                    _mkItem('alwaysFail', '❌ Always Fail') +
                    _mkItem('guard', '🛡️ Guard') +
                    _mkItem('delay', '⏳ Delay') +
                    _mkItem('maxTime', '⏰ MaxTime') +
                    `<div class="ctx-sep"></div>` +
                    `<div class="ctx-item" onclick="app.treeCtxSetCustomBtType('${path}');app.hideTreeContextMenu()">✏️ ${this.t('BTCustomType')}</div>` +
                    `<div class="ctx-sep"></div>` +
                    _mkItem('leaf', '🤖 ' + this.t('LeafAI')) +
                    _mkItem('leaf_math', '🔢 ' + this.t('LeafMath')) +
                    _mkItem('leaf_file', '📁 ' + this.t('LeafFile')) +
                    _mkItem('leaf_web', '🌐 ' + this.t('LeafWeb')) +
                    _mkItem('leaf_misc', '⚙️ ' + this.t('LeafMisc')) +
                `</div>` +
            `</div>`;
            const isComposite = _comps.includes(node.btType) || (node.btType && node.btType.includes('+'));
            const runLabel = isComposite ? '▶ ' + this.t('BTRunSubtree') : '▶ ' + this.t('RunIndividual');
            items += `<div class="ctx-item" onclick="app.btCtrlSetTarget('${path}');app.btCtrlRun();app.hideTreeContextMenu()">${runLabel}</div>`;
            items += `<div class="ctx-item" onclick="app.showNodeProperties('${path}');app.hideTreeContextMenu()">📋 ${this.t('NodeProperties')}</div>`;
            items += '<div class="ctx-sep"></div>';
            items += `<div class="ctx-item" onclick="app.treeCtxAddPlaceholder('${path}');app.hideTreeContextMenu()">📁 ${this.t('AddPlaceholder')}</div>`;
        }

        // Multi-select batch operations
        const isDataNode = node && (node.nodeType === 'data' || this.isDataNodePath(path));
        const multiPaths = this.state.selectedDataPaths && this.state.selectedDataPaths.length > 1
            && this.state.selectedDataPaths.includes(path)
            ? this.state.selectedDataPaths
            : null;
        const multiCount = multiPaths ? multiPaths.length : 0;

        // Add output to input: single or multi
        if (isDataNode && this.state.selectedOpPath !== '') {
            items += '<div class="ctx-sep"></div>';
            if (multiCount > 0) {
                items += `<div class="ctx-item" onclick="app.treeCtxAddOutputsToInput(${JSON.stringify(multiPaths)});app.hideTreeContextMenu()">📥 ${this.t('AddOutputsToInput')} (${multiCount})</div>`;
            } else {
                items += `<div class="ctx-item" onclick="app.treeCtxAddOutputToInput('${path}');app.hideTreeContextMenu()">📥 ${this.t('AddOutputToInput')}</div>`;
            }
        }

        if (!isRoot) {
            if (multiCount > 0 && isDataNode) {
                items += '<div class="ctx-sep"></div>';
                items += `<div class="ctx-item ctx-danger" onclick="app.treeCtxDeleteMultiple(${JSON.stringify(multiPaths)});app.hideTreeContextMenu()">🗑 ${this.t('Delete')} (${multiCount} ${this.t('Nodes')})</div>`;
            } else {
                items += '<div class="ctx-sep"></div>';
                items += `<div class="ctx-item" onclick="app.treeCtxAddSibling('${path}');app.hideTreeContextMenu()">➕ ${this.t('AddSiblingNode')}</div>`;
                items += '<div class="ctx-sep"></div>';
                items += `<div class="ctx-item" onclick="app.treeCtxRename('${path}');app.hideTreeContextMenu()">✏️ ${this.t('Rename')}</div>`;
                items += '<div class="ctx-sep"></div>';

                if (idx > 0) {
                    items += `<div class="ctx-item" onclick="app.treeCtxMoveUp('${path}');app.hideTreeContextMenu()">⬆ ${this.t('MoveUp')}</div>`;
                }
                if (idx < siblingCount - 1) {
                    items += `<div class="ctx-item" onclick="app.treeCtxMoveDown('${path}');app.hideTreeContextMenu()">⬇ ${this.t('MoveDown')}</div>`;
                }
                items += '<div class="ctx-sep"></div>';
                items += `<div class="ctx-item ctx-danger" onclick="app.treeCtxDelete('${path}');app.hideTreeContextMenu()">🗑 ${this.t('Delete')}</div>`;
            }
        }

        menu.innerHTML = items;
        menu.style.display = 'block';
        menu.style.left = Math.min(event.clientX, window.innerWidth - 180) + 'px';
        menu.style.top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 10) + 'px';

        // Flip submenu to left if it overflows right edge
        const btPanel = document.getElementById('ctx-bt-panel');
        if (btPanel) {
            const menuLeft = parseInt(menu.style.left);
            if (menuLeft + menu.offsetWidth + 160 > window.innerWidth) {
                btPanel.classList.add('flip-left');
            }
        }
    },

    hideTreeContextMenu() {
        const menu = document.getElementById('tree-context-menu');
        if (menu) menu.style.display = 'none';
    },

    getFileFullPath(filePath) {
        const appData = this.state.appDataPath || '';
        const project = this.state.activeProject || 'Default';
        const sep = appData.includes('\\') ? '\\' : '/';
        if (!filePath) return '';
        if (filePath.includes('/') || filePath.includes('\\') || filePath.includes(':')) {
            return filePath;
        }
        let basePath = appData;
        if (basePath.endsWith('/') || basePath.endsWith('\\')) {
            basePath = basePath.slice(0, -1);
        }
        return basePath + sep + 'projects' + sep + project + sep + 'data' + sep + filePath;
    },

    showTabContextMenu(event, index) {
        event.preventDefault();
        event.stopPropagation();
        const menu = document.getElementById('tab-context-menu');
        if (!menu) return;
        const tab = this.state.tabs[index];
        if (!tab) return;

        const fullPath = this.getFileFullPath(tab.file);
        let items = '';
        items += `<div class="ctx-item" style="color:var(--theme-text2);font-size:11px;user-select:text;pointer-events:none;word-break:break-all;padding-bottom:4px;border-bottom:1px solid var(--theme-border)">${this.escapeHtml(fullPath)}</div>`;
        items += `<div class="ctx-item" onclick="navigator.clipboard.writeText('${this.escapeHtml(fullPath).replace(/\\/g, '\\\\')}');app.hideTabContextMenu()">📋 ${this.t('CopyFullPath') || 'Copy Full Path'}</div>`;
        items += '<div class="ctx-sep"></div>';
        items += `<div class="ctx-item" onclick="app.tabCtxRename(${index});app.hideTabContextMenu()">✏️ ${this.t('Rename')}</div>`;
        items += `<div class="ctx-item" onclick="app.tabCtxDuplicate(${index});app.hideTabContextMenu()">📋 ${this.t('Duplicate') || 'Duplicate'}</div>`;
        items += '<div class="ctx-sep"></div>';

        const canClose = this.state.tabs.length > 1;
        const disabledCls = canClose ? '' : ' disabled';
        const style = canClose ? '' : ' style="opacity:0.5;pointer-events:none;"';
        items += `<div class="ctx-item ctx-danger${disabledCls}"${style} onclick="if(${canClose}){app.closeTab(${index});}app.hideTabContextMenu()">✕ ${this.t('Close') || 'Close'}</div>`;

        menu.innerHTML = items;
        menu.style.display = 'block';
        menu.style.left = Math.min(event.clientX, window.innerWidth - 160) + 'px';
        menu.style.top = Math.min(event.clientY, window.innerHeight - 120) + 'px';
    },

    showFileTreeContextMenu(event, path) {
        event.preventDefault();
        event.stopPropagation();
        const menu = document.getElementById('tab-context-menu');
        if (!menu) return;

        const fullPath = this.getFileFullPath(path);
        let items = '';
        items += `<div class="ctx-item" style="color:var(--theme-text2);font-size:11px;user-select:text;pointer-events:none;word-break:break-all;padding-bottom:4px;border-bottom:1px solid var(--theme-border)">${this.escapeHtml(fullPath)}</div>`;
        items += `<div class="ctx-item" onclick="app.selectFileTreeItem('${this.escapeHtml(path).replace(/\\/g, '\\\\')}');app.hideTabContextMenu()">📂 ${this.t('Open') || 'Open'}</div>`;
        items += `<div class="ctx-item" onclick="navigator.clipboard.writeText('${this.escapeHtml(fullPath).replace(/\\/g, '\\\\')}');app.hideTabContextMenu()">📋 ${this.t('CopyFullPath') || 'Copy Full Path'}</div>`;
        
        menu.innerHTML = items;
        menu.style.display = 'block';
        menu.style.left = Math.min(event.clientX, window.innerWidth - 160) + 'px';
        menu.style.top = Math.min(event.clientY, window.innerHeight - 120) + 'px';
    },

    hideTabContextMenu() {
        const menu = document.getElementById('tab-context-menu');
        if (menu) menu.style.display = 'none';
    },

    tabCtxRename(index) {
        const tab = this.state.tabs[index];
        if (!tab) return;
        
        const modalId = 'rename-tab-modal';
        let modal = document.getElementById(modalId);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'modal';
            modal.innerHTML = `<div class="modal-content" style="max-width:400px">
                <span class="modal-close" onclick="document.getElementById('${modalId}').classList.remove('visible')">&times;</span>
                <div class="modal-body">
                    <p style="margin:0 0 8px">${this.t('EnterTabName')}</p>
                    <input id="rename-tab-input" type="text" style="width:100%;box-sizing:border-box;padding:6px 8px;background:#1e1e1e;color:#ccc;border:1px solid #555;border-radius:4px;font-size:14px">
                    <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
                        <button onclick="document.getElementById('${modalId}').classList.remove('visible')" style="padding:4px 14px;cursor:pointer">${this.t('Cancel')}</button>
                        <button id="rename-tab-ok" style="padding:4px 14px;cursor:pointer;background:#4a9eff;color:#fff;border:none;border-radius:4px">OK</button>
                    </div>
                </div>
            </div>`;
            document.body.appendChild(modal);
        }

        const input = document.getElementById('rename-tab-input');
        let displayName = tab.name || '';
        if (displayName.endsWith('.promptsbt')) {
            displayName = displayName.slice(0, -10);
        }
        input.value = displayName;
        modal.classList.add('visible');
        setTimeout(() => { input.focus(); input.select(); }, 50);

        const ok = document.getElementById('rename-tab-ok');
        const commit = () => {
            const newName = input.value.trim();
            if (newName !== '') {
                modal.classList.remove('visible');
                this.renameTab(index, newName);
            }
        };
        ok.onclick = commit;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') modal.classList.remove('visible');
        };
    },

    tabCtxDuplicate(index) {
        const tab = this.state.tabs[index];
        if (!tab) return;
        
        let baseName = tab.name;
        if (baseName.endsWith('.promptsbt')) {
            baseName = baseName.substring(0, baseName.length - '.promptsbt'.length);
        }
        let copyName = baseName + '_copy';
        let fileName = copyName + '.promptsbt';
        
        const rootNode = JSON.parse(JSON.stringify(tab.root || { title: '', content: '', mimetype: 'text/plain', attachments: [], children: [], nodeType: 'root' }));
        
        this.state.tabs.push({ name: fileName, file: fileName, root: rootNode });
        this.state.activeTab = this.state.tabs.length - 1;
        this.state.currentNodePath = '';

        this.postMessage({ type: 'save_node', payload: { tabFile: fileName, root: rootNode } });
        this.postMessage({ type: 'save_session', payload: {
            tabs: this.state.tabs.map(t => ({ name: t.name, file: t.file }))
        }});

        this.renderTabs();
        this.renderTree();
        this.renderList();
        this.addLog('📋 Tab duplicated');
    },

    treeCtxAddOutputToInput(dataPath) {
        const dataNode = this.getNodeByPath(dataPath);
        const opNode   = this.getNodeByPath(this.state.selectedOpPath);
        if (dataNode && opNode) {
            let outputText = dataNode.content ? (() => { try { return atob(dataNode.content); } catch { return dataNode.content; } })() : '';
            let outputFiles = [];

            if (dataNode.pipelineMeta) {
                try {
                    const meta = JSON.parse(dataNode.pipelineMeta);
                    if (meta && meta.steps && meta.steps.length > 0) {
                        const lastStep = meta.steps[meta.steps.length - 1];
                        outputText = lastStep.output || outputText;
                        outputFiles = lastStep.outputAttachments || [];
                    }
                } catch(e) {
                    this.addLog(`Pipeline Metadata Parse Error\nOperation: treeCtxAddOutputToInput\nData Node: ${dataNode.title || 'unknown'}\nOp Node: ${opNode.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`);
                }
            }

            if (!opNode.tempInputAttachments) {
                opNode.tempInputAttachments = { text: '', files: [] };
            }
            if (outputText) {
                if (opNode.tempInputAttachments.text) {
                    opNode.tempInputAttachments.text += '\n' + outputText;
                } else {
                    opNode.tempInputAttachments.text = outputText;
                }
            }
            if (outputFiles && outputFiles.length > 0) {
                if (!opNode.tempInputAttachments.files) {
                    opNode.tempInputAttachments.files = [];
                }
                outputFiles.forEach(f => {
                    if (!opNode.tempInputAttachments.files.some(existing => existing.file === f.file)) {
                        opNode.tempInputAttachments.files.push(f);
                    }
                });
            }
            this.saveCurrentTab();
            this.renderInput();
        }
    },

    treeCtxAddChild(path) {
        const node = this.getNodeByPath(path);
        if (!node) return;
        if (!node.children) node.children = [];
        node.children.push({ title: '', content: '', mimetype: 'text/plain', attachments: [], children: [], nodeType: 'assemble' });
        this.state.collapsedPaths.delete(path);
        this.state.currentNodePath = path + '/' + (node.children.length - 1);
        this.renderTree();
        this.renderList();
        this.loadEditor(this.state.currentNodePath);
        this.saveCurrentTab();
        this.addLog('➕ ' + this.t('ChildNodeAdded'));
    },

    treeCtxAddPlaceholder(path) {
        const node = this.getNodeByPath(path);
        if (!node) return;
        if (!node.children) node.children = [];
        const name = this.state.placeholderArchiveName || 'archive';
        if (name.includes('/')) {
            alert('Slash character "/" is not allowed in placeholder names.');
            return;
        }
        const placeholder = { title: this.safeB64(name), nodeType: 'placeholder', children: [] };
        node.children.push(placeholder);
        this.state.collapsedPaths.delete(path);
        this.state.currentNodePath = path + '/' + (node.children.length - 1);
        this.renderTree();
        this.saveCurrentTab();
        this.addLog('📁 ' + this.t('PlaceholderAdded'));
    },

    treeCtxAddOutputsToInput(dataPaths) {
        const opNode = this.getNodeByPath(this.state.selectedOpPath);
        if (!opNode) return;
        if (!opNode.tempInputAttachments) {
            opNode.tempInputAttachments = { text: '', files: [] };
        }
        for (const dp of dataPaths) {
            const dataNode = this.getNodeByPath(dp);
            if (!dataNode) continue;
            let outputText = dataNode.content ? (() => { try { return atob(dataNode.content); } catch { return dataNode.content; } })() : '';
            let outputFiles = [];
            if (dataNode.pipelineMeta) {
                try {
                    const meta = JSON.parse(dataNode.pipelineMeta);
                    if (meta && meta.steps && meta.steps.length > 0) {
                        const lastStep = meta.steps[meta.steps.length - 1];
                        outputText = lastStep.output || outputText;
                        outputFiles = lastStep.outputAttachments || [];
                    }
                } catch(e) {
                    this.addLog(`Pipeline Metadata Parse Error\nOperation: treeCtxAddOutputsToInput\nData Node: ${dataNode.title || 'unknown'}\nOp Node: ${opNode.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`);
                }
            }
            if (outputText) {
                if (opNode.tempInputAttachments.text) {
                    opNode.tempInputAttachments.text += '\n' + outputText;
                } else {
                    opNode.tempInputAttachments.text = outputText;
                }
            }
            if (outputFiles && outputFiles.length > 0) {
                outputFiles.forEach(f => {
                    if (!opNode.tempInputAttachments.files.some(existing => existing.file === f.file)) {
                        opNode.tempInputAttachments.files.push(f);
                    }
                });
            }
        }
        this.saveCurrentTab();
        this.renderInput();
        this.addLog('📥 ' + this.t('OutputsAdded') + ' (' + dataPaths.length + ' ' + this.t('Nodes') + ')');
    },

    treeCtxDeleteMultiple(paths) {
        const count = paths.length;
        if (!confirm(this.t('Delete') + ' ' + count + ' ' + this.t('Nodes') + '?')) return;
        const tab = this.state.tabs[this.state.activeTab];
        if (!tab || !tab.root) return;
        const grouped = {};
        for (const p of paths) {
            const parts = p.split('/').filter(p => p !== '');
            if (parts.length === 0) continue;
            const idx = parseInt(parts[parts.length - 1]);
            const parentPath = parts.slice(0, -1).join('/');
            if (!grouped[parentPath]) grouped[parentPath] = [];
            grouped[parentPath].push(idx);
        }
        for (const parentPath of Object.keys(grouped)) {
            const indices = grouped[parentPath].sort((a, b) => b - a);
            const parent = this.getNodeByPath(parentPath ? '/' + parentPath : '');
            if (parent && parent.children) {
                for (const idx of indices) {
                    if (idx < parent.children.length) {
                        parent.children.splice(idx, 1);
                    }
                }
            }
        }
        this.state.selectedDataPaths = [];
        this.state.selectedDataPath = '';
        this.renderTree();
        this.renderList();
        this.saveCurrentTab();
        this.addLog('🗑 ' + this.t('NodesDeleted') + ' (' + count + ')');
    },

    treeDragStart(event, path) {
        const node = this.getNodeByPath(path);
        if (!node || !this.isDataNodePath(path)) { event.preventDefault(); return; }
        const paths = this.state.selectedDataPaths && this.state.selectedDataPaths.length > 0
            && this.state.selectedDataPaths.includes(path)
            ? this.state.selectedDataPaths
            : [path];
        event.dataTransfer.setData('text/plain', JSON.stringify(paths));
        event.dataTransfer.effectAllowed = 'move';
    },

    treeDragOver(event, path) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const el = this.getDOMElementForPath(path);
        if (el && !el.classList.contains('drag-over')) {
            el.classList.add('drag-over');
        }
    },

    treeDragLeave(event, path) {
        const el = this.getDOMElementForPath(path);
        if (el) {
            el.classList.remove('drag-over');
        }
    },

    treeDrop(event, targetPath) {
        event.preventDefault();
        const el = this.getDOMElementForPath(targetPath);
        if (el) el.classList.remove('drag-over');

        const raw = event.dataTransfer.getData('text/plain');
        if (!raw) return;
        let dragPaths;
        try { dragPaths = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(dragPaths) || dragPaths.length === 0) return;

        const targetNode = this.getNodeByPath(targetPath);
        if (!targetNode || targetNode.nodeType !== 'placeholder') return;

        const nodesToMove = [];
        for (const dp of dragPaths) {
            if (dp === targetPath) continue;
            const dragNode = this.getNodeByPath(dp);
            if (!dragNode || !this.isDataNodePath(dp)) continue;
            nodesToMove.push({ path: dp, node: dragNode });
        }
        if (nodesToMove.length === 0) return;

        const grouped = {};
        for (const { path: dp } of nodesToMove) {
            const dpParts = dp.split('/').filter(p => p !== '');
            const dpIdx = parseInt(dpParts[dpParts.length - 1]);
            const dpParentPath = dpParts.slice(0, -1).join('/');
            if (!grouped[dpParentPath]) grouped[dpParentPath] = [];
            grouped[dpParentPath].push({ idx: dpIdx, dp });
        }
        for (const parentPath of Object.keys(grouped)) {
            const entries = grouped[parentPath].sort((a, b) => b.idx - a.idx);
            const parent = this.getNodeByPath(parentPath ? '/' + parentPath : '');
            if (parent && parent.children) {
                for (const { idx } of entries) {
                    if (idx < parent.children.length) {
                        parent.children.splice(idx, 1);
                    }
                }
            }
        }

        if (!targetNode.children) targetNode.children = [];
        for (const { node } of nodesToMove) {
            targetNode.children.push(node);
        }

        if (this.state.selectedDataPath && dragPaths.includes(this.state.selectedDataPath)) {
            if (!nodesToMove.some(n => n.path === this.state.selectedDataPath)) {
                // keep it
            } else {
                this.state.selectedDataPath = '';
            }
        }
        this.state.selectedDataPaths = [];

        this.renderTree();
        this.saveCurrentTab();
        this.addLog('📦 ' + this.t('DataNodesMoved'));
    },

    treeCtxAddSibling(path) {
        const parts = path.split('/').filter(p => p !== '');
        if (parts.length === 0) return;
        const idx = parseInt(parts[parts.length - 1]);
        const parentPath = parts.slice(0, -1).join('/');
        const parent = this.getNodeByPath(parentPath ? '/' + parentPath : '');
        if (!parent || !parent.children) return;
        parent.children.splice(idx + 1, 0, { title: '', content: '', mimetype: 'text/plain', attachments: [], children: [], nodeType: 'assemble' });
        const newPath = (parentPath ? '/' + parentPath : '') + '/' + (idx + 1);
        this.state.currentNodePath = newPath;
        this.renderTree();
        this.renderList();
        this.loadEditor(this.state.currentNodePath);
        this.saveCurrentTab();
        this.addLog('➕ ' + this.t('SiblingNodeAdded'));
    },

    treeCtxDelete(path) {
        const parts = path.split('/').filter(p => p !== '');
        if (parts.length === 0) return;
        const idx = parseInt(parts[parts.length - 1]);
        const parentPath = parts.slice(0, -1).join('/');
        const parent = this.getNodeByPath(parentPath ? '/' + parentPath : '');
        if (!parent || !parent.children || idx >= parent.children.length) return;
        if (!confirm(this.t('DeleteThisNode'))) return;
        parent.children.splice(idx, 1);
        this.state.currentNodePath = parentPath ? '/' + parentPath : '';
        this.renderTree();
        this.renderList();
        this.loadEditor(this.state.currentNodePath);
        this.saveCurrentTab();
        this.addLog('🗑 ' + this.t('NodeDeleted'));
    },

    treeCtxMoveUp(path) {
        const parts = path.split('/').filter(p => p !== '');
        if (parts.length === 0) return;
        const idx = parseInt(parts[parts.length - 1]);
        if (idx === 0) return;
        const parentPath = parts.slice(0, -1).join('/');
        const parent = this.getNodeByPath(parentPath ? '/' + parentPath : '');
        if (!parent || !parent.children) return;
        [parent.children[idx - 1], parent.children[idx]] = [parent.children[idx], parent.children[idx - 1]];
        const newPath = (parentPath ? '/' + parentPath : '') + '/' + (idx - 1);
        this.state.currentNodePath = newPath;
        this.renderTree();
        this.renderList();
        this.saveCurrentTab();
        this.addLog('⬆ ' + this.t('NodeMovedUp'));
    },

    treeCtxMoveDown(path) {
        const parts = path.split('/').filter(p => p !== '');
        if (parts.length === 0) return;
        const idx = parseInt(parts[parts.length - 1]);
        const parentPath = parts.slice(0, -1).join('/');
        const parent = this.getNodeByPath(parentPath ? '/' + parentPath : '');
        if (!parent || !parent.children || idx >= parent.children.length - 1) return;
        [parent.children[idx], parent.children[idx + 1]] = [parent.children[idx + 1], parent.children[idx]];
        const newPath = (parentPath ? '/' + parentPath : '') + '/' + (idx + 1);
        this.state.currentNodePath = newPath;
        this.renderTree();
        this.renderList();
        this.saveCurrentTab();
        this.addLog('⬇ ' + this.t('NodeMovedDown'));
    },

    treeCtxRename(path) {
        const node = this.getNodeByPath(path);
        if (!node) return;
        const current = node.title ? this.safeAtob(node.title) : '';

        const modalId = 'rename-node-modal';
        let modal = document.getElementById(modalId);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'modal';
            modal.innerHTML = `<div class="modal-content" style="max-width:400px">
                <span class="modal-close" onclick="document.getElementById('${modalId}').classList.remove('visible')">&times;</span>
                <div class="modal-body">
                    <p style="margin:0 0 8px">${this.t('EnterNodeName')}</p>
                    <input id="rename-node-input" type="text" style="width:100%;box-sizing:border-box;padding:6px 8px;background:#1e1e1e;color:#ccc;border:1px solid #555;border-radius:4px;font-size:14px">
                    <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
                        <button onclick="document.getElementById('${modalId}').classList.remove('visible')" style="padding:4px 14px;cursor:pointer">${this.t('Cancel')}</button>
                        <button id="rename-node-ok" style="padding:4px 14px;cursor:pointer;background:#4a9eff;color:#fff;border:none;border-radius:4px">OK</button>
                    </div>
                </div>
            </div>`;
            document.body.appendChild(modal);
        }

        const input = document.getElementById('rename-node-input');
        input.value = current;
        modal.classList.add('visible');
        setTimeout(() => { input.focus(); input.select(); }, 50);

        const ok = document.getElementById('rename-node-ok');
        const commit = () => {
            const newName = input.value;
            modal.classList.remove('visible');
            node.title = this.safeB64(newName);
            this.renderTree();
            this.renderList();
            this.loadEditor(path);
            this.saveCurrentTab();
            this.addLog('✏️ ' + this.t('NodeRenamed'));
        };
        ok.onclick = commit;
        input.onkeydown = (e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') modal.classList.remove('visible'); };
    },

    // ── Behavior Tree ─────────────────────────────────────────────────────────

    treeCtxSetBtType(path, btType) {
        const node = this.getNodeByPath(path);
        if (!node || (node.nodeType !== 'assemble' && node.nodeType !== 'root')) return;
        if (btType === 'leaf') delete node.btType;
        else node.btType = btType;
        this.renderTree();
        this.saveCurrentTab();
        this.addLog(`🌳 ${this.t('BTTypeSetTo').replace('{type}', btType)}`);
    },

    treeCtxSetCustomBtType(path) {
        const modal = document.getElementById('bt-custom-type-modal');
        if (!modal) return;
        modal.dataset.path = path;

        const node = this.getNodeByPath(path);
        const existing = node ? (node.btType || '') : '';
        const parts = existing ? existing.split('+') : [];
        const existingDecos = parts.length > 1 ? parts.slice(0, -1) : [];
        const existingComp = parts.length > 1 ? parts[parts.length - 1] : '';

        // Build decorator toggles
        const decoContainer = document.getElementById('bt-dec-toggles');
        const _allDecos = ['invert', 'repeater', 'retry', 'alwaysSucceed', 'alwaysFail', 'guard', 'delay', 'maxTime'];
        const _decoLabels = {'invert':'🔄Invert','repeater':'🔁Repeat','retry':'🔂Retry','alwaysSucceed':'✅AlwaysOK','alwaysFail':'❌AlwaysFail','guard':'🛡️Guard','delay':'⏳Delay','maxTime':'⏰MaxTime'};
        decoContainer.innerHTML = _allDecos.map(d =>
            `<button class="bt-type-toggle${existingDecos.includes(d)?' active':''}" data-type="${d}" onclick="app.btToggleDeco(this)">${_decoLabels[d]}</button>`
        ).join('');

        // Build composite toggles (radio-style: only one active)
        const compContainer = document.getElementById('bt-comp-toggles');
        const _allComps = ['sequence', 'selector', 'parallel', 'memSequence', 'memSelector'];
        const _compLabels = {'sequence':'➡️Seq','selector':'🔀Sel','parallel':'⚡Par','memSequence':'📋➡️MemSeq','memSelector':'📋🔀MemSel'};
        compContainer.innerHTML = _allComps.map(c =>
            `<button class="bt-type-toggle bt-comp-toggle${c === (existingComp || 'sequence')?' active':''}" data-type="${c}" onclick="app.btToggleComp(this)">${_compLabels[c]}</button>`
        ).join('');

        this._updateBtTypePreview();
        modal.classList.add('visible');
    },

    btToggleDeco(btn) {
        btn.classList.toggle('active');
        this._updateBtTypePreview();
    },

    btToggleComp(btn) {
        document.querySelectorAll('.bt-comp-toggle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._updateBtTypePreview();
    },

    _updateBtTypePreview() {
        const activeDecos = [...document.querySelectorAll('#bt-dec-toggles .bt-type-toggle.active')].map(b => b.dataset.type);
        const activeComp = document.querySelector('#bt-comp-toggles .bt-type-toggle.active');
        const comp = activeComp ? activeComp.dataset.type : 'sequence';
        const parts = activeDecos.length > 0 ? [...activeDecos, comp] : [comp];
        const preview = document.getElementById('bt-custom-type-preview');
        if (preview) preview.textContent = parts.join(' + ');
    },

    btCustomTypeConfirm() {
        const modal = document.getElementById('bt-custom-type-modal');
        if (!modal) return;
        const path = modal.dataset.path;
        const activeDecos = [...document.querySelectorAll('#bt-dec-toggles .bt-type-toggle.active')].map(b => b.dataset.type);
        const activeComp = document.querySelector('#bt-comp-toggles .bt-type-toggle.active');
        const comp = activeComp ? activeComp.dataset.type : 'sequence';
        const typeStr = activeDecos.length > 0 ? [...activeDecos, comp].join('+') : comp;
        modal.classList.remove('visible');
        if (typeStr) this.treeCtxSetBtType(path, typeStr);
    },

    btCustomTypeCancel() {
        const modal = document.getElementById('bt-custom-type-modal');
        if (modal) modal.classList.remove('visible');
    },

    // ── BT Toolbar Controls (delegates to BehaviorTreeEngine in bt.js) ──────────────

    btCtrlSetTarget(path) { this._bt.setTarget(path); },
    btCtrlRun()           { if (this.state.btLocked) { this.addLog('🔒 ' + this.t('ExecutionLocked')); return; } this._bt.run(); },
    btCtrlStep()          { if (this.state.btLocked) { this.addLog('🔒 ' + this.t('ExecutionLocked')); return; } this._bt.step(); },
    btCtrlPause()         { this._bt.pause(); },
    btCtrlStop()          { this._bt.stop(); },
    btCtrlToggleLock() {
        this.state.btLocked = !this.state.btLocked;
        const btn = document.getElementById('btn-bt-lock');
        if (btn) {
            btn.textContent = this.state.btLocked ? '🔒' : '🔓';
            btn.classList.toggle('locked', this.state.btLocked);
            btn.title = this.state.btLocked ? 'Execution locked (click to unlock)' : 'Execution lock (blocks all execution when ON)';
        }
        this.addLog(this.state.btLocked ? '🔒 ' + this.t('ExecutionLockOn') : '🔓 ' + this.t('ExecutionLockOff'));
    },

    saveBtNodeConfig() {
        let node = this.getNodeByPath(this.state.currentNodePath);
        if (!node) return;
        if (node.nodeType === 'data' && node.originalOpNode) node = node.originalOpNode;
        const promptRaw = document.getElementById('bt-node-prompt')?.value || '';
        node.btPrompt    = promptRaw ? btoa(promptRaw) : '';
        node.btInputKey  = (document.getElementById('bt-input-key')?.value  || '').trim();
        node.btInputType = document.getElementById('bt-input-type')?.value  || 'text';
        node.btOutputKey = (document.getElementById('bt-output-key')?.value || '').trim();
        node.btAction = document.getElementById('bt-action')?.value || 'processPrompt';
        node.btLocalFilePath = (document.getElementById('bt-local-file-path')?.value || '').trim();
        this.saveCurrentTab();
        this.renderPrompt();
        this.addLog('💾 ' + this.t('BTSettingsSaved'));
    },

    onBtActionChange() {
        const action = document.getElementById('bt-action')?.value || 'processPrompt';
        const promptFields = document.getElementById('bt-prompt-fields');
        const localFileField = document.getElementById('bt-local-file-field');
        if (promptFields) promptFields.style.display = action === 'processPrompt' ? 'block' : 'none';
        if (localFileField) localFileField.style.display = action === 'loadLocalFile' ? 'block' : 'none';
    },

    btBlackboardDialog() {
        const modal = document.getElementById('bt-bb-modal');
        if (!modal) return;
        this._renderBbDialog();
        modal.style.display = 'flex';
    },

    btBbClose() {
        const modal = document.getElementById('bt-bb-modal');
        if (modal) modal.style.display = 'none';
    },

    _renderBbDialog() {
        const bb   = this._bt ? this._bt.getBlackboard() : {};
        const keys = Object.keys(bb);
        const body = document.getElementById('bt-bb-body');
        if (!body) return;

        if (keys.length === 0) {
            body.innerHTML = `<div class="bt-bb-empty">${this.t('BlackboardEmpty')}</div>`;
        } else {
            body.innerHTML = keys.map(key => {
                const slot  = bb[key] || {};
                const hasText  = slot.text  != null;
                const hasMedia = slot.media && slot.media.length > 0;
                const textPreview = hasText
                    ? `<div class="bt-bb-text-preview">${this.escapeHtml(String(slot.text).slice(0, 200))}${slot.text.length > 200 ? '…' : ''}</div>`
                    : '';
                const mediaThumbs = hasMedia
                    ? `<div class="bt-bb-media-row">${slot.media.map((m, i) => {
                        const isImg = (m.mimetype||'').startsWith('image/');
                        return isImg && m.content
                            ? `<img class="bt-bb-thumb" src="data:${m.mimetype};base64,${m.content}" title="${this.escapeHtml(m.file||'')}">`
                            : `<span class="bt-bb-file-tag">📎 ${this.escapeHtml(m.file||m.mimetype||'file')}</span>`;
                      }).join('')}</div>`
                    : '';
                return `<div class="bt-bb-row">
                    <div class="bt-bb-row-header">
                        <span class="bt-bb-key">"${this.escapeHtml(key)}"</span>
                        <span class="bt-bb-types">${hasText ? '<span class="bt-bb-type-badge">text</span>' : ''}${hasMedia ? '<span class="bt-bb-type-badge media">media</span>' : ''}</span>
                        <div class="bt-bb-row-actions">
                            <button class="copy-btn" onclick="app._btBbEditText('${this.escapeHtml(key)}')" title="${this.t('EditText')}">✏️</button>
                            <button class="copy-btn" onclick="app._btBbUploadMedia('${this.escapeHtml(key)}')" title="${this.t('UploadMedia')}">📎</button>
                            <button class="copy-btn" onclick="app._btBbClearKey('${this.escapeHtml(key)}')" title="${this.t('Delete')}">🗑</button>
                        </div>
                    </div>
                    ${textPreview}${mediaThumbs}
                </div>`;
            }).join('');
        }
    },

    _btBbEditText(key) {
        const bb   = this._bt ? this._bt.getBlackboard() : {};
        const slot = bb[key] || {};
        const current = slot.text != null ? slot.text : '';
        const val = prompt(this.t('EditBBText').replace('{key}', key), current);
        if (val === null) return;
        if (this._bt) this._bt.bbSetText(key, val);
        this._renderBbDialog();
    },

    _btBbUploadMedia(key) {
        this._btBbPendingMediaKey = key;
        this.postMessage({ type: 'open_file_dialog', payload: { filter: 'media', purpose: 'bt_bb_media' } });
    },

    _btBbClearKey(key) {
        if (!confirm(this.t('DeleteBBKey').replace('{key}', key))) return;
        if (this._bt) this._bt.bbClearKey(key);
        this._renderBbDialog();
    },

    _btBbAddNew() {
        const key = prompt(this.t('EnterVariableName'));
        if (!key || !key.trim()) return;
        if (this._bt) this._bt.bbSetText(key.trim(), '');
        this._renderBbDialog();
        this._btBbEditText(key.trim());
    },

    btConfigDialog() {
        const cfg = this._bt.getConfig();
        const modal = document.getElementById('bt-config-modal');
        const radios = modal.querySelectorAll('input[name="bt-exec-mode"]');
        radios.forEach(r => { r.checked = r.value === cfg.mode; });
        document.getElementById('bt-cfg-count').value = cfg.count;
        document.getElementById('bt-cfg-count-row').style.display = cfg.mode === 'cycle' ? 'flex' : 'none';
        modal.style.display = 'flex';
    },

    btConfigClose() {
        document.getElementById('bt-config-modal').style.display = 'none';
    },

    btConfigSave() {
        const modal = document.getElementById('bt-config-modal');
        const modeEl = modal.querySelector('input[name="bt-exec-mode"]:checked');
        const mode = modeEl ? modeEl.value : 'single';
        const count = parseInt(document.getElementById('bt-cfg-count').value) || 0;
        this._bt.setConfig({ mode, count });
        this.btConfigClose();
        const label = mode === 'single' ? this.t('SingleRun') : (count === 0 ? this.t('InfiniteLoop') : this.t('RepeatNTimes').replace('{count}', count));
        this.addLog(`⚙ ${this.t('BTExecutionSetting').replace('{label}', label)}`);
    },

    _btCfgModeChange(radio) {
        document.getElementById('bt-cfg-count-row').style.display =
            radio.value === 'cycle' ? 'flex' : 'none';
    },

    // kept for backward-compat / tests
    async runBehaviorTree(path) {
        this._bt.setTarget(path);
        this._bt.run();
    },

    saveCurrentTab() {
        const tab = this.state.tabs[this.state.activeTab];
        if (tab && tab.file && tab.root) {
            this.postMessage({ type: 'save_node', payload: { tabFile: tab.file, root: tab.root } });
        }
    },

    getTitleFallback(node) {
        if (node.title) return this.safeAtob(node.title);
        if (node.mimetype === 'text/plain' && node.content) {
            const text = this.safeAtob(node.content);
            const words = text.split(/\s+/).slice(0, 4).join(' ');
            return words + (words.length < text.length ? '...' : '');
        }
        if (node.mimetype === 'application/rtf') return '[RTF ' + (node.content ? Math.round(this.safeAtob(node.content).length / 1024) + 'KB' : '0B') + ']';
        if (node.mimetype.startsWith('image/')) return '[Image ' + (node.content ? Math.round(this.safeAtob(node.content).length / 1024) + 'KB' : '0B') + ']';
        if (node.mimetype === 'text/html') return '[HTML ' + (node.content ? this.safeAtob(node.content).length + ' chars' : '') + ']';
        return '(empty)';
    },

    // --- Navigation history ---
    pushNav() {
        const cur = { tabIndex: this.state.activeTab, path: this.state.currentNodePath };
        // Don't push duplicate of last entry
        const last = this.state.navHistory[this.state.navHistory.length - 1];
        if (last && last.tabIndex === cur.tabIndex && last.path === cur.path) return;
        this.state.navHistory.push(cur);
        if (this.state.navHistory.length > 100) this.state.navHistory.shift();
        this.state.navFuture = [];
        this.updateNavButtons();
    },

    navBack() {
        if (this.state.navHistory.length === 0) return;
        this.state.navFuture.push({ tabIndex: this.state.activeTab, path: this.state.currentNodePath });
        const entry = this.state.navHistory.pop();
        this.updateNavButtons();
        this.gotoNavEntry(entry);
    },

    navForward() {
        if (this.state.navFuture.length === 0) return;
        this.state.navHistory.push({ tabIndex: this.state.activeTab, path: this.state.currentNodePath });
        const entry = this.state.navFuture.pop();
        this.updateNavButtons();
        this.gotoNavEntry(entry);
    },

    gotoNavEntry(entry) {
        if (entry.tabIndex !== this.state.activeTab) {
            this.state.activeTab = entry.tabIndex;
            this.renderTabs();
            this.renderTree();
        }
        this.state.currentNodePath = entry.path;
        this.renderTree();
        this.renderList();
        this.loadEditor(entry.path);
    },

    updateNavButtons() {
        const back = document.getElementById('btn-nav-back');
        const fwd  = document.getElementById('btn-nav-fwd');
        if (back) back.disabled = this.state.navHistory.length === 0;
        if (fwd)  fwd.disabled  = this.state.navFuture.length  === 0;
    },
    // --- end navigation history ---

    _getPipelineNameFromAssembleNode(node) {
        if (!node) return '';
        if (node.pipelineMeta) {
            try {
                const meta = JSON.parse(node.pipelineMeta);
                if (meta && meta.pipelineName) return meta.pipelineName;
            } catch (e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: _getPipelineNameFromAssembleNode\nNode: ${node.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); }
            for (const child of node.children) {
                if (child.pipelineMeta) {
                    try {
                        const meta = JSON.parse(child.pipelineMeta);
                        if (meta && meta.pipelineName) return meta.pipelineName;
                    } catch (e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: _getPipelineNameFromAssembleNode\nChild Node: ${child.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); }
                }
                if (child.children) {
                    for (const gc of child.children) {
                        if (gc.pipelineMeta) {
                            try {
                                const meta = JSON.parse(gc.pipelineMeta);
                                if (meta && meta.pipelineName) return meta.pipelineName;
                            } catch (e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: _getPipelineNameFromAssembleNode\nGrandchild Node: ${gc.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); }
                        }
                    }
                }
            }
        }
        return '';
    },

    selectNode(path, event) {
        this.updateNode();
       this.addLog("Select Node" + path);
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            this.clearAllSpeakingStyles();
        }
        // Case B: switching nodes while pipeline has completed steps → warn user
        if (
            this.state.viewMode === 'pipeline' &&
            this.state.currentNodePath !== path &&
            this.state.pipelineRun.steps &&
            this.state.pipelineRun.steps.some(s => s.completed)
        ) {
            if (!confirm(this.t('ChangingLinkedData'))) {
                return;
            }
            // Reset pipeline runtime state completely
            this.state.pipelineRun = { running: false, steps: [], selectedStep: -1 };
        }
        this.pushNav();
        this.state.currentNodePath = path;
        this.state.selectedOutputRunIndex = 0;

        const node = this.getNodeByPath(path);
        if (node) {
            const isRoot = node.nodeType === 'root' || (!node.nodeType && path === '');
            const isProcessed = node.nodeType === 'placeholder' || (!node.nodeType && node.title && this.safeAtob(node.title) === 'Processed');

            if (isRoot || isProcessed) {
                this.state.selectedOpPath = '';
                this.state.selectedDataPath = '';
                this.state.selectedDataPaths = [];
            } else if (this.isDataNodePath(path)) {
                if (event && event.shiftKey) {
                    const idx = this.state.selectedDataPaths.indexOf(path);
                    if (idx >= 0) {
                        this.state.selectedDataPaths.splice(idx, 1);
                        if (this.state.selectedDataPath === path) {
                            this.state.selectedDataPath = this.state.selectedDataPaths.length > 0
                                ? this.state.selectedDataPaths[this.state.selectedDataPaths.length - 1]
                                : '';
                        }
                    } else {
                        this.state.selectedDataPaths.push(path);
                        this.state.selectedDataPath = path;
                    }
                } else {
                    this.state.selectedDataPaths = [];
                    if (this.state.selectedDataPath === path) {
                        this.state.selectedDataPath = '';
                    } else {
                        this.state.selectedDataPath = path;
                    }
                }
                this.state.selectedOpPath = '';
                this.state.selectedOutputRunIndex = 0;
            } else {
                if (this.state.selectedOpPath === path) {
                    this.state.selectedOpPath = '';
                } else {
                    this.state.selectedOpPath = path;
                }
                this.state.selectedDataPath = '';
                this.state.selectedDataPaths = [];
            }
        } else {
            this.state.selectedOpPath = '';
            this.state.selectedDataPath = '';
            this.state.selectedDataPaths = [];
        }

        this.renderTree();
        this.renderList();

        this.loadEditor(path);

        if (node && node.nodeType === 'assemble') {
            const pipelineName = this._getPipelineNameFromAssembleNode(node);
            this.state._historyFilter = pipelineName;
        }
    },

    // Evaluation badge HTML helper
    evalBadgeHtml(evaluation) {
        if (!evaluation) return '';
        const map = { ok: '👍', rejected: '👎', pinned: '📌' };
        const icon = map[evaluation] || '';
        return icon ? `<span class="eval-badge eval-badge-${evaluation}" title="${evaluation}">${icon}</span>` : '';
    },

    // Evaluation buttons for a node (inline in list/editor)
    evalButtonsHtml(nodePathOrId, type, currentEval) {
        const ev = e => JSON.stringify(e);
        return `<span class="eval-btns" onclick="event.stopPropagation()">
            <button class="eval-btn ${currentEval==='ok'?'active':''}" title="OK" onclick="app.evaluateItem(${ev(type)},${ev(nodePathOrId)},'ok'${currentEval==='ok'?',true':''})">👍</button>
            <button class="eval-btn ${currentEval==='rejected'?'active':''}" title="Reject" onclick="app.evaluateItem(${ev(type)},${ev(nodePathOrId)},'rejected'${currentEval==='rejected'?',true':''})">👎</button>
            <button class="eval-btn ${currentEval==='pinned'?'active':''}" title="Pin" onclick="app.evaluateItem(${ev(type)},${ev(nodePathOrId)},'pinned'${currentEval==='pinned'?',true':''})">📌</button>
        </span>`;
    },

    // Toggle evaluation (click active → clear)
    evaluateItem(type, id, evaluation, isActive) {
        const newEval = isActive ? '' : evaluation;
        if (type === 'node') {
            // id is "tabFile|nodePath"
            const [tabFile, nodePath] = id.split('|');
            // Update in-memory node
            const node = this.getNodeByPath(nodePath);
            if (node) {
                node.evaluation = newEval;
                node.evaluatedAt = new Date().toISOString();
                this.renderList();
                this.loadEditor(this.state.currentNodePath);
            }
            this.postMessage({ type: 'evaluate_node', payload: { nodeId: nodePath, tabFile, evaluation: newEval, note: '' } });
        } else if (type === 'step') {
            // id is "runId|stepIndex"
            const [runId, stepIdx] = id.split('|');
            this.postMessage({ type: 'evaluate_history_step', payload: { runId, stepIndex: parseInt(stepIdx), evaluation: newEval, note: '' } });
            // Update rendered detail view step badge
            const badge = document.querySelector(`[data-step-eval="${runId}-${stepIdx}"]`);
            if (badge) badge.className = `eval-badge eval-badge-${newEval}`;
        } else if (type === 'run') {
            this.postMessage({ type: 'evaluate_history_run', payload: { runId: id, evaluation: newEval } });
        }
    },

    onEvaluationSaved(payload) {
        const evalLabels = { ok: '👍 ' + this.t('OK'), rejected: '👎 ' + this.t('Rejected'), pinned: '📌 ' + this.t('Pinned'), '': this.t('EvaluationCleared') };
        this.addLog(`✅ ${this.t('EvaluationSaved').replace('{label}', evalLabels[payload.evaluation] || payload.evaluation)}`);
        this.renderList();
    },

    // List rendering
    renderList() {
        const el = document.getElementById('list-content');
        if (!el) {
            // New 5-pane layout: delegate to renderMainContent
            this.renderMainContent();
            return;
        }
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node || !node.children) { el.innerHTML = '<div class="empty">Select a node</div>'; return; }
        const tab = this.state.tabs[this.state.activeTab];
        const tabFile = tab ? tab.file : '';
        el.innerHTML = node.children.map((child, i) => {
            const display = this.escapeHtml(child.title ? this.safeAtob(child.title) : this.getTitleFallback(child));
            const childPath = (this.state.currentNodePath ? this.state.currentNodePath + '/' : '/') + i;
            const evalBadge = this.evalBadgeHtml(child.evaluation);
            const evalBtns = this.evalButtonsHtml(`${tabFile}|${childPath}`, 'node', child.evaluation || '');
            return `<div class="list-item ${child.evaluation ? 'has-eval eval-' + child.evaluation : ''}" ondblclick="app.copyItemText(${i})">
                <span class="list-item-title">${evalBadge}${display}</span>
                <span class="list-item-actions">
                    ${evalBtns}
                    <button class="copy-btn" onclick="app.copyItemText(${i})">📋</button>
                </span>
            </div>`;
        }).join('');
    },

    getNodeByPath(path) {
        const tab = this.state.tabs[this.state.activeTab];
        if (!tab || !tab.root) return null;
        if (!path) return tab.root;
        const parts = path.split('/').filter(p => p !== '');
        let node = tab.root;
        for (const p of parts) {
            const idx = parseInt(p);
            if (isNaN(idx) || !node.children || idx >= node.children.length) return null;
            node = node.children[idx];
        }
        return node;
    },

    buildLinkedSources(root) {
        return new Set();
    },

    resultNodeClass(childPath, currentResultNodePath, selectedDataPath, isLinkedSourceFn) {
        const link = selectedDataPath === childPath;
        const hist = isLinkedSourceFn(childPath);
        if (link) return 'selected-data';
        if (hist) return 'selected-linked';
        return '';
    },

    stepNodeClass(path, isSelected, currentNodePath, selectedDataPath, isLinkedSourceFn) {
        if (isSelected) {
            if (this.getParentTitle(path) === 'Processed') return 'selected-result';
            return 'selected-input';
        }
        if (isLinkedSourceFn(path)) return 'selected-linked';
        return '';
    },

    getParentTitle(path) {
        const parts = path.split('/').filter(p => p !== '');
        if (parts.length < 2) return '';
        const parentPath = parts.slice(0, -1).join('/');
        const parentNode = this.getNodeByPath(parentPath);
        if (!parentNode) return '';
        try { return parentNode.title ? atob(parentNode.title) : ''; } catch { return parentNode.title || ''; }
    },


    copyItemText(index) {
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node || !node.children || index >= node.children.length) return;
        const child = node.children[index];
        if (!child.content) return;
        const text = atob(child.content);
        navigator.clipboard.writeText(text).then(() => {
            this.addLog('📋 ' + this.t('Copied'));
        });
    },

    loadEditor(path) {
        const rawNode = this.getNodeByPath(path);
        if (rawNode) {
            let opNode = rawNode;
            if (rawNode.nodeType === 'data' && rawNode.originalOpNode) {
                opNode = rawNode.originalOpNode;
            }
            this.state.selectedRecipe = rawNode.selectedRecipe || opNode.selectedRecipe || '';
        } else {
            this.state.selectedRecipe = '';
        }
        this.updateRecipeBadge();

        this.renderPrompt();
        this.renderInput();
        this.renderOutput();
    },

    renderAttachments(node) {
        const el = document.getElementById('attachments-area');
        if (!el) return;
        if (!node.attachments || node.attachments.length === 0) {
            el.innerHTML = '<div class="empty">No attachments</div>';
            return;
        }
        el.innerHTML = node.attachments.map(a => {
            const name = a.file || a.id || 'attachment';
            return `<div class="list-item">
                <span>${a.mimetype}: ${name}${a.size ? ' (' + Math.round(a.size/1024) + 'KB)' : ''}</span>
                <button class="copy-btn" onclick="app.log('Preview')">👁</button>
            </div>`;
        }).join('');
    },

    updateNode() {
        const nodePath = this.state.selectedDataPath || this.state.selectedOpPath || this.state.currentNodePath;
        const node = this.getNodeByPath(nodePath);
        if (!node) return;
        const title = document.getElementById('node-title');
        const content = document.getElementById('node-content');
        if (title) node.title = this.safeB64(title.value);
        
        let targetNode = node;
        if (node.nodeType === 'data' && node.originalOpNode) {
            targetNode = node.originalOpNode;
        }
        if (content && targetNode.mimetype === 'text/plain') targetNode.content = this.safeB64(content.value);

        const inputTextArea = document.getElementById('input-textarea');
        if (inputTextArea && node.nodeType === 'data') {
            node.input = inputTextArea.value;
        }

        this.renderTree();
        this.renderList();
        const tab = this.state.tabs[this.state.activeTab];
        if (tab && tab.file && tab.root) {
            this.postMessage({ type: 'save_node', payload: { tabFile: tab.file, root: tab.root } });
        }
        this.addLog('💾 ' + this.t('NodeUpdated'));
    },

    processPrompt() {
        if (this.state.btLocked) {
            this.addLog('🔒 ' + this.t('ExecutionLockedPleaseUnlock'));
            return;
        }
        this.updateNode();

        if (this.state.viewMode === 'node') {
            const node = this.getNodeByPath(this.state.currentNodePath);
            if (!node) {
                this.addLog('⚠ ' + this.t('PleaseSelectNode'));
                return;
            }

            // Prioritize BT execution context if available
            const ctx = this.state.btRunContext;

            const prompt = (ctx?.prompt != null)
                ? ctx.prompt
                : (document.getElementById('node-content')?.value || '');

            const rawUserInput = (ctx?.bbTextInput != null)
                ? ctx.bbTextInput
                : (document.getElementById('input-textarea')?.value || '');

            const input = rawUserInput;

            // Resolve target (op) node and get its recipe
            let targetNode = node;
            if (node.nodeType === 'data' && node.originalOpNode) {
                targetNode = node.originalOpNode;
            }
            const recipeName = targetNode.selectedRecipe || this.state.selectedRecipe;
            const recipe = recipeName
                ? (this.state.recipes || []).find(r => r.name === recipeName) || this.getRecipeSettings()
                : this.getRecipeSettings();

            const tab = this.state.tabs[this.state.activeTab];
            const sentText = prompt.includes('{content}') ? prompt.replace('{content}', input) : (prompt + '\n\n' + input);

            this.state.streamedOutput = '';

            // BT media input: add media from blackboard to inputAttachments
            const bbMediaFiles = (ctx?.bbMediaInput) || [];

            const nodeTitle = node ? (node.title ? this.safeAtob(node.title) : this.getTitleFallback(node)) : 'Unknown Node';

            // Phase A: Pass requestId and targetNodePath for concurrent request routing
            const payload = {
                nodeId: this.state.currentNodePath || '',
                nodeTitle: nodeTitle,
                tabFile: tab ? tab.file : '',
                content: input,
                userPrompt: prompt,
                provider: recipe.provider,
                model: recipe.model,
                systemPrompt: recipe.systemPrompt,
                temperature: recipe.temperature,
                baseUrl: recipe.baseUrl || '',
                apiPath: recipe.apiPath || '',
                recipeName: recipeName || recipe.name || 'Default (Ad-hoc)',
                attachments: targetNode.attachments || [],        // machine-level (op pane)
                inputAttachments: [                               // belt-level (input pane) + BB media
                    ...(ctx ? [] : (node.tempInputAttachments ? node.tempInputAttachments.files : (node.inputAttachments || []))),
                    ...bbMediaFiles,
                ],
                customParams: recipe.customParams || {},
            };
            // Phase A: Include requestId and targetNodePath for concurrent routing
            if (ctx?.requestId) payload.requestId = ctx.requestId;
            if (ctx?.targetNodePath) payload.targetNodePath = ctx.targetNodePath;

            this.postMessage({
                type: 'run_prompt_process',
                payload,
            });
            this.state.pipelineRun.running = true;
            this.addLog(`▶ ${this.t('ProcessingPrompt').replace('{provider}', recipe.provider).replace('{model}', recipe.model || '(default)')}`);
            // After execution starts, attachments are saved to pending node (input is retained)
            const pendingInputFiles = node.tempInputAttachments ? node.tempInputAttachments.files : (node.inputAttachments || []);
            this.saveCurrentTab();

            // Create a placeholder Data node as execution history card
            const opPath = this.getLogicalOpPath(this.state.currentNodePath);
            const opNode = this.getNodeByPath(opPath);
            if (opNode) {
                if (!opNode.children) opNode.children = [];
                let target = opNode;
                if (opNode.placeholderName) {
                    let ph = opNode.children.find(c => c.nodeType === 'placeholder' || (!c.nodeType && c.title && this.safeAtob(c.title) === opNode.placeholderName));
                    if (!ph) {
                        ph = { title: this.safeB64(opNode.placeholderName), nodeType: 'placeholder', children: [] };
                        opNode.children.push(ph);
                    }
                    target = ph;
                } else {
                    const legacy = opNode.children.find(c => c.nodeType === 'placeholder' || (!c.nodeType && c.title && this.safeAtob(c.title) === 'Processed'));
                    if (legacy) target = legacy;
                }
                target.children.unshift({
                    title: this.safeB64(new Date().toISOString()),
                    content: this.safeB64(''),
                    attachments: [],
                    children: [],
                    pipelineMeta: JSON.stringify({
                        pipelineName: recipe.provider + '/' + (recipe.model || ''),
                        steps: [{ input: input, output: '' }]
                    }),
                    nodeType: 'data',
                    inputAttachments: pendingInputFiles,
                    _pending: true
                });
                this.saveCurrentTab();
                this.renderTree();
                this.renderList();
                this.state.selectedOutputRunIndex = 0;
                this.renderOutput();
            }
        } else {
            this.runPipeline();
            // Similarly clear after pipeline execution starts
            const pipeNode = this.getNodeByPath(this.state.currentNodePath);
            if (pipeNode) {
                delete pipeNode.tempInputAttachments;
                this.saveCurrentTab();
            }
        }
    },



    addChild() {
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node) return;
        if (!node.children) node.children = [];
        node.children.push({ title: '', content: '', mimetype: 'text/plain', attachments: [], children: [], nodeType: 'assemble' });
        this.renderTree();
        this.renderList();
        this.addLog('➕ ' + this.t('ChildAdded'));
    },

    addRootNode() {
        const tab = this.state.tabs[this.state.activeTab];
        if (!tab || !tab.root) return;
        if (!tab.root.children) tab.root.children = [];
        tab.root.children.push({ title: '', content: '', mimetype: 'text/plain', attachments: [], children: [], nodeType: 'assemble' });
        const newPath = String(tab.root.children.length - 1);
        this.state.currentNodePath = newPath;
        this.state.collapsedPaths.delete('');
        this.renderTree();
        this.renderList();
        this.loadEditor(newPath);
        this.saveCurrentTab();
        this.addLog('➕ ' + this.t('RootNodeAdded'));
    },

    removeNode() {
        const path = this.state.currentNodePath;
        if (!path) return;
        const parts = path.split('/').filter(p => p !== '');
        const parentPath = parts.slice(0, -1).join('/');
        const idx = parseInt(parts[parts.length - 1]);
        if (isNaN(idx)) return;
        const parent = this.getNodeByPath('/' + parentPath);
        if (!parent || !parent.children || idx >= parent.children.length) return;
        parent.children.splice(idx, 1);
        this.state.currentNodePath = '/' + parentPath;
        this.saveCurrentTab();
        this.renderTree();
        this.renderList();
        this.loadEditor(this.state.currentNodePath);
        this.addLog('🗑 ' + this.t('NodeRemoved'));
    },

    navRoot() {
        this.state.currentNodePath = '';
        this.renderTree();
        this.renderList();
        this.loadEditor('');
    },

    navUp() {
        const path = this.state.currentNodePath;
        if (!path || path === '/') return;
        const parts = path.split('/').filter(p => p !== '');
        parts.pop();
        this.state.currentNodePath = '/' + parts.join('/');
        this.renderTree();
        this.renderList();
        this.loadEditor(this.state.currentNodePath);
    },

    navDown() {
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node || !node.children || node.children.length === 0) return;
        this.state.currentNodePath = this.state.currentNodePath + '/' + 0;
        this.renderTree();
        this.renderList();
        this.loadEditor(this.state.currentNodePath);
    },

    // Pipeline
    exportPipeline() {
        const pipelines = this.state.pipelines || [];
        if (pipelines.length === 0) { this.addLog('⚠ ' + this.t('NoPipelinesToExport')); return; }
        const json = JSON.stringify(pipelines, null, 2);
        navigator.clipboard.writeText(json).then(() => {
            this.addLog(`📤 ${this.t('ExportedPipelines').replace('{count}', pipelines.length)}`);
        }).catch(() => {
            this.addLog('⚠ ' + this.t('FailedToCopyClipboard'));
        });
    },

    importPipeline() {
        this.postMessage({ type: 'open_file_dialog', payload: { filter: 'JSON|*.json', purpose: 'import_pipeline' } });
        this.addLog('📥 ' + this.t('PipelineImportSelectFile'));
    },

    onImportPipelineResult(payload) {
        if (!payload || !payload.attachments || payload.attachments.length === 0) return;
        const att = payload.attachments[0];
        if (!att.path) return;
        try {
            const jsonStr = atob(att.content);
            const pipelines = JSON.parse(jsonStr);
            if (Array.isArray(pipelines)) {
                pipelines.forEach(p => {
                    this.postMessage({ type: 'save_pipeline', payload: p });
                });
                this.addLog(`📥 ${this.t('ImportedPipelines').replace('{count}', pipelines.length)}`);
            } else if (pipelines && pipelines.name) {
                this.postMessage({ type: 'save_pipeline', payload: pipelines });
                this.addLog(`📥 ${this.t('ImportedPipeline').replace('{name}', pipelines.name)}`);
            } else {
                this.addLog('⚠ ' + this.t('InvalidPipelineFormat'));
            }
        } catch (e) {
            this.addLog(`Pipeline Import Error\nOperation: importPipeline\nError: ${e.message}\nAction: Verify the pipeline file is valid JSON and follows the expected format`);
        }
    },

    runPipeline(pipelineName) {
        if (this.state.pipelineRun.running) { this.addLog('⚠ ' + this.t('PipelineAlreadyRunning')); return; }
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node) { this.addLog('⚠ Please select a node'); return; }
        if (!pipelineName && node.pipelineMeta) {
            try {
                const meta = JSON.parse(node.pipelineMeta);
                if (meta && meta.pipelineName) {
                    pipelineName = meta.pipelineName;
                }
            } catch (e) {         this.addLog('⚠ ' + this.t('FailedToParsePipelineMeta').replace('{error}', e.message || '')); }
        }
        if (!pipelineName && this.state.pipelines && this.state.pipelines.length > 0) {
            pipelineName = this.state.pipelines[0].name;
        }
        if (!pipelineName) { this.addLog('⚠ ' + this.t('PipelineNotDefined')); return; }
        const content = node.content ? (() => { try { return decodeURIComponent(escape(atob(node.content))); } catch { return atob(node.content); } })() : '';
        const tab = this.state.tabs[this.state.activeTab];
        this.postMessage({ type: 'run_pipeline', payload: {
            pipelineName,
            nodeId:   this.state.currentNodePath || '',
            tabFile:  tab ? tab.file : '',
            content
        }});
        this.state.pipelineRun.running = true;
        this.state.outputTab = 'run';
        this.renderOutput();
        this.addLog(`▶ Pipeline "${pipelineName}" started`);
    },

    cancelPipeline() {
        this.postMessage({ type: 'cancel_pipeline' });
        this.state.pipelineRun.running = false;
        this.addLog('✕ ' + this.t('PipelineCanceled'));
    },

    toggleTestMode() {
        this.state.testMode = !this.state.testMode;
        document.getElementById('btn-test-mode').classList.toggle('active');
        this.addLog(this.state.testMode ? '🧪 Test mode ON' : '🧪 Test mode OFF');
    },

    // Messages
    addLog(text) {
        console.log('[Wend Log] ' + text);
        const el = document.getElementById('messages-content');
        if (!el) return;
        const div = document.createElement('div');
        div.className = 'log-entry';
        const ts = '[' + new Date().toLocaleTimeString() + '] ';
        if (text.includes('<details')) {
            div.innerHTML = ts + text.replace('<details', '<details open');
        } else {
            div.textContent = ts + text;
        }
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    },

    addHttpLog(info) {
        const el = document.getElementById('http-log-content');
        if (!el) return;
        // Auto-switch to HTTP tab on first log entry
        const logContent = document.getElementById('messages-content');
        if (logContent && logContent.style.display !== 'none') {
            this.switchMsgTab('http');
        }
        const div = document.createElement('div');
        div.className = 'log-entry';
        const ts = '[' + new Date().toLocaleTimeString() + ']';
        const statusText = info.statusCode ? (info.statusCode + (info.elapsedMs ? ` (${info.elapsedMs}ms)` : '')) : (info.error || 'error');
        const methodColor = info.method === 'POST' ? '#f0c040' : '#4ec9b0';
        const statusColor = info.statusCode >= 200 && info.statusCode < 300 ? '#4caf50' : '#f44';
        const isError = !info.statusCode || info.statusCode >= 400;
        
        div.innerHTML = `${ts} <span style="color:${methodColor}">${info.method}</span> <span style="color:#888">${this.escapeHtml(info.url)}</span> → <span style="color:${statusColor}">${statusText}</span>`;
        
        // Always create combined report for copying
        const aiReport = this._buildAIReport(info);
        const reportLabel = isError ? '⚠ Error' : '✓ Success';
        const reportColor = isError ? '#f88' : '#4caf50';
        
        div.innerHTML += `
            <div style="margin:4px 0 0 12px;padding:6px;background:#1a1a1a;border:1px solid #444;border-radius:3px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <span style="font-size:10px;color:${reportColor};font-weight:bold;">${reportLabel}</span>
                    <button onclick="app.copyForAI(this)" style="font-size:9px;padding:2px 6px;background:#2a2a2a;border:1px solid #555;border-radius:2px;color:#aaa;cursor:pointer;" data-ai-report="${this.escapeHtml(aiReport)}">📋 Copy</button>
                </div>
                <details style="margin:0;">
                    <summary style="cursor:pointer;color:#666;font-size:9px;padding:2px 0;">Show details</summary>
                    <pre style="margin:4px 0 0 0;padding:4px;background:#0a0a0a;border:1px solid #333;white-space:pre-wrap;font-size:10px;max-height:300px;overflow-y:auto;color:#ccc;">${this.escapeHtml(aiReport)}</pre>
                </details>
            </div>`;
        
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    },

    _buildAIReport(info) {
        let report = '';
        report += `${info.method} ${info.url}\n`;
        if (info.elapsedMs) report += `Elapsed: ${info.elapsedMs}ms\n`;
        report += `Status: ${info.statusCode || 'Error'}\n`;
        if (info.error) report += `Error: ${info.error}\n`;
        
        if (this.state.logHttpHeaders) {
            report += '\n--- Request Headers ---\n';
            if (info.requestHeaders) {
                for (const [key, value] of Object.entries(info.requestHeaders)) {
                    report += `${key}: ${value}\n`;
                }
            } else {
                report += '(none)\n';
            }
        }
        
        report += '\n--- Request Body ---\n';
        report += info.requestBody || '(empty)';
        
        if (this.state.logHttpHeaders) {
            report += '\n\n--- Response Headers ---\n';
            if (info.responseHeaders) {
                for (const [key, value] of Object.entries(info.responseHeaders)) {
                    report += `${key}: ${value}\n`;
                }
            } else {
                report += '(none)\n';
            }
        }
        
        report += '\n\n--- Response Body ---\n';
        report += info.responsePreview || '(empty)';
        return report;
    },

    copyForAI(button) {
        const report = button.getAttribute('data-ai-report');
        if (report) {
            navigator.clipboard.writeText(report).then(() => {
                const originalText = button.textContent;
                button.textContent = '✓ Copied!';
                button.style.color = '#4caf50';
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.color = '#aaa';
                }, 1500);
            }).catch(err => {
                console.error('Failed to copy:', err);
            });
        }
    },

    showError(msg) {
        this.addLog(`Pipeline Error\nOperation: showError\nError: ${msg}\nAction: Review the error details and check provider/recipe configuration`);
        this._stopRunTimer();
        this.state.pipelineRun.running = false;
        const si = this.state.pipelineRun.selectedStep;
        const step = this.state.pipelineRun.steps[si];
        if (step) {
            step.status = 'error';
            step.error = msg;
            step.completed = false;
        }
        this.renderOutput();
        if (this.state.viewMode === 'pipeline') {
            this.renderPipelineSteps();
        }
    },

    switchMsgTab(tab) {
        document.getElementById('messages-content').style.display = tab === 'log' ? '' : 'none';
        document.getElementById('http-log-content').style.display = tab === 'http' ? '' : 'none';
        document.getElementById('task-manager-content').style.display = tab === 'manager' ? '' : 'none';
        document.getElementById('msg-log-actions').style.display = tab === 'manager' ? 'none' : '';
        document.getElementById('msg-manager-actions').style.display = tab === 'manager' ? '' : 'none';
        document.querySelectorAll('.msg-tab').forEach(btn => {
            btn.classList.toggle('msg-tab-active', btn.dataset.tab === tab);
        });
        if (tab === 'manager') {
            this.startTaskMetricsPolling();
        } else {
            this.stopTaskMetricsPolling();
        }
    },

    // Log context menu and copy
    showLogContextMenu(event) {
        event.preventDefault();
        event.stopPropagation();
        const menu = document.getElementById('log-context-menu');
        if (!menu) return;
        const el = event.target.closest('.log-entry');
        const entryText = el ? el.textContent : '';
        const allText = this.getAllLogText();
        menu.innerHTML = `
            <div class="ctx-item" onclick="app.copyLogEntry(this.dataset.text);app.hideLogContextMenu()" data-text="${this.escapeHtml(entryText)}">📋 Copy Line</div>
            <div class="ctx-item" onclick="app.copyAllLogs();app.hideLogContextMenu()">📋 Copy All</div>
            <div class="ctx-sep"></div>
            <div class="ctx-item" onclick="app.clearLogs();app.hideLogContextMenu()">✕ Clear</div>
        `;
        menu.style.display = 'block';
        menu.style.left = Math.min(event.clientX, window.innerWidth - 160) + 'px';
        menu.style.top = Math.min(event.clientY, window.innerHeight - 120) + 'px';
    },

    hideLogContextMenu() {
        const menu = document.getElementById('log-context-menu');
        if (menu) menu.style.display = 'none';
    },

    renameNode(path, oldTitle) {
        const node = this.getNodeByPath(path);
        if (!node) return;
        const newTitle = prompt(this.t('RenameNode'), oldTitle);
        if (newTitle === null) return; // Cancelled
        const trimmed = newTitle.trim();
        if (trimmed === '') return;
        if (trimmed.includes('/')) {
            alert('Slash character "/" is not allowed in node names.');
            return;
        }
        
        const safeB64 = str => { try { return btoa(unescape(encodeURIComponent(str))); } catch { return btoa(str); } };
        node.title = safeB64(trimmed);
        
        this.renderTree();
        this.renderList();
        
        // Also refresh the prompt editor if the renamed node is the currently active one
        if (this.state.currentNodePath === path) {
            this.loadEditor(path);
        }
        
        const tab = this.state.tabs[this.state.activeTab];
        if (tab && tab.file && tab.root) {
            this.postMessage({ type: 'save_node', payload: { tabFile: tab.file, root: tab.root } });
        }
        this.addLog(`✏️ ${this.t('NodeRenamedTo').replace('{name}', trimmed)}`);
    },

    copyLogEntry(text) {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            this.addLog('📋 ' + this.t('LineCopied'));
        });
    },

    copyAllLogs() {
        const text = this.getAllLogText();
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            this.addLog('📋 ' + this.t('AllLogsCopied'));
        });
    },

    getAllLogText() {
        const el = document.getElementById('messages-content');
        if (!el) return '';
        return Array.from(el.querySelectorAll('.log-entry'))
            .map(div => div.textContent)
            .join('\n');
    },

    clearLogs() {
        const el = document.getElementById('messages-content');
        if (el) el.innerHTML = '';
    },

    // Search
    search(query) {
        clearTimeout(this.state.searchTimeout);
        if (query.length < 2) return;
        this.state.searchTimeout = setTimeout(() => {
            this.postMessage({ type: 'search', query, scope: 'all_tabs' });
        }, 300);
    },

    showSearchResults(results) {
        if (!results || results.length === 0) {
            this.addLog('🔍 ' + this.t('NoMatchesFound'));
            return;
        }
        this.addLog(`🔍 ${this.t('FoundMatches').replace('{count}', results.length)}`);
        (results || []).slice(0, 10).forEach(r => {
            this.addLog(`  ${r.title || r.excerpt || '(match)'}`);
        });
    },

    // Pipeline streaming
    appendStreamOutput(payload) {
        this.addLog(`[Step ${payload.stepIndex}] ${payload.text || '...'}`);
        this.state.streamedOutput = (this.state.streamedOutput || '') + (payload.text || '');

        // Update pending node's received content in the history card
        const opNodePath = this.getLogicalOpPath(this.state.selectedOpPath || this.state.currentNodePath);
        const opNode = this.getNodeByPath(opNodePath);
        if (opNode && opNode.children) {
            const container = this._dataContainer(opNode);
            if (container && container.children) {
                const pendingIdx = container.children.findIndex(c => c._pending);
                if (pendingIdx >= 0) {
                    const recvEl = document.getElementById(`linked-recv-${pendingIdx}`);
                    if (recvEl) {
                        const pre = recvEl.querySelector('.output-display');
                        if (pre) {
                            pre.textContent = this.state.streamedOutput;
                            pre.scrollTop = pre.scrollHeight;
                            return;
                        }
                    }
                }
            }
        }

        const streamEl = document.getElementById('output-run-container') || document.getElementById('output-content');
        if (streamEl) {
            let display = streamEl.querySelector('.output-display');
            if (!display) {
                streamEl.innerHTML = `
                    <div class="output-toolbar">
                        <span class="output-label">Processing Output...</span>
                    </div>
                    <details class="output-history-received-details" style="margin: 8px;">
                        <summary style="font-size: 10px; font-weight: bold; color: #858585; cursor: pointer; outline: none; user-select: none; border-bottom: 1px solid #333; padding-bottom: 2px;">📤 ${this.t('ReceivedOutput')}</summary>
                        <pre class="output-display" style="margin: 4px 0 0 0; background: #1e1e1e; border: 1px solid #2d2d2d; padding: 6px; font-family: monospace; white-space: pre-wrap; font-size: 11px; overflow-y: auto; max-height: 250px;"></pre>
                    </details>
                `;
                display = streamEl.querySelector('.output-display');
            }
            if (display) {
                const details = display.closest('details');
                if (details && !details.open) {
                    details.open = true;
                }
                display.textContent = this.state.streamedOutput;
                display.scrollTop = display.scrollHeight;
            }
        }
    },

    onPipelineInit(payload) {
        if (!payload || !Array.isArray(payload.steps)) return;
        this.state.pipelineRun.steps = payload.steps.map(s => ({
            ...s, completed: false, input: '', output: '', streamingOutput: '', status: 'pending', outputAttachments: [], artifacts: []
        }));
        this.state.pipelineRun.selectedStep = 0;
        if (this.state.viewMode === 'pipeline') {
            this.renderPipelineSteps();
            this.renderInput();
        }
    },

    onStepDone(payload) {
        this.addLog(`✅ Step ${payload.index} done` + (payload.tokens ? ` (${payload.tokens} tokens)` : ''));
        this._stopRunTimer();
        if (payload.status === 'completed') this.state.pipelineRun.running = false;
        // Store outputAttachments so next step's input pane can show them
        if (this.state.pipelineRun.steps.length > 0) {
            const step = this.state.pipelineRun.steps[payload.index];
            if (step) {
                step.completed = true;
                step.output = payload.output || '';
                step.outputAttachments = Array.isArray(payload.outputAttachments) ? payload.outputAttachments : [];
                if (this.state.viewMode === 'pipeline') {
                    this.renderPipelineSteps();
                    this.renderInput();
                    this.renderOutput();
                }
            }
        }
    },

    highlightStep(payload) {
        this.addLog(`▶ Step ${payload.index}: ${payload.name || ''}`);
        this.state.pipelineRun.selectedStep = payload.index;
        // Record step start time
        const step = this.state.pipelineRun.steps[payload.index];
        if (step) {
            step.status = 'running';
            step.startedAt = Date.now();
        }
        if (payload.index === 0) {
            this.state.streamedOutput = '';
            this.state.outputTab = 'run';
            this.renderOutput();
        }
        this._startRunTimer();
        if (this.state.viewMode === 'pipeline') {
            this.renderPipelineSteps();
            this.renderInput();
        }
    },

    _startRunTimer() {
        this._stopRunTimer();
        this._runTimer = setInterval(() => {
            const el = document.getElementById('run-elapsed');
            if (!el) { this._stopRunTimer(); return; }
            const si = this.state.pipelineRun.selectedStep;
            const step = this.state.pipelineRun.steps[si];
            if (!step || step.completed || !step.startedAt) { this._stopRunTimer(); return; }
            const sec = Math.floor((Date.now() - step.startedAt) / 1000);
            el.textContent = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
        }, 1000);
    },

    _stopRunTimer() {
        if (this._runTimer) { clearInterval(this._runTimer); this._runTimer = null; }
    },

    onRtfPosition(pos) {},

    // Modal
    showNodeProperties(path) {
        const node = this.getNodeByPath(path);
        if (!node) return;

        this._nodePropsPath = path;

        const safeAtob = s => { try { return atob(s); } catch { return s; } };
        const title = node.title ? this.safeAtob(node.title) : '(untitled)';
        const nt = node.nodeType || '(not set)';
        const btType = node.btType || '(none)';
        const btAction = node.btAction || '(none)';
        const childrenCount = node.children ? node.children.length : 0;
        const pathStr = path === '' ? '(root)' : path;

        let html = '';
        html += `<div style="margin-bottom:8px"><b>Path:</b> ${this.escapeHtml(pathStr)}</div>`;
        html += `<div style="margin-bottom:8px"><b>Title:</b> ${this.escapeHtml(title)}</div>`;
        html += `<div style="margin-bottom:8px"><b>Type:</b> ${this.escapeHtml(nt)}</div>`;
        html += `<div style="margin-bottom:8px"><b>btType:</b> ${this.escapeHtml(btType)}</div>`;
        html += `<div style="margin-bottom:8px"><b>btAction:</b> ${this.escapeHtml(btAction)}</div>`;
        html += `<div style="margin-bottom:8px"><b>Children:</b> ${childrenCount}</div>`;

        if (node.btInputKey) html += `<div style="margin-bottom:8px"><b>btInputKey:</b> ${this.escapeHtml(node.btInputKey)}</div>`;
        if (node.btInputType) html += `<div style="margin-bottom:8px"><b>btInputType:</b> ${this.escapeHtml(node.btInputType)}</div>`;
        if (node.btOutputKey) html += `<div style="margin-bottom:8px"><b>btOutputKey:</b> ${this.escapeHtml(node.btOutputKey)}</div>`;

        const btProps = ['btRepeatCount', 'btRetryCount', 'btTimeout', 'btDelay', 'btCondition', 'btExpectedValue', 'btNegate', 'btLocalFilePath'];
        for (const prop of btProps) {
            if (node[prop] !== undefined && node[prop] !== null && node[prop] !== '') {
                html += `<div style="margin-bottom:8px"><b>${prop}:</b> ${this.escapeHtml(String(node[prop]))}</div>`;
            }
        }

        if (node.btPrompt) {
            const decoded = safeAtob(node.btPrompt);
            const preview = decoded.length > 200 ? decoded.slice(0, 200) + '…' : decoded;
            html += `<div style="margin-bottom:8px"><b>btPrompt:</b><br><pre style="background:#252526;padding:4px 6px;border-radius:3px;margin:2px 0;white-space:pre-wrap;font-size:11px;max-height:120px;overflow-y:auto;">${this.escapeHtml(preview)}</pre></div>`;
        }

        if (node.content) {
            const decoded = safeAtob(node.content);
            const preview = decoded.length > 200 ? decoded.slice(0, 200) + '…' : decoded;
            html += `<div style="margin-bottom:8px"><b>Content:</b><br><pre style="background:#252526;padding:4px 6px;border-radius:3px;margin:2px 0;white-space:pre-wrap;font-size:11px;max-height:120px;overflow-y:auto;">${this.escapeHtml(preview)}</pre></div>`;
        }

        if (node.pipelineMeta) {
            html += `<div style="margin-bottom:8px"><b>PipelineMeta:</b><br><pre style="background:#252526;padding:4px 6px;border-radius:3px;margin:2px 0;white-space:pre-wrap;font-size:11px;max-height:80px;overflow-y:auto;">${this.escapeHtml(node.pipelineMeta)}</pre></div>`;
        }

        if (node.linkInfo) {
            html += `<div style="margin-bottom:8px"><b>LinkInfo:</b> ${this.escapeHtml(node.linkInfo)}</div>`;
        }

        if (node.attachments && node.attachments.length > 0) {
            html += `<div style="margin-bottom:8px"><b>Attachments:</b> ${node.attachments.length} file(s)</div>`;
        }

        // Editable placeholderName for assemble/root nodes
        if (node.nodeType === 'assemble' || node.nodeType === 'root') {
            const val = node.placeholderName || '';
            html += `<div style="margin-bottom:8px"><b>placeholderName:</b> <input id="np-placeholder-name" type="text" value="${this.escapeHtml(val)}" style="width:100%;background:var(--theme-bg);border:1px solid var(--theme-border);border-radius:3px;color:var(--theme-text);padding:3px 6px;font-size:12px;box-sizing:border-box;margin-top:2px" placeholder="(empty — output goes directly under this node)"></div>`;
            html += `<button onclick="app.saveNodeProperties()" style="background:var(--theme-accent);border:none;border-radius:3px;color:#fff;padding:4px 12px;cursor:pointer;font-size:12px;margin-top:4px">💾 Save</button>`;
        }

        const body = document.getElementById('node-props-body');
        if (body) body.innerHTML = html;

        const modal = document.getElementById('node-props-modal');
        if (modal) modal.classList.add('visible');
    },

    saveNodeProperties() {
        const path = this._nodePropsPath;
        if (!path) return;
        const node = this.getNodeByPath(path);
        if (!node) return;
        const input = document.getElementById('np-placeholder-name');
        if (input) {
            const val = input.value.trim();
            if (val) {
                if (val.includes('/')) {
                    alert('Slash character "/" is not allowed in placeholder names.');
                    return;
                }
                node.placeholderName = val;
            } else {
                delete node.placeholderName;
            }
        }
        const tab = this.state.tabs[this.state.activeTab];
        if (tab && tab.file && tab.root) {
            this.postMessage({ type: 'save_node', payload: { tabFile: tab.file, root: tab.root } });
        }
        this.renderTree();
        this.renderList();
        this.addLog('💾 ' + this.t('NodeProperties') + ' saved');
    },

    closeNodeProperties() {
        const modal = document.getElementById('node-props-modal');
        if (modal) modal.classList.remove('visible');
    },

    // Returns the node that should contain data children for an opNode.
    // If opNode has placeholderName set, returns (or creates) that placeholder child.
    // Falls back to legacy "Processed" placeholder detection, then to opNode itself.
    _dataContainer(opNode) {
        if (!opNode || !opNode.children) return opNode;
        if (opNode.placeholderName) {
            let ph = opNode.children.find(c => c.nodeType === 'placeholder' || (!c.nodeType && c.title && this.safeAtob(c.title) === opNode.placeholderName));
            if (!ph) {
                ph = { title: this.safeB64(opNode.placeholderName), nodeType: 'placeholder', children: [] };
                opNode.children.push(ph);
            }
            return ph;
        }
        const legacy = opNode.children.find(c => c.nodeType === 'placeholder' || (!c.nodeType && c.title && this.safeAtob(c.title) === 'Processed'));
        return legacy || opNode;
    },

    // Returns the path to the data container for an opNode
    _containerPath(opPath, opNode) {
        if (opNode && opNode.children) {
            const idx = opNode.children.findIndex(c => c === this._dataContainer(opNode));
            if (idx >= 0 && this._dataContainer(opNode) !== opNode) {
                return opPath + '/' + idx;
            }
        }
        return opPath;
    },

    showModal(id) {
        let modal = document.getElementById(id);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = id;
            modal.className = 'modal';
            modal.innerHTML = `<div class="modal-content">
                <span class="modal-close" onclick="this.parentElement.parentElement.classList.remove('visible')">&times;</span>
                <div class="modal-body"></div>
            </div>`;
            document.body.appendChild(modal);
        }
        modal.classList.add('visible');
    },

    log(msg) { this.addLog(msg); },

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('visible');
    },

    showModeMenu(event) {
        const t = key => this.t(key);
        const existing = document.getElementById('mode-menu');
        if (existing) { existing.remove(); return; }
        event.stopPropagation();

        const menu = document.createElement('div');
        menu.id = 'mode-menu';
        menu.className = 'mode-menu';
        menu.innerHTML = `
            <div class="mode-menu-item ${this.state.viewMode === 'node' ? 'active' : ''}" onclick="app.switchViewMode('node');this.closest('.mode-menu').remove()">
                📄 ${t('NodeView')}
            </div>
            <div class="mode-menu-item ${this.state.viewMode === 'pipeline' ? 'active' : ''}" onclick="app.switchViewMode('pipeline');this.closest('.mode-menu').remove()">
                🔧 ${t('PipelineView')}
            </div>`;

        const rect = event.target.getBoundingClientRect();
        menu.style.top = (rect.bottom + 2) + 'px';
        menu.style.left = rect.left + 'px';
        document.body.appendChild(menu);

        setTimeout(() => document.addEventListener('click', function close() {
            menu.remove();
            document.removeEventListener('click', close);
        }, { once: true }), 0);
    },

    switchViewMode(mode) {
        this.state.viewMode = mode;
        if (mode === 'pipeline') {
            // Switch tree to show pipeline steps
            this.renderPipelineSteps();
        } else {
            this.renderTree();
        }
        this.renderMainContent();
        this.addLog(`👁 View mode: ${mode}`);
    },

    renderPipelineSteps() {
        const el = document.getElementById('tree-content');
        if (!el) return;
        const steps = this.state.pipelineRun.steps || [];
        if (steps.length === 0) {
            el.innerHTML = '<div class="empty">No pipeline steps</div>';
            return;
        }
        el.innerHTML = steps.map((s, i) => `
            <div class="tree-node ${s.completed ? 'completed' : ''} ${this.state.pipelineRun.selectedStep === i ? 'selected' : ''}"
                 onclick="app.selectPipelineStep(${i})">
                ${s.completed ? '✔' : '○'} ${this.escapeHtml(s.name || s.type)}
            </div>
        `).join('');
    },

    selectPipelineStep(index) {
        this.state.viewMode = 'pipeline';
        this.state.pipelineRun.selectedStep = index;
        this.renderPipelineSteps();
        this.renderMainContent();
        document.getElementById('view-mode-selector').value = 'pipeline';
    },

    togglePane(id) {
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('collapsed');
            // Save pane states
            const states = JSON.parse(localStorage.getItem('prompts_panes') || '{}');
            states[id] = el.classList.contains('collapsed');
            localStorage.setItem('prompts_panes', JSON.stringify(states));
        }
    },

    initMessagesResizer() {
        const handle = document.getElementById('messages-resize-handle');
        const pane = document.getElementById('messages-pane');
        if (!handle || !pane) return;

        // Restore saved height
        const saved = localStorage.getItem('prompts_messages_height');
        if (saved) pane.style.height = saved + 'px';

        let isResizing = false;
        let startY, startHeight;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = pane.offsetHeight;
            handle.classList.add('active');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newHeight = startHeight - (e.clientY - startY);
            const clamped = Math.max(80, Math.min(600, newHeight));
            pane.style.height = clamped + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // Save height
            localStorage.setItem('prompts_messages_height', pane.offsetHeight);
        });
    },

    initPaneResizers() {
        const setupResizer = (handleId, paneId, storageKey, minW, maxW) => {
            const handle = document.getElementById(handleId);
            const pane = document.getElementById(paneId);
            if (!handle || !pane) return;

            // Restore saved width
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                pane.style.width = saved + 'px';
                pane.style.flex = '0 0 auto';
            }

            let isResizing = false;
            let startX, startWidth;

            handle.addEventListener('mousedown', (e) => {
                isResizing = true;
                startX = e.clientX;
                startWidth = pane.offsetWidth;
                pane.style.flex = '0 0 auto';
                pane.style.width = startWidth + 'px';
                handle.classList.add('active');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const newWidth = startWidth + (e.clientX - startX);
                const clamped = Math.max(minW, Math.min(maxW, newWidth));
                pane.style.width = clamped + 'px';
            });

            document.addEventListener('mouseup', () => {
                if (!isResizing) return;
                isResizing = false;
                handle.classList.remove('active');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                // Save width
                localStorage.setItem(storageKey, pane.offsetWidth);
            });
        };

        setupResizer('tree-resize-handle', 'tree-pane', 'prompts_tree_width', 120, 500);
        setupResizer('prompt-resize-handle', 'prompt-pane', 'prompts_prompt_width', 150, 800);
        setupResizer('input-resize-handle', 'input-pane', 'prompts_input_width', 150, 800);
    },

    initOutputResizer() {
        const handle = document.getElementById('output-resize-handle');
        const pane = document.getElementById('output-result-container');
        if (!handle || !pane) return;

        // Restore saved height
        const saved = localStorage.getItem('prompts_output_result_height');
        if (saved) pane.style.height = saved + 'px';

        let isResizing = false;
        let startY, startHeight;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = pane.offsetHeight;
            handle.classList.add('active');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newHeight = startHeight + (e.clientY - startY);
            const clamped = Math.max(50, Math.min(800, newHeight));
            pane.style.height = clamped + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // Save height
            localStorage.setItem('prompts_output_result_height', pane.offsetHeight);
        });
    },

    // ── Wizard ────────────────────────────────────────────────────
    get WIZARD_STEPS() {
        const ja = this.t('LangCode') === 'ja';
        return [
        {
            icon: '🚀',
            title: 'Quick Start — Run in 4 Steps',
            body: '<p style="font-size:13px;margin-bottom:12px"><b>Minimum steps to run AI in Wend:</b></p>' +
                  '<div style="background:#1a2a1a;border:1px solid #2a4a2a;border-radius:4px;padding:12px;margin-bottom:12px">' +
                  '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">' +
                  '<span style="background:#4caf50;color:#000;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;flex-shrink:0">1</span>' +
                  '<div style="flex:1"><b>Setup Provider</b><br><span style="font-size:11px;color:#aaa">⚙ Config → Providers tab, enter API key<br>Supports OpenAI / Anthropic / Gemini / Ollama</span>' +
                  '<br><button class="wizard-action-btn" style="display:inline-block;margin:6px 0 0" onclick="app.showConfig()">⚙ Open Providers</button></div>' +
                  '</div>' +
                  '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">' +
                  '<span style="background:#4caf50;color:#000;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;flex-shrink:0">2</span>' +
                  '<div style="flex:1"><b>Create Recipe</b><br><span style="font-size:11px;color:#aaa">⚙ Config → Recipes tab, set AI model, temperature, system prompt<br>Create 🤖 AI recipe or ⚙️ Command recipe</span>' +
                  '<br><button class="wizard-action-btn" style="display:inline-block;margin:6px 0 0" onclick="app.showRecipeManager()">🤖 Open Recipe Manager</button></div>' +
                  '</div>' +
                  '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">' +
                  '<span style="background:#4caf50;color:#000;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;flex-shrink:0">3</span>' +
                  '<div style="flex:1"><b>Add Node & Input</b><br><span style="font-size:11px;color:#aaa">Click ➕ in Tree pane to add an Op node<br>Edit prompt in Operation pane, input text/media in Input pane<br>Apply recipe with "Select..." button</span></div>' +
                  '</div>' +
                  '<div style="display:flex;align-items:flex-start;gap:12px">' +
                  '<span style="background:#4caf50;color:#000;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;flex-shrink:0">4</span>' +
                  '<div style="flex:1"><b>Run!</b><br><span style="font-size:11px;color:#aaa">Press <b>▶ Process</b> button in Operation pane<br>Results appear in Output pane, auto-saved as Data node</span></div>' +
                  '</div>' +
                  '</div>' +
                  '<p style="font-size:11px;color:#888;margin-top:8px">💡 This runs a single AI. Use Pipeline feature for multi-step execution.</p>' +
                  this._renderDemoSetupSection(),
            tips: [
                { icon: '⌨️', text: 'Press Ctrl+R to quickly open Recipe Manager.' },
                { icon: '🆓', text: 'Ollama runs locally, no API key needed.' }
            ]
        },
        {
            icon: '🔲',
            title: 'Pane Layout Guide',
            body: '<p>The screen has <b>Tree | Operation(op) | Input(src) | Output(dst)</b> panes + bottom Messages pane.</p>' +
                  '<p style="font-size:11px;color:#888;margin-top:4px">Follows GAS (GNU Assembler) operand order: <b>op src, dst</b>.</p>' +
                  '<ul style="font-size:12px;line-height:1.8">' +
                  '<li>📂 <b>Tree</b>: Node hierarchy and pipeline list</li>' +
                  '<li>🔧 <b>Operation (op)</b>: Prompt template and recipe settings</li>' +
                  '<li>📥 <b>Input (src)</b>: Text and media input to process</li>' +
                  '<li>📤 <b>Output (dst)</b>: Results and run history</li>' +
                  '</ul>',
            tips: [
                { icon: '↔️', text: 'Drag pane borders to resize.' },
                { icon: '📌', text: 'Click pane headers to collapse/expand.' }
            ]
        },
        {
            icon: '📄',
            title: 'How to Select Nodes',
            body: '<p>The tree has two types of nodes:</p>' +
                  '<ul style="font-size:12px;line-height:1.8">' +
                  '<li>📄 <b>Op Node</b> (green): Holds prompt templates. Edit processing content here.</li>' +
                  '<li>✨ <b>Data Node</b> (orange): AI pipeline output artifacts. Can be viewed or used as next input.</li>' +
                  '</ul>' +
                  '<p style="margin-top:8px"><b>Combined Mode</b>: Select both an Op node and a Data node to automatically link the Data output as Op input.</p>',
            tips: [
                { icon: '🖱️', text: 'Right-click nodes for context menu (add/delete/rename/move).' },
                { icon: '←→', text: 'Use Alt+←/→ to navigate node history.' }
            ]
        },
        {
            icon: '📋',
            title: 'Using Recipes',
            body: '<p><b>Recipes</b> are reusable presets for AI provider, model, and prompt settings.</p>' +
                  '<ul style="font-size:12px;line-height:1.8">' +
                  '<li>🔧 Manage via toolbar <b>⚙ Config</b> → <b>Recipes</b> tab</li>' +
                  '<li>📋 Apply recipes with the <b>"Select..."</b> button in the Operation pane</li>' +
                  '<li>🤖 AI Recipe: provider/model/temperature/system prompt</li>' +
                  '<li>⚙️ Command Recipe: execute CLI commands</li>' +
                  '</ul>',
            tips: [
                { icon: '⌨️', text: 'Press Ctrl+R to quickly open Recipe Manager.' },
                { icon: '🔄', text: 'Each node remembers its own recipe selection.' }
            ]
        },
        {
            icon: '▶',
            title: 'Run Pipelines',
            body: '<p>Select a node and press <b>▶ Run</b> to execute a pipeline.</p>' +
                  '<ul style="font-size:12px;line-height:1.8">' +
                  '<li>🔧 Create/edit pipelines in <b>Pipeline Manager</b></li>' +
                  '<li>✨ Results are auto-saved as <b>Data nodes</b> in the tree</li>' +
                  '<li>📜 Browse/compare past results in the <b>History</b> tab</li>' +
                  '<li>👍👎 Rate outputs and use <b>✨ Optimize</b> to improve pipelines</li>' +
                  '</ul>',
            tips: [
                { icon: '⚡', text: 'Send the same material to multiple AIs and compare results.' },
                { icon: '🚀', text: 'Use 🚀 Setup Wizard to quickly start from a template.' }
            ]
        }
        ];
    },

    wizardStep_: 0,

    showWizard(forceStep) {
        try {
            this.wizardStep_ = forceStep || 0;
            const modal = document.getElementById('wizard-modal');
            if (!modal) { this.addLog('⚠ wizard-modal not found in DOM'); return; }
            modal.classList.add('visible');
            this.renderWizardStep();
        } catch (e) {
            this.addLog(`Welcome Guide Error\nOperation: showWizard\nError: ${e.message || e}\nAction: Check wizard configuration and try restarting the app`);
        }
    },

    closeWizard() {
        document.getElementById('wizard-modal').classList.remove('visible');
        localStorage.setItem('prompts_wizard_done', '1');
    },

    resetWizard() {
        localStorage.removeItem('prompts_wizard_done');
        this.addLog('🔄 Welcome Wizard reset — will show on next launch');
    },

    renderWizardStep() {
        try {
            const steps = this.WIZARD_STEPS;
            if (!steps || steps.length === 0) { this.addLog('⚠ Wizard steps empty'); return; }
            const s = steps[this.wizardStep_];
            if (!s) { this.addLog('⚠ Invalid wizard step: ' + this.wizardStep_); return; }
            const total = steps.length;
            const cur = this.wizardStep_;

            const progressEl = document.getElementById('wizard-progress');
            if (progressEl) progressEl.innerHTML =
                steps.map((_, i) => `<span class="wizard-dot${i === cur ? ' active' : ''}"></span>`).join('');

            const tipsHtml = s.tips && s.tips.length ? `
                <div class="wizard-tips">
                    <div class="wizard-tips-label">💡 Tips</div>
                    ${s.tips.map(t => `
                        <div class="wizard-tip">
                            <span class="wizard-tip-icon">${t.icon}</span>
                            <span class="wizard-tip-text">${t.text}</span>
                        </div>`).join('')}
                </div>` : '';
            const bodyEl = document.getElementById('wizard-body');
            if (bodyEl) bodyEl.innerHTML = `
                <div class="wizard-icon">${s.icon}</div>
                <h2 class="wizard-title">${this.escapeHtml(s.title)}</h2>
                <div class="wizard-text">${s.body}</div>
                ${tipsHtml}`;

            const prevBtn = document.getElementById('wizard-prev');
            if (prevBtn) prevBtn.style.visibility = cur === 0 ? 'hidden' : '';
            const nextBtn = document.getElementById('wizard-next');
            if (nextBtn) {
                if (cur === total - 1) {
                    nextBtn.textContent = '✓ Done';
                    nextBtn.onclick = () => this.closeWizard();
                } else {
                    nextBtn.textContent = 'Next →';
                    nextBtn.onclick = () => this.wizardNext();
                }
            }
            const skipBtn = document.getElementById('wizard-skip');
            if (skipBtn) skipBtn.style.display = cur === total - 1 ? 'none' : '';
        } catch (e) {
            this.addLog(`Wizard Render Error\nOperation: renderWizardStep\nStep: ${this.wizardStep_}\nError: ${e.message || e}\nAction: Check wizard step configuration and try restarting the app`);
        }
    },

    wizardNext() {
        if (this.wizardStep_ < this.WIZARD_STEPS.length - 1) {
            this.wizardStep_++;
            this.renderWizardStep();
        }
    },

    wizardPrev() {
        if (this.wizardStep_ > 0) {
            this.wizardStep_--;
            this.renderWizardStep();
        }
    },

    // ── Hamburger menu ────────────────────────────────────────────
    showHamburger(event) {
        event.stopPropagation();
        const existing = document.getElementById('hamburger-dropdown');
        if (existing) { existing.remove(); return; }

        const t = key => this.t(key);
        const ja = this.t('LangCode') === 'ja';
        const sep = '<div class="hmenu-sep"></div>';
        const item = (label, action, shortcut='') =>
            `<div class="hmenu-item" onclick="app.hmenuAction('${action}')">${label}${shortcut ? `<span class="hmenu-shortcut">${shortcut}</span>` : ''}</div>`;
        const section = (title, items) =>
            `<div class="hmenu-section">${title}</div>${items}`;

        const html = `
            ${section(t('MenuProject'),
                item('💾 ' + t('MenuSaveProject'),        'save_project',  'Ctrl+S') +
                item('💾 ' + t('MenuSaveBTAs'),      'save_as',       'Ctrl+Shift+S') +
                sep +
                item('📁 ' + t('MenuNewProject'), 'new_project') +
                item('🔄 ' + t('MenuSwitchProject'), 'switch_project') +
                item('📍 ' + t('MenuProjectsRoot'), 'projects_root') +
                sep +
                item('ℹ️ ' + t('MenuAboutProjectLifecycle'), 'about_project_lifecycle')
            )}
            ${sep}
            ${section(t('MenuView'),
                item('🌲 ' + t('Tree'), 'toggle_pane_tree') +
                item('📋 ' + t('List'), 'toggle_pane_list') +
                item('✏️ ' + t('Editor'), 'toggle_pane_editor') +
                item('💬 ' + t('Messages'), 'toggle_pane_messages') +
                sep +
                item('🧹 ' + t('MenuCleanBlobs'), 'clean_blobs') +
                item('⛶ ' + t('MenuFullscreen'), 'toggle_fullscreen', 'F11')
            )}
            ${sep}
            ${section(t('MenuBehaviorTree'),
                item('📄 ' + t('MenuNewBT'),      'new_tab',       'Ctrl+N') +
                item('📂 ' + t('MenuOpenBT'),        'open',          'Ctrl+O') +
                item('💾 ' + t('MenuSaveBT'),        'save') +
                sep +
                item('▶ ' + t('MenuRunTree'), 'bt_run', 'F6') +
                item('⏭ ' + t('MenuStep'), 'bt_step') +
                item('⏸ ' + t('MenuPause'), 'bt_pause') +
                item('⏹ ' + t('MenuStop'), 'bt_stop') +
                sep +
                item('🔒 ' + t('MenuExecutionLock'), 'bt_toggle_lock') +
                sep +
                item('📋 ' + t('MenuBlackboard'), 'bt_blackboard') +
                item('⚙ ' + t('MenuBTSettings'), 'bt_config') +
                sep +
                item('🚀 Task Manager', 'task_manager')
            )}
            ${sep}
            ${section('Pipeline',
                item('▶ ' + t('RunPipeline'),     'run_pipeline',      'F5') +
                item('🔧 Pipeline Manager',        'pipeline_manager') +
                item('📜 ' + t('History'), 'pipeline_history') +
                sep +
                item('📤 Export Pipelines',        'export_pipeline') +
                item('📥 Import Pipeline',         'import_pipeline')
            )}
            ${sep}
            ${section(t('MenuSettings'),
                item('⚙ ' + t('Config'),             'config') +
                item('⚙ ' + t('MenuSettingsItem'),  'settings') +
                sep +
                item('🔌 ' + t('TestConnection'), 'test_connection') +
                item('📋 Recipe Manager', 'recipe_manager')
            )}
            ${sep}
            ${section(t('MenuHelp'),
                item('🤖 ' + t('MenuWelcomeWizard'), 'welcome_wizard', 'F1') +
                item('🔄 Reset Welcome Wizard',      'reset_wizard') +
                item('🚀 ' + t('MenuSetupWizard'),   'setup_wizard') +
                sep +
                item(t('MenuKeyboardShortcuts'), 'shortcuts') +
                item(t('MenuAbout'),             'about') +
                item(t('MenuCopyright'),         'copyright')
            )}`;

        const dropdown = document.createElement('div');
        dropdown.id = 'hamburger-dropdown';
        dropdown.className = 'hamburger-dropdown';
        dropdown.innerHTML = html;

        const btn = document.getElementById('btn-hamburger');
        const r = btn.getBoundingClientRect();
        dropdown.style.top = (r.bottom + 4) + 'px';
        dropdown.style.left = r.left + 'px';
        document.body.appendChild(dropdown);

        setTimeout(() => document.addEventListener('click', function close() {
            dropdown.remove();
            document.removeEventListener('click', close);
        }), 0);
    },

    hmenuAction(action) {
        document.getElementById('hamburger-dropdown')?.remove();
        const map = {
            new_tab:          () => this.newTab(),
            open:             () => this.openFile(),
            save:             () => this.saveFile(),
            save_as:          () => this.saveFileAs(),
            save_project:     () => this.saveProject(),
            new_project:      () => this.newProject(),
            switch_project:   () => this.showProjectSwitcher(),
            projects_root:    () => this.showProjectsRootConfig(),
            about_project_lifecycle: () => this.showProjectLifecycleInfo(),
            import_zip:       () => this.addLog('📦 Import ZIP — coming soon'),
            export_node:      () => this.addLog('📤 Export Node — coming soon'),
            run_pipeline:     () => this.runPipeline(),
            pipeline_manager: () => this.showPipelineManager(),
            pipeline_history: () => this.showHistory(),
            export_pipeline:  () => this.exportPipeline(),
            import_pipeline:  () => this.importPipeline(),
            bt_run:           () => this.btCtrlRun(),
            bt_step:          () => this.btCtrlStep(),
            bt_pause:         () => this.btCtrlPause(),
            bt_stop:          () => this.btCtrlStop(),
            bt_toggle_lock:   () => this.btCtrlToggleLock(),
            bt_blackboard:    () => this.btBlackboardDialog(),
            bt_config:        () => this.btConfigDialog(),
            toggle_pane_tree:    () => this.togglePane('tree-pane'),
            toggle_pane_list:    () => this.togglePane('list-pane'),
            toggle_pane_editor:  () => this.togglePane('editor-pane'),
            toggle_pane_messages:() => this.togglePane('messages-pane'),
            clean_blobs:      () => this.postMessage({ type: 'blob_gc' }),
            toggle_fullscreen:() => {
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else {
                    document.documentElement.requestFullscreen();
                }
            },
            welcome_wizard:   () => this.showWizard(),
            reset_wizard:     () => this.resetWizard(),
            setup_wizard:     () => this.showSetupWizard(),
            add_child:        () => this.addChild(),
            remove_node:      () => this.removeNode(),
            settings:         () => this.showSettings(),
            config:           () => this.showConfig(),
            test_connection:  () => this.showConfig(),
            recipe_manager:   () => this.showRecipeManager(),
            task_manager:     () => this.switchMsgTab('manager'),
            shortcuts:        () => this.showWizard(3),
            about:            () => this.showAbout(),
            copyright:        () => this.showCopyright(),
        };
        if (map[action]) map[action]();
    },

    // ── Settings dialog ────────────────────────────────────────────
    showSettings() {
        const modal = document.getElementById('settings-modal');
        const sel = document.getElementById('settings-lang');
        if (sel) sel.value = this.state.language;
        modal.classList.add('visible');
    },

    closeSettings() {
        document.getElementById('settings-modal').classList.remove('visible');
    },

    saveSettings() {
        const sel = document.getElementById('settings-lang');
        if (!sel) return;
        const lang = sel.value;
        this.loadLanguage(lang);
        this.postMessage({ type: 'set_language', payload: { language: lang } });
        this.closeSettings();
        this.addLog(`🌐 Language set to: ${sel.options[sel.selectedIndex].text}`);
    },

    // ── Execution History ─────────────────────────────────────────
    showHistory(pipelineName) {
        const modal = document.getElementById('history-modal');
        if (!modal) return;
        document.getElementById('history-list-view').innerHTML =
            '<div class="history-loading">' + this.t('Loading') + '...</div>';
        document.getElementById('history-list-view').style.display = '';
        document.getElementById('history-detail-view').style.display = 'none';
        modal.classList.add('visible');
        if (!pipelineName) this.state._historyFilter = '';
        else this.state._historyFilter = pipelineName;
        const payload = pipelineName ? { pipelineName } : undefined;
        this.postMessage({ type: 'history_list', payload });
    },

    closeHistory() {
        document.getElementById('history-modal').classList.remove('visible');
    },

    clearHistoryFilter() {
        this.state._historyFilter = '';
        this.showHistory();
    },

    onHistoryListResult(payload) {
        const items = (payload && payload.items) ? payload.items : [];
        const listView = document.getElementById('history-list-view');
        if (!listView) return;
        const filterLabel = this.state._historyFilter
            ? `<div style="font-size:11px;color:#888;padding:6px 14px;border-bottom:1px solid #2d2d2d;display:flex;align-items:center;justify-content:space-between">
                   <span>🔍 ${this.t('Filter')}: <strong>${this.escapeHtml(this.state._historyFilter)}</strong></span>
                   <button onclick="app.clearHistoryFilter()" style="background:#333;border:1px solid #555;border-radius:3px;color:#ccc;padding:2px 8px;font-size:10px;cursor:pointer">✕ ${this.t('Clear')}</button>
               </div>`
            : '';
        if (items.length === 0) {
            listView.innerHTML = filterLabel + '<div class="history-empty">' + this.t('NoExecutionHistory') + '</div>';
            return;
        }
        listView.innerHTML = filterLabel + items.map(item => {
            const evalBadge = this.evalBadgeHtml(item.evaluation || '');
            return `<div class="history-item ${item.evaluation ? 'has-eval eval-' + item.evaluation : ''}" onclick="app.showHistoryDetail(${JSON.stringify(item.id)})">
                <div class="history-item-name">${evalBadge}${this.escapeHtml(item.pipelineName || '')}</div>
                <div class="history-item-meta">
                    <span class="history-item-date">${this.escapeHtml((item.executedAt || item.startedAt || '').replace('T',' ').replace('Z',''))}</span>
                    <span class="history-item-steps">${item.stepCount} step${item.stepCount !== 1 ? 's' : ''}</span>
                    <span class="history-item-status ${this.escapeHtml(item.status || 'completed')}">${this.escapeHtml(item.status || 'completed')}</span>
                </div>
            </div>`;
        }).join('');
    },

    showHistoryDetail(id) {
        document.getElementById('history-list-view').style.display = 'none';
        const detailView = document.getElementById('history-detail-view');
        detailView.style.display = '';
        detailView.innerHTML = '<div class="history-loading">Loading...</div>';
        this.postMessage({ type: 'history_detail', payload: { id } });
    },

    onHistoryDetailResult(record) {
        const detailView = document.getElementById('history-detail-view');
        if (!detailView) return;
        if (!record || !record.pipelineName) {
            detailView.innerHTML = '<div class="history-empty">' + this.t('NoDataFound') + '</div>';
            return;
        }
        const runId = record.id || '';
        const runEval = record.evaluation || '';

        const stepsHtml = (record.steps || []).map((step, i) => {
            const stepEval = step.evaluation || '';
            const stepEvalBtns = this.evalButtonsHtml(`${runId}|${i}`, 'step', stepEval);
            const evalBadge = this.evalBadgeHtml(stepEval);
            const reqBodyHtml = step.requestBody ? `
                    <div class="history-step-section">
                        <div class="history-step-label">HTTP Request Body</div>
                        <pre class="history-step-content" style="background:#161616;border:1px solid #333">${this.escapeHtml(step.requestBody)}</pre>
                    </div>` : '';
            return `
            <div class="history-step ${stepEval ? 'has-eval eval-' + stepEval : ''}">
                <div class="history-step-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span class="history-step-num">${i + 1}</span>
                    <span class="history-step-name">${evalBadge}${this.escapeHtml(step.name || '')}</span>
                    <span class="history-step-type">${this.escapeHtml(step.type || '')}</span>
                    ${step.promptTokens || step.completionTokens ? `<span class="history-step-tokens">${(step.promptTokens||0)+(step.completionTokens||0)} tok</span>` : ''}
                    <span class="history-step-eval-btns" onclick="event.stopPropagation()">${stepEvalBtns}</span>
                    <span class="history-step-toggle">▶</span>
                </div>
                <div class="history-step-body">
                    <div class="history-step-section">
                        <div class="history-step-label">Input</div>
                        <pre class="history-step-content">${this.escapeHtml(step.input || '')}</pre>
                    </div>
                    ${reqBodyHtml}
                    <div class="history-step-section">
                        <div class="history-step-label">Output</div>
                        <pre class="history-step-content">${this.escapeHtml(step.output || '')}</pre>
                    </div>
                </div>
            </div>`;
        }).join('');

        const runEvalBtns = this.evalButtonsHtml(runId, 'run', runEval);
        detailView.innerHTML = `
            <div class="history-detail-nav">
                <button class="btn-back" onclick="app.backToHistoryList()">← ${this.t('BackToList')}</button>
            </div>
            <div class="history-detail-header">
                <div class="history-detail-name">${this.escapeHtml(record.pipelineName || '')}</div>
                <div class="history-detail-meta">
                    <span class="history-detail-date">${this.escapeHtml((record.startedAt || record.executedAt || '').replace('T',' ').replace('Z',''))}</span>
                    <span class="history-detail-run-eval">${runEvalBtns}</span>
                </div>
            </div>
            ${record.outputContent ? `<div class="history-detail-output">
                <div class="history-step-label">${this.t('FinalOutput')}</div>
                <pre class="history-step-content">${this.escapeHtml(record.outputContent)}</pre>
            </div>` : ''}
            <div class="history-steps">${stepsHtml}</div>`;
    },

    backToHistoryList() {
        document.getElementById('history-detail-view').style.display = 'none';
        document.getElementById('history-list-view').style.display = '';
        const payload = this.state._historyFilter ? { pipelineName: this.state._historyFilter } : undefined;
        this.postMessage({ type: 'history_list', payload });
    },

    // ── Optimize Modal ─────────────────────────────────────────────

    showOptimize() {
        const modal = document.getElementById('optimize-modal');
        if (!modal) return;
        this._optimizeSession = null;

        // Populate pipeline selector
        const pipelineSel = document.getElementById('opt-pipeline-select');
        const pipelines = this.state.pipelines || [];
        if (pipelines.length === 0) {
            this.addLog('⚠ ' + this.t('NoPipelines'));
            return;
        }
        pipelineSel.innerHTML = pipelines.map(p =>
            `<option value="${this.escapeHtml(p.name)}">${this.escapeHtml(p.name)}</option>`
        ).join('');

        // Populate provider/model selectors
        this._populateOptProviders();

        // Show config view by default
        this.switchOptTab('config', document.querySelector('.opt-tab'));

        // Hide loading/proposals
        this._showOptView('config');

        // Load version info for currently selected pipeline
        const name = pipelineSel.value;
        if (name) this.postMessage({ type: 'optimize_version_list', payload: { pipelineName: name } });

        modal.classList.add('visible');
    },

    closeOptimize() {
        document.getElementById('optimize-modal').classList.remove('visible');
        this._optimizeSession = null;
    },

    discardOptimize() {
        this._optimizeSession = null;
        this._showOptView('config');
    },

    _populateOptProviders() {
        const providers = this.state.providers || {};
        const provSel = document.getElementById('opt-provider-select');
        const modelSel = document.getElementById('opt-model-select');
        const keys = Object.keys(providers);
        provSel.innerHTML = keys.map(k => `<option value="${this.escapeHtml(k)}">${this.escapeHtml(k)}</option>`).join('');
        provSel.onchange = () => this._updateOptModels();
        this._updateOptModels();
    },

    _updateOptModels() {
        const providers = this.state.providers || {};
        const provSel = document.getElementById('opt-provider-select');
        const modelSel = document.getElementById('opt-model-select');
        if (!provSel || !modelSel) return;
        const prov = providers[provSel.value];
        const models = (prov && prov.models) ? prov.models : [];
        modelSel.innerHTML = models.map(m => `<option value="${this.escapeHtml(m)}">${this.escapeHtml(m)}</option>`).join('');
    },

    switchOptTab(tabName, btn) {
        document.querySelectorAll('.opt-tab').forEach(t => t.classList.remove('active'));
        if (btn) btn.classList.add('active');
        if (tabName === 'config') {
            this._showOptView('config');
        } else if (tabName === 'versions') {
            this._showOptView('versions');
            const name = document.getElementById('opt-pipeline-select')?.value;
            if (name) this.postMessage({ type: 'optimize_version_list', payload: { pipelineName: name } });
        }
    },

    _showOptView(viewName) {
        ['config', 'loading', 'proposals', 'versions'].forEach(v => {
            const el = document.getElementById(`optimize-${v}-view`);
            if (el) el.style.display = v === viewName ? '' : 'none';
        });
    },

    runOptimize() {
        const pipelineName = document.getElementById('opt-pipeline-select')?.value;
        const historyLimit = parseInt(document.getElementById('opt-history-limit')?.value) || 10;
        const maxEditsPerStep = parseInt(document.getElementById('opt-max-edits')?.value) || 3;
        const provider = document.getElementById('opt-provider-select')?.value;
        const model = document.getElementById('opt-model-select')?.value;

        if (!pipelineName || !provider || !model) {
            this.addLog('⚠ ' + this.t('SelectPipelineProviderModel'));
            return;
        }

        this._showOptView('loading');
        document.getElementById('optimize-progress-text').textContent = this.t('Preparing');

        this.postMessage({ type: 'optimize_pipeline', payload: { pipelineName, historyLimit, maxEditsPerStep, provider, model } });
    },

    applyOptimize() {
        if (!this._optimizeSession) return;
        const proposals = this._optimizeSession.proposals || [];
        const approved = [], rejected = [];
        proposals.forEach((_, i) => {
            const card = document.getElementById(`opt-proposal-${i}`);
            if (!card) return;
            if (card.dataset.decision === 'rejected') rejected.push(i);
            else approved.push(i);
        });
        this.postMessage({ type: 'optimize_apply', payload: {
            sessionId: this._optimizeSession.sessionId,
            pipelineName: this._optimizeSession.pipelineName,
            approved,
            rejected
        }});
    },

    onOptimizeProposals(payload) {
        this._optimizeSession = {
            sessionId: payload.sessionId,
            pipelineName: payload.pipelineName,
            proposals: payload.proposals || []
        };
        const summary = payload.evaluationSummary || {};

        // Show eval summary
        const summaryEl = document.getElementById('optimize-eval-summary');
        if (summaryEl) {
            summaryEl.style.display = '';
            summaryEl.innerHTML = `<span class="opt-eval-count ok">👍 OK: ${summary.okCount||0}</span>
                <span class="opt-eval-count rejected">👎 ${this.t('Rejected')}: ${summary.rejectedCount||0}</span>
                <span class="opt-eval-count pinned">📌 ${this.t('Pinned')}: ${summary.pinnedCount||0}</span>
                <span class="opt-eval-hint">${this.t('OptimizationSummary')}</span>`;
        }

        const listEl = document.getElementById('optimize-proposals-list');
        if (!listEl) return;
        if (this._optimizeSession.proposals.length === 0) {
            listEl.innerHTML = `<div class="opt-no-proposals">${this.t('NoProposals')}</div>`;
        } else {
            listEl.innerHTML = this._optimizeSession.proposals.map((p, i) => {
                const opClass = { replace: 'op-replace', add: 'op-add', delete: 'op-delete' }[p.op] || '';
                const opLabel = { replace: this.t('Replace'), add: this.t('Add'), delete: this.t('Delete') }[p.op] || p.op;
                return `<div class="opt-proposal-card" id="opt-proposal-${i}" data-decision="approved">
                    <div class="opt-proposal-header">
                        <span class="opt-op-badge ${opClass}">${opLabel}</span>
                        <span class="opt-proposal-target">${this.escapeHtml(p.stepName)} › ${this.escapeHtml(p.field)}</span>
                        <span class="opt-proposal-decision-btns">
                            <button class="opt-dec-btn approve active" onclick="app.setProposalDecision(${i},'approved')">✓ ${this.t('Approve')}</button>
                            <button class="opt-dec-btn reject" onclick="app.setProposalDecision(${i},'rejected')">✗ ${this.t('Reject')}</button>
                        </span>
                    </div>
                    ${p.op !== 'add' && p.oldValue ? `<div class="opt-diff-row old"><span class="opt-diff-label">${this.t('Current')}</span><pre class="opt-diff-text">${this.escapeHtml(p.oldValue)}</pre></div>` : ''}
                    ${p.op !== 'delete' && p.newValue ? `<div class="opt-diff-row new"><span class="opt-diff-label">${p.op === 'add' ? this.t('Add') : this.t('Changed')}</span><pre class="opt-diff-text">${this.escapeHtml(p.newValue)}</pre></div>` : ''}
                    <div class="opt-rationale">${this.escapeHtml(p.rationale || '')}</div>
                </div>`;
            }).join('');
        }
        this._showOptView('proposals');
    },

    setProposalDecision(index, decision) {
        const card = document.getElementById(`opt-proposal-${index}`);
        if (!card) return;
        card.dataset.decision = decision;
        card.querySelectorAll('.opt-dec-btn').forEach(b => b.classList.remove('active'));
        const btn = card.querySelector(`.opt-dec-btn.${decision === 'approved' ? 'approve' : 'reject'}`);
        if (btn) btn.classList.add('active');
        card.classList.toggle('opt-rejected', decision === 'rejected');
    },

    onOptimizeApplied(payload) {
        this.addLog(`✅ ${this.t('OptimizationApplied').replace('{version}', payload.version).replace('{approved}', payload.approvedCount).replace('{rejected}', payload.rejectedCount)}`);
        this._optimizeSession = null;
        // Refresh version list and switch to it
        const name = payload.pipelineName;
        if (name) {
            this.postMessage({ type: 'optimize_version_list', payload: { pipelineName: name } });
        }
        this._showOptView('versions');
        // Switch tab button
        document.querySelectorAll('.opt-tab').forEach(t => t.classList.remove('active'));
        const vTab = document.querySelector('.opt-tab[onclick*="versions"]');
        if (vTab) vTab.classList.add('active');
    },

    onOptimizeVersionChanged(payload) {
        const undoBtn = document.getElementById('btn-undo-opt');
        const redoBtn = document.getElementById('btn-redo-opt');
        if (undoBtn) undoBtn.disabled = !payload.canUndo;
        if (redoBtn) redoBtn.disabled = !payload.canRedo;
        this.addLog(`🔄 ${payload.pipelineName} → v${payload.version}`);
        // Refresh version list if modal is open
        const modal = document.getElementById('optimize-modal');
        if (modal && modal.classList.contains('visible')) {
            this.postMessage({ type: 'optimize_version_list', payload: { pipelineName: payload.pipelineName } });
        }
    },

    onOptimizeVersionListResult(payload) {
        const cursor = payload.cursor || {};
        const entries = cursor.entries || [];
        const listEl = document.getElementById('optimize-versions-list');
        if (!listEl) return;
        if (entries.length === 0) {
            listEl.innerHTML = `<div class="opt-no-proposals">${this.t('NoVersionHistory')}</div>`;
            return;
        }
        const current = cursor.currentVersion || 0;
        listEl.innerHTML = [...entries].reverse().map(e => {
            const isCurrent = e.version === current;
            const ts = (e.timestamp || '').replace('T',' ').replace('Z','');
            return `<div class="opt-version-item ${isCurrent ? 'current' : ''}">
                <span class="opt-ver-num">v${e.version}</span>
                ${isCurrent ? `<span class="opt-ver-current-badge">${this.t('Current')}</span>` : ''}
                <span class="opt-ver-label">${this.escapeHtml(e.label || '')}</span>
                <span class="opt-ver-date">${this.escapeHtml(ts)}</span>
                <span class="opt-ver-actions">
                    ${!isCurrent ? `<button class="opt-ver-btn" onclick="app.checkoutVersion(${JSON.stringify(payload.pipelineName)},${e.version})">Checkout</button>` : ''}
                    ${e.version > 1 ? `<button class="opt-ver-btn" onclick="app.reapplyVersion(${JSON.stringify(payload.pipelineName)},${e.version})">Re-apply</button>` : ''}
                </span>
            </div>`;
        }).join('');
    },

    optimizeUndo() {
        const pipelines = this.state.pipelines || [];
        if (pipelines.length === 0) return;
        // Use the pipeline currently selected in toolbar, or first
        const name = this._lastOptPipeline || (pipelines[0] && pipelines[0].name) || '';
        if (name) this.postMessage({ type: 'optimize_undo', payload: { pipelineName: name } });
    },

    optimizeRedo() {
        const pipelines = this.state.pipelines || [];
        const name = this._lastOptPipeline || (pipelines[0] && pipelines[0].name) || '';
        if (name) this.postMessage({ type: 'optimize_redo', payload: { pipelineName: name } });
    },

    checkoutVersion(pipelineName, version) {
        if (!confirm(this.t('SwitchToVersion').replace('{version}', version))) return;
        this._lastOptPipeline = pipelineName;
        this.postMessage({ type: 'optimize_checkout', payload: { pipelineName, version } });
    },

    reapplyVersion(pipelineName, version) {
        if (!confirm(this.t('ReapplyVersion').replace('{version}', version))) return;
        this._lastOptPipeline = pipelineName;
        this.postMessage({ type: 'optimize_reapply', payload: { pipelineName, version } });
    },

    onOptimizeError(payload) {
        this._showOptView('config');
        this.addLog(`Optimization Error\nOperation: onOptimizeError\nError: ${payload.message || 'unknown'}\nAction: Review pipeline configuration and provider settings`);
        this.showError(payload.message || this.t('OptimizationFailed'));
    },

    onOptimizeProgress(payload) {
        const el = document.getElementById('optimize-progress-text');
        if (el) el.textContent = payload.message || '';
    },

    // ── About / Copyright ──────────────────────────────────────────
    showAbout() {
        const modal = document.getElementById('about-modal');
        const iconEl = document.getElementById('about-icon');
        if (iconEl) {
            if (this.state.appIconDataUrl) {
                iconEl.innerHTML = `<img src="${this.state.appIconDataUrl}" style="width:80px;height:80px;object-fit:contain">`;
            } else {
                iconEl.innerHTML = '🤖';
            }
        }
        modal.classList.add('visible');
        this.applyTranslations();
    },

    closeAbout() {
        document.getElementById('about-modal').classList.remove('visible');
    },

    showFolderHelp() {
        const body = document.getElementById('folder-help-body');
        if (body) body.textContent = this.t('FolderHelpContent');
        document.getElementById('folder-help-modal').classList.add('visible');
        this.applyTranslations();
    },

    closeFolderHelp() {
        document.getElementById('folder-help-modal').classList.remove('visible');
    },

    showCopyright() {
        const modal = document.getElementById('copyright-modal');
        const body = document.getElementById('copyright-body');
        if (body) body.textContent = this.t('CopyrightBody') ||
            'Wend — Part of the Ecode project.\n\nThird-party libraries:\n' +
            '• marked.js — MIT License\n• mark.js — MIT License\n' +
            '• mermaid.js — MIT License\n• cytoscape.js — MIT License\n' +
            '• Microsoft WebView2 SDK — BSD 3-Clause\n• Mbed TLS — Apache 2.0 / GPL 2.0+';
        modal.classList.add('visible');
    },

    closeCopyright() {
        document.getElementById('copyright-modal').classList.remove('visible');
    },

    t(key) {
        return (this.state.translations && this.state.translations[key]) || key;
    },

    // ── Filter Step UI ────────────────────────────────────────────
    filterState_: { outputs: [], stepIndex: 0 },

    showFilterStep(payload) {
        const { index, mode, outputs } = payload;
        const t = key => this.t(key);
        this.filterState_ = { outputs: outputs || [], stepIndex: index };

        const modal = document.getElementById('filter-modal');
        if (!modal) return;
        const body = document.getElementById('filter-body');
        if (!body) return;

        let html = `<h3>${t('FilterTitle')} — ${t('Step')} ${index + 1}</h3>`;
        (outputs || []).forEach((out, i) => {
            html += `<div class="filter-card" id="filter-card-${i}">
                <div class="filter-content">${this.escapeHtml(out.content)}</div>
                <div class="filter-actions">
                    <button class="btn-primary filter-approve" onclick="app.filterDecision(${i}, 'approved')">${t('Save')}</button>
                    <button class="filter-reject" onclick="app.filterDecision(${i}, 'rejected')">${t('Discard')}</button>
                </div>
            </div>`;
        });

        body.innerHTML = html;
        modal.classList.add('visible');
    },

    filterDecision(index, decision) {
        const card = document.getElementById(`filter-card-${index}`);
        if (!card) return;
        card.classList.add(decision === 'approved' ? 'approved' : 'rejected');
        card.querySelectorAll('button').forEach(b => b.disabled = true);
    },

    closeFilter() {
        const modal = document.getElementById('filter-modal');
        if (modal) modal.classList.remove('visible');
        const approved = [], rejected = [];
        (this.filterState_.outputs || []).forEach((_, i) => {
            const card = document.getElementById(`filter-card-${i}`);
            if (!card) return;
            if (card.classList.contains('approved')) approved.push(i);
            else if (card.classList.contains('rejected')) rejected.push(i);
            else approved.push(i);
        });
        this.postMessage({ type: 'step_filter_resume', payload: { stepIndex: this.filterState_.stepIndex, approved, rejected } });
    },

    // ── Evaluate UI ────────────────────────────────────────────────
    showEvaluateResult(payload) {
        const { stepIndex, content, criteria, rubric } = payload;
        this.addLog(`★ Step ${stepIndex + 1} evaluation: "${criteria}" (${rubric})`);
        // Show in Output pane
        const outputEl = document.getElementById('output-run-container') || document.getElementById('output-content');
        if (!outputEl) return;
        outputEl.innerHTML += `<div class="eval-badge">★ Evaluating... <span class="eval-criteria">${this.escapeHtml(criteria)}</span></div>`;
    },

    // ── Incomplete Runs UI ─────────────────────────────────────────
    showIncompleteRuns() {
        const runs = this.state.incompleteRuns;
        const t = key => this.t(key);
        if (!runs || runs.length === 0) return;
        const modal = document.getElementById('recovery-modal');
        if (!modal) return;
        const body = document.getElementById('recovery-body');
        if (!body) return;

        body.innerHTML = runs.map(r => `
            <div class="recovery-item">
                <div class="recovery-name">📋 ${this.escapeHtml(r.pipelineName)}</div>
                <div class="recovery-meta">${t('RecoveryDesc').replace('{last}', r.lastCompletedStep).replace('{total}', r.totalSteps).replace('{started}', r.startedAt)}</div>
                <div class="recovery-actions">
                    <button class="btn-primary" onclick="app.resumeRun('${this.escapeHtml(r.runId)}', 'continue')">▶ ${t('Resume')}</button>
                    <button onclick="app.resumeRun('${this.escapeHtml(r.runId)}', 'keep')">📝 ${t('KeepOnly')}</button>
                    <button onclick="app.resumeRun('${this.escapeHtml(r.runId)}', 'discard')">🗑 ${t('Discard')}</button>
                </div>
            </div>
        `).join('');
        modal.classList.add('visible');
    },

    resumeRun(runId, action) {
        this.postMessage({ type: 'resume_run', payload: { runId, action } });
        document.getElementById('recovery-modal')?.classList.remove('visible');
    },

    // ── 5-Pane Rendering ───────────────────────────────────────────
    renderMainContent() {
        const t = key => this.t(key);
        const modeText = (this.state.viewMode === 'pipeline' && this.state.pipelineRun.selectedStep >= 0)
            ? `🔧 ${t('Step')} ${this.state.pipelineRun.selectedStep + 1} ▾`
            : `📄 ${t('NodeView')} ▾`;

        // Update tree pane selection label
        const selLabel = document.getElementById('tree-selection-label');
        if (selLabel) {
            const sop = this.state.selectedOpPath;
            const sdp = this.state.selectedDataPath;
            let newHtml = '';
            if (sop !== '' && sdp !== '') {
                newHtml = '<span style="color:#4caf50">● Op</span> <span style="color:#ff9800">● Data</span>';
            } else if (sop !== '') {
                newHtml = '<span style="color:#4caf50">● Op</span>';
            } else if (sdp !== '') {
                newHtml = '<span style="color:#ff9800">● Data</span>';
            }
            selLabel.innerHTML = newHtml;
            if (newHtml) {
                selLabel.classList.remove('blink-twice');
                void selLabel.offsetWidth;
                selLabel.classList.add('blink-twice');
            }
        }

        ['input-meta', 'prompt-meta', 'output-meta'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = modeText;
                el.style.cursor = 'pointer';
                el.title = t('ViewMode');
                el.onclick = (e) => {
                    e.stopPropagation();
                    this.showModeMenu(e);
                };
            }
        });

        this.renderInput();
        this.renderPrompt();
        this.renderOutput();
    },

    renderInput() {
        const inputEl = document.getElementById('input-content');
        if (!inputEl) return;
        const t = key => this.t(key);

        if (this.state.viewMode === 'pipeline') {
            this.renderPipelineInput(inputEl);
            return;
        }

        if (this.state.selectedOpPath === '' && this.state.selectedDataPath === '') {
            inputEl.innerHTML = `<div class="empty">${t('EmptyNode')}</div>`;
            return;
        }

        const currentPath = this.state.currentNodePath;
        const node = this.getNodeByPath(currentPath);
        if (!node) {
            inputEl.innerHTML = `<div class="empty">${t('EmptyNode')}</div>`;
            return;
        }

        const getRunResults = (opNode) => {
            if (!opNode || !opNode.children) return [];
            const container = this._dataContainer(opNode);
            return container === opNode ? opNode.children : (container.children || []);
        };
        const selectedDataPath = this.state.selectedDataPath;
        const selectedOpPath = this.state.selectedOpPath;

        if (selectedDataPath !== '') {
            // View mode (data node only selected): show text used for sending
            const dataNode = this.getNodeByPath(selectedDataPath);
            if (dataNode && dataNode.input !== undefined) {
                inputData = dataNode.input;
            } else if (dataNode && dataNode.pipelineMeta) {
                try {
                    const meta = JSON.parse(dataNode.pipelineMeta);
                    if (meta && meta.steps && meta.steps.length > 0) {
                        inputData = meta.steps[0].input || '';
                    }
                } catch(e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: renderInput\nData Node: ${dataNode.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); }
            }
            if (!inputData && dataNode && dataNode.content) {
                try { inputData = atob(dataNode.content); } catch { inputData = dataNode.content; }
            }
            const dataAttachments = dataNode ? (dataNode.inputAttachments || []) : [];
            const t = key => this.t(key);
            inputEl.innerHTML = `
                <div style="margin-bottom:6px">
                    <div style="font-size:10px;color:#888;margin-bottom:2px">${this.t('InputText')}</div>
                    <textarea id="input-textarea" class="input-textarea" placeholder="${t('NoInput')}" readonly style="opacity:0.7">${this.escapeHtml(inputData)}</textarea>
                </div>
                <div>
                    <div style="font-size:10px;color:#888;margin-bottom:3px;border-bottom:1px solid #333;padding-bottom:2px">${this.t('AdditionalMediaInput')}</div>
                    <div style="min-height:32px;padding:2px">${dataAttachments.length > 0
                        ? `<div class="attach-thumb-row">${dataAttachments.map((a, i) => this._attachmentItemHtml(a, i, {})).join('')}</div>`
                        : `<div style="font-size:11px;color:#666;padding:4px">${this.t('None')}</div>`
                    }</div>
                </div>`;
            return;
        } else if (selectedOpPath !== '') {
            // Op node only selected: show tempInputAttachments input
            const srcNode = this.getNodeByPath(selectedOpPath);
            const ti = srcNode ? (srcNode.tempInputAttachments || {}) : {};
            inputData = ti.text || '';
        } else {
            inputEl.innerHTML = `<div class="empty">${t('EmptyNode')}</div>`;
            return;
        }
        // Belt-level media attachments (tempInputAttachments, separate from machine-level node.attachments)
        const srcNode = this.getNodeByPath(selectedOpPath || currentPath);
        const ti = srcNode ? (srcNode.tempInputAttachments || {}) : {};
        const inputAttachments = ti.files || [];
        const attachHtml = inputAttachments.length > 0
            ? `<div class="attach-thumb-row">${inputAttachments.map((a, i) => this._attachmentItemHtml(a, i, { removeCallback: 'app.removeInputAttachment' })).join('')}</div>`
            : `<div style="font-size:11px;color:#666;padding:4px">(none)</div>`;

        inputEl.innerHTML = `
            <div style="margin-bottom:6px">
                <div style="font-size:10px;color:#888;margin-bottom:2px;display:flex;align-items:center;justify-content:space-between">
                    <span>${this.t('InputText')}</span>
                    ${!this.state.viewOnlyMode ? `<button class="copy-btn" onclick="app.clearInput()" style="font-size:10px;padding:1px 6px" title="${this.t('ClearInput')}">🗑</button>` : ''}
                </div>
                <textarea id="input-textarea" class="input-textarea" ${this.state.viewOnlyMode ? 'readonly' : ''} placeholder="${t('NoInput')}" ${!this.state.viewOnlyMode ? 'oninput="app.onTempContentInput(this.value)"' : ''} style="${this.state.viewOnlyMode ? 'opacity:0.7' : ''}">${this.escapeHtml(inputData)}</textarea>
            </div>
            <div>
                <div style="font-size:10px;color:#888;margin-bottom:3px;border-bottom:1px solid #333;padding-bottom:2px;display:flex;align-items:center;justify-content:space-between">
                    <span>${this.t('AdditionalMediaInput')}</span>
                    ${!this.state.viewOnlyMode ? `<button class="copy-btn" onclick="app.addInputAttachment()" style="font-size:10px;padding:1px 6px">＋</button>` : ''}
                </div>
                <div id="input-attachments-list" ${this._dropZoneAttrs('input_attachment')}
                     style="min-height:32px;border:1px dashed #3c3c3c;border-radius:3px;padding:2px">${attachHtml}</div>
            </div>`;
    },

    clearInput() {
        const srcPath = this.state.selectedOpPath || this.state.currentNodePath;
        const node = this.getNodeByPath(srcPath);
        if (!node) return;
        if (!node.tempInputAttachments) node.tempInputAttachments = { text: '', files: [] };
        node.tempInputAttachments.text = '';
        node.tempInputAttachments.files = [];
        this.saveCurrentTab();
        this.renderInput();
        this.addLog('🗑 ' + this.t('InputCleared'));
    },

    // ── Drag-and-drop file handling ──────────────────────────────
    // Called from ondrop attributes on attachment drop zones.
    // purpose: 'machine_attachment' | 'input_attachment' | 'step_attachment'
    handleFileDrop(event, purpose, stepIndex) {
        event.preventDefault();
        event.stopPropagation();
        const el = event.currentTarget;
        el.style.outline = '';
        const files = Array.from(event.dataTransfer.files)
            .filter(f => f.type.startsWith('image/') || f.type.startsWith('audio/') || f.type.startsWith('video/') || f.type === 'application/json' || f.name.endsWith('.json'));
        if (files.length === 0) return;
        Promise.all(files.map(f => new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = e => resolve({
                file: f.name,
                path: f.path || '',
                mimetype: f.type || 'application/json',
                content: e.target.result.split(',')[1],
                size: f.size,
            });
            reader.readAsDataURL(f);
        }))).then(attachments => {
            this.onMediaFileDialogResult({ purpose, stepIndex, attachments });
        });
    },

    _dropZoneAttrs(purpose, stepIndex) {
        const si = stepIndex != null ? `,${stepIndex}` : '';
        return `ondragover="event.preventDefault();this.style.outline='2px dashed #4fc3f7'"` +
               ` ondragleave="this.style.outline=''"` +
               ` ondrop="app.handleFileDrop(event,'${purpose}'${si !== '' ? si : ''})"`;
    },

    addInputAttachment() {
        this.postMessage({ type: 'open_file_dialog', payload: { filter: 'media', purpose: 'input_attachment' } });
    },

    removeInputAttachment(index) {
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node) return;
        if (!node.tempInputAttachments) node.tempInputAttachments = { text: '', files: [] };
        node.tempInputAttachments.files.splice(index, 1);
        this.saveCurrentTab();
        this.renderInput();
    },

    onTempContentInput(value) {
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node) return;
        if (!node.tempInputAttachments) node.tempInputAttachments = { text: '', files: [] };
        node.tempInputAttachments.text = value;
        this.saveCurrentTab();
    },

    renderPipelineInput(el) {
        const si = this.state.pipelineRun.selectedStep;
        const t = key => this.t(key);
        if (si < 0 || this.state.pipelineRun.steps.length === 0 || si >= this.state.pipelineRun.steps.length) {
            el.innerHTML = `<div class="empty">${t('EmptyNode')}</div>`;
            return;
        }
        const step = this.state.pipelineRun.steps[si];
        const inputText = step.input || '(pending)';
        const sourceLabel = si === 0 ? `Original Input ({content})` : `Output ({result})`;
        // Previous step output media (outputAttachments) → show as media grid
        const prevStep = si > 0 ? this.state.pipelineRun.steps[si - 1] : null;
        const prevOutputAttachments = (prevStep && prevStep.outputAttachments) || [];
        const prevArtifacts = (prevStep && prevStep.artifacts) || [];
        const prevMediaHtml = (prevOutputAttachments.length > 0 || prevArtifacts.length > 0)
            ? `<div style="margin-top:6px;font-size:10px;color:#888;margin-bottom:3px">Previous step output media:</div>
               ${this.renderOutputGrid('', prevOutputAttachments, prevArtifacts)}`
            : '';
        const artifactsHtml = '';
        // Step-specific attachments from pipelineMeta
        const stepAttachments = step.attachments || [];
        const stepAttachHtml = stepAttachments.length > 0
            ? stepAttachments.map((a, i) => `<div class="list-item" style="display:flex;align-items:center;gap:4px;font-size:11px;padding:3px 4px">
                <span style="flex:1">${this.escapeHtml(a.mimetype || '')}: ${this.escapeHtml(a.file || a.id || '')}</span>
                <button class="copy-btn" onclick="app.removeStepAttachment(${si},${i})" title="${this.t('Delete')}">✕</button>
              </div>`).join('')
            : `<div style="font-size:11px;color:#666;padding:4px">${this.t('NoAttachments')}</div>`;
        el.innerHTML = `
            <div style="margin-bottom:6px">
                <div style="font-size:10px;color:#888;margin-bottom:2px;display:flex;align-items:center;justify-content:space-between">
                    <span>${sourceLabel}</span>
                    <button class="input-source-btn" onclick="app.showInputSourceDialog()">📂 ${t('Change')}</button>
                </div>
                <pre class="input-display" style="margin:0;background:#1a1a1a;border:1px solid #2d2d2d;padding:6px;white-space:pre-wrap;font-size:11px;max-height:120px;overflow-y:auto">${this.escapeHtml(inputText)}</pre>
                ${prevMediaHtml}
            </div>
            <div>
                <div style="font-size:10px;color:#888;margin-bottom:3px;border-bottom:1px solid #333;padding-bottom:2px;display:flex;align-items:center;justify-content:space-between">
                    <span>${this.t('SpecificAdditionalInput')}</span>
                    <button class="copy-btn" onclick="app.addStepAttachment(${si})" style="font-size:10px;padding:1px 6px">＋</button>
                </div>
                <div id="step-attachments-${si}" ${this._dropZoneAttrs('step_attachment', si)}
                     style="min-height:32px;border:1px dashed #3c3c3c;border-radius:3px;padding:2px">${stepAttachHtml}</div>
            </div>`;
    },

    addStepAttachment(stepIndex) {
        this.postMessage({ type: 'open_file_dialog', payload: { filter: 'media', purpose: 'step_attachment', stepIndex } });
    },

    removeStepAttachment(stepIndex, attachIndex) {
        const step = this.state.pipelineRun.steps && this.state.pipelineRun.steps[stepIndex];
        if (!step || !step.attachments) return;
        step.attachments.splice(attachIndex, 1);
        // Persist to pipelineMeta
        this._savePipelineStepAttachments(stepIndex);
        this.renderInput();
    },

    _savePipelineStepAttachments(stepIndex) {
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node || !node.pipelineMeta) return;
        try {
            const meta = JSON.parse(node.pipelineMeta);
            if (meta && meta.steps && meta.steps[stepIndex]) {
                meta.steps[stepIndex].attachments = (this.state.pipelineRun.steps[stepIndex] || {}).attachments || [];
                node.pipelineMeta = JSON.stringify(meta);
                this.saveCurrentTab();
            }
        } catch (e) { this.addLog('⚠ Failed to save pipeline step attachments: ' + (e.message || '')); }
    },

    renderPrompt() {
        const promptEl = document.getElementById('prompt-content');
        if (!promptEl) return;
        const t = key => this.t(key);

        if (this.state.viewMode === 'pipeline') {
            this.renderPipelinePrompt(promptEl);
            return;
        }

        if (this.state.selectedOpPath === '' && this.state.selectedDataPath === '') {
            promptEl.innerHTML = `<div class="empty">${t('EmptyNode')}</div>`;
            return;
        }

        // If the selected node is a data/leaf node, show the parent operation node's prompt
        const promptNodePath = this.state.selectedOpPath || this.state.currentNodePath;
        let node = this.getNodeByPath(promptNodePath);
        if (node && node.nodeType === 'data' && node.originalOpNode) {
            node = node.originalOpNode;
        }
        if (!node || (node.nodeType === 'data')) {
            const opPath = this.getLogicalOpPath(this.state.selectedDataPath || promptNodePath);
            if (opPath) {
                node = this.getNodeByPath(opPath);
            }
        }
        if (!node) {
            promptEl.innerHTML = `<div class="empty">${t('EmptyNode')}</div>`;
            return;
        }

        // Prompt text
        const promptText = node.content ? (() => { try { return atob(node.content); } catch { return node.content; } })() : '';

        let meta = {};
        if (node.pipelineMeta) {
            try { meta = JSON.parse(node.pipelineMeta) || {}; } catch (e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: loadEditor\nNode: ${node.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); }
        }

        // Recipe selector (compact: show selected + open dialog button)
        const recipes = this.state.recipes || [];
        const selRecipe = recipes.find(r => r.name === this.state.selectedRecipe);
        const selIcon = selRecipe ? (selRecipe.type === 'command' ? '⚙️' : '🤖') : '';
        const selLabel = selRecipe ? this.escapeHtml(selRecipe.name) : `<span style="color:#666">${this.t('NotSelected')}</span>`;
        const recipeHtml = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="font-size:10px;color:#888;flex-shrink:0">${this.t('Recipe')}</span>
            <span style="flex:1;font-size:11px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${selIcon} ${selLabel}</span>
            <button class="copy-btn" onclick="app.showRecipeSelectDialog()" ${this.state.viewOnlyMode ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''} style="font-size:10px;padding:2px 8px;flex-shrink:0">${this.t('SelectRecipe')}</button>
        </div>`;

        // Machine-level attachments (node.attachments = images/audio/video for prompt context)
        const machineAttachments = node.attachments || [];
        const machineAttachHtml = machineAttachments.length > 0
            ? `<div class="attach-thumb-row">${machineAttachments.map((a, i) => this._attachmentItemHtml(a, i, { removeCallback: 'app.removeMachineAttachment' })).join('')}</div>`
            : `<div style="font-size:11px;color:#666;padding:4px">(none)</div>`;

        // Get values for BT config fields
        const btPromptText = node.btPrompt
            ? (() => { try { return atob(node.btPrompt); } catch { return node.btPrompt; } })()
            : '';
        const btInputKey  = node.btInputKey  || '';
        const btInputType = node.btInputType || 'text';
        const btOutputKey = node.btOutputKey || '';
        const btAction = node.btAction || 'processPrompt';
        const btLocalFilePath = node.btLocalFilePath || '';
        const hasBtConfig = !!(btPromptText || btInputKey || btOutputKey || btAction !== 'processPrompt');

        promptEl.innerHTML = `
            ${!this.state.viewOnlyMode ? `<button class="btn-primary prompt-editor-process-btn" onclick="app.processPrompt()" style="width:100%;padding:4px;font-size:11px;margin-bottom:6px">▶ ${this.t('Process')}</button>` : ''}
            <div style="margin-bottom:6px">
                <div style="font-size:10px;color:#888;margin-bottom:2px">${this.t('PromptLabel')}</div>
                <textarea id="node-content" class="input-textarea" ${this.state.viewOnlyMode ? 'readonly' : ''} placeholder="${this.t('PromptPlaceholder')}" style="min-height:100px;${this.state.viewOnlyMode ? 'opacity:0.7' : ''}">${this.escapeHtml(promptText)}</textarea>
            </div>
            ${recipeHtml}
            <div style="margin-top:6px">
                <div style="font-size:10px;color:#888;margin-bottom:3px;border-bottom:1px solid #333;padding-bottom:2px;display:flex;align-items:center;justify-content:space-between">
                    <span>${this.t('OperationAttachments')}</span>
                    ${!this.state.viewOnlyMode ? `<button class="copy-btn" onclick="app.addMachineAttachment()" style="font-size:10px;padding:1px 6px">＋</button>` : ''}
                </div>
                <div id="machine-attachments-list" ${this._dropZoneAttrs('machine_attachment')}
                     style="min-height:32px;border:1px dashed #3c3c3c;border-radius:3px;padding:2px">${machineAttachHtml}</div>
            </div>
            <details class="bt-node-accordion" ${hasBtConfig ? 'open' : ''}>
                <summary class="bt-node-accordion-summary">🌳 ${this.t('BTSettings')}${hasBtConfig ? ` <span class="bt-configured-badge">${this.t('Configured')}</span>` : ''}</summary>
                <div class="bt-node-accordion-body">
                    <div class="bt-field">
                        <div class="bt-field-label">${this.t('BTAction')}</div>
                        <select id="bt-action" class="bt-type-select" onchange="app.onBtActionChange()">
                            <option value="processPrompt" ${btAction === 'processPrompt' ? 'selected' : ''}>Process Prompt</option>
                            <option value="loadLocalFile" ${btAction === 'loadLocalFile' ? 'selected' : ''}>Load Local File</option>
                        </select>
                    </div>
                    <div id="bt-local-file-field" style="display:${btAction === 'loadLocalFile' ? 'block' : 'none'}">
                        <div class="bt-field">
                            <div class="bt-field-label">${this.t('LocalFilePath')} <span class="bt-hint">${this.t('LocalFilePathHint')}</span></div>
                            <input id="bt-local-file-path" class="bt-key-input" value="${this.escapeHtml(btLocalFilePath)}" placeholder="music.mp3">
                        </div>
                    </div>
                    <div id="bt-prompt-fields" style="display:${btAction === 'processPrompt' ? 'block' : 'none'}">
                        <div class="bt-field">
                            <div class="bt-field-label">${this.t('BTPrompt')} <span class="bt-hint">${this.t('BTPromptHint')}</span></div>
                            <textarea id="bt-node-prompt" class="input-textarea bt-prompt-area" placeholder="${this.t('BTPromptPlaceholder')}">${this.escapeHtml(btPromptText)}</textarea>
                        </div>
                        <div class="bt-field-row">
                            <div class="bt-field bt-field-key">
                                <div class="bt-field-label">${this.t('InputKey')} <span class="bt-hint">${this.t('InputKeyHint')}</span></div>
                                <input id="bt-input-key" class="bt-key-input" value="${this.escapeHtml(btInputKey)}" placeholder="${this.t('VariableName')}">
                            </div>
                            <div class="bt-field bt-field-type">
                                <div class="bt-field-label">${this.t('Type')}</div>
                                <select id="bt-input-type" class="bt-type-select">
                                    <option value="text"  ${btInputType === 'text'  ? 'selected' : ''}>text</option>
                                    <option value="media" ${btInputType === 'media' ? 'selected' : ''}>media</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="bt-field">
                        <div class="bt-field-label">${this.t('OutputKey')} <span class="bt-hint">${this.t('OutputKeyHint')}</span></div>
                        <input id="bt-output-key" class="bt-key-input" value="${this.escapeHtml(btOutputKey)}" placeholder="${this.t('VariableName')}">
                    </div>
                    <div class="bt-field-actions">
                        <button class="copy-btn" onclick="app.saveBtNodeConfig()">💾 ${this.t('SaveBtn')}</button>
                        <button class="copy-btn" onclick="app.btBlackboardDialog()">📋 ${this.t('Blackboard')}</button>
                    </div>
                </div>
            </details>`;

        // Render pipeline meta if available
        this.renderPipelineMeta(node);
    },

    addMachineAttachment() {
        this.postMessage({ type: 'open_file_dialog', payload: { filter: 'media', purpose: 'machine_attachment' } });
    },

    removeMachineAttachment(index) {
        let node = this.getNodeByPath(this.state.currentNodePath);
        if (!node) return;
        if (node.nodeType === 'data' && node.originalOpNode) {
            node = node.originalOpNode;
        }
        if (!node.attachments) node.attachments = [];
        node.attachments.splice(index, 1);
        this.saveCurrentTab();
        this.renderPrompt();
    },

    // Common helper to generate HTML for a single attachment
    // opts: { removeCallback: string, showViewer: bool }
    _attachmentItemHtml(a, i, opts = {}) {
        const name = a.file || a.id || 'attachment';
        const isImage = (a.mimetype || '').startsWith('image/');
        const icon = isImage ? '🖼' : (a.mimetype || '').startsWith('audio/') ? '🎵' : (a.mimetype || '').startsWith('video/') ? '🎬' : '📎';
        const removeBtn = opts.removeExpr
            ? `<button class="copy-btn" onclick="${opts.removeExpr}" title="${this.t('Delete')}">✕</button>`
            : opts.removeCallback
            ? `<button class="copy-btn" onclick="${opts.removeCallback}(${i})" title="${this.t('Delete')}">✕</button>`
            : '';

        const isVideo = (a.mimetype || '').startsWith('video/');

        if (isImage && a.content) {
            const src = `data:${a.mimetype};base64,${a.content}`;
            const viewerCall = `app.showMediaViewer('image','${src}','${this.escapeHtml(name)}')`;
            return `<div class="attach-thumb-item" title="${this.escapeHtml(name)}">
                <img class="attach-thumb" src="${src}" onclick="${viewerCall}" alt="${this.escapeHtml(name)}">
                <div class="attach-thumb-label">${this.escapeHtml(name)}</div>
                <div class="attach-thumb-remove">
                    <button class="copy-btn" onclick="${viewerCall}" title="${this.t('Preview')}">👁</button>
                    ${removeBtn}
                </div>
            </div>`;
        }

        if (isVideo && a.content) {
            const src = `data:${a.mimetype};base64,${a.content}`;
            const viewerCall = `app.showMediaViewer('video','${src}','${this.escapeHtml(name)}')`;
            return `<div class="attach-thumb-item" title="${this.escapeHtml(name)}">
                <video class="attach-thumb" src="${src}" onclick="${viewerCall}" preload="metadata" muted></video>
                <div class="attach-thumb-label">${this.escapeHtml(name)}</div>
                <div class="attach-thumb-remove">
                    <button class="copy-btn" onclick="${viewerCall}" title="${this.t('Preview')}">👁</button>
                    ${removeBtn}
                </div>
            </div>`;
        }

        return `<div class="list-item" style="display:flex;align-items:center;gap:4px;font-size:11px;padding:3px 4px" title="${this.escapeHtml(name)}">
            <span style="flex:1">${icon} ${this.escapeHtml(name)}${a.size ? ' (' + Math.round(a.size/1024) + 'KB)' : ''}</span>
            ${removeBtn}
        </div>`;
    },

    editNodePipelineMeta() {
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node) return;
        this.showPipelineManager();
    },

    saveNodePipelineMeta() {
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node || !node.pipelineMeta) return;
        let meta;
        try { meta = JSON.parse(node.pipelineMeta); } catch (e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: saveNodePipelineMeta\nNode: ${node.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); return; }
        const el = document.getElementById('prompt-content');
        if (!el) return;

        // Read inputs back into meta
        el.querySelectorAll('.param-input').forEach(inp => {
            const stepIdx = parseInt(inp.dataset.step);
            const key = inp.dataset.key;
            if (meta.steps && meta.steps[stepIdx]) {
                meta.steps[stepIdx][key] = inp.value;
            }
        });

        node.pipelineMeta = JSON.stringify(meta);
        const tab = this.state.tabs[this.state.activeTab];
        if (tab && tab.file) {
            this.postMessage({ type: 'save_node', payload: { tabFile: tab.file, root: tab.root } });
        }
        document.querySelector('.prompt-apply-btn').style.display = 'none';
        this.addLog('💾 Node pipeline meta updated');
    },

    renderPipelinePrompt(el) {
        const si = this.state.pipelineRun.selectedStep;
        const t = key => this.t(key);
        if (si < 0 || this.state.pipelineRun.steps.length === 0 || si >= this.state.pipelineRun.steps.length) {
            el.innerHTML = `<div class="empty">${t('EmptyNode')}</div>`;
            return;
        }
        const step = this.state.pipelineRun.steps[si];
        const typeInfo = this.PM_STEP_TYPES[step.type] || { icon: '❓', label: step.type, fields: [] };
        let html = `<div class="prompt-header">
            ${typeInfo.icon} ${this.escapeHtml(typeInfo.label)}
            <button class="prompt-edit-btn" onclick="app.pmEditStep(${si})" data-hint="${t('EditStep')}">✏ ${t('EditStep')}</button>
        </div>`;

        if (step.params) {
            for (const [key, value] of Object.entries(step.params)) {
                const isLong = value.length > 80;
                html += `<div class="param-row">
                    <span class="param-key">${this.escapeHtml(key)}</span>
                    ${isLong
                        ? `<textarea class="param-textarea" data-param="${this.escapeHtml(key)}" data-step="${si}">${this.escapeHtml(value)}</textarea>`
                        : `<input class="param-input" data-param="${this.escapeHtml(key)}" data-step="${si}" value="${this.escapeHtml(value)}">`
                    }
                </div>`;
            }
        }
        html += `<button class="prompt-apply-btn" onclick="app.applyPromptEdits(${si})" style="display:none">💾 ${t('ApplyChanges')}</button>`;
        el.innerHTML = html;

        // Show apply button when any textarea changes
        el.querySelectorAll('.param-textarea').forEach(ta => {
            ta.oninput = () => {
                document.querySelector('.prompt-apply-btn').style.display = '';
            };
        });
    },

    applyPromptEdits(stepIndex) {
        const el = document.getElementById('prompt-content');
        if (!el || this.state.pipelineRun.steps.length === 0 || !this.state.pipelineRun.steps[stepIndex]) return;
        const step = this.state.pipelineRun.steps[stepIndex];
        // Collect from both textareas and inputs
        el.querySelectorAll('.param-textarea, .param-input').forEach(field => {
            const key = field.dataset.param;
            if (key) step.params[key] = field.value;
        });
        document.querySelector('.prompt-apply-btn').style.display = 'none';
        this.addLog(`✏ Step ${stepIndex + 1} params updated`);
        this.postMessage({ type: 'save_pipeline', payload: { name: this.state.pipelines?.[0]?.name || '', steps: this.state.pipelineRun.steps } });
    },

    switchOutputTab(tab) {
        this.state.outputTab = tab;
        this.renderOutput();
    },

    renderOutput() {
        const resultEl = document.getElementById('output-result-container');
        const runEl = document.getElementById('output-run-container');
        if (!resultEl || !runEl) return;
        const t = key => this.t(key);

        // Render Result / History
        if (this.state.selectedOpPath === '' && this.state.selectedDataPath === '') {
            resultEl.innerHTML = `<div class="output-toolbar"><span class="output-label">${t('Output')}</span></div><div class="empty">${t('EmptyNode')}</div>`;
        } else {
            this._renderOutputHistory(resultEl, t);
        }

        // Render Run Status
        this.renderPipelineOutput(runEl);

        // Ensure timer runs if step is executing
        const si = this.state.pipelineRun.selectedStep;
        const runStep = this.state.pipelineRun.steps[si];
        if (runStep && !runStep.completed && runStep.status === 'running' && !this._runTimer) {
            this._startRunTimer();
        }
    },

    _renderOutputHistory(el, t) {
        const getRunResults = (opNode) => {
            if (!opNode || !opNode.children) return [];
            const container = this._dataContainer(opNode);
            return container === opNode ? opNode.children : (container.children || []);
        };

        const currentPath = this.state.currentNodePath;
        const selectedDataPath = this.state.selectedDataPath;
        const selectedOpPath = this.state.selectedOpPath;

        let runs = [];
        let selectedIdx = 0;

        if (selectedOpPath !== '') {
            const opNode = this.getNodeByPath(selectedOpPath);
            const linkedRuns = getRunResults(opNode);
            el.innerHTML = this.renderLinkedRunHistory(linkedRuns);
            return;
        } else if (selectedDataPath !== '') {
            const dataNode = this.getNodeByPath(selectedDataPath);
            if (dataNode) runs = [dataNode];
            selectedIdx = 0;
        } else {
            const opNode = this.getNodeByPath(currentPath);
            runs = getRunResults(opNode);
            selectedIdx = this.state.selectedOutputRunIndex !== undefined ? this.state.selectedOutputRunIndex : 0;
            if (selectedIdx >= runs.length) {
                selectedIdx = 0;
                this.state.selectedOutputRunIndex = 0;
            }
        }

        if (runs.length === 0) {
            el.innerHTML = `<div class="empty">${t('NoOutput')}</div>`;
            return;
        }

        const child = runs[selectedIdx];
        let receivedText = child.content ? (() => { try { return atob(child.content); } catch { return child.content; } })() : '';
        let artifacts = [];

        let outputAttachments = child.attachments || [];
        if (child.pipelineMeta) {
            try {
                const meta = JSON.parse(child.pipelineMeta);
                if (meta && meta.steps && meta.steps.length > 0) {
                    const lastStep = meta.steps[meta.steps.length - 1];
                    receivedText = lastStep.output || receivedText;
                    artifacts = lastStep.artifacts || [];
                    outputAttachments = lastStep.outputAttachments || outputAttachments;
                }
            } catch(e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: _renderOutputHistory\nChild: ${child.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); }
        }
        // Immediately after execution (unsaved): fallback outputAttachments from pipelineRun.steps
        if (outputAttachments.length === 0) {
            const runSteps = this.state.pipelineRun && this.state.pipelineRun.steps;
            if (runSteps && runSteps.length > 0) {
                for (const s of runSteps) {
                    if (s && s.outputAttachments) outputAttachments = outputAttachments.concat(s.outputAttachments);
                }
                if (!receivedText) {
                    const last = runSteps[runSteps.length - 1];
                    if (last && last.output) receivedText = last.output;
                }
            }
        }

        let html;
        {
            const runOptions = runs.map((c, idx) => {
                const title = c.title ? this.safeAtob(c.title) : `Run ${idx + 1}`;
                return `<option value="${idx}" ${idx === selectedIdx ? 'selected' : ''}>${this.escapeHtml(title)}</option>`;
            }).join('');
            html = `
                <div class="output-toolbar">
                    <span class="output-label">${t('Output')} (${runs.length})</span>
                    <button class="output-save-btn" onclick="app.saveCurrentOutput()">${t('Save')}</button>
                    <button class="output-discard-btn" onclick="app.discardCurrentOutput()">${t('Discard')}</button>
                    <button class="output-chest-btn" onclick="app.sendToChestDialog()">${t('SendToChest')}</button>
                </div>
                <div class="output-run-selector-row" style="margin: 8px; display: flex; align-items: center; gap: 8px; font-size: 11px;">
                    <label for="output-run-selector" style="font-weight: bold; color: #858585;">${this.t('RunHistory')}:</label>
                    <select id="output-run-selector" onchange="app.onOutputRunSelected(this.value)" style="background: #252526; color: #ccc; border: 1px solid #3c3c3c; padding: 2px; font-size: 11px; flex: 1;">
                        ${runOptions}
                    </select>
                </div>`;
        }

        if (child.evaluation) {
            html += `<div class="eval-badge" style="margin: 0 8px 8px 8px;">★ ${this.escapeHtml(child.evaluation)}</div>`;
        }

        const contentHtml = this.renderOutputGrid(receivedText, outputAttachments, artifacts);
        html += `<div style="padding:8px;height:calc(100% - 75px);overflow-y:auto;">${contentHtml}</div>`;
        el.innerHTML = html;
    },

    onOutputRunSelected(value) {
        const idx = parseInt(value);
        this.state.selectedOutputRunIndex = idx;

        this.renderInput();
        this.renderOutput();
    },

    // ── Linked mode run history card grid ──────────────────────────────
    renderLinkedRunHistory(runs) {
        const t = key => this.t(key);
        const historyHidden = localStorage.getItem('prompts.historyHidden') === '1';
        const toggleLabel = historyHidden ? this.t('History') + ' ▶' : this.t('History') + ' ▼';
        const label = this.t('Output');

        if (runs.length === 0) {
            return `<div class="output-toolbar">
                        <span class="output-label">${label}</span>
                        <button class="output-save-btn" onclick="app.toggleRunHistory()">${toggleLabel}</button>
                    </div>
                    <div class="empty">${this.t('NoRunHistory')}</div>`;
        }

        const selectedIdx = this.state.selectedOutputRunIndex ?? -1;

        const makeDetail = (child, idx) => {
            let inputText = '', outputText = '';
            let inputAttachments = child.inputAttachments || [];
            let outputAttachments = [], artifacts = [];
            let httpBodiesHtml = '';
            if (child.pipelineMeta) {
                try {
                    const meta = JSON.parse(child.pipelineMeta);
                    if (meta.steps?.length > 0) {
                        inputText = meta.steps[0].input || '';
                        const last = meta.steps[meta.steps.length - 1];
                        outputText = last.output || '';
                        outputAttachments = last.outputAttachments || [];
                        artifacts = last.artifacts || [];
                        
                        meta.steps.forEach((step, sIdx) => {
                            if (step.requestUrl || step.requestBody) {
                                const urlHtml = step.requestUrl ? `
                                    <div style="margin-top:6px">
                                        <div style="font-size:10px;color:#888;font-weight:bold;margin-bottom:2px">Step ${sIdx + 1} (${this.escapeHtml(step.name || step.type || 'AI')}): URL</div>
                                        <pre class="output-display" style="max-height:60px;overflow-y:auto;font-size:11px;background:#161616;border:1px solid #333">${this.escapeHtml(step.requestUrl)}</pre>
                                    </div>` : '';
                                const bodyHtml = step.requestBody ? `
                                    <div style="margin-top:6px">
                                        <div style="font-size:10px;color:#888;font-weight:bold;margin-bottom:2px">Step ${sIdx + 1} (${this.escapeHtml(step.name || step.type || 'AI')}): HTTP Request Body</div>
                                        <pre class="output-display" style="max-height:120px;overflow-y:auto;font-size:11px;background:#161616;border:1px solid #333">${this.escapeHtml(step.requestBody)}</pre>
                                    </div>` : '';
                                httpBodiesHtml += urlHtml + bodyHtml;
                            }
                        });
                    }
                } catch(e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: renderLinkedRunHistory\nChild: ${child.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); }
            }
            if (!outputText && child.content) {
                try { outputText = atob(child.content); } catch { outputText = child.content; }
            }
            // Immediately after execution (unsaved): fallback outputAttachments from pipelineRun.steps
            if (outputAttachments.length === 0 && child._pending) {
                const runSteps = this.state.pipelineRun && this.state.pipelineRun.steps;
                if (runSteps && runSteps.length > 0) {
                    const last = runSteps[runSteps.length - 1];
                    if (last && last.outputAttachments && last.outputAttachments.length > 0)
                        outputAttachments = last.outputAttachments;
                    if (!outputText && last && last.output) outputText = last.output;
                }
            }
            const inputTextId = inputText ? this._cacheText(inputText) : 0;
            const outputTextId = outputText ? this._cacheText(outputText) : 0;
            return `<div class="linked-run-detail">
                <div id="linked-send-${idx}" style="display:none">
                    <div style="font-size:10px;color:#888;font-weight:bold;margin-bottom:2px">Input Text</div>
                    <div ${inputTextId ? `class="clickable-view" onclick="app._ov(${inputTextId})"` : ''}><pre class="output-display" style="max-height:120px;overflow-y:auto;font-size:11px">${this.escapeHtml(inputText)}</pre></div>
                    ${this.renderOutputGrid('', inputAttachments, [])}
                    ${httpBodiesHtml}
                </div>
                <div id="linked-recv-${idx}" style="display:none">
                    <div ${outputTextId ? `class="clickable-view" onclick="app._ov(${outputTextId})"` : ''}><pre class="output-display" style="max-height:120px;overflow-y:auto;font-size:11px">${this.escapeHtml(outputText)}</pre></div>
                    ${this.renderOutputGrid('', outputAttachments, artifacts)}
                </div>
            </div>`;
        };

        const items = runs.map((child, idx) => {
            let icon = '📄';
            if (child.pipelineMeta) {
                try {
                    const meta = JSON.parse(child.pipelineMeta);
                    const last = meta.steps?.[meta.steps.length - 1];
                    const att = last?.outputAttachments?.[0];
                    if (att?.mimetype?.startsWith('image/')) icon = '🖼';
                    else if (att?.mimetype?.startsWith('video/')) icon = '🎬';
                    else if (att?.mimetype?.startsWith('audio/')) icon = '🎵';
                } catch(e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: renderLinkedRunHistory (icon detection)\nChild: ${child.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); }
            }
            let titleStr = child.title ? this.safeAtob(child.title) : `Run ${idx + 1}`;
            let isDateTitle = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(titleStr);
            if (isDateTitle) {
                titleStr = this.formatRunDate(titleStr);
            }
            const title = this.escapeHtml(titleStr);

            let timeStr = '';
            if (!isDateTitle && child.pipelineMeta) {
                try {
                    const meta = JSON.parse(child.pipelineMeta);
                    if (meta.startedAt) {
                        timeStr = this.formatRunDate(meta.startedAt);
                    }
                } catch(e) {         this.addLog(`Pipeline Metadata Parse Error\nOperation: renderLinkedRunHistory (timestamp)\nChild: ${child.title || 'unknown'}\nError: ${e.message || 'Invalid JSON'}\nAction: Check pipeline metadata format`); }
            }
            const evalBadge = child.evaluation ? `<span class="linked-run-eval">★ ${this.escapeHtml(child.evaluation)}</span>` : '';
            const isSelected = idx === selectedIdx;
            const detail = isSelected ? makeDetail(child, idx) : '';
            const timestampHtml = timeStr ? `<span style="font-size:9px;color:#777;margin-left:6px">${this.escapeHtml(timeStr)}</span>` : '';
            return `<div class="linked-run-item">
                <div class="linked-run-card${isSelected ? ' selected' : ''}" onclick="app.selectLinkedRun(${idx})">
                    <div class="linked-run-icon">${icon}</div>
                    <div class="linked-run-title" title="${title}">${title}${timestampHtml}</div>
                    <div class="linked-run-actions">
                        <button class="linked-run-btn" onclick="event.stopPropagation();app.toggleLinkedDetail(${idx},'send')" data-hint="${t('Send')}">▲</button>
                        <button class="linked-run-btn" onclick="event.stopPropagation();app.toggleLinkedDetail(${idx},'recv')" data-hint="${t('Receive')}">▼</button>
                        <button class="output-save-btn" onclick="event.stopPropagation();app.saveCurrentOutput()" data-hint="${t('Save')}">💾</button>
                        <button class="output-discard-btn" onclick="event.stopPropagation();app.discardCurrentOutput(${idx})" data-hint="${t('Discard')}">🗑</button>
                        <button class="output-chest-btn" onclick="event.stopPropagation();app.sendToChestDialog()" data-hint="${t('SendToChest')}">📦</button>
                    </div>
                    ${evalBadge}
                </div>
                ${detail}
            </div>`;
        }).join('');

        const gridHtml = historyHidden ? '' : `<div class="linked-run-grid">${items}</div>`;

        return `<div class="output-toolbar">
                    <span class="output-label">${label} — ${this.t('RunHistory')} (${runs.length})</span>
                    <button class="output-save-btn" onclick="app.toggleRunHistory()">${toggleLabel}</button>
                </div>
                ${gridHtml}`;
    },

    toggleLinkedDetail(idx, section) {
        const el = document.getElementById(`linked-${section}-${idx}`);
        if (el) {
            el.style.display = el.style.display === 'none' ? '' : 'none';
        }
    },

    selectLinkedRun(idx) {
        // Collapse by re-clicking the same card
        this.state.selectedOutputRunIndex = (this.state.selectedOutputRunIndex === idx) ? -1 : idx;
        this.renderInput();
        this.renderOutput();
    },

    toggleRunHistory() {
        const current = localStorage.getItem('prompts.historyHidden') === '1';
        localStorage.setItem('prompts.historyHidden', current ? '0' : '1');
        this.renderOutput();
    },

    // ── Output media grid ───────────────────────────────────────────
    renderOutputGrid(text, attachments, artifacts) {
        const cards = [];

        // Text card
        if (text && text.trim()) {
            const preview = this.escapeHtml(text.trim().substring(0, 120).replace(/\n/g, ' '));
            const encoded = encodeURIComponent(text);
            cards.push(`
                <div class="output-card" onclick="app.showMediaViewer('text',decodeURIComponent('${encoded}'),'${this.t('TextOutput')}')">
                    <div class="output-card-icon">📄</div>
                    <div class="output-card-preview">${preview}</div>
                    <div class="output-card-label">${this.t('TextOutput')}</div>
                </div>`);
        }

        // Attachment cards (outputAttachments from AI response)
        (attachments || []).forEach((a, i) => {
            const mime = a.mimetype || '';
            const label = this.escapeHtml(a.file || `attachment-${i}`);
            if (mime.startsWith('image/')) {
                const src = `data:${mime};base64,${a.content || ''}`;
                cards.push(`
                    <div class="output-card" onclick="app.showMediaViewer('image','${src}','${label}')">
                        <img class="output-thumb" src="${src}" onerror="this.src=''">
                        <div class="output-card-label">${label}</div>
                    </div>`);
            } else if (mime.startsWith('video/')) {
                const src = `data:${mime};base64,${a.content || ''}`;
                cards.push(`
                    <div class="output-card" onclick="app.showMediaViewer('video','${src}','${label}')">
                        <div class="output-card-icon">🎬</div>
                        <div class="output-card-label">${label}</div>
                    </div>`);
            } else if (mime.startsWith('audio/')) {
                const src = `data:${mime};base64,${a.content || ''}`;
                cards.push(`
                    <div class="output-card" onclick="app.showMediaViewer('audio','${src}','${label}')">
                        <div class="output-card-icon">🎵</div>
                        <div class="output-card-label">${label}</div>
                    </div>`);
            } else {
                const content = a.content ? atob(a.content) : '';
                const encoded = encodeURIComponent(content);
                cards.push(`
                    <div class="output-card" onclick="app.showMediaViewer('text',decodeURIComponent('${encoded}'),'${label}')">
                        <div class="output-card-icon">📎</div>
                        <div class="output-card-label">${label}</div>
                    </div>`);
            }
        });

        // Artifact cards (file paths)
        (artifacts || []).forEach(a => {
            const label = this.escapeHtml(a.label || a.path || '');
            const ext = (a.path || '').split('.').pop().toLowerCase();
            const imgExts = ['png','jpg','jpeg','gif','webp','bmp','svg'];
            const vidExts = ['mp4','webm','mov','avi','mkv'];
            const audExts = ['mp3','wav','ogg','flac','m4a'];
            let icon = '🔗';
            let viewer = `app.openArtifact(${JSON.stringify(a)})`;
            if (imgExts.includes(ext)) icon = '🖼';
            else if (vidExts.includes(ext)) icon = '🎬';
            else if (audExts.includes(ext)) icon = '🎵';
            cards.push(`
                <div class="output-card" onclick="${viewer}">
                    <div class="output-card-icon">${icon}</div>
                    <div class="output-card-label">${label}</div>
                </div>`);
        });

        if (cards.length === 0) return '';
        return `<div class="output-grid">${cards.join('')}</div>`;
    },

    showMediaViewer(type, src, label) {
        document.getElementById('media-viewer-overlay')?.remove();
        let body = '';
        if (type === 'text') {
            body = `<pre class="media-viewer-text">${this.escapeHtml(src)}</pre>
                    <button class="media-viewer-copy" onclick="navigator.clipboard.writeText(decodeURIComponent(encodeURIComponent(document.querySelector('.media-viewer-text').textContent))).then(()=>app.addLog('📋 ' + app.t('Copied')))">📋 ${this.t('CopyBtn')}</button>`;
        } else if (type === 'image') {
            body = `<div class="media-viewer-img-wrap" id="media-viewer-img-wrap">
                        <img src="${src}" class="media-viewer-img" id="media-viewer-img" alt="${this.escapeHtml(label)}">
                    </div>`;
        } else if (type === 'video') {
            body = `<video src="${src}" controls class="media-viewer-video"></video>`;
        } else if (type === 'audio') {
            body = `<audio src="${src}" controls class="media-viewer-audio"></audio>`;
        }

        const overlay = document.createElement('div');
        overlay.id = 'media-viewer-overlay';
        overlay.className = 'media-viewer-overlay';
        overlay.innerHTML = `
            <div class="media-viewer-box">
                <div class="media-viewer-header">
                    <span>${this.escapeHtml(label)}</span>
                    <button class="media-viewer-close" onclick="app.closeMediaViewer()">✕</button>
                </div>
                <div class="media-viewer-body">${body}</div>
            </div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) this.closeMediaViewer(); });
        document.body.appendChild(overlay);

        if (type === 'image') {
            const wrap = document.getElementById('media-viewer-img-wrap');
            const img  = document.getElementById('media-viewer-img');
            const fit  = this.state.defaultImageFit || 'contain';

            // Apply initial fit mode after image loads so natural dimensions are known
            const applyFit = () => {
                img.style.transform = '';
                img.style.transformOrigin = 'top left';
                if (fit === 'contain') {
                    // Fit largest dimension into viewer (letter-box)
                    img.style.width  = '';
                    img.style.height = '';
                    img.style.maxWidth  = '100%';
                    img.style.maxHeight = '100%';
                    wrap.style.alignItems     = 'center';
                    wrap.style.justifyContent = 'center';
                } else if (fit === 'fit-height') {
                    img.style.width  = '';
                    img.style.height = '100%';
                    img.style.maxWidth  = 'none';
                    img.style.maxHeight = 'none';
                    wrap.style.alignItems     = 'flex-start';
                    wrap.style.justifyContent = 'flex-start';
                } else if (fit === 'fit-width') {
                    img.style.width  = '100%';
                    img.style.height = '';
                    img.style.maxWidth  = 'none';
                    img.style.maxHeight = 'none';
                    wrap.style.alignItems     = 'flex-start';
                    wrap.style.justifyContent = 'flex-start';
                } else {
                    // native: render at actual pixel size
                    img.style.width  = img.naturalWidth  + 'px';
                    img.style.height = img.naturalHeight + 'px';
                    img.style.maxWidth  = 'none';
                    img.style.maxHeight = 'none';
                    wrap.style.alignItems     = 'flex-start';
                    wrap.style.justifyContent = 'flex-start';
                }
                scale = 1;
                wrap.style.cursor = 'zoom-in';
            };

            let scale = 1;
            img.addEventListener('load', applyFit);
            if (img.complete) applyFit();

            wrap.addEventListener('wheel', e => {
                e.preventDefault();
                // On first wheel interaction, switch img to absolute pixel size for smooth zooming
                if (scale === 1 && fit !== 'native') {
                    const w = img.getBoundingClientRect().width;
                    const h = img.getBoundingClientRect().height;
                    img.style.width  = w + 'px';
                    img.style.height = h + 'px';
                    img.style.maxWidth  = 'none';
                    img.style.maxHeight = 'none';
                    wrap.style.alignItems     = 'flex-start';
                    wrap.style.justifyContent = 'flex-start';
                }
                const rect = wrap.getBoundingClientRect();
                const ox = e.clientX - rect.left + wrap.scrollLeft;
                const oy = e.clientY - rect.top  + wrap.scrollTop;
                scale = Math.min(10, Math.max(0.1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
                img.style.transform = `scale(${scale})`;
                img.style.transformOrigin = `${ox}px ${oy}px`;
                wrap.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
            }, { passive: false });
        }
    },

    closeMediaViewer() {
        document.getElementById('media-viewer-overlay')?.remove();
    },

    _vc: {},
    _vcNext: 0,
    _cacheText(text) {
        const id = ++this._vcNext;
        this._vc[id] = text;
        const keys = Object.keys(this._vc);
        if (keys.length > 50) delete this._vc[keys[0]];
        return id;
    },
    _ov(id) {
        const text = this._vc[id] || '';
        this.showMediaViewer('text', text, this.t('TextOutput'));
    },

    renderPipelineOutput(el) {
        const si = this.state.pipelineRun.selectedStep;
        const t = key => this.t(key);
        if (si < 0 || this.state.pipelineRun.steps.length === 0 || si >= this.state.pipelineRun.steps.length) {
            el.innerHTML = `<div class="empty">${t('EmptyNode')}</div>`;
            return;
        }
        const step = this.state.pipelineRun.steps[si];
        const isError = step.status === 'error';
        const outputText = step.completed
            ? (step.output || '(empty output)')
            : isError
                ? (step.error || 'Error')
                : (step.streamingOutput || (step.status === 'running' ? '...' : '(pending)'));
        const artifacts = step.artifacts || [];
        const artifactsHtml = artifacts.length > 0
            ? `<div style="font-size:10px;color:#888;margin:8px 8px 3px;border-bottom:1px solid #333;padding-bottom:2px">${this.t('Artifacts')}</div>` +
              artifacts.map(a => `<div style="font-size:11px;padding:2px 8px">🔗 <a style="color:#4fc3f7" href="#" onclick="app.openArtifact(${JSON.stringify(a)});return false">${this.escapeHtml(a.label || a.path || '')}</a></div>`).join('')
            : '';
        const outputAttachments = step.outputAttachments || [];

        const isRunning = !step.completed && step.status === 'running';
        const elapsedSec = (isRunning && step.startedAt) ? Math.floor((Date.now() - step.startedAt) / 1000) : 0;
        const elapsedStr = elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m${elapsedSec % 60}s`;
        const statusBadge = isRunning
            ? `<span class="run-status-badge"><span class="run-spinner">⟳</span> ${this.t('WaitingForResponse')} <span id="run-elapsed">${elapsedStr}</span></span>`
            : isError
                ? `<span class="run-error-badge">✖ ${this.t('Error')}</span>`
                : '';
        const outputTextId = (outputText && step.completed && outputText !== '(empty output)') ? this._cacheText(outputText) : 0;
        const outputClickable = outputTextId ? `class="clickable-view" onclick="app._ov(${outputTextId})"` : '';
        const preClass = isError ? 'output-display output-display-error' : 'output-display';

        el.innerHTML = `
            <div class="output-toolbar">
                <span class="output-label">${t('Step')} ${si + 1} ${t('Output')}</span>
                ${statusBadge}
                ${step.completed ? `<button class="output-save-btn" onclick="app.savePipelineOutput(${si})">${t('Save')}</button>
                <button class="output-chest-btn" onclick="app.sendToChestDialog()">${t('SendToChest')}</button>` : ''}
            </div>
            <div ${outputClickable}><pre class="${preClass}" id="pipeline-output-${si}">${this.escapeHtml(outputText)}</pre></div>
            <div style="padding:4px 8px">${this.renderOutputGrid('', outputAttachments, artifacts)}</div>
            <div id="pipeline-artifacts-${si}"></div>`;
    },

    // ── Input Source Dialog ────────────────────────────────────────
    showInputSourceDialog() {
        const modal = document.getElementById('input-source-modal');
        if (!modal) return;
        const body = document.getElementById('input-source-body');
        if (!body) return;
        const t = key => this.t(key);

        body.innerHTML = `
            <h3>${t('Source')}</h3>
            <div class="source-option" onclick="app.selectInputSource('previous_step')">
                📦 ${t('PreviousStep')}
            </div>
            <div class="source-option" onclick="app.selectInputSource('manual')">
                ✏️ ${t('ManualInput')}
            </div>
            <div class="source-option" onclick="app.selectInputSource('chest')">
                📁 ${t('NamedChest')}
            </div>
            <div class="source-option" onclick="app.selectInputSource('file')">
                📂 ${t('ExternalFile')}
            </div>
            <div class="source-option" onclick="app.selectInputSource('checkpoint')">
                📜 ${t('PastCheckpoint')}
            </div>
            <div class="source-chest-name" style="display:none" id="source-chest-input">
                <input type="text" id="chest-name-input" placeholder="${t('EnterChestName')}">
                <button onclick="app.confirmChestSource()">${t('Confirm')}</button>
            </div>`;
        modal.classList.add('visible');
    },

    selectInputSource(source) {
        if (source === 'chest') {
            document.getElementById('source-chest-input').style.display = '';
            return;
        }
        if (source === 'manual') {
            const input = document.getElementById('input-textarea');
            if (input) {
                this.postMessage({ type: 'select_input_source', payload: { stepIndex: this.state.pipelineRun.selectedStep, source: 'manual', content: input.value } });
            }
        } else if (source === 'checkpoint') {
            this.postMessage({ type: 'select_input_source', payload: { stepIndex: this.state.pipelineRun.selectedStep, source: 'checkpoint' } });
        } else {
            this.postMessage({ type: 'select_input_source', payload: { stepIndex: this.state.pipelineRun.selectedStep, source } });
        }
        document.getElementById('input-source-modal')?.classList.remove('visible');
    },

    confirmChestSource() {
        const name = document.getElementById('chest-name-input')?.value;
        if (!name) return;
        this.postMessage({ type: 'select_input_source', payload: { stepIndex: this.state.pipelineRun.selectedStep, source: 'chest', chestName: name } });
        document.getElementById('input-source-modal')?.classList.remove('visible');
    },

    onMediaFileDialogResult(payload) {
        if (!payload || !payload.attachments || payload.attachments.length === 0) return;
        const purpose = payload.purpose;
        const attachments = payload.attachments;
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node) return;

        if (purpose === 'machine_attachment') {
            let targetNode = node;
            if (node.nodeType === 'data' && node.originalOpNode) {
                targetNode = node.originalOpNode;
            }
            if (!targetNode.attachments) targetNode.attachments = [];
            targetNode.attachments.push(...attachments);
            this.saveCurrentTab();
            this.renderPrompt();
        } else if (purpose === 'input_attachment') {
            if (!node.tempInputAttachments) node.tempInputAttachments = { text: '', files: [] };
            node.tempInputAttachments.files.push(...attachments);
            this.saveCurrentTab();
            this.renderInput();
        } else if (purpose === 'step_attachment') {
            const si = payload.stepIndex;
            if (si == null || this.state.pipelineRun.steps.length === 0 || !this.state.pipelineRun.steps[si]) return;
            const step = this.state.pipelineRun.steps[si];
            if (!step.attachments) step.attachments = [];
            step.attachments.push(...attachments);
            this._savePipelineStepAttachments(si);
            this.renderInput();
        } else if (purpose === 'bt_bb_media') {
            const key = this._btBbPendingMediaKey;
            if (!key || !this._bt) return;
            this._bt.bbSetMedia(key, attachments);
            this._btBbPendingMediaKey = null;
            this._renderBbDialog();
        }
    },

    openArtifact(artifact) {
        if (!artifact) return;
        if (artifact.path) {
            this.postMessage({ type: 'open_artifact', payload: artifact });
        }
    },

    // ── Chest Operations ───────────────────────────────────────────
    sendToChestDialog() {
        const t = key => this.t(key);
        const chestName = prompt(t('EnterChestName'), '');
        if (!chestName) return;
        const outputEl = document.getElementById('output-content');
        const content = outputEl ? outputEl.textContent : '';
        this.postMessage({ type: 'send_to_chest', payload: { content, chestName } });
        if (!this.state.chestList) this.state.chestList = [];
        if (!this.state.chestList.includes(chestName)) this.state.chestList.push(chestName);
        this.addLog(`📦 ${t('SendToChest')} "${chestName}"`);
        document.querySelectorAll('.output-chest-btn').forEach(el => {
            el.classList.add('chest-sent');
            setTimeout(() => el.classList.remove('chest-sent'), 600);
        });
    },

    saveCurrentOutput() {
        this.addLog(`✔ ${this.t('Save')}`);
    },

    discardCurrentOutput(idx) {
        if (idx !== undefined) {
            // Discarding a specific run from the card list
            const selectedOpPath = this.state.selectedOpPath || this.state.currentNodePath;
            if (!selectedOpPath) return;
            const opNode = this.getNodeByPath(selectedOpPath);
            if (!opNode || !opNode.children) return;

            const container = this._dataContainer(opNode);
            const targetArray = container === opNode ? opNode.children : container.children;
            if (!targetArray || idx >= targetArray.length) return;
            
            const name = targetArray[idx].title ? this.safeAtob(targetArray[idx].title) : `Run ${idx + 1}`;
            if (!confirm(`Delete run history "${name}"?`)) return;

            targetArray.splice(idx, 1);

            // Adjust indices for selectedDataPath and currentNodePath if they are affected by the deletion
            const parentPath = this._containerPath(selectedOpPath, opNode);
            
            if (this.state.selectedDataPath && this.state.selectedDataPath.startsWith(parentPath + '/')) {
                const suffix = this.state.selectedDataPath.slice(parentPath.length + 1);
                const parts = suffix.split('/');
                const selIdx = parseInt(parts[0]);
                if (!isNaN(selIdx)) {
                    if (selIdx === idx) {
                        this.state.selectedDataPath = '';
                    } else if (selIdx > idx) {
                        parts[0] = (selIdx - 1).toString();
                        this.state.selectedDataPath = parentPath + '/' + parts.join('/');
                    }
                }
            }
            this.state.selectedDataPaths = this.state.selectedDataPaths.filter(p => {
                if (p === this.state.selectedDataPath) return true;
                const node = this.getNodeByPath(p);
                return node !== null;
            });
            
            if (this.state.currentNodePath && this.state.currentNodePath.startsWith(parentPath + '/')) {
                const suffix = this.state.currentNodePath.slice(parentPath.length + 1);
                const parts = suffix.split('/');
                const curIdx = parseInt(parts[0]);
                if (!isNaN(curIdx)) {
                    if (curIdx === idx) {
                        this.state.currentNodePath = parentPath;
                    } else if (curIdx > idx) {
                        parts[0] = (curIdx - 1).toString();
                        this.state.currentNodePath = parentPath + '/' + parts.join('/');
                    }
                }
            }
            
            // If the deleted index was selected, reset selection
            if (this.state.selectedOutputRunIndex === idx) {
                this.state.selectedOutputRunIndex = -1;
            } else if (this.state.selectedOutputRunIndex > idx) {
                this.state.selectedOutputRunIndex--;
            }
            
            this.saveCurrentTab();
            
            this.renderTree();
            this.renderList();
            this.renderOutput();
            this.addLog(`🗑 Run history discarded: ${name}`);
        } else {
            // Discarding the currently selected node (original behavior from toolbar button)
            const path = this.state.selectedDataPath || this.state.currentNodePath;
            if (!path) return;
            const parts = path.split('/').filter(p => p !== '');
            const parentPath = parts.slice(0, -1).join('/');
            const nodeIdx = parseInt(parts[parts.length - 1]);
            if (isNaN(nodeIdx)) return;
            const parent = this.getNodeByPath('/' + parentPath);
            if (!parent || !parent.children || nodeIdx >= parent.children.length) return;
 
            const node = parent.children[nodeIdx];
            const name = node.title ? this.safeAtob(node.title) : `Node ${nodeIdx + 1}`;
            if (!confirm(`Delete "${name}"?`)) return;
 
            parent.children.splice(nodeIdx, 1);
            
            // Reset selection state if we deleted the selected data/op path
            if (this.state.selectedDataPath === path) this.state.selectedDataPath = '';
            if (this.state.selectedOpPath === path) this.state.selectedOpPath = '';
            this.state.selectedDataPaths = this.state.selectedDataPaths.filter(p => {
                if (p === path) return false;
                const n = this.getNodeByPath(p);
                return n !== null;
            });
            this.state.currentNodePath = '/' + parentPath;
            
            this.saveCurrentTab();
 
            this.renderTree();
            this.renderList();
            this.loadEditor(this.state.currentNodePath);
            this.addLog(`🗑 Node discarded: ${name}`);
        }
    },

    savePipelineOutput(stepIndex) {
        this.addLog(`✔ ${this.t('Step')} ${stepIndex + 1} ${this.t('Save')}`);
    },

    buildPromptHtml(meta) {
        let html = '<div class="prompt-steps">';
        if (meta.pipelineName) {
            html += `<div class="prompt-title">📋 ${this.escapeHtml(meta.pipelineName)}</div>`;
        }
        if (meta.steps) {
            (meta.steps || []).forEach((s, i) => {
                html += `<div class="prompt-step">
                    <div class="prompt-step-header">Step ${i + 1}: ${this.escapeHtml(s.name || s.type)}</div>`;
                for (const [key, value] of Object.entries(s)) {
                    if (key === 'name' || key === 'type') continue;
                    const displayVal = String(value).length > 200 ? String(value).substring(0, 200) + '...' : String(value);
                    html += `<div class="param-row"><span class="param-key">${this.escapeHtml(key)}</span><span class="param-value">${this.escapeHtml(displayVal)}</span></div>`;
                }
                html += '</div>';
            });
        }
        html += '</div>';
        return html;
    },

    // ── Project Switcher ───────────────────────────────────────────
    _renderDemoSetupSection() {
        const demos = this.state.demos || [];
        if (demos.length === 0) return '';
        const buttons = demos.map(d =>
            `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">` +
            `<button id="btn-setup-demo-${d.sampleSubDir}" onclick="app.setupDemo('${d.sampleSubDir}')" ` +
            `style="background:#2a5a2a;color:#cfc;border:1px solid #4a8a4a;border-radius:4px;padding:5px 14px;cursor:pointer;font-size:12px">🎬 Setup Demo</button>` +
            `<span style="font-size:12px;color:#ccc">${d.displayName}</span>` +
            `<span style="font-size:11px;color:#888">→ <code>${d.projectName}</code></span>` +
            `</div>`
        ).join('');
        return '<div style="margin-top:16px;padding-top:14px;border-top:1px solid #2a3a2a">' +
               '<p style="font-size:12px;color:#aaa;margin-bottom:10px">Want to try a working example? Click Setup Demo to copy sample data into a project:</p>' +
               buttons +
               '</div>';
    },

    setupDemo(sampleSubDir) {
        const btn = document.getElementById('btn-setup-demo-' + sampleSubDir);
        if (btn) { btn.textContent = '⏳ Setting up...'; btn.disabled = true; }
        this.postMessage({ type: 'setup_demo', payload: { sampleSubDir } });
    },

    switchProject(name) {
        this.postMessage({ type: 'select_project', payload: { projectName: name } });
    },

    createProject() {
        const name = prompt('New project name:');
        if (!name) return;
        this.postMessage({ type: 'create_project', payload: { projectName: name } });
    },

    showProjectListDialog(projects) {
        console.log('[ProjectList] showProjectListDialog called, projects:', projects);
        const current = this.state.activeProject || '';
        const currentEl = document.getElementById('project-list-current');
        if (currentEl) currentEl.textContent = current || '(' + this.t('None') + ')';
        
        // Store full project list with paths
        this._allProjects = projects.map(p => ({
            name: p,
            path: this.getProjectPath(p)
        }));
        this._filteredProjects = this._allProjects.slice();

        const countEl = document.getElementById('project-list-count');
        if (countEl) countEl.textContent = `${projects.length} project${projects.length !== 1 ? 's' : ''}`;

        const searchInput = document.getElementById('project-list-search');
        if (searchInput) searchInput.value = '';

        this.renderProjectList();
        this._selectedProject = null;
        const openBtn = document.getElementById('project-list-open-btn');
        if (openBtn) openBtn.disabled = true;
        const modal = document.getElementById('project-list-modal');
        if (modal) modal.classList.add('visible');
        this.applyTranslations();
    },

    getProjectPath(name) {
        const appDataPath = this.state.appDataPath || '';
        return `${appDataPath}\\projects\\${name}`;
    },

    renderProjectList() {
        const body = document.getElementById('project-list-body');
        if (!body) return;
        
        const current = this.state.activeProject || '';
        const projects = this._filteredProjects || [];
        
        if (projects.length === 0) {
            body.innerHTML = `<div style="padding:20px;text-align:center;color:#888">${this.t('NoProjets') || 'No projects found.'}</div>`;
            return;
        }

        body.innerHTML = projects.map((p, idx) => {
            const isCurrent = p.name === current;
            const isSelected = p.name === this._selectedProject;
            const isFirst = idx === 0;
            const isLast = idx === projects.length - 1;
            return `
                <div class="project-list-item${isCurrent ? ' project-list-item-current' : ''}${isSelected ? ' project-list-item-selected' : ''}"
                     data-name="${p.name}" data-index="${idx}"
                     onclick="app._selectProjectItem(this,'${p.name.replace(/'/g,"\\'")}')">
                    <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
                        <span style="flex-shrink:0">${isCurrent ? '📂' : '📁'}</span>
                        <div style="flex:1;min-width:0">
                            <div style="font-weight:${isCurrent ? 'bold' : 'normal'};color:#eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
                            <div style="font-size:10px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${p.path}">${p.path}</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0" onclick="event.stopPropagation()">
                        <button class="proj-action-btn" onclick="app.moveProjectUp('${p.name}')" ${isFirst ? 'disabled' : ''} title="Move up">↑</button>
                        <button class="proj-action-btn" onclick="app.moveProjectDown('${p.name}')" ${isLast ? 'disabled' : ''} title="Move down">↓</button>
                        <button class="proj-action-btn" onclick="app.renameProject('${p.name}')" title="Rename">✏️</button>
                        <button class="proj-action-btn" onclick="app.duplicateProject('${p.name}')" title="Duplicate">📋</button>
                        <button class="proj-action-btn" onclick="app.verifyProject('${p.name}')" title="Verify">✓</button>
                        <button class="proj-action-btn proj-action-delete" onclick="app.deleteProject('${p.name}')" title="Delete">🗑️</button>
                    </div>
                </div>`;
        }).join('');
    },

    filterProjectList() {
        const searchInput = document.getElementById('project-list-search');
        const query = (searchInput?.value || '').toLowerCase().trim();
        
        if (!query) {
            this._filteredProjects = this._allProjects.slice();
        } else {
            this._filteredProjects = this._allProjects.filter(p => 
                p.name.toLowerCase().includes(query) || 
                p.path.toLowerCase().includes(query)
            );
        }
        this.renderProjectList();
    },

    _selectProjectItem(el, name) {
        document.querySelectorAll('.project-list-item').forEach(e => e.classList.remove('project-list-item-selected'));
        el.classList.add('project-list-item-selected');
        this._selectedProject = name;
        const openBtn = document.getElementById('project-list-open-btn');
        if (openBtn) openBtn.disabled = (name === (this.state.activeProject || ''));
    },

    openSelectedProject() {
        if (this._selectedProject) {
            this.switchProject(this._selectedProject);
            this.closeProjectList();
        }
    },

    closeProjectList() {
        document.getElementById('project-list-modal').classList.remove('visible');
        this._selectedProject = null;
        this._allProjects = null;
        this._filteredProjects = null;
    },

    newProjectFromList() {
        this.closeProjectList();
        this.showProjectInputModal(
            'New Project',
            'Enter a name for the new project:',
            '',
            (name) => {
                this.postMessage({ type: 'create_project', payload: { projectName: name } });
            }
        );
    },

    moveProjectUp(name) {
        this.postMessage({ type: 'move_project', payload: { name, direction: 'up' } });
    },

    moveProjectDown(name) {
        this.postMessage({ type: 'move_project', payload: { name, direction: 'down' } });
    },

    renameProject(name) {
        this.showProjectInputModal(
            'Rename Project',
            `Rename project "${name}" to:`,
            name,
            (newName) => {
                if (newName !== name) {
                    this.postMessage({ type: 'rename_project', payload: { oldName: name, newName: newName } });
                }
            }
        );
    },

    duplicateProject(name) {
        this.showProjectInputModal(
            'Duplicate Project',
            `Duplicate project "${name}" as:`,
            `${name}_copy`,
            (newName) => {
                this.postMessage({ type: 'duplicate_project', payload: { sourceName: name, newName: newName } });
            }
        );
    },

    deleteProject(name) {
        if (name === this.state.activeProject) {
            this.addLog(`Project Delete Error\nOperation: deleteProject\nProject: ${name}\nError: Cannot delete the currently active project\nAction: Switch to a different project first, then delete this one`);
            return;
        }
        this.showProjectConfirmModal(
            'Delete Project',
            `Delete project "${name}"?\n\nThis will permanently remove the project and all its data.`,
            () => {
                this.postMessage({ type: 'delete_project', payload: { name } });
            }
        );
    },

    verifyProject(name) {
        this.postMessage({ type: 'verify_project', payload: { name } });
    },

    // ── Project Input Modal ───────────────────────────────────────
    _projectInputCallback: null,

    showProjectInputModal(title, message, defaultValue, callback) {
        this._projectInputCallback = callback;
        document.getElementById('project-input-title').textContent = title;
        document.getElementById('project-input-message').textContent = message;
        const input = document.getElementById('project-input-field');
        input.value = defaultValue || '';
        document.getElementById('project-input-modal').classList.add('visible');
        setTimeout(() => { input.focus(); input.select(); }, 100);
    },

    closeProjectInputModal() {
        document.getElementById('project-input-modal').classList.remove('visible');
        this._projectInputCallback = null;
    },

    confirmProjectInput() {
        const input = document.getElementById('project-input-field');
        const value = input.value.trim();
        if (value && this._projectInputCallback) {
            this._projectInputCallback(value);
        }
        this.closeProjectInputModal();
    },

    // ── Project Confirm Modal ─────────────────────────────────────
    _projectConfirmCallback: null,

    showProjectConfirmModal(title, message, callback) {
        this._projectConfirmCallback = callback;
        document.getElementById('project-confirm-title').textContent = title;
        document.getElementById('project-confirm-message').textContent = message;
        document.getElementById('project-confirm-modal').classList.add('visible');
    },

    closeProjectConfirmModal() {
        document.getElementById('project-confirm-modal').classList.remove('visible');
        this._projectConfirmCallback = null;
    },

    confirmProjectAction() {
        if (this._projectConfirmCallback) {
            this._projectConfirmCallback();
        }
        this.closeProjectConfirmModal();
    },

    setHistoryRetention(val) {
        const n = parseInt(val);
        if (isNaN(n)) return;
        this.state.historyRetention = Math.max(10, Math.min(500, n));
        this.postMessage({ type: 'set_history_retention', payload: { maxRuns: this.state.historyRetention } });
    },

    setPlaceholderArchiveName(name) {
        if (name && name.includes('/')) {
            alert('Slash character "/" is not allowed in placeholder names.');
            return;
        }
        this.state.placeholderArchiveName = name || 'archive';
        this.postMessage({ type: 'save_session', payload: { placeholderArchiveName: this.state.placeholderArchiveName } });
    },

    // ── Projects Root Folder ───────────────────────────────────────
    showProjectsRootDialog(current, defaultPath) {
        const path = prompt(
            'Projects Root Folder\n\n' +
            'Enter the path where all project data will be stored.\n' +
            'Leave empty to use default location.\n\n' +
            'Default: ' + (defaultPath || this.state.projectsRootDefault) + '\n' +
            'Current: ' + (current || this.state.projectsRoot || '(default)') + '\n\n' +
            'Note: Restart required after change.',
            current || this.state.projectsRoot || ''
        );
        if (path !== null) {
            this.setProjectsRoot(path.trim());
        }
    },

    setProjectsRoot(path) {
        this.state.projectsRoot = path;
        this.postMessage({ type: 'set_projects_root', payload: { path } });
    },

    browseProjectsRoot() {
        const input = document.getElementById('config-projects-root');
        const currentPath = input?.value || this.state.projectsRoot || '';
        this.postMessage({ type: 'browse_folder', payload: { defaultPath: currentPath } });
    },

    applyProjectsRoot() {
        const input = document.getElementById('config-projects-root');
        if (input) {
            this.setProjectsRoot(input.value.trim());
        }
    },

    resetProjectsRoot() {
        const input = document.getElementById('config-projects-root');
        if (input) input.value = '';
        this.setProjectsRoot('');
    },

    // ── Setup Wizard ──────────────────────────────────────────────
    get SW_TEMPLATES() {
        const t = key => this.t(key);
        return [
            {
                id: 'translate',
                label: '🌐 ' + t('TranslationProject'),
                desc: t('TranslationDesc'),
                sample: t('TranslationSample'),
                pipeline: t('TranslationPipeline')
            },
            {
                id: 'summarize',
                label: '📝 ' + t('SummarizeText'),
                desc: t('SummarizeDesc'),
                sample: t('SummarizeSample'),
                pipeline: t('SummarizePipeline')
            },
            {
                id: 'review',
                label: '✏️ ' + t('ReviewText'),
                desc: t('ReviewDesc'),
                sample: t('ReviewSample'),
                pipeline: t('ReviewPipeline')
            },
            {
                id: 'image',
                label: '🖼️ ' + t('ImageAnalysis'),
                desc: t('ImageAnalysisDesc'),
                sample: t('ImageAnalysisSample'),
                pipeline: t('ImageAnalysisPipeline')
            },
            {
                id: 'video',
                label: '🎥 ' + t('VideoSummary'),
                desc: t('VideoSummaryDesc'),
                sample: t('VideoSummarySample'),
                pipeline: t('VideoSummaryPipeline')
            },
            {
                id: 'music',
                label: '🎵 ' + t('MusicAnalysis'),
                desc: t('MusicAnalysisDesc'),
                sample: t('MusicAnalysisSample'),
                pipeline: t('MusicAnalysisPipeline')
            },
            {
                id: 'free',
                label: '🆓 ' + t('FreeForm'),
                desc: t('FreeFormDesc'),
                sample: '',
                pipeline: ''
            }
        ];
    },

    sw_: { step: 0, tabName: '', templateId: 'free', content: '', pipelineName: '' },

    showSetupWizard() {
        this.sw_ = { step: 0, tabName: 'Project ' + new Date().toLocaleDateString(), templateId: 'free', content: '', pipelineName: '', files: [] };
        document.getElementById('setup-wizard-modal').classList.add('visible');
        this.swRender();
    },

    closeSetupWizard() {
        document.getElementById('setup-wizard-modal').classList.remove('visible');
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            this.clearAllSpeakingStyles();
        }
    },

    swRender() {
        const s = this.sw_;
        const total = 4;
        const cur = s.step;

        // Progress dots
        document.getElementById('sw-progress').innerHTML =
            Array.from({length: total}, (_, i) =>
                `<span class="wizard-dot${i === cur ? ' active' : i < cur ? ' done' : ''}"></span>`
            ).join('');

        const body = document.getElementById('sw-body');
        const nextBtn = document.getElementById('sw-next');

        if (cur === 0) {
            // Step 1: Template selection + Project name
            body.innerHTML = `
                <div class="wizard-icon">🚀</div>
                <h2 class="wizard-title">${this.t('WhatToStart')}</h2>
                <div class="sw-field">
                    <label class="sw-label">${this.t('ProjectName')}</label>
                    <input type="text" id="sw-tab-name" class="sw-input" value="${this.escapeHtml(s.tabName)}" placeholder="${this.t('ProjectNamePlaceholder')}">
                </div>
                <div class="sw-label" style="margin:14px 0 8px">${this.t('SelectTemplate')}</div>
                <div class="sw-templates">${
                    this.SW_TEMPLATES.map(t => `
                        <div class="sw-template${s.templateId === t.id ? ' selected' : ''}" onclick="app.swSelectTemplate('${t.id}')">
                            <div class="sw-template-label">${t.label}</div>
                            <div class="sw-template-desc">${t.desc}</div>
                        </div>`).join('')
                }</div>`;
            nextBtn.textContent = 'Next →';
            nextBtn.onclick = () => {
                const nameEl = document.getElementById('sw-tab-name');
                this.sw_.tabName = nameEl ? nameEl.value.trim() || this.t('Project') : this.t('Project');
                const tmpl = this.SW_TEMPLATES.find(t => t.id === this.sw_.templateId) || this.SW_TEMPLATES.find(t => t.id === 'free');
                if (!this.sw_.content) this.sw_.content = tmpl.sample;
                this.sw_.pipelineName = tmpl.pipeline;
                this.swNext();
            };

        } else if (cur === 1) {
            // Step 2: Content input
            body.innerHTML = `
                <div class="wizard-icon">📄</div>
                <h2 class="wizard-title">${this.t('EnterInitialContent')}</h2>
                <p class="wizard-text" style="margin-bottom:10px">${this.t('EnterContentDesc')}</p>
                <div class="textarea-container">
                    <textarea id="sw-content" class="sw-textarea" placeholder="${this.t('ContentPlaceholder')}">${this.escapeHtml(s.content)}</textarea>
                    <button class="speak-btn" id="sw-speak-btn" onclick="app.toggleSpeak('sw-content', 'sw-speak-btn')" title="${this.t('TextToSpeech')}">🔊</button>
                    <button class="voice-btn" id="sw-voice-btn" onclick="app.toggleVoiceInput('sw-content', 'sw-voice-btn')" title="${this.t('VoiceInput')}">🎙️</button>
                </div>
                <div class="sw-files-list" id="sw-files-list"></div>
                <div class="sw-hint">💡 ${this.t('MediaDropHint')}</div>`;
            
            const textarea = document.getElementById('sw-content');
            if (textarea) {
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                    textarea.addEventListener(eventName, (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }, false);
                });

                ['dragenter', 'dragover'].forEach(eventName => {
                    textarea.addEventListener(eventName, () => {
                        textarea.classList.add('dragover');
                    }, false);
                });

                ['dragleave', 'drop'].forEach(eventName => {
                    textarea.addEventListener(eventName, () => {
                        textarea.classList.remove('dragover');
                    }, false);
                });

                textarea.addEventListener('drop', (e) => {
                    const dt = e.dataTransfer;
                    const files = dt.files;
                    this.swHandleFiles(files);
                }, false);
            }

            this.swRenderFilesList();

            nextBtn.textContent = 'Next →';
            nextBtn.onclick = () => {
                const el = document.getElementById('sw-content');
                this.sw_.content = el ? el.value : '';
                this.swNext();
            };

        } else if (cur === 2) {
            // Step 3: Pipeline selection
            const pipelines = (this.state.pipelines || []).map(p => p.name);
            const hasPipelines = pipelines.length > 0;
            body.innerHTML = `
                <div class="wizard-icon">🔧</div>
                <h2 class="wizard-title">${this.t('SelectPipelineOptional')}</h2>
                <p class="wizard-text" style="margin-bottom:12px">${this.t('SelectPipelineDesc')}</p>
                <div class="sw-pipeline-list">
                    <div class="sw-pipeline-item${!s.pipelineName ? ' selected' : ''}" onclick="app.swSelectPipeline('')">
                        <span>⏭ ${this.t('SkipRunLater')}</span>
                    </div>
                    ${hasPipelines ? pipelines.map(name => `
                        <div class="sw-pipeline-item${s.pipelineName === name ? ' selected' : ''}" onclick="app.swSelectPipeline('${this.escapeHtml(name)}')">
                            <span>🔧 ${this.escapeHtml(name)}</span>
                        </div>`).join('') : `<div class="sw-hint" style="margin-top:8px">⚠ ${this.t('NoPipelinesYet')}</div>`}
                </div>`;
            nextBtn.textContent = this.t('Confirm') + ' →';
            nextBtn.onclick = () => this.swNext();

        } else if (cur === 3) {
            // Step 4: Confirmation
            const tmpl = this.SW_TEMPLATES.find(t => t.id === s.templateId);
            const preview = s.content ? s.content.slice(0, 80) + (s.content.length > 80 ? '…' : '') : this.t('None');
            const filesCount = s.files ? s.files.length : 0;
            const filesSummary = filesCount > 0 ? this.t('FilesAttached').replace('{count}', filesCount) : this.t('None');
            body.innerHTML = `
                <div class="wizard-icon">✅</div>
                <h2 class="wizard-title">${this.t('ReadyToGo')}</h2>
                <div class="sw-summary">
                    <div class="sw-summary-row"><span class="sw-summary-label">${this.t('ProjectName')}</span><span>${this.escapeHtml(s.tabName)}</span></div>
                    <div class="sw-summary-row"><span class="sw-summary-label">${this.t('Template')}</span><span>${tmpl ? tmpl.label : this.t('FreeForm')}</span></div>
                    <div class="sw-summary-row"><span class="sw-summary-label">${this.t('Content')}</span><span class="sw-summary-preview">${this.escapeHtml(preview)}</span></div>
                    <div class="sw-summary-row"><span class="sw-summary-label">${this.t('Attachments')}</span><span>${filesSummary}</span></div>
                    <div class="sw-summary-row"><span class="sw-summary-label">${this.t('Pipeline')}</span><span>${s.pipelineName ? '🔧 ' + this.escapeHtml(s.pipelineName) : this.t('Skip')}</span></div>
                </div>`;
            nextBtn.textContent = '🚀 ' + this.t('Create');
            nextBtn.onclick = () => this.swCreate();
        }

        document.getElementById('sw-prev').style.visibility = cur === 0 ? 'hidden' : '';
        document.getElementById('sw-cancel').style.display = cur === 3 ? 'none' : '';
    },

    swSelectTemplate(id) {
        this.sw_.templateId = id;
        const tmpl = this.SW_TEMPLATES.find(t => t.id === id) || this.SW_TEMPLATES.find(t => t.id === 'free');
        this.sw_.content = tmpl.sample;
        this.sw_.pipelineName = tmpl.pipeline;
        this.swRender();
    },

    swSelectPipeline(name) {
        this.sw_.pipelineName = name;
        this.swRender();
    },

    swNext() {
        if (this.sw_.step < 3) { this.sw_.step++; this.swRender(); }
    },

    swPrev() {
        if (this.sw_.step > 0) { this.sw_.step--; this.swRender(); }
    },

    swHandleFiles(files) {
        if (!files || files.length === 0) return;
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const reader = new FileReader();
            
            const isText = f.type.startsWith('text/') || f.name.endsWith('.txt') || f.name.endsWith('.json') || f.name.endsWith('.md');
            
            reader.onload = (e) => {
                const res = e.target.result;
                if (isText) {
                    const ta = document.getElementById('sw-content');
                    if (ta && !ta.value.trim()) {
                        ta.value = res;
                        this.sw_.content = res;
                    }
                }
                
                let base64Data = '';
                if (isText) {
                    try {
                        base64Data = btoa(unescape(encodeURIComponent(res)));
                    } catch {
                        base64Data = btoa(res);
                    }
                } else {
                    const parts = res.split(',');
                    base64Data = parts.length > 1 ? parts[1] : res;
                }
                
                if (!this.sw_.files) this.sw_.files = [];
                if (!this.sw_.files.some(existing => existing.name === f.name)) {
                    this.sw_.files.push({
                        name: f.name,
                        size: f.size,
                        mimetype: f.type || 'application/octet-stream',
                        content: base64Data
                    });
                    this.swRenderFilesList();
                }
            };
            
            if (isText) {
                reader.readAsText(f);
            } else {
                reader.readAsDataURL(f);
            }
        }
    },

    swRenderFilesList() {
        const el = document.getElementById('sw-files-list');
        if (!el) return;
        const files = this.sw_.files || [];
        if (files.length === 0) {
            el.innerHTML = '';
            return;
        }
        el.innerHTML = files.map((f, i) => `
            <div class="sw-file-item">
                <div style="display:flex; flex-direction:column; gap:2px">
                    <span class="sw-file-name" title="${this.escapeHtml(f.name)}">${this.escapeHtml(f.name)}</span>
                    <span class="sw-file-info">${f.mimetype} (${Math.round(f.size/1024)} KB)</span>
                </div>
                <button class="sw-file-remove" onclick="app.swRemoveFile(${i})">×</button>
            </div>
        `).join('');
    },

    swRemoveFile(idx) {
        if (this.sw_.files) {
            this.sw_.files.splice(idx, 1);
            this.swRenderFilesList();
        }
    },

    swCreate() {
        const s = this.sw_;
        const safeB64 = str => { try { return btoa(unescape(encodeURIComponent(str))); } catch { return btoa(str || ''); } };

        const attachments = (s.files || []).map(f => ({
            id: 'att_' + Math.random().toString(36).substring(2, 11),
            mimetype: f.mimetype,
            inline: true,
            content: f.content,
            file: f.name,
            size: f.size
        }));

        // Build root node with content
        const rootNode = {
            title: safeB64(s.tabName),
            content: safeB64(s.content),
            mimetype: 'text/plain',
            attachments: attachments,
            children: [],
            nodeType: 'root'
        };

        // Create new tab in state
        const fileName = 'setup_' + Date.now() + '.json';
        const tab = { name: s.tabName, file: fileName, root: rootNode };
        this.state.tabs.push(tab);
        this.state.activeTab = this.state.tabs.length - 1;
        this.state.currentNodePath = '';

        // Save via bridge
        this.postMessage({ type: 'save_node', payload: { tabFile: fileName, root: rootNode } });

        // Also save session
        this.postMessage({ type: 'save_session', payload: {
            tabs: this.state.tabs.map(t => ({ name: t.name, file: t.file }))
        }});

        this.renderTabs();
        this.renderTree();
        this.renderList();
        this.loadEditor('');
        this.closeSetupWizard();
        this.addLog(`🚀 ${this.t('ProjectCreated').replace('{name}', s.tabName)}`);

        // Run pipeline if selected
        if (s.pipelineName) {
            setTimeout(() => this.runPipeline(s.pipelineName), 300);
        }
    },

    // ── Pipeline Manager ──────────────────────────────────────────

    PM_STEP_TYPES: {
        ai:         { icon: '🤖', label: 'AI Call', fields: ['provider','model','systemPrompt','userPrompt','temperature','maxTokens','customParams','attachMedia'] },
        wizard:     { icon: '🚀', label: 'Wizard', fields: ['wizard','wizardData'] },
        manual:     { icon: '📝', label: 'Manual Review', fields: ['mode','prompt','choices'] },
        command:    { icon: '⚙️', label: 'CLI Command', fields: ['command','args','workingDir','timeout','resultAs'] },
        tool:       { icon: '🔧', label: 'External Tool', fields: ['command','args','waitForExit','resultAs','resultFile','confirm'] },
        fetch:      { icon: '🌐', label: 'HTTP Fetch', fields: ['url','method','auth','resultAs'] },
        condition:  { icon: '🔀', label: 'Condition', fields: ['expression','operator','value','onTrue','onFalse'] },
        transform:  { icon: '🔄', label: 'Transform', fields: ['engine','expression','input'] },
        call_pipeline: { icon: '📦', label: 'Call Pipeline', fields: ['pipelineName','input','inheritAttachments'] },
        foreach:    { icon: '🔁', label: 'Foreach', fields: ['input','itemVariable','concurrency'] },
        parallel:   { icon: '⚡', label: 'Parallel', fields: ['branches','outputMode'] },
        wait:       { icon: '⏱️', label: 'Wait', fields: ['durationMs','until','pollIntervalMs','timeoutMs'] },
        history:    { icon: '📜', label: 'History', fields: ['runId','stepIndex','field'] }
    },

    pmState_: { pipelines: [], selectedIndex: -1, dirty: false, stepEditIndex: -1 },

    showPipelineManager() {
        this.pmState_.pipelines = (this.state.pipelines || []).slice();
        this.pmState_.selectedIndex = -1;
        this.pmState_.dirty = false;
        document.getElementById('pipeline-manager-modal').classList.add('visible');
        this.pmRenderPipelineList();
        document.getElementById('pm-editor').style.display = 'none';
        document.getElementById('pm-empty').style.display = '';
        document.getElementById('pm-mermaid').innerHTML = '';
    },

    closePipelineManager() {
        document.getElementById('pipeline-manager-modal').classList.remove('visible');
    },

    pmRenderPipelineList() {
        const el = document.getElementById('pm-pipeline-list');
        if (!el) return;
        const list = this.pmState_.pipelines;
        el.innerHTML = list.map((p, i) => `
            <div class="pm-pipeline-item${i === this.pmState_.selectedIndex ? ' active' : ''}"
                 onclick="app.pmSelectPipeline(${i})">
                ${this.escapeHtml(p.name || 'Unnamed')}
            </div>`).join('');
    },

    pmSelectPipeline(index) {
        this.pmState_.selectedIndex = index;
        this.pmState_.dirty = false;
        this.pmRenderPipelineList();
        this.pmLoadEditor();
    },

    pmNewPipeline() {
        const list = this.pmState_.pipelines;
        const name = 'New Pipeline ' + (list.length + 1);
        list.push({ name, mode: 'basic', outputMode: 'child', outputNaming: '{pipeline_name}_{timestamp}', retryCount: 3, retryDelayMs: 2000, steps: [] });
        this.pmState_.selectedIndex = list.length - 1;
        this.pmState_.dirty = true;
        this.pmRenderPipelineList();
        this.pmLoadEditor();
        this.addLog('➕ New pipeline created');
    },

    pmSwitchMode(mode, btn) {
        document.querySelectorAll('.pm-mode-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('pm-body-basic').style.display = mode === 'basic' ? '' : 'none';
        document.getElementById('pm-body-expert').style.display = mode === 'expert' ? '' : 'none';
        this.pmDirty();
    },

    pmLoadEditor() {
        const i = this.pmState_.selectedIndex;
        const list = this.pmState_.pipelines;
        if (i < 0 || i >= list.length) {
            document.getElementById('pm-editor').style.display = 'none';
            document.getElementById('pm-empty').style.display = '';
            return;
        }
        document.getElementById('pm-editor').style.display = '';
        document.getElementById('pm-empty').style.display = 'none';
        const p = list[i];
        document.getElementById('pm-name').value = p.name || '';
        document.getElementById('pm-output-mode').value = p.outputMode || 'child';
        document.getElementById('pm-output-naming').value = p.outputNaming || '{pipeline_name}_{timestamp}';
        document.getElementById('pm-retry-count').value = p.retryCount || 3;
        document.getElementById('pm-retry-delay').value = p.retryDelayMs || 2000;
        this.pmRenderSteps();
    },

    pmRenderSteps() {
        const el = document.getElementById('pm-step-list');
        const i = this.pmState_.selectedIndex;
        const list = this.pmState_.pipelines;
        if (!el || i < 0 || i >= list.length) return;
        const steps = list[i].steps || [];
        const info = this.PM_STEP_TYPES;
        el.innerHTML = steps.map((s, si) => {
            const typeInfo = info[s.type] || { icon: '❓', label: s.type };
            return `<div class="pm-step-item">
                <span class="pm-step-drag" title="Drag to reorder">⠿</span>
                <span class="pm-step-icon">${typeInfo.icon}</span>
                <span class="pm-step-name" onclick="app.pmEditStep(${si})">${this.escapeHtml(s.name || typeInfo.label)}</span>
                <span class="pm-step-type-badge">${this.escapeHtml(s.type)}</span>
                <button class="pm-step-edit-btn" onclick="app.pmEditStep(${si})">✏</button>
                <button class="pm-step-del-btn" onclick="app.pmDeleteStep(${si})">✕</button>
            </div>`;
        }).join('');
        this.pmRenderMermaid();
    },

    pmAddStep() {
        const sel = document.getElementById('pm-step-type-select');
        const type = sel.value;
        const typeInfo = this.PM_STEP_TYPES[type] || { icon: '❓', label: type };
        const i = this.pmState_.selectedIndex;
        const list = this.pmState_.pipelines;
        if (i < 0 || i >= list.length) return;
        if (!list[i].steps) list[i].steps = [];
        list[i].steps.push({ name: typeInfo.label, type, params: {} });
        this.pmState_.dirty = true;
        this.pmRenderSteps();
        this.addLog(`➕ Step added: ${typeInfo.label}`);
    },

    pmEditStep(index) {
        this.pmState_.stepEditIndex = index;
        const i = this.pmState_.selectedIndex;
        const list = this.pmState_.pipelines;
        if (i < 0 || i >= list.length) return;
        const step = list[i].steps[index];
        if (!step) return;
        const typeInfo = this.PM_STEP_TYPES[step.type] || { icon: '❓', label: step.type, fields: [] };
        document.getElementById('pm-step-edit-title').textContent = `✏ ${typeInfo.icon} ${typeInfo.label}`;
        const form = document.getElementById('pm-step-edit-form');
        form.innerHTML = `
            <div class="field-row">
                <label>Name</label>
                <input type="text" id="pms-name" value="${this.escapeHtml(step.name || '')}">
            </div>
            <div class="field-row">
                <label>Type</label>
                <select id="pms-type" onchange="app.pmStepEditTypeChanged()">
                    ${Object.entries(this.PM_STEP_TYPES).map(([k, v]) =>
                        `<option value="${k}"${k === step.type ? ' selected' : ''}>${v.icon} ${v.label}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="pm-step-edit-fields" id="pms-fields">${this.pmBuildFieldInputs(step)}</div>`;
        document.getElementById('pm-step-edit-modal').classList.add('visible');
    },

    pmStepEditTypeChanged() {
        const stepType = document.getElementById('pms-type').value;
        const i = this.pmState_.selectedIndex;
        const si = this.pmState_.stepEditIndex;
        const list = this.pmState_.pipelines;
        if (i < 0 || i >= list.length || si < 0) return;
        const step = list[i].steps[si];
        if (!step) return;
        step.type = stepType;
        const typeInfo = this.PM_STEP_TYPES[stepType] || { icon: '❓', label: stepType, fields: [] };
        document.getElementById('pm-step-edit-title').textContent = `✏ ${typeInfo.icon} ${typeInfo.label}`;
        // Keep name if exists, otherwise use type label
        if (!step.name || !step.name.trim()) step.name = typeInfo.label;
        document.getElementById('pms-name').value = step.name;
        document.getElementById('pms-fields').innerHTML = this.pmBuildFieldInputs(step);
    },

    pmBuildFieldInputs(step) {
        const typeInfo = this.PM_STEP_TYPES[step.type] || { fields: [] };
        return typeInfo.fields.map(f => {
            const val = step.params && step.params[f] ? step.params[f] : '';
            if (f === 'customParams') {
                const jsonStr = val && typeof val === 'object' ? JSON.stringify(val, null, 2) : (val || '');
                return `<div class="field-row" style="flex-direction:column;align-items:stretch">
                    <label>Custom Params (JSON)</label>
                    <textarea id="pms-${f}" style="height:60px;font-family:monospace;font-size:11px" placeholder='{"aspect_ratio": "16:9"}'>${this.escapeHtml(jsonStr)}</textarea>
                </div>`;
            }
            if (f === 'provider') {
                return `<div class="field-row">
                    <label>Provider</label>
                    <select id="pms-${f}">
                        <option value="openai"${val === 'openai' ? ' selected' : ''}>OpenAI</option>
                        <option value="anthropic"${val === 'anthropic' ? ' selected' : ''}>Anthropic</option>
                        <option value="gemini"${val === 'gemini' ? ' selected' : ''}>Gemini</option>
                        <option value="ollama"${val === 'ollama' ? ' selected' : ''}>Ollama</option>
                    </select>
                </div>`;
            }
            if (f === 'mode') {
                return `<div class="field-row">
                    <label>Mode</label>
                    <select id="pms-${f}">
                        <option value="view"${val === 'view' ? ' selected' : ''}>View</option>
                        <option value="edit"${val === 'edit' ? ' selected' : ''}>Edit</option>
                        <option value="select"${val === 'select' ? ' selected' : ''}>Select</option>
                    </select>
                </div>`;
            }
            if (f === 'method') {
                return `<div class="field-row">
                    <label>Method</label>
                    <select id="pms-${f}">
                        <option value="GET"${val === 'GET' ? ' selected' : ''}>GET</option>
                        <option value="POST"${val === 'POST' ? ' selected' : ''}>POST</option>
                    </select>
                </div>`;
            }
            if (f === 'operator') {
                return `<div class="field-row">
                    <label>Operator</label>
                    <select id="pms-${f}">
                        <option value="contains"${val === 'contains' ? ' selected' : ''}>contains</option>
                        <option value="equals"${val === 'equals' ? ' selected' : ''}>equals</option>
                        <option value="startsWith"${val === 'startsWith' ? ' selected' : ''}>startsWith</option>
                        <option value="regex"${val === 'regex' ? ' selected' : ''}>regex</option>
                    </select>
                </div>`;
            }
            if (f === 'resultAs') {
                return `<div class="field-row">
                    <label>Result As</label>
                    <select id="pms-${f}">
                        <option value="text"${val === 'text' ? ' selected' : ''}>text</option>
                        <option value="exitcode"${val === 'exitcode' ? ' selected' : ''}>exitcode</option>
                        <option value="file"${val === 'file' ? ' selected' : ''}>file</option>
                        <option value="attachment"${val === 'attachment' ? ' selected' : ''}>attachment</option>
                        <option value="json"${val === 'json' ? ' selected' : ''}>json</option>
                    </select>
                </div>`;
            }
            if (f === 'engine') {
                return `<div class="field-row">
                    <label>Engine</label>
                    <select id="pms-${f}">
                        <option value="regex"${val === 'regex' ? ' selected' : ''}>regex</option>
                        <option value="json_path"${val === 'json_path' ? ' selected' : ''}>json_path</option>
                        <option value="template"${val === 'template' ? ' selected' : ''}>template</option>
                    </select>
                </div>`;
            }
            if (f === 'waitForExit' || f === 'confirm' || f === 'inheritAttachments') {
                return `<div class="field-row">
                    <label>${f}</label>
                    <select id="pms-${f}">
                        <option value="true"${val === 'true' ? ' selected' : ''}>true</option>
                        <option value="false"${val !== 'true' ? ' selected' : ''}>false</option>
                    </select>
                </div>`;
            }
            if (f === 'temperature' || f === 'retryCount' || f === 'retryDelayMs' || f === 'timeout' || f === 'timeoutMs' || f === 'durationMs' || f === 'concurrency' || f === 'maxTokens' || f === 'pollIntervalMs') {
                return `<div class="field-row">
                    <label>${f}</label>
                    <input type="number" step="any" id="pms-${f}" value="${this.escapeHtml(val || '')}">
                </div>`;
            }
            if (f === 'systemPrompt' || f === 'userPrompt' || f === 'prompt' || f === 'choices') {
                return `<div class="field-row">
                    <label>${f}</label>
                    <textarea id="pms-${f}">${this.escapeHtml(val || '')}</textarea>
                </div>`;
            }
            return `<div class="field-row">
                <label>${f}</label>
                <input type="text" id="pms-${f}" value="${this.escapeHtml(val || '')}">
            </div>`;
        }).join('');
    },

    pmSaveStepEdit() {
        const i = this.pmState_.selectedIndex;
        const si = this.pmState_.stepEditIndex;
        const list = this.pmState_.pipelines;
        if (i < 0 || i >= list.length || si < 0) return;
        const step = list[i].steps[si];
        if (!step) return;

        let customParamsObj = {};
        const customParamsEl = document.getElementById('pms-customParams');
        if (customParamsEl) {
            const rawVal = customParamsEl.value.trim();
            if (rawVal !== '') {
                try {
                    customParamsObj = JSON.parse(rawVal);
                } catch (err) {
                    alert(this.t('InvalidJSONCustomParams'));
                    return;
                }
            }
        }

        step.name = document.getElementById('pms-name')?.value || step.name;
        step.type = document.getElementById('pms-type')?.value || step.type;
        const typeInfo = this.PM_STEP_TYPES[step.type] || { fields: [] };
        if (!step.params) step.params = {};
        typeInfo.fields.forEach(f => {
            if (f === 'customParams') {
                step.params[f] = customParamsObj;
            } else {
                const el = document.getElementById('pms-' + f);
                if (el) step.params[f] = el.value;
            }
        });
        this.pmState_.dirty = true;
        this.pmCloseStepEdit();
        this.pmRenderSteps();
        this.addLog(`✏ Step "${step.name}" updated`);
    },

    pmCloseStepEdit() {
        document.getElementById('pm-step-edit-modal').classList.remove('visible');
        this.pmState_.stepEditIndex = -1;
    },

    pmDeleteStep(index) {
        const i = this.pmState_.selectedIndex;
        const list = this.pmState_.pipelines;
        if (i < 0 || i >= list.length) return;
        list[i].steps.splice(index, 1);
        this.pmState_.dirty = true;
        this.pmRenderSteps();
        this.addLog('🗑 Step removed');
    },

    pmMoveStep(index, dir) {
        const i = this.pmState_.selectedIndex;
        const list = this.pmState_.pipelines;
        if (i < 0 || i >= list.length) return;
        const steps = list[i].steps;
        const newIdx = index + dir;
        if (newIdx < 0 || newIdx >= steps.length) return;
        [steps[index], steps[newIdx]] = [steps[newIdx], steps[index]];
        this.pmState_.dirty = true;
        this.pmRenderSteps();
    },

    pmRenderMermaid() {
        const el = document.getElementById('pm-mermaid');
        const i = this.pmState_.selectedIndex;
        const list = this.pmState_.pipelines;
        if (!el || i < 0 || i >= list.length) { if (el) el.innerHTML = ''; return; }
        const steps = list[i].steps || [];
        if (steps.length === 0) { el.innerHTML = '<div style="color:#666;font-size:12px">No steps</div>'; return; }
        // Build mermaid flowchart
        let mermaidDef = 'graph LR\n';
        mermaidDef += '    Input[Input]\n';
        steps.forEach((s, si) => {
            const safeName = (s.name || 'step' + si).replace(/[^a-zA-Z0-9]/g, '_');
            const displayName = (s.name || s.type).replace(/"/g, "'");
            mermaidDef += `    ${safeName}["${si+1}. ${displayName}"]\n`;
            if (si === 0) mermaidDef += `    Input --> ${safeName}\n`;
            else {
                const prev = (steps[si-1].name || 'step' + (si-1)).replace(/[^a-zA-Z0-9]/g, '_');
                mermaidDef += `    ${prev} --> ${safeName}\n`;
            }
        });
        const last = (steps[steps.length-1].name || 'step' + (steps.length-1)).replace(/[^a-zA-Z0-9]/g, '_');
        mermaidDef += `    ${last} --> Output[Output]\n`;
        el.innerHTML = `<div class="mermaid">${mermaidDef}</div>`;
        // Render mermaid
        if (window.mermaid) {
            try {
                mermaid.run({ nodes: [el.querySelector('.mermaid')] });
            } catch(e) {
                // mermaid may already have rendered
            }
        }
    },

    pmGetCurrentPipeline() {
        const i = this.pmState_.selectedIndex;
        const list = this.pmState_.pipelines;
        if (i < 0 || i >= list.length) return null;
        const p = list[i];
        return {
            name: document.getElementById('pm-name')?.value || p.name,
            mode: 'basic',
            outputMode: document.getElementById('pm-output-mode')?.value || 'child',
            outputNaming: document.getElementById('pm-output-naming')?.value || '{pipeline_name}_{timestamp}',
            retryCount: parseInt(document.getElementById('pm-retry-count')?.value) || 3,
            retryDelayMs: parseInt(document.getElementById('pm-retry-delay')?.value) || 2000,
            steps: p.steps || []
        };
    },

    pmSave() {
        const pipeline = this.pmGetCurrentPipeline();
        if (!pipeline) return;
        // Update state
        const i = this.pmState_.selectedIndex;
        this.pmState_.pipelines[i] = pipeline;
        this.pmState_.dirty = false;
        // Send to C++
        this.postMessage({ type: 'save_pipeline', payload: pipeline });
        this.addLog(`💾 Pipeline "${pipeline.name}" saved`);
    },

    pmDelete() {
        const i = this.pmState_.selectedIndex;
        const list = this.pmState_.pipelines;
        if (i < 0 || i >= list.length) return;
        const name = list[i].name;
        if (!confirm(this.t('DeletePipelineConfirm').replace('{name}', name))) return;
        this.postMessage({ type: 'delete_pipeline', payload: { name } });
        list.splice(i, 1);
        this.pmState_.selectedIndex = Math.min(i, list.length - 1);
        this.pmState_.dirty = false;
        this.pmRenderPipelineList();
        this.pmLoadEditor();
        this.addLog(`🗑 Pipeline "${name}" deleted`);
    },

    pmRunNow() {
        this.pmSave();
        const pipeline = this.pmGetCurrentPipeline();
        if (!pipeline || !pipeline.steps || pipeline.steps.length === 0) {
            this.addLog('⚠ No steps in pipeline');
            return;
        }
        const node = this.getNodeByPath(this.state.currentNodePath);
        if (!node) { this.addLog('⚠ Select a node first'); return; }
        const content = node.content ? (() => { try { return decodeURIComponent(escape(atob(node.content))); } catch { return atob(node.content); } })() : '';
        const tab = this.state.tabs[this.state.activeTab];
        this.postMessage({ type: 'run_pipeline', payload: {
            pipelineName: pipeline.name,
            nodeId: this.state.currentNodePath || '',
            tabFile: tab ? tab.file : '',
            content
        }});
        this.state.pipelineRun.running = true;
        this.closePipelineManager();
        this.addLog(`▶ Pipeline "${pipeline.name}" started`);
    },

    pmDirty() {
        this.pmState_.dirty = true;
    },

    // ── Hint tooltips ──────────────────────────────────────────────
    setupHints() {
        const tooltip = document.getElementById('hint-tooltip');
        if (!tooltip) return;
        let hintTimer = null;

        document.addEventListener('mouseover', (e) => {
            const el = e.target.closest('[data-hint]');
            if (!el) return;
            clearTimeout(hintTimer);
            hintTimer = setTimeout(() => {
                const hint = el.getAttribute('data-hint');
                if (!hint) return;
                tooltip.textContent = hint;
                tooltip.style.display = 'block';
                const r = el.getBoundingClientRect();
                let left = r.left;
                let top = r.bottom + 6;
                // Keep within viewport
                tooltip.style.left = '0';
                tooltip.style.top = '0';
                tooltip.style.display = 'block';
                const tw = tooltip.offsetWidth;
                if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
                if (left < 4) left = 4;
                tooltip.style.left = left + 'px';
                tooltip.style.top = top + 'px';
            }, 500);
        });

        document.addEventListener('mouseout', (e) => {
            const el = e.target.closest('[data-hint]');
            if (!el) return;
            clearTimeout(hintTimer);
            tooltip.style.display = 'none';
        });

        document.addEventListener('click', () => {
            clearTimeout(hintTimer);
            tooltip.style.display = 'none';
        });
    },

    // Keyboard shortcuts
    handleKey(e) {
        if (e.ctrlKey && e.key === 's') { e.preventDefault(); this.saveFile(); }
        if (e.ctrlKey && e.key === 'f') { e.preventDefault(); document.getElementById('search-box')?.focus(); }
        if (e.ctrlKey && e.key === 'r') { e.preventDefault(); this.showRecipeManager(); }
        if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); this.navBack(); }
        if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); this.navForward(); }
        if (e.key === 'F1') { e.preventDefault(); this.showWizard(); }
    },

    toggleVoiceInput(textareaId, buttonId) {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            this.addLog(`Voice Input Error\nOperation: toggleVoiceInput\nTextarea: ${textareaId}\nError: Voice input not supported in this browser\nAction: Use a browser that supports Web Speech API (Chrome, Edge)`);
            alert(this.t('VoiceInputNotSupportedAlert'));
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!this.voiceRecognitions_) {
            this.voiceRecognitions_ = {};
        }

        const textarea = document.getElementById(textareaId);
        const button = document.getElementById(buttonId);
        if (!textarea || !button) return;

        let rec = this.voiceRecognitions_[textareaId];

        if (rec) {
            rec.stop();
            return;
        }

        rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = false;
        rec.lang = this.state.language === 'ja' ? 'ja-JP' : 'en-US';

        rec.onstart = () => {
            button.classList.add('recording');
            button.title = this.t('StopVoiceInput');
            this.addLog('🎙️ ' + this.t('VoiceInputStarted'));
        };

        rec.onresult = (event) => {
            let resultText = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    resultText += event.results[i][0].transcript;
                }
            }
            if (resultText) {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const val = textarea.value;
                textarea.value = val.substring(0, start) + resultText + val.substring(end);
                
                const newCursorPos = start + resultText.length;
                textarea.setSelectionRange(newCursorPos, newCursorPos);
                textarea.focus();

                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                
                if (textareaId === 'node-content') {
                    this.updateNode();
                } else if (textareaId === 'sw-content') {
                    this.sw_.content = textarea.value;
                }
            }
        };

        rec.onerror = (event) => {
            this.addLog(`Speech Recognition Error\nOperation: toggleVoiceInput\nTextarea: ${textareaId}\nError: ${event.error}\nPossible causes: Microphone not available, permission denied, or network issue`);
            console.error('Speech recognition error:', event.error);
            cleanup();
        };

        rec.onend = () => {
            this.addLog('🎙️ ' + this.t('VoiceInputStopped'));
            cleanup();
        };

        const cleanup = () => {
            button.classList.remove('recording');
            button.title = this.t('VoiceInput');
            if (this.voiceRecognitions_[textareaId] === rec) {
                delete this.voiceRecognitions_[textareaId];
            }
        };

        this.voiceRecognitions_[textareaId] = rec;
        rec.start();
    },

    toggleSpeak(textareaId, buttonId) {
        if (!('speechSynthesis' in window)) {
            this.addLog(`Speech Synthesis Error\nOperation: toggleSpeak\nTextarea: ${textareaId}\nError: Speech synthesis not supported in this browser\nAction: Use a browser that supports Web Speech API (Chrome, Edge, Safari)`);
            alert(this.t('SpeechNotSupportedAlert'));
            return;
        }

        const textarea = document.getElementById(textareaId);
        const button = document.getElementById(buttonId);
        if (!textarea || !button) return;

        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            this.clearAllSpeakingStyles();
            this.addLog('🔊 ' + this.t('SpeechStopped'));
            return;
        }

        const text = textarea.value.trim();
        if (!text) {
            this.addLog('⚠ ' + this.t('NoTextToSpeak'));
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = this.state.language === 'ja' ? 'ja-JP' : 'en-US';

        utterance.onstart = () => {
            button.classList.add('speaking');
            button.title = this.t('StopSpeech');
            this.addLog('🔊 ' + this.t('SpeechStarted'));
        };

        utterance.onend = () => {
            button.classList.remove('speaking');
            button.title = this.t('TextToSpeech');
            this.addLog('🔊 ' + this.t('SpeechCompleted'));
        };

        utterance.onerror = (event) => {
            this.addLog(`Speech Synthesis Error\nOperation: toggleSpeak\nTextarea: ${textareaId}\nError: ${event.error}\nPossible causes: Audio output not available, voice not installed, or synthesis interrupted`);
            console.error('Speech synthesis error:', event.error);
            button.classList.remove('speaking');
            button.title = this.t('TextToSpeech');
        };

        window.speechSynthesis.speak(utterance);
    },

    clearAllSpeakingStyles() {
        document.querySelectorAll('.speak-btn').forEach(btn => {
            btn.classList.remove('speaking');
            btn.title = 'Text to Speech';
        });
    },

    // ── B3 Adapter Testing (Phase B1) ──────────────────────────────────────────

    testB3ConverterRoundTrip() {
        console.log('🧪 Testing B3 Converter Round-Trip...\n');

        // Test 1: Simple tree
        const simpleTree = {
            nodeType: 'root',
            title: 'Test Root',
            btType: 'sequence',
            children: [
                {
                    nodeType: 'assemble',
                    title: 'Action 1',
                    btType: 'leaf',
                    btAction: 'processPrompt',
                    btPrompt: btoa('Test Prompt')
                }
            ]
        };

        const b3Format = B3TreeConverter.wendToB3(simpleTree);
        console.log('✅ Converted to B3 format:', JSON.stringify(b3Format, null, 2));

        const backToWend = B3TreeConverter.b3ToWend(b3Format);
        console.log('✅ Converted back to Wend:', JSON.stringify(backToWend, null, 2));

        // Test 2: RepeatSequence
        const repeatSeqTree = {
            nodeType: 'root',
            title: 'Repeat Test',
            btType: 'repeatSequence',
            btRepeatCount: '3',
            children: [
                {
                    nodeType: 'assemble',
                    title: 'Loop Action',
                    btType: 'leaf',
                    btAction: 'processPrompt',
                    btPrompt: btoa('Loop Prompt'),
                    btOutputKey: 'result'
                }
            ]
        };

        const b3Repeat = B3TreeConverter.wendToB3(repeatSeqTree);
        console.log('✅ RepeatSequence converted:', b3Repeat.nodes[b3Repeat.root].name);

        const backRepeat = B3TreeConverter.b3ToWend(b3Repeat);
        if (backRepeat.btRepeatCount === '3') {
            console.log('✅ Repeat count preserved: 3');
        } else {
            console.log('❌ Repeat count not preserved');
        }

        console.log('✅ Converter round-trip tests completed');
        return true;
    },

    testB3Adapter() {
        console.log('🧪 Testing B3 Adapter initialization...\n');

        try {
            const adapter = new Behavior3Adapter(this);
            console.log('✅ Behavior3Adapter instantiated');

            // Test public API methods exist
            const methods = ['setTarget', 'run', 'step', 'pause', 'stop',
                            'getBlackboard', 'bbSetText', 'bbSetMedia',
                            'bbClearSlot', 'bbClearKey', 'getConfig', 'setConfig'];

            for (const method of methods) {
                if (typeof adapter[method] === 'function') {
                    console.log(`✅ Method ${method} exists`);
                } else {
                    console.log(`❌ Method ${method} missing`);
                }
            }

            // Test blackboard operations
            adapter.bbSetText('testVar', 'Hello');
            const bb = adapter.getBlackboard();
            if (bb.testVar && bb.testVar.text === 'Hello') {
                console.log('✅ Blackboard text storage works');
            }

            adapter.bbClearKey('testVar');
            const bb2 = adapter.getBlackboard();
            if (!bb2.testVar) {
                console.log('✅ Blackboard key clear works');
            }

            console.log('✅ B3Adapter tests completed');
            return true;
        } catch (e) {
            console.error('❌ B3Adapter test failed:', e);
            return false;
        }
    },

    testB3EngineReplacement() {
        console.log('🧪 Testing B3 Engine as drop-in replacement...\n');

        try {
            // Save current engine
            const originalEngine = this._bt;

            // Create B3 adapter
            const b3Engine = new Behavior3Adapter(this);
            console.log('✅ Created Behavior3Adapter instance');

            // Try swapping
            this._bt = b3Engine;
            console.log('✅ Swapped engine reference');

            // Verify it has same public API
            const apiMethods = ['setTarget', 'run', 'step', 'pause', 'stop',
                               'getBlackboard', 'getConfig', 'setConfig'];
            let allMethodsExist = true;
            for (const method of apiMethods) {
                if (typeof this._bt[method] !== 'function') {
                    console.log(`❌ Missing method: ${method}`);
                    allMethodsExist = false;
                }
            }

            if (allMethodsExist) {
                console.log('✅ All required API methods present');
                console.log('⚠️  NOTE: Engine swapped but tree execution not tested yet');
            }

            // Restore original for safety
            this._bt = originalEngine;
            console.log('✅ Restored original engine');

            return allMethodsExist;
        } catch (e) {
            console.error('❌ Engine replacement test failed:', e);
            return false;
        }
    },

    runB3AllTests() {
        console.log('🚀 Running all Phase B1 B3 tests...\n');

        const results = {
            converterTest: false,
            adapterTest: false,
            engineTest: false
        };

        try {
            results.converterTest = this.testB3ConverterRoundTrip();
            console.log('\n');
        } catch (e) {
            console.error('Converter test error:', e);
        }

        try {
            results.adapterTest = this.testB3Adapter();
            console.log('\n');
        } catch (e) {
            console.error('Adapter test error:', e);
        }

        try {
            results.engineTest = this.testB3EngineReplacement();
            console.log('\n');
        } catch (e) {
            console.error('Engine test error:', e);
        }

        console.log('📊 Test Summary:');
        console.log(`  Converter: ${results.converterTest ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  Adapter: ${results.adapterTest ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  Engine: ${results.engineTest ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  Overall: ${Object.values(results).every(x => x) ? '✅ ALL PASS' : '⚠️  SOME FAILED'}`);

        return Object.values(results).every(x => x);
    }
};

// Computed getter/setter for recipes (combines defaults and project recipes)
Object.defineProperty(app.state, 'recipes', {
    get() { return [...(this.defaultRecipes || []), ...(this.projectRecipes || [])]; },
    set(val) {
        this.projectRecipes = val || [];
        this.defaultRecipes = [];
    }
});

// Phase G: Task Manager Pane methods
Object.assign(app, {
    switchTreeTab(tabName) {
        const tabMap = {
            pipeline: () => {
                document.getElementById('tree-content').style.display = '';
                document.getElementById('file-tree-content').style.display = 'none';
                document.getElementById('btn-tree-tab-pipeline').classList.add('active');
                document.getElementById('btn-tree-tab-file').classList.remove('active');
            },
            file: () => {
                document.getElementById('tree-content').style.display = 'none';
                document.getElementById('file-tree-content').style.display = '';
                document.getElementById('btn-tree-tab-pipeline').classList.remove('active');
                document.getElementById('btn-tree-tab-file').classList.add('active');
            },
            manager: () => this.switchMsgTab('manager'),
        };

        if (tabMap[tabName]) {
            tabMap[tabName]();
        }
    },

    startTaskMetricsPolling() {
        this.updateTaskMetrics();
        if (!this._taskMetricsInterval) {
            this._taskMetricsInterval = setInterval(() => this.updateTaskMetrics(), 500);
        }
    },

    stopTaskMetricsPolling() {
        if (this._taskMetricsInterval) {
            clearInterval(this._taskMetricsInterval);
            this._taskMetricsInterval = null;
        }
    },

    async updateTaskMetrics() {
        try {
            const response = await fetch('http://127.0.0.1:18765/runs');
            const data = await response.json();

            if (!data.runs || !Array.isArray(data.runs)) {
                return;
            }

            const runs = data.runs;
            const groups = {};
            let activeCount = 0, queuedCount = 0, completedCount = 0, failedCount = 0;
            let totalTokens = 0, totalDuration = 0, completedDurations = 0;

            for (const run of runs) {
                const status = run.status || 'queued';
                if (status === 'running') activeCount++;
                else if (status === 'queued') queuedCount++;
                else if (status === 'completed') completedCount++;
                else if (status === 'failed') failedCount++;

                if (run.group) {
                    if (!groups[run.group]) {
                        groups[run.group] = { runIds: [], completed: 0, failed: 0, totalTokens: 0 };
                    }
                    groups[run.group].runIds.push(run.runId);
                    if (status === 'completed') groups[run.group].completed++;
                    if (status === 'failed') groups[run.group].failed++;
                    if (run.metrics?.totalTokens) groups[run.group].totalTokens += run.metrics.totalTokens;
                }

                if (run.metrics?.totalTokens) totalTokens += run.metrics.totalTokens;
                if (run.metrics?.duration) {
                    totalDuration += run.metrics.duration;
                    if (status === 'completed') completedDurations++;
                }
            }

            const avgDuration = completedDurations > 0 ? totalDuration / completedDurations : 0;
            const totalRuns = activeCount + queuedCount + completedCount + failedCount;

            // Update summary stats
            document.getElementById('task-active-count').textContent = activeCount;
            document.getElementById('task-queued-count').textContent = queuedCount;
            document.getElementById('task-completed-count').textContent = completedCount;
            document.getElementById('task-failed-count').textContent = failedCount;
            document.getElementById('task-avg-duration').textContent = this.formatDuration(avgDuration);
            document.getElementById('task-total-tokens').textContent = this.formatTokens(totalTokens);

            // Token rate (tokens per second across avg duration)
            const tokenRateEl = document.getElementById('task-token-rate');
            if (tokenRateEl) {
                if (avgDuration > 0 && totalTokens > 0) {
                    const rate = totalTokens / (avgDuration / 1000);
                    tokenRateEl.textContent = rate >= 1000 ? (rate / 1000).toFixed(1) + 'K' : Math.round(rate);
                } else {
                    tokenRateEl.textContent = '--';
                }
            }

            // Update donut SVG
            this._updateDonutChart(activeCount, queuedCount, completedCount, failedCount, totalRuns);

            // Render groups
            this.renderTaskGroups(groups);

            // Render all runs
            this.renderTaskRuns(runs);
        } catch (e) {
            console.error('[Task Manager] Error updating metrics:', e);
        }
    },

    renderTaskGroups(groups) {
        const container = document.getElementById('task-groups-container');
        if (!container) return;

        const groupIds = Object.keys(groups);
        if (groupIds.length === 0) {
            container.innerHTML = '<div style="color:var(--theme-text2);font-size:11px;padding:8px">No active groups</div>';
            return;
        }

        // Preserve collapsed state
        const collapsed = new Set();
        container.querySelectorAll('.task-group.collapsed').forEach(el => collapsed.add(el.dataset.groupId));

        container.innerHTML = groupIds.map(groupId => {
            const group = groups[groupId];
            const total = group.runIds.length;
            const completed = group.completed;
            const failed = group.failed;
            const active = total - completed - failed;
            const progress = total > 0 ? ((completed + failed) / total * 100) : 0;
            const isCollapsed = collapsed.has(groupId) ? ' collapsed' : '';
            const activeLabel = active > 0 ? `<span style="color:#64b5f6">${active} running</span>` : '';

            return `<div class="task-group${isCollapsed}" data-group-id="${this.escapeHtml(groupId)}">
                <div class="task-group-header" onclick="this.closest('.task-group').classList.toggle('collapsed')">
                    <span class="group-id"><span class="task-group-toggle">▼</span>📦 ${this.escapeHtml(groupId)}</span>
                    <div class="group-stats">
                        ${activeLabel}
                        <span>${completed}/${total}</span>
                        <span>${this.formatTokens(group.totalTokens)} tok</span>
                    </div>
                </div>
                <div class="task-group-body">
                    <div class="task-run-progress">
                        <div class="task-run-progress-bar" style="width:${progress}%"></div>
                    </div>
                    ${failed > 0 ? `<div style="font-size:10px;color:#ef5350;margin-top:4px">⚠ ${failed} failed</div>` : ''}
                </div>
            </div>`;
        }).join('');
    },

    renderTaskRuns(runs) {
        const container = document.getElementById('task-runs-container');
        if (!container) return;

        if (runs.length === 0) {
            container.innerHTML = '<div style="color:var(--theme-text2);font-size:11px;padding:8px">No runs</div>';
            return;
        }

        container.innerHTML = runs.slice(0, 20).map(run => {
            const status = run.status || 'queued';
            const statusClass = `status-${status}`;
            const duration = run.metrics?.duration || 0;
            const promptTokens = run.metrics?.promptTokens || 0;
            const completionTokens = run.metrics?.completionTokens || 0;
            const totalTokens = run.metrics?.totalTokens || 0;

            const btFile = run.file ? run.file.split('/').pop() : 'unknown';
            const groupLabel = run.group ? `<span style="color:var(--theme-accent);font-size:10px"> [${this.escapeHtml(run.group)}]</span>` : '';

            // Mini token bar: prompt=teal, completion=yellow
            const tokenBarHtml = totalTokens > 0 ? (() => {
                const promptPct = Math.round(promptTokens / totalTokens * 100);
                const compPct = Math.round(completionTokens / totalTokens * 100);
                return `<div class="task-token-bar">
                    <div class="task-token-bar-prompt" style="width:${promptPct}%"></div>
                    <div class="task-token-bar-completion" style="width:${compPct}%"></div>
                </div>`;
            })() : '';

            const statusIcon = status === 'running' ? '⚡' : status === 'completed' ? '✓' : status === 'failed' ? '✗' : '·';

            return `<div class="task-run">
                <div class="task-run-status ${statusClass}" title="${status}">${statusIcon}</div>
                <div class="task-run-info">
                    <div class="task-run-name">${this.escapeHtml(btFile)}${groupLabel}</div>
                    <div class="task-run-meta">
                        <span style="font-family:monospace;font-size:10px;color:#666">${run.runId.substring(0, 8)}</span>
                        <span>${this.formatDuration(duration)}</span>
                        <span style="color:var(--theme-text2)">${this.formatTokens(totalTokens)} tok</span>
                    </div>
                    ${tokenBarHtml}
                </div>
                <div class="task-run-buttons">
                    ${status === 'running' || status === 'queued' ? `
                        <button class="task-run-btn cancel-btn" onclick="app.cancelRun('${run.runId}')">✕</button>
                    ` : ''}
                </div>
            </div>`;
        }).join('');
    },

    async cancelRun(runId) {
        try {
            const response = await fetch(`http://127.0.0.1:18765/runs/${runId}/stop`, { method: 'POST' });
            if (response.ok) {
                this.addLog(`[Task Manager] Cancelled run: ${runId}`);
                this.updateTaskMetrics();
            } else {
                console.error('[Task Manager] Failed to cancel run:', runId);
            }
        } catch (e) {
            console.error('[Task Manager] Error cancelling run:', e);
        }
    },

    refreshTaskMetrics() {
        this.updateTaskMetrics();
    },

    formatDuration(ms) {
        if (ms < 1000) return `${Math.round(ms)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    },

    formatTokens(n) {
        if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
        return String(n);
    },

    _updateDonutChart(active, queued, completed, failed, total) {
        const svg = document.getElementById('task-donut-svg');
        if (!svg) return;
        const label = document.getElementById('task-donut-label');
        if (label) {
            label.style.transform = 'rotate(90deg)';
            label.setAttribute('transform', 'rotate(90,40,40)');
            label.textContent = total;
        }
        // Remove old arc segments
        svg.querySelectorAll('.donut-arc').forEach(el => el.remove());
        if (total === 0) return;

        const R = 30, CX = 40, CY = 40, STROKE = 10;
        const circ = 2 * Math.PI * R;
        const segments = [
            { count: active,    color: '#64b5f6' },
            { count: queued,    color: '#bdbdbd' },
            { count: completed, color: '#81c784' },
            { count: failed,    color: '#ef5350' },
        ];
        let offset = 0;
        for (const seg of segments) {
            if (seg.count === 0) continue;
            const dash = (seg.count / total) * circ;
            const gap = circ - dash;
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('class', 'donut-arc');
            circle.setAttribute('cx', CX);
            circle.setAttribute('cy', CY);
            circle.setAttribute('r', R);
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', seg.color);
            circle.setAttribute('stroke-width', STROKE);
            circle.setAttribute('stroke-dasharray', `${dash} ${gap}`);
            circle.setAttribute('stroke-dashoffset', -offset);
            svg.insertBefore(circle, label || null);
            offset += dash;
        }
    },

});

document.addEventListener('DOMContentLoaded', () => {
    app.init();
    document.addEventListener('keydown', (e) => app.handleKey(e));
    
    // Global listener to close context menus when clicking outside
    document.addEventListener('mousedown', (e) => {
        const treeMenu = document.getElementById('tree-context-menu');
        if (treeMenu && treeMenu.style.display !== 'none' && !treeMenu.contains(e.target)) {
            app.hideTreeContextMenu();
        }
        const logMenu = document.getElementById('log-context-menu');
        if (logMenu && logMenu.style.display !== 'none' && !logMenu.contains(e.target)) {
            app.hideLogContextMenu();
        }
        const tabMenu = document.getElementById('tab-context-menu');
        if (tabMenu && tabMenu.style.display !== 'none' && !tabMenu.contains(e.target)) {
            app.hideTabContextMenu();
        }
    });
});
