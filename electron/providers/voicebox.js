'use strict';
const { httpRequest, downloadBinary } = require('./utils');

class VoiceboxProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey || '';
        this.baseUrl = (baseUrl || 'http://127.0.0.1:17493').replace(/\/+$/, '');
    }

    name() { return 'voicebox'; }

    defaultModels() {
        return ['kokoro', 'qwen', 'qwen_custom_voice', 'luxtts', 'chatterbox', 'chatterbox_turbo', 'tada'];
    }

    async call(req) {
        const text = req.userPrompt || '';
        if (!text.trim()) throw new Error('Voicebox TTS: text is required');

        const profileName = req.customParams?.profile_name || null;
        const language = req.customParams?.language || null;

        const speakBody = {
            text: text,
            profile: profileName,
            engine: req.model || 'kokoro',
        };
        if (language) speakBody.language = language;

        const speakUrl = this.baseUrl + '/speak';
        const speakRaw = await httpRequest(speakUrl, 'POST',
            { 'Content-Type': 'application/json' },
            JSON.stringify(speakBody));
        let gen;
        try { gen = JSON.parse(speakRaw); } catch (e) {
            throw new Error(`Voicebox /speak parse error: ${speakRaw.slice(0, 200)}`);
        }

        const genId = gen.id;
        let status = gen.status || 'generating';

        // Poll SSE status endpoint until completed or error
        const statusUrl = this.baseUrl + '/generate/' + genId + '/status';
        const maxAttempts = 300; // 5 min timeout (1s per poll)
        let attempts = 0;
        while ((status === 'generating' || status === 'loading_model' || status === 'queued') && attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
            try {
                const statusRaw = await httpRequest(statusUrl, 'GET', {}, null);
                const lines = statusRaw.split('\n').filter(l => l.trim().startsWith('data: '));
                if (lines.length > 0) {
                    const lastLine = lines[lines.length - 1];
                    const statusData = JSON.parse(lastLine.replace(/^data:\s*/, ''));
                    status = statusData.status || status;
                    if (status === 'completed') break;
                    if (status === 'error') {
                        throw new Error(`Voicebox generation failed: ${statusData.error || 'unknown error'}`);
                    }
                }
            } catch (e) {
                if (e.message.includes('Voicebox generation failed')) throw e;
                // transient error, keep polling
            }
        }

        if (status !== 'completed') {
            throw new Error(`Voicebox generation timed out or failed (status: ${status})`);
        }

        // Download generated audio
        const audioUrl = this.baseUrl + '/audio/' + genId;
        const audioBuf = await downloadBinary(audioUrl, {});

        return {
            content: `[Voicebox TTS] Generated audio (${genId})`,
            model: req.model || 'kokoro',
            outputAttachments: [{
                file: `voicebox_${genId}.wav`,
                mimetype: 'audio/wav',
                content: audioBuf.toString('base64'),
                size: audioBuf.length,
            }],
            requestUrl: speakUrl,
            requestBody: JSON.stringify(speakBody),
        };
    }

    async listModels() {
        return this.defaultModels();
    }

    async testConnection() {
        try {
            const url = this.baseUrl + '/health';
            const raw = await httpRequest(url, 'GET', {}, null);
            const j = JSON.parse(raw);
            if (j.status === 'healthy') return '';
            return 'Voicebox status: ' + (j.status || 'unknown');
        } catch (e) {
            return e.message;
        }
    }
}

const metadata = {
    id: 'voicebox',
    label: 'Voicebox',
    icon: '🎵',
    defaultUrl: 'http://127.0.0.1:17493',
    defaultApiPath: '/speak',
    defaultFormat: 'voicebox',
    formatLabel: 'Voicebox TTS',
    apiType: 'simple',
    input: ['text'],
    output: ['audio'],
    description: 'Local TTS via Voicebox',
    defaultApiDescUrl: 'http://127.0.0.1:17493/docs'
};

module.exports = { ProviderClass: VoiceboxProvider, metadata };
