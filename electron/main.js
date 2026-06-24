'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');

const { executeToolStep } = require('./steps/tool-step');
const { runBlobGC } = require('./blob-gc');
const { RecentFilesManager } = require('./recent-files');

// Resolve frontend root: packaged app uses process.resourcesPath/frontend,
// dev run uses the sibling ../frontend directory.
const FRONTEND_ROOT = app.isPackaged
    ? path.join(process.resourcesPath, 'frontend')
    : path.join(__dirname, '..', 'frontend');

// ============================================================
// Mock Server Control
// ============================================================
let mockServerProcess = null;

function startMockServer() {
    if (mockServerProcess) return;
    try {
        const serverPath = path.join(__dirname, '..', 'mock', 'server.js');
        mockServerProcess = spawn('node', [serverPath], {
            stdio: 'ignore',
            detached: false
        });
        console.log('[Mock Server] Started mock server process');
        
        mockServerProcess.on('error', (err) => {
            console.error('[Mock Server] Process error:', err.message);
        });
        mockServerProcess.on('exit', (code, signal) => {
            console.log(`[Mock Server] Process exited with code ${code} and signal ${signal}`);
            mockServerProcess = null;
        });
    } catch (e) {
        console.error('[Mock Server] Failed to start mock server:', e.message);
    }
}

function stopMockServer() {
    if (!mockServerProcess) return;
    try {
        mockServerProcess.kill();
        mockServerProcess = null;
        console.log('[Mock Server] Stopped mock server process');
    } catch (e) {
        console.error('[Mock Server] Failed to stop mock server:', e.message);
    }
}

// ============================================================
// Paths
// ============================================================
function getBootstrapConfigPath() {
    return path.join(app.getPath('appData'), 'Wend', 'config.json');
}

function loadBootstrapConfig() {
    return readJson(getBootstrapConfigPath(), { projectsRoot: '' });
}

function saveBootstrapConfig(cfg) {
    writeJson(getBootstrapConfigPath(), cfg);
}

function getDefaultDataPath() {
    return path.join(app.getPath('appData'), 'Wend');
}

function getAppDataPath() {
    const bootstrap = loadBootstrapConfig();
    if (bootstrap.projectsRoot && fs.existsSync(bootstrap.projectsRoot)) {
        return bootstrap.projectsRoot;
    }
    return getDefaultDataPath();
}

// ============================================================
// Utilities
// ============================================================
function jsonEscape(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

function ensureDir(p) {
    try { fs.mkdirSync(p, { recursive: true }); } catch (e) {
        console.error('[ensureDir] Failed to create directory:', p, e.message);
    }
}

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

function readJson(filePath, fallback = null) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch (e) {
        if (e.code === 'ENOENT') return fallback;
        const msg = `[readJson] Failed to read/parse: ${filePath} ${e.message}`;
        console.error(msg);
        try { postToJS('log', JSON.stringify({ message: `⚠️ ${msg}` })); } catch {}
        return fallback;
    }
}

function writeJson(filePath, obj) {
    ensureDir(path.dirname(filePath));
    try {
        fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
        console.error('[writeJson] Failed to write:', filePath, e.message);
    }
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

// ============================================================
// HTTP helper
// ============================================================
function httpRequest(url, method, headers, body, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const bodyStr = body || '';
        const opts = {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method,
            headers: { ...(body ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...headers },
            timeout: timeoutMs,
        };
        const startTime = Date.now();
        const req = mod.request(opts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const bodyBuf = Buffer.concat(chunks);
                const bodyText = bodyBuf.toString('utf8');
                const elapsed = Date.now() - startTime;
                tryLogHttp({ url, method, statusCode: res.statusCode, requestBody: bodyStr, responsePreview: bodyText.substring(0, 500), elapsedMs: elapsed });
                resolve(bodyText);
            });
        });
        req.on('error', err => {
            tryLogHttp({ url, method, statusCode: 0, requestBody: bodyStr, error: err.message });
            reject(err);
        });
        req.on('timeout', () => { req.destroy(); tryLogHttp({ url, method, statusCode: 0, requestBody: bodyStr, error: 'timeout' }); reject(new Error('timeout')); });
        if (body) req.write(bodyStr);
        req.end();
    });
}

// Global HTTP log callback (set after app is ready)
let _httpLogCallback = null;
function setHttpLogCallback(fn) { _httpLogCallback = fn; }

function redactMediaFromBody(bodyStr) {
    if (!bodyStr) return bodyStr;
    try {
        const json = JSON.parse(bodyStr);
        const redact = (obj) => {
            if (!obj || typeof obj !== 'object') return obj;
            if (Array.isArray(obj)) return obj.map(redact);
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                if (key === 'data' && typeof value === 'string' && value.length > 100) {
                    result[key] = '(b64 emitted)';
                } else if (key === 'image_url' && typeof value === 'object') {
                    if (value.url && value.url.startsWith('data:')) {
                        result[key] = { url: '(b64 emitted)' };
                    } else {
                        result[key] = value;
                    }
                } else {
                    result[key] = redact(value);
                }
            }
            return result;
        };
        return JSON.stringify(redact(json), null, 2);
    } catch {
        // Not JSON, check for multipart
        if (bodyStr.includes('multipart/form-data') || bodyStr.includes('Content-Disposition')) {
            return bodyStr.replace(/Content-Disposition: form-data; name="[^"]*"; filename="[^"]*"[^]*?------/g, 
                (match) => match.replace(/[\s\S]*?(?=------)/, '[binary data redacted]\n'));
        }
        return bodyStr;
    }
}

function tryLogHttp(info) {
    const redactedBody = redactMediaFromBody(info.requestBody);
    const elapsed = info.elapsedMs ? ` (${info.elapsedMs}ms)` : '';
    const status = info.statusCode || info.error || '?';
    const requestStr = redactedBody ? redactedBody.substring(0, 80).replace(/\n/g, '\\n') : '';
    const detailStr = info.responsePreview ? info.responsePreview.substring(0, 80).replace(/\n/g, '\\n') : '';
    console.log(`[HTTP] ${info.method} ${info.url} → request: ${requestStr} | result: ${status}${elapsed} | detail: ${detailStr}`);
    try {
        fs.appendFileSync(path.join(appDataPath || 'C:\\Users\\bluen\\AppData\\Local\\Temp', 'prompts_http_debug.log'),
            `[${new Date().toISOString()}] ${info.method} ${info.url} → request: ${requestStr} | result: ${status}${elapsed} | detail: ${detailStr}\n`, 'utf8');
    } catch (e) { console.error('HTTP debug log error:', e); }
    try { if (_httpLogCallback) _httpLogCallback({ ...info, requestBody: redactedBody }); } catch(e) { console.error('HTTP log callback error:', e); }
}

function downloadBinary(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const opts = {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: 'GET',
            headers,
            timeout: 30000,
        };
        const req = mod.request(opts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('download timeout')); });
        req.end();
    });
}

const customProviders = {};

function loadCustomProviders(storagePath) {
    const dir = path.join(storagePath, 'custom_providers');
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch(e) {
            console.error('[loadCustomProviders] Failed to create directory:', dir, e.message);
        }
        const sampleCode = `/**
 * Custom Provider Sample
 */
class CustomSampleProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl || '';
    }

    // This unique name will be used as the API Format identifier
    name() { return 'custom-sample'; }

    defaultModels() { return ['sample-model-1', 'sample-model-2']; }

    async call(req) {
        // req includes: model, userPrompt, systemPrompt, temperature, maxTokens, attachments, customParams
        const responseText = \`[Custom Sample] Received prompt: "\${req.userPrompt}" using model "\${req.model}". apiKey is "\${this.apiKey ? 'SET' : 'NOT SET'}".\`;
        return {
            content: responseText,
            model: req.model,
            outputAttachments: []
        };
    }

    async testConnection() {
        return ''; // Return empty string if success, error message if failure
    }
}

module.exports = CustomSampleProvider;
`;
        try { fs.writeFileSync(path.join(dir, 'sample.js'), sampleCode, 'utf8'); } catch(e) {
            console.error('[loadCustomProviders] Failed to write sample.js:', e.message);
        }
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
                            customProviders[providerName] = ProviderClass;
                        }
                    }
                } catch (err) { console.error('[CustomProviderLoader] Failed to load provider:', err.message); }
            }
        }
    } catch (e) { console.error('[CustomProviderLoader] Failed to scan custom providers:', e.message); }
}

// ============================================================
// AI Providers (loaded from providers/ directory)
// ============================================================
const builtinProviders = {};

// Auto-discover providers by scanning ./providers/ directory.
// Each provider file exports { ProviderClass, metadata }.
// A single try/catch per provider ensures one failure doesn't disable others.
const providerLoadErrors = [];
const _appProviderDefs = [];
const _providersDir = path.join(__dirname, 'providers');
try {
    const files = fs.readdirSync(_providersDir).filter(f => f.endsWith('.js') && f !== 'utils.js');
    for (const file of files) {
        try {
            const mod = require(path.join(_providersDir, file));
            if (mod && mod.ProviderClass && mod.metadata) {
                builtinProviders[mod.metadata.id] = mod.ProviderClass;
                _appProviderDefs.push(mod.metadata);
            }
        } catch (e) {
            const name = file.replace('.js', '');
            providerLoadErrors.push(`${name}: ${e.message}`);
            console.error(`[ProviderLoader] Failed to load provider "${name}":`, e.message);
        }
    }
} catch (e) {
    console.error('[ProviderLoader] Failed to scan providers directory:', e.message);
}
console.log('[ProviderLoader] Loaded providers:', Object.keys(builtinProviders).join(', ') || '(none)');

// Wire up providers/utils.js callbacks — all HTTP log logic lives here
try {
    const providerUtils = require('./providers/utils');
    providerUtils.setHttpLogCallback((info) => {
        const elapsed = info.elapsedMs ? ` (${info.elapsedMs}ms)` : '';
        const status = info.statusCode || info.error || '?';
        const requestStr = info.requestBody ? info.requestBody.substring(0, 80).replace(/\n/g, '\\n') : '';
        const detailStr = info.responsePreview ? info.responsePreview.substring(0, 80).replace(/\n/g, '\\n') : '';
        console.log(`[HTTP] ${info.method} ${info.url} → request: ${requestStr} | result: ${status}${elapsed} | detail: ${detailStr}`);
        try {
            const logPath = appDataPath || path.join(os.tmpdir(), 'prompts');
            fs.mkdirSync(logPath, { recursive: true });
            fs.appendFileSync(path.join(logPath, 'prompts_http_debug.log'),
                `[${new Date().toISOString()}] ${info.method} ${info.url} → request: ${requestStr} | result: ${status}${elapsed} | detail: ${detailStr}\n`, 'utf8');
        } catch (e) { console.error('HTTP debug log error:', e.message); }
        try { postToJS('http_log', info); } catch (e) {
            console.error('[HTTP] Failed to post http_log:', e.message);
        }
    });
    providerUtils.setErrorCallback((msg) => {
        try { postToJS('log', JSON.stringify({ message: `⚠️ ${msg}` })); } catch (e) {
            console.error('[ProviderUtils] Failed to post error message:', e.message);
        }
    });
} catch (e) {
    console.error('[ProviderUtils] Failed to load provider utils:', e.message);
}

function createProvider(type, apiKey, baseUrl) {
    if (customProviders[type]) {
        return new customProviders[type](apiKey, baseUrl);
    }
    if (builtinProviders[type]) {
        return new builtinProviders[type](apiKey, baseUrl);
    }
    return null;
}

const providerCapabilities = (() => {
    const map = {};
    _appProviderDefs.forEach(p => { map[p.id] = { input: p.input, output: p.output, description: p.description, ...(p.maxOutputs ? { maxOutputs: p.maxOutputs } : {}) }; });
    return map;
})();

function getDefaultRecipes() {
    const list = [];
    const baseFile = path.join(FRONTEND_ROOT, 'defaults', 'apprecipes.json');
    const baseRecipes = readJson(baseFile, []);
    if (Array.isArray(baseRecipes)) {
        list.push(...baseRecipes);
    }
    
    const defaultsDir = path.join(FRONTEND_ROOT, 'defaults');
    try {
        if (fs.existsSync(defaultsDir)) {
            const files = fs.readdirSync(defaultsDir);
            for (const file of files) {
                if (file.startsWith('recipes-') && file.endsWith('.json')) {
                    const extra = readJson(path.join(defaultsDir, file), []);
                    if (Array.isArray(extra)) {
                        list.push(...extra);
                    }
                }
            }
        }
    } catch (e) {
        console.error('[getDefaultRecipes] Failed to read defaults dir:', e.message);
    }
    return list;
}

function saveDefaultRecipes(recipes) {
    const defaultsDir = path.join(FRONTEND_ROOT, 'defaults');
    const general = [];
    const grouped = {};
    
    const knownProviders = _appProviderDefs.map(p => p.id);
    for (const r of recipes) {
        const prov = (r.provider || '').toLowerCase().trim();
        if (r.type === 'ai' && prov && knownProviders.includes(prov)) {
            if (!grouped[prov]) grouped[prov] = [];
            grouped[prov].push(r);
        } else {
            general.push(r);
        }
    }
    
    writeJson(path.join(defaultsDir, 'apprecipes.json'), general);
    
    try {
        if (fs.existsSync(defaultsDir)) {
            const files = fs.readdirSync(defaultsDir);
            for (const file of files) {
                if (file.startsWith('recipes-') && file.endsWith('.json')) {
                    fs.unlinkSync(path.join(defaultsDir, file));
                }
            }
        }
    } catch (e) {
        console.error('[saveDefaultRecipes] Failed to clean recipes files:', e.message);
    }
    
    for (const [prov, list] of Object.entries(grouped)) {
        writeJson(path.join(defaultsDir, `recipes-${prov}.json`), list);
    }
}

// ============================================================
// Storage
// ============================================================
class Storage {
    constructor() {
        this.basePath = '';
    }

    init(basePath) {
        this.basePath = basePath;
        ensureDir(path.join(basePath, 'data'));
        ensureDir(path.join(basePath, 'blobs'));
        ensureDir(path.join(basePath, 'history'));
        ensureDir(path.join(basePath, 'chests'));
        return true;
    }

    dataPath(rel) {
        return path.join(this.basePath, 'data', rel);
    }

    blobPath(rel) {
        return path.join(this.basePath, 'blobs', rel);
    }

    getBasePath() { return this.basePath; }

    // Session
    loadSession() {
        return readJson(path.join(this.basePath, 'session.json'), { tabs: [] });
    }

    saveSession(session) {
        writeJson(path.join(this.basePath, 'session.json'), session);
    }

    // Tab data (nodes)
    loadTabData(filePath) {
        const full = filePath.includes(path.sep) ? filePath : this.dataPath(filePath);
        return readJson(full, { title: '', content: '', mimetype: 'text/plain', attachments: [], children: [] });
    }

    saveTabData(filePath, root) {
        const full = filePath.includes(path.sep) ? filePath : this.dataPath(filePath);
        writeJson(full, root);
    }

    // Blobs
    loadBlob(relativePath) {
        try { return fs.readFileSync(this.blobPath(relativePath), 'base64'); } catch (e) {
            console.error('[loadBlob] Failed to read:', relativePath, e.message);
            return '';
        }
    }

    saveBlob(data, ext) {
        const name = Date.now() + '_' + Math.random().toString(36).slice(2) + ext;
        try {
            fs.writeFileSync(this.blobPath(name), Buffer.from(data, 'base64'));
        } catch (e) {
            console.error('[saveBlob] Failed to write:', name, e.message);
        }
        return name;
    }

    removeBlob(relativePath) {
        try { fs.unlinkSync(this.blobPath(relativePath)); } catch (e) {
            console.error('[removeBlob] Failed to delete:', relativePath, e.message);
        }
    }

    garbageCollectBlobs(referencedPaths) {
        try {
            const all = fs.readdirSync(path.join(this.basePath, 'blobs'));
            for (const f of all) {
                if (!referencedPaths.includes(f)) {
                    try { fs.unlinkSync(this.blobPath(f)); } catch (e) {
                        console.error('[garbageCollectBlobs] Failed to delete:', f, e.message);
                    }
                }
            }
        } catch (e) {
            console.error('[garbageCollectBlobs] Failed to read blobs directory:', e.message);
        }
    }

    getTabFiles() {
        try {
            return fs.readdirSync(path.join(this.basePath, 'data'))
                     .filter(f => f.endsWith('.json'));
        } catch (e) {
            console.error('[getTabFiles] Failed to read data directory:', e.message);
            return [];
        }
    }

    getFileTreeJson() {
        const files = this.getTabFiles();
        return JSON.stringify(files.map(f => ({ name: f, path: f, type: 'file' })));
    }

    // History
    saveHistory(recordJson) {
        try {
            const obj = JSON.parse(recordJson);
            const id = obj.id || generateRunId();
            const fileName = `run_${id}.json`;
            writeJson(path.join(this.basePath, 'history', fileName), obj);
            this._trimHistory();
        } catch (e) { console.error('saveHistory error:', e); }
    }

    _trimHistory() {
        try {
            const dir = path.join(this.basePath, 'history');
            const files = fs.readdirSync(dir)
                .filter(f => f.startsWith('run_') && f.endsWith('.json'))
                .map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            const max = this.maxHistoryRuns || 50;
            for (let i = max; i < files.length; i++) {
                try { fs.unlinkSync(path.join(dir, files[i].f)); } catch (e) {
                    console.error('[_trimHistory] Failed to delete:', files[i].f, e.message);
                }
            }
        } catch (e) {
            console.error('[_trimHistory] Failed to trim history:', e.message);
        }
    }

    updateHistoryEvaluation(filename, evaluation) {
        const p = path.join(this.basePath, 'history', filename);
        const obj = readJson(p, null);
        if (obj) { obj.evaluation = evaluation; writeJson(p, obj); }
    }

    listHistory() {
        try {
            return fs.readdirSync(path.join(this.basePath, 'history'))
                .filter(f => f.startsWith('run_') && f.endsWith('.json'))
                .sort().reverse();
        } catch (e) {
            console.error('[listHistory] Failed to read history directory:', e.message);
            return [];
        }
    }

    loadHistoryRecord(filename) {
        try {
            return fs.readFileSync(path.join(this.basePath, 'history', filename), 'utf8');
        } catch (e) {
            console.error('[loadHistoryRecord] Failed to read:', filename, e.message);
            return '';
        }
    }

    // Providers
    loadProviders() {
        const providers = readJson(path.join(this.basePath, 'providers.json'), {});
        let modified = false;
        
        // Correct incorrect baseUrl
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
        // Correct incorrect baseUrl
        for (const [key, p] of Object.entries(providers)) {
            if (p && p.baseUrl === 'https://googleapis.com') {
                p.baseUrl = 'https://generativelanguage.googleapis.com';
            }
        }

        writeJson(path.join(this.basePath, 'providers.json'), providers);
        return true;
    }

    // Pipelines
    loadPipelines() {
        const obj = readJson(path.join(this.basePath, 'pipelines.json'), { pipelines: [] });
        return obj.pipelines || obj || [];
    }

    savePipelines(pipelines) {
        writeJson(path.join(this.basePath, 'pipelines.json'), { pipelines });
    }

    // Recent files
    loadRecentFiles() {
        return readJson(path.join(this.basePath, 'recent_files.json'), []);
    }

    saveRecentFiles(files) {
        writeJson(path.join(this.basePath, 'recent_files.json'), files);
    }

    // General config
    loadGeneralConfig() {
        const defaults = readJson(path.join(FRONTEND_ROOT, 'defaults', 'appconfig.json'), {});
        return readJson(path.join(this.basePath, 'config.json'), defaults);
    }

    saveGeneralConfig(cfg) {
        writeJson(path.join(this.basePath, 'config.json'), cfg);
        this.maxHistoryRuns = cfg.historyRetention || 50;
        return true;
    }

    // Named chests
    _chestPath(name) {
        ensureDir(path.join(this.basePath, 'chests'));
        return path.join(this.basePath, 'chests', name + '.txt');
    }

    saveToNamedChest(name, content) {
        fs.writeFileSync(this._chestPath(name), content, 'utf8');
    }

    loadFromNamedChest(name) {
        try { return fs.readFileSync(this._chestPath(name), 'utf8'); } catch (e) {
            console.error('[loadFromNamedChest] Failed to read:', name, e.message);
            return '';
        }
    }

    chestExists(name) {
        return fs.existsSync(this._chestPath(name));
    }

    listNamedChests() {
        try {
            return fs.readdirSync(path.join(this.basePath, 'chests'))
                .filter(f => f.endsWith('.txt'))
                .map(f => f.slice(0, -4));
        } catch (e) {
            console.error('[listNamedChests] Failed to read chests directory:', e.message);
            return [];
        }
    }

    // Recipes
    loadDefaultRecipes() {
        return getDefaultRecipes();
    }

