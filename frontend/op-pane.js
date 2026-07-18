window.WendOpPane = {
    renderParams(node, containerEl, isReadOnly) {
        const btAction = node?.btAction || 'processPrompt';
        const type = btAction.includes('.') ? btAction : `wend.core.${btAction}`;
        const def = window.WendNodes.get(type);
        if (!def || !Array.isArray(def.params)) {
            containerEl.innerHTML = '';
            return;
        }

        const compatResolved = window.WendNodes.resolveCompat(node);
        const paramsVal = { ...compatResolved.params, ...(node.btParams || {}) };

        let html = '';
        for (const param of def.params) {
            // Skip text prompt input and input/output keys, as those have specific legacy DOM fields on the page
            if (param.name === 'prompt' || param.name === 'inputKey' || param.name === 'outputKey') {
                continue;
            }

            const val = paramsVal[param.name] !== undefined ? paramsVal[param.name] : (param.default !== undefined ? param.default : '');
            const ui = param.ui || {};
            const widget = ui.widget || 'text';
            const label = ui.label?.ja || ui.label?.en || ui.label || param.name;
            const hint = ui.hint?.ja || ui.hint?.en || ui.hint || '';
            const hintHtml = hint ? ` <span class="bt-hint">${hint}</span>` : '';
            const readOnlyAttr = isReadOnly ? 'readonly' : '';
            const disabledAttr = isReadOnly ? 'disabled' : '';

            html += `<div class="bt-field" data-param-name="${param.name}">
                <div class="bt-field-label">${label}${hintHtml}</div>`;

            if (widget === 'textarea' || widget === 'prompt') {
                html += `<textarea class="input-textarea bt-prompt-area" id="param-${param.name}" ${readOnlyAttr} placeholder="${hint}">${window.app.escapeHtml(val)}</textarea>`;
            } else if (widget === 'select') {
                const options = Array.isArray(param.options) ? param.options : [];
                let optHtml = '';
                for (const opt of options) {
                    optHtml += `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`;
                }
                html += `<select class="bt-type-select" id="param-${param.name}" ${disabledAttr}>${optHtml}</select>`;
            } else if (widget === 'checkbox') {
                html += `<input type="checkbox" id="param-${param.name}" ${val ? 'checked' : ''} ${disabledAttr}>`;
            } else if (widget === 'file') {
                html += `<div style="display:flex;gap:4px">
                    <input class="bt-key-input" id="param-${param.name}" value="${window.app.escapeHtml(val)}" ${readOnlyAttr} style="flex:1">
                    <button class="copy-btn" onclick="app.browseParamFilePath('${param.name}')" title="Browse" style="font-size:12px;padding:2px 8px;${isReadOnly ? 'opacity:0.5;cursor:not-allowed' : ''}" ${disabledAttr}>📂</button>
                </div>`;
            } else if (widget === 'bbkey') {
                html += `<input class="bt-key-input" id="param-${param.name}" value="${window.app.escapeHtml(val)}" ${readOnlyAttr} placeholder="Blackboard key">`;
            } else if (widget === 'choices') {
                const choicesStr = typeof val === 'object' ? JSON.stringify(val) : String(val || '[]');
                html += `<textarea class="input-textarea" style="font-family:monospace;font-size:11px" id="param-${param.name}" ${readOnlyAttr} placeholder='[{"label":"Option 1","action":"next"}]'>${window.app.escapeHtml(choicesStr)}</textarea>`;
            } else {
                const inputType = widget === 'number' || widget === 'slider' ? 'number' : 'text';
                html += `<input class="bt-key-input" type="${inputType}" id="param-${param.name}" value="${window.app.escapeHtml(val)}" ${readOnlyAttr}>`;
            }

            html += `</div>`;
        }

        containerEl.innerHTML = html;
    },

    saveParams(node) {
        const btAction = node?.btAction || 'processPrompt';
        const type = btAction.includes('.') ? btAction : `wend.core.${btAction}`;
        const def = window.WendNodes.get(type);
        if (!def || !Array.isArray(def.params)) return;

        if (!node.btParams) node.btParams = {};

        for (const param of def.params) {
            const el = document.getElementById(`param-${param.name}`);
            if (!el) continue;

            const ui = param.ui || {};
            const widget = ui.widget || 'text';
            let val;

            if (widget === 'checkbox') {
                val = el.checked;
            } else if (widget === 'select') {
                val = el.value;
            } else if (param.type === 'number') {
                val = parseFloat(el.value);
                if (isNaN(val)) val = 0;
            } else if (param.type === 'json' || widget === 'choices') {
                try {
                    val = JSON.parse(el.value);
                } catch (e) {
                    val = el.value;
                }
            } else {
                val = el.value;
            }

            node.btParams[param.name] = val;

            // Sync with legacy fields
            if (def.compat && def.compat.paramMap && def.compat.paramMap[param.name]) {
                const legacyField = def.compat.paramMap[param.name];
                let compatVal = val;
                if (param.type === 'text' && (legacyField === 'btPrompt' || legacyField === 'btManualPrompt')) {
                    compatVal = btoa(val);
                } else if (param.type === 'json' && legacyField === 'btManualChoices') {
                    compatVal = typeof val === 'string' ? val : JSON.stringify(val);
                }
                node[legacyField] = compatVal;
            }
        }
    }
};
