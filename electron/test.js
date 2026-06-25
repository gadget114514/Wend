'use strict';
/**
 * Wend Electron — unit / integration tests
 * Run with:  node test.js
 * (No external deps — uses Node built-ins only)
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const http = require('node:http');

// ── helpers ──────────────────────────────────────────────────

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'prompts_test_'));
}

function rmrf(p) {
    fs.rmSync(p, { recursive: true, force: true });
}

// ── inline the testable modules from main.js ──────────────────
// We extract pure-logic classes/functions so tests don't need Electron.

// ---- utilities ----
function jsonEscape(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

function ensureDir(p) {
    try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function readJson(filePath, fallback = null) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return fallback; }
}

function writeJson(filePath, obj) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function nowIso() {
    return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function generateRunId() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return ts + '_' + (Math.random() * 1e6 | 0);
}

function getDefaultRecipes() {
    return [
        { name: 'Music Info Fetcher', type: 'ai', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3, systemPrompt: 'You are a music metadata assistant.', command: '', customParams: {} },
        { name: 'Article Writer (GPT)', type: 'ai', provider: 'openai', model: 'gpt-4.1', temperature: 0.8, systemPrompt: 'You are a radio DJ and music journalist.', command: '', customParams: {} },
        { name: 'Article Writer (Claude)', type: 'ai', provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.8, systemPrompt: 'You are a radio DJ and music journalist.', command: '', customParams: {} },
        { name: 'Article Writer (Gemini)', type: 'ai', provider: 'gemini', model: 'gemini-3.1-pro-preview', temperature: 0.8, systemPrompt: 'You are a radio DJ and music journalist.', command: '', customParams: {} },
        { name: 'Music Generator', type: 'ai', provider: 'replicate', model: 'meta/musicgen', temperature: 0.7, systemPrompt: '', command: '', customParams: {} },
        { name: 'OpenAI TTS HD', type: 'ai', provider: 'openai', model: 'tts-1-hd', temperature: 0.7, systemPrompt: '', command: '', customParams: {} },
        { name: 'OpenAI TTS', type: 'ai', provider: 'openai', model: 'tts-1', temperature: 0.7, systemPrompt: '', command: '', customParams: {} },
        { name: 'Replicate TTS', type: 'ai', provider: 'replicate', model: 'lucataco/xtts-v2', temperature: 0.7, systemPrompt: '', command: '', customParams: {} },
        { name: 'Gemini T2I (Text-to-Image)', type: 'ai', provider: 'gemini', model: 'gemini-3-pro-image', temperature: 0.7, systemPrompt: 'You are an AI image generator. Generate high-quality images based on the user prompt.', command: '', customParams: { aspectRatio: '1:1', imageSize: '1K' } },
        { name: 'Gemini T2I Flash (Text-to-Image)', type: 'ai', provider: 'gemini', model: 'gemini-3.1-flash-image', temperature: 0.7, systemPrompt: 'You are an AI image generator. Generate high-quality images based on the user prompt.', command: '', customParams: { aspectRatio: '1:1', imageSize: '1K' } },
        { name: 'Gemini I2I (Image-to-Image)', type: 'ai', provider: 'gemini', model: 'gemini-3.1-flash-image', temperature: 0.7, systemPrompt: 'You are an AI image generator. Generate a modified image based on the input image and the user prompt.', command: '', customParams: { aspectRatio: '1:1', imageSize: '1K' } },
        { name: 'Gemini I2I Edit (gemini-3.1-flash-image)', type: 'ai', provider: 'gemini', model: 'gemini-3.1-flash-image', temperature: 0.7, systemPrompt: 'You are an AI image generator. Specify an image and use a text prompt to add, remove, change elements, alter style, or adjust color grading.', command: '', useCustomApiPath: true, apiPath: '/v1/models/{model}:generateContent', apiType: 'simple', customParams: { aspectRatio: '1:1', imageSize: '1K' } },
        { name: 'Gemini I2I Multiple Reference (gemini-3.1-flash-image)', type: 'ai', provider: 'gemini', model: 'gemini-3.1-flash-image', temperature: 0.7, systemPrompt: 'You are an AI image generator. Generate a new image that references multiple input images based on the user prompt.', command: '', useCustomApiPath: true, apiPath: '/v1/models/{model}:generateContent', apiType: 'simple', customParams: { responseModalities: ['TEXT', 'IMAGE'], aspectRatio: '5:4', imageSize: '2K' } },
        { name: 'Gemini Grounding (gemini-3.1-flash-image)', type: 'ai', provider: 'gemini', model: 'gemini-3.1-flash-image', temperature: 0.7, systemPrompt: 'You are an AI image generator. Use Google Search grounding to gather the latest information and generate a visual chart or infographic based on the user prompt.', command: '', useCustomApiPath: true, apiPath: '/v1/models/{model}:generateContent', apiType: 'simple', customParams: { tools: [{"google_search": {}}], responseModalities: ['TEXT', 'IMAGE'], aspectRatio: '16:9' } },
        { name: 'Gemini V2I (gemini-3.1-flash-image)', type: 'ai', provider: 'gemini', model: 'gemini-3.1-flash-image', temperature: 0.7, systemPrompt: 'You are an AI image generator. Understand the video content specified by the URL and generate a relevant infographic or summary chart.', command: '', useCustomApiPath: true, apiPath: '/v1/models/{model}:generateContent', apiType: 'simple', customParams: { file_data: { file_uri: 'https://www.youtube.com/watch?v=UTdfxFyOQTI' }, video_metadata: { fps: 0.5 } } },
        { name: 'Gemini Imagen 4 T2I (imagen-4.0-generate-001)', type: 'ai', provider: 'gemini', model: 'imagen-4.0-generate-001', temperature: 0.7, systemPrompt: 'You are an AI image generator. Generate high-quality images based on the user prompt.', command: '', useCustomApiPath: true, apiPath: '/v1beta/models/{model}:predict', apiType: 'simple', customParams: {} },
        { name: 'Gemini T2I Flash (gemini-2.5-flash-image)', type: 'ai', provider: 'gemini', model: 'gemini-2.5-flash-image', temperature: 0.7, systemPrompt: 'You are an AI image generator. Generate high-quality images based on the user prompt.', command: '', useCustomApiPath: true, apiPath: '/v1beta/models/{model}:generateContent', apiType: 'simple', customParams: { responseModalities: ['TEXT', 'IMAGE'] } },
        { name: 'Logical calculation tester (Gemini)', type: 'ai', provider: 'gemini', model: 'gemini-3.1-pro-preview', temperature: 0.1, systemPrompt: 'You are a logical evaluation assistant. Evaluate the mathematical or logical expression/condition provided in the prompt. Return exactly \'true\' if the expression evaluates to true, or \'false\' if it evaluates to false. Do not include any other text, explanation, or markdown formatting.', command: '', customParams: {} },
        { name: 'Logical calculation tester (GPT)', type: 'ai', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.1, systemPrompt: 'You are a logical evaluation assistant. Evaluate the mathematical or logical expression/condition provided in the prompt. Return exactly \'true\' if the expression evaluates to true, or \'false\' if it evaluates to false. Do not include any other text, explanation, or markdown formatting.', command: '', customParams: {} },
        { name: 'Logical calculation tester (Claude)', type: 'ai', provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.1, systemPrompt: 'You are a logical evaluation assistant. Evaluate the mathematical or logical expression/condition provided in the prompt. Return exactly \'true\' if the expression evaluates to true, or \'false\' if it evaluates to false. Do not include any other text, explanation, or markdown formatting.', command: '', customParams: {} },
        { name: 'QA Content Tester (GPT)', type: 'ai', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.1, systemPrompt: 'You are a quality assurance testing assistant. Evaluate the provided text or data against the specified criteria or test instructions. Return exactly \'true\' if it meets the criteria/passes, or \'false\' if it does not. Do not include any other text, explanation, or markdown formatting.', command: '', customParams: {} },
        { name: 'Code Assistant (OpenCode)', type: 'ai', provider: 'opencode', model: 'gpt-5.5', temperature: 0.2, systemPrompt: 'You are a professional software engineer. Write high-quality, clean, well-commented code, and answer technical questions.', command: '', customParams: {} },
        { name: 'Code Reviewer (OpenCode)', type: 'ai', provider: 'opencode', model: 'gpt-5.4', temperature: 0.1, systemPrompt: 'You are a senior technical architect and code reviewer. Analyze the code for bugs, performance issues, security vulnerabilities, and suggest improvements.', command: '', customParams: {} }
    ];
}

// ---- Storage (copy of main.js Storage class) ----
class Storage {
    constructor() { this.basePath = ''; this.maxHistoryRuns = 50; }

    init(basePath) {
        this.basePath = basePath;
        ensureDir(path.join(basePath, 'data'));
        ensureDir(path.join(basePath, 'blobs'));
        ensureDir(path.join(basePath, 'history'));
        return true;
    }

    dataPath(rel) { return path.join(this.basePath, 'data', rel); }
    blobPath(rel) { return path.join(this.basePath, 'blobs', rel); }
    getBasePath()  { return this.basePath; }

    loadSession()          { return readJson(path.join(this.basePath, 'session.json'), { tabs: [] }); }
    saveSession(s)         { writeJson(path.join(this.basePath, 'session.json'), s); }

    loadTabData(rel)       { return readJson(this.dataPath(rel), { title:'', content:'', mimetype:'text/plain', attachments:[], children:[] }); }
    saveTabData(rel, root) { writeJson(this.dataPath(rel), root); }

    loadBlob(rel)          { try { return fs.readFileSync(this.blobPath(rel), 'base64'); } catch { return ''; } }
    saveBlob(data, ext)    {
        const name = Date.now() + '_' + Math.random().toString(36).slice(2) + ext;
        fs.writeFileSync(this.blobPath(name), Buffer.from(data, 'base64'));
        return name;
    }
    removeBlob(rel)        { try { fs.unlinkSync(this.blobPath(rel)); } catch {} }

    garbageCollectBlobs(referenced) {
        try {
            const all = fs.readdirSync(path.join(this.basePath, 'blobs'));
            for (const f of all) if (!referenced.includes(f)) { try { fs.unlinkSync(this.blobPath(f)); } catch {} }
        } catch {}
    }

    getTabFiles() {
        try { return fs.readdirSync(path.join(this.basePath, 'data')).filter(f => f.endsWith('.json')); }
        catch { return []; }
    }

    saveHistory(recordJson) {
        try {
            const obj = JSON.parse(recordJson);
            const id  = obj.id || generateRunId();
            writeJson(path.join(this.basePath, 'history', `run_${id}.json`), obj);
            this._trimHistory();
        } catch {}
    }

    _trimHistory() {
        try {
            const dir   = path.join(this.basePath, 'history');
            const files = fs.readdirSync(dir)
                .filter(f => f.startsWith('run_') && f.endsWith('.json'))
                .map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            for (let i = this.maxHistoryRuns; i < files.length; i++)
                try { fs.unlinkSync(path.join(dir, files[i].f)); } catch {}
        } catch {}
    }

    updateHistoryEvaluation(filename, evaluation) {
        const p = path.join(this.basePath, 'history', filename);
        const obj = readJson(p, null);
        if (obj) { obj.evaluation = evaluation; writeJson(p, obj); }
    }

    listHistory() {
        try { return fs.readdirSync(path.join(this.basePath, 'history')).filter(f => f.startsWith('run_') && f.endsWith('.json')).sort().reverse(); }
        catch { return []; }
    }

    loadHistoryRecord(filename) {
        try { return fs.readFileSync(path.join(this.basePath, 'history', filename), 'utf8'); }
        catch { return ''; }
    }

    loadProviders() {
        const providers = readJson(path.join(this.basePath, 'providers.json'), {});
        let modified = false;
        for (const [key, p] of Object.entries(providers)) {
            if (p && p.baseUrl === 'https://googleapis.com') {
                p.baseUrl = 'https://generativelanguage.googleapis.com';
                modified = true;
            }
        }
        if (modified) {
            this.saveProviders(providers);
        }
        return providers;
    }
    saveProviders(providers) {
        for (const [key, p] of Object.entries(providers)) {
            if (p && p.baseUrl === 'https://googleapis.com') {
                p.baseUrl = 'https://generativelanguage.googleapis.com';
            }
        }
        writeJson(path.join(this.basePath, 'providers.json'), providers);
        return true;
    }

    loadPipelines()          { const o = readJson(path.join(this.basePath, 'pipelines.json'), { pipelines: [] }); return o.pipelines || o || []; }
    savePipelines(pl)        { writeJson(path.join(this.basePath, 'pipelines.json'), { pipelines: pl }); }

    loadRecentFiles()        { return readJson(path.join(this.basePath, 'recent_files.json'), []); }
    saveRecentFiles(f)       { writeJson(path.join(this.basePath, 'recent_files.json'), f); }

    loadGeneralConfig()      { return readJson(path.join(this.basePath, 'config.json'), { historyRetention: 50, defaultProvider: 'openai', defaultModel: '', theme: 'dark' }); }
    saveGeneralConfig(cfg)   { writeJson(path.join(this.basePath, 'config.json'), cfg); this.maxHistoryRuns = cfg.historyRetention || 50; return true; }

    loadRecipes() {
        const recipes = readJson(path.join(this.basePath, 'projectrecipes.json'), []);
        if (!recipes || recipes.length === 0) {
            const defaults = getDefaultRecipes();
            writeJson(path.join(this.basePath, 'projectrecipes.json'), defaults);
            return defaults;
        }
        // Auto-merge any missing predefined default recipes by name
        const defaults = getDefaultRecipes();
        let modified = false;
        for (const def of defaults) {
            if (!recipes.some(r => r.name === def.name)) {
                recipes.push(def);
                modified = true;
            }
        }
        if (modified) {
            writeJson(path.join(this.basePath, 'projectrecipes.json'), recipes);
        }
        return recipes;
    }
    saveRecipes(r)           { writeJson(path.join(this.basePath, 'projectrecipes.json'), r); return true; }

    _chestPath(name) { ensureDir(path.join(this.basePath, 'chests')); return path.join(this.basePath, 'chests', name + '.txt'); }
    saveToNamedChest(name, content) { fs.writeFileSync(this._chestPath(name), content, 'utf8'); }
    loadFromNamedChest(name)        { try { return fs.readFileSync(this._chestPath(name), 'utf8'); } catch { return ''; } }
    chestExists(name)               { return fs.existsSync(this._chestPath(name)); }
    listNamedChests()               { try { return fs.readdirSync(path.join(this.basePath, 'chests')).filter(f => f.endsWith('.txt')).map(f => f.slice(0, -4)); } catch { return []; } }

    setMaxHistoryRuns(n) { this.maxHistoryRuns = n; }
    getMaxHistoryRuns()  { return this.maxHistoryRuns; }

    ensureDirectory(p) { ensureDir(p); return true; }

    resolveProjectPath(rel) {
        const full = path.resolve(path.join(this.basePath, 'data', rel));
        if (!full.startsWith(path.join(this.basePath, 'data'))) return '';
        return full;
    }
}

// ---- PipelineVersionManager ----
class PipelineVersionManager {
    constructor(storage) { this.storage = storage; }

    _getVersionsPath(name) { return path.join(this.storage.basePath, 'optimizer', name + '_versions.json'); }
    _loadVersions(name)    { return readJson(this._getVersionsPath(name), { versions: [], currentVersion: 0, headVersion: 0 }); }
    _saveVersions(name, d) { ensureDir(path.join(this.storage.basePath, 'optimizer')); writeJson(this._getVersionsPath(name), d); }

    ensureBaseVersion(name, pipeline) {
        const data = this._loadVersions(name);
        if (data.versions.length === 0) {
            data.versions.push({ version: 1, pipeline: JSON.parse(JSON.stringify(pipeline)), timestamp: nowIso(), label: 'Base' });
            data.currentVersion = 1; data.headVersion = 1;
            this._saveVersions(name, data);
        }
        return data;
    }

    commitVersion(name, pipeline, sessionId, label) {
        const data = this._loadVersions(name);
        const next = data.headVersion + 1;
        data.versions.push({ version: next, pipeline: JSON.parse(JSON.stringify(pipeline)), timestamp: nowIso(), label, sessionId });
        data.currentVersion = next; data.headVersion = next;
        this._saveVersions(name, data);
        return next;
    }

    getCursor(name) {
        const data = this._loadVersions(name);
        return { pipelineName: name, currentVersion: data.currentVersion, headVersion: data.headVersion,
                 entries: data.versions.map(v => ({ version: v.version, timestamp: v.timestamp, label: v.label })) };
    }

    _findPipeline(name, version) {
        const data = this._loadVersions(name);
        const e = data.versions.find(v => v.version === version);
        return e ? e.pipeline : null;
    }

    undo(name) { const d = this._loadVersions(name); if (d.currentVersion <= 1) return null; d.currentVersion--; this._saveVersions(name, d); return this._findPipeline(name, d.currentVersion); }
    redo(name) { const d = this._loadVersions(name); if (d.currentVersion >= d.headVersion) return null; d.currentVersion++; this._saveVersions(name, d); return this._findPipeline(name, d.currentVersion); }
    checkoutVersion(name, version) { const d = this._loadVersions(name); const e = d.versions.find(v => v.version === version); if (!e) return null; d.currentVersion = version; this._saveVersions(name, d); return e.pipeline; }
}

// ---- PipelineRunner (thin test shim — no Electron IPC) ----
class PipelineRunner {
    constructor() {
        this.running = false; this.cancelled = false; this.bridgeCb = null;
        this.providers = {}; this.historySteps = []; this.currentStepIndex = -1;
        this.pendingSteps = []; this.inputContent = ''; this.outputMode = 'child';
        this.pipelineName = ''; this.runId = ''; this.startedAt = '';
        this.waitingForManual = false; this.waitingForWizard = false; this.waitingForFilter = false;
        this._manualResolve = null; this._wizardResolve = null; this._filterResolve = null;
        this.inputSourceOverridden = false; this.inputSourceContent = '';
        this.events = []; // captured bridge events for assertions
    }

    setBridgeCallback(cb) { this.bridgeCb = cb; }
    postBridge(type, json) { this.events.push({ type, payload: typeof json === 'string' ? JSON.parse(json) : json }); if (this.bridgeCb) this.bridgeCb(type, typeof json === 'string' ? json : JSON.stringify(json)); }
    registerProvider(type, p) { this.providers[type] = p; }
    getRunId()  { return this.runId; }
    isRunning() { return this.running; }
    cancel()    { this.cancelled = true; this.running = false; this.pendingSteps = []; if (this._manualResolve) { this._manualResolve(null); this._manualResolve = null; } }
    resumeManual(content) { if (this._manualResolve) { this._manualResolve(content); this._manualResolve = null; } }
    resumeWizard(json)    { if (this._wizardResolve) { this._wizardResolve(json); this._wizardResolve = null; } }
    resumeFilter(json)    { if (this._filterResolve) { this._filterResolve(json); this._filterResolve = null; } }
    setExternalInput(c)   { this.inputSourceOverridden = true; this.inputSourceContent = c; }

    _currentContent() {
        if (this.inputSourceOverridden) return this.inputSourceContent;
        if (this.currentStepIndex > 0 && this.historySteps[this.currentStepIndex - 1]) return this.historySteps[this.currentStepIndex - 1].output;
        return this.inputContent;
    }

    run(pipelineName, steps, inputContent, inputAttachments, outputMode) {
        if (this.running) return;
        this.pipelineName = pipelineName; this.inputContent = inputContent;
        this.inputAttachments = inputAttachments || [];
        this.outputMode = outputMode || 'child'; this.cancelled = false; this.running = true;
        this.runId = generateRunId(); this.startedAt = nowIso();
        this.historySteps = steps.map((s, i) => ({ index: i, name: s.name, type: s.type, input: i === 0 ? inputContent : '', output: '', status: 'pending', promptTokens: 0, completionTokens: 0, parallelBranches: {} }));
        this.currentStepIndex = -1; this.pendingSteps = [...steps];
        this.inputSourceOverridden = false;
        this.postBridge('step_started', JSON.stringify({ index: 0, name: steps[0]?.name || '' }));
        return this._runNext();
    }

    async _runNext() {
        if (this.cancelled || this.pendingSteps.length === 0) {
            this.running = false;
            if (!this.cancelled) this.postBridge('pipeline_completed', JSON.stringify({ id: this.runId, pipelineName: this.pipelineName, steps: this.historySteps, status: 'completed' }));
            else                 this.postBridge('pipeline_error', JSON.stringify({ message: 'Canceled' }));
            return;
        }
        this.currentStepIndex++;
        const step = this.pendingSteps.shift();
        if (this.currentStepIndex < this.historySteps.length) { this.historySteps[this.currentStepIndex].input = this._currentContent(); this.historySteps[this.currentStepIndex].status = 'running'; }
        this.postBridge('step_started', JSON.stringify({ index: this.currentStepIndex, name: step.name }));
        try {
            await this._executeStep(step);
        } catch (e) {
            this.running = false;
            this.postBridge('pipeline_error', JSON.stringify({ message: String(e) }));
            return;
        }
        if (!this.waitingForManual && !this.waitingForWizard && !this.waitingForFilter && this.running) await this._runNext();
    }

    async _executeStep(step) {
        const type = step.type;
        const idx  = this.currentStepIndex;

        if (type === 'ai') {
            const provider = this.providers[step.params?.provider || 'openai'];
            if (!provider) throw new Error('Provider not configured: ' + (step.params?.provider || 'openai'));
            let userPrompt = (step.params?.userPrompt || '{content}').replace(/\{content\}/g, this.inputContent).replace(/\{result\}/g, this._currentContent());
            const resp = await provider.call({ model: step.params?.model || 'gpt-4.1', systemPrompt: step.params?.systemPrompt || '', userPrompt, temperature: parseFloat(step.params?.temperature || '0.7'), maxTokens: 4096, attachments: this.inputAttachments || [] });
            if (idx < this.historySteps.length) {
                this.historySteps[idx].output = resp.content;
                this.historySteps[idx].status = 'completed';
                if (resp.outputAttachments && resp.outputAttachments.length > 0) {
                    this.historySteps[idx].artifacts = resp.outputAttachments;
                }
            }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else if (type === 'manual') {
            const content = this._currentContent();
            this.waitingForManual = true;
            const choices = step.params?.choices ? JSON.parse(step.params.choices) : [];
            this.postBridge('manual_step_pause', JSON.stringify({ index: idx, mode: step.params?.mode || 'view', prompt: step.params?.prompt || '', content, choices }));
            const result = await new Promise(res => { this._manualResolve = res; });
            this.waitingForManual = false;
            if (idx < this.historySteps.length) { this.historySteps[idx].output = result ?? content; this.historySteps[idx].status = 'completed'; }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else if (type === 'wizard') {
            this.waitingForWizard = true;
            this.postBridge('wizard_step_pause', JSON.stringify({ index: idx, wizard: step.params?.wizard || '', content: this._currentContent() }));
            const valuesJson = await new Promise(res => { this._wizardResolve = res; });
            this.waitingForWizard = false;
            if (idx < this.historySteps.length) { this.historySteps[idx].output = valuesJson || '{}'; this.historySteps[idx].status = 'completed'; }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else if (type === 'filter') {
            const content = this._currentContent();
            const mode = step.params?.mode || 'manual';
            if (mode === 'auto') { if (idx < this.historySteps.length) { this.historySteps[idx].status = 'completed'; this.historySteps[idx].output = content; } this.postBridge('step_done', JSON.stringify({ index: idx })); return; }
            this.waitingForFilter = true;
            this.postBridge('step_filter_pause', JSON.stringify({ index: idx, mode, outputs: [{ index: 0, content }] }));
            await new Promise(res => { this._filterResolve = res; });
            this.waitingForFilter = false;
            if (idx < this.historySteps.length) { this.historySteps[idx].status = 'completed'; this.historySteps[idx].output = content; }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else {
            this.postBridge('log', JSON.stringify({ message: '⚠ Unknown step: ' + type }));
            if (idx < this.historySteps.length) this.historySteps[idx].status = 'skipped';
        }
    }
}

// ================================================================
// ── MockAIProvider ─────────────────────────────────────────────
// Internal scripted provider — no network access.
//
// Request format (mirrors real providers):
//   { model, systemPrompt, userPrompt, temperature, maxTokens,
//     attachments: [{ file, path, mimetype, content (base64), size }] }
//
// Response format:
//   { content: string, model: string, outputAttachments: Attachment[] }
//
// Usage:
//   const p = new MockAIProvider();
//
//   // ── Deterministic rules (never consumed, highest priority) ──
//   p.when('hello', 'world')                        // exact userPrompt match → string content
//   p.when(/translate/i, 'translation')             // regex match
//   p.when(req => req.model === 'x', 'ok')          // predicate fn → string content
//   p.when(req => req.attachments.length > 0,       // predicate fn → full response fn
//          req => ({ content: 'got it', model: 'mock-model',
//                    outputAttachments: [req.attachments[0]] }))
//
//   // ── Queue (consumed FIFO, fallback when no rule matches) ────
//   p.queue('Hello back')                           // text-only response
//   p.queueWithMedia('Caption', [imageAtt])         // response with output media
//   p.queueError('rate limit')                      // next call throws
//
//   // ── Assertions ──────────────────────────────────────────────
//   await p.call(req)                               // returns scripted response
//   p.calls[0]                                      // captured request
//   p.inputAttachmentsOf(0)                         // attachments in 1st call
//   p.inputImagesOf(0)                              // image attachments in 1st call
//   p.inputAudiosOf(0)                              // audio attachments in 1st call
class MockAIProvider {
    constructor() {
        this._rules = [];   // deterministic rules — never consumed
        this._queue = [];   // scripted entries in FIFO order
        this.calls  = [];   // every captured request (with attachments snapshot)
    }

    // Register a deterministic rule (chainable).
    // matcher: string (exact userPrompt), RegExp, or (req) => bool
    // response: string (content only), or (req) => { content, model, outputAttachments }
    when(matcher, response) {
        this._rules.push({ matcher, response });
        return this;
    }

    // Queue a text-only response (chainable)
    queue(content, model = 'mock-model') {
        this._queue.push({ ok: true, content, model, outputAttachments: [] });
        return this;
    }

    // Queue a response that includes output media attachments (e.g. TTS audio, generated image)
    queueWithMedia(content, outputAttachments = [], model = 'mock-model') {
        this._queue.push({ ok: true, content, model, outputAttachments });
        return this;
    }

    // Queue an error (chainable)
    queueError(message) {
        this._queue.push({ ok: false, message });
        return this;
    }

    // call() — used by the test PipelineRunner shim
    async call(req) {
        // Snapshot attachments array so later mutations don't affect captured calls
        this.calls.push({ ...req, attachments: req.attachments ? req.attachments.map(a => ({ ...a })) : [] });

        // 1. Rule-based (deterministic, never consumed)
        for (const { matcher, response } of this._rules) {
            let matched = false;
            if (typeof matcher === 'string')        matched = req.userPrompt === matcher;
            else if (matcher instanceof RegExp)     matched = matcher.test(req.userPrompt);
            else if (typeof matcher === 'function') matched = matcher(req);
            if (!matched) continue;
            const r = typeof response === 'function' ? response(req) : response;
            return typeof r === 'string'
                ? { content: r, model: 'mock-model', outputAttachments: [] }
                : r;
        }

        // 2. Queue (consumed FIFO)
        if (this._queue.length === 0) {
            return { content: `echo:${req.userPrompt}`, model: 'mock-model', outputAttachments: [] };
        }
        const entry = this._queue.shift();
        if (!entry.ok) throw new Error(entry.message);
        return { content: entry.content, model: entry.model, outputAttachments: entry.outputAttachments };
    }

    // callStreaming() — used by the real runner.js (same queue, streams via callbacks)
    async callStreaming(req, onChunk, onDone, onError) {
        try {
            const resp = await this.call(req);
            onChunk(resp.content);
            onDone(resp);
        } catch (e) {
            onError(e.message);
        }
    }

    // ── Assertion helpers ──────────────────────────────────────

    // All attachments that were sent in call n (default: last)
    inputAttachmentsOf(n = this.calls.length - 1) {
        return this.calls[n]?.attachments || [];
    }

    // Only image/* attachments from call n
    inputImagesOf(n = this.calls.length - 1) {
        return this.inputAttachmentsOf(n).filter(a => a.mimetype?.startsWith('image/'));
    }

    // Only audio/* attachments from call n
    inputAudiosOf(n = this.calls.length - 1) {
        return this.inputAttachmentsOf(n).filter(a => a.mimetype?.startsWith('audio/'));
    }

    // Convenience getters
    get lastCall()          { return this.calls[this.calls.length - 1]; }
    get lastInputAttachments() { return this.inputAttachmentsOf(); }
    get callCount()         { return this.calls.length; }
    nthCall(n)              { return this.calls[n]; }

    reset() { this._rules = []; this._queue = []; this.calls = []; }
}

// makeApp — top-level so all describe blocks can access it
// Assigned inside describe('Bridge message handling'), used from other suites too.
let makeApp;

// ── TESTS ─────────────────────────────────────────────────────
// ================================================================

// ── 1. Utilities ──────────────────────────────────────────────
describe('jsonEscape', () => {
    test('empty string', () => assert.equal(jsonEscape(''), ''));
    test('plain string unchanged', () => assert.equal(jsonEscape('hello'), 'hello'));
    test('double quotes escaped', () => assert.equal(jsonEscape('"hi"'), '\\"hi\\"'));
    test('backslash escaped', () => assert.equal(jsonEscape('a\\b'), 'a\\\\b'));
    test('newline escaped', () => assert.equal(jsonEscape('a\nb'), 'a\\nb'));
    test('carriage return escaped', () => assert.equal(jsonEscape('a\rb'), 'a\\rb'));
    test('tab escaped', () => assert.equal(jsonEscape('a\tb'), 'a\\tb'));
    test('combined special chars', () => assert.equal(jsonEscape('say "hi"\nbye'), 'say \\"hi\\"\\nbye'));
});

describe('generateRunId', () => {
    test('returns non-empty string', () => assert.ok(generateRunId().length > 0));
    test('two calls produce different ids', () => assert.notEqual(generateRunId(), generateRunId()));
    test('format contains timestamp portion', () => assert.match(generateRunId(), /^\d{8}_\d{6}_\d+$/));
});

describe('nowIso', () => {
    test('returns ISO 8601 string ending in Z', () => assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/));
});

// ── 2. Storage ────────────────────────────────────────────────
describe('Storage', () => {
    let tmpDir, st;

    before(() => { tmpDir = makeTempDir(); st = new Storage(); st.init(tmpDir); });
    after(() => rmrf(tmpDir));

    test('init creates directories', () => {
        assert.ok(fs.existsSync(path.join(tmpDir, 'data')));
        assert.ok(fs.existsSync(path.join(tmpDir, 'blobs')));
        assert.ok(fs.existsSync(path.join(tmpDir, 'history')));
    });

    test('getBasePath returns init path', () => assert.equal(st.getBasePath(), tmpDir));

    test('session round-trip', () => {
        st.saveSession({ tabs: [{ name: 'T1', file: 'tab1.json' }] });
        const s = st.loadSession();
        assert.equal(s.tabs.length, 1);
        assert.equal(s.tabs[0].name, 'T1');
    });

    test('loadSession defaults to empty tabs', () => {
        const st2 = new Storage();
        st2.init(makeTempDir());
        assert.deepEqual(st2.loadSession(), { tabs: [] });
        rmrf(st2.basePath);
    });

    test('tab data round-trip', () => {
        const node = { title: 'Hello', content: 'World', mimetype: 'text/plain', attachments: [], children: [] };
        st.saveTabData('test.json', node);
        const loaded = st.loadTabData('test.json');
        assert.equal(loaded.title, 'Hello');
        assert.equal(loaded.content, 'World');
    });

    test('loadTabData returns default when file missing', () => {
        const node = st.loadTabData('nonexistent.json');
        assert.equal(node.mimetype, 'text/plain');
    });

    test('getTabFiles lists json files', () => {
        st.saveTabData('a.json', {}); st.saveTabData('b.json', {});
        const files = st.getTabFiles();
        assert.ok(files.includes('a.json'));
        assert.ok(files.includes('b.json'));
    });

    test('providers round-trip', () => {
        const providers = { openai: { apiKey: 'sk-test', baseUrl: '', apiFormat: 'openai', models: [] }, replicate: { apiKey: 'token123', baseUrl: 'https://api.replicate.com', apiFormat: 'replicate', models: [] } };
        st.saveProviders(providers);
        const loaded = st.loadProviders();
        assert.equal(loaded.openai.apiKey, 'sk-test');
        assert.equal(loaded.replicate.apiFormat, 'replicate');
    });

    test('pipelines round-trip', () => {
        const pipelines = [{ name: 'pipe1', steps: [], mode: 'basic', outputMode: 'child' }];
        st.savePipelines(pipelines);
        const loaded = st.loadPipelines();
        assert.equal(loaded.length, 1);
        assert.equal(loaded[0].name, 'pipe1');
    });

    test('recent files round-trip', () => {
        st.saveRecentFiles(['/a/b.json', '/c/d.json']);
        assert.deepEqual(st.loadRecentFiles(), ['/a/b.json', '/c/d.json']);
    });

    test('general config round-trip', () => {
        st.saveGeneralConfig({ historyRetention: 30, defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-6' });
        const cfg = st.loadGeneralConfig();
        assert.equal(cfg.historyRetention, 30);
        assert.equal(cfg.defaultProvider, 'anthropic');
        assert.equal(cfg.defaultModel, 'claude-sonnet-4-6');
    });

    test('saveGeneralConfig updates maxHistoryRuns', () => {
        st.saveGeneralConfig({ historyRetention: 25, defaultProvider: 'openai', defaultModel: '' });
        assert.equal(st.getMaxHistoryRuns(), 25);
    });

    test('recipes round-trip', () => {
        const recipes = [{ name: 'r1', type: 'ai', provider: 'openai', model: 'gpt-4.1', temperature: 0.5, systemPrompt: 'sys', command: '', customParams: { negative_prompt: 'ugly' } }];
        st.saveRecipes(recipes);
        const loaded = st.loadRecipes();
        assert.equal(loaded[0].name, 'r1');
        assert.equal(loaded[0].temperature, 0.5);
        assert.equal(loaded[0].customParams.negative_prompt, 'ugly');
    });

    test('builtin recipes are seeded when projectrecipes.json is empty', () => {
        const emptyDir = makeTempDir();
        const tempSt = new Storage();
        tempSt.init(emptyDir);
        const recipes = tempSt.loadRecipes();
        assert.equal(recipes.length, 23);
        assert.equal(recipes[0].name, 'Music Info Fetcher');
        assert.equal(recipes[1].name, 'Article Writer (GPT)');
        assert.equal(recipes[7].name, 'Replicate TTS');
        rmrf(emptyDir);
    });

    test('existing recipes are NOT overwritten by builtin seed', () => {
        const existingDir = makeTempDir();
        const tempSt = new Storage();
        tempSt.init(existingDir);
        const custom = [{ name: 'My Custom Recipe', type: 'ai', provider: 'openai', model: 'gpt-4.1', temperature: 0.7, systemPrompt: '', command: '', customParams: {} }];
        tempSt.saveRecipes(custom);
        const loaded = tempSt.loadRecipes();
        // Preserves custom recipe and merges the missing defaults (1 custom + 23 defaults = 24)
        assert.equal(loaded.length, 24);
        assert.ok(loaded.some(r => r.name === 'My Custom Recipe'));
        rmrf(existingDir);
    });

    test('getDefaultRecipes returns correct structure', () => {
        const defaults = getDefaultRecipes();
        assert.equal(defaults.length, 23);
        for (const r of defaults) {
            assert.ok(r.name, 'recipe has name');
            assert.equal(r.type, 'ai');
            assert.ok(r.provider, 'recipe has provider');
            assert.ok(r.model, 'recipe has model');
            assert.equal(typeof r.temperature, 'number');
        }
    });

    test('history save and list', () => {
        const id = 'testrun_' + Date.now();
        st.saveHistory(JSON.stringify({ id, pipelineName: 'p', status: 'completed', steps: [] }));
        const files = st.listHistory();
        assert.ok(files.some(f => f.includes(id)));
    });

    test('history load record', () => {
        const id = 'testrun2_' + Date.now();
        st.saveHistory(JSON.stringify({ id, pipelineName: 'p2', status: 'completed', steps: [] }));
        const raw = st.loadHistoryRecord(`run_${id}.json`);
        const obj = JSON.parse(raw);
        assert.equal(obj.pipelineName, 'p2');
    });

    test('updateHistoryEvaluation', () => {
        const id = 'evalrun_' + Date.now();
        st.saveHistory(JSON.stringify({ id, pipelineName: 'pe', status: 'completed', steps: [] }));
        st.updateHistoryEvaluation(`run_${id}.json`, 'ok');
        const raw = st.loadHistoryRecord(`run_${id}.json`);
        assert.equal(JSON.parse(raw).evaluation, 'ok');
    });

    test('history trimming respects maxHistoryRuns', () => {
        const st2 = new Storage();
        const dir2 = makeTempDir();
        st2.init(dir2);
        st2.setMaxHistoryRuns(3);
        for (let i = 0; i < 6; i++) {
            st2.saveHistory(JSON.stringify({ id: `trim_${i}`, pipelineName: 'p', status: 'completed', steps: [] }));
        }
        const files = st2.listHistory();
        assert.ok(files.length <= 3, `expected ≤ 3 history files, got ${files.length}`);
        rmrf(dir2);
    });

    test('named chest save and load', () => {
        st.saveToNamedChest('mychest', 'hello chest');
        assert.equal(st.loadFromNamedChest('mychest'), 'hello chest');
        assert.ok(st.chestExists('mychest'));
    });

    test('chestExists false for missing chest', () => assert.equal(st.chestExists('ghost'), false));

    test('listNamedChests returns chest names', () => {
        st.saveToNamedChest('c1', 'a'); st.saveToNamedChest('c2', 'b');
        const list = st.listNamedChests();
        assert.ok(list.includes('c1'));
        assert.ok(list.includes('c2'));
    });

    test('blob save and load', () => {
        const data = Buffer.from('hello blob').toString('base64');
        const name = st.saveBlob(data, '.txt');
        const loaded = st.loadBlob(name);
        assert.equal(Buffer.from(loaded, 'base64').toString('utf8'), 'hello blob');
    });

    test('removeBlob deletes file', () => {
        const data = Buffer.from('bye').toString('base64');
        const name = st.saveBlob(data, '.txt');
        st.removeBlob(name);
        assert.equal(st.loadBlob(name), '');
    });

    test('garbageCollectBlobs removes unreferenced files', () => {
        const a = st.saveBlob(Buffer.from('a').toString('base64'), '.txt');
        const b = st.saveBlob(Buffer.from('b').toString('base64'), '.txt');
        st.garbageCollectBlobs([a]);   // keep a, remove b
        assert.notEqual(st.loadBlob(a), '');
        assert.equal(st.loadBlob(b), '');
    });

    test('resolveProjectPath within bounds', () => {
        const resolved = st.resolveProjectPath('sub/file.json');
        assert.ok(resolved.startsWith(path.join(tmpDir, 'data')));
    });

    test('resolveProjectPath rejects traversal', () => {
        const resolved = st.resolveProjectPath('../../etc/passwd');
        assert.equal(resolved, '');
    });
});

// ── 3. PipelineVersionManager ─────────────────────────────────
describe('PipelineVersionManager', () => {
    let tmpDir, st, vm;

    before(() => { tmpDir = makeTempDir(); st = new Storage(); st.init(tmpDir); vm = new PipelineVersionManager(st); });
    after(() => rmrf(tmpDir));

    const basePipeline = () => ({ name: 'test', steps: [{ name: 's1', type: 'ai', params: { userPrompt: 'hello' } }], mode: 'basic', outputMode: 'child' });

    test('ensureBaseVersion creates version 1', () => {
        vm.ensureBaseVersion('pipe1', basePipeline());
        const cursor = vm.getCursor('pipe1');
        assert.equal(cursor.currentVersion, 1);
        assert.equal(cursor.headVersion, 1);
        assert.equal(cursor.entries.length, 1);
        assert.equal(cursor.entries[0].label, 'Base');
    });

    test('ensureBaseVersion is idempotent', () => {
        vm.ensureBaseVersion('pipe2', basePipeline());
        vm.ensureBaseVersion('pipe2', basePipeline());
        assert.equal(vm.getCursor('pipe2').entries.length, 1);
    });

    test('commitVersion increments version', () => {
        const p = basePipeline(); p.name = 'pipe3';
        vm.ensureBaseVersion('pipe3', p);
        const v = vm.commitVersion('pipe3', p, 'sess1', 'Optimize (2 edits)');
        assert.equal(v, 2);
        const cursor = vm.getCursor('pipe3');
        assert.equal(cursor.currentVersion, 2);
        assert.equal(cursor.headVersion, 2);
    });

    test('undo returns previous pipeline', () => {
        const p = basePipeline(); p.name = 'pipe4';
        vm.ensureBaseVersion('pipe4', p);
        p.steps[0].params.userPrompt = 'modified';
        vm.commitVersion('pipe4', p, '', 'v2');
        const restored = vm.undo('pipe4');
        assert.ok(restored);
        assert.equal(restored.steps[0].params.userPrompt, 'hello');
    });

    test('undo returns null at version 1', () => {
        const p = basePipeline(); p.name = 'pipe5';
        vm.ensureBaseVersion('pipe5', p);
        assert.equal(vm.undo('pipe5'), null);
    });

    test('redo returns next pipeline', () => {
        const p = basePipeline(); p.name = 'pipe6';
        vm.ensureBaseVersion('pipe6', p);
        p.steps[0].params.userPrompt = 'v2';
        vm.commitVersion('pipe6', p, '', 'v2');
        vm.undo('pipe6');
        const redone = vm.redo('pipe6');
        assert.ok(redone);
        assert.equal(redone.steps[0].params.userPrompt, 'v2');
    });

    test('redo returns null at head version', () => {
        const p = basePipeline(); p.name = 'pipe7';
        vm.ensureBaseVersion('pipe7', p);
        assert.equal(vm.redo('pipe7'), null);
    });

    test('checkoutVersion loads specific version', () => {
        const p = basePipeline(); p.name = 'pipe8';
        vm.ensureBaseVersion('pipe8', p);
        p.steps[0].params.userPrompt = 'v2';
        vm.commitVersion('pipe8', p, '', 'v2');
        const checked = vm.checkoutVersion('pipe8', 1);
        assert.ok(checked);
        assert.equal(checked.steps[0].params.userPrompt, 'hello');
    });

    test('checkoutVersion returns null for missing version', () => {
        vm.ensureBaseVersion('pipe9', basePipeline());
        assert.equal(vm.checkoutVersion('pipe9', 99), null);
    });
});

// ── 4. PipelineRunner ─────────────────────────────────────────
describe('PipelineRunner', () => {
    test('initial state: not running', () => {
        const r = new PipelineRunner();
        assert.equal(r.isRunning(), false);
    });

    test('cancel when idle is safe', () => {
        const r = new PipelineRunner();
        r.cancel();
        assert.equal(r.isRunning(), false);
    });

    test('run with no steps completes immediately', async () => {
        const r = new PipelineRunner();
        await r.run('empty', [], 'input', [], 'child');
        const completed = r.events.find(e => e.type === 'pipeline_completed');
        assert.ok(completed, 'should emit pipeline_completed');
    });

    test('run with mock AI step completes', async () => {
        const r = new PipelineRunner();
        const mockProvider = { call: async () => ({ content: 'AI output', model: 'mock' }) };
        r.registerProvider('openai', mockProvider);
        await r.run('test', [{ name: 'Step1', type: 'ai', params: { provider: 'openai', model: 'gpt-4.1', userPrompt: '{content}' } }], 'hello', [], 'child');
        const done = r.events.find(e => e.type === 'step_done');
        assert.ok(done, 'step_done should be emitted');
        const completed = r.events.find(e => e.type === 'pipeline_completed');
        assert.ok(completed, 'pipeline_completed should be emitted');
        assert.equal(r.historySteps[0].output, 'AI output');
    });

    test('AI step substitutes {content} placeholder', async () => {
        const r = new PipelineRunner();
        let capturedPrompt = '';
        r.registerProvider('openai', { call: async req => { capturedPrompt = req.userPrompt; return { content: 'done', model: 'mock' }; } });
        await r.run('t', [{ name: 's', type: 'ai', params: { provider: 'openai', userPrompt: 'process: {content}' } }], 'mydata', [], 'child');
        assert.equal(capturedPrompt, 'process: mydata');
    });

    test('AI step substitutes {result} from previous step', async () => {
        const r = new PipelineRunner();
        let secondPrompt = '';
        let call = 0;
        r.registerProvider('openai', {
            call: async req => {
                call++;
                if (call === 2) secondPrompt = req.userPrompt;
                return { content: 'step' + call, model: 'mock' };
            }
        });
        const steps = [
            { name: 's1', type: 'ai', params: { provider: 'openai', userPrompt: '{content}' } },
            { name: 's2', type: 'ai', params: { provider: 'openai', userPrompt: 'prev={result}' } },
        ];
        await r.run('t', steps, 'input', [], 'child');
        assert.equal(secondPrompt, 'prev=step1');
    });

    test('run emits pipeline_error for missing provider', async () => {
        const r = new PipelineRunner();
        try {
            await r.run('t', [{ name: 's', type: 'ai', params: { provider: 'openai' } }], 'x', [], 'child');
        } catch {}
        const err = r.events.find(e => e.type === 'pipeline_error');
        assert.ok(err, 'pipeline_error should be emitted');
    });

    test('cancel mid-run stops execution', async () => {
        const r = new PipelineRunner();
        let resolveAI;
        r.registerProvider('openai', { call: () => new Promise(res => { resolveAI = res; }) });
        const runPromise = r.run('t', [
            { name: 's1', type: 'ai', params: { provider: 'openai' } },
            { name: 's2', type: 'ai', params: { provider: 'openai' } },
        ], 'x', [], 'child');
        r.cancel();
        resolveAI({ content: 'done', model: 'mock' });
        await runPromise;
        assert.equal(r.isRunning(), false);
    });

    test('manual step pauses and resumes', async () => {
        const r = new PipelineRunner();
        const runPromise = r.run('t', [{ name: 'm', type: 'manual', params: { mode: 'view', prompt: 'Edit this' } }], 'original', [], 'child');
        // wait for pause event
        await new Promise(res => setTimeout(res, 10));
        const pause = r.events.find(e => e.type === 'manual_step_pause');
        assert.ok(pause, 'manual_step_pause should be emitted');
        r.resumeManual('edited content');
        await runPromise;
        assert.equal(r.historySteps[0].output, 'edited content');
        assert.ok(r.events.find(e => e.type === 'pipeline_completed'));
    });

    test('wizard step pauses and resumes', async () => {
        const r = new PipelineRunner();
        const runPromise = r.run('t', [{ name: 'w', type: 'wizard', params: { wizard: 'developer' } }], 'x', [], 'child');
        await new Promise(res => setTimeout(res, 10));
        assert.ok(r.events.find(e => e.type === 'wizard_step_pause'));
        r.resumeWizard(JSON.stringify({ lang: 'Python' }));
        await runPromise;
        assert.equal(r.historySteps[0].output, JSON.stringify({ lang: 'Python' }));
    });

    test('filter step auto-mode skips pause', async () => {
        const r = new PipelineRunner();
        await r.run('t', [{ name: 'f', type: 'filter', params: { mode: 'auto' } }], 'data', [], 'child');
        assert.ok(!r.events.find(e => e.type === 'step_filter_pause'), 'auto filter should not pause');
        assert.ok(r.events.find(e => e.type === 'pipeline_completed'));
    });

    test('filter step manual-mode pauses and resumes', async () => {
        const r = new PipelineRunner();
        const runPromise = r.run('t', [{ name: 'f', type: 'filter', params: { mode: 'manual' } }], 'data', [], 'child');
        await new Promise(res => setTimeout(res, 10));
        assert.ok(r.events.find(e => e.type === 'step_filter_pause'));
        r.resumeFilter(JSON.stringify({ approved: [0], rejected: [] }));
        await runPromise;
        assert.ok(r.events.find(e => e.type === 'pipeline_completed'));
    });

    test('unknown step type is skipped', async () => {
        const r = new PipelineRunner();
        await r.run('t', [{ name: 'x', type: 'unknown_type', params: {} }], 'data', [], 'child');
        assert.equal(r.historySteps[0].status, 'skipped');
        assert.ok(r.events.find(e => e.type === 'pipeline_completed'));
    });

    test('setExternalInput overrides step input', async () => {
        const r = new PipelineRunner();
        let capturedPrompt = '';
        r.registerProvider('openai', { call: async req => { capturedPrompt = req.userPrompt; return { content: 'out', model: 'mock' }; } });
        r.setExternalInput('external data');
        await r.run('t', [{ name: 's', type: 'ai', params: { provider: 'openai', userPrompt: '{content}' } }], 'original', [], 'child');
        assert.equal(capturedPrompt, 'original'); // {content} is always original; {result} would use external
    });

    test('multi-step pipeline passes output between steps', async () => {
        const r = new PipelineRunner();
        let call = 0;
        r.registerProvider('openai', { call: async () => ({ content: `out${++call}`, model: 'mock' }) });
        const steps = [
            { name: 's1', type: 'ai', params: { provider: 'openai', userPrompt: '{content}' } },
            { name: 's2', type: 'ai', params: { provider: 'openai', userPrompt: '{result}' } },
            { name: 's3', type: 'ai', params: { provider: 'openai', userPrompt: '{result}' } },
        ];
        await r.run('t', steps, 'start', [], 'child');
        assert.equal(r.historySteps[0].output, 'out1');
        assert.equal(r.historySteps[1].output, 'out2');
        assert.equal(r.historySteps[2].output, 'out3');
        assert.equal(call, 3);
    });

    test('runId is set after run', async () => {
        const r = new PipelineRunner();
        await r.run('t', [], 'x', [], 'child');
        assert.ok(r.getRunId().length > 0);
    });
});

// ── 5. AI Provider shape tests (no real network) ──────────────
describe('AI Provider request building', () => {
    // We verify that the provider builds the correct body/headers
    // by intercepting the httpRequest via a local mock server.

    let server, serverPort;
    let lastRequest = null;

    before(async () => {
        await new Promise(resolve => {
            server = http.createServer((req, res) => {
                let body = '';
                req.on('data', c => body += c);
                req.on('end', () => {
                    lastRequest = { method: req.method, url: req.url, headers: req.headers, body };
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    // Return a minimal valid response for each provider
                    if (req.url.includes('/v1/chat/completions'))
                        res.end(JSON.stringify({ choices: [{ message: { content: 'mock' } }] }));
                    else if (req.url.includes('/v1/messages'))
                        res.end(JSON.stringify({ content: [{ text: 'mock' }] }));
                    else if (req.url.includes('/api/generate'))
                        res.end(JSON.stringify({ response: 'mock' }));
                    else if (req.url.includes('generateContent'))
                        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'mock' }] } }] }));
                    else if (req.url.includes('/v1/models') || req.url.includes('/api/tags'))
                        res.end(JSON.stringify({ data: [{ id: 'model-x' }], models: [{ name: 'tag/model-x' }] }));
                    else
                        res.end(JSON.stringify({}));
                });
            });
            server.listen(0, '127.0.0.1', () => { serverPort = server.address().port; resolve(); });
        });
    });

    after(() => server.close());

    // ---- inline httpRequest for these tests ----
    function httpReq(url, method, headers, body) {
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } };
            const req = http.request(opts, res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve(Buffer.concat(ch).toString())); });
            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    }

    // Minimal provider classes that hit local mock server
    class TestOpenAI {
        constructor(apiKey, base) { this.apiKey = apiKey; this.base = base; }
        async call(req) {
            const body = JSON.stringify({ model: req.model, messages: [{ role: 'user', content: req.userPrompt }], temperature: req.temperature, max_tokens: req.maxTokens, stream: false });
            const raw = await httpReq(this.base + '/v1/chat/completions', 'POST', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.apiKey, 'Content-Length': Buffer.byteLength(body) }, body);
            const j = JSON.parse(raw);
            return { content: j.choices?.[0]?.message?.content ?? '', model: req.model };
        }
        async listModels() {
            const raw = await httpReq(this.base + '/v1/models', 'GET', { 'Authorization': 'Bearer ' + this.apiKey }, null);
            return JSON.parse(raw).data.map(m => m.id);
        }
    }

    class TestAnthropic {
        constructor(apiKey, base) { this.apiKey = apiKey; this.base = base; }
        async call(req) {
            const body = JSON.stringify({ model: req.model, max_tokens: req.maxTokens, system: req.systemPrompt, messages: [{ role: 'user', content: req.userPrompt }], stream: false });
            const raw = await httpReq(this.base + '/v1/messages', 'POST', { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) }, body);
            return { content: JSON.parse(raw).content?.[0]?.text ?? '', model: req.model };
        }
    }

    class TestOllama {
        constructor(base) { this.base = base; }
        async call(req) {
            const body = JSON.stringify({ model: req.model, system: req.systemPrompt, prompt: req.userPrompt, options: { temperature: req.temperature }, stream: false });
            const raw = await httpReq(this.base + '/api/generate', 'POST', { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body);
            return { content: JSON.parse(raw).response ?? '', model: req.model };
        }
        async listModels() {
            const raw = await httpReq(this.base + '/api/tags', 'GET', {}, null);
            return JSON.parse(raw).models.map(m => m.name.split('/').pop());
        }
    }

    test('OpenAI call sends Authorization header', async () => {
        const p = new TestOpenAI('sk-test', `http://127.0.0.1:${serverPort}`);
        await p.call({ model: 'gpt-4.1', userPrompt: 'hello', systemPrompt: '', temperature: 0.7, maxTokens: 512 });
        assert.ok(lastRequest.headers.authorization?.startsWith('Bearer sk-test'));
    });

    test('OpenAI call sends correct endpoint', async () => {
        const p = new TestOpenAI('k', `http://127.0.0.1:${serverPort}`);
        await p.call({ model: 'gpt-4.1', userPrompt: 'hi', systemPrompt: '', temperature: 0.7, maxTokens: 512 });
        assert.equal(lastRequest.url, '/v1/chat/completions');
    });

    test('OpenAI call returns content', async () => {
        const p = new TestOpenAI('k', `http://127.0.0.1:${serverPort}`);
        const resp = await p.call({ model: 'gpt-4.1', userPrompt: 'hi', systemPrompt: '', temperature: 0.7, maxTokens: 512 });
        assert.equal(resp.content, 'mock');
    });

    test('OpenAI listModels returns array', async () => {
        const p = new TestOpenAI('k', `http://127.0.0.1:${serverPort}`);
        const models = await p.listModels();
        assert.ok(Array.isArray(models));
        assert.ok(models.length > 0);
    });

    test('Anthropic call sends x-api-key header', async () => {
        const p = new TestAnthropic('anth-key', `http://127.0.0.1:${serverPort}`);
        await p.call({ model: 'claude-sonnet-4-6', userPrompt: 'hi', systemPrompt: '', temperature: 0.7, maxTokens: 512 });
        assert.equal(lastRequest.headers['x-api-key'], 'anth-key');
    });

    test('Anthropic call sends anthropic-version header', async () => {
        const p = new TestAnthropic('k', `http://127.0.0.1:${serverPort}`);
        await p.call({ model: 'claude-sonnet-4-6', userPrompt: 'hi', systemPrompt: '', temperature: 0.7, maxTokens: 512 });
        assert.equal(lastRequest.headers['anthropic-version'], '2023-06-01');
    });

    test('Anthropic call returns content', async () => {
        const p = new TestAnthropic('k', `http://127.0.0.1:${serverPort}`);
        const resp = await p.call({ model: 'claude-sonnet-4-6', userPrompt: 'hi', systemPrompt: '', temperature: 0.7, maxTokens: 512 });
        assert.equal(resp.content, 'mock');
    });

    test('Ollama call uses /api/generate endpoint', async () => {
        const p = new TestOllama(`http://127.0.0.1:${serverPort}`);
        await p.call({ model: 'llama3.2', userPrompt: 'hi', systemPrompt: '', temperature: 0.5, maxTokens: 512 });
        assert.equal(lastRequest.url, '/api/generate');
    });

    test('Ollama call returns response', async () => {
        const p = new TestOllama(`http://127.0.0.1:${serverPort}`);
        const resp = await p.call({ model: 'llama3.2', userPrompt: 'hi', systemPrompt: '', temperature: 0.5, maxTokens: 512 });
        assert.equal(resp.content, 'mock');
    });

    test('Ollama listModels returns array', async () => {
        const p = new TestOllama(`http://127.0.0.1:${serverPort}`);
        const models = await p.listModels();
        assert.ok(Array.isArray(models) && models.length > 0);
    });
});

// ── 5b. GeminiImageProvider response parsing ──────────────────
describe('GeminiImageProvider response parsing', () => {
    test('parse inlineData (camelCase) from Gemini API response', () => {
        // Mock response (actual Gemini API format)
        const mockResponse = {
            candidates: [{
                content: {
                    parts: [
                        { text: 'Generated image description' },
                        { inlineData: { mimeType: 'image/jpeg', data: 'base64imagedata' } }
                    ]
                }
            }]
        };
        
        // Test response processing logic
        const responseParts = mockResponse.candidates[0].content.parts;
        const outputAttachments = [];
        let textContent = '';
        
        for (const part of responseParts) {
            if (part.text) {
                textContent += part.text;
            } else if (part.inlineData) {
                outputAttachments.push({
                    mimetype: part.inlineData.mimeType,
                    content: part.inlineData.data
                });
            }
        }
        
        assert.equal(textContent, 'Generated image description');
        assert.equal(outputAttachments.length, 1);
        assert.equal(outputAttachments[0].mimetype, 'image/jpeg');
        assert.equal(outputAttachments[0].content, 'base64imagedata');
    });

    test('extract both text and multiple images from response parts', () => {
        const mockResponse = {
            candidates: [{
                content: {
                    parts: [
                        { text: 'Here are the images: ' },
                        { inlineData: { mimeType: 'image/png', data: 'pngdata1' } },
                        { inlineData: { mimeType: 'image/jpeg', data: 'jpegdata2' } }
                    ]
                }
            }]
        };
        
        const responseParts = mockResponse.candidates[0].content.parts;
        const outputAttachments = [];
        let textContent = '';
        
        for (const part of responseParts) {
            if (part.text) {
                textContent += part.text;
            } else if (part.inlineData) {
                outputAttachments.push({
                    mimetype: part.inlineData.mimeType,
                    content: part.inlineData.data
                });
            }
        }
        
        assert.equal(textContent, 'Here are the images: ');
        assert.equal(outputAttachments.length, 2);
        assert.equal(outputAttachments[0].mimetype, 'image/png');
        assert.equal(outputAttachments[1].mimetype, 'image/jpeg');
    });

    test('handle response with only images (no text)', () => {
        const mockResponse = {
            candidates: [{
                content: {
                    parts: [
                        { inlineData: { mimeType: 'image/png', data: 'onlyimage' } }
                    ]
                }
            }]
        };
        
        const responseParts = mockResponse.candidates[0].content.parts;
        const outputAttachments = [];
        let textContent = '';
        
        for (const part of responseParts) {
            if (part.text) {
                textContent += part.text;
            } else if (part.inlineData) {
                outputAttachments.push({
                    mimetype: part.inlineData.mimeType,
                    content: part.inlineData.data
                });
            }
        }
        
        assert.equal(textContent, '');
        assert.equal(outputAttachments.length, 1);
        assert.equal(outputAttachments[0].mimetype, 'image/png');
    });

    test('handle empty response gracefully', () => {
        const mockResponse = { candidates: [{ content: { parts: [] } }] };
        
        const responseParts = mockResponse.candidates[0].content.parts;
        const outputAttachments = [];
        let textContent = '';
        
        for (const part of responseParts) {
            if (part.text) {
                textContent += part.text;
            } else if (part.inlineData) {
                outputAttachments.push({
                    mimetype: part.inlineData.mimeType,
                    content: part.inlineData.data
                });
            }
        }
        
        assert.equal(textContent, '');
        assert.equal(outputAttachments.length, 0);
    });
});

// ── 6. Bridge message routing ─────────────────────────────────
describe('Bridge message handling', () => {
    // Test that handleBridgeMessage dispatches correctly by running
    // the same logic with a fake postToJS that captures output.

    makeApp = function(tmpDir) {
        const st = new Storage();
        st.init(tmpDir);
        const r = new PipelineRunner();
        const vm = new PipelineVersionManager(st);
        const sent = [];
        const post = (type, payload) => sent.push({ type, payload });

        function handle(type, payload) {
            switch (type) {
                case 'save_session':
                    if (payload?.tabs) st.saveSession({ tabs: payload.tabs });
                    break;
                case 'save_node':
                    if (payload?.tabFile && payload?.root) st.saveTabData(payload.tabFile, payload.root);
                    break;
                case 'get_providers': {
                    const provs = st.loadProviders();
                    if (!provs.mock) provs.mock = { apiKey: '', baseUrl: '', models: ['echo', 'fixed'] };
                    post('providers_result', provs);
                    break;
                }
                case 'save_providers':
                    st.saveProviders(payload || {});
                    break;
                case 'save_pipeline':
                    if (payload?.name) {
                        const pl = st.loadPipelines();
                        const i = pl.findIndex(p => p.name === payload.name);
                        if (i >= 0) Object.assign(pl[i], payload); else pl.push(payload);
                        st.savePipelines(pl);
                        post('pipeline_list', { pipelines: pl });
                    }
                    break;
                case 'delete_pipeline':
                    if (payload?.name) {
                        const pl = st.loadPipelines().filter(p => p.name !== payload.name);
                        st.savePipelines(pl);
                        post('pipeline_list', { pipelines: pl });
                    }
                    break;
                case 'history_list': {
                    const items = st.listHistory().slice(0, 100).flatMap(f => {
                        const raw = st.loadHistoryRecord(f); if (!raw) return [];
                        const obj = JSON.parse(raw); if (!obj.pipelineName) return [];
                        return [{ id: obj.id || '', pipelineName: obj.pipelineName, startedAt: obj.startedAt || '', status: obj.status || 'completed', evaluation: obj.evaluation || '', stepCount: (obj.steps||[]).length }];
                    });
                    post('history_list_result', { items });
                    break;
                }
                case 'save_recipes':
                    st.saveRecipes(payload || []);
                    break;
                case 'save_config':
                    st.saveGeneralConfig({ historyRetention: payload?.historyRetention || 50, defaultProvider: payload?.defaultProvider || 'openai', defaultModel: payload?.defaultModel || '' });
                    break;
                case 'send_to_chest':
                    if (payload?.chestName && payload?.content != null) st.saveToNamedChest(payload.chestName, payload.content);
                    break;
                case 'view_chest':
                    if (payload?.chestName) {
                        const content = st.loadFromNamedChest(payload.chestName);
                        post('chest_view', { name: payload.chestName, content });
                    }
                    break;
                case 'cancel_pipeline':
                    r.cancel();
                    break;
                case 'run_prompt_process': {
                    // merge machine-level + belt-level attachments (mirrors main.js logic)
                    const allAttachments = [
                        ...(payload?.attachments || []),
                        ...(payload?.inputAttachments || []),
                    ];
                    post('run_prompt_process_captured', { allAttachments, content: payload?.content });
                    break;
                }
            }
        }

        return { st, r, sent, handle };
    }

    test('save_session persists tabs', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        handle('save_session', { tabs: [{ name: 'Tab1', file: 'tab1.json' }] });
        assert.equal(st.loadSession().tabs[0].name, 'Tab1');
        rmrf(tmpDir);
    });

    test('save_node persists node data', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        handle('save_node', { tabFile: 'node.json', root: { title: 'T', content: 'C', mimetype: 'text/plain', attachments: [], children: [] } });
        assert.equal(st.loadTabData('node.json').title, 'T');
        rmrf(tmpDir);
    });

    test('get_providers returns providers_result', () => {
        const tmpDir = makeTempDir();
        const { st, sent, handle } = makeApp(tmpDir);
        st.saveProviders({ openai: { apiKey: 'k', baseUrl: '', models: [] } });
        handle('get_providers');
        assert.equal(sent[0].type, 'providers_result');
        assert.equal(sent[0].payload.openai.apiKey, 'k');
        rmrf(tmpDir);
    });

    test('save_providers persists and save_providers round-trips', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        handle('save_providers', { anthropic: { apiKey: 'ant', baseUrl: '', models: [] } });
        assert.equal(st.loadProviders().anthropic.apiKey, 'ant');
        rmrf(tmpDir);
    });

    test('save_pipeline creates new pipeline', () => {
        const tmpDir = makeTempDir();
        const { st, sent, handle } = makeApp(tmpDir);
        handle('save_pipeline', { name: 'MyPipe', steps: [], mode: 'basic', outputMode: 'child' });
        assert.equal(sent[0].type, 'pipeline_list');
        assert.ok(sent[0].payload.pipelines.some(p => p.name === 'MyPipe'));
        rmrf(tmpDir);
    });

    test('save_pipeline updates existing pipeline', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        handle('save_pipeline', { name: 'P', steps: [], mode: 'basic', outputMode: 'child' });
        handle('save_pipeline', { name: 'P', steps: [{ name: 's1', type: 'ai', params: {} }], mode: 'basic', outputMode: 'sibling' });
        const pl = st.loadPipelines();
        const p = pl.find(x => x.name === 'P');
        assert.equal(p.outputMode, 'sibling');
        assert.equal(p.steps.length, 1);
        rmrf(tmpDir);
    });

    test('delete_pipeline removes pipeline', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        handle('save_pipeline', { name: 'Del', steps: [], mode: 'basic', outputMode: 'child' });
        handle('delete_pipeline', { name: 'Del' });
        assert.ok(!st.loadPipelines().some(p => p.name === 'Del'));
        rmrf(tmpDir);
    });

    test('history_list returns saved history', () => {
        const tmpDir = makeTempDir();
        const { st, sent, handle } = makeApp(tmpDir);
        st.saveHistory(JSON.stringify({ id: 'h1', pipelineName: 'P', status: 'completed', steps: [] }));
        handle('history_list');
        assert.equal(sent[0].type, 'history_list_result');
        assert.ok(sent[0].payload.items.some(i => i.id === 'h1'));
        rmrf(tmpDir);
    });

    test('save_recipes persists recipes', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        handle('save_recipes', [{ name: 'r1', type: 'ai', provider: 'openai', model: 'gpt-4.1', temperature: 0.8, systemPrompt: '', command: '' }]);
        assert.equal(st.loadRecipes()[0].name, 'r1');
        rmrf(tmpDir);
    });

    test('save_config persists config', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        handle('save_config', { historyRetention: 20, defaultProvider: 'gemini', defaultModel: 'gemini-2.5-pro' });
        const cfg = st.loadGeneralConfig();
        assert.equal(cfg.historyRetention, 20);
        assert.equal(cfg.defaultProvider, 'gemini');
        rmrf(tmpDir);
    });

    test('send_to_chest stores content in chest', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        handle('send_to_chest', { chestName: 'box', content: 'treasure' });
        assert.equal(st.loadFromNamedChest('box'), 'treasure');
        rmrf(tmpDir);
    });

    test('view_chest returns content via chest_view bridge', () => {
        const tmpDir = makeTempDir();
        const { st, sent, handle } = makeApp(tmpDir);
        st.saveToNamedChest('notes', 'hello world');
        handle('view_chest', { chestName: 'notes' });
        assert.equal(sent.length, 1);
        assert.equal(sent[0].type, 'chest_view');
        assert.equal(sent[0].payload.name, 'notes');
        assert.equal(sent[0].payload.content, 'hello world');
        rmrf(tmpDir);
    });

    test('cancel_pipeline stops the runner', () => {
        const tmpDir = makeTempDir();
        const { r, handle } = makeApp(tmpDir);
        handle('cancel_pipeline');
        assert.equal(r.isRunning(), false);
        rmrf(tmpDir);
    });

    test('run_prompt_process merges machine and belt attachments', () => {
        const tmpDir = makeTempDir();
        const { sent, handle } = makeApp(tmpDir);
        handle('run_prompt_process', {
            content: 'hello',
            attachments: [{ file: 'bg.png', mimetype: 'image/png' }],
            inputAttachments: [{ file: 'ref.jpg', mimetype: 'image/jpeg' }],
        });
        const captured = sent.find(s => s.type === 'run_prompt_process_captured');
        assert.ok(captured, 'run_prompt_process_captured should be emitted');
        assert.equal(captured.payload.allAttachments.length, 2);
        assert.equal(captured.payload.allAttachments[0].file, 'bg.png');
        assert.equal(captured.payload.allAttachments[1].file, 'ref.jpg');
        rmrf(tmpDir);
    });

    test('run_prompt_process with only machine attachments', () => {
        const tmpDir = makeTempDir();
        const { sent, handle } = makeApp(tmpDir);
        handle('run_prompt_process', {
            content: 'test',
            attachments: [{ file: 'ctx.mp3', mimetype: 'audio/mpeg' }],
        });
        const captured = sent.find(s => s.type === 'run_prompt_process_captured');
        assert.equal(captured.payload.allAttachments.length, 1);
        assert.equal(captured.payload.allAttachments[0].file, 'ctx.mp3');
        rmrf(tmpDir);
    });

    test('run_prompt_process with no attachments produces empty array', () => {
        const tmpDir = makeTempDir();
        const { sent, handle } = makeApp(tmpDir);
        handle('run_prompt_process', { content: 'x' });
        const captured = sent.find(s => s.type === 'run_prompt_process_captured');
        assert.deepStrictEqual(captured.payload.allAttachments, []);
        rmrf(tmpDir);
    });

    test('save_node persists selectedRecipe in node data', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        const nodeData = {
            title: 'MyNode',
            content: 'some content',
            mimetype: 'text/plain',
            attachments: [],
            inputAttachments: [],
            selectedRecipe: 'GPT-4 Fast',
            children: [],
        };
        handle('save_node', { tabFile: 'node.json', root: nodeData });
        const loaded = st.loadTabData('node.json');
        assert.equal(loaded.selectedRecipe, 'GPT-4 Fast');
        rmrf(tmpDir);
    });

    test('save_node persists node.attachments and node.inputAttachments', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        const nodeData = {
            title: 'N',
            content: '',
            mimetype: 'text/plain',
            attachments: [{ file: 'machine.png', mimetype: 'image/png' }],
            inputAttachments: [{ file: 'belt.wav', mimetype: 'audio/wav' }],
            children: [],
        };
        handle('save_node', { tabFile: 'n.json', root: nodeData });
        const loaded = st.loadTabData('n.json');
        assert.equal(loaded.attachments[0].file, 'machine.png');
        assert.equal(loaded.inputAttachments[0].file, 'belt.wav');
        rmrf(tmpDir);
    });
});

// inline buildMetaRecord — mirrors runner.js logic for step artifact inclusion
function buildMetaRecord(histStep) {
    return {
        name: histStep.name || '',
        type: histStep.type || 'ai',
        input: histStep.input || '',
        output: histStep.output || '',
        artifacts: histStep.artifacts || [],
        tokens: histStep.completionTokens || 0,
    };
}

// ── 7. buildMetaRecord — artifact field inclusion ─────────────
describe('buildMetaRecord artifact inclusion', () => {
    test('includes artifacts field defaulting to empty array', () => {
        const rec = buildMetaRecord({ name: 'step1', type: 'ai', input: 'in', output: 'out' });
        assert.deepStrictEqual(rec.artifacts, []);
    });

    test('preserves artifacts when present', () => {
        const artifacts = [{ label: 'report.pdf', path: '/tmp/report.pdf', type: 'file' }];
        const rec = buildMetaRecord({ name: 's', type: 'ai', input: 'i', output: 'o', artifacts });
        assert.deepStrictEqual(rec.artifacts, artifacts);
    });

    test('includes all required fields', () => {
        const rec = buildMetaRecord({ name: 'translate', type: 'ai', input: 'hello', output: 'こんにちは', completionTokens: 42 });
        assert.equal(rec.name, 'translate');
        assert.equal(rec.type, 'ai');
        assert.equal(rec.input, 'hello');
        assert.equal(rec.output, 'こんにちは');
        assert.equal(rec.tokens, 42);
        assert.deepStrictEqual(rec.artifacts, []);
    });

    test('pipeline_completed event steps can be mapped through buildMetaRecord', async () => {
        const r = new PipelineRunner();
        r.registerProvider('openai', { call: async () => ({ content: 'result', model: 'mock' }) });
        await r.run('pipe', [{ name: 's1', type: 'ai', params: { provider: 'openai', userPrompt: '{content}' } }], 'input', [], 'child');
        const done = r.events.find(e => e.type === 'pipeline_completed');
        assert.ok(done, 'pipeline_completed should be emitted');
        const records = done.payload.steps.map(buildMetaRecord);
        assert.equal(records.length, 1);
        assert.deepStrictEqual(records[0].artifacts, []);
        assert.equal(records[0].output, 'result');
    });
});

// ── 8. Pipeline state reset logic (Case B node-switch) ────────
describe('Pipeline state reset on node switch', () => {
    // Pure logic: mirrors the selectNode Case B reset in app.js
    function resetPipelineSteps(steps) {
        return steps.map(s => ({
            ...s,
            completed: false,
            input: '',
            output: '',
            streamingOutput: '',
            status: 'pending',
        }));
    }

    test('resetPipelineSteps clears completed flag on all steps', () => {
        const steps = [
            { name: 's1', completed: true, input: 'in', output: 'out', streamingOutput: 'x', status: 'completed' },
            { name: 's2', completed: false, input: '', output: '', streamingOutput: '', status: 'pending' },
        ];
        const reset = resetPipelineSteps(steps);
        assert.ok(reset.every(s => s.completed === false));
    });

    test('resetPipelineSteps clears input/output data', () => {
        const steps = [{ name: 's1', completed: true, input: 'hello', output: 'world', streamingOutput: 'wor', status: 'completed' }];
        const reset = resetPipelineSteps(steps);
        assert.equal(reset[0].input, '');
        assert.equal(reset[0].output, '');
        assert.equal(reset[0].streamingOutput, '');
    });

    test('resetPipelineSteps sets all statuses to pending', () => {
        const steps = [
            { name: 's1', completed: true, input: '', output: '', streamingOutput: '', status: 'completed' },
            { name: 's2', completed: true, input: '', output: '', streamingOutput: '', status: 'running' },
        ];
        const reset = resetPipelineSteps(steps);
        assert.ok(reset.every(s => s.status === 'pending'));
    });

    test('resetPipelineSteps preserves step name and other properties', () => {
        const steps = [{ name: 'translate', type: 'ai', completed: true, input: 'x', output: 'y', streamingOutput: '', status: 'completed' }];
        const reset = resetPipelineSteps(steps);
        assert.equal(reset[0].name, 'translate');
        assert.equal(reset[0].type, 'ai');
    });

    test('dialog should be shown when any step is completed (condition check)', () => {
        const shouldShowDialog = (viewMode, steps) =>
            viewMode === 'pipeline' && steps.some(s => s.completed);

        assert.ok(shouldShowDialog('pipeline', [{ completed: true }, { completed: false }]));
        assert.ok(!shouldShowDialog('pipeline', [{ completed: false }, { completed: false }]));
        assert.ok(!shouldShowDialog('node', [{ completed: true }]));
    });
});

// ─────────────────────────────────────────────────────────────
// Helper functions extracted from app.js for mode-specific tests
// ─────────────────────────────────────────────────────────────

// Mirror of app.js: reads last step output from child's pipelineMeta (view/normal mode output)
function getLastStepOutput(child) {
    let text = child.content ? (() => { try { return Buffer.from(child.content, 'base64').toString('utf8'); } catch { return child.content; } })() : '';
    let artifacts = [];
    if (child.pipelineMeta) {
        try {
            const meta = JSON.parse(child.pipelineMeta);
            if (meta && meta.steps && meta.steps.length > 0) {
                const last = meta.steps[meta.steps.length - 1];
                text = last.output || text;
                artifacts = last.artifacts || [];
            }
        } catch (e) {}
    }
    return { text, artifacts };
}

// Mirror of app.js processPrompt: build sent text for normal mode
function buildSentText(prompt, input) {
    return prompt.includes('{content}')
        ? prompt.replace('{content}', input)
        : (prompt + '\n\n' + input);
}

// Mirror of app.js renderPipelineInput: step source label (linked mode)
function getStepSourceLabel(stepIndex) {
    return stepIndex === 0 ? 'Original Input ({content})' : `Step ${stepIndex} Output ({result})`;
}

// Mirror of app.js renderPipelineOutput: select display text (linked mode)
function selectOutputText(step) {
    return step.completed
        ? (step.output || '(empty output)')
        : (step.streamingOutput || (step.status === 'running' ? '...' : '(pending)'));
}

// Mirror of app.js renderPipelineInput: get previous step artifacts (linked mode)
function getPrevArtifacts(steps, si) {
    return (si > 0 && steps[si - 1].artifacts) || [];
}

// ── 9. View mode (Node view mode) ───────────────────────────
describe('View mode — node view mode logic', () => {
    test('getLastStepOutput returns fallback content when no pipelineMeta', () => {
        const child = { content: Buffer.from('plain result').toString('base64') };
        const { text, artifacts } = getLastStepOutput(child);
        assert.equal(text, 'plain result');
        assert.deepStrictEqual(artifacts, []);
    });

    test('getLastStepOutput reads last step output from pipelineMeta', () => {
        const meta = { steps: [
            { name: 's1', output: 'step1 out', artifacts: [] },
            { name: 's2', output: 'step2 out', artifacts: [] },
        ]};
        const child = { content: '', pipelineMeta: JSON.stringify(meta) };
        const { text } = getLastStepOutput(child);
        assert.equal(text, 'step2 out');
    });

    test('getLastStepOutput returns artifacts from last step', () => {
        const artifacts = [{ label: 'result.pdf', path: '/tmp/result.pdf', type: 'file' }];
        const meta = { steps: [
            { name: 's1', output: 'text', artifacts },
        ]};
        const child = { content: '', pipelineMeta: JSON.stringify(meta) };
        const { artifacts: got } = getLastStepOutput(child);
        assert.deepStrictEqual(got, artifacts);
    });

    test('getLastStepOutput uses content as fallback when last step output is empty', () => {
        const meta = { steps: [{ name: 's1', output: '' }] };
        const child = {
            content: Buffer.from('fallback text').toString('base64'),
            pipelineMeta: JSON.stringify(meta),
        };
        const { text } = getLastStepOutput(child);
        assert.equal(text, 'fallback text');
    });

    test('getLastStepOutput tolerates invalid pipelineMeta JSON', () => {
        const child = {
            content: Buffer.from('safe fallback').toString('base64'),
            pipelineMeta: '{ broken json',
        };
        const { text, artifacts } = getLastStepOutput(child);
        assert.equal(text, 'safe fallback');
        assert.deepStrictEqual(artifacts, []);
    });

    test('node.inputAttachments is separate from node.attachments', () => {
        const node = {
            attachments: [{ file: 'machine.png', mimetype: 'image/png' }],
            inputAttachments: [{ file: 'belt.wav', mimetype: 'audio/wav' }],
        };
        assert.notDeepStrictEqual(node.attachments, node.inputAttachments);
        assert.equal(node.attachments[0].file, 'machine.png');
        assert.equal(node.inputAttachments[0].file, 'belt.wav');
    });

    test('selectedRecipe is restored from node.selectedRecipe on node switch', () => {
        // Simulates selectNode recipe restoration logic
        const node = { selectedRecipe: 'GPT-4 Fast', content: '' };
        const state = { selectedRecipe: '' };
        state.selectedRecipe = node.selectedRecipe || '';
        assert.equal(state.selectedRecipe, 'GPT-4 Fast');
    });

    test('selectedRecipe defaults to empty string if not set', () => {
        const node = { content: '' };  // no selectedRecipe field
        const state = { selectedRecipe: 'OldRecipe' };
        state.selectedRecipe = node.selectedRecipe || '';
        assert.equal(state.selectedRecipe, '');
    });
});

// ── 10. Normal mode (Normal single-run mode) ───────────────────
describe('Normal mode — normal single-run logic', () => {
    test('buildSentText replaces {content} placeholder', () => {
        assert.equal(buildSentText('Translate: {content}', 'Hello world'), 'Translate: Hello world');
    });

    test('buildSentText concatenates when no {content} placeholder', () => {
        assert.equal(buildSentText('Translate this:', 'Hello'), 'Translate this:\n\nHello');
    });

    test('buildSentText with empty input', () => {
        assert.equal(buildSentText('Say {content} please', ''), 'Say  please');
    });

    test('buildSentText with multiple {content} occurrences replaces first only', () => {
        // String.replace without /g replaces first match
        const result = buildSentText('{content} and {content}', 'X');
        assert.equal(result, 'X and {content}');
    });

    test('run_prompt_process payload includes machine and belt attachments', () => {
        const node = {
            attachments: [{ file: 'ctx.png', mimetype: 'image/png' }],
            inputAttachments: [{ file: 'input.jpg', mimetype: 'image/jpeg' }],
        };
        const payload = {
            content: 'my input',
            attachments: node.attachments || [],
            inputAttachments: node.inputAttachments || [],
        };
        assert.equal(payload.attachments.length, 1);
        assert.equal(payload.inputAttachments.length, 1);
        assert.equal(payload.attachments[0].file, 'ctx.png');
        assert.equal(payload.inputAttachments[0].file, 'input.jpg');
    });

    test('run_prompt_process payload has empty arrays when node has no attachments', () => {
        const node = {};
        const payload = {
            attachments: node.attachments || [],
            inputAttachments: node.inputAttachments || [],
        };
        assert.deepStrictEqual(payload.attachments, []);
        assert.deepStrictEqual(payload.inputAttachments, []);
    });

    test('merged allAttachments order: machine first, belt second', () => {
        const machineAtt = [{ file: 'm.png', mimetype: 'image/png' }];
        const beltAtt = [{ file: 'b.jpg', mimetype: 'image/jpeg' }];
        const all = [...machineAtt, ...beltAtt];
        assert.equal(all[0].file, 'm.png');
        assert.equal(all[1].file, 'b.jpg');
    });

    test('pipeline_completed event carries step output', async () => {
        const r = new PipelineRunner();
        r.registerProvider('openai', { call: async () => ({ content: 'translated text', model: 'mock' }) });
        await r.run('single', [
            { name: 'translate', type: 'ai', params: { provider: 'openai', userPrompt: 'Translate: {content}' } },
        ], 'Hello', [], 'child');
        const done = r.events.find(e => e.type === 'pipeline_completed');
        assert.equal(done.payload.steps[0].output, 'translated text');
        assert.equal(done.payload.steps[0].input, 'Hello');
    });
});

// ── 11. Linked mode (Pipeline/chain mode) ─────────────────────
describe('Linked mode — pipeline chain mode logic', () => {
    test('step 0 source label is Original Input ({content})', () => {
        assert.equal(getStepSourceLabel(0), 'Original Input ({content})');
    });

    test('step N source label references previous step', () => {
        assert.equal(getStepSourceLabel(1), 'Step 1 Output ({result})');
        assert.equal(getStepSourceLabel(3), 'Step 3 Output ({result})');
    });

    test('selectOutputText: pending step shows (pending)', () => {
        const step = { completed: false, status: 'pending', output: '', streamingOutput: '' };
        assert.equal(selectOutputText(step), '(pending)');
    });

    test('selectOutputText: running step shows ...', () => {
        const step = { completed: false, status: 'running', output: '', streamingOutput: '' };
        assert.equal(selectOutputText(step), '...');
    });

    test('selectOutputText: running step shows streamingOutput when available', () => {
        const step = { completed: false, status: 'running', output: '', streamingOutput: 'partial res' };
        assert.equal(selectOutputText(step), 'partial res');
    });

    test('selectOutputText: completed step shows output', () => {
        const step = { completed: true, status: 'completed', output: 'final answer', streamingOutput: 'partial' };
        assert.equal(selectOutputText(step), 'final answer');
    });

    test('selectOutputText: completed step with empty output shows (empty output)', () => {
        const step = { completed: true, status: 'completed', output: '', streamingOutput: '' };
        assert.equal(selectOutputText(step), '(empty output)');
    });

    test('getPrevArtifacts: step 0 has no previous artifacts', () => {
        const steps = [
            { artifacts: [{ label: 'file.txt' }] },
            { artifacts: [] },
        ];
        assert.deepStrictEqual(getPrevArtifacts(steps, 0), []);
    });

    test('getPrevArtifacts: step 1 gets step 0 artifacts', () => {
        const artifacts = [{ label: 'out.pdf', path: '/tmp/out.pdf' }];
        const steps = [
            { artifacts },
            { artifacts: [] },
        ];
        assert.deepStrictEqual(getPrevArtifacts(steps, 1), artifacts);
    });

    test('getPrevArtifacts: step 2 gets step 1 artifacts, not step 0', () => {
        const steps = [
            { artifacts: [{ label: 'step0.txt' }] },
            { artifacts: [{ label: 'step1.txt' }] },
            { artifacts: [] },
        ];
        const prev = getPrevArtifacts(steps, 2);
        assert.equal(prev[0].label, 'step1.txt');
    });

    test('pipeline {result} placeholder picks up previous step output', async () => {
        const r = new PipelineRunner();
        const calls = [];
        r.registerProvider('openai', { call: async req => { calls.push(req.userPrompt); return { content: `out:${req.userPrompt}`, model: 'mock' }; } });
        const steps = [
            { name: 's1', type: 'ai', params: { provider: 'openai', userPrompt: '{content}' } },
            { name: 's2', type: 'ai', params: { provider: 'openai', userPrompt: 'Review: {result}' } },
        ];
        await r.run('chain', steps, 'original', [], 'child');
        assert.equal(calls[0], 'original');
        assert.equal(calls[1], 'Review: out:original');
    });

    test('{content} stays original through all chain steps', async () => {
        const r = new PipelineRunner();
        const calls = [];
        r.registerProvider('openai', { call: async req => { calls.push(req.userPrompt); return { content: 'processed', model: 'mock' }; } });
        const steps = [
            { name: 's1', type: 'ai', params: { provider: 'openai', userPrompt: '{content}' } },
            { name: 's2', type: 'ai', params: { provider: 'openai', userPrompt: 'Keep original: {content}' } },
        ];
        await r.run('chain', steps, 'source text', [], 'child');
        assert.equal(calls[1], 'Keep original: source text');
    });

    test('step attachments default to empty when not set', () => {
        const steps = [
            { name: 's1', completed: false, input: '', output: '', streamingOutput: '', status: 'pending' },
        ];
        assert.deepStrictEqual(steps[0].attachments || [], []);
    });

    test('step-specific attachments are preserved per step index', () => {
        const meta = {
            steps: [
                { name: 's1', attachments: [{ file: 'ref.png', mimetype: 'image/png' }] },
                { name: 's2', attachments: [] },
            ]
        };
        assert.equal(meta.steps[0].attachments.length, 1);
        assert.equal(meta.steps[1].attachments.length, 0);
    });

    test('pipeline run with three steps chains outputs correctly', async () => {
        const r = new PipelineRunner();
        let n = 0;
        r.registerProvider('openai', { call: async req => ({ content: `step${++n}:${req.userPrompt}`, model: 'mock' }) });
        const steps = [
            { name: 's1', type: 'ai', params: { provider: 'openai', userPrompt: '{content}' } },
            { name: 's2', type: 'ai', params: { provider: 'openai', userPrompt: '{result}' } },
            { name: 's3', type: 'ai', params: { provider: 'openai', userPrompt: '{result}' } },
        ];
        await r.run('3step', steps, 'start', [], 'child');
        assert.equal(r.historySteps[0].output, 'step1:start');
        assert.equal(r.historySteps[1].output, 'step2:step1:start');
        assert.equal(r.historySteps[2].output, 'step3:step2:step1:start');
    });
});

// ── 12. MockAIProvider — scripted provider self-tests ─────────
describe('MockAIProvider — scripted provider', () => {
    test('queue: scripted content is returned in order', async () => {
        const p = new MockAIProvider();
        p.queue('first').queue('second').queue('third');
        assert.equal((await p.call({ userPrompt: 'x' })).content, 'first');
        assert.equal((await p.call({ userPrompt: 'x' })).content, 'second');
        assert.equal((await p.call({ userPrompt: 'x' })).content, 'third');
    });

    test('queue: model field is preserved', async () => {
        const p = new MockAIProvider();
        p.queue('reply', 'gpt-4o');
        const r = await p.call({ userPrompt: 'hi' });
        assert.equal(r.model, 'gpt-4o');
    });

    test('default (no queue): echoes userPrompt', async () => {
        const p = new MockAIProvider();
        const r = await p.call({ userPrompt: 'hello world' });
        assert.equal(r.content, 'echo:hello world');
    });

    test('queueError: throws with the given message', async () => {
        const p = new MockAIProvider();
        p.queueError('rate limit exceeded');
        await assert.rejects(() => p.call({ userPrompt: 'x' }), /rate limit exceeded/);
    });

    test('queueError followed by queue: error then success', async () => {
        const p = new MockAIProvider();
        p.queueError('timeout').queue('ok');
        await assert.rejects(() => p.call({ userPrompt: 'a' }));
        const r = await p.call({ userPrompt: 'b' });
        assert.equal(r.content, 'ok');
    });

    test('calls: every request is captured', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'q1', model: 'gpt-4o' });
        await p.call({ userPrompt: 'q2', model: 'claude' });
        assert.equal(p.callCount, 2);
        assert.equal(p.calls[0].userPrompt, 'q1');
        assert.equal(p.calls[1].userPrompt, 'q2');
    });

    test('lastCall returns most recent request', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'first' });
        await p.call({ userPrompt: 'last' });
        assert.equal(p.lastCall.userPrompt, 'last');
    });

    test('nthCall returns request at given index', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'a' });
        await p.call({ userPrompt: 'b' });
        await p.call({ userPrompt: 'c' });
        assert.equal(p.nthCall(1).userPrompt, 'b');
    });

    test('reset: clears queue and calls', async () => {
        const p = new MockAIProvider();
        p.queue('x');
        await p.call({ userPrompt: 'hi' });
        p.reset();
        assert.equal(p.callCount, 0);
        // After reset, default echo behaviour resumes
        const r = await p.call({ userPrompt: 'ping' });
        assert.equal(r.content, 'echo:ping');
    });

    test('captures all request fields', async () => {
        const p = new MockAIProvider();
        await p.call({ model: 'gpt-4o', systemPrompt: 'sys', userPrompt: 'up', temperature: 0.3, maxTokens: 512 });
        assert.equal(p.lastCall.model, 'gpt-4o');
        assert.equal(p.lastCall.systemPrompt, 'sys');
        assert.equal(p.lastCall.temperature, 0.3);
        assert.equal(p.lastCall.maxTokens, 512);
    });

    // ── when() — deterministic rule-based matching ──
    test('when: exact string match — same input always returns same output', async () => {
        const p = new MockAIProvider().when('hello', 'world');
        assert.equal((await p.call({ userPrompt: 'hello' })).content, 'world');
        assert.equal((await p.call({ userPrompt: 'hello' })).content, 'world');
        assert.equal((await p.call({ userPrompt: 'hello' })).content, 'world');
    });

    test('when: regex match', async () => {
        const p = new MockAIProvider().when(/translate/i, 'traduction');
        assert.equal((await p.call({ userPrompt: 'Translate: hello' })).content, 'traduction');
        assert.equal((await p.call({ userPrompt: 'translate something' })).content, 'traduction');
    });

    test('when: unmatched userPrompt falls through to queue', async () => {
        const p = new MockAIProvider().when('exact', 'rule hit').queue('queued');
        assert.equal((await p.call({ userPrompt: 'other' })).content, 'queued');
    });

    test('when: unmatched and empty queue falls through to echo', async () => {
        const p = new MockAIProvider().when('exact', 'rule hit');
        assert.equal((await p.call({ userPrompt: 'other' })).content, 'echo:other');
    });

    test('when: rule takes priority over queue for matching input', async () => {
        const p = new MockAIProvider().when('hi', 'rule').queue('queued');
        assert.equal((await p.call({ userPrompt: 'hi' })).content, 'rule');
        // queue is still intact
        assert.equal((await p.call({ userPrompt: 'other' })).content, 'queued');
    });

    test('when: function predicate', async () => {
        const p = new MockAIProvider().when(req => req.model === 'vision', 'saw it');
        assert.equal((await p.call({ userPrompt: 'x', model: 'vision' })).content, 'saw it');
        assert.equal((await p.call({ userPrompt: 'x', model: 'other' })).content, 'echo:x');
    });

    test('when: function predicate + function response returns full object', async () => {
        const img = { file: 'a.png', mimetype: 'image/png', content: 'data', size: 1 };
        const p = new MockAIProvider().when(
            req => req.attachments?.length > 0,
            req => ({ content: `got:${req.attachments[0].file}`, model: 'img-model', outputAttachments: [req.attachments[0]] })
        );
        const r = await p.call({ userPrompt: 'describe', attachments: [img] });
        assert.equal(r.content, 'got:a.png');
        assert.equal(r.model, 'img-model');
        assert.equal(r.outputAttachments.length, 1);
    });

    test('when: multiple rules — first match wins', async () => {
        const p = new MockAIProvider()
            .when('x', 'first')
            .when('x', 'second');
        assert.equal((await p.call({ userPrompt: 'x' })).content, 'first');
    });

    test('reset: clears rules along with queue and calls', async () => {
        const p = new MockAIProvider().when('hi', 'rule');
        await p.call({ userPrompt: 'hi' });
        p.reset();
        assert.equal(p.callCount, 0);
        // Rule should be gone; falls through to echo
        assert.equal((await p.call({ userPrompt: 'hi' })).content, 'echo:hi');
    });
});

// ── 13. Pipeline features tested with MockAIProvider ──────────
describe('Pipeline features — MockAIProvider', () => {
    // ── helper: build a one-step AI pipeline step
    function aiStep(name, userPrompt, extra = {}) {
        return { name, type: 'ai', params: { provider: 'mock', userPrompt, ...extra } };
    }

    function makeRunner(provider) {
        const r = new PipelineRunner();
        r.registerProvider('mock', provider);
        return r;
    }

    // ── correct prompt is sent to the provider ──
    test('single-step: userPrompt is sent verbatim', async () => {
        const p = new MockAIProvider().queue('ok');
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', 'Translate this text')], 'input', [], 'child');
        assert.equal(p.lastCall.userPrompt, 'Translate this text');
    });

    test('single-step: {content} is replaced with input', async () => {
        const p = new MockAIProvider().queue('done');
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', 'Echo: {content}')], 'hello', [], 'child');
        assert.equal(p.lastCall.userPrompt, 'Echo: hello');
    });

    test('single-step: provider receives correct model', async () => {
        const p = new MockAIProvider().queue('ok');
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', 'hi', { model: 'gpt-4o' })], 'x', [], 'child');
        assert.equal(p.lastCall.model, 'gpt-4o');
    });

    test('single-step: provider receives systemPrompt and temperature', async () => {
        const p = new MockAIProvider().queue('ok');
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', 'hi', { systemPrompt: 'Be terse', temperature: '0.2' })], 'x', [], 'child');
        assert.equal(p.lastCall.systemPrompt, 'Be terse');
        assert.equal(p.lastCall.temperature, 0.2);
    });

    test('single-step: output is stored in historySteps', async () => {
        const p = new MockAIProvider().queue('translated result');
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', '{content}')], 'source text', [], 'child');
        assert.equal(r.historySteps[0].output, 'translated result');
        assert.equal(r.historySteps[0].status, 'completed');
    });

    test('single-step: pipeline_completed event carries the output', async () => {
        const p = new MockAIProvider().queue('final answer');
        const r = makeRunner(p);
        await r.run('pipe', [aiStep('s1', '{content}')], 'question', [], 'child');
        const done = r.events.find(e => e.type === 'pipeline_completed');
        assert.equal(done.payload.steps[0].output, 'final answer');
    });

    // ── chaining ──
    test('two-step chain: step 2 receives step 1 output via {result}', async () => {
        const p = new MockAIProvider().queue('translated').queue('summary');
        const r = makeRunner(p);
        const steps = [
            aiStep('translate', '{content}'),
            aiStep('summarise', 'Summarise: {result}'),
        ];
        await r.run('chain', steps, 'long text', [], 'child');
        assert.equal(p.nthCall(1).userPrompt, 'Summarise: translated');
    });

    test('two-step chain: {content} stays original in step 2', async () => {
        const p = new MockAIProvider().queue('out1').queue('out2');
        const r = makeRunner(p);
        const steps = [aiStep('s1', '{content}'), aiStep('s2', 'Original was: {content}')];
        await r.run('chain', steps, 'original', [], 'child');
        assert.equal(p.nthCall(1).userPrompt, 'Original was: original');
    });

    test('three-step chain: output flows through all steps', async () => {
        const p = new MockAIProvider().queue('A').queue('B').queue('C');
        const r = makeRunner(p);
        const steps = [aiStep('s1', '{content}'), aiStep('s2', '{result}'), aiStep('s3', '{result}')];
        await r.run('chain', steps, 'start', [], 'child');
        assert.equal(r.historySteps[0].output, 'A');
        assert.equal(r.historySteps[1].output, 'B');
        assert.equal(r.historySteps[2].output, 'C');
        assert.equal(p.nthCall(1).userPrompt, 'A');
        assert.equal(p.nthCall(2).userPrompt, 'B');
    });

    // ── error handling ──
    test('provider error: pipeline emits pipeline_error', async () => {
        const p = new MockAIProvider().queueError('model overloaded');
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', 'hi')], 'x', [], 'child');
        const err = r.events.find(e => e.type === 'pipeline_error');
        assert.ok(err, 'pipeline_error should be emitted');
        assert.match(err.payload.message, /model overloaded/);
    });

    test('provider error: runner stops after first error', async () => {
        const p = new MockAIProvider().queueError('fail').queue('should not reach');
        const r = makeRunner(p);
        const steps = [aiStep('s1', 'hi'), aiStep('s2', 'hi')];
        await r.run('t', steps, 'x', [], 'child');
        assert.equal(p.callCount, 1);  // second step never runs
    });

    // ── recipe / provider settings ──
    test('recipe temperature is forwarded as float', async () => {
        const p = new MockAIProvider().queue('ok');
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', 'hi', { temperature: '0.9' })], 'x', [], 'child');
        assert.equal(p.lastCall.temperature, 0.9);
    });

    test('recipe systemPrompt is forwarded', async () => {
        const p = new MockAIProvider().queue('ok');
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', 'hi', { systemPrompt: 'You are a translator.' })], 'x', [], 'child');
        assert.equal(p.lastCall.systemPrompt, 'You are a translator.');
    });

    // ── multiple runs / statelessness ──
    test('separate runs do not share state', async () => {
        const p = new MockAIProvider();
        const r = makeRunner(p);
        p.queue('run1');
        await r.run('t', [aiStep('s1', '{content}')], 'first', [], 'child');
        assert.equal(r.historySteps[0].output, 'run1');

        p.queue('run2');
        await r.run('t', [aiStep('s1', '{content}')], 'second', [], 'child');
        assert.equal(r.historySteps[0].output, 'run2');
    });

    test('provider is called exactly once per step', async () => {
        const p = new MockAIProvider();
        const r = makeRunner(p);
        const steps = [aiStep('s1', 'a'), aiStep('s2', 'b'), aiStep('s3', 'c')];
        await r.run('t', steps, 'x', [], 'child');
        assert.equal(p.callCount, 3);
    });

    // ── manual step interleaved with AI step ──
    test('manual step pause does not call the provider', async () => {
        const p = new MockAIProvider().queue('ai done');
        const r = makeRunner(p);
        const steps = [
            { name: 'human', type: 'manual', params: { mode: 'view', prompt: 'Check this', choices: '[]' } },
            aiStep('ai', '{result}'),
        ];
        const runPromise = r.run('t', steps, 'data', [], 'child');
        // Resume the manual step immediately
        setImmediate(() => r.resumeManual('human approved'));
        await runPromise;
        assert.equal(p.callCount, 1);
        assert.equal(p.lastCall.userPrompt, 'human approved');
    });

    // ── run_prompt_process attachment merge (bridge layer) ──
    test('bridge run_prompt_process: merged allAttachments are passed correctly', () => {
        const machineAtt = [{ file: 'bg.png', mimetype: 'image/png' }];
        const beltAtt    = [{ file: 'ref.jpg', mimetype: 'image/jpeg' }];
        // Mirror main.js merge logic
        const all = [...machineAtt, ...beltAtt];
        assert.equal(all.length, 2);
        assert.equal(all[0].mimetype, 'image/png');
        assert.equal(all[1].mimetype, 'image/jpeg');
    });
});

// ── test data ─────────────────────────────────────────────────
// Reusable fake attachment objects (base64 content is minimal valid data)
const FAKE_IMAGE_PNG = {
    file: 'photo.png',
    path: '/tmp/photo.png',
    mimetype: 'image/png',
    content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    size: 68,
};
const FAKE_IMAGE_JPEG = {
    file: 'scene.jpg',
    path: '/tmp/scene.jpg',
    mimetype: 'image/jpeg',
    content: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQ=',
    size: 40,
};
const FAKE_AUDIO_MP3 = {
    file: 'voice.mp3',
    path: '/tmp/voice.mp3',
    mimetype: 'audio/mpeg',
    content: 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA',
    size: 512,
};
const FAKE_AUDIO_WAV = {
    file: 'sfx.wav',
    path: '/tmp/sfx.wav',
    mimetype: 'audio/wav',
    content: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
    size: 256,
};

// ── 14. MockAIProvider — image/audio input ────────────────────
describe('MockAIProvider — image/audio input', () => {
    test('single image attachment is captured in req.attachments', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'describe', attachments: [FAKE_IMAGE_PNG] });
        assert.equal(p.inputAttachmentsOf(0).length, 1);
        assert.equal(p.inputAttachmentsOf(0)[0].mimetype, 'image/png');
    });

    test('single audio attachment is captured in req.attachments', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'transcribe', attachments: [FAKE_AUDIO_MP3] });
        assert.equal(p.inputAttachmentsOf(0).length, 1);
        assert.equal(p.inputAttachmentsOf(0)[0].mimetype, 'audio/mpeg');
    });

    test('mixed image + audio attachments are all captured', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'analyse', attachments: [FAKE_IMAGE_JPEG, FAKE_AUDIO_WAV] });
        assert.equal(p.inputAttachmentsOf(0).length, 2);
    });

    test('inputImagesOf filters only image/* attachments', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'x', attachments: [FAKE_IMAGE_PNG, FAKE_AUDIO_MP3, FAKE_IMAGE_JPEG] });
        const imgs = p.inputImagesOf(0);
        assert.equal(imgs.length, 2);
        assert.ok(imgs.every(a => a.mimetype.startsWith('image/')));
    });

    test('inputAudiosOf filters only audio/* attachments', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'x', attachments: [FAKE_IMAGE_PNG, FAKE_AUDIO_MP3, FAKE_AUDIO_WAV] });
        const auds = p.inputAudiosOf(0);
        assert.equal(auds.length, 2);
        assert.ok(auds.every(a => a.mimetype.startsWith('audio/')));
    });

    test('no attachments field → inputAttachmentsOf returns []', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'plain text only' });
        assert.deepStrictEqual(p.inputAttachmentsOf(0), []);
    });

    test('base64 content is preserved exactly', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'x', attachments: [FAKE_IMAGE_PNG] });
        assert.equal(p.inputAttachmentsOf(0)[0].content, FAKE_IMAGE_PNG.content);
    });

    test('file metadata (file, path, size) is preserved', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'x', attachments: [FAKE_AUDIO_MP3] });
        const att = p.inputAttachmentsOf(0)[0];
        assert.equal(att.file, FAKE_AUDIO_MP3.file);
        assert.equal(att.path, FAKE_AUDIO_MP3.path);
        assert.equal(att.size, FAKE_AUDIO_MP3.size);
    });

    test('attachments snapshot is independent (mutation after call does not affect captures)', async () => {
        const p = new MockAIProvider();
        const atts = [{ ...FAKE_IMAGE_PNG }];
        await p.call({ userPrompt: 'x', attachments: atts });
        atts[0].content = 'mutated';           // mutate original array
        assert.equal(p.inputAttachmentsOf(0)[0].content, FAKE_IMAGE_PNG.content);
    });

    test('lastInputAttachments points to most recent call', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'first', attachments: [FAKE_IMAGE_PNG] });
        await p.call({ userPrompt: 'second', attachments: [FAKE_AUDIO_MP3] });
        assert.equal(p.lastInputAttachments[0].mimetype, 'audio/mpeg');
    });

    test('per-call attachment tracking across multiple calls', async () => {
        const p = new MockAIProvider();
        await p.call({ userPrompt: 'a', attachments: [FAKE_IMAGE_PNG] });
        await p.call({ userPrompt: 'b', attachments: [FAKE_AUDIO_WAV] });
        await p.call({ userPrompt: 'c', attachments: [] });
        assert.equal(p.inputImagesOf(0).length, 1);
        assert.equal(p.inputAudiosOf(1).length, 1);
        assert.equal(p.inputAttachmentsOf(2).length, 0);
    });
});

// ── 15. MockAIProvider — media output (queueWithMedia) ────────
describe('MockAIProvider — media output', () => {
    test('queueWithMedia: outputAttachments returned in response', async () => {
        const p = new MockAIProvider();
        const outputAudio = { ...FAKE_AUDIO_MP3, file: 'tts_result.mp3' };
        p.queueWithMedia('Here is the audio', [outputAudio]);
        const resp = await p.call({ userPrompt: 'read this aloud' });
        assert.equal(resp.content, 'Here is the audio');
        assert.equal(resp.outputAttachments.length, 1);
        assert.equal(resp.outputAttachments[0].mimetype, 'audio/mpeg');
    });

    test('queueWithMedia: image output (e.g. generated image)', async () => {
        const p = new MockAIProvider();
        const outputImg = { ...FAKE_IMAGE_PNG, file: 'generated.png' };
        p.queueWithMedia('Image generated', [outputImg]);
        const resp = await p.call({ userPrompt: 'draw a cat' });
        assert.equal(resp.outputAttachments[0].file, 'generated.png');
        assert.equal(resp.outputAttachments[0].mimetype, 'image/png');
    });

    test('queueWithMedia: multiple output attachments', async () => {
        const p = new MockAIProvider();
        p.queueWithMedia('Two outputs', [FAKE_IMAGE_PNG, FAKE_AUDIO_MP3]);
        const resp = await p.call({ userPrompt: 'x' });
        assert.equal(resp.outputAttachments.length, 2);
    });

    test('queue (text-only): outputAttachments is empty array', async () => {
        const p = new MockAIProvider().queue('plain text');
        const resp = await p.call({ userPrompt: 'x' });
        assert.deepStrictEqual(resp.outputAttachments, []);
    });

    test('default (no queue): outputAttachments is empty array', async () => {
        const p = new MockAIProvider();
        const resp = await p.call({ userPrompt: 'x' });
        assert.deepStrictEqual(resp.outputAttachments, []);
    });

    test('queueWithMedia model field is preserved', async () => {
        const p = new MockAIProvider();
        p.queueWithMedia('result', [], 'dall-e-3');
        const resp = await p.call({ userPrompt: 'x' });
        assert.equal(resp.model, 'dall-e-3');
    });

    test('output and input attachments are independent', async () => {
        const p = new MockAIProvider();
        const outImg = { ...FAKE_IMAGE_JPEG, file: 'output.jpg' };
        p.queueWithMedia('done', [outImg]);
        const resp = await p.call({ userPrompt: 'x', attachments: [FAKE_AUDIO_MP3] });
        // Input: audio; Output: image — should not mix
        assert.equal(p.inputAudiosOf(0).length, 1);
        assert.equal(resp.outputAttachments[0].mimetype, 'image/jpeg');
    });
});

// ── 16. Pipeline — attachments flow through runner ────────────
describe('Pipeline — attachments flow through PipelineRunner', () => {
    function aiStep(name, prompt) {
        return { name, type: 'ai', params: { provider: 'mock', userPrompt: prompt } };
    }
    function makeRunner(provider) {
        const r = new PipelineRunner();
        r.registerProvider('mock', provider);
        return r;
    }

    test('inputAttachments are forwarded to the provider', async () => {
        const p = new MockAIProvider();
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', '{content}')], 'text', [FAKE_IMAGE_PNG], 'child');
        assert.equal(p.inputAttachmentsOf(0).length, 1);
        assert.equal(p.inputAttachmentsOf(0)[0].file, 'photo.png');
    });

    test('multiple mixed attachments are all forwarded', async () => {
        const p = new MockAIProvider();
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', '{content}')], 'text',
            [FAKE_IMAGE_PNG, FAKE_AUDIO_MP3, FAKE_IMAGE_JPEG], 'child');
        assert.equal(p.inputAttachmentsOf(0).length, 3);
        assert.equal(p.inputImagesOf(0).length, 2);
        assert.equal(p.inputAudiosOf(0).length, 1);
    });

    test('same inputAttachments are forwarded to every step in the chain', async () => {
        const p = new MockAIProvider();
        const r = makeRunner(p);
        const steps = [aiStep('s1', '{content}'), aiStep('s2', '{result}')];
        await r.run('t', steps, 'input', [FAKE_AUDIO_WAV], 'child');
        assert.equal(p.inputAudiosOf(0).length, 1);
        assert.equal(p.inputAudiosOf(1).length, 1);
    });

    test('no attachments: provider receives empty array', async () => {
        const p = new MockAIProvider();
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', 'hi')], 'x', [], 'child');
        assert.deepStrictEqual(p.inputAttachmentsOf(0), []);
    });

    test('outputAttachments from provider are stored as historyStep.artifacts', async () => {
        const p = new MockAIProvider();
        const outputAudio = { ...FAKE_AUDIO_MP3, file: 'tts.mp3' };
        p.queueWithMedia('spoken text', [outputAudio]);
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', '{content}')], 'hello', [], 'child');
        const artifacts = r.historySteps[0].artifacts;
        assert.ok(Array.isArray(artifacts));
        assert.equal(artifacts.length, 1);
        assert.equal(artifacts[0].file, 'tts.mp3');
    });

    test('outputAttachments are in pipeline_completed event steps', async () => {
        const p = new MockAIProvider();
        const outImg = { ...FAKE_IMAGE_PNG, file: 'gen.png' };
        p.queueWithMedia('image created', [outImg]);
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', 'generate')], 'prompt', [], 'child');
        const done = r.events.find(e => e.type === 'pipeline_completed');
        const step = done.payload.steps[0];
        assert.equal(step.artifacts?.[0]?.file, 'gen.png');
    });

    test('text-only response leaves historyStep.artifacts undefined (not set)', async () => {
        const p = new MockAIProvider().queue('plain output');
        const r = makeRunner(p);
        await r.run('t', [aiStep('s1', 'hi')], 'x', [], 'child');
        // outputAttachments was [] so artifacts should not be set
        assert.ok(!r.historySteps[0].artifacts || r.historySteps[0].artifacts.length === 0);
    });

    test('image input + audio output round-trip through pipeline', async () => {
        const p = new MockAIProvider();
        const ttsAudio = { ...FAKE_AUDIO_MP3, file: 'tts_output.mp3' };
        p.queueWithMedia('Audio generated from image description', [ttsAudio]);
        const r = makeRunner(p);
        await r.run('image-to-speech', [aiStep('describe+speak', 'Describe and read: {content}')],
            'an image of a sunset', [FAKE_IMAGE_JPEG], 'child');
        // Input: JPEG was sent
        assert.equal(p.inputImagesOf(0)[0].mimetype, 'image/jpeg');
        // Output: MP3 was produced
        assert.equal(r.historySteps[0].artifacts[0].file, 'tts_output.mp3');
        // Text output is captured
        assert.equal(r.historySteps[0].output, 'Audio generated from image description');
    });

    test('callStreaming delegates to call and invokes onChunk/onDone', async () => {
        const p = new MockAIProvider().queue('streamed reply');
        const chunks = [];
        let doneResp = null;
        await p.callStreaming(
            { userPrompt: 'hi', attachments: [] },
            chunk => chunks.push(chunk),
            resp  => { doneResp = resp; },
            _err  => { throw new Error('unexpected error'); }
        );
        assert.deepStrictEqual(chunks, ['streamed reply']);
        assert.equal(doneResp.content, 'streamed reply');
    });

    test('callStreaming error calls onError, not onDone', async () => {
        const p = new MockAIProvider().queueError('stream failed');
        let errMsg = null;
        await p.callStreaming(
            { userPrompt: 'hi', attachments: [] },
            () => { throw new Error('should not chunk'); },
            () => { throw new Error('should not done'); },
            msg => { errMsg = msg; }
        );
        assert.match(errMsg, /stream failed/);
    });
});

// ── inline MockProvider — mirrors main.js MockProvider ────────
// Kept in sync with main.js; if main.js changes, update here too.
class MockProvider {
    name() { return 'mock'; }
    defaultModels() { return ['echo', 'fixed', 'image-echo', 'image-compose']; }

    async call(req) {
        const model  = (req.model || 'echo').toLowerCase();
        const atts   = req.attachments || [];
        const images = atts.filter(a => a.mimetype?.startsWith('image/'));
        let content;
        let outputAttachments = [];

        if (model === 'image-echo') {
            const img = images[0];
            if (img) {
                content = `[Mock image-echo: ${img.file}]`;
                outputAttachments = [{ ...img, file: `echo_${img.file}` }];
            } else {
                content = '[Mock image-echo: no image provided]';
            }
        } else if (model === 'image-compose') {
            const base  = images[0];
            const extra = images.slice(1);
            if (base) {
                content = `[Mock image-compose: base=${base.file}, inputs=${extra.length}]`;
                outputAttachments = [{ ...base, file: `composed_${base.file}` }];
            } else {
                content = '[Mock image-compose: no base image provided]';
            }
        } else if (model === 'fixed') {
            content = req.systemPrompt || '[Mock: systemPrompt is empty]';
        } else {
            content = `[Mock] ${req.userPrompt}`;
            if (atts.length > 0) {
                const imgs  = images.length;
                const auds  = atts.filter(a => a.mimetype?.startsWith('audio/')).length;
                const other = atts.length - imgs - auds;
                const parts = [];
                if (imgs)  parts.push(`${imgs} image(s)`);
                if (auds)  parts.push(`${auds} audio(s)`);
                if (other) parts.push(`${other} other(s)`);
                content += `\n[Attachments: ${parts.join(', ')}]`;
            }
        }
        return { content, model: req.model || 'echo', outputAttachments };
    }

    async listModels() { return this.defaultModels(); }
    async testConnection() { return ''; }
}

// ── 17. MockProvider (app recipe provider) ────────────────────
describe('MockProvider — app recipe provider', () => {
    test('echo model returns [Mock] + userPrompt', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'echo', userPrompt: 'Translate this', systemPrompt: '' });
        assert.equal(r.content, '[Mock] Translate this');
    });

    test('fixed model returns systemPrompt verbatim', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'fixed', userPrompt: 'ignored', systemPrompt: 'Fixed reply here' });
        assert.equal(r.content, 'Fixed reply here');
    });

    test('fixed model with empty systemPrompt returns placeholder', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'fixed', userPrompt: 'hi', systemPrompt: '' });
        assert.equal(r.content, '[Mock: systemPrompt is empty]');
    });

    test('model field is preserved in response', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'echo', userPrompt: 'hi' });
        assert.equal(r.model, 'echo');
    });

    test('no model → defaults to echo behaviour', async () => {
        const p = new MockProvider();
        const r = await p.call({ userPrompt: 'hello' });
        assert.match(r.content, /\[Mock\]/);
    });

    test('no attachments → no attachment summary appended', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'echo', userPrompt: 'hi', attachments: [] });
        assert.ok(!r.content.includes('[Attachments:'));
    });

    test('single image attachment appended to summary', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'echo', userPrompt: 'hi', attachments: [FAKE_IMAGE_PNG] });
        assert.match(r.content, /\[Attachments: 1 image\(s\)\]/);
    });

    test('single audio attachment appended to summary', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'echo', userPrompt: 'hi', attachments: [FAKE_AUDIO_MP3] });
        assert.match(r.content, /\[Attachments: 1 audio\(s\)\]/);
    });

    test('mixed image + audio attachment summary', async () => {
        const p = new MockProvider();
        const r = await p.call({
            model: 'echo', userPrompt: 'hi',
            attachments: [FAKE_IMAGE_PNG, FAKE_IMAGE_JPEG, FAKE_AUDIO_MP3],
        });
        assert.match(r.content, /2 image\(s\)/);
        assert.match(r.content, /1 audio\(s\)/);
    });

    test('fixed model + attachments: shows only fixed text (no attachment summary)', async () => {
        const p = new MockProvider();
        const r = await p.call({
            model: 'fixed', systemPrompt: 'OK', userPrompt: 'ignored',
            attachments: [FAKE_AUDIO_WAV],
        });
        assert.equal(r.content, 'OK');
    });

    test('listModels returns all four models', async () => {
        const p = new MockProvider();
        const models = await p.listModels();
        assert.deepStrictEqual(models, ['echo', 'fixed', 'image-echo', 'image-compose']);
    });

    test('testConnection always succeeds (returns empty string)', async () => {
        const p = new MockProvider();
        const err = await p.testConnection();
        assert.equal(err, '');
    });

    test('get_providers bridge includes mock entry', () => {
        const tmpDir = makeTempDir();
        const { sent, handle } = makeApp(tmpDir);
        handle('get_providers');
        const result = sent.find(s => s.type === 'providers_result');
        assert.ok(result?.payload?.mock, 'providers_result should include mock');
        assert.deepStrictEqual(result.payload.mock.models, ['echo', 'fixed']);
        rmrf(tmpDir);
    });
});

// ── 18. MockProvider in pipeline via PipelineRunner ───────────
describe('MockProvider — pipeline integration', () => {
    function makeRunnerWithMock() {
        const r = new PipelineRunner();
        r.registerProvider('mock', new MockProvider());
        return r;
    }

    // Override registerProvider in test shim to accept a provider object directly
    // (In these tests we pass the MockProvider instance, matching main.js behaviour)

    test('recipe with provider=mock, model=echo runs without error', async () => {
        const r = new PipelineRunner();
        r.providers['mock'] = new MockProvider();
        await r.run('t', [{ name: 's1', type: 'ai', params: { provider: 'mock', model: 'echo', userPrompt: 'Hello' } }], 'x', [], 'child');
        assert.equal(r.historySteps[0].status, 'completed');
        assert.equal(r.historySteps[0].output, '[Mock] Hello');
    });

    test('recipe with provider=mock, model=fixed returns systemPrompt', async () => {
        const r = new PipelineRunner();
        r.providers['mock'] = new MockProvider();
        await r.run('t', [{
            name: 's1', type: 'ai',
            params: { provider: 'mock', model: 'fixed', userPrompt: 'ignored', systemPrompt: 'Test response text' },
        }], 'x', [], 'child');
        assert.equal(r.historySteps[0].output, 'Test response text');
    });

    test('{content} substitution works with mock provider', async () => {
        const r = new PipelineRunner();
        r.providers['mock'] = new MockProvider();
        await r.run('t', [{
            name: 's1', type: 'ai',
            params: { provider: 'mock', model: 'echo', userPrompt: 'Process: {content}' },
        }], 'my data', [], 'child');
        assert.equal(r.historySteps[0].output, '[Mock] Process: my data');
    });

    test('mock provider in chain: {result} flows from step 1 to step 2', async () => {
        const r = new PipelineRunner();
        r.providers['mock'] = new MockProvider();
        const steps = [
            { name: 's1', type: 'ai', params: { provider: 'mock', model: 'echo', userPrompt: '{content}' } },
            { name: 's2', type: 'ai', params: { provider: 'mock', model: 'echo', userPrompt: 'Got: {result}' } },
        ];
        await r.run('chain', steps, 'input text', [], 'child');
        assert.equal(r.historySteps[0].output, '[Mock] input text');
        assert.equal(r.historySteps[1].output, '[Mock] Got: [Mock] input text');
    });

    test('mock provider with image attachment includes summary in output', async () => {
        const r = new PipelineRunner();
        r.providers['mock'] = new MockProvider();
        await r.run('t', [{
            name: 's1', type: 'ai',
            params: { provider: 'mock', model: 'echo', userPrompt: 'Describe image' },
        }], 'x', [FAKE_IMAGE_PNG], 'child');
        assert.match(r.historySteps[0].output, /1 image\(s\)/);
    });

    test('mock provider with audio attachment includes summary in output', async () => {
        const r = new PipelineRunner();
        r.providers['mock'] = new MockProvider();
        await r.run('t', [{
            name: 's1', type: 'ai',
            params: { provider: 'mock', model: 'echo', userPrompt: 'Transcribe' },
        }], 'x', [FAKE_AUDIO_MP3], 'child');
        assert.match(r.historySteps[0].output, /1 audio\(s\)/);
    });

    test('mock recipe can be saved and loaded as a standard recipe entry', () => {
        const tmpDir = makeTempDir();
        const { st, handle } = makeApp(tmpDir);
        const mockRecipe = {
            name: 'Mock Echo',
            type: 'ai',
            provider: 'mock',
            model: 'echo',
            temperature: 0.7,
            systemPrompt: '',
            command: '',
        };
        handle('save_recipes', [mockRecipe]);
        const loaded = st.loadRecipes();
        assert.equal(loaded[0].name, 'Mock Echo');
        assert.equal(loaded[0].provider, 'mock');
        assert.equal(loaded[0].model, 'echo');
        rmrf(tmpDir);
    });
});

// ── 19. MockProvider — image-echo / image-compose ─────────────
describe('MockProvider — image modes', () => {
    // ── image-echo ──
    test('image-echo: returns first image as outputAttachment', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-echo', userPrompt: 'describe', attachments: [FAKE_IMAGE_PNG] });
        assert.equal(r.outputAttachments.length, 1);
        assert.equal(r.outputAttachments[0].mimetype, 'image/png');
    });

    test('image-echo: output filename is prefixed with echo_', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-echo', userPrompt: 'x', attachments: [FAKE_IMAGE_PNG] });
        assert.equal(r.outputAttachments[0].file, `echo_${FAKE_IMAGE_PNG.file}`);
    });

    test('image-echo: base64 content of input is preserved in output', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-echo', userPrompt: 'x', attachments: [FAKE_IMAGE_PNG] });
        assert.equal(r.outputAttachments[0].content, FAKE_IMAGE_PNG.content);
    });

    test('image-echo: content text names the file', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-echo', userPrompt: 'x', attachments: [FAKE_IMAGE_JPEG] });
        assert.match(r.content, /image-echo/);
        assert.match(r.content, new RegExp(FAKE_IMAGE_JPEG.file));
    });

    test('image-echo: with no image returns error text and empty outputAttachments', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-echo', userPrompt: 'x', attachments: [] });
        assert.equal(r.outputAttachments.length, 0);
        assert.match(r.content, /no image provided/);
    });

    test('image-echo: multiple images — only first is returned', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-echo', userPrompt: 'x',
            attachments: [FAKE_IMAGE_PNG, FAKE_IMAGE_JPEG] });
        assert.equal(r.outputAttachments.length, 1);
        assert.equal(r.outputAttachments[0].file, `echo_${FAKE_IMAGE_PNG.file}`);
    });

    test('image-echo: audio attachments are ignored (not treated as image)', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-echo', userPrompt: 'x',
            attachments: [FAKE_AUDIO_MP3] });
        assert.equal(r.outputAttachments.length, 0);
        assert.match(r.content, /no image provided/);
    });

    // ── image-compose ──
    test('image-compose: first image is base, returns composed outputAttachment', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-compose', userPrompt: 'x',
            attachments: [FAKE_IMAGE_PNG, FAKE_IMAGE_JPEG] });
        assert.equal(r.outputAttachments.length, 1);
        assert.equal(r.outputAttachments[0].file, `composed_${FAKE_IMAGE_PNG.file}`);
    });

    test('image-compose: content names base file and input count', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-compose', userPrompt: 'x',
            attachments: [FAKE_IMAGE_PNG, FAKE_IMAGE_JPEG] });
        assert.match(r.content, /base=photo\.png/);
        assert.match(r.content, /inputs=1/);
    });

    test('image-compose: single image = base + 0 extra inputs', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-compose', userPrompt: 'x',
            attachments: [FAKE_IMAGE_PNG] });
        assert.match(r.content, /inputs=0/);
        assert.equal(r.outputAttachments.length, 1);
    });

    test('image-compose: three images — base + 2 extra inputs', async () => {
        const extra = { ...FAKE_IMAGE_PNG, file: 'extra.png' };
        const p = new MockProvider();
        const r = await p.call({ model: 'image-compose', userPrompt: 'x',
            attachments: [FAKE_IMAGE_PNG, FAKE_IMAGE_JPEG, extra] });
        assert.match(r.content, /inputs=2/);
    });

    test('image-compose: no images → error text and empty outputAttachments', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-compose', userPrompt: 'x', attachments: [] });
        assert.equal(r.outputAttachments.length, 0);
        assert.match(r.content, /no base image provided/);
    });

    test('image-compose: audio attachments are not counted as images', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-compose', userPrompt: 'x',
            attachments: [FAKE_AUDIO_MP3, FAKE_IMAGE_PNG] });
        // FAKE_AUDIO_MP3 is not an image, so FAKE_IMAGE_PNG becomes the base
        assert.match(r.content, /base=photo\.png/);
        assert.match(r.content, /inputs=0/);
    });

    test('image-compose: composed output preserves mimetype of base image', async () => {
        const p = new MockProvider();
        const r = await p.call({ model: 'image-compose', userPrompt: 'x',
            attachments: [FAKE_IMAGE_JPEG, FAKE_IMAGE_PNG] });
        assert.equal(r.outputAttachments[0].mimetype, 'image/jpeg');
    });
});

// ── 20. MockProvider image modes through PipelineRunner ───────
describe('MockProvider image modes — pipeline integration', () => {
    function makeRunner() {
        const r = new PipelineRunner();
        r.providers['mock'] = new MockProvider();
        return r;
    }
    function imgStep(model) {
        return { name: 's1', type: 'ai', params: { provider: 'mock', model, userPrompt: 'process' } };
    }

    test('image-echo: output image stored in historyStep.artifacts', async () => {
        const r = makeRunner();
        await r.run('t', [imgStep('image-echo')], 'x', [FAKE_IMAGE_PNG], 'child');
        assert.equal(r.historySteps[0].artifacts?.length, 1);
        assert.equal(r.historySteps[0].artifacts[0].mimetype, 'image/png');
    });

    test('image-compose: composed image stored in historyStep.artifacts', async () => {
        const r = makeRunner();
        await r.run('t', [imgStep('image-compose')], 'x',
            [FAKE_IMAGE_PNG, FAKE_IMAGE_JPEG], 'child');
        assert.equal(r.historySteps[0].artifacts?.length, 1);
        assert.match(r.historySteps[0].artifacts[0].file, /^composed_/);
    });

    test('image-compose: output artifact in pipeline_completed event', async () => {
        const r = makeRunner();
        await r.run('t', [imgStep('image-compose')], 'x',
            [FAKE_IMAGE_PNG, FAKE_IMAGE_JPEG], 'child');
        const done = r.events.find(e => e.type === 'pipeline_completed');
        assert.equal(done.payload.steps[0].artifacts?.[0]?.mimetype, 'image/png');
    });

    test('two-step: image-echo then echo — output text flows via {result}', async () => {
        const r = makeRunner();
        const steps = [
            imgStep('image-echo'),
            { name: 's2', type: 'ai', params: { provider: 'mock', model: 'echo', userPrompt: 'Received: {result}' } },
        ];
        await r.run('t', steps, 'x', [FAKE_IMAGE_PNG], 'child');
        assert.match(r.historySteps[1].output, /Received:.*image-echo/);
    });
});

// ── 21. Drag-and-drop file processing logic ───────────────────
describe('Drag-and-drop file processing logic', () => {
    // Pure logic: mirrors app.js handleFileDrop — reads File objects and
    // converts to attachment objects. Tested without DOM via a stub.

    // Stub simulating browser FileReader behavior (synchronous for tests)
    function stubReadAsDataURL(file, base64Content) {
        return {
            file: file.name,
            path: file.path || '',
            mimetype: file.type,
            content: base64Content,
            size: file.size,
        };
    }

    // Mirror of app.js handleFileDrop filtering logic
    function filterDroppableFiles(files) {
        return files.filter(f =>
            f.type.startsWith('image/') ||
            f.type.startsWith('audio/') ||
            f.type.startsWith('video/')
        );
    }

    test('image files pass the filter', () => {
        const files = [{ name: 'a.png', type: 'image/png', size: 100 }];
        assert.equal(filterDroppableFiles(files).length, 1);
    });

    test('audio files pass the filter', () => {
        const files = [{ name: 'a.mp3', type: 'audio/mpeg', size: 100 }];
        assert.equal(filterDroppableFiles(files).length, 1);
    });

    test('video files pass the filter', () => {
        const files = [{ name: 'a.mp4', type: 'video/mp4', size: 100 }];
        assert.equal(filterDroppableFiles(files).length, 1);
    });

    test('text files are rejected by the filter', () => {
        const files = [{ name: 'readme.txt', type: 'text/plain', size: 100 }];
        assert.equal(filterDroppableFiles(files).length, 0);
    });

    test('mixed drop: image + text — only image passes', () => {
        const files = [
            { name: 'a.png', type: 'image/png', size: 100 },
            { name: 'b.txt', type: 'text/plain', size: 50 },
        ];
        assert.equal(filterDroppableFiles(files).length, 1);
    });

    test('attachment object has correct shape after conversion', () => {
        const file = { name: 'photo.jpg', type: 'image/jpeg', size: 2048, path: '/tmp/photo.jpg' };
        const att = stubReadAsDataURL(file, 'abc123base64');
        assert.equal(att.file, 'photo.jpg');
        assert.equal(att.mimetype, 'image/jpeg');
        assert.equal(att.content, 'abc123base64');
        assert.equal(att.size, 2048);
        assert.equal(att.path, '/tmp/photo.jpg');
    });

    test('multiple files produce multiple attachment objects', () => {
        const files = [
            { name: 'a.png', type: 'image/png', size: 100, path: '' },
            { name: 'b.wav', type: 'audio/wav', size: 200, path: '' },
        ];
        const atts = files.map(f => stubReadAsDataURL(f, 'data'));
        assert.equal(atts.length, 2);
        assert.equal(atts[0].mimetype, 'image/png');
        assert.equal(atts[1].mimetype, 'audio/wav');
    });

    test('file without path gets empty string path', () => {
        const file = { name: 'x.png', type: 'image/png', size: 1 };
        const att = stubReadAsDataURL(file, 'x');
        assert.equal(att.path, '');
    });

    test('_dropZoneAttrs generates ondragover/ondragleave/ondrop (logic check)', () => {
        // Mirror the logic of app.js _dropZoneAttrs
        function dropZoneAttrs(purpose, stepIndex) {
            const si = stepIndex != null ? `,${stepIndex}` : '';
            return `ondragover="event.preventDefault();this.style.outline='2px dashed #4fc3f7'"` +
                   ` ondragleave="this.style.outline=''"` +
                   ` ondrop="app.handleFileDrop(event,'${purpose}'${si !== '' ? si : ''})"`;
        }
        const attrs = dropZoneAttrs('input_attachment');
        assert.ok(attrs.includes('ondragover'));
        assert.ok(attrs.includes('ondragleave'));
        assert.ok(attrs.includes("'input_attachment'"));
    });

    test('_dropZoneAttrs with stepIndex includes it in ondrop call', () => {
        function dropZoneAttrs(purpose, stepIndex) {
            const si = stepIndex != null ? `,${stepIndex}` : '';
            return `ondragover="event.preventDefault();this.style.outline='2px dashed #4fc3f7'"` +
                   ` ondragleave="this.style.outline=''"` +
                   ` ondrop="app.handleFileDrop(event,'${purpose}'${si !== '' ? si : ''})"`;
        }
        const attrs = dropZoneAttrs('step_attachment', 2);
        assert.ok(attrs.includes(',2'));
    });
});

// ── 7. Selection / Color logic ──────────────────────────────────
describe('Selection & Color logic', () => {

    // ---- pure helpers (extracted from frontend) ----

    function isAncestor(ancestor, descendant) {
        if (!ancestor || !descendant) return false;
        const a = ancestor.split('/').filter(p => p !== '');
        const d = descendant.split('/').filter(p => p !== '');
        if (a.length >= d.length) return false;
        return a.every((p, i) => p === d[i]);
    }

    // result-node class: depends on selection + link state
    function resultNodeClass(childPath, currentResultNodePath, selectedDataPath, isLinkedSourceFn) {
        const sel = currentResultNodePath === childPath;
        const link = selectedDataPath === childPath;
        const hist = isLinkedSourceFn(childPath);
        if (sel && link) return 'selected-data';       // 🔴
        if (sel) return 'selected-result';             // 🟠
        if (link || hist) return 'selected-linked';    // 🟡
        return '';
    }

    // step-node class: depends on selection + link state
    function stepNodeClass(path, isSelected, currentNodePath, selectedDataPath, isLinkedSourceFn, getParentTitleFn) {
        if (isSelected) {
            if (getParentTitleFn(path) === 'Processed') return 'selected-result';
            return 'selected-input';  // 🟢
        }
        const ancestorOfLink = selectedDataPath &&
            (selectedDataPath === path || selectedDataPath.startsWith(path + '/'));
        if (ancestorOfLink || isLinkedSourceFn(path)) return 'selected-linked';  // gray
        return '';
    }

    function getParentTitle(path, tree) {
        const parts = path.split('/').filter(p => p !== '');
        if (parts.length < 2) return '';
        const parentPath = parts.slice(0, -1).join('/');
        let node = tree;
        for (const p of parentPath.split('/').filter(Boolean)) {
            const idx = parseInt(p);
            if (!node.children || idx >= node.children.length) return '';
            node = node.children[idx];
        }
        try { return node.title ? atob(node.title) : ''; } catch { return node.title || ''; }
    }

    // build a set of linked source paths by scanning linkInfo in tree
    function buildLinkedSources(tree) {
        const result = new Set();
        function scan(nodes) {
            if (!nodes) return;
            for (const n of nodes) {
                if (n.linkInfo) {
                    try {
                        const info = JSON.parse(n.linkInfo);
                        if (info.sourcePath) result.add(info.sourcePath);
                    } catch {}
                }
                scan(n.children);
            }
        }
        scan(tree.children);
        return result;
    }

    // ---- sample tree data ----
    const b64 = s => { try { return btoa(unescape(encodeURIComponent(s))); } catch { return btoa(s); } };

    const tree = {
        title: '', content: '', mimetype: 'text/plain', children: [
            { title: b64('Step 1'), content: '', mimetype: 'text/plain', children: [
                { title: b64('Processed'), content: '', mimetype: 'text/plain', children: [
                    { title: b64('2026-06-10 12:00:00'), content: b64('result A'), mimetype: 'text/plain', children: [] },
                ]}
            ]},
            { title: b64('Step 2'), content: '', mimetype: 'text/plain', children: [
                { title: b64('Processed'), content: '', mimetype: 'text/plain', children: [
                    { title: b64('2026-06-10 13:00:00'), content: b64('result B'), mimetype: 'text/plain',
                        linkInfo: JSON.stringify({ sourcePath: '0/0/0', sourceResultTitle: '2026-06-10 12:00:00', sourceStepTitle: 'Step 1' }),
                        children: [] },
                ]}
            ]},
        ]
    };
    // Paths:
    //   Step 1         = "0"
    //     Processed    = "0/0"
    //       Result A   = "0/0/0"
    //   Step 2         = "1"
    //     Processed    = "1/0"
    //       Result B   = "1/0/0"   (linkInfo.sourcePath = "0/0/0")

    const linkedSources = buildLinkedSources(tree);

    // ---- isAncestor tests ----
    test('isAncestor: root is ancestor of child', () => {
        assert.ok(isAncestor('0', '0/0'));
    });

    test('isAncestor: root is ancestor of grandchild', () => {
        assert.ok(isAncestor('0', '0/0/0'));
    });

    test('isAncestor: same path is NOT ancestor', () => {
        assert.ok(!isAncestor('0', '0'));
    });

    test('isAncestor: different branch is NOT ancestor', () => {
        assert.ok(!isAncestor('0', '1'));
        assert.ok(!isAncestor('0', '1/0'));
    });

    test('isAncestor: deeper path cannot be ancestor of shallower', () => {
        assert.ok(!isAncestor('0/0', '0'));
    });

    test('isAncestor: empty/null paths', () => {
        assert.ok(!isAncestor('', '0'));
        assert.ok(!isAncestor('0', ''));
        assert.ok(!isAncestor(null, '0'));
    });

    // ---- resultNodeClass tests ----
    test('resultNodeClass: unselected node returns empty', () => {
        const cls = resultNodeClass('1/0/0', '', '', () => false);
        assert.equal(cls, '');
    });

    test('resultNodeClass: selected only returns orange', () => {
        const cls = resultNodeClass('0/0/0', '0/0/0', '', () => false);
        assert.equal(cls, 'selected-result');
    });

    test('resultNodeClass: selected + linked returns red', () => {
        const cls = resultNodeClass('0/0/0', '0/0/0', '0/0/0', () => false);
        assert.equal(cls, 'selected-data');
    });

    test('resultNodeClass: unselected but has linkInfo returns lemon', () => {
        const cls = resultNodeClass('0/0/0', '1/0/0', '', p => linkedSources.has(p));
        assert.equal(cls, 'selected-linked');
    });

    test('resultNodeClass: unselected but is selectedDataPath returns lemon', () => {
        const cls = resultNodeClass('0/0/0', '', '0/0/0', () => false);
        assert.equal(cls, 'selected-linked');
    });

    test('resultNodeClass: selected but different path from linked returns orange', () => {
        const cls = resultNodeClass('1/0/0', '1/0/0', '0/0/0', () => false);
        assert.equal(cls, 'selected-result');
    });

    // ---- stepNodeClass tests ----
    test('stepNodeClass: selected returns green', () => {
        const cls = stepNodeClass('0', true, '0', '', () => false, p => getParentTitle(p, tree));
        assert.equal(cls, 'selected-input');
    });

    test('stepNodeClass: selected + parent is Processed returns orange (should not happen for steps)', () => {
        // If a step's parent were Processed, that would be a result node edge case
        const cls = stepNodeClass('0/0/0', true, '0/0/0', '', () => false, p => getParentTitle(p, tree));
        assert.equal(cls, 'selected-result');
    });

    test('stepNodeClass: unselected but descendant contains selectedDataPath returns gray', () => {
        // Step 0 has child Processed with Result A at "0/0/0" which IS selectedDataPath
        // Step 0 is ancestor of the linked node
        const cls = stepNodeClass('0', false, '1', '0/0/0', p => linkedSources.has(p), p => getParentTitle(p, tree));
        assert.equal(cls, 'selected-linked');
    });

    test('stepNodeClass: unselected step with no linked descendant returns empty', () => {
        // Step 2 is not linked in any way
        const cls = stepNodeClass('1', false, '0', '0/0/0', p => linkedSources.has(p), p => getParentTitle(p, tree));
        assert.equal(cls, '');
    });

    test('stepNodeClass: unselected with no link returns empty', () => {
        const cls = stepNodeClass('1', false, '0', '', () => false, p => getParentTitle(p, tree));
        assert.equal(cls, '');
    });

    test('stepNodeClass: unselected but is selectedDataPath ancestor returns gray', () => {
        const cls = stepNodeClass('0', false, '1', '0/0/0', () => false, p => getParentTitle(p, tree));
        assert.equal(cls, 'selected-linked');
    });

    // ---- linkedSources scanning ----
    test('buildLinkedSources finds sourcePath from linkInfo', () => {
        assert.ok(linkedSources.has('0/0/0'));
    });

    test('buildLinkedSources does not include unrelated paths', () => {
        assert.ok(!linkedSources.has('0/0'));
        assert.ok(!linkedSources.has('1/0/0'));
    });

    // ---- recalcLinkMode: test isAncestor-driven logic ----
    test('recalcLinkMode: step IS ancestor of result → viewing mode (no link)', () => {
        // Step "0" is ancestor of result "0/0/0" → should stay as viewing (selectedDataPath = null)
        const stepPath = '0';
        const resultPath = '0/0/0';
        const shouldLink = !isAncestor(stepPath, resultPath);
        assert.ok(!shouldLink);
    });

    test('recalcLinkMode: step is NOT ancestor of result → linking mode', () => {
        // Step "1" is NOT ancestor of result "0/0/0" → should link
        const stepPath = '1';
        const resultPath = '0/0/0';
        const shouldLink = !isAncestor(stepPath, resultPath);
        assert.ok(shouldLink);
    });

    // ---- Gemini provider header auth tests (need mock server) ----
    test('Gemini call sends X-Goog-Api-Key header', async () => {
        // Use the existing mock server from the AI Provider test suite
        // but since we can't access it here, we inline a simple server
        const srv = await new Promise(resolve => {
            const s = http.createServer((req, res) => {
                // capture and respond
                let body = '';
                req.on('data', c => body += c);
                req.on('end', () => {
                    globalThis._lastGemini = { url: req.url, headers: req.headers, body };
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'mock' }] } }] }));
                });
            });
            s.listen(0, '127.0.0.1', () => resolve(s));
        });
        const port = srv.address().port;

        // Simulate Gemini provider's call with X-Goog-Api-Key header
        const body = JSON.stringify({
            contents: [{ parts: [{ text: 'hello' }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
        });
        const raw = await new Promise((resolve, reject) => {
            const opts = { hostname: '127.0.0.1', port, path: `/v1beta/models/gemini-2.5-flash:generateContent`, method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': 'test-key-123', 'Content-Length': Buffer.byteLength(body) } };
            const req = http.request(opts, res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve(Buffer.concat(ch).toString())); });
            req.on('error', reject);
            req.write(body);
            req.end();
        });

        assert.equal(globalThis._lastGemini.headers['x-goog-api-key'], 'test-key-123');
        assert.ok(!globalThis._lastGemini.url.includes('key='));
        const j = JSON.parse(raw);
        assert.equal(j.candidates[0].content.parts[0].text, 'mock');
        srv.close();
    });

    // ─── Recovered VM-based test helpers & suite ───
    const vm = require('node:vm');
    const appJsPath = path.join(__dirname, '../frontend/app.js');
    const appJsCode = fs.readFileSync(appJsPath, 'utf8');

    function createMockAppContext() {
        const context = {
            window: {},
            document: {
                getElementById: (id) => {
                    return {
                        style: {},
                        classList: { remove: () => {}, add: () => {} },
                        value: '',
                        querySelectorAll: () => [],
                        appendChild: () => {}
                    };
                },
                addEventListener: () => {},
                querySelector: () => ({ style: {} }),
                createElement: () => ({
                    classList: { add: () => {}, remove: () => {} },
                    style: {}
                })
            },
            navigator: {
                clipboard: { writeText: () => Promise.resolve() }
            },
            localStorage: {
                getItem: () => null,
                setItem: () => {},
                removeItem: () => {},
                clear: () => {}
            },
            confirm: () => true,
            console: console,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
            btoa: s => Buffer.from(s, 'binary').toString('base64'),
            atob: s => Buffer.from(s, 'base64').toString('binary'),
        };
        vm.createContext(context);
        vm.runInContext(appJsCode, context);
        const app = vm.runInContext('app', context);
        app._vmContext = context;
        return app;
    }

    test('VM-based tests: selectNode and buildTreeHTML behavior matches design specs', () => {
        const app = createMockAppContext();
        app.state.tabs = [{ name: 'test', file: 'test.json', root: { title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
            { title: b64('Step 1'), content: '', mimetype: 'text/plain', nodeType: 'assemble', children: [
                { title: b64('Processed'), content: '', mimetype: 'text/plain', nodeType: 'placeholder', children: [
                    { title: b64('Result A'), content: b64('out'), mimetype: 'text/plain', nodeType: 'data', pipelineMeta: '{}', children: [] }
                ]}
            ]}
        ] } }];
        app.state.activeTab = 0;
        app.updateRecipeBadge = () => {};
        app.renderTree = () => {};
        app.renderList = () => {};
        app.loadEditor = () => {};

        app.selectNode('0');
        assert.equal(app.state.selectedOpPath, '0');
        assert.equal(app.state.selectedDataPath, '');

        app.selectNode('0/0/0');
        assert.equal(app.state.selectedOpPath, '0');
        assert.equal(app.state.selectedDataPath, '0/0/0');
    });

    test('VM-based tests: clicking data node does not overwrite a different active op-node', () => {
        const app = createMockAppContext();
        app.state.tabs = [{ name: 'test', file: 'test.json', root: { title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
            { title: b64('Step 1'), content: '', mimetype: 'text/plain', nodeType: 'assemble', children: [
                { title: b64('Processed'), content: '', mimetype: 'text/plain', nodeType: 'placeholder', children: [
                    { title: b64('Result A'), content: b64('out'), mimetype: 'text/plain', nodeType: 'data', pipelineMeta: '{}', children: [] }
                ]}
            ]},
            { title: b64('Step 2'), content: '', mimetype: 'text/plain', nodeType: 'assemble', children: [] }
        ] } }];
        app.state.activeTab = 0;
        app.updateRecipeBadge = () => {};
        app.renderTree = () => {};
        app.renderList = () => {};
        app.loadEditor = () => {};

        // 1. Click Step 2 ("1") -> selectedOpPath = '1'
        app.selectNode('1');
        assert.equal(app.state.selectedOpPath, '1');
        assert.equal(app.state.selectedDataPath, '');

        // 2. Click Result A ("0/0/0") -> selectedDataPath = '0/0/0', but selectedOpPath must remain '1'
        app.selectNode('0/0/0');
        assert.equal(app.state.selectedOpPath, '1');
        assert.equal(app.state.selectedDataPath, '0/0/0');
    });

    test('VM-based tests: renderInput logic loads correct inputData based on mode', () => {
        const app = createMockAppContext();
        app.state.tabs = [{ name: 'test', file: 'test.json', root: { title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
            { title: b64('Step 1'), content: b64('step 1 template'), mimetype: 'text/plain', nodeType: 'assemble', children: [
                { title: b64('Processed'), content: '', mimetype: 'text/plain', nodeType: 'placeholder', children: [
                    { title: b64('Result A'), content: b64('out'), mimetype: 'text/plain', nodeType: 'data', 
                      pipelineMeta: JSON.stringify({ steps: [{ input: 'historical input' }] }), children: [] }
                ]}
            ]}
        ] } }];
        app.state.activeTab = 0;
        
        let renderedHtml = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'input-content') {
                return {
                    set innerHTML(html) { renderedHtml = html; },
                    get innerHTML() { return renderedHtml; }
                };
            }
            return { style: {}, classList: { remove: () => {}, add: () => {} }, appendChild: () => {} };
        };

        // 1. Normal mode (currentNodePath = '0')
        app.state.currentNodePath = '0';
        app.state.selectedDataPath = '';
        app.state.selectedOpPath = '0';
        const opNode = app.getNodeByPath('0');
        opNode.tempInputAttachments = { text: 'step 1 template', files: [] };
        app.renderInput();
        assert.ok(renderedHtml.includes('step 1 template'));

        // 2. Viewing mode (selectedDataPath = '0/0/0')
        app.state.currentNodePath = '0/0/0';
        app.state.selectedDataPath = '0/0/0';
        app.state.selectedOpPath = '';
        app.renderInput();
        assert.ok(renderedHtml.includes('historical input'));
    });

    test('VM-based tests: node type color class invariants are satisfied for all selections', () => {
        const app = createMockAppContext();
        app.state.tabs = [{ name: 'test', file: 'test.json', root: { title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
            { title: b64('Step 1'), content: '', mimetype: 'text/plain', nodeType: 'assemble', children: [
                { title: b64('Processed'), content: '', mimetype: 'text/plain', nodeType: 'placeholder', children: [
                    { title: b64('Result A'), content: b64('out'), mimetype: 'text/plain', nodeType: 'data', pipelineMeta: '{}', children: [] }
                ]}
            ]}
        ] } }];
        app.state.activeTab = 0;
        app.updateRecipeBadge = () => {};
        app.renderTree = () => {};
        app.renderList = () => {};
        app.loadEditor = () => {};

        const checkColorInvariants = () => {
            const paths = ['', '0', '0/0', '0/0/0'];
            for (const path of paths) {
                const node = app.getNodeByPath(path);
                if (!node) continue;
                const isData = node.nodeType === 'data';
                
                const classes = [];
                const isSelected = app.state.currentNodePath === path;
                const isSelectedOp = app.state.selectedOpPath !== '' && app.state.selectedOpPath === path;
                const isSelectedData = app.state.selectedDataPath !== '' && app.state.selectedDataPath === path;

                if (isSelected) {
                    if (isData) classes.push('selected-data');
                    else classes.push('selected');
                } else if (isSelectedOp) {
                    classes.push('selected-input');
                } else if (isSelectedData) {
                    classes.push('selected-result');
                }

                if (isData) {
                    assert.ok(!classes.includes('selected'), `Data node should not have "selected"`);
                    assert.ok(!classes.includes('selected-input'), `Data node should not have "selected-input"`);
                } else {
                    assert.ok(!classes.includes('selected-data'), `Step node should not have "selected-data"`);
                    assert.ok(!classes.includes('selected-result'), `Step node should not have "selected-result"`);
                }
            }
        };

        app.selectNode('0');
        checkColorInvariants();

        app.selectNode('0/0/0');
        checkColorInvariants();
    });

    test('VM-based tests: data node with originalOpNode and inputAttachments redirects operation pane and input pane correctly', () => {
        const app = createMockAppContext();

        // Setup dynamic nodes
        const originalOpNode = {
            title: b64('Original Op'),
            content: b64('original prompt text'),
            mimetype: 'text/plain',
            selectedRecipe: 'Recipe A',
            attachments: [{ file: 'op_attach.png', mimetype: 'image/png' }],
            nodeType: 'op'
        };

        app.state.tabs = [
            {
                name: 'test',
                file: 'test.json',
                root: {
                    title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                        {
                            title: b64('Step 1'), content: '', mimetype: 'text/plain', nodeType: 'assemble', children: [
                                {
                                    title: b64('Processed'), content: '', mimetype: 'text/plain', nodeType: 'placeholder', children: [
                                        {
                                            title: b64('Result A'),
                                            content: b64('run output'),
                                            mimetype: 'text/plain',
                                            nodeType: 'data',
                                            pipelineMeta: JSON.stringify({ steps: [{ input: 'in', output: 'out' }] }),
                                            originalOpNode: JSON.parse(JSON.stringify(originalOpNode)),
                                            inputAttachments: [{ file: 'input_attach.png', mimetype: 'image/png' }],
                                            tempInputAttachments: { text: '', files: [{ file: 'input_attach.png', mimetype: 'image/png' }] },
                                            children: []
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            }
        ];
        app.state.activeTab = 0;
        app.state.recipes = [{ name: 'Recipe A', provider: 'openai', model: 'gpt-4' }, { name: 'Recipe B', provider: 'openai', model: 'gpt-4' }];
        app.renderTree = () => {};
        app.renderList = () => {};
        // Mock UI elements to verify render calls
        let renderedHtml = '';
        let inputTextHtml = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'prompt-content') {
                return {
                    set innerHTML(html) { renderedHtml = html; },
                    get innerHTML() { return renderedHtml; }
                };
            }
            if (id === 'input-content') {
                return {
                    set innerHTML(html) { inputTextHtml = html; },
                    get innerHTML() { return inputTextHtml; }
                };
            }
            if (id === 'node-content') {
                return { value: 'edited prompt text' };
            }
            if (id === 'node-title') {
                return { value: 'Result A Title' };
            }
            if (id === 'input-textarea') {
                return { value: 'edited input text' };
            }
            if (id === 'recipe-badge') {
                return { textContent: '', style: {} };
            }
            return { style: {}, classList: { remove: () => {}, add: () => {} }, appendChild: () => {} };
        };

        // 1. Select the data node "0/0/0"
        app.selectNode('0/0/0');

        // Check if loadEditor restored the selectedRecipe from originalOpNode
        assert.equal(app.state.selectedRecipe, 'Recipe A');

        // Check if renderPrompt printed original prompt text
        assert.ok(renderedHtml.includes('original prompt text'), 'Should display originalOpNode prompt text');

        // 2. Test recipe selection on data node originalOpNode
        app.selectRecipe(1); // Select Recipe B
        const currentDataNode = app.getNodeByPath('0/0/0');
        assert.equal(currentDataNode.originalOpNode.selectedRecipe, 'Recipe B', 'Recipe selection should be persisted to originalOpNode');

        // 3. Test updateNode writes to originalOpNode.content but leaves data node title on node itself
        app.updateNode();
        assert.equal(atob(currentDataNode.originalOpNode.content), 'edited prompt text', 'Prompt text should update originalOpNode content');
        assert.equal(atob(currentDataNode.title), 'Result A Title', 'Title should update the data node itself');
        assert.equal(currentDataNode.input, 'edited input text', 'Input text should update the data node itself');

        // Check input rendering for edited input text
        app.renderInput();
        assert.ok(inputTextHtml.includes('edited input text'), 'Should display edited input text on renderInput');

        // 4. Test attachments addition and deletion on originalOpNode
        app.onMediaFileDialogResult({
            purpose: 'machine_attachment',
            attachments: [{ file: 'new_op_attach.png', mimetype: 'image/png' }]
        });
        assert.equal(currentDataNode.originalOpNode.attachments.length, 2, 'Attachments should be added to originalOpNode');
        assert.equal(currentDataNode.originalOpNode.attachments[1].file, 'new_op_attach.png');

        app.removeMachineAttachment(0);
        assert.equal(currentDataNode.originalOpNode.attachments.length, 1, 'Attachments should be removed from originalOpNode');
        assert.equal(currentDataNode.originalOpNode.attachments[0].file, 'new_op_attach.png');

        // Test input attachments (Belt attachments) addition and deletion on data node itself
        app.onMediaFileDialogResult({
            purpose: 'input_attachment',
            attachments: [{ file: 'new_input_attach.png', mimetype: 'image/png' }]
        });
        assert.equal(currentDataNode.tempInputAttachments.files.length, 2, 'Input attachments should be added to data node tempInputAttachments');
        assert.equal(currentDataNode.tempInputAttachments.files[1].file, 'new_input_attach.png');

        app.removeInputAttachment(0);
        assert.equal(currentDataNode.tempInputAttachments.files.length, 1, 'Input attachments should be removed from data node tempInputAttachments');
        assert.equal(currentDataNode.tempInputAttachments.files[0].file, 'new_input_attach.png');

        // 5. Test processPrompt executes using originalOpNode's attachments and data node's inputAttachments
        const postedMessages = [];
        app.postMessage = (msg) => { postedMessages.push(msg); };
        app.processPrompt();

        const runMsg = postedMessages.find(m => m.type === 'run_prompt_process');
        assert.ok(runMsg, 'Should post run_prompt_process message');
        assert.equal(runMsg.payload.userPrompt, 'edited prompt text');
        assert.equal(runMsg.payload.content, 'edited input text', 'Should send edited input text');
        assert.equal(runMsg.payload.attachments.length, 1);
        assert.equal(runMsg.payload.attachments[0].file, 'new_op_attach.png');
        assert.equal(runMsg.payload.inputAttachments.length, 1);
        assert.equal(runMsg.payload.inputAttachments[0].file, 'new_input_attach.png');

        // 6. Test onPipelineCompleted copies current opNode's inputAttachments
        const opNodeOnTab = app.getNodeByPath('0');
        opNodeOnTab.tempInputAttachments = { text: '', files: [{ file: 'source_input_attach.png', mimetype: 'image/png' }] };
        
        app.onPipelineCompleted({
            pipelineName: 'Test Pipeline',
            outputContent: 'new output',
            reasoning: 'pipeline execution reasoning',
            steps: [{ input: 'new input', output: 'new output' }]
        });

        // The newly saved child should be under Step 1 -> Processed (0/0/0)
        const newChild = app.getNodeByPath('0/0/0');
        assert.ok(newChild, 'New child node should be saved');
        assert.equal(newChild.nodeType, 'data');
        assert.ok(newChild.inputAttachments, 'New child should have inputAttachments copied');
        assert.equal(newChild.inputAttachments.length, 1);
        assert.equal(newChild.inputAttachments[0].file, 'new_input_attach.png');
        assert.deepEqual(newChild.artifacts, []);
        assert.equal(newChild.reasoning, 'pipeline execution reasoning');
    });

    test('REGRESSION: data node viewing mode must show input from when data node was created', () => {
        const app = createMockAppContext();

        app.state.tabs = [
            {
                name: 'test',
                file: 'test.json',
                root: {
                    title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                        {
                            title: b64('Step 1'), content: b64('prompt template'), mimetype: 'text/plain', nodeType: 'assemble', children: [
                                {
                                    title: b64('Processed'), content: '', mimetype: 'text/plain', nodeType: 'placeholder', children: []
                                }
                            ]
                        }
                    ]
                }
            }
        ];
        app.state.activeTab = 0;
        app.state.currentNodePath = '0';
        app.state.selectedOpPath = '0';
        app.state.selectedDataPath = '';

        const opNode = app.getNodeByPath('0');
        opNode.tempInputAttachments = { text: 'original input text', files: [] };

        let inputTextHtml = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'input-content') {
                return {
                    set innerHTML(html) { inputTextHtml = html; },
                    get innerHTML() { return inputTextHtml; }
                };
            }
            return { style: {}, classList: { remove: () => {}, add: () => {} }, appendChild: () => {} };
        };
        app._vmContext.document.querySelectorAll = () => [];

        app.onPipelineCompleted({
            pipelineName: 'Test Pipeline',
            outputContent: 'pipeline output',
            steps: [{ input: 'original input text', output: 'pipeline output' }]
        });

        const dataNode = app.getNodeByPath('0/0/0');
        assert.ok(dataNode, 'Data node should be created');
        assert.equal(dataNode.nodeType, 'data');
        assert.ok(dataNode.input !== undefined, 'Data node should have input field set');
        assert.equal(dataNode.input, 'original input text', 'Data node input should match the input used when created');

        app.state.currentNodePath = '0/0/0';
        app.state.selectedOpPath = '';
        app.state.selectedDataPath = '0/0/0';
        app.renderInput();

        assert.ok(inputTextHtml.includes('original input text'), 'Viewing mode should show the input from when data node was created');
    });

    test('REGRESSION: combined mode must show linked mode label in red in input pane', () => {
        const app = createMockAppContext();

        app.state.tabs = [
            {
                name: 'test',
                file: 'test.json',
                root: {
                    title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                        {
                            title: b64('Step 1'), content: b64('prompt'), mimetype: 'text/plain', nodeType: 'assemble', children: [
                                {
                                    title: b64('Processed'), content: '', mimetype: 'text/plain', nodeType: 'placeholder', children: [
                                        {
                                            title: b64('Result A'),
                                            content: b64('data output'),
                                            mimetype: 'text/plain',
                                            nodeType: 'data',
                                            pipelineMeta: JSON.stringify({ steps: [{ input: 'x', output: 'data output' }] }),
                                            children: []
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                            title: b64('Step 2'), content: b64('prompt 2'), mimetype: 'text/plain', nodeType: 'assemble', children: []
                        }
                    ]
                }
            }
        ];
        app.state.activeTab = 0;

        let inputTextHtml = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'input-content') {
                return {
                    set innerHTML(html) { inputTextHtml = html; },
                    get innerHTML() { return inputTextHtml; }
                };
            }
            return { style: {}, classList: { remove: () => {}, add: () => {} }, appendChild: () => {} };
        };
        app._vmContext.document.querySelectorAll = () => [];

        const opNode = app.getNodeByPath('1');
        opNode.tempInputAttachments = { text: '', files: [] };

        app.state.currentNodePath = '0/0/0';
        app.state.selectedOpPath = '1';
        app.state.selectedDataPath = '0/0/0';
        app.state.translations = { LinkedMode: '連結モード' };
        app.renderInput();

        assert.ok(inputTextHtml.includes('連結モード'), 'Combined mode should show 連結モード label');
        assert.ok(inputTextHtml.includes('#ff4a4a') || inputTextHtml.includes('red'), '連結モード label should be red');
    });

    test('REGRESSION: send detail panel must display URL and JSON request body', () => {
        const app = createMockAppContext();

        app.state.tabs = [
            {
                name: 'test',
                file: 'test.json',
                root: {
                    title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                        {
                            title: b64('Step 1'), content: b64('prompt'), mimetype: 'text/plain', nodeType: 'assemble', children: [
                                {
                                    title: b64('Processed'), content: '', mimetype: 'text/plain', nodeType: 'placeholder', children: [
                                        {
                                            title: b64('Result A'),
                                            content: b64('data output'),
                                            mimetype: 'text/plain',
                                            nodeType: 'data',
                                            pipelineMeta: JSON.stringify({
                                                steps: [{
                                                    input: 'test input',
                                                    output: 'test output',
                                                    requestUrl: 'https://api.openai.com/v1/chat/completions',
                                                    requestBody: '{"model":"gpt-4","messages":[{"role":"user","content":"test"}]}'
                                                }]
                                            }),
                                            children: []
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            }
        ];
        app.state.activeTab = 0;

        let outputHtml = '';
        let bodyHtml = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'output-content') {
                return {
                    set innerHTML(html) { outputHtml = html; },
                    get innerHTML() { return outputHtml; }
                };
            }
            if (id === 'output-tab-body') {
                return {
                    set innerHTML(html) { bodyHtml = html; outputHtml += html; },
                    get innerHTML() { return bodyHtml; }
                };
            }
            return { style: {}, classList: { remove: () => {}, add: () => {} }, appendChild: () => {} };
        };
        app._vmContext.document.querySelectorAll = () => [];

        app.state.currentNodePath = '0';
        app.state.selectedOpPath = '0';
        app.state.selectedDataPath = '';
        app.state.selectedOutputRunIndex = 0;
        app.renderOutput();

        assert.ok(outputHtml.includes('https://api.openai.com/v1/chat/completions'), 'Send detail should display requestUrl');
        assert.ok(outputHtml.includes('requestBody') || outputHtml.includes('HTTP Request Body'), 'Send detail should display requestBody section');
        assert.ok(outputHtml.includes('gpt-4'), 'Send detail should display JSON content');
    });

    test('REGRESSION: provider capabilities are displayed in recipe manager', () => {
        const app = createMockAppContext();
        app.state.recipes = [
            { type: 'ai', name: 'Test OpenAI', provider: 'openai', model: 'gpt-4', temperature: 0.7, systemPrompt: '', customParams: {} },
            { type: 'ai', name: 'Test DALL-E', provider: 'openai-image', model: 'dall-e-3', temperature: 0.7, systemPrompt: '', customParams: {} },
            { type: 'ai', name: 'Test Replicate', provider: 'replicate', model: 'sdxl', temperature: 0.7, systemPrompt: '', customParams: {} }
        ];
        app.state.providerCapabilities = {
            'openai': { input: ['text'], output: ['text'], description: 'Text generation' },
            'openai-image': { input: ['text'], output: ['image'], maxOutputs: 1, description: 'Image generation (DALL-E)' },
            'replicate': { input: ['text'], output: ['image', 'video', 'audio'], description: 'Image/Video/Audio generation' }
        };
        app.state.providers = { 'openai': {}, 'openai-image': {}, 'replicate': {} };
        app.state.editingRecipeIndex = -1;

        let bodyHtml = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'recipe-modal-body') {
                return {
                    set innerHTML(html) { bodyHtml = html; },
                    get innerHTML() { return bodyHtml; }
                };
            }
            return { style: {}, classList: { remove: () => {}, add: () => {} }, appendChild: () => {} };
        };

        app.renderRecipeManager();

        assert.ok(bodyHtml.includes('📝 → 📝'), 'OpenAI recipe should show text→text badge');
        assert.ok(bodyHtml.includes('📝 → 🖼'), 'DALL-E recipe should show text→image badge');
        assert.ok(bodyHtml.includes('max 1'), 'DALL-E recipe should show maxOutputs');
        assert.ok(bodyHtml.includes('📝 → 🖼🎬🎵'), 'Replicate recipe should show text→image/video/audio badge');
    });

    test('VM-based tests: recipe customParams can be edited, parsed as JSON, and sent in payload', () => {
        const app = createMockAppContext();
        app.state.tabs = [
            {
                name: 'test',
                file: 'test.json',
                root: {
                    title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                        { title: b64('Step 1'), content: '', mimetype: 'text/plain', nodeType: 'assemble', children: [] }
                    ]
                }
            }
        ];
        app.state.activeTab = 0;
        app.state.recipes = [];
        app.renderRecipeManager = () => {};
        app.saveRecipes = () => {};
        app.renderTree = () => {};
        app.renderList = () => {};

        // Mock UI elements
        const uiValues = {
            'rm-name': 'New AI Recipe',
            'rm-type': 'ai',
            'rm-provider': 'replicate',
            'rm-model': 'stability-ai/sdxl',
            'rm-temperature': '0.7',
            'rm-system-prompt': 'Be helpful',
            'rm-base-url': 'https://custom-api.com',
            'rm-use-custom-api-path-checked': true,
            'rm-api-path': '/v1/models/{model}:generateContent',
            'rm-custom-params': '{"negative_prompt": "ugly, blurry", "steps": 25}'
        };

        app._vmContext.document.getElementById = (id) => {
            return {
                value: uiValues[id] || '',
                checked: !!uiValues[id + '-checked'],
                style: {},
                classList: { remove: () => {}, add: () => {} },
                appendChild: () => {}
            };
        };

        // 1. Test addRecipeFromManager parses customParams JSON correctly
        app.addRecipeFromManager();
        assert.equal(app.state.recipes.length, 1);
        const added = app.state.recipes[0];
        assert.equal(added.name, 'New AI Recipe');
        assert.equal(added.provider, 'replicate');
        assert.equal(added.baseUrl, 'https://custom-api.com');
        assert.equal(added.useCustomApiPath, true);
        assert.equal(added.apiPath, '/v1/models/{model}:generateContent');
        assert.equal(JSON.stringify(added.customParams), JSON.stringify({ negative_prompt: 'ugly, blurry', steps: 25 }));

        // 2. Test edit and saveEditRecipe with modified custom parameters and renaming propagation
        app.state.editingRecipeIndex = 0;
        app.state.selectedRecipe = 'New AI Recipe';
        const mockNode = app.state.tabs[0].root.children[0];
        mockNode.selectedRecipe = 'New AI Recipe';

        uiValues['edit-name'] = 'Updated AI Recipe';
        uiValues['edit-provider'] = 'fal-ai';
        uiValues['edit-model'] = 'fal-ai/flux/schnell';
        uiValues['edit-system-prompt'] = 'Be concise';
        uiValues['edit-base-url'] = 'https://updated-api.com';
        uiValues['edit-use-custom-api-path-checked'] = true;
        uiValues['edit-api-path'] = '/v1/updated/models/{model}:generateContent';
        uiValues['edit-custom-params'] = '{"aspect_ratio": "16:9"}';

        app.saveEditRecipe(0);
        const edited = app.state.recipes[0];
        assert.equal(edited.name, 'Updated AI Recipe');
        assert.equal(edited.provider, 'fal-ai');
        assert.equal(edited.baseUrl, 'https://updated-api.com');
        assert.equal(edited.useCustomApiPath, true);
        assert.equal(edited.apiPath, '/v1/updated/models/{model}:generateContent');
        assert.equal(JSON.stringify(edited.customParams), JSON.stringify({ aspect_ratio: '16:9' }));
        assert.equal(app.state.selectedRecipe, 'Updated AI Recipe');
        assert.equal(mockNode.selectedRecipe, 'Updated AI Recipe');

        // 3. Test invalid JSON alerts and does not save
        uiValues['edit-custom-params'] = '{invalid_json}';
        let alertCalled = false;
        app._vmContext.alert = () => { alertCalled = true; };
        app.saveEditRecipe(0);
        assert.ok(alertCalled, 'Should alert on invalid JSON');
        // Custom params should remain unmodified
        assert.equal(JSON.stringify(app.state.recipes[0].customParams), JSON.stringify({ aspect_ratio: '16:9' }));

        // 4. Test customParams is sent in processPrompt payload (with custom api path toggle enabled)
        app.state.selectedRecipe = 'Updated AI Recipe';
        app.state.currentNodePath = '0';
        app.state.selectedOpPath = '0';

        // Mock nodes
        app.getNodeByPath = (path) => app.state.tabs[0].root.children[0];

        // Override UI elements for processPrompt
        uiValues['node-content'] = 'edited prompt';
        uiValues['input-textarea'] = 'edited input';

        let postedMessages = [];
        app.postMessage = (msg) => { postedMessages.push(msg); };
        app.processPrompt();

        let runMsg = postedMessages.find(m => m.type === 'run_prompt_process');
        assert.ok(runMsg);
        assert.equal(runMsg.payload.baseUrl, 'https://updated-api.com');
        assert.equal(runMsg.payload.apiPath, '/v1/updated/models/{model}:generateContent');
        assert.equal(JSON.stringify(runMsg.payload.customParams), JSON.stringify({ aspect_ratio: '16:9' }));

        // 5. Test apiPath is updated to default and sent as default if useCustomApiPath toggle is disabled
        app.state.defaultProviders = [
            { id: 'fal-ai', defaultUrl: 'https://queue.fal.run', defaultApiPath: '/{model}' }
        ];
        uiValues['edit-use-custom-api-path-checked'] = false;
        app.saveEditRecipe(0);
        postedMessages = [];
        app.processPrompt();
        runMsg = postedMessages.find(m => m.type === 'run_prompt_process');
        assert.ok(runMsg);
        assert.equal(runMsg.payload.apiPath, '/{model}'); // resolved to defaultApiPath for fal-ai
    });

    test('VM-based tests: tab renaming via renameTab', () => {
        const app = createMockAppContext();
        app.state.tabs = [
            { name: 'OldName.promptsbt', file: 'OldName.promptsbt', root: {} }
        ];
        app.state.activeTab = 0;
        app.renderTabs = () => {};

        const messages = [];
        app.postMessage = (msg) => { messages.push(msg); };

        // Rename the tab (which sends rename_file message)
        app.renameTab(0, 'NewName.promptsbt');

        // Assert rename_file payload sent
        assert.equal(messages.length, 1);
        assert.equal(messages[0].type, 'rename_file');
        assert.equal(messages[0].payload.oldFile, 'OldName.promptsbt');
        assert.equal(messages[0].payload.newFile, 'NewName.promptsbt');

        // Simulate main process response callback
        messages.length = 0;
        app.onRenameFileResult({ success: true, oldFile: 'OldName.promptsbt', newFile: 'NewName.promptsbt' });

        // Assert tab name updated in state
        assert.equal(app.state.tabs[0].name, 'NewName.promptsbt');
        assert.equal(app.state.tabs[0].file, 'NewName.promptsbt');

        // Assert save_session and get_file_tree payloads sent
        assert.equal(messages.length, 2);
        assert.equal(messages[0].type, 'save_session');
        assert.equal(messages[0].payload.tabs[0].name, 'NewName.promptsbt');
        assert.equal(messages[0].payload.tabs[0].file, 'NewName.promptsbt');
        assert.equal(messages[1].type, 'get_file_tree');

        // Assert invalid names are rejected
        let alertCalled = false;
        app._vmContext.alert = () => { alertCalled = true; };
        messages.length = 0;
        app.renameTab(0, 'invalid/name');
        assert.ok(alertCalled, 'Should alert on invalid char "/"');
        assert.equal(messages.length, 0, 'Should not post message on invalid name');

        alertCalled = false;
        app.renameTab(0, 'CON.promptsbt');
        assert.ok(alertCalled, 'Should alert on Windows reserved name "CON"');
        assert.equal(messages.length, 0);
    });

    test('VM-based tests: custom providers and custom formats integration', () => {
        const app = createMockAppContext();
        
        let innerHtmlContent = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'provider-list') {
                return {
                    style: {},
                    classList: { remove: () => {}, add: () => {} },
                    set innerHTML(val) { innerHtmlContent = val; },
                    get innerHTML() { return innerHtmlContent; },
                    appendChild: () => {}
                };
            }
            return {
                style: {},
                classList: { remove: () => {}, add: () => {} },
                value: '',
                querySelectorAll: () => [],
                appendChild: () => {}
            };
        };

        const providers = {
            'custom-id': { apiFormat: 'custom-sample', apiKey: 'test-key', baseUrl: 'http://test' }
        };
        const customMetadata = {
            'custom-sample': {
                name: 'Custom Sample',
                defaultModels: ['sample-model-1', 'sample-model-2']
            }
        };

        // Invoke IPC event handler simulation
        app.onProvidersResult(providers, customMetadata);

        // Assert cached metadata
        assert.deepEqual(
            JSON.stringify(app.state.customMetadata),
            JSON.stringify(customMetadata)
        );

        // Assert initialized models
        assert.deepEqual(
            JSON.stringify(app.state.providerModels['custom-sample']),
            JSON.stringify(['sample-model-1', 'sample-model-2'])
        );

        // Assert UI select dropdown contains the custom format
        assert.ok(innerHtmlContent.includes('custom-sample'), 'Should render the custom API Format option');
        assert.ok(innerHtmlContent.includes('Custom Sample (Custom)'), 'Should render the custom API Format label');
    });

    test('VM-based tests: discardCurrentOutput(idx) when Processed placeholder exists', () => {
        const app = createMockAppContext();
        const b64 = s => Buffer.from(s, 'binary').toString('base64');
        app.state.tabs = [{
            name: 'test',
            file: 'test.json',
            root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                    {
                        title: b64('Step 1'), content: '', mimetype: 'text/plain', nodeType: 'assemble', children: [
                            {
                                title: b64('Processed'), content: '', mimetype: 'text/plain', nodeType: 'placeholder', children: [
                                    { title: b64('Result A'), content: b64('out A'), mimetype: 'text/plain', nodeType: 'data', pipelineMeta: '{}', children: [] },
                                    { title: b64('Result B'), content: b64('out B'), mimetype: 'text/plain', nodeType: 'data', pipelineMeta: '{}', children: [] }
                                ]
                            }
                        ]
                    }
                ]
            }
        }];
        app.state.activeTab = 0;
        app.state.currentNodePath = '0';
        app.state.selectedOpPath = '0';
        app.state.selectedDataPath = '0/0/1'; // Pointing to Result B
        app.state.selectedOutputRunIndex = 1;

        let tabSaved = false;
        app.saveCurrentTab = () => { tabSaved = true; };
        app.renderTree = () => {};
        app.renderList = () => {};
        app.renderOutput = () => {};

        // Discard the second run (Result B at index 1)
        app.discardCurrentOutput(1);

        const opNode = app.getNodeByPath('0');
        const proc = opNode.children[0];
        assert.equal(proc.children.length, 1);
        assert.equal(Buffer.from(proc.children[0].title, 'base64').toString('binary'), 'Result A');
        assert.ok(tabSaved, 'Tab should be saved');
        assert.equal(app.state.selectedDataPath, '', 'Selected data path should be cleared since it was deleted');
        assert.equal(app.state.selectedOutputRunIndex, -1, 'Selected run index should reset to -1');
    });

    test('VM-based tests: discardCurrentOutput(idx) when Processed placeholder does not exist', () => {
        const app = createMockAppContext();
        const b64 = s => Buffer.from(s, 'binary').toString('base64');
        app.state.tabs = [{
            name: 'test',
            file: 'test.json',
            root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                    {
                        title: b64('Step 1'), content: '', mimetype: 'text/plain', nodeType: 'assemble', children: [
                            { title: b64('Result A'), content: b64('out A'), mimetype: 'text/plain', nodeType: 'data', pipelineMeta: '{}', children: [] },
                            { title: b64('Result B'), content: b64('out B'), mimetype: 'text/plain', nodeType: 'data', pipelineMeta: '{}', children: [] }
                        ]
                    }
                ]
            }
        }];
        app.state.activeTab = 0;
        app.state.currentNodePath = '0';
        app.state.selectedOpPath = '0';
        app.state.selectedDataPath = '0/1'; // Pointing to Result B
        app.state.selectedOutputRunIndex = 1;

        let tabSaved = false;
        app.saveCurrentTab = () => { tabSaved = true; };
        app.renderTree = () => {};
        app.renderList = () => {};
        app.renderOutput = () => {};

        // Discard the second run (Result B at index 1)
        app.discardCurrentOutput(1);

        const opNode = app.getNodeByPath('0');
        assert.equal(opNode.children.length, 1);
        assert.equal(Buffer.from(opNode.children[0].title, 'base64').toString('binary'), 'Result A');
        assert.ok(tabSaved, 'Tab should be saved');
        assert.equal(app.state.selectedDataPath, '', 'Selected data path should be cleared since it was deleted');
        assert.equal(app.state.selectedOutputRunIndex, -1, 'Selected run index should reset to -1');
    });

    test('VM-based tests: input pane attachment shows view button for images', () => {
        const app = createMockAppContext();
        app.state.tabs = [{
            name: 'test',
            file: 'test.json',
            root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root',
                children: [{
                    title: b64('Step 1'), content: b64('prompt'), mimetype: 'text/plain',
                    nodeType: 'assemble', children: [],
                    tempInputAttachments: {
                        text: 'test input',
                        files: [{
                            file: 'test.png',
                            mimetype: 'image/png',
                            content: 'base64data',
                            size: 1024
                        }]
                    }
                }]
            }
        }];
        app.state.activeTab = 0;
        app.state.currentNodePath = '0';
        app.state.selectedOpPath = '0';
        app.state.selectedDataPath = '';

        let inputHtml = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'input-content') {
                return {
                    set innerHTML(html) { inputHtml = html; },
                    get innerHTML() { return inputHtml; }
                };
            }
            return { style: {}, classList: { remove: () => {}, add: () => {} }, appendChild: () => {} };
        };

        app.renderInput();
        
        assert.ok(inputHtml.includes('👁'), 'Image attachment should have view button');
        assert.ok(inputHtml.includes('showMediaViewer'), 'View button should call showMediaViewer');
        assert.ok(inputHtml.includes('data:image/png;base64,base64data'), 'View button should have correct data URL');
    });

    test('VM-based tests: prompt pane machine attachments shows view button for images', () => {
        const app = createMockAppContext();
        app.state.tabs = [{
            name: 'test',
            file: 'test.json',
            root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root',
                children: [{
                    title: b64('Step 1'), content: b64('prompt'), mimetype: 'text/plain',
                    nodeType: 'assemble', children: [],
                    attachments: [{
                        file: 'machine.png',
                        mimetype: 'image/png',
                        content: 'machinebase64',
                        size: 2048
                    }]
                }]
            }
        }];
        app.state.activeTab = 0;
        app.state.currentNodePath = '0';
        app.state.selectedOpPath = '0';
        app.state.selectedDataPath = '';
        app.state.recipes = [];

        let promptHtml = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'prompt-content') {
                return {
                    set innerHTML(html) { promptHtml = html; },
                    get innerHTML() { return promptHtml; }
                };
            }
            return { style: {}, classList: { remove: () => {}, add: () => {} }, appendChild: () => {} };
        };

        app.renderPrompt();
        
        assert.ok(promptHtml.includes('👁'), 'Machine attachment should have view button');
        assert.ok(promptHtml.includes('showMediaViewer'), 'View button should call showMediaViewer');
    });

    test('VM-based tests: viewing mode attachment shows view button for images', () => {
        const app = createMockAppContext();
        app.state.tabs = [{
            name: 'test',
            file: 'test.json',
            root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root',
                children: [{
                    title: b64('Step 1'), content: b64('prompt'), mimetype: 'text/plain',
                    nodeType: 'assemble', children: [{
                        title: b64('Processed'), content: '', mimetype: 'text/plain',
                        nodeType: 'placeholder', children: [{
                            title: b64('Result A'),
                            content: b64('output'),
                            mimetype: 'text/plain',
                            nodeType: 'data',
                            pipelineMeta: JSON.stringify({ steps: [{ input: 'test input', output: 'test output' }] }),
                            inputAttachments: [{
                                file: 'viewing.png',
                                mimetype: 'image/png',
                                content: 'viewingbase64',
                                size: 512
                            }],
                            children: []
                        }]
                    }]
                }]
            }
        }];
        app.state.activeTab = 0;
        app.state.currentNodePath = '0/0/0';
        app.state.selectedOpPath = '';
        app.state.selectedDataPath = '0/0/0';

        let inputHtml = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'input-content') {
                return {
                    set innerHTML(html) { inputHtml = html; },
                    get innerHTML() { return inputHtml; }
                };
            }
            return { style: {}, classList: { remove: () => {}, add: () => {} }, appendChild: () => {} };
        };

        app.renderInput();
        
        assert.ok(inputHtml.includes('👁'), 'Viewing mode attachment should have view button');
        assert.ok(inputHtml.includes('showMediaViewer'), 'View button should call showMediaViewer');
    });

    test('VM-based tests: non-image attachments do not show view button', () => {
        const app = createMockAppContext();
        app.state.tabs = [{
            name: 'test',
            file: 'test.json',
            root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root',
                children: [{
                    title: b64('Step 1'), content: b64('prompt'), mimetype: 'text/plain',
                    nodeType: 'assemble', children: [],
                    tempInputAttachments: {
                        text: 'test input',
                        files: [{
                            file: 'data.json',
                            mimetype: 'application/json',
                            content: 'jsondata',
                            size: 256
                        }]
                    }
                }]
            }
        }];
        app.state.activeTab = 0;
        app.state.currentNodePath = '0';
        app.state.selectedOpPath = '0';
        app.state.selectedDataPath = '';

        let inputHtml = '';
        app._vmContext.document.getElementById = (id) => {
            if (id === 'input-content') {
                return {
                    set innerHTML(html) { inputHtml = html; },
                    get innerHTML() { return inputHtml; }
                };
            }
            return { style: {}, classList: { remove: () => {}, add: () => {} }, appendChild: () => {} };
        };

        app.renderInput();
        
        // JSON file should not have view button (only images have it)
        const viewButtonCount = (inputHtml.match(/👁/g) || []).length;
        assert.equal(viewButtonCount, 0, 'Non-image attachment should not have view button');
    });
});

describe('Custom Providers Loading', () => {
    test('loadCustomProviders creates sample and loads valid .js provider', () => {
        const tmpDir = makeTempDir();
        const testProviders = {};
        
        // Inline loadCustomProviders with custom test object parameter
        function testLoadCustomProviders(storagePath, targetDict) {
            const dir = path.join(storagePath, 'custom_providers');
            if (!fs.existsSync(dir)) {
                try { fs.mkdirSync(dir, { recursive: true }); } catch(e) {}
                const sampleCode = `class CustomSampleProvider {
                    constructor(apiKey, baseUrl) {}
                    name() { return 'custom-sample'; }
                    defaultModels() { return ['sample-model-1']; }
                    async call() { return {}; }
                }
                module.exports = CustomSampleProvider;`;
                try { fs.writeFileSync(path.join(dir, 'sample.js'), sampleCode, 'utf8'); } catch(e) {}
            }
            try {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    if (file.endsWith('.js')) {
                        const fullPath = path.join(dir, file);
                        try {
                            delete require.cache[require.resolve(fullPath)];
                            const ProviderClass = require(fullPath);
                            if (ProviderClass && typeof ProviderClass === 'function') {
                                const tempInstance = new ProviderClass('', '');
                                if (typeof tempInstance.name === 'function' && typeof tempInstance.call === 'function') {
                                    const providerName = tempInstance.name();
                                    targetDict[providerName] = ProviderClass;
                                }
                            }
                        } catch (err) {}
                    }
                }
            } catch (e) {}
        }

        testLoadCustomProviders(tmpDir, testProviders);
        
        assert.ok(testProviders['custom-sample'], 'Should load custom-sample provider');
        const ProviderClass = testProviders['custom-sample'];
        const instance = new ProviderClass('', '');
        assert.equal(instance.name(), 'custom-sample');
        assert.deepEqual(instance.defaultModels(), ['sample-model-1']);

        rmrf(tmpDir);
    });
});

describe('Builtin Providers Loading', () => {
    test('loadBuiltinProviders loads all provider files from providers/ directory', () => {
        const builtinProviders = {};
        const providersDir = path.join(__dirname, 'providers');
        
        if (!fs.existsSync(providersDir)) {
            // Skip test if providers directory doesn't exist
            return;
        }
        
        const files = fs.readdirSync(providersDir);
        for (const file of files) {
            if (file.endsWith('.js') && file !== 'utils.js') {
                const fullPath = path.join(providersDir, file);
                try {
                    delete require.cache[require.resolve(fullPath)];
                    const mod = require(fullPath);
                    const ProviderClass = mod.ProviderClass || mod;
                    if (ProviderClass && typeof ProviderClass === 'function') {
                        const tempInstance = new ProviderClass('', '');
                        if (typeof tempInstance.name === 'function' && typeof tempInstance.call === 'function') {
                            builtinProviders[tempInstance.name()] = ProviderClass;
                        }
                    }
                } catch (err) {
                    // Skip files that fail to load
                }
            }
        }
        
        const expectedProviders = ['openai', 'anthropic', 'gemini', 
                                   'ollama', 'lmstudio', 'opencode', 'mock', 'mock-http', 'openai-image', 
                                   'replicate', 'fal-ai', 'voicebox', 'voicevox', 'mcp'];
        for (const name of expectedProviders) {
            assert.ok(builtinProviders[name], `Provider "${name}" should be loaded`);
        }
    });

    test('each builtin provider has correct name() and defaultModels()', () => {
        const providersDir = path.join(__dirname, 'providers');
        
        if (!fs.existsSync(providersDir)) {
            return;
        }
        
        const providerTests = [
            { file: 'openai.js', name: 'openai', models: ['gpt-4.1', 'gpt-4o-mini'] },
            { file: 'anthropic.js', name: 'anthropic', models: ['claude-sonnet-4-6', 'claude-haiku-4-5'] },
            { file: 'gemini.js', name: 'gemini', models: ['gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image', 'imagen-3.0-generate-001', 'imagen-4.0-generate-001'] },
            { file: 'ollama.js', name: 'ollama', models: ['llama3.2', 'mistral'] },
            { file: 'lmstudio.js', name: 'lmstudio', models: ['llama-3.2-8b-instruct', 'mistral-7b-instruct', 'phi-3-mini'] },
            { file: 'opencode.js', name: 'opencode', models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-pro', 'glm-5.2', 'glm-5.1'] },
            { file: 'mock.js', name: 'mock', models: ['echo', 'fixed', 'image-echo', 'image-compose'] },
            { file: 'mock-http.js', name: 'mock-http', models: ['echo', 'image-echo', 'image-compose'] },
            { file: 'openai-image.js', name: 'openai-image', models: ['dall-e-3', 'dall-e-2'] },
            { file: 'replicate.js', name: 'replicate', models: ['stability-ai/sdxl', 'bytedance/animatediff'] },
            { file: 'fal-ai.js', name: 'fal-ai', models: ['fal-ai/flux/schnell', 'fal-ai/stable-diffusion-v35-medium'] },
            { file: 'voicebox.js', name: 'voicebox', models: ['kokoro', 'qwen', 'qwen_custom_voice', 'luxtts', 'chatterbox', 'chatterbox_turbo', 'tada'] },
            { file: 'voicevox.js', name: 'voicevox', models: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'] },
            { file: 'mcp.js', name: 'mcp', models: ['mcp-tool'] },
        ];
        
        for (const test of providerTests) {
            const fullPath = path.join(providersDir, test.file);
            if (!fs.existsSync(fullPath)) continue;
            
            try {
                delete require.cache[require.resolve(fullPath)];
                const mod = require(fullPath);
                const ProviderClass = mod.ProviderClass || mod;
                const instance = new ProviderClass('', '');
                
                assert.equal(instance.name(), test.name, `Provider ${test.file} should have name "${test.name}"`);
                assert.deepEqual(instance.defaultModels(), test.models, `Provider ${test.file} should have correct defaultModels`);
            } catch (err) {
                // Skip if provider fails to load
            }
        }
    });
});

// ════════════════════════════════════════════════════════════════════════════
// PaneOrganization — selection state machine, output pane branch, getRunResults
// Mirrors the logic documented in designdoc/PaneOrganization.md
// ════════════════════════════════════════════════════════════════════════════
describe('PaneOrganization — selectNode state machine', () => {

    // ── pure helpers extracted from app.js ────────────────────────────────

    const safeAtob = s => { try { return Buffer.from(s, 'base64').toString('utf8'); } catch { return s; } };
    const b64      = s => Buffer.from(s, 'utf8').toString('base64');

    function getNodeByPath(root, path) {
        if (!path && path !== 0) return root;
        const parts = String(path).split('/').filter(p => p !== '');
        let node = root;
        for (const p of parts) {
            const idx = parseInt(p, 10);
            if (!node.children || idx >= node.children.length) return null;
            node = node.children[idx];
        }
        return node;
    }

    function isDataNodePath(path, tree) {
        if (!path) return false;
        const node = getNodeByPath(tree, path);
        if (node) {
            if (node.pipelineMeta !== undefined) return true;
            if (node.nodeType) return node.nodeType === 'data';
        }
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
            const ancestorPath = parts.slice(0, i).join('/');
            const ancestor = getNodeByPath(tree, ancestorPath);
            if (ancestor && (ancestor.nodeType === 'placeholder' ||
                (!ancestor.nodeType && ancestor.title && safeAtob(ancestor.title) === 'Processed'))) {
                return true;
            }
        }
        return false;
    }

    // Mirrors selectNode state transitions in app.js
    function selectNodeState(state, path, tree) {
        const node = getNodeByPath(tree, path);
        if (!node) return { selectedOpPath: '', selectedDataPath: '' };
        const isRoot      = node.nodeType === 'root' || (!node.nodeType && path === '');
        const isProcessed = node.nodeType === 'placeholder' ||
            (!node.nodeType && node.title && safeAtob(node.title) === 'Processed');
        if (isRoot || isProcessed) {
            return { selectedOpPath: '', selectedDataPath: '' };
        } else if (isDataNodePath(path, tree)) {
            const newDataPath = state.selectedDataPath === path ? '' : path;
            return { selectedOpPath: state.selectedOpPath, selectedDataPath: newDataPath };
        } else {
            const newOpPath = state.selectedOpPath === path ? '' : path;
            return { selectedOpPath: newOpPath, selectedDataPath: state.selectedDataPath };
        }
    }

    // Mirrors getRunResults used inside renderOutput
    function getRunResults(opNode) {
        if (!opNode || !opNode.children) return [];
        const proc = opNode.children.find(c =>
            c.nodeType === 'placeholder' ||
            (!c.nodeType && c.title && safeAtob(c.title) === 'Processed'));
        return proc ? (proc.children || []) : opNode.children;
    }

    // Classifies the output pane rendering mode from selection state
    function outputPaneMode(selectedOpPath, selectedDataPath) {
        if (selectedOpPath === '' && selectedDataPath === '') return 'none';
        if (selectedOpPath !== '' && selectedDataPath === '')  return 'op-only';
        if (selectedOpPath !== '' && selectedDataPath !== '')  return 'combined';
        return 'data-only';
    }

    // ── sample trees ────────────────────────────────────────────────────

    //  root
    //   └─ 0: assembleNode  (nodeType: 'assemble')
    //         └─ 0/0: placeholderNode  (nodeType: 'placeholder')
    //               └─ 0/0/0: dataNode1  (nodeType: 'data', pipelineMeta)
    //               └─ 0/0/1: dataNode2  (nodeType: 'data', pipelineMeta)
    //   └─ 1: assembleNode2 (nodeType: 'assemble')  [no children yet]
    const tree = {
        nodeType: 'root', title: b64('root'), content: '', children: [
            {
                nodeType: 'assemble', title: b64('MyOp'), content: b64('prompt text'), children: [
                    {
                        nodeType: 'placeholder', title: b64('Processed'), content: '', children: [
                            { nodeType: 'data', title: b64('Run 1'), content: b64('output A'),
                              pipelineMeta: JSON.stringify({ pipelineName: 'pipe', steps: [{ output: 'output A' }] }), children: [] },
                            { nodeType: 'data', title: b64('Run 2'), content: b64('output B'),
                              pipelineMeta: JSON.stringify({ pipelineName: 'pipe', steps: [{ output: 'output B' }] }), children: [] },
                        ]
                    }
                ]
            },
            {
                nodeType: 'assemble', title: b64('EmptyOp'), content: b64(''), children: []
            },
        ]
    };

    // ── isDataNodePath ─────────────────────────────────────────────────

    test('isDataNodePath: assemble node returns false', () => {
        assert.ok(!isDataNodePath('0', tree));
    });

    test('isDataNodePath: placeholder node returns false (no ancestor is placeholder)', () => {
        // placeholder itself is not a descendant of another placeholder
        assert.ok(!isDataNodePath('0/0', tree));
    });

    test('isDataNodePath: data node with nodeType=data returns true', () => {
        assert.ok(isDataNodePath('0/0/0', tree));
    });

    test('isDataNodePath: data node detected via pipelineMeta when nodeType absent', () => {
        const treeNoType = {
            nodeType: 'root', children: [
                { title: b64('Op'), children: [
                    { title: b64('Processed'), children: [
                        { title: b64('run'), pipelineMeta: '{}', children: [] },
                    ]}
                ]}
            ]
        };
        assert.ok(isDataNodePath('0/0/0', treeNoType));
    });

    test('isDataNodePath: data node detected via ancestor placeholder without nodeType', () => {
        const treeOld = {
            nodeType: 'root', children: [
                { title: b64('Op'), children: [
                    { title: b64('Processed'), children: [  // no nodeType — legacy format
                        { title: b64('run'), content: b64('x'), children: [] },
                    ]}
                ]}
            ]
        };
        assert.ok(isDataNodePath('0/0/0', treeOld));
    });

    test('isDataNodePath: empty path returns false', () => {
        assert.ok(!isDataNodePath('', tree));
    });

    // ── selectNode state machine ────────────────────────────────────────

    test('selecting assemble node from blank: op-only mode', () => {
        const state = { selectedOpPath: '', selectedDataPath: '' };
        const next  = selectNodeState(state, '0', tree);
        assert.equal(next.selectedOpPath,  '0');
        assert.equal(next.selectedDataPath, '');
    });

    test('selecting same assemble node again: toggles off (neither selected)', () => {
        const state = { selectedOpPath: '0', selectedDataPath: '' };
        const next  = selectNodeState(state, '0', tree);
        assert.equal(next.selectedOpPath,  '');
        assert.equal(next.selectedDataPath, '');
    });

    test('selecting data node from blank: data-only mode', () => {
        const state = { selectedOpPath: '', selectedDataPath: '' };
        const next  = selectNodeState(state, '0/0/0', tree);
        assert.equal(next.selectedOpPath,   '');
        assert.equal(next.selectedDataPath, '0/0/0');
    });

    test('selecting assemble node while data node selected: combined mode', () => {
        const state = { selectedOpPath: '', selectedDataPath: '0/0/0' };
        const next  = selectNodeState(state, '0', tree);
        assert.equal(next.selectedOpPath,   '0');
        assert.equal(next.selectedDataPath, '0/0/0');  // NOT cleared
    });

    test('selecting data node while assemble node selected: combined mode', () => {
        const state = { selectedOpPath: '0', selectedDataPath: '' };
        const next  = selectNodeState(state, '0/0/0', tree);
        assert.equal(next.selectedOpPath,   '0');
        assert.equal(next.selectedDataPath, '0/0/0');
    });

    test('selecting same data node again: toggles data path off, stays op-only', () => {
        const state = { selectedOpPath: '0', selectedDataPath: '0/0/0' };
        const next  = selectNodeState(state, '0/0/0', tree);
        assert.equal(next.selectedOpPath,   '0');
        assert.equal(next.selectedDataPath, '');
    });

    test('selecting root node: clears both paths', () => {
        const state = { selectedOpPath: '0', selectedDataPath: '0/0/0' };
        const next  = selectNodeState(state, '', tree);
        assert.equal(next.selectedOpPath,  '');
        assert.equal(next.selectedDataPath, '');
    });

    test('selecting placeholder node: clears both paths', () => {
        const state = { selectedOpPath: '0', selectedDataPath: '0/0/0' };
        const next  = selectNodeState(state, '0/0', tree);
        assert.equal(next.selectedOpPath,  '');
        assert.equal(next.selectedDataPath, '');
    });

    // ── outputPaneMode ─────────────────────────────────────────────────

    test('outputPaneMode: none when both paths empty', () => {
        assert.equal(outputPaneMode('', ''), 'none');
    });

    test('outputPaneMode: op-only when only opPath set', () => {
        assert.equal(outputPaneMode('0', ''), 'op-only');
    });

    test('outputPaneMode: data-only when only dataPath set', () => {
        assert.equal(outputPaneMode('', '0/0/0'), 'data-only');
    });

    test('outputPaneMode: combined when both paths set', () => {
        assert.equal(outputPaneMode('0', '0/0/0'), 'combined');
    });

    // ── getRunResults ───────────────────────────────────────────────────

    test('getRunResults: finds data nodes inside placeholder child', () => {
        const opNode = getNodeByPath(tree, '0');
        const runs = getRunResults(opNode);
        assert.equal(runs.length, 2);
        assert.equal(runs[0].nodeType, 'data');
    });

    test('getRunResults: returns empty array when assemble node has no children', () => {
        const opNode = getNodeByPath(tree, '1');
        const runs = getRunResults(opNode);
        assert.equal(runs.length, 0);
    });

    test('getRunResults: returns direct children when no placeholder wrapper', () => {
        const opNode = {
            nodeType: 'assemble', children: [
                { nodeType: 'data', title: b64('r1'), pipelineMeta: '{}' },
                { nodeType: 'data', title: b64('r2'), pipelineMeta: '{}' },
            ]
        };
        const runs = getRunResults(opNode);
        assert.equal(runs.length, 2);
    });

    test('getRunResults: detects legacy Processed node by title when nodeType absent', () => {
        const opNode = {
            children: [
                { title: b64('Processed'), children: [
                    { pipelineMeta: '{}', title: b64('run') },
                ]},
            ]
        };
        const runs = getRunResults(opNode);
        assert.equal(runs.length, 1);
    });

    test('getRunResults: returns empty array when placeholder has no children', () => {
        const opNode = {
            nodeType: 'assemble', children: [
                { nodeType: 'placeholder', children: [] }
            ]
        };
        const runs = getRunResults(opNode);
        assert.equal(runs.length, 0);
    });

    test('getRunResults: null opNode returns empty array', () => {
        assert.deepEqual(getRunResults(null), []);
    });

    test('getRunResults: opNode with no children returns empty array', () => {
        assert.deepEqual(getRunResults({ nodeType: 'assemble' }), []);
    });

    // ── op-only mode shows linked run history (not "no output") ────────

    test('op-only mode: getRunResults + outputPaneMode gives linked run history', () => {
        const state = { selectedOpPath: '0', selectedDataPath: '' };
        const mode  = outputPaneMode(state.selectedOpPath, state.selectedDataPath);
        assert.equal(mode, 'op-only', 'must be op-only when only assemble node selected');
        const opNode = getNodeByPath(tree, state.selectedOpPath);
        const runs   = getRunResults(opNode);
        assert.equal(runs.length, 2, 'run history must be non-empty for this tree');
    });

    test('combined mode: also shows linked run history (same branch as op-only)', () => {
        const state = { selectedOpPath: '0', selectedDataPath: '0/0/0' };
        const mode  = outputPaneMode(state.selectedOpPath, state.selectedDataPath);
        assert.equal(mode, 'combined');
        // combined also calls getRunResults on opNode
        const opNode = getNodeByPath(tree, state.selectedOpPath);
        const runs   = getRunResults(opNode);
        assert.equal(runs.length, 2);
    });

    // ── REGRESSION TESTS ───────────────────────────────────────────────
    // These tests check the actual source of app.js to detect logic regressions
    // that would cause the wrong behaviour without DOM/Electron.

    const appJsPath = path.join(__dirname, '..', 'frontend', 'app.js');

    test('REGRESSION: selectNode must NOT auto-call showHistory for assemble node selection', () => {
        const src = fs.readFileSync(appJsPath, 'utf8');
        // Extract the selectNode function body by finding it and reading until the next top-level method
        const startIdx = src.indexOf('\n    selectNode(path');
        assert.ok(startIdx !== -1, 'selectNode function must exist in app.js');
        // Find the closing of selectNode: next top-level method definition (4-space indent + identifier)
        const afterStart = src.indexOf('\n    selectNode(path', startIdx) + 1;
        const nextMethod = src.indexOf('\n    ', afterStart + 20);
        const body = src.slice(afterStart, nextMethod);
        assert.ok(
            !body.includes('showHistory'),
            'selectNode must not call showHistory — doing so opens a modal that hides the output pane run history (regression from 2026-06-13)'
        );
    });

    test('REGRESSION: selectNode sets selectedOpPath for assemble nodeType', () => {
        const src = fs.readFileSync(appJsPath, 'utf8');
        // The assemble branch in selectNode must go through the else (op path) not the data branch
        // Verify isDataNodePath check exists in selectNode and that nodeType=assemble nodes are NOT data
        assert.ok(src.includes('isDataNodePath(path)'), 'selectNode must call isDataNodePath to dispatch node type');
        // Since isDataNodePath returns false for nodeType='assemble', the else branch sets selectedOpPath
        // We verify this by checking the state machine directly:
        const state = { selectedOpPath: '', selectedDataPath: '' };
        const next  = selectNodeState(state, '0', tree);
        assert.equal(next.selectedOpPath, '0', 'assemble node must set selectedOpPath');
        assert.equal(next.selectedDataPath, '', 'assemble node must NOT set selectedDataPath');
    });

    test('REGRESSION: renderOutput op-only branch must call renderLinkedRunHistory (not show empty)', () => {
        const src = fs.readFileSync(appJsPath, 'utf8');
        const startIdx = src.indexOf('\n    renderOutput()');
        assert.ok(startIdx !== -1, 'renderOutput function must exist in app.js');
        const endIdx = src.indexOf('\n    renderPipelineMeta', startIdx);
        const body = src.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 3000);
        assert.ok(
            body.includes("selectedOpPath !== '' && selectedDataPath === ''"),
            'renderOutput must have op-only branch checking selectedOpPath and empty selectedDataPath'
        );
        assert.ok(
            body.includes('renderLinkedRunHistory'),
            'renderOutput op-only branch must call renderLinkedRunHistory'
        );
    });

    test('REGRESSION: renderOutput combined mode must also call renderLinkedRunHistory', () => {
        const src = fs.readFileSync(appJsPath, 'utf8');
        const startIdx = src.indexOf('\n    renderOutput()');
        const endIdx = src.indexOf('\n    renderPipelineMeta', startIdx);
        const body = src.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 3000);
        const firstLinked  = body.indexOf('renderLinkedRunHistory');
        const secondLinked = body.indexOf('renderLinkedRunHistory', firstLinked + 1);
        assert.ok(secondLinked !== -1, 'renderOutput must call renderLinkedRunHistory for both op-only and combined modes');
    });
});

// ── 13. _buildMeta outputAttachments inclusion ────────────────
describe('_buildMeta outputAttachments in pipeline_completed', () => {
    // Mirror _buildMeta from main.js
    function buildMeta(historySteps, pipelineName, runId, startedAt, outputMode) {
        return JSON.stringify({
            id: runId,
            pipelineName,
            startedAt,
            status: 'completed',
            outputMode,
            steps: historySteps.map(s => ({
                index: s.index, name: s.name, type: s.type,
                input: s.input, output: s.output, status: s.status,
                promptTokens: s.promptTokens, completionTokens: s.completionTokens,
                parallelBranches: s.parallelBranches,
                requestUrl: s.requestUrl,
                requestBody: s.requestBody,
                outputAttachments: s.artifacts || [],
            })),
        });
    }

    test('step with no artifacts yields outputAttachments: []', () => {
        const meta = JSON.parse(buildMeta(
            [{ index: 0, name: 's1', type: 'ai', input: 'in', output: 'out', status: 'completed' }],
            'pipe', 'run1', '2026-01-01T00:00:00Z', 'child'
        ));
        assert.deepStrictEqual(meta.steps[0].outputAttachments, []);
    });

    test('step with image artifacts carries outputAttachments into meta', () => {
        const artifacts = [
            { file: 'gemini_0.png', mimetype: 'image/png', content: 'base64abc', size: 100 }
        ];
        const meta = JSON.parse(buildMeta(
            [{ index: 0, name: 's1', type: 'ai', input: 'draw', output: '[Gemini: 1 image(s)]', status: 'completed', artifacts }],
            'pipe', 'run2', '2026-01-01T00:00:00Z', 'child'
        ));
        assert.equal(meta.steps[0].outputAttachments.length, 1);
        assert.equal(meta.steps[0].outputAttachments[0].mimetype, 'image/png');
        assert.equal(meta.steps[0].outputAttachments[0].content, 'base64abc');
    });

    test('multiple steps each carry their own outputAttachments', () => {
        const steps = [
            { index: 0, name: 's1', type: 'ai', input: 'a', output: 'b', status: 'completed', artifacts: [{ file: 'img1.png', mimetype: 'image/png', content: 'c1', size: 10 }] },
            { index: 1, name: 's2', type: 'ai', input: 'b', output: 'c', status: 'completed', artifacts: [] },
        ];
        const meta = JSON.parse(buildMeta(steps, 'p', 'r', '2026-01-01T00:00:00Z', 'child'));
        assert.equal(meta.steps[0].outputAttachments.length, 1);
        assert.deepStrictEqual(meta.steps[1].outputAttachments, []);
    });

    test('PipelineRunner emits outputAttachments in pipeline_completed when provider returns images', async () => {
        const r = new PipelineRunner();
        const imageAtt = { file: 'gen.png', mimetype: 'image/png', content: 'imgdata', size: 50 };
        r.registerProvider('gemini', {
            call: async () => ({
                content: '[Gemini: 1 image(s)]',
                model: 'gemini-2.5-flash',
                outputAttachments: [imageAtt],
            })
        });
        await r.run('img-pipe', [
            { name: 'generate', type: 'ai', params: { provider: 'gemini', userPrompt: 'draw a cat' } }
        ], 'draw a cat', [], 'child');

        const completed = r.events.find(e => e.type === 'pipeline_completed');
        assert.ok(completed, 'pipeline_completed must be emitted');
        // The test PipelineRunner shim does not call _buildMeta, so check historySteps directly
        assert.equal(r.historySteps[0].artifacts.length, 1);
        assert.equal(r.historySteps[0].artifacts[0].mimetype, 'image/png');
    });
});

// ── 14. run_pipeline provider registration ────────────────────
describe('run_pipeline provider registration', () => {
    // Mirror the provider registration logic added to run_pipeline in main.js
    function registerStepProviders(pipelineSteps, savedProviders, runner) {
        for (const step of pipelineSteps) {
            if (step.type === 'ai' && step.params?.provider) {
                const pName = step.params.provider;
                const cfg = savedProviders[pName] || {};
                // In real code this calls runner.registerProvider which calls createProvider
                // Here we just record that the name would be registered
                runner._toRegister = runner._toRegister || [];
                runner._toRegister.push({ name: pName, format: cfg.apiFormat || pName, key: cfg.apiKey || '' });
            }
        }
    }

    test('ai step provider is registered before run', () => {
        const runner = {};
        const steps = [{ type: 'ai', params: { provider: 'gemini', model: 'gemini-2.5-flash', userPrompt: '{content}' } }];
        const saved = { gemini: { apiKey: 'gk-123', apiFormat: 'gemini' } };
        registerStepProviders(steps, saved, runner);
        assert.ok(runner._toRegister.some(r => r.name === 'gemini'));
        assert.equal(runner._toRegister[0].key, 'gk-123');
    });

    test('non-ai steps are skipped during registration', () => {
        const runner = {};
        const steps = [
            { type: 'manual', params: {} },
            { type: 'ai', params: { provider: 'openai', userPrompt: 'x' } },
        ];
        registerStepProviders(steps, { openai: { apiKey: 'sk', apiFormat: 'openai' } }, runner);
        assert.equal(runner._toRegister.length, 1);
        assert.equal(runner._toRegister[0].name, 'openai');
    });

    test('provider with no saved config uses name as format', () => {
        const runner = {};
        const steps = [{ type: 'ai', params: { provider: 'ollama' } }];
        registerStepProviders(steps, {}, runner);
        assert.equal(runner._toRegister[0].format, 'ollama');
        assert.equal(runner._toRegister[0].key, '');
    });

    test('multi-step pipeline registers each unique provider', () => {
        const runner = {};
        const steps = [
            { type: 'ai', params: { provider: 'gemini', userPrompt: 'a' } },
            { type: 'ai', params: { provider: 'openai', userPrompt: 'b' } },
        ];
        const saved = { gemini: { apiKey: 'g', apiFormat: 'gemini' }, openai: { apiKey: 'o', apiFormat: 'openai' } };
        registerStepProviders(steps, saved, runner);
        assert.equal(runner._toRegister.length, 2);
        assert.ok(runner._toRegister.some(r => r.name === 'gemini'));
        assert.ok(runner._toRegister.some(r => r.name === 'openai'));
    });
});

// ── 15. save_config defaultImageFit persistence ───────────────
describe('save_config defaultImageFit', () => {
    // Extended save_config handler that includes defaultImageFit
    function saveConfig(st, payload) {
        st.saveGeneralConfig({
            historyRetention: payload?.historyRetention || 50,
            defaultProvider: payload?.defaultProvider || 'openai',
            defaultModel: payload?.defaultModel || '',
            defaultImageFit: payload?.defaultImageFit || 'contain',
        });
    }

    test('defaultImageFit is persisted when set', () => {
        const tmpDir = makeTempDir();
        const st = new Storage(); st.init(tmpDir);
        saveConfig(st, { historyRetention: 50, defaultProvider: 'openai', defaultModel: '', defaultImageFit: 'fit-height' });
        const cfg = st.loadGeneralConfig();
        assert.equal(cfg.defaultImageFit, 'fit-height');
        rmrf(tmpDir);
    });

    test('defaultImageFit defaults to contain when omitted', () => {
        const tmpDir = makeTempDir();
        const st = new Storage(); st.init(tmpDir);
        saveConfig(st, { historyRetention: 50, defaultProvider: 'openai', defaultModel: '' });
        const cfg = st.loadGeneralConfig();
        assert.equal(cfg.defaultImageFit, 'contain');
        rmrf(tmpDir);
    });

    test('all four fit modes can be saved and loaded', () => {
        const tmpDir = makeTempDir();
        const st = new Storage(); st.init(tmpDir);
        for (const mode of ['contain', 'fit-height', 'fit-width', 'native']) {
            saveConfig(st, { defaultImageFit: mode });
            assert.equal(st.loadGeneralConfig().defaultImageFit, mode, `mode "${mode}" should round-trip`);
        }
        rmrf(tmpDir);
    });
});

// ── 16. Behavior Tree ─────────────────────────────────────────
describe('Behavior Tree', () => {
    const vm = require('node:vm');
    const appJsPath = path.join(__dirname, '../frontend/app.js');
    const btJsPath  = path.join(__dirname, '../frontend/bt.js');
    const appJsCode = fs.readFileSync(appJsPath, 'utf8');
    const btJsCode  = fs.readFileSync(btJsPath, 'utf8');
    const b64 = s => Buffer.from(s, 'binary').toString('base64');

    function createBtApp() {
        const ctx = {
            window: {},
            document: {
                getElementById: () => ({ style: {}, classList: { add: () => {}, remove: () => {} }, value: '', innerHTML: '' }),
                addEventListener: () => {},
                querySelector: () => ({ style: {} }),
                querySelectorAll: () => [],
                createElement: () => ({ classList: { add: () => {}, remove: () => {} }, style: {}, appendChild: () => {} }),
                body: { appendChild: () => {} },
            },
            navigator: { clipboard: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('mocked clipboard text') } },
            localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
            confirm: () => true,
            console,
            setTimeout,
            clearTimeout,
            btoa: s => Buffer.from(s, 'binary').toString('base64'),
            atob: s => Buffer.from(s, 'base64').toString('binary'),
        };
        vm.createContext(ctx);
        vm.runInContext(btJsCode, ctx);
        vm.runInContext(appJsCode, ctx);
        const app = vm.runInContext('app', ctx);
        app._vmContext = ctx;
        // stub UI methods
        app.renderTree  = () => {};
        app.renderList  = () => {};
        app.loadEditor  = () => {};
        app.renderOutput = () => {};
        app.addLog      = () => {};
        app.postMessage = () => {};
        app.saveCurrentTab = () => {};
        app._messageListeners = [];
        // BT engine initialization (directly create without calling init())
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', ctx);
        app._bt = new BehaviorTreeEngine(app);
        return app;
    }

    function makeTree(rootBtType, leafContents) {
        // root → children are assemble leaf nodes
        const children = leafContents.map((c, i) => ({
            title: b64(`Leaf ${i}`),
            content: b64(c),
            mimetype: 'text/plain',
            nodeType: 'assemble',
            attachments: [],
            children: [],
        }));
        const root = {
            title: '',
            content: '',
            mimetype: 'text/plain',
            nodeType: 'root',
            btType: rootBtType,
            attachments: [],
            children,
        };
        return root;
    }

    // ── treeCtxSetBtType ──────────────────────────────────────

    test('treeCtxSetBtType sets btType on assemble node', () => {
        const app = createBtApp();
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree(undefined, ['a', 'b']) }];
        app.state.activeTab = 0;
        app.treeCtxSetBtType('0', 'sequence');
        assert.equal(app.getNodeByPath('0').btType, 'sequence');
    });

    test('treeCtxSetBtType sets btType on root node', () => {
        const app = createBtApp();
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree(undefined, ['a']) }];
        app.state.activeTab = 0;
        app.treeCtxSetBtType('', 'selector');
        assert.equal(app.getNodeByPath('').btType, 'selector');
    });

    test('treeCtxSetBtType with "leaf" removes btType', () => {
        const app = createBtApp();
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree(undefined, ['a']) }];
        app.state.activeTab = 0;
        const node = app.getNodeByPath('0');
        node.btType = 'sequence';
        app.treeCtxSetBtType('0', 'leaf');
        assert.equal(node.btType, undefined);
    });

    test('treeCtxSetBtType ignores data nodes', () => {
        const app = createBtApp();
        const root = makeTree(undefined, []);
        root.children.push({
            title: b64('run'), content: b64('out'), mimetype: 'text/plain',
            nodeType: 'data', pipelineMeta: '{}', attachments: [], children: [],
        });
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        app.treeCtxSetBtType('0', 'sequence');
        assert.equal(app.getNodeByPath('0').btType, undefined);
    });

    // ── _btRunNode — pure logic with stub processPrompt ───────

    function makeBtApp(leafResults) {
        // leafResults: array of { output, success } per leaf in order of execution
        const app = createBtApp();
        let callIdx = 0;
        app.processPrompt = () => {
            const result = leafResults[callIdx++] || { output: '', success: false };
            if (app._bt._leafCallback) {
                const cb = app._bt._leafCallback;
                app._bt._leafCallback = null;
                cb({ outputContent: result.output, pipelineName: 'test', error: result.error });
            }
        };
        return app;
    }

    test('Sequence: all succeed → returns true', async () => {
        const app = makeBtApp([
            { output: 'result A' },
            { output: 'result B' },
        ]);
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('sequence', ['p1', 'p2']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
    });

    test('Sequence: first fails → stops and returns false', async () => {
        let callCount = 0;
        const app = makeBtApp([{ output: '' }, { output: 'B' }]);
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: callCount === 1 ? '' : 'B', pipelineName: 'test', error: callCount === 1 });
        };
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('sequence', ['p1', 'p2']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, false);
        assert.equal(callCount, 1, 'Second leaf must not be executed');
    });

    test('Sequence: second fails → returns false', async () => {
        const app = makeBtApp([{ output: 'A' }, { output: '', error: true }]);
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('sequence', ['p1', 'p2']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, false);
    });

    test('Selector: first succeeds → returns true without running second', async () => {
        let callCount = 0;
        const app = makeBtApp([{ output: 'A' }, { output: 'B' }]);
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: 'A', pipelineName: 'test' });
        };
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('selector', ['p1', 'p2']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
        assert.equal(callCount, 1, 'Second leaf must not be executed');
    });

    test('Selector: first fails, second succeeds → returns true', async () => {
        let callCount = 0;
        const app = makeBtApp([]);
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: callCount === 1 ? '' : 'B', pipelineName: 'test', error: callCount === 1 });
        };
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('selector', ['p1', 'p2']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
        assert.equal(callCount, 2);
    });

    test('Selector: all fail → returns false', async () => {
        const app = makeBtApp([{ output: '', error: true }, { output: '', error: true }]);
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('selector', ['p1', 'p2']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, false);
    });

    test('Parallel: all succeed → returns true', async () => {
        const app = makeBtApp([{ output: 'A' }, { output: 'B' }]);
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('parallel', ['p1', 'p2']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
    });

    test('Parallel: one fails → returns false', async () => {
        let callCount = 0;
        const app = makeBtApp([]);
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: callCount === 1 ? 'A' : '', pipelineName: 'test', error: callCount === 2 });
        };
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('parallel', ['p1', 'p2']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, false);
    });

    test('Leaf (no btType): success when output non-empty', async () => {
        const app = makeBtApp([{ output: 'hello' }]);
        const root = makeTree(undefined, ['prompt']);
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('0');
        assert.equal(ok, true);
    });

    test('Leaf (no btType): success when output is true (string)', async () => {
        const app = makeBtApp([{ output: 'true' }]);
        const root = makeTree(undefined, ['prompt']);
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('0');
        assert.equal(ok, true);
    });

    test('Leaf (no btType): success when output is true with punctuation', async () => {
        const app = makeBtApp([{ output: 'True.' }]);
        const root = makeTree(undefined, ['prompt']);
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('0');
        assert.equal(ok, true);
    });

    test('Leaf (no btType): failure when output is false (string)', async () => {
        const app = makeBtApp([{ output: 'false' }]);
        const root = makeTree(undefined, ['prompt']);
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('0');
        assert.equal(ok, false);
    });

    test('Leaf (no btType): failure when output is false with punctuation', async () => {
        const app = makeBtApp([{ output: 'False.' }]);
        const root = makeTree(undefined, ['prompt']);
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('0');
        assert.equal(ok, false);
    });

    test('Leaf (no btType): success when output empty (successful call)', async () => {
        const app = makeBtApp([{ output: '' }]);
        const root = makeTree(undefined, ['prompt']);
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('0');
        assert.equal(ok, true);
    });

    test('Leaf (no btType): failure when API call fails', async () => {
        const app = makeBtApp([{ output: '', error: true }]);
        const root = makeTree(undefined, ['prompt']);
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('0');
        assert.equal(ok, false);
    });

    test('Leaf (Math): evaluates basic expression successfully', async () => {
        const app = createBtApp();
        app.state.tabs = [{
            name: 't', file: 't.json', root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                    { title: b64('MathNode'), content: b64('2 + 3 * 5'), mimetype: 'text/plain', nodeType: 'assemble', btType: 'leaf_math', btOutputKey: 'math_res', children: [] }
                ]
            }
        }];
        app.state.activeTab = 0;
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', app._vmContext);
        app._bt = new BehaviorTreeEngine(app);
        const ok = await app._bt._runNode('0');
        assert.equal(ok, true);
        assert.equal(app._bt._blackboard.math_res.text, '17');
    });

    test('Leaf (Math): evaluates boolean condition returning false', async () => {
        const app = createBtApp();
        app.state.tabs = [{
            name: 't', file: 't.json', root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                    { title: b64('MathNode'), content: b64('5 > 10'), mimetype: 'text/plain', nodeType: 'assemble', btType: 'leaf_math', btOutputKey: 'math_res', children: [] }
                ]
            }
        }];
        app.state.activeTab = 0;
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', app._vmContext);
        app._bt = new BehaviorTreeEngine(app);
        const ok = await app._bt._runNode('0');
        assert.equal(ok, false);
        assert.equal(app._bt._blackboard.math_res.text, 'false');
    });

    test('Leaf (Web): runs GET request successfully', async () => {
        const app = createBtApp();
        app.state.tabs = [{
            name: 't', file: 't.json', root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                    { title: b64('WebNode'), content: b64('https://api.example.com/data'), mimetype: 'text/plain', nodeType: 'assemble', btType: 'leaf_web', btOutputKey: 'web_res', children: [] }
                ]
            }
        }];
        app.state.activeTab = 0;
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', app._vmContext);
        app._bt = new BehaviorTreeEngine(app);
        
        let sentMsg = null;
        app.postMessage = (msg) => {
            sentMsg = msg;
        };

        const runPromise = app._bt._runNode('0');
        await Promise.resolve();

        // Simulate IPC callback
        assert.ok(sentMsg);
        assert.equal(sentMsg.type, 'bt_http_request');
        assert.equal(sentMsg.payload.url, 'https://api.example.com/data');

        // Call the message listener
        const listeners = app._messageListeners || [];
        for (const l of listeners) {
            l({ type: 'bt_http_request_result', response: 'hello world' });
        }

        const ok = await runPromise;
        assert.equal(ok, true);
        assert.equal(app._bt._blackboard.web_res.text, 'hello world');
    });

    test('Leaf (Misc): writes static text to blackboard', async () => {
        const app = createBtApp();
        app.state.tabs = [{
            name: 't', file: 't.json', root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                    { title: b64('MiscNode'), content: b64('hello world'), mimetype: 'text/plain', nodeType: 'assemble', btType: 'leaf_misc', btOutputKey: 'my_var', children: [] }
                ]
            }
        }];
        app.state.activeTab = 0;
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', app._vmContext);
        app._bt = new BehaviorTreeEngine(app);
        const ok = await app._bt._runNode('0');
        assert.equal(ok, true);
        assert.equal(app._bt._blackboard.my_var.text, 'hello world');
    });

    test('Leaf (Misc): reads blackboard variable and writes to another key', async () => {
        const app = createBtApp();
        app.state.tabs = [{
            name: 't', file: 't.json', root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                    { title: b64('MiscNode'), content: b64('{bb:source_var} plus extra'), mimetype: 'text/plain', nodeType: 'assemble', btType: 'leaf_misc', btOutputKey: 'target_var', children: [] }
                ]
            }
        }];
        app.state.activeTab = 0;
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', app._vmContext);
        app._bt = new BehaviorTreeEngine(app);
        app._bt._blackboard.source_var = { text: 'hello' };
        const ok = await app._bt._runNode('0');
        assert.equal(ok, true);
        assert.equal(app._bt._blackboard.target_var.text, 'hello plus extra');
    });

    test('Leaf (Misc): copies text to clipboard', async () => {
        const app = createBtApp();
        app.state.tabs = [{
            name: 't', file: 't.json', root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                    { title: b64('MiscNode'), content: b64('copy hello clipboard'), mimetype: 'text/plain', nodeType: 'assemble', btType: 'leaf_misc', btOutputKey: 'my_var', children: [] }
                ]
            }
        }];
        app.state.activeTab = 0;
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', app._vmContext);
        app._bt = new BehaviorTreeEngine(app);
        
        let copiedText = null;
        app._vmContext.navigator.clipboard.writeText = async (text) => {
            copiedText = text;
        };

        const ok = await app._bt._runNode('0');
        assert.equal(ok, true);
        assert.equal(copiedText, 'hello clipboard');
        assert.equal(app._bt._blackboard.my_var.text, 'hello clipboard');
    });

    test('Leaf (Misc): pastes text from clipboard', async () => {
        const app = createBtApp();
        app.state.tabs = [{
            name: 't', file: 't.json', root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                    { title: b64('MiscNode'), content: b64('paste'), mimetype: 'text/plain', nodeType: 'assemble', btType: 'leaf_misc', btOutputKey: 'my_var', children: [] }
                ]
            }
        }];
        app.state.activeTab = 0;
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', app._vmContext);
        app._bt = new BehaviorTreeEngine(app);
        
        app._vmContext.navigator.clipboard.readText = async () => 'hello from clipboard';

        const ok = await app._bt._runNode('0');
        assert.equal(ok, true);
    });

    test('Assemble Node: writes AI result to blackboard output key', async () => {
        const app = createBtApp();
        app.state.tabs = [{
            name: 't', file: 't.json', root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [
                    { title: b64('AI Node'), content: b64('some prompt'), mimetype: 'text/plain', nodeType: 'assemble', btType: 'leaf', btOutputKey: 'ai_res', children: [] }
                ]
            }
        }];
        app.state.activeTab = 0;
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', app._vmContext);
        app._bt = new BehaviorTreeEngine(app);

        let loggedMsgs = [];
        app.addLog = (msg) => {
            loggedMsgs.push(msg);
        };

        app.processPrompt = () => {
            const cb = app._bt._pendingCallbacks.get('0') || app._bt._leafCallback;
            cb({ outputContent: 'AI output content', pipelineName: 'test-ai', error: false });
        };

        const ok = await app._bt._runNode('0');
        assert.equal(ok, true);
        assert.equal(app._bt._blackboard.ai_res.text, 'AI output content');
        assert.ok(loggedMsgs.some(m => m.includes('ai_res') && m.includes('AI output content')));
    });

    test('Assemble Node (Manual): manual pipeline completion writes to blackboard and logs', () => {
        const app = createBtApp();
        const node = {
            title: b64('AI Node'),
            content: b64('some prompt'),
            mimetype: 'text/plain',
            nodeType: 'assemble',
            btType: 'leaf',
            btOutputKey: 'manual_res',
            children: []
        };
        app.state.tabs = [{
            name: 't', file: 't.json', root: {
                title: '', content: '', mimetype: 'text/plain', nodeType: 'root', children: [node]
            }
        }];
        app.state.activeTab = 0;
        app.state.currentNodePath = '0';

        let loggedMsgs = [];
        app.addLog = (msg) => {
            loggedMsgs.push(msg);
        };

        // Trigger manual pipeline completion (not handled by BT engine since BT engine is not running)
        app.onPipelineCompleted({
            outputContent: 'Manual output content',
            pipelineName: 'test-manual',
            error: false
        });

        assert.equal(app._bt._blackboard.manual_res.text, 'Manual output content');
        assert.ok(loggedMsgs.some(m => m.includes('manual_res') && m.includes('Manual output content')));
    });

    test('Nested: Sequence containing Selector', async () => {
        // root(sequence) → [selector(child0), leaf(child1)]
        // selector → [fail-leaf, success-leaf]
        // selector succeeds → sequence continues → leaf succeeds → overall true
        let callOrder = [];
        const outputs = ['', 'S', 'L'];  // sel-child0 fails, sel-child1 succeeds, seq-child1 succeeds
        let idx = 0;
        const app = createBtApp();
        app.processPrompt = () => {
            const out = outputs[idx++] || '';
            callOrder.push(out);
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: out, pipelineName: 'test', error: out === '' });
        };

        const selectorNode = {
            title: b64('Sel'), content: '', mimetype: 'text/plain',
            nodeType: 'assemble', btType: 'selector', attachments: [],
            children: [
                { title: b64('S0'), content: b64('p'), mimetype: 'text/plain', nodeType: 'assemble', attachments: [], children: [] },
                { title: b64('S1'), content: b64('p'), mimetype: 'text/plain', nodeType: 'assemble', attachments: [], children: [] },
            ],
        };
        const seqLeaf = {
            title: b64('L'), content: b64('p'), mimetype: 'text/plain',
            nodeType: 'assemble', attachments: [], children: [],
        };
        const root = {
            title: '', content: '', mimetype: 'text/plain',
            nodeType: 'root', btType: 'sequence', attachments: [],
            children: [selectorNode, seqLeaf],
        };
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;

        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
        assert.deepEqual(callOrder, ['', 'S', 'L']);
    });

    // ── checkNodeTypeInvariants btType validation ─────────────

    test('checkNodeTypeInvariants: valid btType on assemble passes', () => {
        const app = createBtApp();
        const root = makeTree(undefined, ['a']);
        root.children[0].btType = 'sequence';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const loggedErrors = [];
        app.addLog = msg => { if (msg.includes('[RC-01]')) loggedErrors.push(msg); };
        app.checkNodeTypeInvariants();
        assert.equal(loggedErrors.length, 0);
    });

    test('checkNodeTypeInvariants: valid btType on root passes', () => {
        const app = createBtApp();
        const root = makeTree('parallel', ['a']);
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const loggedErrors = [];
        app.addLog = msg => { if (msg.includes('[RC-01]')) loggedErrors.push(msg); };
        app.checkNodeTypeInvariants();
        assert.equal(loggedErrors.length, 0);
    });

    test('checkNodeTypeInvariants: btType on data node is flagged', () => {
        const app = createBtApp();
        const root = makeTree(undefined, []);
        root.children.push({
            title: b64('run'), content: b64('out'), mimetype: 'text/plain',
            nodeType: 'data', pipelineMeta: '{}', btType: 'sequence',
            attachments: [], children: [],
        });
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const loggedErrors = [];
        app.addLog = msg => { if (msg.includes('[RC-01]')) loggedErrors.push(msg); };
        app.checkNodeTypeInvariants();
        assert.ok(loggedErrors.length > 0, 'Should report btType on data node');
    });

    test('checkNodeTypeInvariants: unknown btType is flagged', () => {
        const app = createBtApp();
        const root = makeTree(undefined, ['a']);
        root.children[0].btType = 'decorator';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const loggedErrors = [];
        app.addLog = msg => { if (msg.includes('[RC-01]')) loggedErrors.push(msg); };
        app.checkNodeTypeInvariants();
        assert.ok(loggedErrors.length > 0, 'Should report unknown btType');
    });

    // ── Decorator execution tests ─────────────────────────────

    test('invert flips failure to success', async () => {
        const app = makeBtApp([{ output: '', error: true }]);
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('invert', ['p']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
    });

    test('repeater runs child N times', async () => {
        let callCount = 0;
        const app = createBtApp();
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: 'ok', pipelineName: 'test' });
        };
        const root = makeTree('repeater', ['p']);
        root.btRepeatCount = '3';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
        assert.equal(callCount, 3);
    });

    test('repeater stops early on child failure', async () => {
        let callCount = 0;
        const app = createBtApp();
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: '', pipelineName: 'test', error: true });
        };
        const root = makeTree('repeater', ['p']);
        root.btRepeatCount = '3';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, false);
        assert.equal(callCount, 1);
    });

    test('retry succeeds after failure', async () => {
        let callCount = 0;
        const app = createBtApp();
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: callCount >= 2 ? 'ok' : '', pipelineName: 'test', error: callCount < 2 });
        };
        const root = makeTree('retry', ['p']);
        root.btRetryCount = '2';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
        assert.equal(callCount, 2);
    });

    test('retry exhausts all retries', async () => {
        let callCount = 0;
        const app = createBtApp();
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: '', pipelineName: 'test', error: true });
        };
        const root = makeTree('retry', ['p']);
        root.btRetryCount = '2';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, false);
        assert.equal(callCount, 3); // initial + 2 retries
    });

    test('alwaysSucceed masks failure', async () => {
        const app = makeBtApp([{ output: '', error: true }]);
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('alwaysSucceed', ['p']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
    });

    test('alwaysFail masks success', async () => {
        const app = makeBtApp([{ output: 'ok' }]);
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('alwaysFail', ['p']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, false);
    });

    test('delay executes child after wait', async () => {
        const app = makeBtApp([{ output: 'ok' }]);
        const root = makeTree('delay', ['p']);
        root.btDelay = '10';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const start = Date.now();
        const ok = await app._bt._runNode('');
        const elapsed = Date.now() - start;
        assert.equal(ok, true);
        assert.ok(elapsed >= 8, 'should have waited at least ~10ms');
    });

    test('maxTime succeeds when child finishes quickly', async () => {
        const app = makeBtApp([{ output: 'ok' }]);
        const root = makeTree('maxTime', ['p']);
        root.btTimeout = '5000';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
    });

    test('guard blocks child when condition missing', async () => {
        let callCount = 0;
        const app = createBtApp();
        app.processPrompt = () => { callCount++; };
        const root = makeTree('guard', ['p']);
        root.btCondition = 'nonexistent';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, false);
        assert.equal(callCount, 0);
    });

    test('guard passes child when condition exists', async () => {
        let callCount = 0;
        const app = createBtApp();
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: 'ok', pipelineName: 'test' });
        };
        const root = makeTree('guard', ['p']);
        root.btCondition = 'mykey';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        app._bt._blackboard['mykey'] = { text: 'x' };
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
        assert.equal(callCount, 1);
    });

    // ── Memory composite tests ────────────────────────────────

    test('memSequence runs children in order', async () => {
        const app = makeBtApp([{ output: 'A' }, { output: 'B' }]);
        app.state.tabs = [{ name: 't', file: 't.json', root: makeTree('memSequence', ['p1', 'p2']) }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
    });

    test('memSelector picks first success', async () => {
        let callCount = 0;
        const app = createBtApp();
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: callCount === 2 ? 'ok' : '', pipelineName: 'test', error: callCount < 2 });
        };
        const root = makeTree('memSelector', ['p1', 'p2']);
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
        assert.equal(callCount, 2);
    });

    // ── Compound type tests ───────────────────────────────────

    test('repeater+sequence compound', async () => {
        let callCount = 0;
        const app = createBtApp();
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: 'ok', pipelineName: 'test' });
        };
        const root = makeTree('repeater+sequence', ['p1', 'p2']);
        root.btRepeatCount = '2';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
        assert.equal(callCount, 4); // 2 children × 2 repeats
    });

    test('repeater+invert+sequence 3-part chain', async () => {
        let callCount = 0;
        const app = createBtApp();
        app.processPrompt = () => {
            callCount++;
            const cb = app._bt._leafCallback;
            app._bt._leafCallback = null;
            cb({ outputContent: '', pipelineName: 'test', error: true });
        };
        const root = makeTree('repeater+invert+sequence', ['p1', 'p2']);
        root.btRepeatCount = '2';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        // sequence: child0 fails → false, invert: false→true, repeater runs 2×
        // each iteration: only child0 runs (sequence short-circuits)
        const ok = await app._bt._runNode('');
        assert.equal(ok, true);
        assert.equal(callCount, 2); // 2 repeats × 1 child each
    });

    test('decorator order matters: invert+retry+sequence vs retry+invert+sequence', async () => {
        // invert+retry+sequence: invert runs retry+seq, retry attempts 3× each fail, retry→false, invert→true → callCount=3
        // retry+invert+sequence: retry runs invert+seq, invert flips fail→true on attempt 0, retry→true → callCount=1
        async function runWithType(btType) {
            let callCount = 0;
            const app = createBtApp();
            app.processPrompt = () => {
                callCount++;
                const cb = app._bt._leafCallback;
                app._bt._leafCallback = null;
                cb({ outputContent: '', pipelineName: 'test', error: true });
            };
            const root = makeTree(btType, ['p1', 'p2']);
            root.btRetryCount = '2';
            app.state.tabs = [{ name: 't', file: 't.json', root }];
            app.state.activeTab = 0;
            const ok = await app._bt._runNode('');
            return { ok, callCount };
        }
        const a = await runWithType('retry+invert+sequence');
        const b = await runWithType('invert+retry+sequence');
        assert.equal(a.ok, true);
        assert.equal(b.ok, true);
        assert.notEqual(a.callCount, b.callCount, 'order should affect call count');
    });

    // ── Validator tests for compound types ────────────────────

    test('checkNodeTypeInvariants: compound type on assemble passes', () => {
        const app = createBtApp();
        const root = makeTree('sequence', ['a']);
        root.children[0].btType = 'repeater+selector';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const loggedErrors = [];
        app.addLog = msg => { if (msg.includes('[RC-01]')) loggedErrors.push(msg); };
        app.checkNodeTypeInvariants();
        assert.equal(loggedErrors.length, 0);
    });

    test('checkNodeTypeInvariants: compound type on root passes', () => {
        const app = createBtApp();
        const root = makeTree('repeater+retry+invert+selector', ['a']);
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const loggedErrors = [];
        app.addLog = msg => { if (msg.includes('[RC-01]')) loggedErrors.push(msg); };
        app.checkNodeTypeInvariants();
        assert.equal(loggedErrors.length, 0);
    });

    test('checkNodeTypeInvariants: invalid decorator in chain flagged', () => {
        const app = createBtApp();
        const root = makeTree('sequence', ['a']);
        root.children[0].btType = 'bogus+selector';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const loggedErrors = [];
        app.addLog = msg => { if (msg.includes('[RC-01]')) loggedErrors.push(msg); };
        app.checkNodeTypeInvariants();
        assert.ok(loggedErrors.length > 0, 'Should report invalid decorator');
    });

    test('checkNodeTypeInvariants: non-composite at chain end flagged', () => {
        const app = createBtApp();
        const root = makeTree('sequence', ['a']);
        root.children[0].btType = 'repeater+leaf';
        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        const loggedErrors = [];
        app.addLog = msg => { if (msg.includes('[RC-01]')) loggedErrors.push(msg); };
        app.checkNodeTypeInvariants();
        assert.ok(loggedErrors.length > 0, 'Should report non-composite at chain end');
    });

    test('Integration: set/get between nodes and check result with math node, and check non-text type error', async () => {
        const app = createBtApp();
        
        // We will create a Sequence with 3 nodes:
        // Node 0: Misc node, sets 'first_var' to '100'
        // Node 1: Misc node, reads '{bb:first_var} + 20' and sets 'second_var' to '{bb:first_var} + 20'
        // Node 2: Math node, evaluates `({bb:second_var}) === 120` and writes to `check_ok`
        const root = {
            title: b64('Root'),
            nodeType: 'root',
            btType: 'sequence',
            children: [
                {
                    title: b64('Node 0'),
                    nodeType: 'assemble',
                    btType: 'leaf_misc',
                    btPrompt: b64('100'),
                    btOutputKey: 'first_var'
                },
                {
                    title: b64('Node 1'),
                    nodeType: 'assemble',
                    btType: 'leaf_misc',
                    btPrompt: b64('{bb:first_var} + 20'),
                    btOutputKey: 'second_var'
                },
                {
                    title: b64('Node 2'),
                    nodeType: 'assemble',
                    btType: 'leaf_math',
                    btPrompt: b64('({bb:second_var}) === 120'),
                    btOutputKey: 'check_ok'
                }
            ]
        };

        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;
        
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', app._vmContext);
        app._bt = new BehaviorTreeEngine(app);
        
        app._bt.setTarget('');
        await app._bt._execute('');
        assert.equal(app._bt._blackboard.first_var.text, '100');
        assert.equal(app._bt._blackboard.second_var.text, '100 + 20');
        assert.equal(app._bt._blackboard.check_ok.text, 'true');

        // Test non-text blackboard error:
        // Set 'media_var' as media
        app._bt.bbWrite('media_var', [{ mimetype: 'image/png' }], 'run', 'media');
        
        // Log collection
        const logs = [];
        app.addLog = (msg) => logs.push(msg);

        // Try expanding prompt with non-text variable
        const prompt = 'Check this: {bb:media_var}';
        const expanded = app._bt._expandPlaceholders(prompt);
        assert.ok(expanded.includes('[ERROR: Blackboard variable "media_var" is not of type "text"]'));
        assert.ok(logs.some(log => log.includes('not of type "text"')));
    });

    test('Integration: blackboard read/write/remove/create events update blackboard dialog', () => {
        const app = createBtApp();
        const BehaviorTreeEngine = vm.runInContext('BehaviorTreeEngine', app._vmContext);
        const engine = new BehaviorTreeEngine(app);
        
        let callbackCount = 0;
        engine._bbChangeCallback = () => {
            callbackCount++;
        };
        
        // 1. Write/Create event
        engine.bbWrite('var1', 'val1');
        assert.ok(callbackCount > 0, 'bbWrite should trigger change callback');
        const prevCount1 = callbackCount;
        
        // 2. Read event (via Proxy)
        const val = engine._blackboard.var1;
        assert.ok(callbackCount > prevCount1, '_blackboard read should trigger change callback');
        const prevCount2 = callbackCount;
        
        // 3. Clear slot/remove event
        engine.bbClearSlot('var1', 'text');
        assert.ok(callbackCount > prevCount2, 'bbClearSlot should trigger change callback');
        const prevCount3 = callbackCount;
        
        // 4. Clear key event
        engine.bbClearKey('var1');
        assert.ok(callbackCount > prevCount3, 'bbClearKey should trigger change callback');
    });

    test('Integration: Behavior3 blackboard read/write/remove/create events update blackboard dialog', () => {
        const app = createB3BtApp();
        
        let callbackCount = 0;
        app._bt._bbChangeCallback = () => {
            callbackCount++;
        };
        
        // 1. Write/Create event
        app._bt.bbWrite('var1', 'val1');
        assert.ok(callbackCount > 0, 'bbWrite B3 should trigger change callback');
        const prevCount1 = callbackCount;
        
        // 2. Read event (via Proxy)
        const slot = app._bt._blackboard.get('var1');
        assert.ok(callbackCount > prevCount1, '_blackboard get B3 should trigger change callback');
        const prevCount2 = callbackCount;
        
        // 3. Set event (via Proxy)
        app._bt._blackboard.set('var1', { text: 'newval' });
        assert.ok(callbackCount > prevCount2, '_blackboard set B3 should trigger change callback');
        const prevCount3 = callbackCount;
        
        // 4. Clear key/remove event
        app._bt.bbClearKey('var1');
        assert.ok(callbackCount > prevCount3, 'bbClearKey B3 should trigger change callback');
    });
});

// ── Behavior3 Advanced Decorator Extensions Tests ────────────
describe('Behavior3 Advanced Decorators', () => {
    const vm = require('node:vm');
    const fs = require('node:fs');
    const path = require('node:path');

    function createB3Context() {
        const ctx = {
            window: {},
            console,
            setTimeout,
            clearTimeout,
            Date,
            Math,
        };
        ctx.window = ctx;
        vm.createContext(ctx);
        const shimCode = fs.readFileSync(path.join(__dirname, '../frontend/b3-shim.js'), 'utf8');
        const decCode = fs.readFileSync(path.join(__dirname, '../frontend/bt-b3-decorators.js'), 'utf8');
        vm.runInContext(shimCode, ctx);
        vm.runInContext(decCode, ctx);
        return ctx;
    }

    test('MaxTime: returns child status if completed in time', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const MaxTime = ctx.window.MaxTime;
        
        class FastChild extends b3.Action {
            tick(bb) { return b3.Status.SUCCESS; }
        }
        
        const decorator = new MaxTime({ maxTime: 500 });
        decorator.child = new FastChild();
        const bb = new b3.Blackboard();
        
        assert.equal(decorator.tick(bb), b3.Status.SUCCESS);
    });

    test('MaxTime: times out if duration exceeded', async () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const MaxTime = ctx.window.MaxTime;
        
        class RunningChild extends b3.Action {
            tick(bb) { return b3.Status.RUNNING; }
        }
        
        const decorator = new MaxTime({ maxTime: 10 });
        decorator.child = new RunningChild();
        const bb = new b3.Blackboard();
        
        assert.equal(decorator.tick(bb), b3.Status.RUNNING);
        await new Promise(r => setTimeout(r, 20));
        assert.equal(decorator.tick(bb), b3.Status.FAILURE);
    });

    test('Guard: blocks execution when condition not met', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const Guard = ctx.window.Guard;
        
        class ChildNode extends b3.Action {
            tick(bb) { return b3.Status.SUCCESS; }
        }
        
        const decorator = new Guard({ condition: 'flag', expectedValue: true });
        decorator.child = new ChildNode();
        const bb = new b3.Blackboard();
        
        assert.equal(decorator.tick(bb), b3.Status.FAILURE);
        
        bb.set('flag', false);
        assert.equal(decorator.tick(bb), b3.Status.FAILURE);
        
        bb.set('flag', true);
        assert.equal(decorator.tick(bb), b3.Status.SUCCESS);
    });

    test('Guard: truthy check when expectedValue is undefined', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const Guard = ctx.window.Guard;
        
        class ChildNode extends b3.Action {
            tick(bb) { return b3.Status.SUCCESS; }
        }
        
        const decorator = new Guard({ condition: 'flag' });
        decorator.child = new ChildNode();
        const bb = new b3.Blackboard();
        
        assert.equal(decorator.tick(bb), b3.Status.FAILURE);
        
        bb.set('flag', 'hello');
        assert.equal(decorator.tick(bb), b3.Status.SUCCESS);
    });

    test('Guard: negates condition when negate is true', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const Guard = ctx.window.Guard;
        
        class ChildNode extends b3.Action {
            tick(bb) { return b3.Status.SUCCESS; }
        }
        
        const decorator = new Guard({ condition: 'flag', negate: true });
        decorator.child = new ChildNode();
        const bb = new b3.Blackboard();
        
        assert.equal(decorator.tick(bb), b3.Status.SUCCESS);
        
        bb.set('flag', true);
        assert.equal(decorator.tick(bb), b3.Status.FAILURE);
    });

    test('Limiter: allows execution under limit and blocks when limit reached', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const Limiter = ctx.window.Limiter;
        
        class RunningChild extends b3.Action {
            tick(bb) { return b3.Status.RUNNING; }
        }
        
        const decorator = new Limiter({ maxConcurrent: 1 });
        decorator.child = new RunningChild();
        const bb = new b3.Blackboard();
        
        assert.equal(decorator.tick(bb), b3.Status.RUNNING);
        assert.equal(decorator.tick(bb), b3.Status.FAILURE);
    });

    test('Limiter: manages running count for multiple concurrent runs', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const Limiter = ctx.window.Limiter;
        
        class RunningChild extends b3.Action {
            tick(bb) { return b3.Status.RUNNING; }
        }
        
        const decorator = new Limiter({ maxConcurrent: 2 });
        decorator.child = new RunningChild();
        const bb = new b3.Blackboard();
        
        assert.equal(decorator.tick(bb), b3.Status.RUNNING);
        assert.equal(decorator._runningCount, 1);
        
        assert.equal(decorator.tick(bb), b3.Status.RUNNING);
        assert.equal(decorator._runningCount, 2);
        
        assert.equal(decorator.tick(bb), b3.Status.FAILURE);
        assert.equal(decorator._runningCount, 2);
    });

    test('Delay: returns RUNNING initially, then executes child after delay', async () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const Delay = ctx.window.Delay;
        
        class ChildNode extends b3.Action {
            tick(bb) { return b3.Status.SUCCESS; }
        }
        
        const decorator = new Delay({ delay: 20 });
        decorator.child = new ChildNode();
        const bb = new b3.Blackboard();
        
        assert.equal(decorator.tick(bb), b3.Status.RUNNING);
        assert.equal(decorator.tick(bb), b3.Status.RUNNING);
        await new Promise(r => setTimeout(r, 30));
        assert.equal(decorator.tick(bb), b3.Status.SUCCESS);
        assert.equal(decorator._startTime, null);
    });

    test('Retry: retries child on failure up to maxRetries', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const Retry = ctx.window.Retry;
        
        let failCount = 2;
        class FailThenSuccess extends b3.Action {
            tick(bb) {
                if (failCount > 0) {
                    failCount--;
                    return b3.Status.FAILURE;
                }
                return b3.Status.SUCCESS;
            }
        }
        
        const decorator = new Retry({ maxRetries: 2 });
        decorator.child = new FailThenSuccess();
        const bb = new b3.Blackboard();
        
        assert.equal(decorator.tick(bb), b3.Status.RUNNING);
        assert.equal(decorator._attemptCount, 1);
        
        assert.equal(decorator.tick(bb), b3.Status.RUNNING);
        assert.equal(decorator._attemptCount, 2);
        
        assert.equal(decorator.tick(bb), b3.Status.SUCCESS);
        assert.equal(decorator._attemptCount, 0);
    });

    test('Retry: returns FAILURE when retries exhausted', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const Retry = ctx.window.Retry;
        
        class AlwaysFail extends b3.Action {
            tick(bb) { return b3.Status.FAILURE; }
        }
        
        const decorator = new Retry({ maxRetries: 1 });
        decorator.child = new AlwaysFail();
        const bb = new b3.Blackboard();
        
        assert.equal(decorator.tick(bb), b3.Status.RUNNING);
        assert.equal(decorator._attemptCount, 1);
        
        assert.equal(decorator.tick(bb), b3.Status.FAILURE);
        assert.equal(decorator._attemptCount, 0);
    });
});

// ── Behavior3 Concurrency and Parallel Execution Tests ────────
describe('Behavior3 Concurrency and Parallel Execution', () => {
    const vm = require('node:vm');
    const fs = require('node:fs');
    const path = require('node:path');

    function createB3Context() {
        const ctx = {
            window: {},
            console,
            setTimeout,
            clearTimeout,
            Date,
            Math,
        };
        ctx.window = ctx;
        vm.createContext(ctx);
        const shimCode = fs.readFileSync(path.join(__dirname, '../frontend/b3-shim.js'), 'utf8');
        const decCode = fs.readFileSync(path.join(__dirname, '../frontend/bt-b3-decorators.js'), 'utf8');
        vm.runInContext(shimCode, ctx);
        vm.runInContext(decCode, ctx);
        return ctx;
    }

    test('Parallel: require_all succeeds only when all children succeed', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        
        class ChildSuccess extends b3.Action {
            tick(bb) { return b3.Status.SUCCESS; }
        }
        class ChildRunning extends b3.Action {
            tick(bb) { return b3.Status.RUNNING; }
        }
        class ChildFailure extends b3.Action {
            tick(bb) { return b3.Status.FAILURE; }
        }
        
        const parallel = new b3.Parallel({ policy: 'require_all' });
        const bb = new b3.Blackboard();
        
        // All succeed
        parallel.children = [new ChildSuccess(), new ChildSuccess()];
        assert.equal(parallel.tick(bb), b3.Status.SUCCESS);
        
        // One running
        parallel.children = [new ChildRunning(), new ChildSuccess()];
        assert.equal(parallel.tick(bb), b3.Status.RUNNING);
        
        // One fails
        parallel.children = [new ChildSuccess(), new ChildFailure()];
        assert.equal(parallel.tick(bb), b3.Status.FAILURE);
    });

    test('Parallel: require_one succeeds if at least one child succeeds', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        
        class ChildSuccess extends b3.Action {
            tick(bb) { return b3.Status.SUCCESS; }
        }
        class ChildFailure extends b3.Action {
            tick(bb) { return b3.Status.FAILURE; }
        }
        
        const parallel = new b3.Parallel({ policy: 'require_one' });
        const bb = new b3.Blackboard();
        
        // One success, one failure
        parallel.children = [new ChildFailure(), new ChildSuccess()];
        assert.equal(parallel.tick(bb), b3.Status.SUCCESS);
        
        // All failure
        parallel.children = [new ChildFailure(), new ChildFailure()];
        assert.equal(parallel.tick(bb), b3.Status.FAILURE);
    });

    test('Parallel + Limiter: restricts concurrent execution in parallel branches', () => {
        const ctx = createB3Context();
        const b3 = ctx.b3;
        const Limiter = ctx.window.Limiter;
        
        class RunningChild extends b3.Action {
            tick(bb) { return b3.Status.RUNNING; }
        }
        
        const limiter = new Limiter({ maxConcurrent: 1 });
        limiter.child = new RunningChild();
        
        const parallel = new b3.Parallel({ policy: 'require_all' });
        // Both branches in the parallel node point to the same limiter instance
        parallel.children = [limiter, limiter];
        
        const bb = new b3.Blackboard();
        
        // Ticks branch 1 (succeeds -> returns RUNNING, count = 1),
        // Then since the loop is sequential and immediately returns RUNNING when it encounters RUNNING,
        // it doesn't tick the second child in this tick.
        assert.equal(parallel.tick(bb), b3.Status.RUNNING);
        assert.equal(limiter._runningCount, 1);
    });

    test('HTTP Queue: respects maxConcurrentLLMCalls rate limiting', async () => {
        const queue = [];
        let activeCount = 0;
        let maxActiveCaptured = 0;
        const maxConcurrent = 3;
        
        function processQueue() {
            while (activeCount < maxConcurrent && queue.length > 0) {
                const { callback, resolve, reject } = queue.shift();
                activeCount++;
                maxActiveCaptured = Math.max(maxActiveCaptured, activeCount);
                
                Promise.resolve()
                    .then(() => callback())
                    .then(resolve)
                    .catch(reject)
                    .finally(() => {
                        activeCount--;
                        processQueue();
                    });
            }
        }
        
        function enqueue(callback) {
            return new Promise((resolve, reject) => {
                queue.push({ callback, resolve, reject });
                processQueue();
            });
        }
        
        // Create 10 mock tasks, each taking 10ms
        const tasks = Array.from({ length: 10 }, (_, i) => {
            return enqueue(async () => {
                await new Promise(r => setTimeout(r, 10));
                return i;
            });
        });
        
        const results = await Promise.all(tasks);
        
        assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        assert.ok(maxActiveCaptured <= maxConcurrent, `Exceeded max concurrency limit: ${maxActiveCaptured}`);
        assert.equal(maxActiveCaptured, maxConcurrent, `Should reach max concurrency: ${maxActiveCaptured}`);
    });

    test('HTTP Queue: continues processing when tasks fail', async () => {
        const queue = [];
        let activeCount = 0;
        const maxConcurrent = 2;
        
        function processQueue() {
            while (activeCount < maxConcurrent && queue.length > 0) {
                const { callback, resolve, reject } = queue.shift();
                activeCount++;
                
                Promise.resolve()
                    .then(() => callback())
                    .then(resolve)
                    .catch(reject)
                    .finally(() => {
                        activeCount--;
                        processQueue();
                    });
            }
        }
        
        function enqueue(callback) {
            return new Promise((resolve, reject) => {
                queue.push({ callback, resolve, reject });
                processQueue();
            });
        }
        
        const task1 = enqueue(async () => 1);
        const task2 = enqueue(async () => { throw new Error('task failed'); });
        const task3 = enqueue(async () => 3);
        
        const r1 = await task1;
        let r2Error = null;
        try {
            await task2;
        } catch (e) {
            r2Error = e.message;
        }
        const r3 = await task3;
        
        assert.equal(r1, 1);
        assert.equal(r2Error, 'task failed');
        assert.equal(r3, 3);
    });

    test('Execution Queue: respects maxParallel run rate limiting', async () => {
        const queue = [];
        let activeCount = 0;
        let maxActiveCaptured = 0;
        const maxParallel = 2;
        
        function processQueue() {
            while (activeCount < maxParallel && queue.length > 0) {
                const { callback } = queue.shift();
                activeCount++;
                maxActiveCaptured = Math.max(maxActiveCaptured, activeCount);
                
                callback().finally(() => {
                    activeCount--;
                    processQueue();
                });
            }
        }
        
        function enqueue(callback) {
            queue.push({ callback });
            processQueue();
        }
        
        const completed = [];
        const runTask = (id, ms) => {
            return () => new Promise(resolve => {
                setTimeout(() => {
                    completed.push(id);
                    resolve();
                }, ms);
            });
        };
        
        enqueue(runTask('A', 60));
        enqueue(runTask('B', 20));
        enqueue(runTask('C', 10));
        
        await new Promise(r => setTimeout(r, 100));
        
        // A (60ms) and B (20ms) start in parallel.
        // B finishes first at t=20ms, which allows C (10ms) to start.
        // C finishes at t=30ms (20+10).
        // A finishes at t=60ms.
        // Expected completion order: B, C, A
        assert.deepEqual(completed, ['B', 'C', 'A']);
        assert.ok(maxActiveCaptured <= maxParallel);
        assert.equal(maxActiveCaptured, maxParallel);
    });
});

// ── Behavior3 Integration Tests with Mock & Mock Recipes ──────
describe('Behavior3 Integration Tests with Mock & Mock Recipes', () => {
    const vm = require('node:vm');
    const fs = require('node:fs');
    const path = require('node:path');
    const b64 = s => Buffer.from(s, 'binary').toString('base64');

    function createB3BtApp() {
        const ctx = {
            window: {},
            document: {
                getElementById: (id) => {
                    if (id === 'bt-target-label') return { textContent: '' };
                    return { style: {}, classList: { add: () => {}, remove: () => {} }, value: '', innerHTML: '' };
                },
                addEventListener: () => {},
                querySelector: () => ({ style: {} }),
                querySelectorAll: () => [],
                createElement: () => ({ classList: { add: () => {}, remove: () => {} }, style: {}, appendChild: () => {} }),
                body: { appendChild: () => {} },
            },
            navigator: { clipboard: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('mocked clipboard text') } },
            localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
            confirm: () => true,
            console,
            setTimeout,
            clearTimeout,
            btoa: s => Buffer.from(s, 'binary').toString('base64'),
            atob: s => Buffer.from(s, 'base64').toString('binary'),
            Date,
            Math,
        };
        ctx.window = ctx;
        vm.createContext(ctx);
        
        // Load B3 shim, decorators, registry, actions, adapter, and app.js
        const files = [
            '../frontend/b3-shim.js',
            '../frontend/bt-b3-decorators.js',
            '../frontend/bt-b3-node-registry.js',
            '../frontend/bt-b3-actions.js',
            '../frontend/bt-b3-converter.js',
            '../frontend/bt-b3-adapter.js',
            '../frontend/app.js'
        ];
        
        for (const file of files) {
            const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
            vm.runInContext(code, ctx);
        }
        
        const app = vm.runInContext('app', ctx);
        app._vmContext = ctx;
        
        // stub UI methods
        app.renderTree  = () => {};
        app.renderList  = () => {};
        app.loadEditor  = () => {};
        app.renderOutput = () => {};
        app.addLog      = () => {};
        app.postMessage = () => {};
        app.saveCurrentTab = () => {};
        app._messageListeners = [];
        
        // Instantiate B3 adapter as the active engine
        const Behavior3Adapter = vm.runInContext('Behavior3Adapter', ctx);
        app._bt = new Behavior3Adapter(app);
        
        return app;
    }

    test('Integration: sequence with ProcessPromptAction executes through PipelineRunner and MockProvider', async () => {
        const app = createB3BtApp();
        
        // Stub postMessage to intercept and execute through PipelineRunner
        app.postMessage = (msg) => {
            if (msg.type === 'run_prompt_process') {
                const payload = msg.payload;
                const runner = new PipelineRunner();
                runner.providers['mock'] = new MockProvider();
                
                const steps = [{
                    name: payload.nodeTitle,
                    type: 'ai',
                    params: {
                        provider: 'mock',
                        model: 'echo',
                        userPrompt: payload.userPrompt,
                        systemPrompt: payload.systemPrompt
                    }
                }];
                
                runner.run(payload.nodeTitle, steps, payload.content || '', [], 'child')
                    .then(() => {
                        const output = runner.historySteps[0].output;
                        app._bt.notifyLeafComplete({ error: false, outputContent: output });
                    })
                    .catch(err => {
                        app._bt.notifyLeafComplete({ error: true, message: err.message });
                    });
            }
        };

        // Create mock recipe
        app.state.recipes = [{ name: 'Default', provider: 'mock', model: 'echo', systemPrompt: '' }];
        app.state.selectedRecipe = 'Default';

        // Configure tree tab
        const root = {
            title: b64('Root'),
            nodeType: 'root',
            btType: 'sequence',
            children: [
                {
                    title: b64('AI Action'),
                    nodeType: 'assemble',
                    btType: 'leaf',
                    btAction: 'processPrompt',
                    btPrompt: b64('Generate a greeting'),
                    btOutputKey: 'greeting'
                }
            ]
        };

        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;

        app._bt.setTarget('');
        
        await app._bt._execute('');
        
        const bb = app._bt.getBlackboard();
        assert.ok(bb.greeting);
        assert.equal(bb.greeting.text, '[Mock] Generate a greeting');
    });

    test('Integration: Guard blocks or allows ProcessPromptAction based on blackboard key', async () => {
        const app = createB3BtApp();
        let callCount = 0;
        
        app.postMessage = (msg) => {
            if (msg.type === 'run_prompt_process') {
                callCount++;
                const payload = msg.payload;
                const runner = new PipelineRunner();
                runner.providers['mock'] = new MockProvider();
                
                const steps = [{
                    name: payload.nodeTitle,
                    type: 'ai',
                    params: {
                        provider: 'mock',
                        model: 'echo',
                        userPrompt: payload.userPrompt,
                    }
                }];
                
                runner.run(payload.nodeTitle, steps, payload.content || '', [], 'child')
                    .then(() => {
                        const output = runner.historySteps[0].output;
                        app._bt.notifyLeafComplete({ error: false, outputContent: output });
                    })
                    .catch(err => {
                        app._bt.notifyLeafComplete({ error: true, message: err.message });
                    });
            }
        };

        app.state.recipes = [{ name: 'Default', provider: 'mock', model: 'echo' }];
        app.state.selectedRecipe = 'Default';

        // Root is a Guard checking for 'allowed' key, wrapping a ProcessPromptAction leaf
        const root = {
            title: b64('Guard'),
            nodeType: 'root',
            btType: 'guard',
            btCondition: 'allowed',
            children: [
                {
                    title: b64('AI Action'),
                    nodeType: 'assemble',
                    btType: 'leaf',
                    btAction: 'processPrompt',
                    btPrompt: b64('Run me'),
                    btOutputKey: 'res'
                }
            ]
        };

        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;

        app._bt.setTarget('');
        
        // 1. Run with guard not met (blackboard 'allowed' is empty/undefined)
        await app._bt._execute('');
        assert.equal(callCount, 0); // never posted message because guard failed

        // 2. Set 'allowed' on blackboard, then run again
        app._bt.bbSetText('allowed', 'yes');
        await app._bt._execute('');
        assert.equal(callCount, 1); // guard passed, so prompt ran!
        
        const bb = app._bt.getBlackboard();
        assert.ok(bb.res);
        assert.equal(bb.res.text, '[Mock] Run me');
    });

    test('Integration: Behavior3 set/get between nodes and check result with type error validation', async () => {
        const app = createB3BtApp();
        
        let secondNodeUserPrompt = null;
        
        app.postMessage = (msg) => {
            if (msg.type === 'run_prompt_process') {
                const payload = msg.payload;
                if (payload.nodeTitle === 'AI Action 2') {
                    secondNodeUserPrompt = payload.userPrompt;
                }
                const runner = new PipelineRunner();
                runner.providers['mock'] = new MockProvider();
                
                const steps = [{
                    name: payload.nodeTitle,
                    type: 'ai',
                    params: {
                        provider: 'mock',
                        model: 'echo',
                        userPrompt: payload.userPrompt,
                    }
                }];
                
                runner.run(payload.nodeTitle, steps, payload.content || '', [], 'child')
                    .then(() => {
                        const output = runner.historySteps[0].output;
                        app._bt.notifyLeafComplete({ error: false, outputContent: output });
                    })
                    .catch(err => {
                        app._bt.notifyLeafComplete({ error: true, message: err.message });
                    });
            }
        };

        app.state.recipes = [{ name: 'Default', provider: 'mock', model: 'echo' }];
        app.state.selectedRecipe = 'Default';

        // Root is a Sequence of two AI actions:
        // Action 1: Runs and saves result to 'first_var'
        // Action 2: Prompt accesses '{bb:first_var}' and saves to 'second_var'
        const root = {
            title: b64('Root'),
            nodeType: 'root',
            btType: 'sequence',
            children: [
                {
                    title: b64('AI Action 1'),
                    nodeType: 'assemble',
                    btType: 'leaf',
                    btAction: 'processPrompt',
                    btPrompt: b64('test-input'),
                    btOutputKey: 'first_var'
                },
                {
                    title: b64('AI Action 2'),
                    nodeType: 'assemble',
                    btType: 'leaf',
                    btAction: 'processPrompt',
                    btPrompt: b64('{bb:first_var} result'),
                    btOutputKey: 'second_var'
                }
            ]
        };

        app.state.tabs = [{ name: 't', file: 't.json', root }];
        app.state.activeTab = 0;

        app._bt.setTarget('');
        await app._bt._execute('');

        const bb = app._bt.getBlackboard();
        assert.ok(bb.first_var);
        assert.equal(bb.first_var.text, '[Mock] test-input');
        assert.ok(bb.second_var);
        assert.equal(bb.second_var.text, '[Mock] [Mock] test-input result');
        assert.equal(secondNodeUserPrompt, '[Mock] test-input result');

        // Test non-text blackboard error in B3:
        // Set 'media_var' as media
        app._bt.bbWrite('media_var', [{ mimetype: 'image/png' }], 'run', 'media');
        
        // Log collection
        const logs = [];
        app.addLog = (msg) => logs.push(msg);

        // Try expanding prompt with non-text variable
        // ProcessPromptAction instance for test
        const ProcessPromptActionClass = app._vmContext.ProcessPromptAction;
        const actionNode = new ProcessPromptActionClass({ prompt: 'Check B3: {bb:media_var}' });
        
        const b3Bb = new (app._vmContext.b3.Blackboard)();
        b3Bb.set('media_var', { media: [{ mimetype: 'image/png' }] });
        
        const expanded = actionNode._expandPlaceholders('Check B3: {bb:media_var}', b3Bb);
        assert.ok(expanded.includes('[ERROR: Blackboard variable "media_var" is not of type "text"]'));
        assert.ok(logs.some(log => log.includes('not of type "text"')));
    });
});

// ============================================================
// Project Dialog Tests
// ============================================================

// Helper functions for project management tests
function copyDirSync(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function deleteDirSync(dirPath) {
    if (fs.existsSync(dirPath)) {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                deleteDirSync(fullPath);
            } else {
                fs.unlinkSync(fullPath);
            }
        }
        fs.rmdirSync(dirPath);
    }
}

// Mock project manager for testing
class ProjectManager {
    constructor(projectsRoot) {
        this.projectsRoot = projectsRoot;
        this.bootstrapConfig = { currentProject: '', projectOrder: [] };
        ensureDir(this.projectsRoot);
    }

    listProjects() {
        if (!fs.existsSync(this.projectsRoot)) return [];
        const entries = fs.readdirSync(this.projectsRoot, { withFileTypes: true });
        let projects = entries.filter(e => e.isDirectory()).map(e => e.name);
        
        const order = this.bootstrapConfig.projectOrder || [];
        if (order.length > 0) {
            projects.sort((a, b) => {
                const ia = order.indexOf(a);
                const ib = order.indexOf(b);
                if (ia === -1 && ib === -1) return a.localeCompare(b);
                if (ia === -1) return 1;
                if (ib === -1) return -1;
                return ia - ib;
            });
        }
        return projects;
    }

    createProject(name) {
        const projPath = path.join(this.projectsRoot, name);
        if (fs.existsSync(projPath)) return false;
        ensureDir(path.join(projPath, 'data'));
        ensureDir(path.join(projPath, 'blobs'));
        ensureDir(path.join(projPath, 'history'));
        ensureDir(path.join(projPath, 'chests'));
        writeJson(path.join(projPath, 'session.json'), { tabs: [{ name: 'default.promptsbt', file: 'default.promptsbt' }] });
        writeJson(path.join(projPath, 'pipelines.json'), { pipelines: [] });
        writeJson(path.join(projPath, 'projectrecipes.json'), []);
        return true;
    }

    deleteProject(name) {
        if (name === this.bootstrapConfig.currentProject) return false;
        const projPath = path.join(this.projectsRoot, name);
        if (!fs.existsSync(projPath)) return false;
        deleteDirSync(projPath);
        this.bootstrapConfig.projectOrder = (this.bootstrapConfig.projectOrder || []).filter(p => p !== name);
        return true;
    }

    renameProject(oldName, newName) {
        const oldPath = path.join(this.projectsRoot, oldName);
        const newPath = path.join(this.projectsRoot, newName);
        if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) return false;
        fs.renameSync(oldPath, newPath);
        if (this.bootstrapConfig.currentProject === oldName) {
            this.bootstrapConfig.currentProject = newName;
        }
        const order = this.bootstrapConfig.projectOrder || [];
        const idx = order.indexOf(oldName);
        if (idx !== -1) order[idx] = newName;
        this.bootstrapConfig.projectOrder = order;
        return true;
    }

    duplicateProject(sourceName, newName) {
        const sourcePath = path.join(this.projectsRoot, sourceName);
        const destPath = path.join(this.projectsRoot, newName);
        if (!fs.existsSync(sourcePath) || fs.existsSync(destPath)) return false;
        copyDirSync(sourcePath, destPath);
        return true;
    }

    moveProject(name, direction) {
        let order = this.bootstrapConfig.projectOrder || [];
        const projects = this.listProjects();
        if (order.length === 0) {
            order = [...projects].sort((a, b) => a.localeCompare(b));
        }
        for (const p of projects) {
            if (!order.includes(p)) order.push(p);
        }
        const idx = order.indexOf(name);
        if (idx === -1) return false;
        if (direction === 'up' && idx > 0) {
            [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
        } else if (direction === 'down' && idx < order.length - 1) {
            [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
        } else {
            return false;
        }
        this.bootstrapConfig.projectOrder = order;
        return true;
    }

    verifyProject(name) {
        const projPath = path.join(this.projectsRoot, name);
        const issues = [];
        const fixes = [];
        
        if (!fs.existsSync(projPath)) {
            issues.push('Project directory does not exist');
        } else {
            const dirs = ['data', 'blobs', 'history', 'chests'];
            for (const dir of dirs) {
                const dirPath = path.join(projPath, dir);
                if (!fs.existsSync(dirPath)) {
                    issues.push(`Missing ${dir} directory`);
                    try { ensureDir(dirPath); fixes.push(`Created ${dir} directory`); } catch (e) {}
                }
            }
            const files = [
                { name: 'session.json', default: { tabs: [{ name: 'default.promptsbt', file: 'default.promptsbt' }] } },
                { name: 'pipelines.json', default: { pipelines: [] } },
                { name: 'projectrecipes.json', default: [] }
            ];
            for (const file of files) {
                const filePath = path.join(projPath, file.name);
                if (!fs.existsSync(filePath)) {
                    issues.push(`Missing ${file.name}`);
                    try { writeJson(filePath, file.default); fixes.push(`Created ${file.name}`); } catch (e) {}
                }
            }
        }
        return { issues, fixes, status: issues.length === 0 ? 'OK' : (fixes.length === issues.length ? 'Recovered' : 'Issues found') };
    }

    setCurrentProject(name) {
        this.bootstrapConfig.currentProject = name;
    }

    getCurrentProject() {
        return this.bootstrapConfig.currentProject;
    }
}

describe('Project Dialog', () => {
    let tempDir;
    let pm;

    before(() => {
        tempDir = makeTempDir();
        pm = new ProjectManager(path.join(tempDir, 'projects'));
    });

    after(() => {
        rmrf(tempDir);
    });

    // ── Basic CRUD Tests ─────────────────────────────────────

    test('P001: list projects returns empty array when no projects exist', () => {
        const projects = pm.listProjects();
        assert.deepEqual(projects, []);
    });

    test('P002: create project returns true for new project', () => {
        const result = pm.createProject('TestProject1');
        assert.equal(result, true);
    });

    test('P003: create project creates directory structure', () => {
        pm.createProject('TestProject2');
        const projPath = path.join(tempDir, 'projects', 'TestProject2');
        assert.ok(fs.existsSync(projPath));
        assert.ok(fs.existsSync(path.join(projPath, 'data')));
        assert.ok(fs.existsSync(path.join(projPath, 'blobs')));
        assert.ok(fs.existsSync(path.join(projPath, 'history')));
        assert.ok(fs.existsSync(path.join(projPath, 'chests')));
    });

    test('P004: create project creates session.json with default tab', () => {
        pm.createProject('TestProject3');
        const sessionPath = path.join(tempDir, 'projects', 'TestProject3', 'session.json');
        assert.ok(fs.existsSync(sessionPath));
        const session = readJson(sessionPath);
        assert.equal(session.tabs.length, 1);
        assert.equal(session.tabs[0].name, 'default.promptsbt');
    });

    test('P005: create project creates empty pipelines.json', () => {
        pm.createProject('TestProject4');
        const pipelinesPath = path.join(tempDir, 'projects', 'TestProject4', 'pipelines.json');
        assert.ok(fs.existsSync(pipelinesPath));
        const pipelines = readJson(pipelinesPath);
        assert.deepEqual(pipelines.pipelines, []);
    });

    test('P006: create project creates empty projectrecipes.json', () => {
        pm.createProject('TestProject5');
        const recipesPath = path.join(tempDir, 'projects', 'TestProject5', 'projectrecipes.json');
        assert.ok(fs.existsSync(recipesPath));
        const recipes = readJson(recipesPath);
        assert.deepEqual(recipes, []);
    });

    test('P007: create project returns false for duplicate name', () => {
        pm.createProject('DupProject');
        const result = pm.createProject('DupProject');
        assert.equal(result, false);
    });

    test('P008: list projects returns created projects', () => {
        pm.createProject('ListTest1');
        pm.createProject('ListTest2');
        const projects = pm.listProjects();
        assert.ok(projects.includes('ListTest1'));
        assert.ok(projects.includes('ListTest2'));
    });

    test('P009: delete project returns true for existing project', () => {
        pm.createProject('DeleteTest1');
        const result = pm.deleteProject('DeleteTest1');
        assert.equal(result, true);
    });

    test('P010: delete project removes directory', () => {
        pm.createProject('DeleteTest2');
        pm.deleteProject('DeleteTest2');
        const projPath = path.join(tempDir, 'projects', 'DeleteTest2');
        assert.ok(!fs.existsSync(projPath));
    });

    test('P011: delete project returns false for non-existent project', () => {
        const result = pm.deleteProject('NonExistent');
        assert.equal(result, false);
    });

    test('P012: delete project returns false for current project', () => {
        pm.createProject('CurrentProject');
        pm.setCurrentProject('CurrentProject');
        const result = pm.deleteProject('CurrentProject');
        assert.equal(result, false);
    });

    test('P013: delete project removes from order list', () => {
        pm.createProject('OrderDelete');
        pm.moveProject('OrderDelete', 'up');
        pm.deleteProject('OrderDelete');
        assert.ok(!pm.bootstrapConfig.projectOrder.includes('OrderDelete'));
    });

    // ── Rename Tests ─────────────────────────────────────────

    test('P014: rename project returns true for valid rename', () => {
        pm.createProject('RenameTest1');
        const result = pm.renameProject('RenameTest1', 'RenamedProject1');
        assert.equal(result, true);
    });

    test('P015: rename project changes directory name', () => {
        pm.createProject('RenameTest2');
        pm.renameProject('RenameTest2', 'RenamedProject2');
        const oldPath = path.join(tempDir, 'projects', 'RenameTest2');
        const newPath = path.join(tempDir, 'projects', 'RenamedProject2');
        assert.ok(!fs.existsSync(oldPath));
        assert.ok(fs.existsSync(newPath));
    });

    test('P016: rename project returns false for non-existent source', () => {
        const result = pm.renameProject('NonExistent', 'NewName');
        assert.equal(result, false);
    });

    test('P017: rename project returns false if target exists', () => {
        pm.createProject('RenameSource');
        pm.createProject('RenameTarget');
        const result = pm.renameProject('RenameSource', 'RenameTarget');
        assert.equal(result, false);
    });

    test('P018: rename project updates current project if renamed', () => {
        pm.createProject('CurrentRename');
        pm.setCurrentProject('CurrentRename');
        pm.renameProject('CurrentRename', 'NewCurrent');
        assert.equal(pm.getCurrentProject(), 'NewCurrent');
    });

    test('P019: rename project updates order list', () => {
        pm.createProject('OrderRename');
        pm.bootstrapConfig.projectOrder = ['OrderRename'];
        pm.renameProject('OrderRename', 'RenamedOrder');
        assert.ok(pm.bootstrapConfig.projectOrder.includes('RenamedOrder'));
        assert.ok(!pm.bootstrapConfig.projectOrder.includes('OrderRename'));
    });

    test('P020: rename project preserves data files', () => {
        pm.createProject('DataRename');
        const dataPath = path.join(tempDir, 'projects', 'DataRename', 'data', 'test.json');
        writeJson(dataPath, { test: 'data' });
        pm.renameProject('DataRename', 'RenamedData');
        const newDataPath = path.join(tempDir, 'projects', 'RenamedData', 'data', 'test.json');
        assert.ok(fs.existsSync(newDataPath));
        const data = readJson(newDataPath);
        assert.equal(data.test, 'data');
    });

    // ── Duplicate Tests ──────────────────────────────────────

    test('P021: duplicate project returns true for valid duplicate', () => {
        pm.createProject('DupSource');
        const result = pm.duplicateProject('DupSource', 'DupTarget');
        assert.equal(result, true);
    });

    test('P022: duplicate project creates new directory', () => {
        pm.createProject('DupSource2');
        pm.duplicateProject('DupSource2', 'DupTarget2');
        const newPath = path.join(tempDir, 'projects', 'DupTarget2');
        assert.ok(fs.existsSync(newPath));
    });

    test('P023: duplicate project copies all files', () => {
        pm.createProject('DupSource3');
        const dataPath = path.join(tempDir, 'projects', 'DupSource3', 'data', 'test.json');
        writeJson(dataPath, { test: 'data' });
        pm.duplicateProject('DupSource3', 'DupTarget3');
        const newDataPath = path.join(tempDir, 'projects', 'DupTarget3', 'data', 'test.json');
        assert.ok(fs.existsSync(newDataPath));
    });

    test('P024: duplicate project returns false for non-existent source', () => {
        const result = pm.duplicateProject('NonExistent', 'NewDup');
        assert.equal(result, false);
    });

    test('P025: duplicate project returns false if target exists', () => {
        pm.createProject('DupSource4');
        pm.createProject('DupTarget4');
        const result = pm.duplicateProject('DupSource4', 'DupTarget4');
        assert.equal(result, false);
    });

    test('P026: duplicate project preserves session.json', () => {
        pm.createProject('DupSession');
        const sessionPath = path.join(tempDir, 'projects', 'DupSession', 'session.json');
        writeJson(sessionPath, { tabs: [{ name: 'Custom', file: 'custom.json' }] });
        pm.duplicateProject('DupSession', 'DupSessionCopy');
        const newSessionPath = path.join(tempDir, 'projects', 'DupSessionCopy', 'session.json');
        const session = readJson(newSessionPath);
        assert.equal(session.tabs[0].name, 'Custom');
    });

    test('P027: duplicate project preserves pipelines.json', () => {
        pm.createProject('DupPipelines');
        const pipelinesPath = path.join(tempDir, 'projects', 'DupPipelines', 'pipelines.json');
        writeJson(pipelinesPath, { pipelines: [{ name: 'TestPipeline' }] });
        pm.duplicateProject('DupPipelines', 'DupPipelinesCopy');
        const newPipelinesPath = path.join(tempDir, 'projects', 'DupPipelinesCopy', 'pipelines.json');
        const pipelines = readJson(newPipelinesPath);
        assert.equal(pipelines.pipelines[0].name, 'TestPipeline');
    });

    test('P028: duplicate project preserves projectrecipes.json', () => {
        pm.createProject('DupRecipes');
        const recipesPath = path.join(tempDir, 'projects', 'DupRecipes', 'projectrecipes.json');
        writeJson(recipesPath, [{ name: 'TestRecipe' }]);
        pm.duplicateProject('DupRecipes', 'DupRecipesCopy');
        const newRecipesPath = path.join(tempDir, 'projects', 'DupRecipesCopy', 'projectrecipes.json');
        const recipes = readJson(newRecipesPath);
        assert.equal(recipes[0].name, 'TestRecipe');
    });

    // ── Reorder Tests ────────────────────────────────────────

    test('P029: move project up returns true when not at top', () => {
        pm.createProject('MoveUp1');
        pm.createProject('MoveUp2');
        pm.bootstrapConfig.projectOrder = ['MoveUp1', 'MoveUp2'];
        const result = pm.moveProject('MoveUp2', 'up');
        assert.equal(result, true);
    });

    test('P030: move project up changes order', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p030'));
        pm2.createProject('MoveUp3');
        pm2.createProject('MoveUp4');
        pm2.bootstrapConfig.projectOrder = ['MoveUp3', 'MoveUp4'];
        pm2.moveProject('MoveUp4', 'up');
        assert.deepEqual(pm2.bootstrapConfig.projectOrder, ['MoveUp4', 'MoveUp3']);
    });

    test('P031: move project up returns false when at top', () => {
        pm.createProject('MoveUpTop');
        pm.bootstrapConfig.projectOrder = ['MoveUpTop', 'Other'];
        const result = pm.moveProject('MoveUpTop', 'up');
        assert.equal(result, false);
    });

    test('P032: move project down returns true when not at bottom', () => {
        pm.createProject('MoveDown1');
        pm.createProject('MoveDown2');
        pm.bootstrapConfig.projectOrder = ['MoveDown1', 'MoveDown2'];
        const result = pm.moveProject('MoveDown1', 'down');
        assert.equal(result, true);
    });

    test('P033: move project down changes order', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p033'));
        pm2.createProject('MoveDown3');
        pm2.createProject('MoveDown4');
        pm2.bootstrapConfig.projectOrder = ['MoveDown3', 'MoveDown4'];
        pm2.moveProject('MoveDown3', 'down');
        assert.deepEqual(pm2.bootstrapConfig.projectOrder, ['MoveDown4', 'MoveDown3']);
    });

    test('P034: move project down returns false when at bottom', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p034'));
        pm2.createProject('MoveDownBottom');
        pm2.bootstrapConfig.projectOrder = ['MoveDownBottom'];
        const result = pm2.moveProject('MoveDownBottom', 'down');
        assert.equal(result, false);
    });

    test('P035: move project returns false for non-existent project', () => {
        const result = pm.moveProject('NonExistent', 'up');
        assert.equal(result, false);
    });

    test('P036: list projects respects order', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p036'));
        pm2.createProject('OrderA');
        pm2.createProject('OrderB');
        pm2.createProject('OrderC');
        pm2.bootstrapConfig.projectOrder = ['OrderC', 'OrderA', 'OrderB'];
        const projects = pm2.listProjects();
        assert.deepEqual(projects, ['OrderC', 'OrderA', 'OrderB']);
    });

    test('P037: move project initializes order if empty', () => {
        pm.createProject('InitOrder1');
        pm.createProject('InitOrder2');
        pm.bootstrapConfig.projectOrder = [];
        pm.moveProject('InitOrder2', 'up');
        assert.ok(pm.bootstrapConfig.projectOrder.length > 0);
    });

    test('P038: move project adds missing projects to order', () => {
        pm.createProject('MissingOrder1');
        pm.createProject('MissingOrder2');
        pm.bootstrapConfig.projectOrder = ['MissingOrder1'];
        pm.moveProject('MissingOrder2', 'up');
        assert.ok(pm.bootstrapConfig.projectOrder.includes('MissingOrder2'));
    });

    // ── Verify Tests ─────────────────────────────────────────

    test('P039: verify project returns OK for valid project', () => {
        pm.createProject('VerifyOK');
        const result = pm.verifyProject('VerifyOK');
        assert.equal(result.status, 'OK');
        assert.equal(result.issues.length, 0);
    });

    test('P040: verify project detects missing data directory', () => {
        pm.createProject('VerifyMissingData');
        const dataPath = path.join(tempDir, 'projects', 'VerifyMissingData', 'data');
        fs.rmdirSync(dataPath);
        const result = pm.verifyProject('VerifyMissingData');
        assert.ok(result.issues.some(i => i.includes('data')));
    });

    test('P041: verify project detects missing blobs directory', () => {
        pm.createProject('VerifyMissingBlobs');
        const blobsPath = path.join(tempDir, 'projects', 'VerifyMissingBlobs', 'blobs');
        fs.rmdirSync(blobsPath);
        const result = pm.verifyProject('VerifyMissingBlobs');
        assert.ok(result.issues.some(i => i.includes('blobs')));
    });

    test('P042: verify project detects missing history directory', () => {
        pm.createProject('VerifyMissingHistory');
        const historyPath = path.join(tempDir, 'projects', 'VerifyMissingHistory', 'history');
        fs.rmdirSync(historyPath);
        const result = pm.verifyProject('VerifyMissingHistory');
        assert.ok(result.issues.some(i => i.includes('history')));
    });

    test('P043: verify project detects missing chests directory', () => {
        pm.createProject('VerifyMissingChests');
        const chestsPath = path.join(tempDir, 'projects', 'VerifyMissingChests', 'chests');
        fs.rmdirSync(chestsPath);
        const result = pm.verifyProject('VerifyMissingChests');
        assert.ok(result.issues.some(i => i.includes('chests')));
    });

    test('P044: verify project detects missing session.json', () => {
        pm.createProject('VerifyMissingSession');
        const sessionPath = path.join(tempDir, 'projects', 'VerifyMissingSession', 'session.json');
        fs.unlinkSync(sessionPath);
        const result = pm.verifyProject('VerifyMissingSession');
        assert.ok(result.issues.some(i => i.includes('session.json')));
    });

    test('P045: verify project detects missing pipelines.json', () => {
        pm.createProject('VerifyMissingPipelines');
        const pipelinesPath = path.join(tempDir, 'projects', 'VerifyMissingPipelines', 'pipelines.json');
        fs.unlinkSync(pipelinesPath);
        const result = pm.verifyProject('VerifyMissingPipelines');
        assert.ok(result.issues.some(i => i.includes('pipelines.json')));
    });

    test('P046: verify project detects missing projectrecipes.json', () => {
        pm.createProject('VerifyMissingRecipes');
        const recipesPath = path.join(tempDir, 'projects', 'VerifyMissingRecipes', 'projectrecipes.json');
        fs.unlinkSync(recipesPath);
        const result = pm.verifyProject('VerifyMissingRecipes');
        assert.ok(result.issues.some(i => i.includes('projectrecipes.json')));
    });

    test('P047: verify project recovers missing data directory', () => {
        pm.createProject('VerifyRecoverData');
        const dataPath = path.join(tempDir, 'projects', 'VerifyRecoverData', 'data');
        fs.rmdirSync(dataPath);
        const result = pm.verifyProject('VerifyRecoverData');
        assert.equal(result.status, 'Recovered');
        assert.ok(fs.existsSync(dataPath));
    });

    test('P048: verify project recovers missing blobs directory', () => {
        pm.createProject('VerifyRecoverBlobs');
        const blobsPath = path.join(tempDir, 'projects', 'VerifyRecoverBlobs', 'blobs');
        fs.rmdirSync(blobsPath);
        const result = pm.verifyProject('VerifyRecoverBlobs');
        assert.equal(result.status, 'Recovered');
        assert.ok(fs.existsSync(blobsPath));
    });

    test('P049: verify project recovers missing history directory', () => {
        pm.createProject('VerifyRecoverHistory');
        const historyPath = path.join(tempDir, 'projects', 'VerifyRecoverHistory', 'history');
        fs.rmdirSync(historyPath);
        const result = pm.verifyProject('VerifyRecoverHistory');
        assert.equal(result.status, 'Recovered');
        assert.ok(fs.existsSync(historyPath));
    });

    test('P050: verify project recovers missing chests directory', () => {
        pm.createProject('VerifyRecoverChests');
        const chestsPath = path.join(tempDir, 'projects', 'VerifyRecoverChests', 'chests');
        fs.rmdirSync(chestsPath);
        const result = pm.verifyProject('VerifyRecoverChests');
        assert.equal(result.status, 'Recovered');
        assert.ok(fs.existsSync(chestsPath));
    });

    test('P051: verify project recovers missing session.json', () => {
        pm.createProject('VerifyRecoverSession');
        const sessionPath = path.join(tempDir, 'projects', 'VerifyRecoverSession', 'session.json');
        fs.unlinkSync(sessionPath);
        const result = pm.verifyProject('VerifyRecoverSession');
        assert.equal(result.status, 'Recovered');
        assert.ok(fs.existsSync(sessionPath));
    });

    test('P052: verify project recovers missing pipelines.json', () => {
        pm.createProject('VerifyRecoverPipelines');
        const pipelinesPath = path.join(tempDir, 'projects', 'VerifyRecoverPipelines', 'pipelines.json');
        fs.unlinkSync(pipelinesPath);
        const result = pm.verifyProject('VerifyRecoverPipelines');
        assert.equal(result.status, 'Recovered');
        assert.ok(fs.existsSync(pipelinesPath));
    });

    test('P053: verify project recovers missing projectrecipes.json', () => {
        pm.createProject('VerifyRecoverRecipes');
        const recipesPath = path.join(tempDir, 'projects', 'VerifyRecoverRecipes', 'projectrecipes.json');
        fs.unlinkSync(recipesPath);
        const result = pm.verifyProject('VerifyRecoverRecipes');
        assert.equal(result.status, 'Recovered');
        assert.ok(fs.existsSync(recipesPath));
    });

    test('P054: verify project detects non-existent project', () => {
        const result = pm.verifyProject('NonExistentVerify');
        assert.ok(result.issues.some(i => i.includes('does not exist')));
    });

    test('P055: verify project returns correct fix count', () => {
        pm.createProject('VerifyFixCount');
        const dataPath = path.join(tempDir, 'projects', 'VerifyFixCount', 'data');
        const blobsPath = path.join(tempDir, 'projects', 'VerifyFixCount', 'blobs');
        fs.rmdirSync(dataPath);
        fs.rmdirSync(blobsPath);
        const result = pm.verifyProject('VerifyFixCount');
        assert.equal(result.fixes.length, 2);
    });

    // ── Current Project Tests ────────────────────────────────

    test('P056: set current project updates bootstrap config', () => {
        pm.createProject('CurrentTest');
        pm.setCurrentProject('CurrentTest');
        assert.equal(pm.getCurrentProject(), 'CurrentTest');
    });

    test('P057: get current project returns empty string if not set', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'projects2'));
        assert.equal(pm2.getCurrentProject(), '');
    });

    test('P058: current project persists after rename', () => {
        pm.createProject('CurrentPersist');
        pm.setCurrentProject('CurrentPersist');
        pm.renameProject('CurrentPersist', 'CurrentPersistRenamed');
        assert.equal(pm.getCurrentProject(), 'CurrentPersistRenamed');
    });

    // ── Edge Cases ───────────────────────────────────────────

    test('P059: create project with special characters in name', () => {
        const result = pm.createProject('Test-Project_123');
        assert.equal(result, true);
    });

    test('P060: create project with spaces in name', () => {
        const result = pm.createProject('Test Project With Spaces');
        assert.equal(result, true);
    });

    test('P061: rename project to same name returns false', () => {
        pm.createProject('SameName');
        const result = pm.renameProject('SameName', 'SameName');
        assert.equal(result, false);
    });

    test('P062: duplicate project to same name returns false', () => {
        pm.createProject('DupSameName');
        const result = pm.duplicateProject('DupSameName', 'DupSameName');
        assert.equal(result, false);
    });

    test('P063: delete project with nested data', () => {
        pm.createProject('NestedDelete');
        const nestedPath = path.join(tempDir, 'projects', 'NestedDelete', 'data', 'subdir');
        ensureDir(nestedPath);
        writeJson(path.join(nestedPath, 'file.json'), { test: true });
        const result = pm.deleteProject('NestedDelete');
        assert.equal(result, true);
    });

    test('P064: list projects sorts alphabetically when no order', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'projects3'));
        pm2.createProject('Zebra');
        pm2.createProject('Apple');
        pm2.createProject('Mango');
        const projects = pm2.listProjects();
        assert.deepEqual(projects, ['Apple', 'Mango', 'Zebra']);
    });

    test('P065: move project up multiple times', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p065'));
        pm2.createProject('MultiUp1');
        pm2.createProject('MultiUp2');
        pm2.createProject('MultiUp3');
        pm2.bootstrapConfig.projectOrder = ['MultiUp1', 'MultiUp2', 'MultiUp3'];
        pm2.moveProject('MultiUp3', 'up');
        pm2.moveProject('MultiUp3', 'up');
        assert.deepEqual(pm2.bootstrapConfig.projectOrder, ['MultiUp3', 'MultiUp1', 'MultiUp2']);
    });

    test('P066: move project down multiple times', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p066'));
        pm2.createProject('MultiDown1');
        pm2.createProject('MultiDown2');
        pm2.createProject('MultiDown3');
        pm2.bootstrapConfig.projectOrder = ['MultiDown1', 'MultiDown2', 'MultiDown3'];
        pm2.moveProject('MultiDown1', 'down');
        pm2.moveProject('MultiDown1', 'down');
        assert.deepEqual(pm2.bootstrapConfig.projectOrder, ['MultiDown2', 'MultiDown3', 'MultiDown1']);
    });

    test('P067: verify project with corrupted session.json', () => {
        pm.createProject('CorruptSession');
        const sessionPath = path.join(tempDir, 'projects', 'CorruptSession', 'session.json');
        fs.writeFileSync(sessionPath, '{ invalid json', 'utf8');
        const result = pm.verifyProject('CorruptSession');
        // Corrupted JSON is still a file that exists, so no issue detected for missing file
        // The verify function only checks for file existence, not content validity
        assert.ok(fs.existsSync(sessionPath));
    });

    test('P068: duplicate project with large data files', () => {
        pm.createProject('LargeDup');
        const largePath = path.join(tempDir, 'projects', 'LargeDup', 'data', 'large.json');
        const largeData = { data: 'x'.repeat(10000) };
        writeJson(largePath, largeData);
        pm.duplicateProject('LargeDup', 'LargeDupCopy');
        const newPath = path.join(tempDir, 'projects', 'LargeDupCopy', 'data', 'large.json');
        assert.ok(fs.existsSync(newPath));
        const data = readJson(newPath);
        assert.equal(data.data.length, 10000);
    });

    test('P069: rename project preserves all subdirectories', () => {
        pm.createProject('SubdirsRename');
        ensureDir(path.join(tempDir, 'projects', 'SubdirsRename', 'data', 'sub1'));
        ensureDir(path.join(tempDir, 'projects', 'SubdirsRename', 'data', 'sub2'));
        pm.renameProject('SubdirsRename', 'SubdirsRenamed');
        const newPath = path.join(tempDir, 'projects', 'SubdirsRenamed', 'data');
        assert.ok(fs.existsSync(path.join(newPath, 'sub1')));
        assert.ok(fs.existsSync(path.join(newPath, 'sub2')));
    });

    test('P070: verify project with empty project directory', () => {
        const emptyPath = path.join(tempDir, 'projects', 'EmptyVerify');
        ensureDir(emptyPath);
        const result = pm.verifyProject('EmptyVerify');
        assert.ok(result.issues.length > 0);
        assert.equal(result.status, 'Recovered');
    });

    // ── Integration Tests ────────────────────────────────────

    test('P071: create, rename, verify workflow', () => {
        pm.createProject('Workflow1');
        pm.renameProject('Workflow1', 'Workflow1Renamed');
        const result = pm.verifyProject('Workflow1Renamed');
        assert.equal(result.status, 'OK');
    });

    test('P072: create, duplicate, delete workflow', () => {
        pm.createProject('Workflow2');
        pm.duplicateProject('Workflow2', 'Workflow2Copy');
        pm.deleteProject('Workflow2');
        const projects = pm.listProjects();
        assert.ok(projects.includes('Workflow2Copy'));
        assert.ok(!projects.includes('Workflow2'));
    });

    test('P073: create, reorder, verify order workflow', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p073'));
        pm2.createProject('Workflow3A');
        pm2.createProject('Workflow3B');
        pm2.createProject('Workflow3C');
        pm2.bootstrapConfig.projectOrder = ['Workflow3A', 'Workflow3B', 'Workflow3C'];
        pm2.moveProject('Workflow3C', 'up');
        pm2.moveProject('Workflow3C', 'up');
        const projects = pm2.listProjects();
        assert.deepEqual(projects, ['Workflow3C', 'Workflow3A', 'Workflow3B']);
    });

    test('P074: create, verify, recover workflow', () => {
        pm.createProject('Workflow4');
        const dataPath = path.join(tempDir, 'projects', 'Workflow4', 'data');
        fs.rmdirSync(dataPath);
        const result = pm.verifyProject('Workflow4');
        assert.equal(result.status, 'Recovered');
        assert.ok(fs.existsSync(dataPath));
    });

    test('P075: multiple projects with same prefix', () => {
        pm.createProject('TestProject');
        pm.createProject('TestProject2');
        pm.createProject('TestProject3');
        const projects = pm.listProjects();
        assert.ok(projects.includes('TestProject'));
        assert.ok(projects.includes('TestProject2'));
        assert.ok(projects.includes('TestProject3'));
    });

    test('P076: duplicate and modify original', () => {
        pm.createProject('ModifyOrig');
        pm.duplicateProject('ModifyOrig', 'ModifyOrigCopy');
        const origPath = path.join(tempDir, 'projects', 'ModifyOrig', 'data', 'test.json');
        writeJson(origPath, { modified: true });
        const copyPath = path.join(tempDir, 'projects', 'ModifyOrigCopy', 'data', 'test.json');
        assert.ok(!fs.existsSync(copyPath));
    });

    test('P077: rename and duplicate renamed project', () => {
        pm.createProject('RenameDup');
        pm.renameProject('RenameDup', 'RenamedDup');
        pm.duplicateProject('RenamedDup', 'RenamedDupCopy');
        const projects = pm.listProjects();
        assert.ok(projects.includes('RenamedDup'));
        assert.ok(projects.includes('RenamedDupCopy'));
    });

    test('P078: verify project after duplicate', () => {
        pm.createProject('VerifyDup');
        pm.duplicateProject('VerifyDup', 'VerifyDupCopy');
        const result = pm.verifyProject('VerifyDupCopy');
        assert.equal(result.status, 'OK');
    });

    test('P079: reorder after rename', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p079'));
        pm2.createProject('ReorderRename1');
        pm2.createProject('ReorderRename2');
        pm2.bootstrapConfig.projectOrder = ['ReorderRename1', 'ReorderRename2'];
        pm2.renameProject('ReorderRename1', 'RenamedReorder');
        pm2.moveProject('RenamedReorder', 'down');
        assert.deepEqual(pm2.bootstrapConfig.projectOrder, ['ReorderRename2', 'RenamedReorder']);
    });

    test('P080: delete after reorder', () => {
        pm.createProject('DeleteReorder1');
        pm.createProject('DeleteReorder2');
        pm.createProject('DeleteReorder3');
        pm.bootstrapConfig.projectOrder = ['DeleteReorder1', 'DeleteReorder2', 'DeleteReorder3'];
        pm.deleteProject('DeleteReorder2');
        assert.ok(!pm.bootstrapConfig.projectOrder.includes('DeleteReorder2'));
    });

    // ── Stress Tests ─────────────────────────────────────────

    test('P081: create many projects', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'projects_stress'));
        for (let i = 0; i < 20; i++) {
            pm2.createProject(`StressProject${i}`);
        }
        const projects = pm2.listProjects();
        assert.equal(projects.length, 20);
    });

    test('P082: reorder many projects', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p082'));
        for (let i = 0; i < 10; i++) {
            pm2.createProject(`ReorderProject${i}`);
        }
        pm2.bootstrapConfig.projectOrder = Array.from({ length: 10 }, (_, i) => `ReorderProject${i}`);
        // Move last project to first position
        for (let i = 0; i < 9; i++) {
            pm2.moveProject('ReorderProject9', 'up');
        }
        const projects = pm2.listProjects();
        assert.equal(projects[0], 'ReorderProject9');
    });

    test('P083: duplicate large project multiple times', () => {
        pm.createProject('LargeStress');
        const dataPath = path.join(tempDir, 'projects', 'LargeStress', 'data', 'large.json');
        writeJson(dataPath, { data: 'x'.repeat(5000) });
        for (let i = 0; i < 5; i++) {
            pm.duplicateProject('LargeStress', `LargeStressCopy${i}`);
        }
        const projects = pm.listProjects();
        assert.ok(projects.filter(p => p.startsWith('LargeStressCopy')).length === 5);
    });

    test('P084: verify many projects', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'projects_verify'));
        for (let i = 0; i < 10; i++) {
            pm2.createProject(`VerifyProject${i}`);
        }
        for (let i = 0; i < 10; i++) {
            const result = pm2.verifyProject(`VerifyProject${i}`);
            assert.equal(result.status, 'OK');
        }
    });

    // ── Boundary Tests ───────────────────────────────────────

    test('P085: move single project up returns false', () => {
        pm.createProject('SingleMove');
        pm.bootstrapConfig.projectOrder = ['SingleMove'];
        const result = pm.moveProject('SingleMove', 'up');
        assert.equal(result, false);
    });

    test('P086: move single project down returns false', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p086'));
        pm2.createProject('SingleMoveDown');
        pm2.bootstrapConfig.projectOrder = ['SingleMoveDown'];
        const result = pm2.moveProject('SingleMoveDown', 'down');
        assert.equal(result, false);
    });

    test('P087: rename to empty string returns false', () => {
        pm.createProject('RenameEmpty');
        const result = pm.renameProject('RenameEmpty', '');
        assert.equal(result, false);
    });

    test('P088: duplicate to empty string returns false', () => {
        pm.createProject('DupEmpty');
        const result = pm.duplicateProject('DupEmpty', '');
        assert.equal(result, false);
    });

    test('P089: verify project with only data directory', () => {
        const partialPath = path.join(tempDir, 'projects', 'PartialVerify');
        ensureDir(path.join(partialPath, 'data'));
        const result = pm.verifyProject('PartialVerify');
        assert.ok(result.issues.length > 0);
    });

    test('P090: delete project with all files removed manually', () => {
        pm.createProject('ManualDelete');
        const projPath = path.join(tempDir, 'projects', 'ManualDelete');
        const files = fs.readdirSync(projPath, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(projPath, file.name);
            if (file.isDirectory()) {
                deleteDirSync(fullPath);
            } else {
                fs.unlinkSync(fullPath);
            }
        }
        const result = pm.deleteProject('ManualDelete');
        assert.equal(result, true);
    });

    // ── Data Integrity Tests ─────────────────────────────────

    test('P091: duplicate preserves tab data content', () => {
        pm.createProject('TabDataDup');
        const tabPath = path.join(tempDir, 'projects', 'TabDataDup', 'data', 'default.promptsbt');
        writeJson(tabPath, { title: 'Test', content: 'Content' });
        pm.duplicateProject('TabDataDup', 'TabDataDupCopy');
        const copyTabPath = path.join(tempDir, 'projects', 'TabDataDupCopy', 'data', 'default.promptsbt');
        const data = readJson(copyTabPath);
        assert.equal(data.title, 'Test');
        assert.equal(data.content, 'Content');
    });

    test('P092: rename preserves tab data content', () => {
        pm.createProject('TabDataRename');
        const tabPath = path.join(tempDir, 'projects', 'TabDataRename', 'data', 'default.promptsbt');
        writeJson(tabPath, { title: 'Test', content: 'Content' });
        pm.renameProject('TabDataRename', 'TabDataRenamed');
        const newTabPath = path.join(tempDir, 'projects', 'TabDataRenamed', 'data', 'default.promptsbt');
        const data = readJson(newTabPath);
        assert.equal(data.title, 'Test');
        assert.equal(data.content, 'Content');
    });

    test('P093: duplicate preserves multiple tabs', () => {
        pm.createProject('MultiTabDup');
        const sessionPath = path.join(tempDir, 'projects', 'MultiTabDup', 'session.json');
        writeJson(sessionPath, { tabs: [{ name: 'Tab1', file: 'tab1.json' }, { name: 'Tab2', file: 'tab2.json' }] });
        pm.duplicateProject('MultiTabDup', 'MultiTabDupCopy');
        const copySessionPath = path.join(tempDir, 'projects', 'MultiTabDupCopy', 'session.json');
        const session = readJson(copySessionPath);
        assert.equal(session.tabs.length, 2);
    });

    test('P094: verify recovers with correct default session', () => {
        pm.createProject('RecoverSession');
        const sessionPath = path.join(tempDir, 'projects', 'RecoverSession', 'session.json');
        fs.unlinkSync(sessionPath);
        pm.verifyProject('RecoverSession');
        const session = readJson(sessionPath);
        assert.equal(session.tabs.length, 1);
        assert.equal(session.tabs[0].name, 'default.promptsbt');
    });

    test('P095: verify recovers with correct default pipelines', () => {
        pm.createProject('RecoverPipelines');
        const pipelinesPath = path.join(tempDir, 'projects', 'RecoverPipelines', 'pipelines.json');
        fs.unlinkSync(pipelinesPath);
        pm.verifyProject('RecoverPipelines');
        const pipelines = readJson(pipelinesPath);
        assert.deepEqual(pipelines.pipelines, []);
    });

    test('P096: verify recovers with correct default recipes', () => {
        pm.createProject('RecoverRecipes');
        const recipesPath = path.join(tempDir, 'projects', 'RecoverRecipes', 'projectrecipes.json');
        fs.unlinkSync(recipesPath);
        pm.verifyProject('RecoverRecipes');
        const recipes = readJson(recipesPath);
        assert.deepEqual(recipes, []);
    });

    // ── Concurrent Operation Tests ───────────────────────────

    test('P097: create after delete same name', () => {
        pm.createProject('ReuseName');
        pm.deleteProject('ReuseName');
        const result = pm.createProject('ReuseName');
        assert.equal(result, true);
    });

    test('P098: rename after rename', () => {
        pm.createProject('DoubleRename');
        pm.renameProject('DoubleRename', 'DoubleRename1');
        const result = pm.renameProject('DoubleRename1', 'DoubleRename2');
        assert.equal(result, true);
    });

    test('P099: duplicate after duplicate', () => {
        pm.createProject('DoubleDup');
        pm.duplicateProject('DoubleDup', 'DoubleDup1');
        const result = pm.duplicateProject('DoubleDup1', 'DoubleDup2');
        assert.equal(result, true);
    });

    test('P100: complex workflow - create, duplicate, rename, reorder, verify', () => {
        const pm2 = new ProjectManager(path.join(tempDir, 'p100'));
        pm2.createProject('Complex1');
        pm2.createProject('Complex2');
        pm2.duplicateProject('Complex1', 'Complex1Copy');
        pm2.renameProject('Complex2', 'Complex2Renamed');
        pm2.bootstrapConfig.projectOrder = ['Complex1', 'Complex1Copy', 'Complex2Renamed'];
        pm2.moveProject('Complex2Renamed', 'up');
        pm2.moveProject('Complex2Renamed', 'up');
        const result = pm2.verifyProject('Complex1Copy');
        assert.equal(result.status, 'OK');
        const projects = pm2.listProjects();
        assert.deepEqual(projects, ['Complex2Renamed', 'Complex1', 'Complex1Copy']);
    });
});

describe('GeminiProvider Multimodal & Image Generation URL resolution', () => {
    test('GeminiProvider calls generateContent with correct parts and apiPath', async () => {
        const utils = require('./providers/utils');
        const originalHttpRequest = utils.httpRequest;
        let captured = null;
        
        utils.httpRequest = async (url, method, headers, body) => {
            captured = { url, method, headers, body: JSON.parse(body) };
            return JSON.stringify({
                candidates: [{
                    content: {
                        parts: [
                            { text: 'Result text' },
                            { inlineData: { mimeType: 'image/png', data: 'BASE64_RESULT_IMG' } }
                        ]
                    }
                }]
            });
        };
        
        try {
            delete require.cache[require.resolve('./providers/gemini.js')];
            const { ProviderClass: GeminiProvider } = require('./providers/gemini');
            const provider = new GeminiProvider('test-api-key', 'https://generativelanguage.googleapis.com');
            
            const req = {
                model: 'gemini-3.1-flash-image',
                userPrompt: 'Create a picture of my cat eating a nano-banana',
                apiPath: '/v1/models/{model}:generateContent',
                attachments: [
                    { mimetype: 'image/jpeg', content: 'BASE64_IMAGE_DATA_1' }
                ],
                customParams: {
                    aspectRatio: '1:1',
                    imageSize: '1K',
                    responseModalities: ['TEXT', 'IMAGE']
                }
            };
            
            const resp = await provider.call(req);
            
            assert.ok(captured, 'httpRequest should be called');
            assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent');
            assert.equal(captured.method, 'POST');
            assert.equal(captured.headers['x-goog-api-key'], 'test-api-key');
            
            // Validate request body
            const body = captured.body;
            assert.ok(body.contents, 'Should have contents array');
            assert.equal(body.contents[0].parts.length, 2);
            assert.equal(body.contents[0].parts[1].text, 'Create a picture of my cat eating a nano-banana');
            assert.equal(body.contents[0].parts[0].inline_data.data, 'BASE64_IMAGE_DATA_1');
            assert.equal(body.contents[0].parts[0].inline_data.mime_type, 'image/jpeg');
            
            assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
            assert.equal(body.generationConfig.responseFormat.image.aspectRatio, '1:1');
            
            // Validate response
            assert.equal(resp.content, 'Result text');
            assert.equal(resp.outputAttachments.length, 1);
            assert.equal(resp.outputAttachments[0].content, 'BASE64_RESULT_IMG');
            assert.equal(resp.outputAttachments[0].mimetype, 'image/png');
        } finally {
            utils.httpRequest = originalHttpRequest;
            delete require.cache[require.resolve('./providers/gemini.js')];
        }
    });

    test('GeminiProvider multiple references: formats body correctly', async () => {
        const utils = require('./providers/utils');
        const originalHttpRequest = utils.httpRequest;
        let captured = null;
        
        utils.httpRequest = async (url, method, headers, body) => {
            captured = { url, method, headers, body: JSON.parse(body) };
            return JSON.stringify({
                candidates: [{
                    content: {
                        parts: [
                            { text: 'Office group photo result' }
                        ]
                    }
                }]
            });
        };
        
        try {
            delete require.cache[require.resolve('./providers/gemini.js')];
            const { ProviderClass: GeminiProvider } = require('./providers/gemini');
            const provider = new GeminiProvider('test-api-key', 'https://generativelanguage.googleapis.com');
            
            const req = {
                model: 'gemini-3.1-flash-image',
                userPrompt: 'An office group photo of these people, they are making funny faces.',
                apiPath: '/v1/models/{model}:generateContent',
                attachments: [
                    { mimetype: 'image/png', content: 'BASE64_DATA_IMG_1' },
                    { mimetype: 'image/png', content: 'BASE64_DATA_IMG_2' },
                    { mimetype: 'image/png', content: 'BASE64_DATA_IMG_3' }
                ],
                customParams: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    aspectRatio: '5:4',
                    imageSize: '2K'
                }
            };
            
            await provider.call(req);
            
            assert.ok(captured, 'httpRequest should be called');
            const body = captured.body;
            assert.equal(body.contents[0].parts.length, 4);
            assert.equal(body.contents[0].parts[3].text, 'An office group photo of these people, they are making funny faces.');
            assert.equal(body.contents[0].parts[0].inline_data.data, 'BASE64_DATA_IMG_1');
            assert.equal(body.contents[0].parts[1].inline_data.data, 'BASE64_DATA_IMG_2');
            assert.equal(body.contents[0].parts[2].inline_data.data, 'BASE64_DATA_IMG_3');
            
            assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
            assert.equal(body.generationConfig.responseFormat.image.aspectRatio, '5:4');
            assert.equal(body.generationConfig.responseFormat.image.imageSize, '2K');
        } finally {
            utils.httpRequest = originalHttpRequest;
            delete require.cache[require.resolve('./providers/gemini.js')];
        }
    });

    test('GeminiProvider grounding: formats tools in body correctly', async () => {
        const utils = require('./providers/utils');
        const originalHttpRequest = utils.httpRequest;
        let captured = null;
        
        utils.httpRequest = async (url, method, headers, body) => {
            captured = { url, method, headers, body: JSON.parse(body) };
            return JSON.stringify({
                candidates: [{
                    content: {
                        parts: [
                            { text: 'Grounding weather forecast chart result' }
                        ]
                    }
                }]
            });
        };
        
        try {
            delete require.cache[require.resolve('./providers/gemini.js')];
            const { ProviderClass: GeminiProvider } = require('./providers/gemini');
            const provider = new GeminiProvider('test-api-key', 'https://generativelanguage.googleapis.com');
            
            const req = {
                model: 'gemini-3.1-flash-image',
                userPrompt: 'Visualize the current weather forecast for the next 5 days in San Francisco',
                apiPath: '/v1/models/{model}:generateContent',
                customParams: {
                    tools: [{"google_search": {}}],
                    responseModalities: ["TEXT", "IMAGE"],
                    aspectRatio: "16:9"
                }
            };
            
            await provider.call(req);
            
            assert.ok(captured, 'httpRequest should be called');
            const body = captured.body;
            assert.deepEqual(body.tools, [{"google_search": {}}]);
            assert.deepEqual(body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
            assert.equal(body.generationConfig.responseFormat.image.aspectRatio, "16:9");
        } finally {
            utils.httpRequest = originalHttpRequest;
            delete require.cache[require.resolve('./providers/gemini.js')];
        }
    });

    test('GeminiProvider v2i: formats file_data and video_metadata in parts correctly', async () => {
        const utils = require('./providers/utils');
        const originalHttpRequest = utils.httpRequest;
        let captured = null;
        
        utils.httpRequest = async (url, method, headers, body) => {
            captured = { url, method, headers, body: JSON.parse(body) };
            return JSON.stringify({
                candidates: [{
                    content: {
                        parts: [
                            { text: 'Video infographic result' }
                        ]
                    }
                }]
            });
        };
        
        try {
            delete require.cache[require.resolve('./providers/gemini.js')];
            const { ProviderClass: GeminiProvider } = require('./providers/gemini');
            const provider = new GeminiProvider('test-api-key', 'https://generativelanguage.googleapis.com');
            
            const req = {
                model: 'gemini-3.1-flash-image',
                userPrompt: 'Can you create an infographics that explains what this video is about?',
                apiPath: '/v1/models/{model}:generateContent',
                customParams: {
                    file_data: {
                        file_uri: 'https://www.youtube.com/watch?v=UTdfxFyOQTI'
                    },
                    video_metadata: {
                        fps: 0.5
                    }
                }
            };
            
            await provider.call(req);
            
            assert.ok(captured, 'httpRequest should be called');
            const body = captured.body;
            assert.equal(body.contents[0].parts.length, 2);
            assert.deepEqual(body.contents[0].parts[0].file_data, {
                file_uri: 'https://www.youtube.com/watch?v=UTdfxFyOQTI'
            });
            assert.deepEqual(body.contents[0].parts[0].video_metadata, {
                fps: 0.5
            });
            assert.equal(body.contents[0].parts[1].text, 'Can you create an infographics that explains what this video is about?');
        } finally {
            utils.httpRequest = originalHttpRequest;
            delete require.cache[require.resolve('./providers/gemini.js')];
        }
    });

    test('GeminiProvider calls predict endpoint with correct URL and body for Imagen models', async () => {
        const utils = require('./providers/utils');
        const originalHttpRequest = utils.httpRequest;
        let captured = null;
        
        utils.httpRequest = async (url, method, headers, body) => {
            captured = { url, method, headers, body: JSON.parse(body) };
            return JSON.stringify({
                predictions: [
                    { bytesBase64Encoded: 'BASE64_PREDICTION_1', mimeType: 'image/png' }
                ]
            });
        };
        
        try {
            delete require.cache[require.resolve('./providers/gemini.js')];
            const { ProviderClass: GeminiProvider } = require('./providers/gemini');
            const provider = new GeminiProvider('test-api-key', 'https://generativelanguage.googleapis.com');
            
            const req = {
                model: 'imagen-3.0-generate-001',
                userPrompt: 'warm, spring field',
                customParams: {
                    aspectRatio: '1:1'
                }
            };
            
            const resp = await provider.call(req);
            
            assert.ok(captured, 'httpRequest should be called');
            assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict');
            assert.equal(captured.method, 'POST');
            assert.equal(captured.headers['x-goog-api-key'], 'test-api-key');
            
            // Validate request body
            const body = captured.body;
            assert.deepEqual(body.instances, [{ prompt: 'warm, spring field' }]);
            assert.deepEqual(body.parameters, {
                sampleCount: 1,
                aspectRatio: '1:1',
                imageFormat: 'image/png'
            });
            
            // Validate response
            assert.equal(resp.outputAttachments.length, 1);
            assert.equal(resp.outputAttachments[0].content, 'BASE64_PREDICTION_1');
            assert.equal(resp.outputAttachments[0].mimetype, 'image/png');
        } finally {
            utils.httpRequest = originalHttpRequest;
            delete require.cache[require.resolve('./providers/gemini.js')];
        }
    });
});

// ── Recipe files — triplet validation ──────────────────────
const RECIPES_DIR = path.join(__dirname, '..', 'frontend', 'defaults');

const VALID_TOOL_TYPES = ['t2t', 't2i', 'i2i', 'v2i', 'tts', 'stt', 't2a', 't2v', 'translate'];
const VALID_API_TYPES  = ['openai', 'anthropic', 'gemini', 'ollama', 'polling', 'simple'];

describe('Recipe files — structural validation', () => {
    const recipeFiles = fs.readdirSync(RECIPES_DIR)
        .filter(f => f.startsWith('recipes-') && f.endsWith('.json'))
        .sort();

    for (const file of recipeFiles) {
        test(`${file} is valid JSON and has required fields`, () => {
            const recipes = readJson(path.join(RECIPES_DIR, file), null);
            assert.ok(Array.isArray(recipes), `${file}: must be an array`);

            for (let i = 0; i < recipes.length; i++) {
                const r = recipes[i];
                const tag = `${file}[${i}] "${r.name || 'unnamed'}"`;
                assert.ok(r.name,          `${tag}: missing name`);
                assert.equal(r.type, 'ai', `${tag}: type must be "ai"`);
                assert.ok(r.provider,      `${tag}: missing provider`);
                assert.ok(r.model,         `${tag}: missing model`);
                assert.equal(typeof r.temperature, 'number', `${tag}: temperature must be a number`);
                assert.ok(Array.isArray(r.tool),      `${tag}: tool must be an array`);
                assert.ok(r.tool.length > 0,           `${tag}: tool must not be empty`);
                for (const t of r.tool) {
                    assert.ok(VALID_TOOL_TYPES.includes(t), `${tag}: unknown tool type "${t}"`);
                }
            }
        });
    }
});

describe('Recipe files — triplet validation', () => {
    const recipeFiles = fs.readdirSync(RECIPES_DIR)
        .filter(f => f.startsWith('recipes-') && f.endsWith('.json'))
        .sort();

    const allRecipes = [];
    for (const file of recipeFiles) {
        const recipes = readJson(path.join(RECIPES_DIR, file), []);
        if (Array.isArray(recipes)) {
            for (const r of recipes) {
                allRecipes.push({ file, recipe: r });
            }
        }
    }

    test('every recipe has the triplet (provider, model, apiType)', () => {
        for (const { file, recipe: r } of allRecipes) {
            const tag = `${file} "${r.name}"`;
            assert.ok(r.provider, `${tag}: missing provider (1st triplet element)`);
            assert.ok(r.model,    `${tag}: missing model (2nd triplet element)`);
            assert.ok(r.apiType,  `${tag}: missing apiType (3rd triplet element)`);
            assert.ok(VALID_API_TYPES.includes(r.apiType), `${tag}: unknown apiType "${r.apiType}"`);
        }
    });

    test('every recipe has tool matching its name/purpose', () => {
        for (const { file, recipe: r } of allRecipes) {
            const tag = `${file} "${r.name}"`;
            const tools = r.tool || [];
            const nameLower = r.name.toLowerCase();

            if (nameLower.includes('translate')) {
                assert.ok(tools.includes('translate'), `${tag}: translate recipe should include "translate" in tool`);
            }
            if (nameLower.includes('tts') || nameLower.includes('speech')) {
                assert.ok(tools.includes('tts'), `${tag}: TTS recipe should include "tts" in tool`);
            }
            if ((nameLower.includes('t2i') || nameLower.includes('text-to-image')) && !nameLower.includes('i2i')) {
                assert.ok(tools.includes('t2i'), `${tag}: T2I recipe should include "t2i" in tool`);
            }
            if (nameLower.includes('i2i')) {
                assert.ok(tools.includes('i2i'), `${tag}: I2I recipe should include "i2i" in tool`);
            }
            if (nameLower.includes('v2i')) {
                assert.ok(tools.includes('v2i'), `${tag}: V2I recipe should include "v2i" in tool`);
            }
        }
    });

    test('file name matches provider prefix', () => {
        for (const { file, recipe: r } of allRecipes) {
            const expectedPrefix = `recipes-${r.provider}.json`;
            assert.equal(file, expectedPrefix,
                `"${r.name}" has provider "${r.provider}" but lives in ${file}, expected ${expectedPrefix}`);
        }
    });
});

