'use strict';
const { httpRequest } = require('./utils');
const http = require('http');
const https = require('https');

function postBinary(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        const opts = {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: 'POST',
            headers: { 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
            timeout: 120000,
        };
        const req = mod.request(opts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(bodyStr);
        req.end();
    });
}

class VoicevoxProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey || '';
        this.baseUrl = (baseUrl || 'http://localhost:50021').replace(/\/+$/, '');
    }

    name() { return 'voicevox'; }

    defaultModels() {
        return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];
    }

    async call(req) {
        const text = req.userPrompt || '';
        if (!text.trim()) throw new Error('VOICEVOX TTS: text is required');

        const speaker = req.model || '1';

        const queryUrl = `${this.baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`;
        const queryRaw = await httpRequest(queryUrl, 'POST', {}, '');
        const query = JSON.parse(queryRaw);

        const synthUrl = `${this.baseUrl}/synthesis?speaker=${speaker}`;
        const audioBuf = await postBinary(synthUrl, query, { 'Content-Type': 'application/json' });

        return {
            content: `[VOICEVOX TTS] Generated audio (speaker: ${speaker})`,
            model: speaker,
            outputAttachments: [{
                file: `voicevox_${speaker}_${Date.now()}.wav`,
                mimetype: 'audio/wav',
                content: audioBuf.toString('base64'),
                size: audioBuf.length,
            }],
            requestUrl: queryUrl,
            requestBody: text,
        };
    }

    async listModels() {
        try {
            const url = `${this.baseUrl}/speakers`;
            const raw = await httpRequest(url, 'GET', {}, null);
            const speakers = JSON.parse(raw);
            const models = [];
            for (const s of speakers) {
                if (s.styles) {
                    for (const st of s.styles) {
                        models.push(String(st.id));
                    }
                }
            }
            return models.length > 0 ? models : this.defaultModels();
        } catch {
            return this.defaultModels();
        }
    }

    async testConnection() {
        try {
            const url = `${this.baseUrl}/speakers`;
            await httpRequest(url, 'GET', {}, null);
            return '';
        } catch (e) {
            return e.message;
        }
    }
}

const metadata = {
    id: 'voicevox',
    label: 'VOICEVOX',
    icon: '🔊',
    defaultUrl: 'http://localhost:50021',
    defaultApiPath: '/tts',
    defaultFormat: 'voicevox',
    formatLabel: 'VOICEVOX TTS',
    apiType: 'simple',
    input: ['text'],
    output: ['audio'],
    description: 'Japanese TTS engine',
    defaultApiDescUrl: 'http://localhost:50021/docs'
};

module.exports = { ProviderClass: VoicevoxProvider, metadata };
