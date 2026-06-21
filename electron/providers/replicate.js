const { httpRequest, downloadBinary } = require('./utils');

class ReplicateProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl || 'https://api.replicate.com';
    }
    name() { return 'replicate'; }
    defaultModels() { return ['stability-ai/sdxl', 'bytedance/animatediff']; }

    async call(req) {
        let modelVersion = req.model;
        const body = JSON.stringify({
            version: modelVersion.includes('/') ? undefined : modelVersion,
            input: {
                prompt: req.userPrompt,
                negative_prompt: req.customParams?.negative_prompt || '',
                seed: req.customParams?.seed ? parseInt(req.customParams.seed) : undefined,
                num_inference_steps: req.customParams?.steps ? parseInt(req.customParams.steps) : undefined,
                guidance_scale: req.customParams?.cfg_scale ? parseFloat(req.customParams.cfg_scale) : undefined,
                ...req.customParams
            }
        });

        let url;
        if (req.apiPath) {
            const path = req.apiPath.replace('{model}', req.model || '');
            url = this.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
        } else {
            url = this.baseUrl.includes('/v1') ? this.baseUrl.replace(/\/$/, '') + '/predictions' : this.baseUrl.replace(/\/$/, '') + '/v1/predictions';
        }
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Token ' + this.apiKey
        };
        const raw = await httpRequest(url, 'POST', headers, body);
        if (!raw) throw new Error(`Replicate API Error\nProvider: replicate\nModel: ${req.model}\nURL: ${url}\nError: Empty response received\nPossible causes: Invalid API key, network connectivity issue, or API endpoint unavailable`);
        let prediction = JSON.parse(raw);
        if (prediction.error) throw new Error(`Replicate API Error\nProvider: replicate\nModel: ${req.model}\nURL: ${url}\nError: ${prediction.error}`);
        
        const id = prediction.id;
        let getUrl;
        if (prediction.urls?.get) {
            getUrl = prediction.urls.get;
        } else {
            const basePredictionPath = req.apiPath ? req.apiPath.replace('{model}', req.model || '') : (this.baseUrl.includes('/v1') ? '/predictions' : '/v1/predictions');
            getUrl = this.baseUrl.replace(/\/$/, '') + '/' + basePredictionPath.replace(/^\//, '').replace(/\/$/, '') + '/' + id;
        }

        let attempts = 0;
        const maxAttempts = 60;
        while (attempts < maxAttempts) {
            await new Promise(res => setTimeout(res, 5000));
            const pollRaw = await httpRequest(getUrl, 'GET', headers, null);
            if (!pollRaw) { attempts++; continue; }
            prediction = JSON.parse(pollRaw);
            if (prediction.status === 'succeeded') {
                break;
            }
            if (prediction.status === 'failed' || prediction.status === 'canceled') {
                throw new Error(`Replicate API Error\nProvider: replicate\nModel: ${req.model}\nURL: ${getUrl}\nPrediction ID: ${prediction.id}\nStatus: ${prediction.status}\nError: ${prediction.error || 'Unknown error'}`);
            }
            attempts++;
        }
        if (prediction.status !== 'succeeded') {
            throw new Error(`Replicate API Error\nProvider: replicate\nModel: ${req.model}\nURL: ${getUrl}\nPrediction ID: ${prediction.id}\nStatus: ${prediction.status}\nError: Prediction timeout after ${maxAttempts} attempts (${maxAttempts * 5} seconds)`);
        }

        const output = prediction.output;
        if (!output) throw new Error(`Replicate API Error\nProvider: replicate\nModel: ${req.model}\nURL: ${getUrl}\nPrediction ID: ${prediction.id}\nStatus: ${prediction.status}\nError: No output field in successful prediction response`);

        const urls = Array.isArray(output) ? output : [output];
        const outputAttachments = [];
        for (let i = 0; i < urls.length; i++) {
            const mediaUrl = urls[i];
            const buffer = await downloadBinary(mediaUrl);
            const ext = mediaUrl.split('.').pop().split('?')[0] || 'png';
            const mimetype = ext === 'mp4' ? 'video/mp4' : (ext === 'mp3' || ext === 'wav' ? 'audio/mpeg' : 'image/png');
            outputAttachments.push({
                file: `replicate_${id}_${i}.${ext}`,
                mimetype,
                content: buffer.toString('base64'),
                size: buffer.length
            });
        }

        return {
            content: `[Replicate Completed: prediction ${id}]`,
            model: req.model,
            requestUrl: url,
            requestBody: body,
            outputAttachments
        };
    }

    async listModels() { return this.defaultModels(); }
    async testConnection() { return ''; }
}

module.exports = ReplicateProvider;
