/**
 * Behavior Tree Format Converter
 * Converts between Wend hierarchical format and behavior3js flat format
 */

class B3TreeConverter {
    /**
     * Convert Wend tree format to behavior3js format
     * @param {Object} promptsNode - Root node in Wend format (hierarchical)
     * @param {String} treeId - Optional tree ID for b3 format
     * @returns {Object} behavior3js tree definition (flat with node registry)
     */
    static wendToB3(promptsNode, treeId = 'tree-' + Date.now(), basePath = '') {
        const nodes = {};
        let nodeCounter = 0;

        const _decoNames = ['invert', 'repeater', 'retry', 'alwaysSucceed', 'alwaysFail', 'guard', 'delay', 'maxTime'];
        const _compNames = ['sequence', 'selector', 'parallel', 'memSequence', 'memSelector'];

        const _fullPath = (relPath) => {
            return basePath ? (relPath ? basePath + '/' + relPath : basePath) : relPath;
        };

        const traverseAndCreateNodes = (node, path = '') => {
            const btType = node.btType || '';

            // Compound type: expand into decorator chain → composite
            if (btType.includes('+')) {
                const parts = btType.split('+');
                const decorators = parts.slice(0, -1);
                const composite = parts[parts.length - 1];

                // Create the innermost composite node
                const compositeId = `n-${nodeCounter++}`;
                const compName = composite.charAt(0).toUpperCase() + composite.slice(1);
                const compNode = { id: compositeId, name: compName, title: composite, properties: {}, children: [] };
                nodes[compositeId] = compNode;

                // Attach actual children to the composite
                if (node.children && node.children.length > 0) {
                    const childIds = [];
                    node.children.forEach((child, idx) => {
                        const childPath = path ? `${path}/${idx}` : `${idx}`;
                        childIds.push(traverseAndCreateNodes(child, childPath));
                    });
                    compNode.children = childIds;
                }

                // Create decorator nodes wrapping outward (innermost decorator wraps composite)
                let innerId = compositeId;
                for (let i = decorators.length - 1; i >= 0; i--) {
                    const decoId = `n-${nodeCounter++}`;
                    const decoName = decorators[i].charAt(0).toUpperCase() + decorators[i].slice(1);
                    const decoProps = {};
                    if (i === 0) {
                        if (node.btRepeatCount) decoProps.maxLoop = parseInt(node.btRepeatCount) || 1;
                        if (node.btRetryCount) decoProps.maxRetries = parseInt(node.btRetryCount) || 1;
                        if (node.btTimeout) decoProps.maxTime = parseInt(node.btTimeout) || 5000;
                        if (node.btDelay) decoProps.delay = parseInt(node.btDelay) || 1000;
                        if (node.btCondition) decoProps.condition = node.btCondition;
                        if (node.btExpectedValue) decoProps.expectedValue = node.btExpectedValue;
                        if (node.btNegate) decoProps.negate = !!node.btNegate;
                    }
                    const decoNode = { id: decoId, name: decoName, title: decorators[i], properties: decoProps, children: [innerId] };
                    nodes[decoId] = decoNode;
                    innerId = decoId;
                }
                return innerId; // outermost decorator replaces the original node
            }

            const nodeId = `n-${nodeCounter++}`;
            const origPath = _fullPath(path);
            const b3Node = this._promptsNodeToB3Node(node, nodeId, origPath);
            nodes[nodeId] = b3Node;

            if (node.children && node.children.length > 0) {
                const childIds = [];
                node.children.forEach((child, idx) => {
                    const childPath = path ? `${path}/${idx}` : `${idx}`;
                    childIds.push(traverseAndCreateNodes(child, childPath));
                });
                b3Node.children = childIds;
            }

            return nodeId;
        };

        const rootId = traverseAndCreateNodes(promptsNode, '');

        return {
            id: treeId,
            title: promptsNode.title || 'Converted Tree',
            description: 'Converted from Wend format',
            root: rootId,
            nodes: nodes
        };
    }