    loadProjectRecipes() {
        const list = [];
        const baseFile = path.join(this.basePath, 'projectrecipes.json');
        const baseRecipes = readJson(baseFile, []);
        if (Array.isArray(baseRecipes)) {
            list.push(...baseRecipes);
        }
        
        try {
            if (fs.existsSync(this.basePath)) {
                const files = fs.readdirSync(this.basePath);
                for (const file of files) {
                    if (file.startsWith('projectrecipes-') && file.endsWith('.json')) {
                        const extra = readJson(path.join(this.basePath, file), []);
                        if (Array.isArray(extra)) {
                            list.push(...extra);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[loadProjectRecipes] Failed to read basePath dir:', e.message);
        }
        return list;
    }

    saveProjectRecipes(recipes) {
        const general = [];
        const grouped = {};
        
        const knownProviders = _appProviderDefs.map(p => p.id);
        for (const r of recipes) {
            const prov = (r.provider || '').toLowerCase().trim();
            if (r.type === 'ai' && prov && knownProviders.includes(prov)) {
                if (!grouped[prov]) grouped[prov] = [];
                grouped[prov].push(r);
            } else {
                general.push(r);
            }
        }
        
        writeJson(path.join(this.basePath, 'projectrecipes.json'), general);
        
        try {
            if (fs.existsSync(this.basePath)) {
                const files = fs.readdirSync(this.basePath);
                for (const file of files) {
                    if (file.startsWith('projectrecipes-') && file.endsWith('.json')) {
                        fs.unlinkSync(path.join(this.basePath, file));
                    }
                }
            }
        } catch (e) {
            console.error('[saveProjectRecipes] Failed to clean projectrecipes files:', e.message);
        }
        
        for (const [prov, list] of Object.entries(grouped)) {
            writeJson(path.join(this.basePath, `projectrecipes-${prov}.json`), list);
        }
        return true;
    }

    // Project-scope blackboard (shared across tabs, persisted)
    loadProjectBlackboard() {
        return readJson(path.join(this.basePath, 'project_bb.json'), {});
    }

    saveProjectBlackboard(data) {
        writeJson(path.join(this.basePath, 'project_bb.json'), data || {});
        return true;
    }

    // Optimizer data
    saveOptimizerData(relativePath, json) {
        ensureDir(path.join(this.basePath, 'optimizer'));
        try {
            fs.writeFileSync(path.join(this.basePath, 'optimizer', relativePath), json, 'utf8');
        } catch (e) {
            console.error('[saveOptimizerData] Failed to write:', relativePath, e.message);
        }
    }

    loadOptimizerData(relativePath) {
        try { return fs.readFileSync(path.join(this.basePath, 'optimizer', relativePath), 'utf8'); }
        catch (e) {
            console.error('[loadOptimizerData] Failed to read:', relativePath, e.message);
            return '';
        }
    }

    // Wizard data
    loadWizardData(wizardName) {
        const candidates = [
            path.join(FRONTEND_ROOT, 'wizards', wizardName + '.json'),
        ];
        for (const p of candidates) {
            try { return fs.readFileSync(p, 'utf8'); } catch (e) {
                console.error('[loadWizardData] Failed to read:', p, e.message);
            }
        }
        return '';
    }

    // Run state
    saveRunState(runId, stateJson) {
        ensureDir(path.join(this.basePath, 'runs'));
        try {
            fs.writeFileSync(path.join(this.basePath, 'runs', runId + '_state.json'), stateJson, 'utf8');
        } catch (e) {
            console.error('[saveRunState] Failed to write:', runId, e.message);
        }
    }

    loadRunState(runId) {
        try { return fs.readFileSync(path.join(this.basePath, 'runs', runId + '_state.json'), 'utf8'); }
        catch (e) {
            console.error('[loadRunState] Failed to read:', runId, e.message);
            return '';
        }
    }

    scanIncompleteRuns() { return []; }
    closeRun(runId) {}
    discardRun(runId) {}

    ensureDirectory(p) {
        ensureDir(p);
        return true;
    }

    resolveProjectPath(rel) {
        const full = path.resolve(path.join(this.basePath, 'data', rel));
        if (!full.startsWith(path.join(this.basePath, 'data'))) return '';
        return full;
    }

    setMaxHistoryRuns(n) { this.maxHistoryRuns = n; }
    getMaxHistoryRuns() { return this.maxHistoryRuns || 50; }
}

// ============================================================
// Pipeline Runner
// ============================================================
class PipelineRunner {
    constructor() {
        this.running = false;
        this.cancelled = false;
        this.bridgeCb = null;
        this.providers = {};
        this.historySteps = [];
        this.currentStepIndex = -1;
        this.pendingSteps = [];
        this.inputContent = '';
        this.inputAttachments = [];
        this.outputMode = 'child';
        this.pipelineName = '';
        this.runId = '';
        this.startedAt = '';
        this.waitingForManual = false;
        this.waitingForWizard = false;
        this.waitingForFilter = false;
        this.wizardValues = {};
        this.filterApproved = [];
        this.filterRejected = [];
        this.inputSourceOverridden = false;
        this.inputSourceContent = '';
        this._manualResolve = null;
        this._wizardResolve = null;
        this._filterResolve = null;
        this.requestContext = {};  // Phase A: store requestId, targetNodePath
    }

    setBridgeCallback(cb) { this.bridgeCb = cb; }

    registerProvider(name, typeOrProvider, apiKey, baseUrl) {
        if (typeOrProvider && typeof typeOrProvider === 'object') {
            this.providers[name] = typeOrProvider;
        } else {
            const p = createProvider(typeOrProvider, apiKey, baseUrl);
            if (p) this.providers[name] = p;
        }
    }

    postBridge(type, json) {
        if (this.bridgeCb) this.bridgeCb(type, json);
    }

    setExternalInput(content) {
        this.inputSourceOverridden = true;
        this.inputSourceContent = content;
    }

    getRunId() { return this.runId; }
    isRunning() { return this.running; }

    cancel() {
        this.cancelled = true;
        this.running = false;
        this.pendingSteps = [];
        if (this._manualResolve) { this._manualResolve(null); this._manualResolve = null; }
        if (this._wizardResolve) { this._wizardResolve(null); this._wizardResolve = null; }
        if (this._filterResolve) { this._filterResolve(null); this._filterResolve = null; }
    }

    resumeManual(content) {
        if (this._manualResolve) { this._manualResolve(content); this._manualResolve = null; }
    }

    cancelManual() {
        if (this._manualResolve) { this._manualResolve(null); this._manualResolve = null; }
    }

    resumeWizard(valuesJson) {
        if (this._wizardResolve) { this._wizardResolve(valuesJson); this._wizardResolve = null; }
    }

    resumeFilter(decisionJson) {
        if (this._filterResolve) { this._filterResolve(decisionJson); this._filterResolve = null; }
    }

    run(pipelineName, steps, inputContent, inputAttachments, outputMode, requestContext = {}) {
        if (this.running) return;
        this.pipelineName = pipelineName;
        this.inputContent = inputContent;
        this.inputAttachments = inputAttachments || [];
        this.outputMode = outputMode || 'child';
        this.requestContext = requestContext || {};  // Phase A: store for pipeline_completed
        this.cancelled = false;
        this.running = true;
        this.runId = generateRunId();
        this.startedAt = nowIso();
        this.historySteps = steps.map((s, i) => ({
            index: i, name: s.name, type: s.type, input: i === 0 ? inputContent : '',
            output: '', status: 'pending', promptTokens: 0, completionTokens: 0,
            parallelBranches: {}, retries: 0, iterations: 0,
        }));
        this.currentStepIndex = -1;
        this.pendingSteps = [...steps];
        this.inputSourceOverridden = false;
        this.inputSourceContent = '';
        this.postBridge('pipeline_init', JSON.stringify({ steps: steps.map((s, i) => ({ ...s, index: i })) }));
        this.postBridge('step_started', JSON.stringify({ index: 0, name: steps[0]?.name || '' }));
        this._runNext().catch(e => {
            this.running = false;
            try {
                fs.appendFileSync(path.join(appDataPath, 'error.log'), `[${new Date().toISOString()}] Pipeline Error: ${e.message}\nStack: ${e.stack}\n\n`, 'utf8');
            } catch (err) {
                console.error('[Pipeline] Failed to write error log:', err.message);
            }
            postToJS('log', JSON.stringify({ message: `❌ Pipeline Error: ${e.message}<details><summary>Call Stack</summary><pre style="margin:4px 0;font-size:11px;color:#ff6b6b;background:rgba(0,0,0,0.2);padding:6px;border-radius:4px;white-space:pre-wrap;">${e.stack}</pre></details>` }));
            this.postBridge('pipeline_error', JSON.stringify({ message: String(e) }));
        });
    }

    _currentContent() {
        if (this.inputSourceOverridden) return this.inputSourceContent;
        if (this.currentStepIndex > 0 && this.historySteps[this.currentStepIndex - 1])
            return this.historySteps[this.currentStepIndex - 1].output;
        return this.inputContent;
    }

    async _runNext() {
        if (this.cancelled || this.pendingSteps.length === 0) {
            this.running = false;
            if (!this.cancelled) {
                this.postBridge('pipeline_completed', this._buildMeta());
            } else {
                this.postBridge('pipeline_error', JSON.stringify({ message: 'Canceled' }));
            }
            return;
        }

        this.currentStepIndex++;
        const step = this.pendingSteps.shift();

        // Update input for this step
        if (this.currentStepIndex < this.historySteps.length) {
            this.historySteps[this.currentStepIndex].input = this._currentContent();
            this.historySteps[this.currentStepIndex].status = 'running';
        }

        this.postBridge('step_started', JSON.stringify({ index: this.currentStepIndex, name: step.name }));

        try {
            await this._executeStep(step);
        } catch (e) {
            this.running = false;
            console.error('[Wend Pipeline Error]', e);
            const recipeInfo = step.params?.recipeName ? `\nRecipe: ${step.params.recipeName}` : '';
            const nodeInfo = step.params?.nodeTitle ? `\nNode: ${step.params.nodeTitle} (${step.params.nodeId})` : '';
            try {
                fs.appendFileSync(path.join(appDataPath, 'error.log'), `[${new Date().toISOString()}] Pipeline Error: ${e.message}${recipeInfo}${nodeInfo}\nStack: ${e.stack}\n\n`, 'utf8');
            } catch (err) {
                console.error('[Pipeline] Failed to write error log:', err.message);
            }
            postToJS('log', JSON.stringify({ message: `❌ Step Error: ${e.message}${recipeInfo}${nodeInfo}<details><summary>Call Stack</summary><pre style="margin:4px 0;font-size:11px;color:#ff6b6b;background:rgba(0,0,0,0.2);padding:6px;border-radius:4px;white-space:pre-wrap;">${e.stack}</pre></details>` }));
            this.postBridge('pipeline_error', JSON.stringify({ message: String(e) + recipeInfo + nodeInfo }));
            return;
        }

        if (!this.waitingForManual && !this.waitingForWizard && !this.waitingForFilter && this.running) {
            await this._runNext();
        }
    }

    async _executeStep(step) {
        const type = step.type;
        const idx = this.currentStepIndex;

        if (type === 'ai') {
            const providerName = step.params?.provider || 'openai';
            postToJS('log', JSON.stringify({ message: `[Backend] _executeStep: looking up provider "${providerName}"` }));
            const provider = this.providers[providerName];
            if (!provider) {
                postToJS('log', JSON.stringify({ message: `[Backend] ERROR: Provider "${providerName}" NOT FOUND in registered providers: ${Object.keys(this.providers).join(', ')}` }));
                const recipeContext = step.params?.recipeName ? `\nRecipe: ${step.params.recipeName}` : '';
                const nodeContext = step.params?.nodeTitle ? `\nNode: ${step.params.nodeTitle} (${step.params.nodeId})` : '';
                const loadErr = providerLoadErrors.find(le => le.startsWith(providerName + ':'));
                const providerLoadDetails = loadErr ? `\nProvider Load Detail: ${loadErr}` : '';
                throw new Error(`Provider Configuration Error\nStep: ${step.name || 'Step ' + idx}${recipeContext}${nodeContext}\nProvider: ${providerName}${providerLoadDetails}\nError: Provider not configured\nAvailable providers: ${Object.keys(this.providers).join(', ')}\nAction: Check Provider Settings and ensure "${providerName}" is properly configured with API key`);
            }
            postToJS('log', JSON.stringify({ message: `[Backend] Calling ${providerName} provider.call(req.model=${step.params?.model})...` }));

            let userPrompt = step.params?.userPrompt || '{content}';
            userPrompt = userPrompt.replace(/\{content\}/g, this.inputContent)
                                   .replace(/\{result\}/g, this._currentContent());

            // Provider-capability filter: feed only the input modalities the
            // provider declares it supports (provider metadata `input`). This
            // lets nodes hand over everything (text+audio+video) while each
            // provider consumes what it can and the rest is dropped with a log.
            let reqAttachments = this.inputAttachments || [];
            const inputCaps = providerCapabilities[providerName]?.input;
            if (Array.isArray(inputCaps) && reqAttachments.length > 0) {
                const before = reqAttachments.length;
                reqAttachments = reqAttachments.filter(a => {
                    const m = a.mimetype || '';
                    const mod = m.startsWith('image/') ? 'image'
                        : m.startsWith('audio/') ? 'audio'
                        : m.startsWith('video/') ? 'video' : 'text';
                    return mod === 'text' || inputCaps.includes(mod);
                });
                if (reqAttachments.length < before) {
                    postToJS('log', JSON.stringify({ message: `[Backend] ${providerName}: dropped ${before - reqAttachments.length} attachment(s) — unsupported input (accepts: ${inputCaps.join(', ')})` }));
                }
            }

            const req = {
                model: step.params?.model || 'gpt-4.1',
                systemPrompt: step.params?.systemPrompt || '',
                userPrompt,
                temperature: parseFloat(step.params?.temperature || '0.7'),
                maxTokens: parseInt(step.params?.maxTokens || '4096'),
                attachments: reqAttachments,
                apiPath: step.params?.apiPath || '',
                customParams: step.params?.customParams || {},
            };

            const resp = await provider.call(req);
            if (idx < this.historySteps.length) {
                this.historySteps[idx].output = resp.content;
                this.historySteps[idx].status = 'completed';
                if (resp.outputAttachments && resp.outputAttachments.length > 0) {
                    this.historySteps[idx].artifacts = resp.outputAttachments;
                }
                if (resp.reasoning) {
                    this.historySteps[idx].reasoning = resp.reasoning;
                }
                if (resp.requestUrl) {
                    this.historySteps[idx].requestUrl = resp.requestUrl;
                }
                if (resp.requestBody) {
                    this.historySteps[idx].requestBody = resp.requestBody;
                }
            }
            this.postBridge('step_done', JSON.stringify({ index: idx, tokens: resp.completionTokens || 0, output: resp.content || '', outputAttachments: this.historySteps[idx].artifacts || [] }));

        } else if (type === 'manual') {
            const mode = step.params?.mode || 'view';
            const prompt = step.params?.prompt || '';
            const content = this._currentContent();
            this.waitingForManual = true;

            if (mode === 'compare') {
                const branches = idx > 0 && this.historySteps[idx - 1]
                    ? Object.entries(this.historySteps[idx - 1].parallelBranches || {}).map(([name, c]) => ({ name, content: c }))
                    : [];
                this.postBridge('manual_step_pause', JSON.stringify({ index: idx, mode: 'compare', prompt, branches }));
            } else {
                const choices = step.params?.choices ? JSON.parse(step.params.choices) : [];
                this.postBridge('manual_step_pause', JSON.stringify({ index: idx, mode, prompt, content, choices }));
            }

            const result = await new Promise(res => { this._manualResolve = res; });
            this.waitingForManual = false;

            if (idx < this.historySteps.length) {
                this.historySteps[idx].output = result ?? content;
                this.historySteps[idx].status = 'completed';
            }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else if (type === 'command') {
            const cmd = step.params?.command || '';
            const argsStr = step.params?.args || '[]';
            const workDir = step.params?.workingDir || '';
            const timeoutSec = parseInt(step.params?.timeout || '60');
            const content = this._currentContent();
            const args = JSON.parse(argsStr);

            // Write content to temp file
            const tmpFile = path.join(os.tmpdir(), 'prompts_' + Date.now() + '.tmp');
            fs.writeFileSync(tmpFile, content, 'utf8');

            const resolvedArgs = args.map(a =>
                a.replace('{content_file}', tmpFile)
                 .replace('{content}', content)
                 .replace('{result}', content));

            let output = '';
            await new Promise((resolve) => {
                const proc = spawn(cmd, resolvedArgs, {
                    cwd: workDir || undefined,
                    shell: false,
                    timeout: timeoutSec * 1000,
                });
                proc.stdout.on('data', chunk => {
                    const text = chunk.toString('utf8');
                    output += text;
                    this.postBridge('stream_chunk', JSON.stringify({ stepIndex: idx, text }));
                });
                proc.stderr.on('data', chunk => {
                    const text = chunk.toString('utf8');
                    output += text;
                    this.postBridge('stream_chunk', JSON.stringify({ stepIndex: idx, text }));
                });
                proc.on('close', () => resolve());
                proc.on('error', e => { 
                    const errorMsg = `Command Execution Error\nStep: ${step.name || 'Step ' + idx}\nCommand: ${step.params?.command || 'unknown'}\nError: ${e.message}\nPossible causes: Command not found, permission denied, or invalid command syntax`;
                    output += '[' + errorMsg + ']'; 
                    resolve(); 
                });
            });

            try { fs.unlinkSync(tmpFile); } catch (e) {
                console.error('[command step] Failed to delete temp file:', tmpFile, e.message);
            }

            if (idx < this.historySteps.length) {
                this.historySteps[idx].output = output;
                this.historySteps[idx].status = 'completed';
            }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else if (type === 'tool') {
            const toolContext = {
                postBridge: (t, j) => this.postBridge(t, j),
                getContent: () => this._currentContent(),
                setOutput: (output, attachments) => {
                    if (idx < this.historySteps.length) {
                        this.historySteps[idx].output = output;
                        if (attachments && attachments.length > 0) {
                            this.historySteps[idx].outputAttachments = attachments;
                        }
                        this.historySteps[idx].status = 'completed';
                    }
                },
                idx
            };
            this._currentToolContext = toolContext;
            await executeToolStep(toolContext, step);
            this._currentToolContext = null;

        } else if (type === 'parallel') {
            const branchesVal = JSON.parse(step.params?.branches || '[]');
            const inputForBranches = this._currentContent();
            const branchResults = {};

            for (const branch of branchesVal) {
                const branchName = branch.name || 'branch';
                const subSteps = branch.steps || [];
                let branchContent = inputForBranches;
                for (const subStep of subSteps) {
                    if (subStep.type === 'ai') {
                        const providerName = subStep.provider || 'openai';
                        const provider = this.providers[providerName];
                        if (!provider) continue;
                        let userPrompt = (subStep.userPrompt || '{content}')
                            .replace('{content}', inputForBranches)
                            .replace('{result}', branchContent);
                        const resp = await provider.call({
                            model: subStep.model || 'gpt-4.1',
                            systemPrompt: subStep.systemPrompt || '',
                            userPrompt,
                            temperature: parseFloat(subStep.temperature || '0.7'),
                            maxTokens: 4096,
                            customParams: subStep.customParams || {},
                        });
                        branchContent = resp.content;
                    }
                }
                branchResults[branchName] = branchContent;
            }

            if (idx < this.historySteps.length) {
                this.historySteps[idx].parallelBranches = branchResults;
                this.historySteps[idx].output = JSON.stringify(branchResults);
                this.historySteps[idx].status = 'completed';
            }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else if (type === 'wizard') {
            const wizardName = step.params?.wizard || '';
            const wizardData = step.params?.wizardData || '{}';
            const content = this._currentContent();
            this.waitingForWizard = true;

            this.postBridge('wizard_step_pause', JSON.stringify({
                index: idx, wizard: wizardName,
                wizardData: JSON.parse(wizardData), content
            }));

            const valuesJson = await new Promise(res => { this._wizardResolve = res; });
            this.waitingForWizard = false;

            if (idx < this.historySteps.length) {
                this.historySteps[idx].output = valuesJson || '{}';
                this.historySteps[idx].status = 'completed';
            }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else if (type === 'filter') {
            const content = this._currentContent();
            const mode = step.params?.mode || 'manual';
            const splitBy = step.params?.splitBy || '';
            this.waitingForFilter = true;

            let blocks;
            if (splitBy && content) {
                blocks = content.split(splitBy);
            } else {
                blocks = [content];
            }
            const outputs = blocks.map((c, i) => ({ index: i, content: c }));

            if (mode === 'auto') {
                this.waitingForFilter = false;
                if (idx < this.historySteps.length) {
                    this.historySteps[idx].status = 'completed';
                    this.historySteps[idx].output = content;
                }
                this.postBridge('step_done', JSON.stringify({ index: idx }));
                return;
            }

            this.postBridge('step_filter_pause', JSON.stringify({ index: idx, mode, outputs }));
            const decision = await new Promise(res => { this._filterResolve = res; });
            this.waitingForFilter = false;

            if (idx < this.historySteps.length) {
                this.historySteps[idx].status = 'completed';
                this.historySteps[idx].output = content;
            }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else if (type === 'evaluate') {
            const content = this._currentContent();
            const criteria = step.params?.criteria || '';
            const rubric = step.params?.rubric || '1-10';
            if (idx < this.historySteps.length) {
                this.historySteps[idx].status = 'completed';
                this.historySteps[idx].output = content;
            }
            this.postBridge('evaluate_result', JSON.stringify({ stepIndex: idx, content, criteria, rubric }));
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else if (type === 'chest') {
            const chestName = step.params?.chestName || '';
            const mode = step.params?.mode || 'put';
            const content = this._currentContent();

            if (mode === 'put') {
                this.postBridge('chest_put', JSON.stringify({ chestName, content }));
            } else if (mode === 'take') {
                this.postBridge('chest_take', JSON.stringify({ chestName }));
            }
            if (idx < this.historySteps.length) {
                this.historySteps[idx].status = 'completed';
            }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else if (type === 'condition') {
            const content = this._currentContent();
            if (idx < this.historySteps.length) {
                this.historySteps[idx].status = 'completed';
                this.historySteps[idx].output = content;
            }
            this.postBridge('step_done', JSON.stringify({ index: idx }));

        } else {
            this.postBridge('log', JSON.stringify({ message: '⚠ Unimplemented step type: ' + type + ' — skipped' }));
            if (idx < this.historySteps.length) {
                this.historySteps[idx].status = 'skipped';
            }
        }
    }

    _buildMeta() {
        const lastStep = this.historySteps[this.historySteps.length - 1];
        const meta = {
            id: this.runId,
            pipelineName: this.pipelineName,
            startedAt: this.startedAt,
            status: 'completed',
            outputMode: this.outputMode,
            // AI comment = the model's internal reasoning; carried separately so
            // the frontend can show it without treating it as output.
            reasoning: lastStep ? (lastStep.reasoning || '') : '',
            steps: this.historySteps.map(s => ({
                index: s.index, name: s.name, type: s.type,
                input: s.input, output: s.output, status: s.status,
                reasoning: s.reasoning || '',
                promptTokens: s.promptTokens, completionTokens: s.completionTokens,
                parallelBranches: s.parallelBranches,
                requestUrl: s.requestUrl,
                requestBody: s.requestBody,
                outputAttachments: s.artifacts || [],
            })),
        };
        // Phase A: Include requestContext for concurrent request routing
        if (this.requestContext?.requestId) meta.requestId = this.requestContext.requestId;
        if (this.requestContext?.targetNodePath) meta.targetNodePath = this.requestContext.targetNodePath;
        if (this.requestContext?.runId) meta.runId = this.requestContext.runId;
        return JSON.stringify(meta);
    }
}

// ============================================================
// Pipeline Version Manager (simplified)
// ============================================================
class PipelineVersionManager {
    constructor(storage) {
        this.storage = storage;
        this.cursors = {};
    }

    _getVersionsPath(name) {
        return path.join(this.storage.basePath, 'optimizer', name + '_versions.json');
    }

    _loadVersions(name) {
        const p = this._getVersionsPath(name);
        return readJson(p, { versions: [], currentVersion: 0, headVersion: 0 });
    }

    _saveVersions(name, data) {
        ensureDir(path.join(this.storage.basePath, 'optimizer'));
        writeJson(this._getVersionsPath(name), data);
    }

    ensureBaseVersion(name, pipeline) {
        const data = this._loadVersions(name);
        if (data.versions.length === 0) {
            data.versions.push({ version: 1, pipeline: JSON.parse(JSON.stringify(pipeline)), timestamp: nowIso(), label: 'Base' });
            data.currentVersion = 1;
            data.headVersion = 1;
            this._saveVersions(name, data);
        }
        return data;
    }

    commitVersion(name, pipeline, sessionId, label, proposals) {
        const data = this._loadVersions(name);
        const next = data.headVersion + 1;
        data.versions.push({ version: next, pipeline: JSON.parse(JSON.stringify(pipeline)), timestamp: nowIso(), label, sessionId });
        data.currentVersion = next;
        data.headVersion = next;
        this._saveVersions(name, data);
        return next;
    }

    getCursor(name) {
        const data = this._loadVersions(name);
        return {
            pipelineName: name,
            currentVersion: data.currentVersion,
            headVersion: data.headVersion,
            entries: data.versions.map(v => ({ version: v.version, timestamp: v.timestamp, label: v.label, sessionId: v.sessionId || '' })),
        };
    }

    _findPipeline(name, version) {
        const data = this._loadVersions(name);
        const entry = data.versions.find(v => v.version === version);
        return entry ? entry.pipeline : null;
    }

    undo(name) {
        const data = this._loadVersions(name);
        if (data.currentVersion <= 1) return null;
        data.currentVersion--;
        this._saveVersions(name, data);
        return this._findPipeline(name, data.currentVersion);
    }

    redo(name) {
        const data = this._loadVersions(name);
        if (data.currentVersion >= data.headVersion) return null;
        data.currentVersion++;
        this._saveVersions(name, data);
        return this._findPipeline(name, data.currentVersion);
    }

    checkoutVersion(name, version) {
        const data = this._loadVersions(name);
        const entry = data.versions.find(v => v.version === version);
        if (!entry) return null;
        data.currentVersion = version;
        this._saveVersions(name, data);
        return entry.pipeline;
    }

    reapplyVersion(name, version, current) {
        return this._findPipeline(name, version) || current;
    }
}

// ============================================================
// Pipeline Optimizer (stub — calls AI for proposals)
// ============================================================
class PipelineOptimizer {
    constructor(storage) {
        this.storage = storage;
    }

    loadRejectedBuffer(name) {
        const raw = this.storage.loadOptimizerData(name + '_rejected.json');
        return raw ? JSON.parse(raw) : [];
    }

    saveRejectedBuffer(name, buffer) {
        this.storage.saveOptimizerData(name + '_rejected.json', JSON.stringify(buffer));
    }

    async startSession(name, pipeline, historyLimit, maxEdits, providerName, apiKey, baseUrl, model, callback) {
        const sessionId = generateRunId();
        callback('log', JSON.stringify({ message: '🔍 Analyzing pipeline for optimization...' }));

        const provider = createProvider(providerName, apiKey, baseUrl);
        if (!provider) {
            callback('optimize_error', JSON.stringify({ message: 'Unknown provider: ' + providerName }));
            return;
        }

        try {
            const pipelineJson = JSON.stringify(pipeline, null, 2);
            const resp = await provider.call({
                model,
                systemPrompt: 'You are a pipeline optimization expert. Analyze the pipeline and suggest improvements.',
                userPrompt: `Analyze this pipeline and suggest improvements as JSON proposals:\n${pipelineJson}\n\nRespond with JSON: {"proposals": [{"op": "modify", "stepName": "...", "field": "...", "oldValue": "...", "newValue": "...", "rationale": "..."}]}`,
                temperature: 0.7,
                maxTokens: 2048,
            });

            let proposals = [];
            try {
                const parsed = JSON.parse(resp.content);
                proposals = parsed.proposals || [];
            } catch {
                proposals = [{ op: 'note', stepName: '', field: '', oldValue: '', newValue: resp.content, rationale: 'AI analysis' }];
            }

            callback('optimize_proposals', JSON.stringify({ sessionId, proposals }));
        } catch (e) {
            callback('optimize_error', JSON.stringify({ message: String(e) }));
        }
    }

    static applyApprovals(pipeline, approved, rejected, session) {
        const updated = JSON.parse(JSON.stringify(pipeline));
        for (const idx of approved) {
            const prop = session.proposals[idx];
            if (!prop) continue;
            const step = updated.steps?.find(s => s.name === prop.stepName);
            if (step && prop.field && prop.newValue !== undefined) {
                if (!step.params) step.params = {};
                step.params[prop.field] = prop.newValue;
            }
        }
        return updated;
    }
}

// ============================================================
// App State
// ============================================================
const storage = new Storage();
const runner = new PipelineRunner();
const versionMgr = new PipelineVersionManager(storage);
const optimizer = new PipelineOptimizer(storage);

let mainWindow = null;
let appDataPath = '';
let recentFilesManager = null;
let activeOptSession = null;
let localization = { lang: 'en' };
let embedded = false;
let devMode = false;

function postToJS(type, payload) {
    if (type === 'log') {
        try {
            const msg = typeof payload === 'string' ? JSON.parse(payload) : payload;
            console.log('[Wend]', msg.message || payload);
        } catch { console.log('[Wend]', payload); }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bridge-message', JSON.stringify({ type, payload: typeof payload === 'string' ? JSON.parse(payload) : payload }));
    }
}

runner.setBridgeCallback((type, json) => {
    if (type === 'pipeline_completed') storage.saveHistory(json);
    postToJS('log', JSON.stringify({ message: '🏃 Pipeline: ' + type }));
    postToJS(type, JSON.parse(json));
});

// ============================================================
// Demo (Sample) Discovery & Seeding
// ============================================================
function listDemos() {
    const samplesRoot = path.join(__dirname, '..', 'sample');
    if (!fs.existsSync(samplesRoot)) return [];
    return fs.readdirSync(samplesRoot, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => {
            const manifestPath = path.join(samplesRoot, e.name, 'manifest.json');
            if (!fs.existsSync(manifestPath)) return null;
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                return { sampleSubDir: e.name, ...manifest };
            } catch { return null; }
        })
        .filter(Boolean);
}

function seedDemoProject(sampleSubDir) {
    if (!sampleSubDir || sampleSubDir.includes('..')) return false;
    const sampleDir = path.join(__dirname, '..', 'sample', sampleSubDir);
    if (!fs.existsSync(sampleDir)) return false;

    const manifestPath = path.join(sampleDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return false;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const projectName = manifest.projectName;
    if (!projectName) return false;

    const projPath = path.join(appDataPath, 'projects', projectName);
    storage.init(projPath);

    const recipesPath = path.join(sampleDir, 'projectrecipes.json');
    if (fs.existsSync(recipesPath)) {
        storage.saveProjectRecipes(JSON.parse(fs.readFileSync(recipesPath, 'utf8')));
    }

    const providersPath = path.join(sampleDir, 'providers.json');
    if (fs.existsSync(providersPath)) {
        storage.saveProviders(JSON.parse(fs.readFileSync(providersPath, 'utf8')));
    }

    const pipelinesPath = path.join(sampleDir, 'pipelines.json');
    if (fs.existsSync(pipelinesPath)) {
        storage.savePipelines(JSON.parse(fs.readFileSync(pipelinesPath, 'utf8')).pipelines || []);
    }

    const entries = fs.readdirSync(sampleDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));

    const tabs = [];
    for (const entry of entries) {
        const tabSrcFile = path.join(sampleDir, entry.name, 'radio.json');
        if (!fs.existsSync(tabSrcFile)) continue;
        const tabFile = entry.name + '.json';
        storage.saveTabData(tabFile, JSON.parse(fs.readFileSync(tabSrcFile, 'utf8')));
        tabs.push({ name: entry.name, file: tabFile });
    }

    if (tabs.length > 0) storage.saveSession({ tabs });
    return { projectName, count: tabs.length };
}

// ============================================================
// Full Init
// ============================================================
function sendFullInit() {
    postToJS('log', JSON.stringify({ message: '[TRACE] SendFullInit: loading session...' }));

    // Ensure session.json exists
    const sessionPath = path.join(storage.getBasePath(), 'session.json');
    if (!fs.existsSync(sessionPath)) {
        const tab = { name: 'default.wendbt', file: 'default.wendbt' };
        storage.saveTabData('default.wendbt', { title: '', content: '', mimetype: 'text/plain', attachments: [], children: [] });
        storage.saveSession({ tabs: [tab] });
        postToJS('log', JSON.stringify({ message: `[TRACE] Created empty session.json` }));
    }

    let session = storage.loadSession();
    if (!session.tabs || session.tabs.length === 0) {
        const tab = { name: 'default.wendbt', file: 'default.wendbt' };
        storage.saveTabData('default.wendbt', { title: '', content: '', mimetype: 'text/plain', attachments: [], children: [] });
        session = { tabs: [tab] };
        storage.saveSession(session);
    }

    const nodes = {};
    for (const tab of session.tabs) {
        nodes[tab.file] = storage.loadTabData(tab.file);
    }

    // Ensure pipelines.json exists
    const pipelinesPath = path.join(storage.getBasePath(), 'pipelines.json');
    if (!fs.existsSync(pipelinesPath)) {
        storage.savePipelines([]);
        postToJS('log', JSON.stringify({ message: `[TRACE] Created empty pipelines.json` }));
    }

    const pipelines = storage.loadPipelines();

    const providers = storage.loadProviders();
    for (const [name, cfg] of Object.entries(providers)) {
        runner.registerProvider(name, cfg.apiFormat || name, cfg.apiKey || '', cfg.baseUrl || '');
    }
    // MockProvider is always available — no API key required
    runner.registerProvider('mock', 'mock', '', '');
    // Voicebox — local TTS, available if running at default URL
    runner.registerProvider('voicebox', 'voicebox', '', 'http://127.0.0.1:17493');
    if (!providers.mock) {
        providers.mock = { apiKey: '', baseUrl: '', models: ['echo', 'fixed', 'image-echo', 'image-compose'] };
    }
    // MockHTTPProvider — connects to a running MockHTTPAIServer (test_mock_ai_server.exe)
    const mockHttpBaseUrl = providers['mock-http']?.baseUrl || 'http://localhost:8765';
    runner.registerProvider('mock-http', 'mock-http', '', mockHttpBaseUrl);
    if (!providers['mock-http']) {
        providers['mock-http'] = { apiKey: '', baseUrl: 'http://localhost:8765', models: ['echo', 'image-echo', 'image-compose'] };
    }

    recentFilesManager = new RecentFilesManager(storage);
    recentFilesManager.load();

    const generalCfg = storage.loadGeneralConfig();
    storage.maxHistoryRuns = generalCfg.historyRetention || 50;

    const chestList = storage.listNamedChests();
    const defaultRecipes = storage.loadDefaultRecipes();
    const projectRecipes = storage.loadProjectRecipes();
    const projectBlackboard = storage.loadProjectBlackboard();

    const bootstrap = loadBootstrapConfig();
    const projectsRoot = bootstrap.projectsRoot || '';
    const projectsRootDefault = getDefaultDataPath();

    // Load app icon as base64 PNG for About dialog
    let appIconDataUrl = '';
    try {
        const icoPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.png')
            : path.join(__dirname, '..', 'images', 'app.png');
        if (fs.existsSync(icoPath)) {
            const img = nativeImage.createFromPath(icoPath);
            const resized = img.resize({ width: 128, height: 128 });
            appIconDataUrl = resized.toDataURL();
        }
    } catch {}

    postToJS('init', {
        language: localization.lang,
        embedded,
        appDataPath,
        frontendRoot: FRONTEND_ROOT,
        currentProject: loadBootstrapConfig().currentProject || 'Default',
        tabs: session.tabs,
        placeholderArchiveName: session.placeholderArchiveName || 'archive',
        collapsedPaths: session.collapsedPaths || [],
        nodes,
        pipelines,
        providers,
        providerCapabilities,
        recentFiles: recentFilesManager.get(),
        config: {
            historyRetention: generalCfg.historyRetention,
            chestList,
            defaultProvider: generalCfg.defaultProvider,
            defaultModel: generalCfg.defaultModel,
            theme: generalCfg.theme || 'dark',
            customThemeColors: generalCfg.customThemeColors || null,
            projectsRoot,
            projectsRootDefault,
            maintainRecipe: generalCfg.maintainRecipe || '',
            logHttpHeaders: generalCfg.logHttpHeaders || false
        },
        defaultRecipes,
        projectRecipes,
        projectBlackboard,
        appIconDataUrl,
        demos: listDemos(),
        defaultProviders: _appProviderDefs,
    });

    postToJS('log', JSON.stringify({ message: '[TRACE] SendFullInit: init posted' }));
}

// ============================================================
// Phase B: Job Registry for multi-instance BT execution
// ============================================================
const _jobRegistry = {
    jobs: new Map(),    // runId → { status, file, group, outputKey, result, error, engine, startedAt }
    groups: new Map(),  // groupId → Set<runId>
};

function createJob(runId, file, group, outputKey) {
    const job = {
        runId,
        file,
        group: group || null,
        outputKey: outputKey || null,
        status: 'initializing',
        result: null,
        error: null,
        engine: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        // Phase F-D: Metrics
        metrics: {
            duration: null,      // ms
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
        }
    };
    _jobRegistry.jobs.set(runId, job);
    if (group) {
        if (!_jobRegistry.groups.has(group)) {
            _jobRegistry.groups.set(group, new Set());
        }
        _jobRegistry.groups.get(group).add(runId);
    }
    return job;
}

function updateJobStatus(runId, status, result = null, error = null) {
    const job = _jobRegistry.jobs.get(runId);
    if (job) {
        job.status = status;
        if (result) job.result = result;
        if (error) job.error = error;
    }
}

function getGroupJobs(groupId) {
    const runIds = _jobRegistry.groups.get(groupId) || new Set();
    return Array.from(runIds).map(rid => _jobRegistry.jobs.get(rid)).filter(j => j);
}

// ============================================================
// Phase D: Concurrent Execution (true parallelism)
// Phase F-A: maxParallel control (rate limiting)
// Phase H: HTTP request queueing for LLM call concurrency control
// ============================================================
const _executionState = {
    pendingRuns: new Map(),  // runId → { resolve, reject, timeout }
    queue: [],              // Phase F-A: { runId, file, tree, inputs }[]
    activeCount: 0,         // Phase F-A: currently executing count
    maxParallel: 4,         // Phase F-A: max concurrent executions (tunable)
    cancelledRuns: new Set(), // Phase F-C: cancelled runIds (cooperative cancellation)
    retryConfig: { maxRetries: 3, retryDelay: 1000 }, // Phase F-C: retry policy
    // Phase H: HTTP request queueing
    httpQueue: [],          // { callback, runId }[]
    activeLLMCalls: 0,      // currently executing HTTP LLM calls
    maxConcurrentLLMCalls: 4, // max parallel HTTP requests (tunable, default 4)
};

/**
 * Phase F-A: Enqueue run for execution with maxParallel control.
 * Queue is processed respecting maxParallel limit.
 */
function enqueueRun(runId, file, tree, inputs) {
    const job = _jobRegistry.jobs.get(runId);
    if (!job) return;

    // Phase F-A: Add to queue, then process
    _executionState.queue.push({ runId, file, tree, inputs });
    processExecutionQueue();
}

/**
 * Phase F-A: Process execution queue respecting maxParallel limit.
 */
function processExecutionQueue() {
    while (_executionState.activeCount < _executionState.maxParallel && _executionState.queue.length > 0) {
        const { runId, file, tree, inputs } = _executionState.queue.shift();
        _executionState.activeCount++;

        // Phase F-A: Execute asynchronously (non-blocking)
        executeRun(runId, file, tree, inputs).finally(() => {
            _executionState.activeCount--;
            processExecutionQueue();  // Process next in queue
        }).catch(err => {
            updateJobStatus(runId, 'failed', null, err.message);
            postToJS('log', JSON.stringify({ message: `[Phase F-A] Run ${runId} error: ${err.message}` }));
        });
    }
}

/**
 * Phase H: HTTP request queueing for LLM call concurrency control.
 * Enqueue an HTTP request (LLM call) with rate limiting.
 */
async function enqueueHttpRequest(callback, runId) {
    return new Promise((resolve, reject) => {
        _executionState.httpQueue.push({ callback, runId, resolve, reject });
        processHttpQueue();
    });
}

/**
 * Phase H: Process HTTP request queue respecting maxConcurrentLLMCalls limit.
 */
function processHttpQueue() {
    while (_executionState.activeLLMCalls < _executionState.maxConcurrentLLMCalls && _executionState.httpQueue.length > 0) {
        const { callback, runId, resolve, reject } = _executionState.httpQueue.shift();
        _executionState.activeLLMCalls++;

        // Execute HTTP request asynchronously
        Promise.resolve()
            .then(() => callback())
            .then(result => resolve(result))
            .catch(err => reject(err))
            .finally(() => {
                _executionState.activeLLMCalls--;
                processHttpQueue();  // Process next in queue
            });
    }
}

/**
 * Phase D: Execute a single run (async, non-blocking).
 * Phase F-C: With retry logic and cancellation support.
 */
async function executeRun(runId, file, tree, inputs, retryCount = 0) {
    const job = _jobRegistry.jobs.get(runId);
    if (!job) return;

    // Phase F-C: Check for cancellation
    if (isCancelled(runId)) {
        updateJobStatus(runId, 'cancelled');
        return;
    }

    try {
        updateJobStatus(runId, 'loading');

        // Phase D: Load BT from file or tree
        let btTree = tree;
        if (file && !tree) {
            const fileContent = fs.readFileSync(file, 'utf-8');
            btTree = JSON.parse(fileContent);
        }

        if (!btTree) {
            throw new Error('No BT file or tree provided');
        }

        updateJobStatus(runId, 'running');

        // Phase D: Request frontend to execute BT engine
        // This returns immediately; execution completion will arrive via IPC (bt_run_complete)
        return await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (_executionState.pendingRuns.has(runId)) {
                    _executionState.pendingRuns.delete(runId);
                    reject(new Error('timeout'));
                }
            }, 300000); // 5 min timeout

            _executionState.pendingRuns.set(runId, { resolve, reject, timeout });
            postToJS('bt_run_async_request', { runId, btTree, inputs });
        });
    } catch (err) {
        // Phase F-C: Retry logic
        const { maxRetries, retryDelay } = _executionState.retryConfig;
        if (retryCount < maxRetries && !isCancelled(runId)) {
            postToJS('log', JSON.stringify({ message: `[Phase F-C] Run ${runId} retry ${retryCount + 1}/${maxRetries}` }));
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return executeRun(runId, file, tree, inputs, retryCount + 1);
        }
        throw err;
    }
}

/**
 * Phase D: Called from frontend when bt_run_complete IPC arrives.
 * Resolves the pending executeRun promise.
 */
function resolveRunCompletion(runId, result, error) {
    const pending = _executionState.pendingRuns.get(runId);
    const job = _jobRegistry.jobs.get(runId);
    if (!pending) return;

    _executionState.pendingRuns.delete(runId);
    clearTimeout(pending.timeout);

    // Phase F-D: Record metrics
    if (job) {
        job.endedAt = new Date().toISOString();
        const startTime = new Date(job.startedAt).getTime();
        const endTime = new Date(job.endedAt).getTime();
        job.metrics.duration = endTime - startTime;

        // Extract token info from result metadata if available
        if (result && typeof result === 'object' && result.tokens) {
            job.metrics.promptTokens = result.tokens.prompt || 0;
            job.metrics.completionTokens = result.tokens.completion || 0;
            job.metrics.totalTokens = (result.tokens.prompt || 0) + (result.tokens.completion || 0);
        }
    }

    if (error) {
        updateJobStatus(runId, 'failed', null, error);
        pending.reject(new Error(error));
    } else {
        updateJobStatus(runId, 'completed', result);
        pending.resolve();
    }
}

// ============================================================
// BT HTTP API Server
// ============================================================
let btHttpServer = null;
const BT_API_PORT = 18765;

function startBtHttpServer() {
    btHttpServer = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = body ? JSON.parse(body) : {};
                handleBtApi(req.url, req.method, payload, res);
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    });

    btHttpServer.listen(BT_API_PORT, '127.0.0.1', () => {
        postToJS('log', JSON.stringify({ message: `[BT API] HTTP server running on http://127.0.0.1:${BT_API_PORT}` }));
    });

    btHttpServer.on('error', (err) => {
        postToJS('log', JSON.stringify({ message: `[BT API] Server error: ${err.message}` }));
    });
}

function handleBtApi(rawUrl, method, payload, res) {
    // Split path and query string
    const qIdx = rawUrl.indexOf('?');
    const url = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
    const query = {};
    if (qIdx >= 0) {
        for (const pair of rawUrl.slice(qIdx + 1).split('&')) {
            if (!pair) continue;
            const [k, v] = pair.split('=');
            query[decodeURIComponent(k)] = decodeURIComponent(v || '');
        }
    }
    const routes = {
        '/bt/load':      handleBtLoad,
        '/bt/run':       handleBtRun,
        '/bt/step':      handleBtStep,
        '/bt/pause':     handleBtPause,
        '/bt/stop':      handleBtStop,
        '/bt/status':    handleBtStatus,
        '/bt/blackboard': handleBtBlackboard,
        '/bt/capabilities': handleBtCapabilities,  // Phase H: BT spec discovery
        '/bt/create':    handleBtCreate,
        '/config':       handleConfig,        // Phase F-A: config endpoint
        '/projects':     handleProjects,
        '/tabs':         handleTabs,
        '/recipes':      handleRecipes,
        '/providers':    handleProviders,
        '/screenshot':   handleScreenshot,
    };

    // Phase B: Check exact route first, then pattern routes
    let handler = routes[url];
    if (!handler) {
        // Pattern routes: /runs, /runs/:id/stop, /parallel/*
        if (url === '/runs') {
            handler = handleRuns;
        } else if (url.startsWith('/runs/')) {
            const parts = url.slice(1).split('/');
            if (parts.length === 2) {
                // GET /runs/:runId for detailed info
                handler = (method, payload, res, query) => handleRunGet(method, payload, res, query, parts[1]);
            } else if (parts.length === 3 && parts[2] === 'stop') {
                handler = (method, payload, res, query) => handleRunStop(method, payload, res, query, parts[1]);
            }
        } else if (url === '/parallel/map') {
            handler = handleParallelMap;
        } else if (url === '/parallel/join') {
            handler = handleParallelJoin;
        } else if (url === '/parallel/race') {
            handler = handleParallelRace;
        } else if (url === '/parallel/reduce') {
            handler = handleParallelReduce;
        } else if (url === '/parallel/run') {
            handler = handleParallelRun;  // Phase F-B: Task-parallel (different BTs)
        } else if (url === '/metrics') {
            handler = handleMetrics;  // Phase F-D: Monitoring & Metrics
        }
    }

    if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }

    handler(method, payload, res, query);
}

function handleBtLoad(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    const { filePath } = payload;
    if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'filePath required' }));
        return;
    }

    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
    }

    try {
        const root = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        const tabName = path.basename(filePath, path.extname(filePath));
        const tabFile = `bt_${Date.now()}.wendproject`;

        storage.saveTabData(tabFile, root);
        postToJS('open_file_result', { path: fullPath, name: tabName, file: tabFile });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tabFile, tabName }));
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    }
}

