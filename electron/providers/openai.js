const { httpRequest } = require('./utils');

class OpenAIProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl || 'https://api.openai.com';
    }
    name() { return 'openai'; }
    defaultModels() { return ['gpt-4.1', 'gpt-4o-mini']; }

    _buildBody(req) {
        const messages = [];
        if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt });
        
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
            const path = req.apiPath.replace('{model}', req.model);
            url = this.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
        } else {
            url = this.baseUrl.includes('/v1') ? this.baseUrl.replace(/\/$/, '') + '/chat/completions' : this.baseUrl.replace(/\/$/, '') + '/v1/chat/completions';
        }
        const raw = await httpRequest(
            url, 'POST',
            { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.apiKey },
            body);
        if (!raw) throw new Error(`OpenAI API Error\nProvider: openai\nModel: ${req.model}\nURL: ${url}\nError: Empty response received\nPossible causes: Invalid API key, network connectivity issue, or API endpoint unavailable`);
        const j = JSON.parse(raw);
        if (j.error) throw new Error(`OpenAI API Error\nProvider: openai\nModel: ${req.model}\nURL: ${url}\nError: ${j.error.message}\nError type: ${j.error.type || 'unknown'}\nError code: ${j.error.code || 'unknown'}`);
        const msg = j.choices?.[0]?.message || {};
        // Reasoning models expose their internal chain separately; surface it as
        // `reasoning` so the app can show it as an AI comment (not as output).
        const reasoning = msg.reasoning_content || msg.reasoning || '';
        return { content: msg.content ?? '[OpenAI: no content]', reasoning, model: req.model, requestUrl: url, requestBody: body };
    }

    async listModels() {
        try {
            const url = this.baseUrl.includes('/v1') ? this.baseUrl.replace(/\/$/, '') + '/models' : this.baseUrl.replace(/\/$/, '') + '/v1/models';
            const raw = await httpRequest(url, 'GET',
                { 'Authorization': 'Bearer ' + this.apiKey }, null);
            const j = JSON.parse(raw);
            if (j.data) return j.data.map(m => m.id).sort();
        } catch {}
        return this.defaultModels();
    }

    async testConnection() {
        try {
            const url = this.baseUrl.includes('/v1') ? this.baseUrl.replace(/\/$/, '') + '/models' : this.baseUrl.replace(/\/$/, '') + '/v1/models';
            const raw = await httpRequest(url, 'GET',
                { 'Authorization': 'Bearer ' + this.apiKey }, null);
            const j = JSON.parse(raw);
            if (j.error) return j.error.message;
            if (j.data) return '';
            return 'Unexpected response';
        } catch (e) { return e.message; }
    }
}

const metadata = {
    id: 'openai',
    label: 'OpenAI',
    icon: '🧠',
    defaultUrl: 'https://api.openai.com/v1',
    defaultApiPath: '/chat/completions',
    defaultFormat: 'openai',
    formatLabel: 'OpenAI Chat',
    apiType: 'simple',
    input: ['text'],
    output: ['text'],
    description: 'Text generation',
    defaultApiDescUrl: 'https://api.openai.com/docs'
};

module.exports = { ProviderClass: OpenAIProvider, metadata };