    /**
     * Convert single Wend node to b3 node definition
     * @private
     */
    static _promptsNodeToB3Node(promptsNode, nodeId, origPath = '') {
        const btType = promptsNode.btType || 'leaf';

        // Determine node type name
        let nodeName;
        if (btType === 'leaf' || !btType) {
            // Determine action type based on btAction
            const btAction = promptsNode.btAction || 'processPrompt';
            nodeName = btAction === 'loadLocalFile' ? 'LoadLocalFileAction' : 'ProcessPromptAction';
        } else if (btType.startsWith('repeat')) {
            // Handle pre-composed nodes like 'repeatSequence' → 'RepeatSequence'
            nodeName = btType.charAt(0).toUpperCase() + btType.slice(1);
        } else {
            // Handle basic composites: 'sequence' → 'Sequence', 'selector' → 'Selector', etc.
            nodeName = btType.charAt(0).toUpperCase() + btType.slice(1);
        }

        // Map Wend properties to b3 properties
        const properties = {};

        // Store original tree path for result routing
        if (origPath) properties._origPath = origPath;

        if (nodeName === 'ProcessPromptAction') {
            properties.prompt = promptsNode.btPrompt
                ? this._decodeBase64(promptsNode.btPrompt)
                : promptsNode.title || '';
            if (promptsNode.btInputKey) properties.inputKey = promptsNode.btInputKey;
            if (promptsNode.btInputType) properties.inputType = promptsNode.btInputType;
            if (promptsNode.btOutputKey) properties.outputKey = promptsNode.btOutputKey;
            if (promptsNode.btOutputType) properties.outputType = promptsNode.btOutputType;
        } else if (nodeName === 'LoadLocalFileAction') {
            if (promptsNode.btLocalFilePath) properties.filePath = promptsNode.btLocalFilePath;
            if (promptsNode.btOutputKey) properties.outputKey = promptsNode.btOutputKey;
            if (promptsNode.btOutputType) properties.outputType = promptsNode.btOutputType;
        } else if (nodeName.startsWith('Repeat')) {
            // Pre-composed decorator+composite: inherit repeater configuration
            if (promptsNode.btRepeatCount) {
                properties.maxLoop = parseInt(promptsNode.btRepeatCount) || 1;
            }
        }

        const b3Node = {
            id: nodeId,
            name: nodeName,
            title: promptsNode.title || nodeName,
            properties: properties
        };

        // Add children placeholder (will be filled in second pass)
        if (promptsNode.children) {
            b3Node.children = [];
        }

        return b3Node;
    }

    /**
     * Convert behavior3js tree to Wend format (for export/save)
     * @param {Object} b3tree - behavior3js tree definition
     * @returns {Object} Wend hierarchical tree
     */
    static b3ToWend(b3tree) {
        const nodeMap = b3tree.nodes;
        const rootNodeId = b3tree.root;

        // Try to collapse a decorator chain into a compound btType.
        // Walk single-child decorator nodes; if they end at a composite with multiple children, collapse.
        const _collapseChain = (nodeId) => {
            const _decoB3Names = ['Invert', 'Repeater', 'Retry', 'AlwaysSucceed', 'AlwaysFail', 'Guard', 'Delay', 'MaxTime'];
            const _compB3Names = ['Sequence', 'Selector', 'Parallel', 'MemSequence', 'MemSelector'];
            const chain = [];
            let current = nodeMap[nodeId];
            while (current && current.children && current.children.length === 1) {
                const name = current.name;
                const decoIdx = _decoB3Names.indexOf(name);
                if (decoIdx === -1) break;
                chain.push(name);
                current = nodeMap[current.children[0]];
                if (!current) break;
            }
            if (chain.length === 0) return null;
            const baseIdx = _compB3Names.indexOf(current.name);
            if (baseIdx === -1) return null;
            // Only collapse if the composite has its own children (not a single child the chain continues through)
            if (!current.children || current.children.length < 1) return null;
            const decoParts = chain.map(n => n.charAt(0).toLowerCase() + n.slice(1));
            const basePart = current.name.charAt(0).toLowerCase() + current.name.slice(1);
            return { compoundStr: [...decoParts, basePart].join('+'), compositeNode: current };
        };

        const buildWendNode = (nodeId, isRoot = false) => {
            const b3Node = nodeMap[nodeId];
            if (!b3Node) return null;

            // Check if this starts a collapsible decorator chain
            const collapsed = _collapseChain(nodeId);
            if (collapsed) {
                const promptsNode = {
                    nodeType: isRoot ? 'root' : 'assemble',
                    title: b3Node.title || collapsed.compoundStr,
                    btType: collapsed.compoundStr,
                };
                // Copy properties from the outermost decorator node
                if (b3Node.properties) {
                    if (b3Node.properties.maxLoop) promptsNode.btRepeatCount = b3Node.properties.maxLoop.toString();
                    if (b3Node.properties.maxRetries) promptsNode.btRetryCount = b3Node.properties.maxRetries.toString();
                    if (b3Node.properties.maxTime) promptsNode.btTimeout = b3Node.properties.maxTime.toString();
                    if (b3Node.properties.delay) promptsNode.btDelay = b3Node.properties.delay.toString();
                    if (b3Node.properties.condition) promptsNode.btCondition = b3Node.properties.condition;
                    if (b3Node.properties.expectedValue) promptsNode.btExpectedValue = b3Node.properties.expectedValue;
                    if (b3Node.properties.negate) promptsNode.btNegate = !!b3Node.properties.negate;
                }
                // Attach the composite's children directly
                const compNode = collapsed.compositeNode;
                if (compNode.children && compNode.children.length > 0) {
                    promptsNode.children = compNode.children
                        .map(childId => buildWendNode(childId, false))
                        .filter(n => n !== null);
                }
                return promptsNode;
            }

            const promptsNode = {
                nodeType: isRoot ? 'root' : 'assemble',
                title: b3Node.title || b3Node.name
            };

            const btType = this._b3TypeToWendType(b3Node.name);
            if (btType !== undefined) {
                promptsNode.btType = btType;
            }

            if (b3Node.name === 'ProcessPromptAction') {
                promptsNode.btAction = 'processPrompt';
            } else if (b3Node.name === 'LoadLocalFileAction') {
                promptsNode.btAction = 'loadLocalFile';
            }

            if (b3Node.properties) {
                if (b3Node.properties.prompt) {
                    promptsNode.btPrompt = this._encodeBase64(b3Node.properties.prompt);
                }
                if (b3Node.properties.inputKey) {
                    promptsNode.btInputKey = b3Node.properties.inputKey;
                }
                if (b3Node.properties.inputType) {
                    promptsNode.btInputType = b3Node.properties.inputType;
                }
                if (b3Node.properties.outputKey) {
                    promptsNode.btOutputKey = b3Node.properties.outputKey;
                }
                if (b3Node.properties.outputType) {
                    promptsNode.btOutputType = b3Node.properties.outputType;
                }
                if (b3Node.properties.filePath) {
                    promptsNode.btLocalFilePath = b3Node.properties.filePath;
                }
                if (b3Node.properties.maxLoop) {
                    promptsNode.btRepeatCount = b3Node.properties.maxLoop.toString();
                }
            }

            if (b3Node.children && b3Node.children.length > 0) {
                promptsNode.children = b3Node.children
                    .map(childId => buildWendNode(childId, false))
                    .filter(n => n !== null);
            }

            return promptsNode;
        };

        return buildWendNode(rootNodeId, true);
    }

