'use strict';
const { spawn } = require('child_process');
const { httpRequest } = require('./utils');

class MCPClientProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey || '';
        this.rawConfig = baseUrl || '';
        this.isHttp = !!(baseUrl && (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')));
        this.httpBaseUrl = this.isHttp ? baseUrl.replace(/\/+$/, '') : '';
        this.spawnCommand = this.isHttp ? '' : (baseUrl || '');
    }

    name() { return 'mcp'; }

    defaultModels() {
        return ['mcp-tool'];
    }

    async call(req) {
        const toolName = req.customParams?.toolName || '';
        if (!toolName) throw new Error('MCP: customParams.toolName is required');

        const toolArgs = req.customParams?.toolArguments || {};
        const serverCommand = req.customParams?.serverCommand || this.spawnCommand;
        const serverUrl = req.customParams?.serverUrl || this.httpBaseUrl;

        if (serverUrl) {
            return await this._callHttp(serverUrl, toolName, toolArgs, req);
        } else if (serverCommand) {
            return await this._callStdio(serverCommand, toolName, toolArgs, req);
        } else {
            throw new Error('MCP: no server command or URL configured.\nSet baseUrl to a spawn command (stdio) or HTTP URL.');
        }
    }

    // ── HTTP transport ──

    async _callHttp(baseUrl, toolName, toolArgs, req) {
        const url = baseUrl.replace(/\/+$/, '');

        const initResult = await this._httpJsonRpc(url, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'wend', version: '0.1.0' },
        });

        const result = await this._httpJsonRpc(url, 'tools/call', {
            name: toolName,
            arguments: toolArgs,
        });

        const content = this._extractContent(result);
        const userPrompt = req.userPrompt || '';

        return {
            content: content || `[MCP] Tool "${toolName}" executed`,
            model: 'mcp-tool',
            outputAttachments: this._extractResources(result),
            requestUrl: url + '/message',
            requestBody: JSON.stringify({ toolName, toolArgs }),
        };
    }

    async _httpJsonRpc(baseUrl, method, params) {
        const messageUrl = baseUrl + '/message';
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params: params || {},
        });
        const raw = await httpRequest(messageUrl, 'POST',
            { 'Content-Type': 'application/json' },
            body);
        const resp = JSON.parse(raw);
        if (resp.error) {
            throw new Error(`MCP error [${method}]: ${resp.error.message || JSON.stringify(resp.error)}`);
        }
        return resp.result;
    }

    // ── STDIO transport ──

    async _callStdio(command, toolName, toolArgs, req) {
        const parts = this._parseCommand(command);
        if (parts.length === 0) {
            throw new Error(`MCP: invalid spawn command: "${command}"`);
        }

        const proc = spawn(parts[0], parts.slice(1), {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });

        let messageId = 0;
        const pending = {};
        let stderrLog = '';

        const sendMessage = (method, params) => {
            return new Promise((resolve, reject) => {
                const id = ++messageId;
                pending[id] = { resolve, reject };
                const msg = JSON.stringify({
                    jsonrpc: '2.0', id, method, params: params || {},
                }) + '\n';
                try { proc.stdin.write(msg); } catch (e) { reject(e); }
            });
        };

        let buffer = '';
        const stdioDone = new Promise((resolve, reject) => {
            proc.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const msg = JSON.parse(trimmed);
                        if (msg.id !== undefined && pending[msg.id]) {
                            if (msg.error) {
                                pending[msg.id].reject(
                                    new Error(`MCP error: ${msg.error.message || JSON.stringify(msg.error)}`));
                            } else {
                                pending[msg.id].resolve(msg.result);
                            }
                            delete pending[msg.id];
                        }
                    } catch (_) { /* skip non-JSON lines */ }
                }
            });

            proc.stderr.on('data', (data) => {
                stderrLog += data.toString();
            });

            proc.on('error', (err) => {
                for (const p of Object.values(pending)) p.reject(err);
                reject(err);
            });

            proc.on('close', (code) => {
                for (const p of Object.values(pending)) {
                    p.reject(new Error(`MCP process exited with code ${code}\n${stderrLog}`));
                }
                if (Object.keys(pending).length === 0) resolve();
            });
        });

        try {
            const timeout = setTimeout(() => {
                for (const p of Object.values(pending)) {
                    p.reject(new Error('MCP stdio timeout'));
                }
            }, 60000);

            await sendMessage('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'wend', version: '0.1.0' },
            });

            proc.stdin.write(JSON.stringify({
                jsonrpc: '2.0', method: 'notifications/initialized',
            }) + '\n');

            if (!toolName) {
                clearTimeout(timeout);
                return { content: '[MCP] Initialized', model: 'mcp-tool' };
            }

            const result = await sendMessage('tools/call', {
                name: toolName,
                arguments: toolArgs,
            });

            clearTimeout(timeout);

            const content = this._extractContent(result);
            return {
                content: content || `[MCP] Tool "${toolName}" executed`,
                model: 'mcp-tool',
                outputAttachments: this._extractResources(result),
                requestUrl: command,
                requestBody: JSON.stringify({ toolName, toolArgs }),
            };
        } finally {
            try { proc.stdin.end(); } catch (_) {}
            setTimeout(() => { if (!proc.killed) proc.kill(); }, 2000);
            setTimeout(() => stdioDone.catch(() => {}), 100);
        }
    }

    _parseCommand(cmd) {
        if (!cmd) return [];
        const parts = [];
        let current = '';
        let inQuote = false;
        for (let i = 0; i < cmd.length; i++) {
            const ch = cmd[i];
            if (ch === '"') { inQuote = !inQuote; continue; }
            if (ch === ' ' && !inQuote) {
                if (current) { parts.push(current); current = ''; }
                continue;
            }
            current += ch;
        }
        if (current) parts.push(current);
        return parts;
    }

    _extractContent(result) {
        if (!result || !result.content) return '';
        return result.content
            .filter(c => c.type === 'text')
            .map(c => c.text || '')
            .join('\n');
    }

    _extractResources(result) {
        if (!result || !result.content) return [];
        const attachments = [];
        for (const item of result.content) {
            if (item.type === 'resource' && item.resource) {
                const blob = item.resource;
                const mime = blob.mimeType || blob.mimetype || 'application/octet-stream';
                const data = blob.text || blob.blob || '';
                const fileName = blob.name || blob.uri?.split('/').pop() || `mcp_resource_${attachments.length}`;
                attachments.push({
                    file: fileName,
                    mimetype: mime,
                    content: data,
                    size: data.length,
                });
            }
        }
        return attachments;
    }

    async listModels() {
        return ['mcp-tool'];
    }

    async testConnection() {
        if (this.spawnCommand) {
            try {
                await this._callStdio(this.spawnCommand, '', {}, {});
                return '';
            } catch (e) {
                return e.message || 'Connection failed';
            }
        }
        if (this.httpBaseUrl) {
            try {
                await this._httpJsonRpc(this.httpBaseUrl, 'initialize', {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'wend', version: '0.1.0' },
                });
                return '';
            } catch (e) {
                return e.message || 'Connection failed';
            }
        }
        return 'No MCP server configured. Set baseUrl to a spawn command or HTTP URL.';
    }
}

module.exports = MCPClientProvider;