function handleBtRun(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    // Phase B: Support both old (targetPath) and new (file/tree + group) APIs
    const { targetPath, file, tree, group, outputKey } = payload;

    if (targetPath !== undefined) {
        // Old API: single-run from active tab (back-compat)
        postToJS('bt_run_request', { targetPath: targetPath || '' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } else if (file || tree) {
        // New API: create job, generate runId, return it (Phase C: async execution)
        const runId = 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
        createJob(runId, file || null, group || null, outputKey || null);

        // Phase C: Enqueue for background execution
        enqueueRun(runId, file || null, tree || null, payload.inputs || null);
        postToJS('log', JSON.stringify({ message: `[BT API] /bt/run POST: queued job runId=${runId}` }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ runId, status: 'queued' }));
    } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'targetPath or file/tree required' }));
    }
}

function handleBtStep(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    postToJS('bt_step_request', {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
}

function handleBtPause(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    postToJS('bt_pause_request', {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
}

function handleBtStop(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    postToJS('bt_stop_request', {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
}

const _pendingBtRequests = { status: null, blackboard: null };

function _pendingRespond(slot, payload) {
    const p = _pendingBtRequests[slot];
    if (!p) return;
    clearTimeout(p.timer);
    _pendingBtRequests[slot] = null;
    p.res.writeHead(200, { 'Content-Type': 'application/json' });
    p.res.end(JSON.stringify(payload));
}

function handleBtStatus(method, payload, res) {
    if (method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    const timer = setTimeout(() => {
        if (_pendingBtRequests.status?.res === res) {
            _pendingBtRequests.status = null;
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'timeout waiting for bt_status_response' }));
        }
    }, 5000);
    _pendingBtRequests.status = { res, timer };
    postToJS('bt_status_request', {});
}

function handleBtBlackboard(method, payload, res, query = {}) {
    if (method === 'GET') {
        const scope = query.scope || 'run';
        // project scope is on disk — answer synchronously, no frontend round-trip
        if (scope === 'project') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(storage.loadProjectBlackboard()));
            return;
        }
        const timer = setTimeout(() => {
            if (_pendingBtRequests.blackboard?.res === res) {
                _pendingBtRequests.blackboard = null;
                res.writeHead(504, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'timeout waiting for bt_blackboard_response' }));
            }
        }, 5000);
        _pendingBtRequests.blackboard = { res, timer };
        postToJS('bt_blackboard_request', { scope });
    } else if (method === 'POST') {
        const { key, text, media, data, scope } = payload;
        if (!key) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'key required' }));
            return;
        }

        postToJS('bt_blackboard_set', { key, text, media, data, scope: scope || 'run' });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
}

