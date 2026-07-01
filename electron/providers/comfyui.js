const { httpRequest, downloadBinary } = require('./utils');

class ComfyUIProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = (baseUrl || 'http://localhost:8188').replace(/\/+$/, '');
    }
    name() { return 'comfyui'; }
    defaultModels() { return ['v1-5-pruned-emaonly.safetensors', 'sd_xl_base_1.0.safetensors']; }

    async call(req) {
        const model = req.model || 'v1-5-pruned-emaonly.safetensors';
        const prompt = req.prompt || req.userPrompt || '';
        let workflow;
        if (req.customParams?.workflow) {
            try {
                workflow = typeof req.customParams.workflow === 'string'
                    ? JSON.parse(req.customParams.workflow)
                    : JSON.parse(JSON.stringify(req.customParams.workflow));
            } catch (e) {
                throw new Error(`Failed to parse custom ComfyUI workflow JSON: ${e.message}`);
            }
        } else {
            // Use default standard SD1.5 text-to-image workflow
            workflow = {
                "3": {
                    "inputs": {
                        "seed": req.customParams?.seed ? parseInt(req.customParams.seed) : Math.floor(Math.random() * 1e12),
                        "steps": req.customParams?.steps ? parseInt(req.customParams.steps) : 20,
                        "cfg": req.customParams?.cfg_scale ? parseFloat(req.customParams.cfg_scale) : 8,
                        "sampler_name": req.customParams?.sampler_name || "euler",
                        "scheduler": req.customParams?.scheduler || "normal",
                        "denoise": 1,
                        "model": ["4", 0],
                        "positive": ["6", 0],
                        "negative": ["7", 0],
                        "latent_image": ["5", 0]
                    },
                    "class_type": "KSampler"
                },
                "4": {
                    "inputs": {
                        "ckpt_name": model
                    },
                    "class_type": "CheckpointLoaderSimple"
                },
                "5": {
                    "inputs": {
                        "width": 512,
                        "height": 512,
                        "batch_size": 1
                    },
                    "class_type": "EmptyLatentImage"
                },
                "6": {
                    "inputs": {
                        "text": prompt,
                        "clip": ["4", 1]
                    },
                    "class_type": "CLIPTextEncode"
                },
                "7": {
                    "inputs": {
                        "text": req.customParams?.negative_prompt || "bad quality, blurry",
                        "clip": ["4", 1]
                    },
                    "class_type": "CLIPTextEncode"
                },
                "8": {
                    "inputs": {
                        "samples": ["3", 0],
                        "vae": ["4", 2]
                    },
                    "class_type": "VAEDecode"
                },
                "9": {
                    "inputs": {
                        "filename_prefix": "ComfyUI",
                        "images": ["8", 0]
                    },
                    "class_type": "SaveImage"
                }
            };

            // Update latent image size if size parameter is provided (e.g., "512x512")
            if (req.customParams?.size) {
                const parts = req.customParams.size.split('x');
                if (parts.length === 2) {
                    const w = parseInt(parts[0]);
                    const h = parseInt(parts[1]);
                    if (!isNaN(w) && !isNaN(h)) {
                        workflow["5"].inputs.width = w;
                        workflow["5"].inputs.height = h;
                    }
                }
            }
        }

        if (req.customParams?.workflow) {
            // Try to set model checkpoint
            let checkpointNodeId = req.customParams?.checkpoint_node_id;
            if (!checkpointNodeId) {
                const cpNode = Object.entries(workflow).find(([id, node]) => 
                    node.class_type === 'CheckpointLoaderSimple' || node.class_type === 'CheckpointLoader'
                );
                if (cpNode) checkpointNodeId = cpNode[0];
            }
            if (checkpointNodeId && workflow[checkpointNodeId] && workflow[checkpointNodeId].inputs) {
                workflow[checkpointNodeId].inputs.ckpt_name = model;
            }

            // Try to set positive prompt
            let promptNodeId = req.customParams?.prompt_node_id;
            if (!promptNodeId) {
                let ksampler = Object.entries(workflow).find(([id, node]) => node.class_type === 'KSampler');
                if (ksampler) {
                    const posRef = ksampler[1].inputs?.positive;
                    if (Array.isArray(posRef)) {
                        promptNodeId = posRef[0];
                    }
                }
                if (!promptNodeId) {
                    let clipNode = Object.entries(workflow).find(([id, node]) => node.class_type === 'CLIPTextEncode');
                    if (clipNode) promptNodeId = clipNode[0];
                }
            }
            if (promptNodeId && workflow[promptNodeId] && workflow[promptNodeId].inputs) {
                workflow[promptNodeId].inputs.text = prompt;
            }

            // Try to set negative prompt if provided
            if (req.customParams?.negative_prompt) {
                let negativeNodeId = req.customParams?.negative_node_id;
                if (!negativeNodeId) {
                    let ksampler = Object.entries(workflow).find(([id, node]) => node.class_type === 'KSampler');
                    if (ksampler) {
                        const negRef = ksampler[1].inputs?.negative;
                        if (Array.isArray(negRef)) {
                            negativeNodeId = negRef[0];
                        }
                    }
                    if (!negativeNodeId) {
                        let clipNodes = Object.entries(workflow).filter(([id, node]) => node.class_type === 'CLIPTextEncode');
                        if (clipNodes.length > 1) {
                            negativeNodeId = clipNodes[1][0];
                        }
                    }
                }
                if (negativeNodeId && workflow[negativeNodeId] && workflow[negativeNodeId].inputs) {
                    workflow[negativeNodeId].inputs.text = req.customParams.negative_prompt;
                }
            }

            // Try to set sampler params
            let ksamplerId = req.customParams?.ksampler_node_id;
            if (!ksamplerId) {
                let ksampler = Object.entries(workflow).find(([id, node]) => node.class_type === 'KSampler');
                if (ksampler) ksamplerId = ksampler[0];
            }
            if (ksamplerId && workflow[ksamplerId] && workflow[ksamplerId].inputs) {
                if (workflow[ksamplerId].inputs.seed !== undefined) {
                    workflow[ksamplerId].inputs.seed = req.customParams?.seed ? parseInt(req.customParams.seed) : Math.floor(Math.random() * 1e12);
                }
                if (req.customParams?.steps && workflow[ksamplerId].inputs.steps !== undefined) {
                    workflow[ksamplerId].inputs.steps = parseInt(req.customParams.steps);
                }
                if (req.customParams?.cfg_scale && workflow[ksamplerId].inputs.cfg !== undefined) {
                    workflow[ksamplerId].inputs.cfg = parseFloat(req.customParams.cfg_scale);
                }
            }
        }

        const bodyObj = { prompt: workflow };
        if (this.apiKey) {
            bodyObj.extra_data = {
                api_key_comfy_org: this.apiKey
            };
        }
        const body = JSON.stringify(bodyObj);

        let url;
        if (req.apiPath) {
            url = this.baseUrl.replace(/\/$/, '') + '/' + req.apiPath.replace(/^\//, '');
        } else {
            url = this.baseUrl.replace(/\/$/, '') + '/prompt';
        }

        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        const raw = await httpRequest(url, 'POST', headers, body);
        if (!raw) throw new Error(`ComfyUI API Error\nProvider: comfyui\nModel: ${req.model}\nURL: ${url}\nError: Empty response received`);
        
        const j = JSON.parse(raw);
        if (j.error) {
            let msg = `ComfyUI API Error\nProvider: comfyui\nModel: ${req.model}\nURL: ${url}\nError: ${j.error.message || JSON.stringify(j.error)}`;
            if (j.node_errors) {
                for (const [nodeId, nodeErr] of Object.entries(j.node_errors)) {
                    if (nodeErr.errors) {
                        for (const e of nodeErr.errors) {
                            msg += `\n  • Node ${nodeId} (${nodeErr.class_type || '?'}): ${e.details || e.message}`;
                        }
                    }
                }
                msg += `\n\nSuggested fix: Place the model file in ComfyUI's models/checkpoints/ directory and restart ComfyUI.`;
            }
            throw new Error(msg);
        }
        
        const promptId = j.prompt_id;
        if (!promptId) {
            throw new Error(`ComfyUI API Error\nProvider: comfyui\nModel: ${req.model}\nURL: ${url}\nError: No prompt_id in response. Details: ${raw}`);
        }

        // Poll history endpoint until finished
        let attempts = 0;
        const maxAttempts = 60;
        let historyData = null;
        while (attempts < maxAttempts) {
            await new Promise(res => setTimeout(res, 3000));
            const pollUrl = `${this.baseUrl}/history/${promptId}`;
            const pollHeaders = {};
            if (this.apiKey) pollHeaders['Authorization'] = `Bearer ${this.apiKey}`;
            const pollRaw = await httpRequest(pollUrl, 'GET', pollHeaders, null);
            if (pollRaw) {
                const pollJson = JSON.parse(pollRaw);
                if (pollJson && pollJson[promptId]) {
                    historyData = pollJson[promptId];
                    break;
                }
            }
            attempts++;
        }

        if (!historyData) {
            throw new Error(`ComfyUI API Error\nProvider: comfyui\nModel: ${req.model}\nPrompt ID: ${promptId}\nError: Prediction timeout after ${maxAttempts} attempts (${maxAttempts * 3} seconds)`);
        }

        const outputAttachments = [];
        if (historyData.outputs) {
            for (const [nodeId, nodeOutput] of Object.entries(historyData.outputs)) {
                if (nodeOutput.images && Array.isArray(nodeOutput.images)) {
                    for (const img of nodeOutput.images) {
                        const filename = img.filename;
                        const subfolder = img.subfolder || '';
                        const type = img.type || 'output';
                        const viewUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
                        
                        const imgHeaders = {};
                        if (this.apiKey) imgHeaders['Authorization'] = `Bearer ${this.apiKey}`;
                        const buffer = await downloadBinary(viewUrl, imgHeaders);
                        const fileAttachmentName = `comfyui_${promptId}_${nodeId}_${filename}`;
                        outputAttachments.push({
                            file: fileAttachmentName,
                            mimetype: 'image/png',
                            content: buffer.toString('base64'),
                            size: buffer.length
                        });
                    }
                }
            }
        }

        if (outputAttachments.length === 0) {
            throw new Error(`ComfyUI API Error\nProvider: comfyui\nModel: ${req.model}\nPrompt ID: ${promptId}\nError: No output images generated by the workflow`);
        }

        return {
            content: `[ComfyUI Completed: prompt ${promptId}]`,
            model: req.model,
            requestUrl: url,
            requestBody: body,
            outputAttachments
        };
    }

    async listModels() {
        const headers = {};
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
        try {
            const raw = await httpRequest(this.baseUrl + '/object_info/CheckpointLoaderSimple', 'GET', headers, null);
            if (raw) {
                const j = JSON.parse(raw);
                const ckptNames = j.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
                if (Array.isArray(ckptNames)) {
                    return ckptNames.sort();
                }
            }
        } catch (e) {
            console.error('[ComfyUI] Failed to list models from CheckpointLoaderSimple:', e.message);
        }
        try {
            const raw = await httpRequest(this.baseUrl + '/object_info/ImageOnlyCheckpointLoader', 'GET', headers, null);
            if (raw) {
                const j = JSON.parse(raw);
                const ckptNames = j.ImageOnlyCheckpointLoader?.input?.required?.ckpt_name?.[0];
                if (Array.isArray(ckptNames)) {
                    return ckptNames.sort();
                }
            }
        } catch (e) {
            console.error('[ComfyUI] Failed to list models from ImageOnlyCheckpointLoader:', e.message);
        }
        return this.defaultModels();
    }

    async testConnection() {
        try {
            const headers = {};
            if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
            const raw = await httpRequest(this.baseUrl + '/system_stats', 'GET', headers, null);
            if (raw) return '';
            return 'Empty response';
        } catch (e) {
            return e.message;
        }
    }
}

const metadata = {
    id: 'comfyui',
    label: 'ComfyUI',
    icon: '🧩',
    defaultUrl: 'http://localhost:8188',
    defaultApiPath: '/prompt',
    defaultFormat: 'comfyui',
    formatLabel: 'ComfyUI Workflow',
    apiType: 'polling',
    input: ['text'],
    output: ['image'],
    maxOutputs: 1,
    description: 'Local workflow-based image generation',
    defaultApiDescUrl: 'http://localhost:8188'
};

module.exports = { ProviderClass: ComfyUIProvider, metadata };
