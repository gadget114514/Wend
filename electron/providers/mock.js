class MockProvider {
    name() { return 'mock'; }
    defaultModels() { return ['echo', 'fixed', 'image-echo', 'image-compose']; }

    async call(req) {
        const model  = (req.model || 'echo').toLowerCase();
        const atts   = req.attachments || [];
        const images = atts.filter(a => a.mimetype?.startsWith('image/'));
        let content;
        let outputAttachments = [];

        if (model === 'image-echo') {
            const img = images[0];
            if (img) {
                content = `[Mock image-echo: ${img.file}]`;
                outputAttachments = [{ ...img, file: `echo_${img.file}` }];
            } else {
                content = '[Mock image-echo: no image provided]';
            }

        } else if (model === 'image-compose') {
            const base  = images[0];
            const extra = images.slice(1);
            if (base) {
                content = `[Mock image-compose: base=${base.file}, inputs=${extra.length}]`;
                outputAttachments = [{ ...base, file: `composed_${base.file}` }];
            } else {
                content = '[Mock image-compose: no base image provided]';
            }

        } else if (model === 'fixed') {
            content = req.systemPrompt || '[Mock: systemPrompt is empty]';

        } else {
            content = `[Mock] ${req.userPrompt}`;
            if (atts.length > 0) {
                const imgs  = images.length;
                const auds  = atts.filter(a => a.mimetype?.startsWith('audio/')).length;
                const other = atts.length - imgs - auds;
                const parts = [];
                if (imgs)  parts.push(`${imgs} image(s)`);
                if (auds)  parts.push(`${auds} audio(s)`);
                if (other) parts.push(`${other} other(s)`);
                content += `\n[Attachments: ${parts.join(', ')}]`;
            }
        }

        return { content, model: req.model || 'echo', outputAttachments, requestUrl: 'mock://local', requestBody: JSON.stringify(req, null, 2) };
    }

    async listModels() { return this.defaultModels(); }
    async testConnection() { return ''; }
}

const metadata = {
    id: 'mock',
    label: 'Mock',
    icon: '🧪',
    defaultUrl: '',
    defaultApiPath: '',
    defaultFormat: 'mock',
    formatLabel: 'Mock',
    apiType: 'simple',
    input: ['text', 'image', 'audio'],
    output: ['text', 'image'],
    description: 'Test provider',
    defaultApiDescUrl: ''
};

module.exports = { ProviderClass: MockProvider, metadata };
