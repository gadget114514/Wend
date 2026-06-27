const https = require('https');
const http = require('http');
const tls = require('tls');
const net = require('net');
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
                return '(b64 emitted)';
            if (key === 'url' && typeof value === 'string' && value.startsWith('data:'))
                return '(b64 emitted)';
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

let proxyServerSetting = '';
let proxyModeSetting = 'env';
let proxyEnabledSetting = true;
function setProxyServer(p, mode, enabled) {
    proxyServerSetting = p;
    proxyModeSetting = mode || 'env';
    proxyEnabledSetting = (enabled !== false);
}

function getProxyUrl() {
    if (!proxyEnabledSetting) return null;
    let proxy = '';
    if (proxyModeSetting === 'manual') {
        proxy = proxyServerSetting;
    } else {
        proxy = process.env.http_proxy || process.env.HTTP_PROXY || process.env.https_proxy || process.env.HTTPS_PROXY || '';
    }
    if (!proxy) return null;
    proxy = proxy.trim();
    if (!/^https?:\/\//i.test(proxy)) {
        proxy = 'http://' + proxy;
    }
    try {
        return new URL(proxy);
    } catch (e) {
        console.error('[Proxy] Invalid proxy URL:', proxy, e.message);
        return null;
    }
}

function makeRequest(url, method, headers, body, timeoutMs, isBinary) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const proxyUrl = getProxyUrl();
        const bodyStr = body || '';
        
        const isHttps = u.protocol === 'https:';
        const defaultPort = isHttps ? 443 : 80;
        const targetPort = u.port || defaultPort;
        
        let reqOpts = {
            method,
            headers: { ...(body ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...headers },
            timeout: timeoutMs,
        };
        
        const startTime = Date.now();
        
        const handleResponse = (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const bodyBuf = Buffer.concat(chunks);
                const elapsed = Date.now() - startTime;
                
                if (isBinary) {
                    resolve(bodyBuf);
                } else {
                    const bodyText = bodyBuf.toString('utf8');
                    tryLogHttp({ 
                        url, 
                        method, 
                        statusCode: res.statusCode, 
                        requestHeaders: reqOpts.headers,
                        requestBody: bodyStr, 
                        responseHeaders: res.headers,
                        responseBody: bodyText, 
                        elapsedMs: elapsed 
                    });
                    resolve(bodyText);
                }
            });
        };
        
        const handleError = (err) => {
            if (!isBinary) {
                tryLogHttp({ 
                    url, 
                    method, 
                    statusCode: 0, 
                    requestHeaders: reqOpts.headers,
                    requestBody: bodyStr, 
                    error: `HTTP Request Error\nURL: ${url}\nMethod: ${method}\nError: ${err.message}` 
                });
            }
            reject(err);
        };
        
        const handleTimeout = (req) => {
            req.destroy();
            const errMsg = `HTTP Request Timeout\nURL: ${url}\nMethod: ${method}\nTimeout: ${timeoutMs}ms`;
            if (!isBinary) {
                tryLogHttp({ 
                    url, 
                    method, 
                    statusCode: 0, 
                    requestHeaders: reqOpts.headers,
                    requestBody: bodyStr, 
                    error: errMsg 
                });
            }
            reject(new Error(errMsg));
        };
        
        if (proxyUrl) {
            const isProxyHttps = proxyUrl.protocol === 'https:';
            if (isHttps) {
                const proxyPort = proxyUrl.port || (isProxyHttps ? 443 : 80);
                const proxyHostname = proxyUrl.hostname;
                
                const socket = isProxyHttps
                    ? tls.connect({ host: proxyHostname, port: proxyPort, servername: proxyHostname, rejectUnauthorized: false })
                    : net.connect({ host: proxyHostname, port: proxyPort });
                
                socket.setTimeout(timeoutMs);
                socket.on('timeout', () => {
                    socket.destroy();
                    handleTimeout({ destroy: () => {} });
                });
                socket.on('error', handleError);
                
                let connectHeader = `CONNECT ${u.hostname}:${targetPort} HTTP/1.1\r\n` +
                                    `Host: ${u.hostname}:${targetPort}\r\n`;
                                    
                if (proxyUrl.username && proxyUrl.password) {
                    const auth = Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64');
                    connectHeader += `Proxy-Authorization: Basic ${auth}\r\n`;
                }
                connectHeader += '\r\n';
                
                socket.write(connectHeader);
                
                let responseBuffer = Buffer.alloc(0);
                function onData(chunk) {
                    responseBuffer = Buffer.concat([responseBuffer, chunk]);
                    const headerEnd = responseBuffer.indexOf('\r\n\r\n');
                    if (headerEnd !== -1) {
                        socket.off('data', onData);
                        const headerText = responseBuffer.toString('utf8', 0, headerEnd);
                        const statusLine = headerText.split('\r\n')[0];
                        const match = statusLine.match(/^HTTP\/\d+\.\d+\s+(\d+)/i);
                        if (!match || parseInt(match[1]) < 200 || parseInt(match[1]) >= 300) {
                            socket.destroy();
                            handleError(new Error(`Proxy tunneling failed: ${statusLine}`));
                            return;
                        }
                        
                        const secureSocket = tls.connect({
                            socket: socket,
                            servername: u.hostname,
                        });
                        
                        secureSocket.on('error', handleError);
                        secureSocket.once('secureConnect', () => {
                            reqOpts.createConnection = () => secureSocket;
                            
                            const req = https.request({
                                hostname: u.hostname,
                                port: targetPort,
                                path: u.pathname + u.search,
                                ...reqOpts
                            }, handleResponse);
                            
                            req.on('error', handleError);
                            req.on('timeout', () => handleTimeout(req));
                            
                            if (body) req.write(bodyStr);
                            req.end();
                        });
                    }
                }
                socket.on('data', onData);
                
            } else {
                const proxyPort = proxyUrl.port || (isProxyHttps ? 443 : 80);
                const proxyHostname = proxyUrl.hostname;
                
                reqOpts.hostname = proxyHostname;
                reqOpts.port = proxyPort;
                reqOpts.path = u.href;
                reqOpts.headers.Host = u.host;
                
                if (proxyUrl.username && proxyUrl.password) {
                    const auth = Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64');
                    reqOpts.headers['Proxy-Authorization'] = `Basic ${auth}`;
                }
                
                const req = isProxyHttps ? https.request(reqOpts, handleResponse) : http.request(reqOpts, handleResponse);
                req.on('error', handleError);
                req.on('timeout', () => handleTimeout(req));
                if (body) req.write(bodyStr);
                req.end();
            }
        } else {
            const mod = isHttps ? https : http;
            reqOpts.hostname = u.hostname;
            reqOpts.port = targetPort;
            reqOpts.path = u.pathname + u.search;
            
            const req = mod.request(reqOpts, handleResponse);
            req.on('error', handleError);
            req.on('timeout', () => handleTimeout(req));
            if (body) req.write(bodyStr);
            req.end();
        }
    });
}

function httpRequest(url, method, headers, body, timeoutMs = 120000) {
    return makeRequest(url, method, headers, body, timeoutMs, false);
}

function downloadBinary(url, headers = {}) {
    return makeRequest(url, 'GET', headers, null, 30000, true);
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
    setProxyServer,
};
