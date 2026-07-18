class WendNodesRegistry {
    constructor() {
        this.apiVersion = 1;
        this._packs = new Map(); // packId -> { packJson, source }
        this._handlers = new Map(); // handlerName -> fn
        this._nodes = new Map(); // nodeType -> nodeDef (compiled from packs)
    }

    registerPack(packJson, { source = 'user' } = {}) {
        if (!packJson || typeof packJson !== 'object') return;
        const packId = packJson.id;
        if (!packId) return;

        this._packs.set(packId, { packJson, source });

        // Compile/register each node in the pack
        if (Array.isArray(packJson.nodes)) {
            for (const node of packJson.nodes) {
                const nodeType = node.type;
                if (!nodeType) continue;

                // Build a compiled node definition
                this._nodes.set(nodeType, {
                    ...node,
                    packId,
                    source
                });
            }
        }
    }

    registerHandler(name, fn) {
        this._handlers.set(name, fn);
    }

    get(type) {
        const nodeDef = this._nodes.get(type);
        if (!nodeDef) return undefined;

        // Resolve handler
        let handler = null;
        if (nodeDef.impl) {
            if (nodeDef.impl.kind === 'builtin') {
                handler = this._handlers.get(nodeDef.impl.handler) || null;
            } else if (nodeDef.impl.kind === 'module') {
                handler = this._handlers.get(type) || null;
            } else if (nodeDef.impl.kind === 'provider') {
                handler = (window.WendNodeOps && window.WendNodeOps.runProviderNode) || null;
            } else if (nodeDef.impl.kind === 'pipeline') {
                handler = (window.WendNodeOps && window.WendNodeOps.runPipelineNode) || null;
            }
        }
        return {
            ...nodeDef,
            handler
        };
    }

    has(type) {
        return this._nodes.has(type);
    }

    byCategory() {
        const cats = {};
        for (const [type, node] of this._nodes.entries()) {
            const cat = node.category || 'misc';
            if (!cats[cat]) cats[cat] = [];
            cats[cat].push(this.get(type));
        }
        return cats;
    }

    getAllTypes() {
        return Array.from(this._nodes.keys());
    }

    validateParams(type, params) {
        const node = this.get(type);
        if (!node) return { ok: false, errors: ['Unknown node type'] };
        const errors = [];
        if (Array.isArray(node.params)) {
            for (const p of node.params) {
                const val = params[p.name];
                if (p.required && (val === undefined || val === null || val === '')) {
                    errors.push(`Parameter "${p.name}" is required.`);
                }
            }
        }
        return { ok: errors.length === 0, errors };
    }

    resolveCompat(node) {
        const btAction = node?.btAction || '';
        const btType = node?.btType || '';
        if (btAction && btAction.includes('.')) {
            return {
                type: btAction,
                params: node.btParams || {}
            };
        }
        
        for (const [type, def] of this._nodes.entries()) {
            if (def.compat && (def.compat.btAction === btAction || (btAction === '' && def.compat.btAction === 'processPrompt' && btType === 'leaf'))) {
                const params = {};
                if (Array.isArray(def.params)) {
                    for (const p of def.params) {
                        const legacyField = def.compat.paramMap?.[p.name];
                        if (legacyField && node[legacyField] !== undefined) {
                            let val = node[legacyField];
                            if (p.type === 'text' && (legacyField === 'btPrompt' || legacyField === 'btManualPrompt')) {
                                try { val = atob(val); } catch (e) {}
                            } else if (p.type === 'json' && legacyField === 'btManualChoices') {
                                try { val = JSON.parse(val); } catch (e) {}
                            }
                            params[p.name] = val;
                        } else if (p.default !== undefined) {
                            params[p.name] = p.default;
                        }
                    }
                }
                return { type, params };
            }
        }
        return { type: btAction || 'wend.core.processPrompt', params: {} };
    }
}

window.WendNodes = new WendNodesRegistry();

class BtActionRegistry {
    register(name, config) {
        window.WendNodes.registerHandler(name, config.handler);
    }

    get(name) {
        let node = window.WendNodes.get(name) || window.WendNodes.get(`wend.core.${name}`);
        if (!node) {
            const handler = window.WendNodes._handlers.get(name);
            if (handler) {
                return {
                    label: name,
                    handler
                };
            }
            return undefined;
        }
        // Map label/fields for legacy compatibility
        const fields = [];
        if (Array.isArray(node.params)) {
            for (const p of node.params) {
                if (node.compat && node.compat.paramMap && node.compat.paramMap[p.name]) {
                    fields.push(node.compat.paramMap[p.name]);
                } else {
                    fields.push(p.name);
                }
            }
        }
        return {
            label: node.label?.ja || node.label?.en || node.label || name,
            fields,
            handler: node.handler
        };
    }

    has(name) {
        return window.WendNodes.has(name) || window.WendNodes.has(`wend.core.${name}`) || window.WendNodes._handlers.has(name);
    }

    getAll() {
        const all = [];
        for (const type of window.WendNodes.getAllTypes()) {
            if (type.startsWith('wend.core.')) {
                const shortName = type.substring('wend.core.'.length);
                if (shortName !== 'processPrompt') {
                    all.push([shortName, this.get(type)]);
                }
            }
        }
        return all;
    }

    getAllNames() {
        return this.getAll().map(pair => pair[0]);
    }

    getLabel(name) {
        const node = this.get(name);
        return node ? node.label : name;
    }
}

window.btActions = new BtActionRegistry();