function handleBtCapabilities(method, payload, res) {
    if (method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    // Phase H: BT capabilities discovery for AI planning
    const capabilities = {
        version: '2.0.0',
        engine: 'BehaviorTreeEngine',
        supportedNodeTypes: {
            root: {
                category: 'root',
                description: 'Root node of the behavior tree (required, exactly one)',
                properties: {
                    btType: ['sequence', 'selector', 'parallel', 'memSequence', 'memSelector', 'leaf', 'leaf_ai'],
                    children: 'Array of child nodes',
                }
            },
            composite: {
                types: ['sequence', 'selector', 'parallel', 'memSequence', 'memSelector'],
                description: 'Control flow nodes for multiple children',
                sequence: 'Execute children in order, stop on failure',
                selector: 'Execute children in order, stop on success',
                parallel: 'Execute all children concurrently, majority vote for result',
                memSequence: 'Sequence with memory (restart from failed child)',
                memSelector: 'Selector with memory (restart from successful child)',
            },
            decorator: {
                types: ['invert', 'repeater', 'retry', 'alwaysSucceed', 'alwaysFail', 'guard', 'delay', 'maxTime'],
                description: 'Single-child modifiers',
                invert: 'Negate child result (success→fail, fail→success)',
                repeater: 'Repeat child execution N times',
                retry: 'Retry failed child up to N times',
                alwaysSucceed: 'Always return success regardless of child result',
                alwaysFail: 'Always return failure regardless of child result',
                guard: 'Conditional execution (if condition pass, execute)',
                delay: 'Delay before executing child (milliseconds)',
                maxTime: 'Timeout limit for child execution (milliseconds)',
            },
            leaf: {
                types: ['leaf_ai', 'leaf_math', 'leaf_file', 'leaf_web', 'leaf_misc', 'leaf_next'],
                description: 'Executable action nodes (no children)',
                leaf_ai: 'LLM inference via configured recipe',
                leaf_math: 'JavaScript expression evaluation',
                leaf_file: 'File I/O operations',
                leaf_web: 'HTTP/Web operations',
                leaf_misc: 'Other built-in operations',
                leaf_next: 'FSM state transition — writes fsm.<name> to project blackboard',
            },
            fsm: {
                description: 'Named FSM instances stored in project blackboard as fsm.<name> keys',
                stateRegister: 'proj BB key "fsm.<name>" holds current state string',
                multipleInstances: 'Any number of FSMs can coexist with different names',
                leaf_next: {
                    description: 'Fires a state transition by writing the target state to project BB. Fire-and-forget — does not wait for the target state to complete.',
                    properties: {
                        btFsmName: 'FSM instance name (default: "main")',
                        btFsmState: 'Target state to transition to (required)',
                    },
                    example: { btType: 'leaf_next', btFsmName: 'main', btFsmState: 'analyzing' },
                    conditionalTransition: 'Use guard + selector in the BT to choose which leaf_next fires',
                },
            },
            condition: {
                description: 'Condition evaluation nodes (return pass/fail)',
                types: ['guard'],
            },
        },
        decoratorChains: {
            description: 'Decorators can be chained with + operator',
            example: 'invert+repeater+sequence means: invert(repeater(sequence(...)))',
            syntax: 'decorator1+decorator2+...+composite',
        },
        blackboard: {
            scopes: {
                run: 'Current execution scope (session-only, cleared after run)',
                tab: 'Tab-level scope (persists across multiple runs in same tab)',
                project: 'Project scope (persists across tabs, saved to disk)',
                chest: 'Independent named storage (large files/documents)',
            },
            dataTypes: {
                text: 'UTF-8 text strings',
                media: 'Attachments (images, files, URLs)',
                data: 'Structured JSON (objects, arrays, numbers, booleans)',
            },
            readFallback: 'run → tab → project (first match wins)',
            scopeWrite: 'Writes must explicitly specify target scope',
        },
        placeholders: {
            '{bb:key}': 'Read from run blackboard (falls back to tab → project)',
            '{tab:key}': 'Read from tab blackboard',
            '{proj:key}': 'Read from project blackboard',
            '{chest:name}': 'Read named chest document',
            '{bb:key:json}': 'Read as JSON object (for data types)',
        },
        aiRecipes: {
            description: 'Available LLM models and configurations',
            note: 'Use list_recipes tool to get current project recipes',
            properties: ['name', 'provider', 'model', 'temperature', 'maxTokens'],
        },
        constraints: {
            btRunParallelism: {
                maxParallelRuns: 16,
                defaultMaxParallel: 4,
                description: 'Maximum simultaneous BT executions',
            },
            httpLLMCalls: {
                maxConcurrentLLMCalls: 32,
                defaultMaxConcurrentLLMCalls: 4,
                description: 'Maximum simultaneous HTTP requests to LLM providers',
                note: 'Independent from BT run parallelism; allows fine-grained control over API rate',
            },
            retry: {
                maxRetries: 10,
                description: 'Maximum retry attempts on failure',
            },
            nodePathFormat: 'Number path like "1/2/3" or empty string for root',
            placeholderDepth: 'Nested placeholders not supported',
        },
        registeredActions: {
            loadLocalFile: {
                description: 'Load a file from disk into blackboard as media. File path comes from node config (btLocalFilePath) — static, set at tree-authoring time.',
                pathSource: 'node.btLocalFilePath (node property)',
                outputType: 'Configurable via btOutputType field (defaults to "media"). Also supports btOutputScope.',
                fields: ['localFilePath', 'outputKey', 'outputType'],
                example: { btAction: 'loadLocalFile', btLocalFilePath: 'audio/music.mp3', btOutputKey: 'song', btOutputType: 'media' },
            },
            fileToMedia: {
                description: 'Reads a file path from the blackboard (via inputKey) and loads it as media. File path is dynamic — set at runtime by a previous node.',
                pathSource: 'blackboard[inputKey] (text value, dynamic)',
                outputType: 'Always stores as "media" in "run" scope. Output type is not configurable from fields.',
                fields: ['inputKey', 'outputKey'],
                example: { btAction: 'fileToMedia', btInputKey: 'llmOutput', btOutputKey: 'mediaResult' },
            },
            mediaToFile: {
                description: 'Writes media (audio/video/image) from blackboard to a temp file on disk and stores the resulting file path in blackboard as text. Reverse of fileToMedia.',
                fields: ['inputKey', 'outputKey'],
                note: 'Useful when an LLM generates media content that needs to be saved to disk for downstream processing.',
            },
            playAudio: {
                description: 'Plays audio media from the blackboard (inputKey must contain media with audio mimetype).',
                fields: ['inputKey'],
            },
            playVideo: {
                description: 'Plays video media from the blackboard (inputKey must contain media with video mimetype).',
                fields: ['inputKey'],
            },
            math: {
                description: 'Evaluates a JavaScript expression. Expression comes from btPrompt (node config) or blackboard prompt. Result written to btOutputKey.',
                fields: ['prompt', 'outputKey'],
            },
            web: {
                description: 'Makes HTTP requests. URL and config come from btPrompt / blackboard. Response written to btOutputKey.',
                fields: ['prompt', 'outputKey'],
            },
            misc: {
                description: 'Miscellaneous operations: clipboard copy/paste, write a static value to blackboard, etc.',
                fields: ['prompt', 'outputKey'],
            },
        },
        features: {
            parallelExecution: 'Multiple independent BT runs via spawn_run, map_bt, run_parallel',
            dataParallelism: 'Process same BT over multiple inputs with map_bt',
            taskParallelism: 'Execute different BTs simultaneously with run_parallel',
            resultAggregation: 'Collect and reduce results via join_runs, reduce_results',
            racing: 'Use first successful result via race_runs',
            cooperativeCancellation: 'Cancel runs via cancel_run (stops at next step boundary)',
            retryPolicy: 'Automatic retry on failure with configurable delay',
            requestCorrelation: 'Unique requestId per LLM call for concurrent execution tracking',
        },
        executionModel: {
            singleBT: 'Load BT, run from root or specific node path, wait for completion',
            multiRun: 'Spawn multiple independent BT runs with optional grouping',
            collectiveOps: 'Coordinate groups with join_runs (wait), race_runs (first), reduce_results (aggregate)',
            nonBlocking: 'spawn_run returns immediately; use join_runs to wait for completion',
        },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(capabilities, null, 2));
}

// ============================================================
// Phase B: Job Registry HTTP API Handlers
// ============================================================

function handleRuns(method, payload, res) {
    if (method === 'GET') {
        // GET /runs → list all jobs with state + metrics (Phase G: Task Manager)
        const jobs = Array.from(_jobRegistry.jobs.values()).map(j => ({
            runId: j.runId,
            file: j.file,
            group: j.group,
            outputKey: j.outputKey,
            status: j.status,
            startedAt: j.startedAt,
            endedAt: j.endedAt,
            error: j.error,
            metrics: j.metrics,  // Phase G: Include metrics for Task Manager UI
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ runs: jobs, count: jobs.length }));
    } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
}

function handleRunGet(method, payload, res, query, runId) {
    if (method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }
    const job = _jobRegistry.jobs.get(runId);
    if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Run not found' }));
        return;
    }
    // Phase H: Get detailed run information including metrics
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        runId: job.runId,
        file: job.file,
        group: job.group,
        outputKey: job.outputKey,
        status: job.status,
        result: job.result,
        error: job.error,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        metrics: job.metrics,
    }));
}

function handleRunStop(method, payload, res, query, runId) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }
    const job = _jobRegistry.jobs.get(runId);
    if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Run not found' }));
        return;
    }
    // Phase F-C: Cooperative cancellation (signals next BT step boundary)
    _executionState.cancelledRuns.add(runId);
    updateJobStatus(runId, 'cancelled');

    postToJS('log', JSON.stringify({ message: `[Phase F-C] Run ${runId} marked for cancellation` }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, runId, status: 'cancelled' }));
}

/**
 * Phase F-C: Check if a runId is marked for cancellation.
 * Called from frontend before executing next BT step.
 */
function isCancelled(runId) {
    return _executionState.cancelledRuns.has(runId);
}

// ============================================================
// Extended HTTP API Handlers
// ============================================================

function handleBtCreate(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }
    const { filePath, tree } = payload || {};
    if (!filePath || !tree) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'filePath and tree required' }));
        return;
    }
    try {
        const full = path.resolve(filePath);
        const dir = path.dirname(full);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(full, JSON.stringify(tree, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, filePath: full }));
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    }
}

function handleProjects(method, payload, res) {
    if (method === 'GET') {
        const projectsDir = path.join(appDataPath, 'projects');
        let projects = [];
        if (fs.existsSync(projectsDir)) {
            projects = fs.readdirSync(projectsDir, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => e.name);
        }
        const bootstrap = loadBootstrapConfig();
        const order = bootstrap.projectOrder || [];
        if (order.length > 0) {
            projects.sort((a, b) => {
                const ia = order.indexOf(a), ib = order.indexOf(b);
                if (ia === -1 && ib === -1) return a.localeCompare(b);
                if (ia === -1) return 1; if (ib === -1) return -1;
                return ia - ib;
            });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ projects, current: bootstrap.currentProject || '' }));
    } else if (method === 'POST') {
        const { action, name } = payload || {};
        if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name required' }));
            return;
        }
        try {
            if (action === 'switch') {
                const projPath = path.join(appDataPath, 'projects', name);
                if (!fs.existsSync(projPath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Project not found' }));
                    return;
                }
                storage.init(projPath);
                const bootstrap = loadBootstrapConfig();
                saveBootstrapConfig({ ...bootstrap, currentProject: name });
                if (mainWindow) mainWindow.setTitle(`Wend - ${name}`);
                let session = storage.loadSession();
                const nodes = {};
                for (const tab of session.tabs || []) nodes[tab.file] = storage.loadTabData(tab.file);
                postToJS('project_changed', {
                    projectName: name, tabs: session.tabs || [], nodes,
                    pipelines: storage.loadPipelines(),
                    defaultRecipes: storage.loadDefaultRecipes(),
                    projectRecipes: storage.loadProjectRecipes(),
                    projectBlackboard: storage.loadProjectBlackboard(),
                    placeholderArchiveName: session.placeholderArchiveName || 'archive',
                    collapsedPaths: session.collapsedPaths || [],
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, current: name }));
            } else {
                // create
                const projPath = path.join(appDataPath, 'projects', name);
                storage.init(projPath);
                const bootstrap = loadBootstrapConfig();
                saveBootstrapConfig({ ...bootstrap, currentProject: name });
                if (mainWindow) mainWindow.setTitle(`Wend - ${name}`);
                postToJS('project_changed', { projectName: name, tabs: [], pipelines: [] });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, name }));
            }
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
    } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
}

