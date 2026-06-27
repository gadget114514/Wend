const { httpRequest } = require('./utils');

class AnthropicProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    }
    name() { return 'anthropic'; }
    defaultModels() { return ['claude-sonnet-4-6', 'claude-haiku-4-5']; }

    _buildBody(req) {
        const attachments = req.attachments || [];
        const images = attachments.filter(a => a.mimetype?.startsWith('image/'));
        
        let userContent;
        if (images.length > 0) {
            userContent = [];
            for (const img of images) {
                userContent.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: img.mimetype,
                        data: img.content
                    }
                });
            }
            userContent.push({ type: 'text', text: req.userPrompt });
        } else {
            userContent = req.userPrompt;
        }
        
        return JSON.stringify({
            model: req.model,
            max_tokens: req.maxTokens ?? 4096,
            system: req.systemPrompt || '',
            messages: [{ role: 'user', content: userContent }],
            stream: false,
        });
    }

    async call(req) {
        const body = this._buildBody(req);
        let url;
        if (req.apiPath) {
            const path = req.apiPath.replace('{model}', req.model);
            url = this.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
        } else {
            url = this.baseUrl.includes('/v1') ? this.baseUrl.replace(/\/$/, '') + '/messages' : this.baseUrl.replace(/\/$/, '') + '/v1/messages';
        }
        const raw = await httpRequest(
            url, 'POST',
            { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
            body);
        if (!raw) throw new Error(`Anthropic API Error\nProvider: anthropic\nModel: ${req.model}\nURL: ${url}\nError: Empty response received\nPossible causes: Invalid API key, network connectivity issue, or API endpoint unavailable`);
        const j = JSON.parse(raw);
        if (j.error) throw new Error(`Anthropic API Error\nProvider: anthropic\nModel: ${req.model}\nURL: ${url}\nError: ${j.error.message}\nError type: ${j.error.type || 'unknown'}`);
        const content = j.content?.[0]?.text ?? '[Anthropic: no content]';
        return { content, model: req.model, requestUrl: url, requestBody: body };
    }

    async listModels() {
        try {
            const url = this.baseUrl.includes('/v1') ? this.baseUrl.replace(/\/$/, '') + '/models' : this.baseUrl.replace(/\/$/, '') + '/v1/models';
            const raw = await httpRequest(url, 'GET',
                { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, null);
            const j = JSON.parse(raw);
            if (j.data) return j.data.map(m => m.id).sort();
        } catch {}
        return this.defaultModels();
    }

    async testConnection() {
        try {
            const url = this.baseUrl.includes('/v1') ? this.baseUrl.replace(/\/$/, '') + '/models' : this.baseUrl.replace(/\/$/, '') + '/v1/models';
            const raw = await httpRequest(url, 'GET',
                { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, null);
            const j = JSON.parse(raw);
            if (j.error) return j.error.message;
            if (j.data) return '';
            return 'Unexpected response';
        } catch (e) { return e.message; }
    }
}

const metadata = {
    id: 'anthropic',
    label: 'Anthropic',
    icon: '✉️',
    defaultUrl: 'https://api.anthropic.com',
    defaultApiPath: '/v1/messages',
    defaultFormat: 'anthropic',
    formatLabel: 'Anthropic Claude',
    apiType: 'simple',
    input: ['text'],
    output: ['text'],
    description: 'Text generation',
    defaultApiDescUrl: 'https://api.anthropic.com/docs'
};

module.exports = { ProviderClass: AnthropicProvider, metadata };
