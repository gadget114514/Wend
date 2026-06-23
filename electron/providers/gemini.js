const { httpRequest } = require('./utils');

class GeminiProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl || 'https://generativelanguage.googleapis.com';
    }
    name() { return 'gemini'; }
    defaultModels() { return ['gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image', 'imagen-3.0-generate-001', 'imagen-4.0-generate-001']; }

    _isImagenModel(model) {
        return model && model.toLowerCase().includes('imagen');
    }

    _buildBody(req) {
        const isPredict = this._isImagenModel(req.model);
        if (isPredict) {
            return JSON.stringify({
                instances: [
                    {
                        prompt: req.userPrompt
                    }
                ],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: req.customParams?.aspectRatio || '1:1',
                    imageFormat: 'image/png'
                }
            });
        }

        const attachments = req.attachments || [];
        const parts = [];
        
        // Support file_data from customParams
        if (req.customParams?.file_data) {
            const fileDatas = Array.isArray(req.customParams.file_data) 
                ? req.customParams.file_data 
                : [req.customParams.file_data];
            
            for (const fd of fileDatas) {
                const filePart = { file_data: fd };
                if (req.customParams?.video_metadata) {
                    filePart.video_metadata = req.customParams.video_metadata;
                }
                parts.push(filePart);
            }
        }

        // Support attachments (images, video, audio)
        for (const file of attachments) {
            const mimeType = file.mimetype || 'image/png';
            if (!file.mimetype) {
                console.warn('[Gemini] Attachment missing mimetype, defaulting to image/png:', file.file || 'unknown');
            }
            parts.push({
                inline_data: {
                    mime_type: mimeType,
                    data: file.content || ''
                }
            });
        }

        parts.push({ text: req.userPrompt });
        
        const generationConfig = {
            temperature: req.temperature ?? 0.7,
            maxOutputTokens: req.maxTokens ?? 4096
        };

        // Support responseModalities & responseFormat inside generationConfig
        if (req.customParams?.responseModalities) {
            generationConfig.responseModalities = req.customParams.responseModalities;
        }
        if (req.customParams?.aspectRatio || req.customParams?.imageSize) {
            const imageFormat = {};
            if (req.customParams.aspectRatio) imageFormat.aspectRatio = req.customParams.aspectRatio;
            if (req.customParams.imageSize) imageFormat.imageSize = req.customParams.imageSize;
            if (Object.keys(imageFormat).length > 0) {
                generationConfig.responseFormat = { image: imageFormat };
            }
        }
        // Control thinking level
        if (req.customParams?.thinkingLevel) {
            generationConfig.thinkingConfig = {
                thinkingLevel: req.customParams.thinkingLevel,
                includeThoughts: req.customParams.includeThoughts ?? false
            };
        }

        const bodyObj = {
            contents: [{ parts }],
            generationConfig,
            systemInstruction: req.systemPrompt ? { parts: [{ text: req.systemPrompt }] } : undefined,
        };

        if (req.customParams?.tools) {
            bodyObj.tools = req.customParams.tools;
        }

        return JSON.stringify(bodyObj);
    }

    async call(req) {
        const model = req.model || 'gemini-3.5-flash';
        const attachments = req.attachments || [];
        if (attachments.length > 0) {
            console.log('[Gemini] Request attachments:', attachments.map(a => ({
                file: a.file,
                mimetype: a.mimetype,
                size: a.size || (a.content ? Math.round(a.content.length * 0.75) : 0),
                hasContent: !!a.content
            })));
        }
        const body = this._buildBody(req);
        let url;
        
        if (req.apiPath) {
            const path = req.apiPath.replace('{model}', model);
            url = this.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
        } else if (this._isImagenModel(model)) {
            let base = this.baseUrl.replace(/\/$/, '');
            if (base.includes('/v1beta')) {
                url = `${base}/models/${model}:predict`;
            } else if (base.includes('/v1')) {
                url = `${base.replace(/\/v1$/, '/v1beta')}/models/${model}:predict`;
            } else {
                url = `${base}/v1beta/models/${model}:predict`;
            }
        } else if (this.baseUrl.includes('/v1beta') || this.baseUrl.includes('/v1')) {
            url = `${this.baseUrl}/models/${model}:generateContent`;
        } else {
            const apiVersion = model === 'gemini-3.1-flash-image' ? 'v1' : 'v1beta';
            url = `${this.baseUrl}/${apiVersion}/models/${model}:generateContent`;
        }

        const raw = await httpRequest(url, 'POST', { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }, body);
        if (!raw) throw new Error(`Gemini API Error\nProvider: gemini\nModel: ${model}\nURL: ${url}\nError: Empty response received\nPossible causes: Invalid API key, network connectivity issue, or API endpoint unavailable`);
        const j = JSON.parse(raw);
        if (j.error) {
            const attachmentInfo = (req.attachments || []).map(a => ({
                file: a.file || 'unknown',
                mimetype: a.mimetype || 'MISSING',
                size: a.size || (a.content ? Math.round(a.content.length * 0.75) : 0)
            }));
            console.error('[Gemini] API Error - Attachments sent:', JSON.stringify(attachmentInfo, null, 2));
            throw new Error(`Gemini API Error\nProvider: gemini\nModel: ${model}\nURL: ${url}\nError: ${j.error.message}\nError code: ${j.error.code || 'unknown'}\nError status: ${j.error.status || 'unknown'}\nAttachments: ${JSON.stringify(attachmentInfo)}`);
        }

        const outputAttachments = [];
        let textContent = '';

        const isPredict = url.includes(':predict');
        if (isPredict) {
            const predictions = j.predictions || [];
            for (let i = 0; i < predictions.length; i++) {
                const pred = predictions[i];
                const b64 = pred.bytesBase64Encoded;
                const mime = pred.mimeType || 'image/png';
                const ext = mime.split('/')[1] || 'png';
                const filename = `imagen_${Date.now()}_${i}.${ext}`;
                outputAttachments.push({
                    file: filename,
                    mimetype: mime,
                    content: b64,
                    size: Buffer.from(b64, 'base64').length
                });
            }
        } else {
            const responseParts = j.candidates?.[0]?.content?.parts || [];
            for (const part of responseParts) {
                if (part.text) {
                    textContent += part.text;
                } else if (part.inlineData) {
                    const b64 = part.inlineData.data;
                    const mime = part.inlineData.mimeType || 'image/png';
                    const ext = mime.split('/')[1] || 'png';
                    const filename = `gemini_${Date.now()}_${outputAttachments.length}.${ext}`;
                    outputAttachments.push({
                        file: filename,
                        mimetype: mime,
                        content: b64,
                        size: Buffer.from(b64, 'base64').length
                    });
                }
            }
        }

        return {
            content: textContent || (outputAttachments.length > 0 ? `[Gemini: ${outputAttachments.length} image(s)]` : '[Gemini: no content]'),
            model: model,
            requestUrl: url,
            requestBody: body,
            outputAttachments,
        };
    }

    async listModels() {
        try {
            const url = this.baseUrl.includes('/v1beta') || this.baseUrl.includes('/v1')
                ? `${this.baseUrl}/models`
                : `${this.baseUrl}/v1beta/models`;
            const raw = await httpRequest(url, 'GET', { 'x-goog-api-key': this.apiKey }, null);
            const j = JSON.parse(raw);
            if (j.models) return j.models.map(m => m.name.split('/').pop()).sort();
        } catch {}
        return this.defaultModels();
    }

    async testConnection() {
        try {
            const url = this.baseUrl.includes('/v1beta') || this.baseUrl.includes('/v1')
                ? `${this.baseUrl}/models`
                : `${this.baseUrl}/v1beta/models`;
            const raw = await httpRequest(url, 'GET', { 'x-goog-api-key': this.apiKey }, null);
            const j = JSON.parse(raw);
            if (j.error) return j.error.message;
            if (j.models) return '';
            return 'Unexpected response';
        } catch (e) { return e.message; }
    }
}

const metadata = {
    id: 'gemini',
    label: 'Gemini',
    icon: '♊',
    defaultUrl: 'https://generativelanguage.googleapis.com',
    defaultApiPath: '/v1beta/models/{model}:generateContent',
    defaultFormat: 'gemini',
    formatLabel: 'Google Gemini',
    apiType: 'simple',
    input: ['text', 'image', 'audio', 'video'],
    output: ['text', 'image'],
    description: 'Text & Image generation (Gemini / Imagen)',
    defaultApiDescUrl: 'https://generativelanguage.googleapis.com/docs'
};

module.exports = { ProviderClass: GeminiProvider, metadata };
