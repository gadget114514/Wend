const { httpRequest } = require('./utils');

class MockHTTPProvider {
    constructor(baseUrl) {
        this.baseUrl = (baseUrl || 'http://localhost:8765').replace(/\/$/, '');
    }

    name() { return 'mock-http'; }
    defaultModels() { return ['echo', 'image-echo', 'image-compose']; }

    async call(req) {
        const model  = (req.model || 'echo').toLowerCase();
        const atts   = req.attachments || [];
        const images = atts.filter(a => a.mimetype?.startsWith('image/'));

        if (model === 'image-echo') {
            const img = images[0];
            if (!img) return { content: '[MockHTTP image-echo: no image provided]', model: req.model, outputAttachments: [] };
            const raw     = Buffer.from(img.content || '', 'base64');
            const body    = MockHTTPProvider._multipart('----MockHTTPBnd12345', [
                { name: 'image', filename: img.file || 'input.png', contentType: img.mimetype, data: raw },
            ]);
            const resp    = await httpRequest(
                this.baseUrl + '/recipe/image-to-image', 'POST',
                { 'Content-Type': 'multipart/form-data; boundary=----MockHTTPBnd12345' }, body);
            const outB64  = MockHTTPProvider._parseJsonField(resp, 'output_image').replace(/^processed:/, '');
            return {
                content: `[MockHTTP image-echo: ${img.file}]`,
                model: req.model,
                outputAttachments: [{ ...img, file: 'echo_' + img.file, content: outB64 }],
                requestUrl: this.baseUrl + '/recipe/image-to-image',
                requestBody: `[Multipart Form-Data: echo_${img.file} (${raw.length} bytes)]`
            };

        } else if (model === 'image-compose') {
            const base  = images[0];
            const extra = images.slice(1);
            if (!base) return { content: '[MockHTTP image-compose: no base image provided]', model: req.model, outputAttachments: [] };
            const parts = [
                { name: 'fixed_image', filename: base.file || 'fixed.png', contentType: base.mimetype, data: Buffer.from(base.content || '', 'base64') },
                ...extra.map((img, i) => ({ name: 'input_images', filename: img.file || `input_${i}.png`, contentType: img.mimetype, data: Buffer.from(img.content || '', 'base64') })),
            ];
            const body   = MockHTTPProvider._multipart('----MockHTTPBnd67890', parts);
            const resp   = await httpRequest(
                this.baseUrl + '/recipe/multi-image-to-image', 'POST',
                { 'Content-Type': 'multipart/form-data; boundary=----MockHTTPBnd67890' }, body);
            const outB64 = MockHTTPProvider._parseJsonField(resp, 'output_image').replace(/^processed:/, '');
            return {
                content: `[MockHTTP image-compose: base=${base.file}, inputs=${extra.length}]`,
                model: req.model,
                outputAttachments: [{ ...base, file: 'composed_' + base.file, content: outB64 }],
                requestUrl: this.baseUrl + '/recipe/multi-image-to-image',
                requestBody: `[Multipart Form-Data: composed_${base.file} (${body.length} bytes)]`
            };

        } else {
            // echo (default) — text-to-text
            const encoded = encodeURIComponent(req.userPrompt || '');
            const resp    = await httpRequest(
                this.baseUrl + '/recipe/text-to-text?prompt=' + encoded, 'POST',
                { 'Content-Type': 'application/json' }, '{}');
            return { content: MockHTTPProvider._parseJsonField(resp, 'output'), model: req.model, outputAttachments: [], requestUrl: this.baseUrl + '/recipe/text-to-text?prompt=' + encoded, requestBody: '{}' };
        }
    }

    async listModels() { return this.defaultModels(); }

    async testConnection() {
        try {
            const resp = await httpRequest(
                this.baseUrl + '/recipe/text-to-text?prompt=ping', 'POST',
                { 'Content-Type': 'application/json' }, '{}');
            const out = MockHTTPProvider._parseJsonField(resp, 'output');
            return out ? '' : 'Unexpected response from MockHTTPAIServer';
        } catch (e) {
            return e.message;
        }
    }

    // Build a multipart/form-data body as a Buffer.
    // parts: [{ name, filename, contentType, data: Buffer }]
    static _multipart(boundary, parts) {
        const CRLF = '\r\n';
        const bufs = [];
        for (const p of parts) {
            bufs.push(Buffer.from('--' + boundary + CRLF));
            bufs.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"${CRLF}`));
            bufs.push(Buffer.from(`Content-Type: ${p.contentType}${CRLF}${CRLF}`));
            bufs.push(p.data);
            bufs.push(Buffer.from(CRLF));
        }
        bufs.push(Buffer.from('--' + boundary + '--' + CRLF));
        return Buffer.concat(bufs);
    }

    // Extract a string value from a minimal JSON response {"key": "value"}.
    static _parseJsonField(json, key) {
        try {
            const obj = JSON.parse(json);
            return obj[key] ?? '';
        } catch {
            return '';
        }
    }
}

const metadata = {
    id: 'mock-http',
    label: 'Mock HTTP',
    icon: '🧪',
    defaultUrl: '',
    defaultApiPath: '',
    defaultFormat: 'mock-http',
    formatLabel: 'Mock HTTP',
    apiType: 'simple',
    input: ['text', 'image'],
    output: ['text', 'image'],
    description: 'HTTP test provider',
    defaultApiDescUrl: 'http://localhost:8765/docs'
};

module.exports = { ProviderClass: MockHTTPProvider, metadata };