// Phase F-D: Metrics endpoint (group or global metrics)
function handleMetrics(method, payload, res, query) {
    if (method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    const groupId = query.group;
    let jobs = [];

    if (groupId) {
        jobs = getGroupJobs(groupId);
    } else {
        jobs = Array.from(_jobRegistry.jobs.values());
    }

    // Phase F-D: Aggregate metrics
    const metrics = {
        count: jobs.length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length,
        running: jobs.filter(j => j.status === 'running').length,
        totalDuration: 0,
        totalTokens: 0,
        avgDuration: 0,
        avgTokens: 0,
        jobs: jobs.map(j => ({
            runId: j.runId,
            status: j.status,
            duration: j.metrics.duration,
            tokens: j.metrics.totalTokens,
        }))
    };

    const completedJobs = jobs.filter(j => j.metrics.duration !== null);
    if (completedJobs.length > 0) {
        metrics.totalDuration = completedJobs.reduce((sum, j) => sum + (j.metrics.duration || 0), 0);
        metrics.totalTokens = completedJobs.reduce((sum, j) => sum + (j.metrics.totalTokens || 0), 0);
        metrics.avgDuration = Math.round(metrics.totalDuration / completedJobs.length);
        metrics.avgTokens = Math.round(metrics.totalTokens / completedJobs.length);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics));
}

// Phase F-A/F-C: Configuration endpoint (maxParallel, retry, etc.)
function handleConfig(method, payload, res) {
    if (method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            btRunExecution: {
                maxParallel: _executionState.maxParallel,
                activeCount: _executionState.activeCount,
                queueLength: _executionState.queue.length,
            },
            httpLLMCalls: {
                maxConcurrentLLMCalls: _executionState.maxConcurrentLLMCalls,
                activeLLMCalls: _executionState.activeLLMCalls,
                httpQueueLength: _executionState.httpQueue.length,
            },
            retry: _executionState.retryConfig,
        }));
    } else if (method === 'POST') {
        // Phase F-A: BT run parallelism
        if (payload?.maxParallel !== undefined) {
            _executionState.maxParallel = Math.max(1, Math.min(16, parseInt(payload.maxParallel)));
            postToJS('log', JSON.stringify({ message: `[Phase F-A] maxParallel set to ${_executionState.maxParallel}` }));
            processExecutionQueue();
        }
        // Phase H: HTTP LLM call concurrency control
        if (payload?.maxConcurrentLLMCalls !== undefined) {
            _executionState.maxConcurrentLLMCalls = Math.max(1, Math.min(32, parseInt(payload.maxConcurrentLLMCalls)));
            postToJS('log', JSON.stringify({ message: `[Phase H] maxConcurrentLLMCalls set to ${_executionState.maxConcurrentLLMCalls}` }));
            processHttpQueue();
        }
        // Phase F-C: Update retry config
        if (payload?.retry) {
            _executionState.retryConfig = {
                maxRetries: Math.max(0, payload.retry.maxRetries || 3),
                retryDelay: Math.max(100, payload.retry.retryDelay || 1000),
            };
            postToJS('log', JSON.stringify({ message: `[Phase F-C] Retry config: ${JSON.stringify(_executionState.retryConfig)}` }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            maxParallel: _executionState.maxParallel,
            maxConcurrentLLMCalls: _executionState.maxConcurrentLLMCalls,
            retry: _executionState.retryConfig,
        }));
    } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
}

function handleTabs(method, payload, res) {
    if (method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }
    const session = storage.loadSession();
    const dataDir = storage.dataPath('');
    let files = [];
    try {
        files = fs.readdirSync(dataDir)
            .filter(f => f.endsWith('.wendbt') || f.endsWith('.wendproject'))
            .sort();
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tabs: session.tabs || [], files }));
}

function handleRecipes(method, payload, res) {
    if (method === 'GET') {
        const defaultRecipes = storage.loadDefaultRecipes();
        const projectRecipes = storage.loadProjectRecipes();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ defaultRecipes, projectRecipes }));
    } else if (method === 'POST') {
        const { recipes } = payload || {};
        if (!Array.isArray(recipes)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'recipes array required' }));
            return;
        }
        storage.saveProjectRecipes(recipes);
        postToJS('project_recipes_updated', { recipes });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
}

function handleProviders(method, payload, res) {
    if (method === 'GET') {
        const providers = storage.loadProviders();
        // Mask API keys
        const masked = {};
        for (const [k, v] of Object.entries(providers)) {
            masked[k] = { ...v, apiKey: v.apiKey ? '***' : '' };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(masked));
    } else if (method === 'POST') {
        const providers = payload || {};
        storage.saveProviders(providers);
        for (const [name, cfg] of Object.entries(providers)) {
            runner.registerProvider(name, cfg.apiFormat || name, cfg.apiKey || '', cfg.baseUrl || '');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
}

function handleScreenshot(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Window not available' }));
        return;
    }
    mainWindow.capturePage().then(image => {
        const pngBuffer = image.toPNG();
        const base64 = pngBuffer.toString('base64');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ screenshot: base64 }));
    }).catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    });
}

// ============================================================
// Phase C: Parallel Execution Handlers
// ============================================================

/**
 * Phase F-B: Task-parallel execution (different BTs in parallel).
 * Executes multiple BT specifications concurrently.
 */
function handleParallelRun(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    const { specs, group } = payload;
    if (!specs || !Array.isArray(specs)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'specs array required' }));
        return;
    }

    const groupId = group || ('group_' + Date.now());
    const runIds = [];

    // Phase F-B: Create runId for each spec (different BTs)
    for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        const runId = 'task_' + groupId + '_' + i;
        createJob(runId, spec.file || null, groupId, spec.outputKey || null);
        enqueueRun(runId, spec.file || null, spec.tree || null, spec.inputs || null);
        runIds.push(runId);

        // Phase F-B: Tell frontend to create a tab for this task
        postToJS('create_parallel_tab', { runId, btFile: spec.file });
    }

    postToJS('log', JSON.stringify({ message: `[Phase F-B] run_parallel: groupId=${groupId}, ${runIds.length} tasks queued` }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ groupId, runIds, status: 'queued' }));
}

function handleParallelMap(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    const { file, tree, items, itemKey, maxParallel, group, outputKey } = payload;
    if (!items || !Array.isArray(items)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'items array required' }));
        return;
    }

    const groupId = group || ('group_' + Date.now());
    const runIds = [];

    // Phase C-D: Create runId for each item, enqueue, create tabs for debugging
    for (const item of items) {
        const runId = 'map_' + groupId + '_' + runIds.length;
        createJob(runId, file || null, groupId, outputKey || null);
        const inputs = { [itemKey || 'item']: item };
        enqueueRun(runId, file || null, tree || null, inputs);
        runIds.push(runId);

        // Phase C-D: Tell frontend to create a tab for this run (debug view)
        postToJS('create_parallel_tab', { runId, btFile: file });
    }

    postToJS('log', JSON.stringify({ message: `[Phase C-D] map: groupId=${groupId}, ${runIds.length} items queued + tabs created` }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ groupId, runIds, status: 'queued' }));
}

function handleParallelJoin(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    const { group, policy, minSuccess, timeoutMs } = payload;
    if (!group) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'group required' }));
        return;
    }

    const jobs = getGroupJobs(group);
    const results = [];
    const failures = [];
    let done = true;

    // Phase C: Collect results from all jobs in group
    for (const job of jobs) {
        if (job.status === 'completed') {
            if (job.result) results.push(job.result);
            else failures.push({ runId: job.runId, error: job.error });
        } else if (job.status === 'failed' || job.status === 'error') {
            failures.push({ runId: job.runId, error: job.error });
        } else {
            done = false;  // still running
        }
    }

    // Phase C: Policy check
    if (policy === 'all' && failures.length > 0) {
        done = false;  // wait until all succeed
    } else if (policy === 'any' && results.length < (minSuccess || 1)) {
        done = false;  // wait until minSuccess
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ group, results, failures, done, policy }));
}

function handleParallelRace(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    const { group } = payload;
    if (!group) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'group required' }));
        return;
    }

    const jobs = getGroupJobs(group);
    const winner = jobs.find(j => j.status === 'completed' && j.result);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        group,
        winner: winner ? { runId: winner.runId, value: winner.result } : null,
        done: !!winner
    }));
}

function handleParallelReduce(method, payload, res) {
    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }

    const { group, array, mode, btReduceExpr, initial, saveAs } = payload;

    let values = [];
    if (group) {
        const jobs = getGroupJobs(group);
        values = jobs.filter(j => j.result).map(j => j.result);
    } else if (array) {
        values = array;
    }

    // Phase E: Fold mode (JavaScript expression evaluation)
    if (mode === 'fold' && btReduceExpr) {
        try {
            const reduceFn = new Function('acc', 'item', `return ${btReduceExpr}`);
            const result = values.reduce((acc, item) => reduceFn(acc, item), initial);

            // Phase E: Save to project blackboard if saveAs specified
            if (saveAs) {
                const projectBb = storage.loadProjectBlackboard();
                projectBb[saveAs] = { data: result };
                storage.saveProjectBlackboard(projectBb);
                postToJS('log', JSON.stringify({ message: `[Phase E] Fold result saved to project_bb["${saveAs}"]` }));
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ value: result, mode: 'fold', saved: !!saveAs }));
        } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
    } else if (mode === 'ai') {
        // Phase E: AI reduce - aggregate via LLM
        handleAiReduce(values, payload.prompt, payload.provider, payload.model, payload.saveAs, res);
    } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'mode must be fold or ai' }));
    }
}

/**
 * Phase E: AI-based reduction (aggregate multiple results via LLM).
 * Calls LLM with aggregation prompt + all values.
 */
async function handleAiReduce(values, prompt, provider, model, saveAs, res) {
    try {
        // Phase E: Default aggregation prompt if not provided
        const aggregationPrompt = prompt ||
            `You are given ${values.length} different outputs from parallel executions:\n\n` +
            values.map((v, i) => `[Output ${i+1}]\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`).join('\n\n') +
            `\n\nPlease synthesize these into a single, coherent summary or aggregated result.`;

        // Phase E: Use default provider/model if not specified
        const providerName = provider || 'openai';
        const modelName = model || 'gpt-4';
        const providerCfg = storage.loadProviders()[providerName] || {};
        const prov = createProvider(providerCfg.apiFormat || providerName, providerCfg.apiKey || '', providerCfg.baseUrl || '');

        if (!prov) {
            throw new Error(`Provider ${providerName} not configured`);
        }

        postToJS('log', JSON.stringify({ message: `[Phase E] AI reduce: calling ${providerName}/${modelName}` }));

        // Phase E: Make LLM call
        const request = {
            model: modelName,
            temperature: 0.7,
            messages: [{ role: 'user', content: aggregationPrompt }]
        };

        const result = await prov.call(request);
        const aggregatedResult = result?.content || result?.choices?.[0]?.message?.content || JSON.stringify(result);

        // Phase E: Save to project blackboard if saveAs specified
        if (saveAs) {
            const projectBb = storage.loadProjectBlackboard();
            projectBb[saveAs] = { data: aggregatedResult, text: aggregatedResult };
            storage.saveProjectBlackboard(projectBb);
            postToJS('log', JSON.stringify({ message: `[Phase E] AI reduce result saved to project_bb["${saveAs}"]` }));
        }

        postToJS('log', JSON.stringify({ message: `[Phase E] AI reduce completed: ${aggregatedResult.slice(0, 100)}...` }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ value: aggregatedResult, mode: 'ai', inputs: values.length, saved: !!saveAs }));
    } catch (err) {
        postToJS('log', JSON.stringify({ message: `[Phase E] AI reduce error: ${err.message}` }));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    }
}

