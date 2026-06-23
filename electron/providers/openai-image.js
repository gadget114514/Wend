const { httpRequest } = require('./utils');

class OpenAIImageProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl || 'https://api.openai.com';
    }
    name() { return 'openai-image'; }
    defaultModels() { return ['dall-e-3', 'dall-e-2']; }

    async call(req) {
        const size = req.customParams?.size || '1024x1024';
        const body = JSON.stringify({
            model: req.model || 'dall-e-3',
            prompt: req.userPrompt,
            n: 1,
            size,
            response_format: 'b64_json'
        });
        let url;
        if (req.apiPath) {
            const path = req.apiPath.replace('{model}', req.model || 'dall-e-3');
            url = this.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
        } else {
            url = this.baseUrl.includes('/v1') ? this.baseUrl.replace(/\/$/, '') + '/images/generations' : this.baseUrl.replace(/\/$/, '') + '/v1/images/generations';
        }
        const raw = await httpRequest(
            url, 'POST',
            { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.apiKey },
            body);
        if (!raw) throw new Error(`OpenAI Image API Error\nProvider: openai-image\nModel: ${req.model}\nURL: ${url}\nError: Empty response received\nPossible causes: Invalid API key, network connectivity issue, or API endpoint unavailable`);
        const j = JSON.parse(raw);
        if (j.error) throw new Error(`OpenAI Image API Error\nProvider: openai-image\nModel: ${req.model}\nURL: ${url}\nError: ${j.error.message}\nError type: ${j.error.type || 'unknown'}`);
        const b64 = j.data?.[0]?.b64_json;
        if (!b64) throw new Error(`OpenAI Image API Error\nProvider: openai-image\nModel: ${req.model}\nURL: ${url}\nError: No image data in response\nResponse did not contain expected b64_json field`);
        
        const filename = `generated_${Date.now()}.png`;
        return {
            content: `[OpenAI Image Generated: ${filename}]`,
            model: req.model,
            requestUrl: url,
            requestBody: body,
            outputAttachments: [{
                file: filename,
                mimetype: 'image/png',
                content: b64,
                size: Buffer.from(b64, 'base64').length
            }]
        };
    }
    async listModels() { return this.defaultModels(); }
    async testConnection() { return ''; }
}

const metadata = {
    id: 'openai-image',
    label: 'OpenAI Image (DALL-E)',
    icon: '🖼️',
    defaultUrl: 'https://api.openai.com/v1',
    defaultApiPath: '/v1/images/generations',
    defaultFormat: 'openai-image',
    formatLabel: 'OpenAI Image (DALL-E)',
    apiType: 'simple',
    input: ['text'],
    output: ['image'],
    maxOutputs: 1,
    description: 'Image generation (DALL-E)',
    defaultApiDescUrl: 'https://api.openai.com/docs'
};

module.exports = { ProviderClass: OpenAIImageProvider, metadata };
