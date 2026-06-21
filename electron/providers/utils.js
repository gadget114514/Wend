const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

let appDataPath = '';
function setAppDataPath(p) { appDataPath = p; }
function getAppDataPath() { return appDataPath; }

let _httpLogCallback = null;
function setHttpLogCallback(fn) { _httpLogCallback = fn; }

let _errorCallback = null;
function setErrorCallback(fn) { _errorCallback = fn; }
function reportError(msg) {
    if (_errorCallback) { try { _errorCallback(msg); } catch {} }
    console.error('[utils]', msg);
}

function redactMediaFromBody(bodyStr) {
    if (!bodyStr) return bodyStr;
    try {
        const json = JSON.parse(bodyStr);
        return JSON.stringify(json, (key, value) => {
            if (key === 'data' && typeof value === 'string' && value.length > 100)
                return `[base64: ${value.length} chars]`;
            if (key === 'url' && typeof value === 'string' && value.startsWith('data:'))
                return `[data URL: ${value.length} chars]`;
            return value;
        }, 2);
    } catch {
        if (bodyStr.includes('multipart/form-data') || bodyStr.includes('Content-Disposition')) {
            return bodyStr.replace(/Content-Disposition: form-data; name="[^"]*"; filename="[^"]*"[^]*?------/g,
                (match) => match.replace(/[\s\S]*?(?=------)/, '[binary data redacted]\n'));
        }
        return bodyStr;
    }
}

function tryLogHttp(info) {
    const redacted = {
        ...info,
        requestBody: redactMediaFromBody(info.requestBody),
        responsePreview: redactMediaFromBody(info.responseBody),
    };
    delete redacted.responseBody;
    try { if (_httpLogCallback) _httpLogCallback(redacted); } catch(e) { reportError(`HTTP Log Callback Error\nOperation: tryLogHttp\nError: ${e.message}\nAction: Check HTTP log callback implementation`); }
}

function httpRequest(url, method, headers, body, timeoutMs = 60000) {
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
                tryLogHttp({ 
                    url, 
                    method, 
                    statusCode: res.statusCode, 
                    requestHeaders: opts.headers,
                    requestBody: bodyStr, 
                    responseHeaders: res.headers,
                    responseBody: bodyText, 
                    elapsedMs: elapsed 
                });
                resolve(bodyText);
            });
        });
        req.on('error', err => {
            tryLogHttp({ 
                url, 
                method, 
                statusCode: 0, 
                requestHeaders: opts.headers,
                requestBody: bodyStr, 
                error: `HTTP Request Error\nURL: ${url}\nMethod: ${method}\nError: ${err.message}\nPossible causes: Network connectivity issue, DNS resolution failure, or connection refused` 
            });
            reject(err);
        });
        req.on('timeout', () => { 
            req.destroy(); 
            tryLogHttp({ 
                url, 
                method, 
                statusCode: 0, 
                requestHeaders: opts.headers,
                requestBody: bodyStr, 
                error: `HTTP Request Timeout\nURL: ${url}\nMethod: ${method}\nTimeout: ${timeoutMs}ms\nPossible causes: Server not responding, network latency, or request too large` 
            }); 
            reject(new Error(`HTTP Request Timeout\nURL: ${url}\nMethod: ${method}\nTimeout: ${timeoutMs}ms\nPossible causes: Server not responding, network latency, or request too large`)); 
        });
        if (body) req.write(bodyStr);
        req.end();
    });
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
        req.on('error', (err) => {
            reject(new Error(`Download Error\nURL: ${url}\nError: ${err.message}\nPossible causes: Network connectivity issue, DNS resolution failure, or connection refused`));
        });
        req.on('timeout', () => { 
            req.destroy(); 
            reject(new Error(`Download Timeout\nURL: ${url}\nTimeout: 30000ms\nPossible causes: Server not responding, network latency, or file too large`)); 
        });
        req.end();
    });
}

module.exports = {
    httpRequest,
    downloadBinary,
    tryLogHttp,
    redactMediaFromBody,
    setAppDataPath,
    getAppDataPath,
    setHttpLogCallback,
    setErrorCallback,
};
