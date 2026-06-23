/**
 * behavior3js Custom Action Nodes for Wend
 * Defines ProcessPromptAction and LoadLocalFileAction
 */

/**
 * ProcessPromptAction - Execute an AI prompt via the Wend pipeline
 * Returns RUNNING until pipeline completes, then SUCCESS or FAILURE
 */
class ProcessPromptAction extends b3.Action {
    constructor(properties) {
        super(properties);
        this._isExecuting = false;
        this._cachedResult = null;
    }

    tick(blackboard) {
        const nodeId = this.id || this.title;
        const executionKey = `_exec_${nodeId}`;
        const isAlreadyExecuting = blackboard.get(executionKey);

        console.log(`[ProcessPromptAction] tick: nodeId=${nodeId}, isExecuting=${!!isAlreadyExecuting}`);

        if (isAlreadyExecuting) {
            // Check if we have a cached result
            const resultKey = `_result_${nodeId}`;
            const result = blackboard.get(resultKey);
            console.log(`[ProcessPromptAction] Tick #${isAlreadyExecuting}: Checking for result... got=${result}`);

            if (result !== undefined) {
                console.log(`[ProcessPromptAction] Returning cached result: ${result === b3.Status.SUCCESS ? 'SUCCESS' : 'FAILURE'}`);
                blackboard.set(resultKey, undefined); // Clear cache
                blackboard.set(executionKey, false);
                return result;
            }
            // Still waiting for pipeline to complete
            console.log(`[ProcessPromptAction] Still waiting for pipeline...`);
            return b3.Status.RUNNING;
        }

        // First tick - initiate execution
        console.log(`[ProcessPromptAction] FIRST TICK: Initiating prompt execution`);
        blackboard.set(executionKey, true);

        // Get input from blackboard if specified. Input modality is auto-
        // detected from what the slot holds: media (audio/image/video) is fed
        // as media, otherwise text. An explicit inputType still forces one.
        const inputKey = this.properties?.inputKey;
        const forcedType = this.properties?.inputType;
        let bbTextInput = null, bbMediaInput = null;

        if (inputKey) {
            const slot = blackboard.get(inputKey);
            if (slot) {
                if (forcedType !== 'text' && slot.media && slot.media.length) bbMediaInput = slot.media;
                if (forcedType !== 'media') bbTextInput = slot.text;
                console.log(`[ProcessPromptAction] Input "${inputKey}": media=${!!bbMediaInput}, text=${bbTextInput != null}`);
            }
        }

        // Get output key and type
        const outputKey = this.properties?.outputKey;
        const outputType = this.properties?.outputType || 'text';
        
        const rawPrompt = this.properties?.prompt || this.title;
        const resolvedPrompt = rawPrompt ? this._expandPlaceholders(rawPrompt, blackboard) : '';

        console.log(`[ProcessPromptAction] Prompt: "${String(resolvedPrompt).slice(0, 50)}..."`);
        console.log(`[ProcessPromptAction] Input: key="${inputKey}", type="${inputType}"`);
        console.log(`[ProcessPromptAction] Output: key="${outputKey}", type="${outputType}"`);

        // Set BT run context for processPrompt to read
        if (window.app) {
            window.app.state.btRunContext = {
                prompt: resolvedPrompt,
                bbTextInput,
                bbMediaInput,
                outputKey: outputKey || null,
                outputType: outputType,
                btActionNodeId: nodeId,
                targetNodePath: this.properties?._origPath || null,
            };

            console.log(`[ProcessPromptAction] Calling app.processPrompt()...`);
            // Initiate execution
            window.app.processPrompt();

            // Register callback for when pipeline completes
            const originalCallback = window.app._btLeafCallback;
            window.app._btLeafCallback = (meta) => {
                console.log(`[ProcessPromptAction] Pipeline completed: error=${meta.error}`);
                // Store result for next tick
                const resultStatus = !meta.error ? b3.Status.SUCCESS : b3.Status.FAILURE;
                console.log(`[ProcessPromptAction] Storing result: ${resultStatus === b3.Status.SUCCESS ? 'SUCCESS' : 'FAILURE'}`);
                blackboard.set(`_result_${nodeId}`, resultStatus);

                // Restore original callback if any
                if (originalCallback) {
                    window.app._btLeafCallback = originalCallback;
                }
            };
        } else {
            console.error(`[ProcessPromptAction] window.app not available!`);
        }

        // Return RUNNING - will resume on next tick after pipeline completes
        console.log(`[ProcessPromptAction] Returning RUNNING, waiting for pipeline...`);
        return b3.Status.RUNNING;
    }

