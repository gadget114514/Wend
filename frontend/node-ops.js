function expandTemplate(template, params, inputs, ctx) {
    if (!template) return '';
    return template.replace(/\{param:([a-zA-Z0-9_]+)\}/g, (_, name) => {
        return params[name] !== undefined ? params[name] : '';
    }).replace(/\{in:([a-zA-Z0-9_]+)\}/g, (_, name) => {
        return inputs.get(name) !== undefined ? inputs.get(name) : '';
    }).replace(/\{bb:([a-zA-Z0-9_.]+)\}/g, (_, key) => {
        return ctx.bb.readText(key) || '';
    });
}

window.WendNodeOps = {
    async runProviderNode(ctx) {
        const btAction = ctx.node.btAction || 'processPrompt';
        const type = btAction.includes('.') ? btAction : `wend.core.${btAction}`;
        const nodeDef = window.WendNodes.get(type);
        if (!nodeDef || !nodeDef.impl || nodeDef.impl.kind !== 'provider') {
            throw new Error(`Not a provider node type: ${type}`);
        }
        const impl = nodeDef.impl;

        const expandedPrompt = expandTemplate(impl.promptTemplate, ctx.params, ctx.inputs, ctx);
        const providerName = impl.provider || 'openai';
        const recipeName = impl.recipe || '';

        const customParams = {};
        if (impl.customParams) {
            for (const [k, v] of Object.entries(impl.customParams)) {
                if (typeof v === 'string') {
                    customParams[k] = expandTemplate(v, ctx.params, ctx.inputs, ctx);
                } else {
                    customParams[k] = v;
                }
            }
        }

        const requestId = String(ctx.bt._nextRequestId++);
        return new Promise((resolve) => {
            const callback = (meta) => {
                if (meta.error) {
                    ctx.log.error(meta.message || 'Provider execution error');
                    resolve(false);
                    return;
                }
                
                const outText = (meta && meta.outputContent) ? String(meta.outputContent).trim() : '';
                const outPort = impl.outputPort || 'output';
                ctx.io.write(outPort, outText, 'text');
                
                if (meta.attachments && meta.attachments.length > 0) {
                    ctx.io.write('media', meta.attachments, 'media');
                }

                resolve(true);
            };

            ctx.bt._pendingCallbacks.set(requestId, callback);

            ctx.app.state.btRunContext = {
                requestId,
                targetNodePath: ctx.path,
                prompt: expandedPrompt,
                recipe: recipeName,
                provider: providerName,
                customParams: customParams
            };

            ctx.app.processPrompt();
        });
    },

    async runPipelineNode(ctx) {
        const btAction = ctx.node.btAction || 'processPrompt';
        const type = btAction.includes('.') ? btAction : `wend.core.${btAction}`;
        const nodeDef = window.WendNodes.get(type);
        if (!nodeDef || !nodeDef.impl || nodeDef.impl.kind !== 'pipeline') {
            throw new Error(`Not a pipeline node type: ${type}`);
        }
        const steps = nodeDef.impl.steps || [];
        const vars = new Map();

        const resolveVal = (val) => {
            if (typeof val !== 'string') return val;
            if (val.startsWith('$')) return vars.get(val);
            return expandTemplate(val, ctx.params, ctx.inputs, ctx);
        };

        const execSteps = async (stepList) => {
            for (const step of stepList) {
                const op = step.op;
                if (op === 'template') {
                    const res = expandTemplate(step.template, ctx.params, ctx.inputs, ctx);
                    if (step.out) vars.set(step.out, res);
                }
                else if (op === 'regex') {
                    const inputVal = String(resolveVal(step.in) || '');
                    const pattern = new RegExp(step.pattern, step.flags || '');
                    const match = inputVal.match(pattern);
                    let res = '';
                    if (match) {
                        res = step.group !== undefined ? match[step.group] : match[0];
                    }
                    if (step.out) vars.set(step.out, res);
                }
                else if (op === 'jsonpath') {
                    const inputVal = resolveVal(step.in);
                    let jsonObj = inputVal;
                    if (typeof inputVal === 'string') {
                        try { jsonObj = JSON.parse(inputVal); } catch {}
                    }
                    let res = '';
                    if (jsonObj && typeof jsonObj === 'object') {
                        const pathExpr = step.path || '';
                        if (pathExpr.startsWith('$.')) {
                            const parts = pathExpr.substring(2).split('.');
                            let current = jsonObj;
                            for (const part of parts) {
                                if (current) current = current[part];
                            }
                            res = current !== undefined ? current : '';
                        }
                    }
                    if (step.out) vars.set(step.out, res);
                }
                else if (op === 'math') {
                    const expr = expandTemplate(step.expression || '', ctx.params, ctx.inputs, ctx);
                    let res = 0;
                    try {
                        if (/^[0-9+\-*/().\s]+$/.test(expr)) {
                            res = Function(`"use strict"; return (${expr})`)();
                        } else {
                            ctx.log.warn(`Unsafe math expression: ${expr}`);
                        }
                    } catch (e) {
                        ctx.log.warn(`Math evaluation error: ${e.message}`);
                    }
                    if (step.out) vars.set(step.out, res);
                }
                else if (op === 'http') {
                    const url = resolveVal(step.url);
                    const method = step.method || 'GET';
                    const body = resolveVal(step.body) || '';
                    const headers = step.headers || {};
                    try {
                        const res = await ctx.services.http({ url, method, headers, body });
                        if (step.out) vars.set(step.out, res);
                    } catch (e) {
                        ctx.log.error(`HTTP request step failed: ${e.message}`);
                        return false;
                    }
                }
                else if (op === 'bbRead') {
                    const key = resolveVal(step.key);
                    const val = ctx.bb.readText(key) || ctx.bb.readMedia(key);
                    if (step.out) vars.set(step.out, val);
                }
                else if (op === 'bbWrite') {
                    const key = resolveVal(step.key);
                    const val = resolveVal(step.value);
                    ctx.bb.write(key, val, step.scope || 'run', step.field || 'text');
                }
                else if (op === 'portRead') {
                    const val = ctx.io.read(step.port);
                    if (step.out) vars.set(step.out, val);
                }
                else if (op === 'portWrite') {
                    const val = resolveVal(step.in);
                    ctx.io.write(step.port, val, step.type || 'text');
                }
                else if (op === 'branch') {
                    const cond = Boolean(resolveVal(step.condition));
                    if (cond) {
                        if (Array.isArray(step.then)) {
                            const success = await execSteps(step.then);
                            if (!success) return false;
                        }
                    } else {
                        if (Array.isArray(step.else)) {
                            const success = await execSteps(step.else);
                            if (!success) return false;
                        }
                    }
                }
            }
            return true;
        };

        return await execSteps(steps);
    }
};