// ============================================================
// Bridge Message Handler
// ============================================================
async function handleBridgeMessage(type, payload) {
    switch (type) {
        case 'bt_status_response': {
            _pendingRespond('status', payload);
            break;
        }
        case 'bt_blackboard_response': {
            _pendingRespond('blackboard', payload);
            break;
        }
        case 'bt_run_complete': {
            // Phase D: Async run completed, resolve the pending executeRun promise
            const { runId, result, error } = payload;
            resolveRunCompletion(runId, result, error);
            break;
        }
        case 'get_file_tree': {
            const tree = storage.getFileTreeJson();
            postToJS('file_tree_result', { tree: JSON.parse(tree) });
            break;
        }
        case 'load_file_data': {
            if (payload?.path) {
                // Auto-switch to demo project if opening a file from a known sample dir
                const demos = listDemos();
                const matchedDemo = demos.find(d =>
                    payload.path.includes('sample/' + d.sampleSubDir) ||
                    payload.path.includes('sample\\' + d.sampleSubDir)
                );
                if (matchedDemo) {
                    const projPath = path.join(appDataPath, 'projects', matchedDemo.projectName);
                    storage.init(projPath);
                    if (mainWindow) mainWindow.setTitle(`Wend - ${matchedDemo.projectName}`);
                    postToJS('project_changed', { projectName: matchedDemo.projectName });
                }

                // Load local recipes from same directory
                const dir = path.dirname(payload.path);
                const recipesPath = path.join(dir, 'projectrecipes.json');
                let localRecipes = null;
                if (fs.existsSync(recipesPath)) {
                    try {
                        localRecipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
                    } catch (e) {
                        // Ignore parse errors
                    }
                }

                const root = storage.loadTabData(payload.path);
                postToJS('file_data_result', { path: payload.path, root, localRecipes });
            }
            break;
        }
        case 'rename_file': {
            const { oldFile, newFile } = payload || {};
            if (oldFile && newFile) {
                const oldFull = oldFile.includes(path.sep) ? oldFile : storage.dataPath(oldFile);
                const newFull = newFile.includes(path.sep) ? newFile : storage.dataPath(newFile);
                try {
                    if (fs.existsSync(oldFull)) {
                        ensureDir(path.dirname(newFull));
                        fs.renameSync(oldFull, newFull);
                        postToJS('rename_file_result', { success: true, oldFile, newFile });
                    } else {
                        postToJS('rename_file_result', { success: false, error: `File Rename Error\nOperation: rename_file\nSource: ${oldFull}\nDestination: ${newFull}\nError: Source file does not exist\nAction: Verify the file path is correct and the file exists` });
                    }
                } catch (e) {
                    postToJS('rename_file_result', { success: false, error: `File Rename Error\nOperation: rename_file\nSource: ${oldFull}\nDestination: ${newFull}\nError: ${e.message}\nPossible causes: Permission denied, file in use, or invalid path` });
                }
            }
            break;
        }
        case 'save_node': {
            if (payload?.tabFile && payload?.root) {
                storage.saveTabData(payload.tabFile, payload.root);
                const fullPath = payload.tabFile.includes(path.sep) ? payload.tabFile : storage.dataPath(payload.tabFile);
                postToJS('file_saved', { type: 'node', path: fullPath });
            }
            break;
        }
        case 'set_language': {
            if (payload?.language) localization.lang = payload.language;
            break;
        }
        case 'save_session': {
            const session = storage.loadSession();
            if (payload?.tabs) {
                session.tabs = payload.tabs;
            }
            if (payload?.placeholderArchiveName !== undefined) {
                session.placeholderArchiveName = payload.placeholderArchiveName;
            }
            if (payload?.collapsedPaths !== undefined) {
                session.collapsedPaths = payload.collapsedPaths;
            }
            storage.saveSession(session);
            const fullPath = path.join(storage.getBasePath(), 'session.json');
            postToJS('file_saved', { type: 'session', path: fullPath });
            break;
        }
        case 'run_pipeline': {
            if (payload?.pipelineName) {
                const pipelines = storage.loadPipelines();
                const pipeline = pipelines.find(p => p.name === payload.pipelineName);
                if (pipeline) {
                    const savedProviders = storage.loadProviders();
                    for (const step of pipeline.steps) {
                        if (step.type === 'wizard' && step.params?.wizard && !step.params?.wizardData) {
                            const wd = storage.loadWizardData(step.params.wizard);
                            if (wd) step.params.wizardData = wd;
                        }
                        if (step.type === 'ai' && step.params?.provider) {
                            const pName = step.params.provider;
                            const cfg = savedProviders[pName] || {};
                            const baseUrl = step.params.baseUrl || cfg.baseUrl || '';
                            runner.registerProvider(pName, cfg.apiFormat || pName, cfg.apiKey || '', baseUrl);
                        }
                    }
                    runner.run(pipeline.name, pipeline.steps, payload.content || '', [], pipeline.outputMode || 'child');
                }
            }
            break;
        }
        case 'run_prompt_process': {
            postToJS('log', JSON.stringify({ message: `[Backend] run_prompt_process received: provider=${payload?.provider}, content.length=${(payload?.content||'').length}` }));
            postToJS('log', JSON.stringify({ message: `[Backend] builtinProviders keys: ${Object.keys(builtinProviders).join(', ') || '(none)'}` }));
            if (payload && payload.content !== undefined && payload.content !== null) {
                const step = {
                    name: new Date().toISOString(),
                    type: 'ai',
                    params: {
                        provider: payload.provider || 'openai',
                        model: payload.model || 'gpt-4.1',
                        systemPrompt: payload.systemPrompt || '',
                        userPrompt: payload.userPrompt || '{content}',
                        temperature: String(payload.temperature ?? 0.7),
                        baseUrl: payload.baseUrl || '',
                        apiPath: payload.apiPath || '',
                        customParams: payload.customParams || {},
                        recipeName: payload.recipeName || '',
                        nodeTitle: payload.nodeTitle || '',
                        nodeId: payload.nodeId || '',
                    },
                };
                
                // Register provider before running
                const providerName = payload.provider || 'openai';
                const providers = storage.loadProviders();
                const cfg = providers[providerName] || {};
                const baseUrl = payload.baseUrl || cfg.baseUrl || '';
                postToJS('log', JSON.stringify({ message: `[Backend] Registering provider: ${providerName}, apiFormat: ${cfg.apiFormat || providerName}, hasApiKey: ${!!cfg.apiKey}` }));
                const createdProvider = createProvider(cfg.apiFormat || providerName, cfg.apiKey || '', baseUrl);
                postToJS('log', JSON.stringify({ message: `[Backend] createProvider returned: ${createdProvider ? 'OK' : 'null'}` }));
                runner.registerProvider(providerName, cfg.apiFormat || providerName, cfg.apiKey || '', baseUrl);
                postToJS('log', JSON.stringify({ message: `[Backend] Registered providers: ${Object.keys(runner.providers).join(', ') || '(none)'}` }));
                
                // Merge machine-level (operation pane) and belt-level (input pane) attachments
                const allAttachments = [
                    ...(payload.attachments || []),
                    ...(payload.inputAttachments || [])
                ];
                // Phase A: Pass requestId and targetNodePath for concurrent routing
                const requestContext = {
                    requestId: payload.requestId || null,
                    targetNodePath: payload.targetNodePath || null,
                    runId: payload.runId || null,
                };
                runner.run(new Date().toISOString(), [step], payload.content, allAttachments, 'child', requestContext);
                postToJS('log', JSON.stringify({ message: `[Backend] runner.run() called — provider should now make HTTP request` }));
            }
            break;
        }
        case 'test_recipe': {
            // Lightweight single-shot recipe runner for the Recipe Test dialog.
            // Calls the provider directly (no runner / node routing) and returns the result.
            const requestId = payload?.requestId || null;
            try {
                const providerName = payload?.provider || 'openai';
                const cfg = storage.loadProviders()[providerName] || {};
                const baseUrl = payload?.baseUrl || cfg.baseUrl || '';
                const prov = createProvider(cfg.apiFormat || providerName, cfg.apiKey || '', baseUrl);
                if (!prov) {
                    throw new Error(`Provider "${providerName}" not configured\nAction: Configure "${providerName}" with an API key (or Base URL) in Provider Settings`);
                }

                const userPrompt = String(payload?.userPrompt || '').replace(/\{content\}/g, '').replace(/\{result\}/g, '');
                const req = {
                    model: payload?.model || 'gpt-4.1',
                    systemPrompt: payload?.systemPrompt || '',
                    userPrompt,
                    temperature: parseFloat(payload?.temperature ?? 0.7),
                    maxTokens: parseInt(payload?.maxTokens || '4096'),
                    attachments: [],
                    apiPath: payload?.apiPath || '',
                    customParams: payload?.customParams || {},
                };

                postToJS('log', JSON.stringify({ message: `[Recipe Test] Calling ${providerName}/${req.model}...` }));
                const resp = await prov.call(req);
                postToJS('test_recipe_result', JSON.stringify({
                    requestId,
                    success: true,
                    content: resp?.content || '',
                    outputAttachments: resp?.outputAttachments || [],
                    requestUrl: resp?.requestUrl || '',
                }));
            } catch (e) {
                postToJS('log', JSON.stringify({ message: `[Recipe Test] Error: ${e.message || e}` }));
                postToJS('test_recipe_result', JSON.stringify({
                    requestId,
                    success: false,
                    error: String(e && e.message ? e.message : e),
                }));
            }
            break;
        }
        case 'run_command_recipe': {
            const cmd = payload?.command || '';
            const optionsStr = payload?.options || '';
            const inExt = payload?.inExt || '';
            const outExt = payload?.outExt || '';
            const inputAttachments = payload?.inputAttachments || [];
            const requestContext = {
                requestId: payload?.requestId || null,
                targetNodePath: payload?.targetNodePath || null,
                runId: payload?.runId || null,
            };

            if (!cmd) {
                postToJS('pipeline_completed', JSON.stringify({
                    pipelineName: 'command/(no command)',
                    outputContent: 'Error: No command specified in recipe',
                    steps: [],
                    targetNodePath: requestContext.targetNodePath,
                    requestId: requestContext.requestId,
                    runId: requestContext.runId,
                }));
                break;
            }

            const ts = Date.now();
            let inFile = '';
            let outFile = '';

            try {
                if (inputAttachments.length > 0) {
                    const att = inputAttachments[0];
                    if (att.content) {
                        const ext = inExt || ('.' + (att.file || 'tmp').split('.').pop() || 'tmp');
                        inFile = path.join(os.tmpdir(), 'cmd_recipe_in_' + ts + ext);
                        fs.writeFileSync(inFile, Buffer.from(att.content, 'base64'));
                    }
                }

                outFile = path.join(os.tmpdir(), 'cmd_recipe_out_' + ts + (outExt || '.tmp'));

                const cmdExt = path.extname(cmd).toLowerCase();
                let spawnCmd, spawnArgs;

                if (cmdExt === '.bat' || cmdExt === '.cmd') {
                    spawnCmd = 'cmd.exe';
                    spawnArgs = ['/c', cmd, ...optionsStr.split(/\s+/).filter(Boolean), inFile, outFile];
                } else if (cmdExt === '.sh') {
                    spawnCmd = process.platform === 'win32' ? 'bash' : '/bin/bash';
                    spawnArgs = [cmd, ...optionsStr.split(/\s+/).filter(Boolean), inFile, outFile];
                } else {
                    spawnCmd = cmd;
                    spawnArgs = [...optionsStr.split(/\s+/).filter(Boolean), inFile, outFile];
                }

                let output = '';
                const proc = spawn(spawnCmd, spawnArgs, {
                    shell: false,
                    windowsHide: true,
                    timeout: 300000,
                });

                proc.stdout.on('data', chunk => {
                    const text = chunk.toString('utf8');
                    output += text;
                    postToJS('stream_chunk', JSON.stringify({ stepIndex: 0, text }));
                });
                proc.stderr.on('data', chunk => {
                    const text = chunk.toString('utf8');
                    output += text;
                    postToJS('stream_chunk', JSON.stringify({ stepIndex: 0, text }));
                });

                await new Promise((resolve) => {
                    proc.on('close', () => resolve());
                    proc.on('error', e => {
                        output += '\nCommand Error: ' + e.message;
                        resolve();
                    });
                });

                let resultContent = output;
                let outputAttachments = [];

                if (fs.existsSync(outFile)) {
                    const stat = fs.statSync(outFile);
                    if (stat.size > 0) {
                        const outExtLower = outExt.toLowerCase();
                        const textExts = ['.txt', '.json', '.csv', '.xml', '.html', '.md', '.log', '.js', '.ts', '.py', '.sh', '.bat', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf'];
                        if (textExts.includes(outExtLower) || !outExt) {
                            try {
                                resultContent = fs.readFileSync(outFile, 'utf8');
                            } catch (e) {
                                resultContent = output + '\n(Output file read error: ' + e.message + ')';
                            }
                        } else {
                            const data = fs.readFileSync(outFile).toString('base64');
                            const mimeMap = {
                                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                                '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
                                '.pdf': 'application/pdf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
                            };
                            outputAttachments.push({
                                file: path.basename(outFile),
                                mimetype: mimeMap[outExtLower] || 'application/octet-stream',
                                content: data,
                                size: stat.size,
                            });
                            resultContent = '[Output file: ' + path.basename(outFile) + ']';
                        }
                    }
                }

                try { if (inFile) fs.unlinkSync(inFile); } catch {}
                try { fs.unlinkSync(outFile); } catch {}

                const meta = {
                    pipelineName: 'command/' + path.basename(cmd),
                    outputContent: resultContent,
                    outputAttachments: outputAttachments,
                    steps: [{ type: 'command', command: cmd, options: optionsStr, input: inFile, output: outFile }],
                    targetNodePath: requestContext.targetNodePath,
                };
                if (requestContext.requestId) meta.requestId = requestContext.requestId;
                if (requestContext.runId) meta.runId = requestContext.runId;
                postToJS('pipeline_completed', JSON.stringify(meta));

            } catch (e) {
                try { if (inFile) fs.unlinkSync(inFile); } catch {}
                try { if (outFile) fs.unlinkSync(outFile); } catch {}
                postToJS('pipeline_completed', JSON.stringify({
                    pipelineName: 'command/' + path.basename(cmd),
                    outputContent: 'Command Recipe Error: ' + e.message,
                    steps: [],
                    targetNodePath: requestContext.targetNodePath,
                    requestId: requestContext.requestId,
                    runId: requestContext.runId,
                }));
            }
            break;
        }
        case 'cancel_pipeline':
            runner.cancel();
            break;
        case 'wizard_step_resume':
            runner.resumeWizard(JSON.stringify(payload?.values || {}));
            break;
        case 'manual_step_resume':
            runner.resumeManual(payload?.content ?? '');
            break;
        case 'manual_step_cancel':
            runner.cancelManual();
            break;
        case 'step_filter_resume':
            runner.resumeFilter(typeof payload === 'string' ? payload : JSON.stringify(payload));
            break;
        case 'save_pipeline':
            handleSavePipeline(payload);
            break;
        case 'delete_pipeline':
            handleDeletePipeline(payload);
            break;
        case 'open_file':
            openFileDialog();
            break;
        case 'save_file_as':
            saveFileDialog();
            break;
        case 'get_providers': {
            const providers = storage.loadProviders();
            if (!providers.mock) providers.mock = { apiKey: '', baseUrl: '', models: ['echo', 'fixed', 'image-echo', 'image-compose'] };
            if (!providers['mock-http']) providers['mock-http'] = { apiKey: '', baseUrl: 'http://localhost:8765', models: ['echo', 'image-echo', 'image-compose'] };
            
            const customMetadata = {};
            for (const [name, ProviderClass] of Object.entries(customProviders)) {
                try {
                    const tempInstance = new ProviderClass('', '');
                    customMetadata[name] = {
                        name: tempInstance.name(),
                        defaultModels: typeof tempInstance.defaultModels === 'function' ? tempInstance.defaultModels() : []
                    };
                } catch (e) {}
            }
            postToJS('providers_result', { providers, customMetadata });
            break;
        }
        case 'save_providers': {
            const providers = payload || {};
            storage.saveProviders(providers);
            for (const [name, cfg] of Object.entries(providers)) {
                runner.registerProvider(name, cfg.apiFormat || name, cfg.apiKey || '', cfg.baseUrl || '');
            }
            // Always keep mock and mock-http registered after provider updates
            runner.registerProvider('mock', 'mock', '', '');
            runner.registerProvider('mock-http', 'mock-http', '', providers['mock-http']?.baseUrl || 'http://localhost:8765');
            break;
        }
        case 'test_provider_connection': {
            const { provider: prov, apiFormat, apiKey, baseUrl } = payload || {};
            const p = createProvider(apiFormat || prov, apiKey, baseUrl);
            if (p) {
                const testFn = typeof p.testConnection === 'function'
                    ? p.testConnection.bind(p)
                    : async () => '';
                testFn().then(err => {
                    postToJS('test_connection_result', {
                        provider: prov,
                        success: !err,
                        message: err || 'Connection OK',
                    });
                }).catch(err => {
                    postToJS('test_connection_result', { provider: prov, success: false, message: err.message });
                });
            } else {
                postToJS('test_connection_result', { provider: prov, success: false, message: 'Unknown provider' });
            }
            break;
        }
        case 'fetch_models': {
            const prov = payload?.provider;
            if (prov) {
                const providers = storage.loadProviders();
                const cfg = providers[prov] || {};
                const p = createProvider(cfg.apiFormat || prov, cfg.apiKey, cfg.baseUrl);
                if (p) {
                    const listFn = typeof p.listModels === 'function'
                        ? p.listModels.bind(p)
                        : (typeof p.defaultModels === 'function' ? p.defaultModels.bind(p) : async () => []);
                    listFn().then(models => {
                        postToJS('model_list', { provider: prov, models });
                    }).catch(() => {
                        postToJS('model_list', { provider: prov, models: [] });
                    });
                } else {
                    postToJS('model_list', { provider: prov, models: [] });
                }
            }
            break;
        }
        case 'history_list':
            handleHistoryList(payload);
            break;
        case 'history_detail':
            handleHistoryDetail(payload);
            break;
        case 'evaluate_node':
            handleEvaluateNode(payload);
            break;
        case 'evaluate_history_step':
            handleEvaluateHistoryStep(payload);
            break;
        case 'evaluate_history_run':
            handleEvaluateHistoryRun(payload);
            break;
        case 'optimize_pipeline':
            handleOptimizePipeline(payload);
            break;
        case 'optimize_apply':
            handleOptimizeApply(payload);
            break;
        case 'optimize_undo':
            handleOptimizeUndo(payload);
            break;
        case 'optimize_redo':
            handleOptimizeRedo(payload);
            break;
        case 'optimize_checkout':
            handleOptimizeCheckout(payload);
            break;
        case 'optimize_reapply':
            handleOptimizeReapply(payload);
            break;
        case 'optimize_version_list':
            handleOptimizeVersionList(payload);
            break;
        case 'send_to_chest': {
            if (payload?.chestName && payload?.content != null) {
                storage.saveToNamedChest(payload.chestName, payload.content);
            }
            break;
        }
        case 'view_chest': {
            const name = payload?.chestName;
            if (name) {
                const content = storage.loadFromNamedChest(name);
                this.postBridge('chest_view', JSON.stringify({ name, content }));
            }
            break;
        }
        case 'select_input_source': {
            const src = payload?.source;
            if (src === 'chest' && payload?.chestName) {
                runner.setExternalInput(storage.loadFromNamedChest(payload.chestName));
            } else if (src === 'manual' && payload?.content != null) {
                runner.setExternalInput(payload.content);
            } else {
                runner.setExternalInput('');
            }
            break;
        }
        case 'save_config': {
            const cfg = storage.loadGeneralConfig();
            cfg.historyRetention = payload?.historyRetention || 50;
            cfg.defaultProvider  = payload?.defaultProvider  || 'openai';
            cfg.defaultModel     = payload?.defaultModel     || '';
            if (payload?.defaultImageFit) cfg.defaultImageFit = payload.defaultImageFit;
            if (payload?.theme) cfg.theme = payload.theme;
            if (payload?.customThemeColors) cfg.customThemeColors = payload.customThemeColors;
            if (payload?.logHttpHeaders !== undefined) cfg.logHttpHeaders = payload.logHttpHeaders;
            if (payload?.startMockServer !== undefined) {
                const wasRunning = cfg.startMockServer;
                cfg.startMockServer = payload.startMockServer;
                if (cfg.startMockServer && !wasRunning) {
                    startMockServer();
                } else if (!cfg.startMockServer && wasRunning) {
                    stopMockServer();
                }
            }
            storage.saveGeneralConfig(cfg);
            break;
        }
        case 'save_default_recipes': {
            saveDefaultRecipes(payload || []);
            const fullPath = path.join(FRONTEND_ROOT, 'defaults', 'apprecipes.json');
            postToJS('file_saved', { type: 'default_recipes', path: fullPath });
            break;
        }
        case 'save_project_recipes': {
            storage.saveProjectRecipes(payload || []);
            const fullPath = path.join(storage.getBasePath(), 'projectrecipes.json');
            postToJS('file_saved', { type: 'project_recipes', path: fullPath });
            break;
        }
        case 'save_project_blackboard': {
            storage.saveProjectBlackboard(payload?.data || {});
            break;
        }
        case 'save_maintain_config': {
            const cfg = storage.loadGeneralConfig();
            cfg.maintainRecipe = payload?.maintainRecipe || '';
            storage.saveGeneralConfig(cfg);
            break;
        }
        case 'ai_maintain_fix_error': {
            const { error, recipeConfig, context } = payload || {};
            try {
                const cfg = storage.loadGeneralConfig();
                const maintainRecipeName = cfg.maintainRecipe || '';
                if (!maintainRecipeName) {
                    postToJS('ai_maintain_result', { 
                        success: false, 
                        error: `AI Maintenance Error: No maintenance recipe is configured.\n\nPlease go to Application Config → "Maintain by AI" and select a recipe that will be used to analyze and fix errors automatically.\n\nYou can create a dedicated recipe for maintenance tasks with appropriate model and settings.` 
                    });
                    break;
                }
                
                // Load recipes and find the maintenance recipe
                const defaultRecipes = storage.loadDefaultRecipes();
                const projectRecipes = storage.loadProjectRecipes();
                const allRecipes = [...defaultRecipes, ...projectRecipes];
                const maintainRecipe = allRecipes.find(r => r.name === maintainRecipeName);
                
                if (!maintainRecipe) {
                    postToJS('ai_maintain_result', { 
                        success: false, 
                        error: `AI Maintenance Error: The configured maintenance recipe "${maintainRecipeName}" was not found.\n\nPlease check Application Config → "Maintain by AI" and ensure the selected recipe still exists. The recipe may have been deleted or renamed.` 
                    });
                    break;
                }
                
                const providerName = maintainRecipe.provider || 'openai';
                const provider = runner.providers[providerName];
                if (!provider) {
                    postToJS('ai_maintain_result', { 
                        success: false, 
                        error: `AI Maintenance Error: The provider "${providerName}" required by recipe "${maintainRecipeName}" is not available.\n\nThis usually means the provider is missing required settings (API key, base URL, etc.). Please check your Provider Settings and ensure "${providerName}" is fully configured.` 
                    });
                    break;
                }
                
                const systemPrompt = maintainRecipe.systemPrompt || `You are an AI assistant that fixes configuration errors in the Wend app. 
Analyze the error and current recipe configuration, then suggest fixes.
Return your response as JSON with this structure:
{
  "analysis": "Brief explanation of the error",
  "fixes": [
    { "field": "fieldName", "oldValue": "old", "newValue": "new", "reason": "why" }
  ],
  "confidence": 0.0-1.0
}`;
                const userPrompt = `Error: ${error}

Current recipe config:
${JSON.stringify(recipeConfig, null, 2)}

Context: ${context || 'N/A'}

Analyze the error and suggest fixes.`;
                const req = {
                    model: maintainRecipe.model || 'gpt-4o-mini',
                    systemPrompt,
                    userPrompt,
                    temperature: maintainRecipe.temperature ?? 0.3,
                    maxTokens: 2000,
                    attachments: [],
                    apiPath: maintainRecipe.apiPath || '',
                    customParams: maintainRecipe.customParams || {}
                };
                const resp = await provider.call(req);
                let suggestion;
                try {
                    const jsonMatch = resp.content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        suggestion = JSON.parse(jsonMatch[0]);
                    } else {
                        suggestion = { analysis: resp.content, fixes: [], confidence: 0 };
                    }
                } catch (e) {
                    suggestion = { analysis: resp.content, fixes: [], confidence: 0 };
                }
                postToJS('ai_maintain_result', { success: true, suggestion });
            } catch (e) {
                postToJS('ai_maintain_result', { 
                    success: false, 
                    error: `AI Maintenance Error: Failed to analyze the error.\n\nRecipe: ${payload?.recipeConfig?.name || 'unknown'}\nProvider: ${payload?.recipeConfig?.provider || 'unknown'}\nError: ${e.message}\n\nThis could be due to:\n- Network connectivity issues\n- Invalid API key or credentials\n- Provider service being unavailable\n- Rate limiting\n\nPlease check your provider settings and try again.` 
                });
            }
            break;
        }
        case 'ai_maintain_update_config': {
            const { target, instructions } = payload || {};
            try {
                const cfg = storage.loadGeneralConfig();
                const maintainRecipeName = cfg.maintainRecipe || '';
                if (!maintainRecipeName) {
                    postToJS('ai_maintain_result', { 
                        success: false, 
                        error: `AI Maintenance Error: No maintenance recipe is configured.\n\nPlease go to Application Config → "Maintain by AI" and select a recipe that will be used to manage configuration files.\n\nYou can create a dedicated recipe for maintenance tasks with appropriate model and settings.` 
                    });
                    break;
                }
                
                // Load recipes and find the maintenance recipe
                const defaultRecipes = storage.loadDefaultRecipes();
                const projectRecipes = storage.loadProjectRecipes();
                const allRecipes = [...defaultRecipes, ...projectRecipes];
                const maintainRecipe = allRecipes.find(r => r.name === maintainRecipeName);
                
                if (!maintainRecipe) {
                    postToJS('ai_maintain_result', { 
                        success: false, 
                        error: `AI Maintenance Error: The configured maintenance recipe "${maintainRecipeName}" was not found.\n\nPlease check Application Config → "Maintain by AI" and ensure the selected recipe still exists. The recipe may have been deleted or renamed.` 
                    });
                    break;
                }
                
                const providerName = maintainRecipe.provider || 'openai';
                const provider = runner.providers[providerName];
                if (!provider) {
                    postToJS('ai_maintain_result', { 
                        success: false, 
                        error: `AI Maintenance Error: The provider "${providerName}" required by recipe "${maintainRecipeName}" is not available.\n\nThis usually means the provider is missing required settings (API key, base URL, etc.). Please check your Provider Settings and ensure "${providerName}" is fully configured.` 
                    });
                    break;
                }
                let currentContent = '';
                let filePath = '';
                if (target === 'default_recipes') {
                    filePath = path.join(FRONTEND_ROOT, 'defaults', 'apprecipes.json');
                    currentContent = JSON.stringify(getDefaultRecipes(), null, 2);
                } else if (target === 'project_recipes') {
                    filePath = path.join(storage.getBasePath(), 'projectrecipes.json');
                    currentContent = JSON.stringify(storage.loadProjectRecipes(), null, 2);
                } else if (target === 'config') {
                    filePath = path.join(storage.getBasePath(), 'config.json');
                    currentContent = JSON.stringify(storage.loadGeneralConfig(), null, 2);
                } else {
                    postToJS('ai_maintain_result', { 
                        success: false, 
                        error: `AI Maintenance Error: Unknown target "${target}".\n\nValid targets are: default_recipes, project_recipes, config` 
                    });
                    break;
                }
                const systemPrompt = maintainRecipe.systemPrompt || `You are an AI assistant that maintains JSON configuration files for the Wend app.
Update the configuration based on the user's instructions.
Return ONLY the updated JSON, no explanation.`;
                const userPrompt = `Instructions: ${instructions}

Current configuration:
${currentContent}

Return the updated JSON configuration.`;
                const req = {
                    model: maintainRecipe.model || 'gpt-4o-mini',
                    systemPrompt,
                    userPrompt,
                    temperature: maintainRecipe.temperature ?? 0.2,
                    maxTokens: 4000,
                    attachments: [],
                    apiPath: maintainRecipe.apiPath || '',
                    customParams: maintainRecipe.customParams || {}
                };
                const resp = await provider.call(req);
                let updatedJson;
                try {
                    const jsonMatch = resp.content.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
                    if (jsonMatch) {
                        updatedJson = JSON.parse(jsonMatch[0]);
                    } else {
                        postToJS('ai_maintain_result', { 
                            success: false, 
                            error: `AI Maintenance Error: Could not parse AI response as JSON.\n\nThe AI provider returned an invalid response format.\n\nRaw response (first 500 chars):\n${resp.content.substring(0, 500)}` 
                        });
                        break;
                    }
                } catch (e) {
                    postToJS('ai_maintain_result', { 
                        success: false, 
                        error: `AI Maintenance Error: Invalid JSON in AI response.\n\nParse error: ${e.message}\n\nRaw response (first 500 chars):\n${resp.content.substring(0, 500)}` 
                    });
                    break;
                }
                if (target === 'default_recipes') {
                    saveDefaultRecipes(updatedJson);
                } else if (target === 'project_recipes') {
                    storage.saveProjectRecipes(updatedJson);
                } else if (target === 'config') {
                    storage.saveGeneralConfig(updatedJson);
                }
                postToJS('ai_maintain_result', { success: true, updated: updatedJson, filePath });
            } catch (e) {
                postToJS('ai_maintain_result', { 
                    success: false, 
                    error: `AI Maintenance Error: Failed to update configuration.\n\nError: ${e.message}\n\nThis could be due to:\n- Network connectivity issues\n- Invalid API key or credentials\n- Provider service being unavailable\n- Rate limiting\n\nPlease check your provider settings and try again.` 
                });
            }
            break;
        }
        case 'set_history_retention': {
            if (payload?.maxRuns) {
                storage.setMaxHistoryRuns(payload.maxRuns);
                const cfg = storage.loadGeneralConfig();
                cfg.historyRetention = payload.maxRuns;
                storage.saveGeneralConfig(cfg);
            }
            break;
        }
        case 'setup_demo': {
            const { sampleSubDir } = payload || {};
            try {
                const result = seedDemoProject(sampleSubDir);
                if (!result) {
                    postToJS('setup_demo_result', { success: false, sampleSubDir, error: 'Sample folder or manifest not found' });
                    break;
                }
                let session = storage.loadSession();
                const nodes = {};
                for (const tab of session.tabs) {
                    nodes[tab.file] = storage.loadTabData(tab.file);
                }
                const pipelines = storage.loadPipelines();
                const defaultRecipes = storage.loadDefaultRecipes();
                const projectRecipes = storage.loadProjectRecipes();
                // Update window title
                if (mainWindow) mainWindow.setTitle(`Wend - ${result.projectName}`);
                postToJS('project_changed', { projectName: result.projectName, tabs: session.tabs, nodes, pipelines, defaultRecipes, projectRecipes, placeholderArchiveName: session.placeholderArchiveName || 'archive' });
                postToJS('setup_demo_result', { success: true, sampleSubDir, projectName: result.projectName, count: result.count });
            } catch (e) {
                postToJS('setup_demo_result', { success: false, sampleSubDir, error: e.message });
            }
            break;
        }
        case 'select_project': {
            if (payload?.projectName) {
                const newPath = path.join(appDataPath, 'projects', payload.projectName);
                storage.init(newPath);
                let session = storage.loadSession();
                if (!session.tabs || session.tabs.length === 0) {
                    const tab = { name: 'default.wendbt', file: 'default.wendbt' };
                    storage.saveTabData('default.wendbt', { title: '', content: '', mimetype: 'text/plain', attachments: [], children: [] });
                    session = { tabs: [tab] };
                    storage.saveSession(session);
                }
                const nodes = {};
                for (const tab of session.tabs) {
                    nodes[tab.file] = storage.loadTabData(tab.file);
                }
                const pipelines = storage.loadPipelines();
                const defaultRecipes = storage.loadDefaultRecipes();
                const projectRecipes = storage.loadProjectRecipes();
                // Remember current project
                const bootstrap = loadBootstrapConfig();
                saveBootstrapConfig({ ...bootstrap, currentProject: payload.projectName });
                // Update window title
                if (mainWindow) mainWindow.setTitle(`Wend - ${payload.projectName}`);
                postToJS('project_changed', { projectName: payload.projectName, tabs: session.tabs, nodes, pipelines, defaultRecipes, projectRecipes, projectBlackboard: storage.loadProjectBlackboard(), placeholderArchiveName: session.placeholderArchiveName || 'archive', collapsedPaths: session.collapsedPaths || [] });
            }
            break;
        }
        case 'create_project': {
            if (payload?.projectName) {
                const projPath = path.join(appDataPath, 'projects', payload.projectName);
                storage.init(projPath);
                // Remember current project
                const bootstrap = loadBootstrapConfig();
                saveBootstrapConfig({ ...bootstrap, currentProject: payload.projectName });
                // Update window title
                if (mainWindow) mainWindow.setTitle(`Wend - ${payload.projectName}`);
                postToJS('project_changed', { projectName: payload.projectName, tabs: [], pipelines: [] });
            }
            break;
        }
        case 'list_projects': {
            const projectsDir = path.join(appDataPath, 'projects');
            let projects = [];
            if (fs.existsSync(projectsDir)) {
                const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
                projects = entries
                    .filter(entry => entry.isDirectory())
                    .map(entry => entry.name);
            }
            // Sort by stored order if available
            const bootstrap = loadBootstrapConfig();
            const order = bootstrap.projectOrder || [];
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
            postToJS('project_list', { projects });
            break;
        }
        case 'move_project': {
            if (payload?.name && payload?.direction) {
                const projectsDir = path.join(appDataPath, 'projects');
                let projects = [];
                if (fs.existsSync(projectsDir)) {
                    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
                    projects = entries
                        .filter(entry => entry.isDirectory())
                        .map(entry => entry.name);
                }
                const bootstrap = loadBootstrapConfig();
                let order = bootstrap.projectOrder || [];
                // Initialize order if empty
                if (order.length === 0) {
                    order = [...projects].sort((a, b) => a.localeCompare(b));
                }
                // Ensure all projects are in order
                for (const p of projects) {
                    if (!order.includes(p)) order.push(p);
                }
                const idx = order.indexOf(payload.name);
                if (idx !== -1) {
                    if (payload.direction === 'up' && idx > 0) {
                        [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
                    } else if (payload.direction === 'down' && idx < order.length - 1) {
                        [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
                    }
                    saveBootstrapConfig({ ...bootstrap, projectOrder: order });
                }
                // Refresh list
                postToJS('project_list', { projects: order });
            }
            break;
        }
        case 'rename_project': {
            if (payload?.oldName && payload?.newName) {
                const oldPath = path.join(appDataPath, 'projects', payload.oldName);
                const newPath = path.join(appDataPath, 'projects', payload.newName);
                if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
                    fs.renameSync(oldPath, newPath);
                    // Update bootstrap config
                    const bootstrap = loadBootstrapConfig();
                    if (bootstrap.currentProject === payload.oldName) {
                        bootstrap.currentProject = payload.newName;
                    }
                    if (bootstrap.projectOrder) {
                        const idx = bootstrap.projectOrder.indexOf(payload.oldName);
                        if (idx !== -1) bootstrap.projectOrder[idx] = payload.newName;
                    }
                    saveBootstrapConfig(bootstrap);
                    postToJS('project_renamed', { oldName: payload.oldName, newName: payload.newName });
                    // Refresh list
                    const projectsDir = path.join(appDataPath, 'projects');
                    let projects = [];
                    if (fs.existsSync(projectsDir)) {
                        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
                        projects = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
                    }
                    postToJS('project_list', { projects });
                    } else {
                        postToJS('project_error', { message: `Project Rename Error\nOperation: rename_project\nOld Name: ${payload.oldName}\nNew Name: ${payload.newName}\nError: Project not found or name already exists\nAction: Verify the project exists and the new name is unique` });
                    }
            }
            break;
        }
        case 'duplicate_project': {
            if (payload?.sourceName && payload?.newName) {
                const sourcePath = path.join(appDataPath, 'projects', payload.sourceName);
                const destPath = path.join(appDataPath, 'projects', payload.newName);
                if (fs.existsSync(sourcePath) && !fs.existsSync(destPath)) {
                    copyDirSync(sourcePath, destPath);
                    postToJS('project_duplicated', { sourceName: payload.sourceName, newName: payload.newName });
                    // Refresh list
                    const projectsDir = path.join(appDataPath, 'projects');
                    let projects = [];
                    if (fs.existsSync(projectsDir)) {
                        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
                        projects = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
                    }
                    postToJS('project_list', { projects });
                    } else {
                        postToJS('project_error', { message: `Project Duplicate Error\nOperation: duplicate_project\nSource: ${payload.sourceName}\nDestination: ${payload.newName}\nError: Source not found or destination name already exists\nAction: Verify the source project exists and the new name is unique` });
                    }
            }
            break;
        }
        case 'delete_project': {
            if (payload?.name) {
                const bootstrap = loadBootstrapConfig();
                if (payload.name === bootstrap.currentProject) {
                    postToJS('project_error', { message: `Project Delete Error\nOperation: delete_project\nProject: ${payload.name}\nError: Cannot delete active project\nAction: Switch to a different project first, then delete this one` });
                    break;
                }
                const projPath = path.join(appDataPath, 'projects', payload.name);
                if (fs.existsSync(projPath)) {
                    deleteDirSync(projPath);
                    // Update order
                    if (bootstrap.projectOrder) {
                        bootstrap.projectOrder = bootstrap.projectOrder.filter(p => p !== payload.name);
                        saveBootstrapConfig(bootstrap);
                    }
                    postToJS('project_deleted', { name: payload.name });
                    // Refresh list
                    const projectsDir = path.join(appDataPath, 'projects');
                    let projects = [];
                    if (fs.existsSync(projectsDir)) {
                        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
                        projects = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
                    }
                    postToJS('project_list', { projects });
                    } else {
                        postToJS('project_error', { message: `Project Delete Error\nOperation: delete_project\nProject: ${payload.name}\nError: Project not found\nAction: Verify the project name is correct and the project exists` });
                    }
            }
            break;
        }
        case 'verify_project': {
            if (payload?.name) {
                const projPath = path.join(appDataPath, 'projects', payload.name);
                const issues = [];
                const fixes = [];
                
                if (!fs.existsSync(projPath)) {
                    issues.push('Project directory does not exist');
                } else {
                    // Check required directories
                    const dataDir = path.join(projPath, 'data');
                    if (!fs.existsSync(dataDir)) {
                        issues.push('Missing data directory');
                        try { fs.mkdirSync(dataDir, { recursive: true }); fixes.push('Created data directory'); } catch (e) {}
                    }
                    const blobsDir = path.join(projPath, 'blobs');
                    if (!fs.existsSync(blobsDir)) {
                        issues.push('Missing blobs directory');
                        try { fs.mkdirSync(blobsDir, { recursive: true }); fixes.push('Created blobs directory'); } catch (e) {}
                    }
                    const historyDir = path.join(projPath, 'history');
                    if (!fs.existsSync(historyDir)) {
                        issues.push('Missing history directory');
                        try { fs.mkdirSync(historyDir, { recursive: true }); fixes.push('Created history directory'); } catch (e) {}
                    }
                    const chestsDir = path.join(projPath, 'chests');
                    if (!fs.existsSync(chestsDir)) {
                        issues.push('Missing chests directory');
                        try { fs.mkdirSync(chestsDir, { recursive: true }); fixes.push('Created chests directory'); } catch (e) {}
                    }
                    // Check session.json
                    const sessionPath = path.join(projPath, 'session.json');
                    if (!fs.existsSync(sessionPath)) {
                        issues.push('Missing session.json');
                        try {
                            fs.writeFileSync(sessionPath, JSON.stringify({ tabs: [{ name: 'default.wendbt', file: 'default.wendbt' }] }, null, 2), 'utf8');
                            fixes.push('Created session.json with default General tab');
                        } catch (e) {}
                    } else {
                        // Validate session.json
                        try {
                            const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                            if (!session.tabs || !Array.isArray(session.tabs)) {
                                issues.push('Invalid session.json - missing tabs array');
                            }
                        } catch (e) {
                            issues.push('Invalid session.json - parse error');
                        }
                    }
                    // Check pipelines.json
                    const pipelinesPath = path.join(projPath, 'pipelines.json');
                    if (!fs.existsSync(pipelinesPath)) {
                        issues.push('Missing pipelines.json');
                        try {
                            fs.writeFileSync(pipelinesPath, JSON.stringify({ pipelines: [] }, null, 2), 'utf8');
                            fixes.push('Created empty pipelines.json');
                        } catch (e) {}
                    }
                    // Check projectrecipes.json
                    const recipesPath = path.join(projPath, 'projectrecipes.json');
                    if (!fs.existsSync(recipesPath)) {
                        issues.push('Missing projectrecipes.json');
                        try {
                            fs.writeFileSync(recipesPath, JSON.stringify([], null, 2), 'utf8');
                            fixes.push('Created empty projectrecipes.json');
                        } catch (e) {}
                    }
                }
                
                postToJS('project_verified', { 
                    name: payload.name, 
                    issues, 
                    fixes,
                    status: issues.length === 0 ? 'OK' : (fixes.length === issues.length ? 'Recovered' : 'Issues found')
                });
            }
            break;
        }
        case 'get_projects_root': {
            const bootstrap = loadBootstrapConfig();
            postToJS('projects_root_result', {
                current: bootstrap.projectsRoot || '',
                default: getDefaultDataPath()
            });
            break;
        }
        case 'set_projects_root': {
            const newPath = payload?.path || '';
            if (!newPath) {
                saveBootstrapConfig({ projectsRoot: '' });
                postToJS('projects_root_changed', { success: true, requiresRestart: true });
                break;
            }
            if (!fs.existsSync(newPath)) {
                postToJS('projects_root_confirm', { path: newPath });
            } else {
                saveBootstrapConfig({ projectsRoot: newPath });
                postToJS('projects_root_changed', { success: true, requiresRestart: true });
            }
            break;
        }
        case 'confirm_projects_root': {
            if (payload?.create) {
                ensureDir(payload.path);
                saveBootstrapConfig({ projectsRoot: payload.path });
                postToJS('projects_root_changed', { success: true, requiresRestart: true });
            } else {
                postToJS('projects_root_changed', { success: false });
            }
            break;
        }
        case 'browse_folder': {
            dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory'],
                defaultPath: payload?.defaultPath || ''
            }).then(result => {
                if (!result.canceled && result.filePaths.length > 0) {
                    postToJS('browse_folder_result', { path: result.filePaths[0] });
                }
            });
            break;
        }
        case 'bt_load_local_file': {
            const { filePath, basePath } = payload || {};
            if (!filePath) {
                postToJS('bt_load_local_file_result', { error: `File Load Error\nOperation: bt_load_local_file\nError: No file path specified\nAction: Provide a valid file path in the payload` });
                break;
            }
            const fullPath = path.isAbsolute(filePath)
                ? filePath
                : path.join(path.dirname(basePath || ''), filePath);

            if (!fs.existsSync(fullPath)) {
                postToJS('bt_load_local_file_result', { error: `File Load Error\nOperation: bt_load_local_file\nPath: ${fullPath}\nError: File not found\nAction: Verify the file path is correct and the file exists` });
                break;
            }

            const ext = path.extname(fullPath).toLowerCase().slice(1);
            const mimeMap = {
                mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac',
                m4a:'audio/mp4', aac:'audio/aac',
                mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime',
                png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
                webp:'image/webp', bmp:'image/bmp'
            };
            const mimetype = mimeMap[ext] || 'application/octet-stream';
            const content = fs.readFileSync(fullPath).toString('base64');
            const size = fs.statSync(fullPath).size;

            postToJS('bt_load_local_file_result', {
                file: path.basename(fullPath),
                path: fullPath,
                mimetype,
                content,
                size
            });
            break;
        }
        case 'bt_media_to_file': {
            const { content, filename } = payload || {};
            if (!content) {
                postToJS('bt_media_to_file_result', { error: 'No content provided' });
                break;
            }
            const mediaDir = path.join(os.tmpdir(), 'wend_export');
            if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
            const safeName = (filename || 'media').replace(/[^a-zA-Z0-9._-]/g, '_');
            const outPath = path.join(mediaDir, `${Date.now()}_${safeName}`);
            fs.writeFileSync(outPath, Buffer.from(content, 'base64'));
            const size = fs.statSync(outPath).size;
            postToJS('bt_media_to_file_result', { path: outPath, file: safeName, size });
            break;
        }
        case 'bt_http_request': {
            const { url, method = 'GET', headers = {}, body = null } = payload || {};
            if (!url) {
                postToJS('bt_http_request_result', { error: 'No URL specified' });
                break;
            }
            httpRequest(url, method, headers, body)
                .then(result => {
                    postToJS('bt_http_request_result', { response: result });
                })
                .catch(err => {
                    postToJS('bt_http_request_result', { error: err.message || String(err) });
                });
            break;
        }
        case 'save_run_state': {
            const runId = runner.getRunId();
            if (runId) storage.saveRunState(runId, JSON.stringify(payload));
            break;
        }
        case 'resume_run': {
            const action = payload?.action;
            const runId = payload?.runId;
            if (action === 'keep') storage.closeRun(runId);
            else if (action === 'discard') storage.discardRun(runId);
            break;
        }
        case 'browse_file': {
            const bfFilters = [
                { name: 'All Files', extensions: ['*'] },
            ];
            dialog.showOpenDialog(mainWindow, { filters: bfFilters, properties: ['openFile'] }).then(result => {
                if (result.canceled || result.filePaths.length === 0) return;
                postToJS('browse_file_result', { filePath: result.filePaths[0] });
            });
            break;
        }
        case 'open_file_dialog': {
            const filter = payload?.filter || 'all';
            const purpose = payload?.purpose || '';
            const stepIndex = payload?.stepIndex;
            let filters = [{ name: 'All Files', extensions: ['*'] }];
            if (filter === 'media') {
                filters = [
                    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
                    { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'] },
                    { name: 'Video', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] },
                    { name: 'JSON', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] },
                ];
            } else if (filter === 'json') {
                filters = [
                    { name: 'JSON', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] },
                ];
            }
            dialog.showOpenDialog(mainWindow, { filters, properties: ['openFile', 'multiSelections'] }).then(result => {
                if (result.canceled || result.filePaths.length === 0) return;
                const attachments = result.filePaths.map(fp => {
                    const ext = path.extname(fp).toLowerCase().slice(1);
                    const mimeMap = {
                        png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
                        webp:'image/webp', bmp:'image/bmp',
                        mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac',
                        m4a:'audio/mp4', aac:'audio/aac',
                        mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime',
                        avi:'video/x-msvideo', mkv:'video/x-matroska',
                        json:'application/json'
                    };
                    const mimetype = mimeMap[ext] || 'application/octet-stream';
                    const content = fs.readFileSync(fp).toString('base64');
                    const size = fs.statSync(fp).size;
                    return { file: path.basename(fp), path: fp, mimetype, content, size };
                });
                postToJS('file_dialog_result', { purpose, stepIndex, attachments });
            });
            break;
        }
        case 'open_artifact': {
            if (payload?.path) shell.openPath(payload.path);
            break;
        }
        case 'close_ready': {
            if (mainWindow && mainWindow._closeReadyFallback) {
                clearTimeout(mainWindow._closeReadyFallback);
                mainWindow._closeReadyFallback = null;
            }
            // Allow the close event to proceed
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.destroy();
            }
            break;
        }
        case 'blob_gc': {
            const report = runBlobGC(storage);
            postToJS('blob_gc_result', report);
            break;
        }
        case 'tool_confirmed':
        case 'tool_cancelled': {
            const ctx = runner._currentToolContext;
            if (ctx && ctx._toolConfirmResolve) {
                ctx._toolConfirmResolve(type === 'tool_confirmed');
                ctx._toolConfirmResolve = null;
            }
            break;
        }
        default:
            postToJS('log', JSON.stringify({ message: '[bridge] unhandled type: ' + type }));
    }
}