    _expandPlaceholders(text, blackboard) {
        if (!text) return text;
        return text
            .replace(/\{bb:([^}:]+):json\}/g, (_, k) => {
                const slot = blackboard.get(k);
                const d = slot ? slot.data : null;
                return d != null ? JSON.stringify(d) : '';
            })
            .replace(/\{bb:([^}:]+):reasoning\}/g, (_, k) => {
                const slot = blackboard.get(k);
                const r = slot ? slot.reasoning : null;
                return r != null ? r : '';
            })
            .replace(/\{bb:([^}]+)\}/g, (_, k) => {
                const slot = blackboard.get(k);
                if (slot) {
                    if (slot.text == null && (slot.media != null || slot.data != null)) {
                        const errorMsg = `Blackboard variable "${k}" is not of type "text"`;
                        if (window.app && window.app.addLog) {
                            window.app.outputDebug(`❌ Error: ${errorMsg}`);
                        }
                        return `[ERROR: ${errorMsg}]`;
                    }
                    const v = slot.text;
                    if (v != null) return v;
                    if (slot.data != null) return typeof slot.data === 'string' ? slot.data : JSON.stringify(slot.data);
                }
                return '';
            })
            .replace(/\{tab:([^}]+)\}/g, (_, k) => {
                let slot = blackboard.get(k);
                if (!slot && window.app && window.app._bt && window.app._bt._tabBlackboard) {
                    slot = window.app._bt._tabBlackboard[k];
                }
                if (slot) {
                    if (slot.text == null && (slot.media != null || slot.data != null)) {
                        const errorMsg = `Tab blackboard variable "${k}" is not of type "text"`;
                        if (window.app && window.app.addLog) {
                            window.app.outputDebug(`❌ Error: ${errorMsg}`);
                        }
                        return `[ERROR: ${errorMsg}]`;
                    }
                    const v = slot.text;
                    if (v != null) return v;
                }
                return '';
            })
            .replace(/\{proj:([^}]+)\}/g, (_, k) => {
                let slot = blackboard.get(k);
                if (!slot && window.app && window.app._projectBlackboard) {
                    slot = window.app._projectBlackboard[k];
                }
                if (slot) {
                    if (slot.text == null && (slot.media != null || slot.data != null)) {
                        const errorMsg = `Project blackboard variable "${k}" is not of type "text"`;
                        if (window.app && window.app.addLog) {
                            window.app.outputDebug(`❌ Error: ${errorMsg}`);
                        }
                        return `[ERROR: ${errorMsg}]`;
                    }
                    const v = slot.text;
                    if (v != null) return v;
                }
                return '';
            });
    }
}

/**
 * LoadLocalFileAction - Load a file and store as media in blackboard
 * Returns RUNNING until file loads, then SUCCESS or FAILURE
 */
class LoadLocalFileAction extends b3.Action {
    tick(blackboard) {
        const nodeId = this.id || this.title;
        const executionKey = `_exec_${nodeId}`;
        const isAlreadyExecuting = blackboard.get(executionKey);

        if (isAlreadyExecuting) {
            // Check if we have a cached result
            const resultKey = `_result_${nodeId}`;
            const result = blackboard.get(resultKey);
            if (result !== undefined) {
                blackboard.set(resultKey, undefined); // Clear cache
                blackboard.set(executionKey, false);
                return result;
            }
            // Still waiting for file load
            return b3.Status.RUNNING;
        }

        // First tick - initiate file load
        blackboard.set(executionKey, true);

        const filePath = this.properties?.filePath;
        const outputKey = this.properties?.outputKey;

        if (!filePath) {
            console.error('LoadLocalFileAction: No filePath specified');
            return b3.Status.FAILURE;
        }

        // Send IPC message to load file
        if (window.app) {
            const tab = window.app.state.tabs[window.app.state.activeTab];
            const basePath = tab?.file || '';

            const handler = (msg) => {
                if (msg.type === 'bt_load_local_file_result') {
                    window.app._removeMessageListener(handler);

                    if (msg.error) {
                        console.error('LoadLocalFileAction: Load failed:', msg.error);
                        blackboard.set(`_result_${nodeId}`, b3.Status.FAILURE);
                    } else {
                        if (outputKey) {
                            const slot = blackboard.get(outputKey) || {};
                            slot.media = [msg];
                            blackboard.set(outputKey, slot);
                        }
                        blackboard.set(`_result_${nodeId}`, b3.Status.SUCCESS);
                    }
                }
            };

            window.app._addMessageListener(handler);
            window.app.postMessage({
                type: 'bt_load_local_file',
                payload: { filePath, basePath }
            });
        }

        // Return RUNNING - will resume on next tick after file loads
        return b3.Status.RUNNING;
    }
}

// Export for use in node registry
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProcessPromptAction, LoadLocalFileAction };
}
