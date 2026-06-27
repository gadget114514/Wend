const { httpRequest } = require('./utils');

class OllamaProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = (baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    }
    name() { return 'ollama'; }
    defaultModels() { return ['llama3.2', 'mistral']; }

    _buildBody(req) {
        return JSON.stringify({
            model: req.model,
            system: req.systemPrompt || '',
            prompt: req.userPrompt,
            options: { temperature: req.temperature ?? 0.7 },
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
            url = this.baseUrl.replace(/\/$/, '') + '/api/generate';
        }
        const raw = await httpRequest(url, 'POST',
            { 'Content-Type': 'application/json' }, body);
        if (!raw) throw new Error(`Ollama API Error\nProvider: ollama\nModel: ${req.model}\nURL: ${url}\nError: Empty response received\nPossible causes: Ollama server not running, network connectivity issue, or model not available`);
        const j = JSON.parse(raw);
        if (j.error) throw new Error(`Ollama API Error\nProvider: ollama\nModel: ${req.model}\nURL: ${url}\nError: ${j.error}`);
        return { content: j.response ?? '[Ollama: no content]', model: req.model, requestUrl: url, requestBody: body };
    }

    async listModels() {
        try {
            const raw = await httpRequest(this.baseUrl + '/api/tags', 'GET', {}, null);
            const j = JSON.parse(raw);
            if (j.models) return j.models.map(m => m.name).sort();
        } catch {}
        return this.defaultModels();
    }

    async testConnection() {
        try {
            const raw = await httpRequest(this.baseUrl + '/api/tags', 'GET', {}, null);
            const j = JSON.parse(raw);
            if (j.error) return j.error;
            if (j.models) return '';
            return 'Unexpected response';
        } catch (e) { return e.message; }
    }
}

const metadata = {
    id: 'ollama',
    label: 'Ollama',
    icon: '🦙',
    defaultUrl: 'http://localhost:11434',
    defaultApiPath: '/api/generate',
    defaultFormat: 'ollama',
    formatLabel: 'Ollama',
    apiType: 'simple',
    input: ['text'],
    output: ['text'],
    description: 'Text generation',
    defaultApiDescUrl: 'http://localhost:11434/docs'
};

module.exports = { ProviderClass: OllamaProvider, metadata };