// ============================================================
// Pipeline CRUD
// ============================================================
function handleSavePipeline(payload) {
    const name = payload?.name;
    if (!name) return;
    const pipelines = storage.loadPipelines();
    const idx = pipelines.findIndex(p => p.name === name);
    if (idx >= 0) {
        Object.assign(pipelines[idx], payload);
    } else {
        pipelines.push(payload);
    }
    storage.savePipelines(pipelines);
    postToJS('pipeline_list', { pipelines });
}

function handleDeletePipeline(payload) {
    const name = payload?.name;
    if (!name) return;
    const pipelines = storage.loadPipelines().filter(p => p.name !== name);
    storage.savePipelines(pipelines);
    postToJS('pipeline_list', { pipelines });
}

// ============================================================
// History
// ============================================================
function handleHistoryList(payload) {
    const files = storage.listHistory();
    const items = [];
    let limit = 100;
    const filterPipeline = payload?.pipelineName;
    for (const file of files) {
        if (limit-- <= 0) break;
        const raw = storage.loadHistoryRecord(file);
        if (!raw) continue;
        try {
            const obj = JSON.parse(raw);
            if (!obj.pipelineName) continue;
            if (filterPipeline && obj.pipelineName !== filterPipeline) continue;
            items.push({
                id: obj.id || '',
                pipelineName: obj.pipelineName || '',
                startedAt: obj.startedAt || obj.executedAt || '',
                status: obj.status || 'completed',
                evaluation: obj.evaluation || '',
                stepCount: (obj.steps || []).length,
            });
        } catch {}
    }
    postToJS('history_list_result', { items });
}

function handleHistoryDetail(payload) {
    const id = payload?.id;
    if (!id) { postToJS('history_detail_result', {}); return; }
    const raw = storage.loadHistoryRecord('run_' + id + '.json');
    if (!raw) { postToJS('history_detail_result', {}); return; }
    try { postToJS('history_detail_result', JSON.parse(raw)); }
    catch { postToJS('history_detail_result', {}); }
}