    /**
     * Detect if tree is in old Wend format or new b3 format
     * @returns {String} 'prompts' or 'b3'
     */
    static detectFormat(treeData) {
        // Old Wend format has 'children' array at node level
        if (treeData.children !== undefined) {
            return 'prompts';
        }
        // b3 format has 'nodes' object and 'root' ID
        if (treeData.nodes && treeData.root) {
            return 'b3';
        }
        return 'unknown';
    }

    // ── Helper methods ──

    static _b3TypeToWendType(b3NodeName) {
        switch (b3NodeName) {
            case 'Sequence':
            case 'MemSequence':
                return 'sequence';
            case 'Selector':
            case 'MemSelector':
                return 'selector';
            case 'Parallel':
                return 'parallel';
            case 'RepeatSequence':
                return 'repeatSequence';
            case 'RepeatSelector':
                return 'repeatSelector';
            case 'RepeatMemSequence':
                return 'repeatMemSequence';
            case 'RepeatMemSelector':
                return 'repeatMemSelector';
            case 'ProcessPromptAction':
            case 'LoadLocalFileAction':
            default:
                return undefined; // leaf
        }
    }

    static _isCustomAction(b3NodeName) {
        return b3NodeName === 'ProcessPromptAction' ||
               b3NodeName === 'LoadLocalFileAction';
    }

    static _encodeBase64(str) {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            console.warn('Failed to encode base64:', e);
            return str;
        }
    }

    static _decodeBase64(str) {
        try {
            return decodeURIComponent(escape(atob(str)));
        } catch (e) {
            console.warn('Failed to decode base64:', e);
            return str;
        }
    }
}

// Convenience functions (non-class API for backwards compatibility)
function wendToB3(promptsNode, treeId) {
    return B3TreeConverter.wendToB3(promptsNode, treeId);
}

function b3ToWend(b3tree) {
    return B3TreeConverter.b3ToWend(b3tree);
}

function detectFormat(treeData) {
    return B3TreeConverter.detectFormat(treeData);
}
