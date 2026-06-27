const { httpRequest } = require('./utils');

class GeminiImageProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    }
    name() { return 'gemini-image'; }
    defaultModels() { return ['gemini-3.1-flash-image']; }

    async call(req) {
        const model = req.model || 'gemini-3.1-flash-image';
        const url = `${this.baseUrl}/v1/models/${model}:generateContent`;
        
        const parts = [{ text: req.userPrompt }];
        
        // Support image input
        const attachments = req.attachments || [];
        const images = attachments.filter(a => a.mimetype?.startsWith('image/'));
        for (const img of images) {
            parts.push({
                inline_data: {
                    mime_type: img.mimetype || 'image/png',
                    data: img.content || ''
                }
            });
        }

        // Build generationConfig
        const generationConfig = {
            responseModalities: req.customParams?.responseModalities || ['TEXT', 'IMAGE']
        };
        
        // Specify image format
        if (req.customParams?.aspectRatio || req.customParams?.imageSize) {
            generationConfig.responseFormat = {
                image: {
                    aspectRatio: req.customParams?.aspectRatio || '1:1',
                    imageSize: req.customParams?.imageSize || '1K'
                }
            };
        }
        
        // Control thinking level
        if (req.customParams?.thinkingLevel) {
            generationConfig.thinkingConfig = {
                thinkingLevel: req.customParams.thinkingLevel,
                includeThoughts: req.customParams.includeThoughts ?? false
            };
        }

        const body = JSON.stringify({
            contents: [{ parts }],
            generationConfig
        });
        
        const raw = await httpRequest(url, 'POST', { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }, body);
        if (!raw) throw new Error(`Gemini Image API Error\nProvider: gemini-image\nModel: ${model}\nURL: ${url}\nError: Empty response received\nPossible causes: Invalid API key, network connectivity issue, or API endpoint unavailable`);
        const j = JSON.parse(raw);
        if (j.error) throw new Error(`Gemini Image API Error\nProvider: gemini-image\nModel: ${model}\nURL: ${url}\nError: ${j.error.message}\nError code: ${j.error.code || 'unknown'}\nError status: ${j.error.status || 'unknown'}`);
        
        // Process response: extract images from candidates[].content.parts[].inlineData
        const responseParts = j.candidates?.[0]?.content?.parts || [];
        const outputAttachments = [];
        let textContent = '';
        
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

        return {
            content: textContent || `[Gemini Image Generated: ${outputAttachments.length} image(s)]`,
            model: req.model,
            requestUrl: url,
            requestBody: body,
            outputAttachments
        };
    }
    async listModels() { return this.defaultModels(); }
    async testConnection() { return ''; }
}

module.exports = GeminiImageProvider;