function handleEvaluateNode(payload) {
    const { nodeId, tabFile, evaluation, note } = payload || {};
    if (!nodeId || !tabFile) return;
    const root = storage.loadTabData(tabFile);

    function findNode(n, nodePath) {
        if (!nodePath) return n;
        const parts = nodePath.split('.');
        let cur = n;
        for (const p of parts) {
            const i = parseInt(p);
            if (!cur.children || i >= cur.children.length) return null;
            cur = cur.children[i];
        }
        return cur;
    }

    const target = findNode(root, nodeId);
    if (!target) { postToJS('evaluation_saved', { error: `Evaluation Error\nOperation: handleEvaluateNode\nNode ID: ${nodeId}\nTab File: ${tabFile}\nError: Node not found\nAction: Verify the node ID is correct and the node exists in the tree` }); return; }
    target.evaluation = evaluation;
    target.evaluatedAt = nowIso();
    target.evaluationNote = note || '';
    storage.saveTabData(tabFile, root);
    postToJS('evaluation_saved', { targetType: 'node', id: nodeId, evaluation });
}

function handleEvaluateHistoryStep(payload) {
    const { runId, stepIndex, evaluation, note } = payload || {};
    if (!runId || stepIndex == null) return;
    const filename = 'run_' + runId + '.json';
    const raw = storage.loadHistoryRecord(filename);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj.steps?.[stepIndex]) {
        obj.steps[stepIndex].evaluation = evaluation;
        obj.steps[stepIndex].evaluationNote = note || '';
    }
    storage.saveHistory(JSON.stringify(obj));
    postToJS('evaluation_saved', { targetType: 'step', id: runId + '.' + stepIndex, evaluation });
}

function handleEvaluateHistoryRun(payload) {
    const { runId, evaluation } = payload || {};
    if (!runId) return;
    storage.updateHistoryEvaluation('run_' + runId + '.json', evaluation);
    postToJS('evaluation_saved', { targetType: 'run', id: runId, evaluation });
}

// ============================================================
// Optimizer
// ============================================================
async function handleOptimizePipeline(payload) {
    const { pipelineName, historyLimit, maxEditsPerStep, provider: prov, model } = payload || {};
    if (!pipelineName || !prov || !model) {
        postToJS('optimize_error', { message: `Optimizer Configuration Error\nOperation: handleOptimizePipeline\nError: Missing required parameters\nRequired: pipelineName, provider, model\nReceived: pipelineName=${pipelineName || 'undefined'}, provider=${prov || 'undefined'}, model=${model || 'undefined'}\nAction: Provide all required parameters` });
        return;
    }
    const pipelines = storage.loadPipelines();
    const pipeline = pipelines.find(p => p.name === pipelineName);
    if (!pipeline) { 
        postToJS('optimize_error', { message: `Optimizer Pipeline Error\nOperation: handleOptimizePipeline\nPipeline: ${pipelineName}\nError: Pipeline not found\nAvailable pipelines: ${pipelines.map(p => p.name).join(', ') || 'none'}\nAction: Verify the pipeline name is correct` }); 
        return; 
    }

    versionMgr.ensureBaseVersion(pipelineName, pipeline);
    const providers = storage.loadProviders();
    const cfg = providers[prov] || {};

    activeOptSession = { pipelineName, sessionId: '', proposals: [], rejectedBuffer: optimizer.loadRejectedBuffer(pipelineName) };

    await optimizer.startSession(pipelineName, pipeline, historyLimit, maxEditsPerStep, prov, cfg.apiKey, cfg.baseUrl, model, (type, json) => {
        if (type === 'optimize_proposals') {
            const v = JSON.parse(json);
            if (activeOptSession) {
                activeOptSession.sessionId = v.sessionId || '';
                activeOptSession.proposals = v.proposals || [];
            }
        }
        postToJS(type, JSON.parse(json));
    });
}

function handleOptimizeApply(payload) {
    const { pipelineName, approved, rejected } = payload || {};
    if (!pipelineName || !activeOptSession || activeOptSession.pipelineName !== pipelineName) {
        postToJS('optimize_error', { message: `Optimizer Session Error\nOperation: handleOptimizeApply\nPipeline: ${pipelineName || 'undefined'}\nActive Session: ${activeOptSession?.pipelineName || 'none'}\nError: No active optimization session for this pipeline\nAction: Start an optimization session first` });
        return;
    }
    const pipelines = storage.loadPipelines();
    const idx = pipelines.findIndex(p => p.name === pipelineName);
    if (idx < 0) { 
        postToJS('optimize_error', { message: `Optimizer Pipeline Error\nOperation: handleOptimizeApply\nPipeline: ${pipelineName}\nError: Pipeline not found\nAvailable pipelines: ${pipelines.map(p => p.name).join(', ') || 'none'}\nAction: Verify the pipeline name is correct` }); 
        return; 
    }

    const updated = PipelineOptimizer.applyApprovals(pipelines[idx], approved || [], rejected || [], activeOptSession);
    optimizer.saveRejectedBuffer(pipelineName, activeOptSession.rejectedBuffer);

    const label = 'Optimize (' + (approved?.length || 0) + ' edits)';
    const newVersion = versionMgr.commitVersion(pipelineName, updated, activeOptSession.sessionId, label, []);

    pipelines[idx] = updated;
    storage.savePipelines(pipelines);
    activeOptSession = null;

    const cursor = versionMgr.getCursor(pipelineName);
    postToJS('optimize_applied', { pipelineName, approvedCount: (approved||[]).length, rejectedCount: (rejected||[]).length, version: newVersion });
    postToJS('pipeline_list', { pipelines });
    postToJS('optimize_version_changed', { pipelineName, version: cursor.currentVersion, canUndo: cursor.currentVersion > 1, canRedo: cursor.currentVersion < cursor.headVersion });
}

function handleOptimizeUndo(payload) {
    const name = payload?.pipelineName;
    if (!name) return;
    const restored = versionMgr.undo(name);
    if (!restored) { postToJS('optimize_error', { message: `Optimizer Undo Error\nOperation: handleOptimizeUndo\nPipeline: ${name}\nError: Already at earliest version\nCurrent version: 1\nAction: No more undo operations available` }); return; }
    const pipelines = storage.loadPipelines();
    const idx = pipelines.findIndex(p => p.name === name);
    if (idx >= 0) pipelines[idx] = restored;
    storage.savePipelines(pipelines);
    const cursor = versionMgr.getCursor(name);
    postToJS('pipeline_list', { pipelines });
    postToJS('optimize_version_changed', { pipelineName: name, version: cursor.currentVersion, canUndo: cursor.currentVersion > 1, canRedo: cursor.currentVersion < cursor.headVersion });
}

function handleOptimizeRedo(payload) {
    const name = payload?.pipelineName;
    if (!name) return;
    const restored = versionMgr.redo(name);
    if (!restored) { postToJS('optimize_error', { message: `Optimizer Redo Error\nOperation: handleOptimizeRedo\nPipeline: ${name}\nError: Already at latest version\nCurrent version: ${versionMgr.getCursor(name).headVersion}\nAction: No more redo operations available` }); return; }
    const pipelines = storage.loadPipelines();
    const idx = pipelines.findIndex(p => p.name === name);
    if (idx >= 0) pipelines[idx] = restored;
    storage.savePipelines(pipelines);
    const cursor = versionMgr.getCursor(name);
    postToJS('pipeline_list', { pipelines });
    postToJS('optimize_version_changed', { pipelineName: name, version: cursor.currentVersion, canUndo: cursor.currentVersion > 1, canRedo: cursor.currentVersion < cursor.headVersion });
}

function handleOptimizeCheckout(payload) {
    const { pipelineName: name, version } = payload || {};
    if (!name || !version) return;
    const restored = versionMgr.checkoutVersion(name, version);
    if (!restored) { postToJS('optimize_error', { message: `Optimizer Checkout Error\nOperation: handleOptimizeCheckout\nPipeline: ${name}\nVersion: ${version}\nError: Version not found\nAction: Verify the version number exists in the version history` }); return; }
    const pipelines = storage.loadPipelines();
    const idx = pipelines.findIndex(p => p.name === name);
    if (idx >= 0) pipelines[idx] = restored;
    storage.savePipelines(pipelines);
    const cursor = versionMgr.getCursor(name);
    postToJS('pipeline_list', { pipelines });
    postToJS('optimize_version_changed', { pipelineName: name, version: cursor.currentVersion, canUndo: cursor.currentVersion > 1, canRedo: cursor.currentVersion < cursor.headVersion });
}

function handleOptimizeReapply(payload) {
    const { pipelineName: name, version } = payload || {};
    if (!name || !version) return;
    const pipelines = storage.loadPipelines();
    const idx = pipelines.findIndex(p => p.name === name);
    if (idx < 0) { postToJS('optimize_error', { message: `Optimizer Reapply Error\nOperation: handleOptimizeReapply\nPipeline: ${name}\nVersion: ${version}\nError: Pipeline not found\nAvailable pipelines: ${pipelines.map(p => p.name).join(', ') || 'none'}\nAction: Verify the pipeline name is correct` }); return; }
    const updated = versionMgr.reapplyVersion(name, version, pipelines[idx]);
    pipelines[idx] = updated;
    storage.savePipelines(pipelines);
    const cursor = versionMgr.getCursor(name);
    postToJS('optimize_applied', { pipelineName: name, approvedCount: 0, rejectedCount: 0, version: cursor.currentVersion });
    postToJS('pipeline_list', { pipelines });
    postToJS('optimize_version_changed', { pipelineName: name, version: cursor.currentVersion, canUndo: cursor.currentVersion > 1, canRedo: cursor.currentVersion < cursor.headVersion });
}

function handleOptimizeVersionList(payload) {
    const name = payload?.pipelineName;
    if (!name) return;
    const cursor = versionMgr.getCursor(name);
    postToJS('optimize_version_list_result', { pipelineName: name, cursor });
}

// ============================================================
// File Dialogs
// ============================================================
async function openFileDialog() {
    if (!mainWindow) return;
    const result = await dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'Project', extensions: ['wendproject', 'wendbt'] }, { name: 'All Files', extensions: ['*'] }],
        properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        addRecentFile(filePath);
        postToJS('open_file_result', { path: filePath });
    }
}

async function saveFileDialog() {
    if (!mainWindow) return;
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: getAppDataPath(),
        filters: [{ name: 'Project', extensions: ['wendproject'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (!result.canceled && result.filePath) {
        addRecentFile(result.filePath);
        postToJS('save_as_result', { path: result.filePath });
    }
}

function addRecentFile(filePath) {
    if (recentFilesManager) {
        recentFilesManager.add(filePath);
    }
    updateRecentFilesMenu();
}

// ============================================================
// Menu
// ============================================================
function buildMenu() {
    const send = (action) => () => postToJS('menu_command', { action });
    const template = [
        {
            label: 'Project',
            submenu: [
                { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: send('save_project') },
                { type: 'separator' },
                { id: 'recent-placeholder', label: '(No Recent BTs)', enabled: false },
                { type: 'separator' },
                { label: 'New Project...', click: send('new_project') },
                { label: 'Project List...', click: send('switch_project') },
                { label: 'Projects Root Folder...', click: () => {
                    const projectsPath = path.join(appDataPath, 'projects');
                    ensureDir(projectsPath);
                    shell.openPath(projectsPath);
                }},
                { type: 'separator' },
                { label: 'About Project Lifecycle', click: send('about_project_lifecycle') },
                { type: 'separator' },
                { label: 'Exit', accelerator: 'Alt+F4', role: 'quit' },
            ],
        },
        {
            label: 'View',
            submenu: [
                { label: 'Tree', click: () => postToJS('menu_command', { action: 'toggle_pane', pane: 'tree' }) },
                { label: 'List', click: () => postToJS('menu_command', { action: 'toggle_pane', pane: 'list' }) },
                { label: 'Editor', click: () => postToJS('menu_command', { action: 'toggle_pane', pane: 'editor' }) },
                { label: 'Messages', click: () => postToJS('menu_command', { action: 'toggle_pane', pane: 'messages' }) },
                { type: 'separator' },
                { label: 'Clean Unreferenced Blobs', click: () => {
                    const report = runBlobGC(storage);
                    postToJS('blob_gc_result', report);
                    postToJS('log', JSON.stringify({ message: `[BlobGC] Deleted: ${report.deleted.length}, Kept: ${report.kept.length}, Errors: ${report.errors.length}` }));
                }},
                { type: 'separator' },
                { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' },
            ],
        },
        {
            label: 'BehaviorTree',
            submenu: [
                { label: 'New BT', accelerator: 'CmdOrCtrl+N', click: send('new_tab') },
                { label: 'Open BT...', accelerator: 'CmdOrCtrl+O', click: () => openFileDialog() },
                { label: 'Save BT', click: send('save') },
                { label: 'Save BT As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => saveFileDialog() },
                { type: 'separator' },
                { label: 'Run Tree', accelerator: 'F6', click: send('bt_run') },
                { label: 'Step', click: send('bt_step') },
                { label: 'Pause', click: send('bt_pause') },
                { label: 'Stop', click: send('bt_stop') },
                { type: 'separator' },
                { label: 'Execution Lock', click: send('bt_toggle_lock') },
                { type: 'separator' },
                { label: 'Blackboard Manager', click: send('bt_blackboard') },
                { label: 'BT Settings...', click: send('bt_config') },
            ],
        },
        {
            label: 'Pipeline',
            submenu: [
                { label: 'Run Pipeline', accelerator: 'F5', click: send('run_pipeline') },
                { label: 'Pipeline Manager', click: send('pipeline_manager') },
                { label: 'History', click: send('pipeline_history') },
                { label: 'Cancel', click: () => runner.cancel() },
            ],
        },
        {
            label: 'Providers',
            submenu: [
                { label: 'Provider Setting', click: send('config') },
                { label: 'Test Connection', click: send('test_connection') },
            ],
        },
        {
            label: 'Recipes',
            submenu: [
                { label: 'Recipe Manager', click: send('recipe_manager') },
            ],
        },
        {
            label: 'Chest',
            submenu: [
                { label: 'Send Current Output to Chest...', click: send('send_to_chest_dialog') },
                { label: 'Open Chest Manager...', click: send('chest_manager') },
            ],
        },
        {
            label: 'Config',
            submenu: [
                { label: 'Application Config', click: send('app_config') },
            ],
        },
        {
            label: 'Help',
            submenu: [
                { label: 'Welcome Wizard', click: send('welcome_wizard') },
                { label: 'Reset Welcome Wizard', click: send('reset_wizard') },
                { label: 'Setup Wizard', click: send('setup_wizard') },
                { label: 'Sample Projects', click: send('sample_wizard') },
                { label: 'Recipe Test...', click: send('recipe_test') },
                { label: 'Folder Structure...', click: send('folder_help') },
                { label: 'Documentation', click: () => shell.openExternal('https://github.com/gadget114514/Wend') },
                { label: 'About', click: send('about') },
            ],
        },
    ];
    return template;
}

function updateRecentFilesMenu() {
    if (!mainWindow || embedded) return;
    const menu = Menu.getApplicationMenu();
    if (!menu) return;
    const template = buildMenu();
    const projectMenu = template[0].submenu;
    
    // Find the recent-placeholder position (after Save BT As)
    const placeholderIndex = projectMenu.findIndex(item => item.id === 'recent-placeholder');
    if (placeholderIndex >= 0) {
        projectMenu.splice(placeholderIndex, 1);
    }
    
    const recent = recentFilesManager ? recentFilesManager.get(5) : [];
    if (recent.length > 0) {
        recent.forEach((f, i) => {
            projectMenu.splice(placeholderIndex + i, 0, {
                label: `&${i + 1} ${f}`,
                click: () => {
                    addRecentFile(f);
                    postToJS('open_file_result', { path: f });
                },
            });
        });
    } else {
        projectMenu.splice(placeholderIndex, 0, { label: '(No Recent BTs)', enabled: false });
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============================================================
// Window creation
// ============================================================
function createWindow() {
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app.ico')
        : path.join(__dirname, '..', 'images', 'app.ico');
    const savedCfg = storage.loadGeneralConfig();
    const wb = savedCfg.windowBounds || {};
    const bootstrap = loadBootstrapConfig();
    const currentProject = bootstrap.currentProject || 'Default';
    mainWindow = new BrowserWindow({
        width:  wb.width  || 1000,
        height: wb.height || 700,
        x: wb.x != null ? wb.x : undefined,
        y: wb.y != null ? wb.y : undefined,
        title: `Wend - ${currentProject}`,
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    const frontendPath = path.join(FRONTEND_ROOT, 'index.html');
    mainWindow.loadFile(frontendPath);

    if (!embedded) {
        const template = buildMenu();
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } else {
        Menu.setApplicationMenu(null);
    }

    mainWindow.webContents.on('did-finish-load', () => {
        if (devMode) {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
        postToJS('ready', {});
        postToJS('app_version', { version: app.getVersion() });
    });

    mainWindow.webContents.on('before-input-event', (_event, input) => {
        if (input.key === 'F12') {
            if (mainWindow.webContents.isDevToolsOpened()) {
                mainWindow.webContents.closeDevTools();
            } else {
                mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
        }
    });

    // Auto-save before close: prevent default, ask renderer to flush, then destroy
    let _closePending = false;
    mainWindow.on('close', (e) => {
        if (_closePending) return; // already flushed
        e.preventDefault();
        // Save window bounds
        const b = mainWindow.getBounds();
        const cfg = storage.loadGeneralConfig();
        cfg.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
        storage.saveGeneralConfig(cfg);
        // Signal renderer to flush unsaved content
        postToJS('save_before_close', {});
        // Fallback: close after 2 seconds even if renderer doesn't respond
        const fallback = setTimeout(() => { _closePending = true; mainWindow && mainWindow.close(); }, 2000);
        mainWindow._closeReadyFallback = fallback;
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

// ============================================================
// IPC
// ============================================================
ipcMain.on('bridge', (_event, msg) => {
    let obj = msg;
    if (typeof msg === 'string') {
        try { obj = JSON.parse(msg); } catch { return; }
    }
    const type = obj.type;
    const payload = obj.payload;

    if (type === 'init_complete') {
        postToJS('log', JSON.stringify({ message: '[TRACE] init_complete received from JS, calling SendFullInit' }));
        if (providerLoadErrors.length > 0) {
            postToJS('log', JSON.stringify({ message: `[ProviderLoader] ⚠️ Failed to load ${providerLoadErrors.length} provider(s):\n${providerLoadErrors.join('\n')}` }));
        }
        postToJS('log', JSON.stringify({ message: `[ProviderLoader] Loaded: ${Object.keys(builtinProviders).join(', ') || '(none)'}` }));
        sendFullInit();
        startBtHttpServer();
        return;
    }

    handleBridgeMessage(type, payload).catch(e => {
        postToJS('log', JSON.stringify({ message: `[Bridge Error] ${e.message}` }));
    });
});

// ============================================================
// App lifecycle
// ============================================================
app.whenReady().then(() => {
    appDataPath = getAppDataPath();
    storage.init(appDataPath);
    
    // Start mock server if configured
    try {
        const savedCfg = storage.loadGeneralConfig();
        if (savedCfg.startMockServer) {
            startMockServer();
        }
    } catch (e) {
        console.error('[Mock Server] Failed to check start config:', e.message);
    }

    loadCustomProviders(appDataPath);

    // Ensure a default project exists and is active
    const bootstrap = loadBootstrapConfig();
    const currentProject = bootstrap.currentProject || 'Default';
    const projectPath = path.join(appDataPath, 'projects', currentProject);
    
    if (!fs.existsSync(projectPath)) {
        // Create empty default project
        storage.init(projectPath);
        const tab = { name: 'default.wendbt', file: 'default.wendbt' };
        storage.saveTabData('default.wendbt', { title: '', content: '', mimetype: 'text/plain', attachments: [], children: [] });
        storage.saveSession({ tabs: [tab] });
        storage.saveProjectRecipes([]);
        postToJS('log', JSON.stringify({ message: `Created default project: ${currentProject}` }));
    } else {
        // Switch to existing project
        storage.init(projectPath);
    }
    
    // Save current project to bootstrap config
    saveBootstrapConfig({ ...bootstrap, currentProject });

    const gcReport = runBlobGC(storage);
    if (gcReport.deleted.length > 0) {
        postToJS('log', JSON.stringify({ message: `[BlobGC] Cleaned ${gcReport.deleted.length} unreferenced blob(s)` }));
    }

    const args = process.argv.slice(2);
    embedded = args.includes('--embedded');
    devMode = args.includes('--dev') || args.includes('--debug');

    // Register HTTP log callback → forward to frontend
    setHttpLogCallback((info) => {
        try { postToJS('http_log', info); } catch (e) {}
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    stopMockServer();
    if (process.platform !== 'darwin') app.quit();
});
