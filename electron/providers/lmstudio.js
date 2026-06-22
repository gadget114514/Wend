const { httpRequest } = require('./utils');

class LMStudioProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl || 'http://localhost:1234/v1';
    }

    name() { return 'lmstudio'; }

    defaultModels() {
        return ['llama-3.2-8b-instruct', 'mistral-7b-instruct', 'phi-3-mini'];
    }

    _buildBody(req) {
        const messages = [];
        if (req.systemPrompt) {
            messages.push({ role: 'system', content: req.systemPrompt });
        }

        const attachments = req.attachments || [];
        const images = attachments.filter(a => a.mimetype?.startsWith('image/'));

        let userContent;
        if (images.length > 0) {
            userContent = [{ type: 'text', text: req.userPrompt }];
            for (const img of images) {
                userContent.push({
                    type: 'image_url',
                    image_url: { url: `data:${img.mimetype};base64,${img.content}` }
                });
            }
        } else {
            userContent = req.userPrompt;
        }

        messages.push({ role: 'user', content: userContent });

        return JSON.stringify({
            model: req.model,
            messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 4096,
            stream: false,
        });
    }

    async call(req) {
        const body = this._buildBody(req);
        let url;

        if (req.apiPath) {
            const apiPath = req.apiPath.replace('{model}', req.model);
            url = this.baseUrl.replace(/\/$/, '') + '/' + apiPath.replace(/^\//, '');
        } else {
            url = this.baseUrl.replace(/\/$/, '') + '/chat/completions';
        }

        const raw = await httpRequest(
            url, 'POST',
            { 'Content-Type': 'application/json' },
            body
        );

        if (!raw) {
            throw new Error(
                `LM Studio API Error\n` +
                `Provider: lmstudio\n` +
                `Model: ${req.model}\n` +
                `URL: ${url}\n` +
                `Error: Empty response received\n` +
                `Possible causes: LM Studio server not running, model not loaded, or connection refused`
            );
        }

        const j = JSON.parse(raw);

        if (j.error) {
            throw new Error(
                `LM Studio API Error\n` +
                `Provider: lmstudio\n` +
                `Model: ${req.model}\n` +
                `URL: ${url}\n` +
                `Error: ${j.error.message || JSON.stringify(j.error)}\n` +
                `Error type: ${j.error.type || 'unknown'}`
            );
        }

        return {
            content: j.choices?.[0]?.message?.content ?? '[LM Studio: no content]',
            model: req.model,
            requestUrl: url,
            requestBody: body
        };
    }

    async listModels() {
        try {
            const url = this.baseUrl.replace(/\/$/, '') + '/models';
            const raw = await httpRequest(url, 'GET', {}, null);
            const j = JSON.parse(raw);
            if (j.data) {
                return j.data.map(m => m.id).sort();
            }
        } catch (e) {
            console.error('[LMStudio] listModels error:', e.message);
        }
        return this.defaultModels();
    }

    async testConnection() {
        try {
            const url = this.baseUrl.replace(/\/$/, '') + '/models';
            const raw = await httpRequest(url, 'GET', {}, null);
            const j = JSON.parse(raw);
            if (j.error) {
                return j.error.message || 'Unknown error';
            }
            if (j.data) {
                return '';  // 空文字列 = 成功
            }
            return 'Unexpected response format';
        } catch (e) {
            return e.message;
        }
    }
}

module.exports = LMStudioProvider;
