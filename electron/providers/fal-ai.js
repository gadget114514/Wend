const { httpRequest, downloadBinary } = require('./utils');

class FalAIProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl || 'https://queue.fal.run';
    }
    name() { return 'fal-ai'; }
    defaultModels() { return ['fal-ai/flux/schnell', 'fal-ai/stable-diffusion-v35-medium']; }

    async call(req) {
        const modelName = req.model;
        let url;
        if (req.apiPath) {
            const path = req.apiPath.replace('{model}', modelName);
            url = this.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
        } else {
            url = `${this.baseUrl}/${modelName}`;
        }
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Key ' + this.apiKey
        };
        const body = JSON.stringify({
            prompt: req.userPrompt,
            negative_prompt: req.customParams?.negative_prompt || '',
            seed: req.customParams?.seed ? parseInt(req.customParams.seed) : undefined,
            num_inference_steps: req.customParams?.steps ? parseInt(req.customParams.steps) : undefined,
            guidance_scale: req.customParams?.cfg_scale ? parseFloat(req.customParams.cfg_scale) : undefined,
            ...req.customParams
        });

        const raw = await httpRequest(url, 'POST', headers, body);
        if (!raw) throw new Error(`Fal.ai API Error\nProvider: fal-ai\nModel: ${req.model}\nURL: ${url}\nError: Empty response received\nPossible causes: Invalid API key, network connectivity issue, or API endpoint unavailable`);
        let job = JSON.parse(raw);
        if (job.error) throw new Error(`Fal.ai API Error\nProvider: fal-ai\nModel: ${req.model}\nURL: ${url}\nError: ${job.error}`);
        const requestId = job.request_id;
        const statusUrl = `${url}/requests/${requestId}`;

        let attempts = 0;
        const maxAttempts = 60;
        while (attempts < maxAttempts) {
            await new Promise(res => setTimeout(res, 3000));
            const pollRaw = await httpRequest(statusUrl, 'GET', headers, null);
            if (!pollRaw) { attempts++; continue; }
            const statusData = JSON.parse(pollRaw);
            if (statusData.status === 'COMPLETED') {
                const finalRaw = await httpRequest(statusUrl, 'GET', headers, null);
                if (!finalRaw) throw new Error(`Fal.ai API Error\nProvider: fal-ai\nModel: ${req.model}\nURL: ${statusUrl}\nRequest ID: ${requestId}\nError: Empty response received on completion\nPossible causes: Network issue or request expired`);
                job = JSON.parse(finalRaw);
                break;
            }
            if (statusData.status === 'FAILED') {
                throw new Error(`Fal.ai API Error\nProvider: fal-ai\nModel: ${req.model}\nURL: ${statusUrl}\nRequest ID: ${requestId}\nStatus: FAILED\nError: ${statusData.error || 'Prediction failed with no error details'}`);
            }
            attempts++;
        }

        const outputAttachments = [];
        const images = job.images || [];
        const videos = job.video ? [job.video] : [];
        const outputs = [...images, ...videos];

        if (outputs.length === 0 && job.output) {
             outputs.push(job.output);
        }

        for (let i = 0; i < outputs.length; i++) {
            const out = outputs[i];
            const mediaUrl = typeof out === 'string' ? out : (out.url || '');
            if (!mediaUrl) continue;
            const buffer = await downloadBinary(mediaUrl);
            const ext = mediaUrl.split('.').pop().split('?')[0] || 'png';
            const mimetype = out.content_type || (ext === 'mp4' ? 'video/mp4' : 'image/png');
            outputAttachments.push({
                file: `fal_${requestId}_${i}.${ext}`,
                mimetype,
                content: buffer.toString('base64'),
                size: buffer.length
            });
        }

        return {
            content: `[Fal.ai Completed: request ${requestId}]`,
            model: req.model,
            requestUrl: url,
            requestBody: body,
            outputAttachments
        };
    }

    async listModels() { return this.defaultModels(); }
    async testConnection() { return ''; }
}

const metadata = {
    id: 'fal-ai',
    label: 'Fal.ai',
    icon: '⚡',
    defaultUrl: 'https://queue.fal.run',
    defaultApiPath: '/{model}',
    defaultFormat: 'fal-ai',
    formatLabel: 'Fal.ai (Image/Video)',
    apiType: 'polling',
    input: ['text'],
    output: ['image', 'video'],
    description: 'Image/Video generation',
    defaultApiDescUrl: 'https://queue.fal.run/docs'
};

module.exports = { ProviderClass: FalAIProvider, metadata };
