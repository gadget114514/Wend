(function() {
    const R = window.btActions;

    // ── loadLocalFile ──────────────────────────────────────────
    R.register('loadLocalFile', {
        label: 'Load Local File',
        fields: ['localFilePath', 'outputKey', 'outputType'],
        defaults: { outputType: 'media' },
        handler: async (ctx) => {
            const { bt, app, node, path } = ctx;
            const filePath   = node?.btLocalFilePath || '';
            const outputKey  = node?.btOutputKey || '';
            const outputType = node?.btOutputType || 'media';
            const outputScope = node?.btOutputScope || 'run';

            if (!filePath) {
                app.outputMessage('❌ loadLocalFile: No file path specified');
                return false;
            }

            const tabIndex = bt.runId && app._runIdToTabIndex
                ? app._runIdToTabIndex.get(bt.runId) : undefined;
            const tab = tabIndex !== undefined
                ? app.state.tabs[tabIndex] : app.state.tabs[app.state.activeTab];
            const basePath = tab?.file || '';

            return new Promise(resolve => {
                const handler = (msg) => {
                    if (msg.type === 'bt_load_local_file_result') {
                        app._removeMessageListener(handler);
                        if (msg.error) {
                            app.outputMessage(`❌ Load local file failed: ${msg.error}`);
                            resolve(false);
                        } else {
                            if (outputKey) {
                                if (outputType === 'text') {
                                    const raw = msg.content;
                                    let textContent;
                                    try { textContent = atob(raw); } catch { textContent = raw; }
                                    bt.bbWrite(outputKey, textContent, outputScope, 'text');
                                } else {
                                    bt.bbWrite(outputKey, [msg], outputScope, outputType);
                                }
                            }
                            resolve(true);
                        }
                    }
                };
                app._addMessageListener(handler);
                app.postMessage({ type: 'bt_load_local_file', payload: { filePath, basePath } });
            });
        }
    });

    // ── playAudio ──────────────────────────────────────────────
    R.register('playAudio', {
        label: 'Play Audio',
        fields: ['inputKey'],
        defaults: { inputType: 'media' },
        handler: async (ctx) => {
            const { bt, app, path, inputKey, mediaArr, setCleanup } = ctx;

            if (!inputKey) {
                app.outputMessage('❌ Play Audio: No input key specified');
                return false;
            }
            if (!mediaArr || !Array.isArray(mediaArr) || mediaArr.length === 0) {
                app.outputMessage(`❌ Play Audio: No audio data found in blackboard key "${inputKey}"`);
                return false;
            }

            const item = mediaArr[0];
            const mime = item.mimetype || 'audio/wav';
            const b64  = item.content || '';
            if (!b64) {
                app.outputMessage(`❌ Play Audio: Audio content is empty for key "${inputKey}"`);
                return false;
            }

            const src    = `data:${mime};base64,${b64}`;
            const safeId = `bt-audio-${path.replace(/[^a-z0-9]/gi, '_')}`;

            // Remove any previous player for this node (avoid duplicates)
            const prev = document.getElementById(safeId);
            if (prev) { prev.pause(); prev.remove(); }
            const prevContainer = document.getElementById(`${safeId}-container`);
            if (prevContainer) prevContainer.remove();

            return new Promise(resolve => {
                const audio = document.createElement('audio');
                audio.id = safeId;
                audio.src = src;
                audio.controls = true;
                audio.setAttribute('playsinline', '');

                const container = document.createElement('div');
                container.id = `${safeId}-container`;

                const styleEl = audio.style;
                styleEl.width = '320px';
                styleEl.position = 'fixed';
                styleEl.bottom = '20px';
                styleEl.right = '20px';
                styleEl.zIndex = '9999';
                styleEl.background = '#222';
                styleEl.borderRadius = '4px';
                styleEl.padding = '4px';

                container.style.cssText = 'display:none';

                setCleanup(() => {
                    audio.pause();
                    audio.remove();
                    container.remove();
                });

                // Logs each time playback actually begins (not just when
                // playAudio is invoked) — two of these for one run means
                // overlapping playback (the "reverb"/echo).
                audio.onplay = () => {
                    app.outputMessage(`▶️ Audio playback started for "${inputKey}" (${safeId})`);
                };

                audio.onended = () => {
                    app.outputMessage(`🔊 Play Audio: Finished playback from "${inputKey}"`);
                    audio.remove();
                    container.remove();
                    resolve(true);
                };

                audio.onerror = () => {
                    const errMsg = audio.error?.message || 'Unknown error';
                    app.outputMessage(`❌ Play Audio failed: ${errMsg}`);
                    audio.remove();
                    container.remove();
                    resolve(false);
                };

                document.body.appendChild(audio);
                document.body.appendChild(container);

                app.outputMessage(`🔊 Playing audio from blackboard key "${inputKey}"`);
                audio.play().catch(() => {
                    // Autoplay blocked — player with controls is already visible
                    app.outputMessage(`⚠️ Autoplay blocked for "${inputKey}", click play on the player`);
                });
            });
        }
    });

    // ── outputDisplay ──────────────────────────────────────────
    R.register('outputDisplay', {
        label: 'Output Display',
        fields: ['inputKey'],
        defaults: { inputType: 'media' },
        handler: async (ctx) => {
            const { bt, app, inputKey, mediaArr, textInput } = ctx;

            if (!inputKey) {
                app.outputMessage('❌ Output Display: No input key specified');
                return false;
            }

            const data = mediaArr && mediaArr.length > 0 ? mediaArr : textInput;
            if (data) {
                app.setPipelineFinalOutput(data);
                app.outputMessage(`📋 Output displayed from blackboard key "${inputKey}"`);
            } else {
                app.outputMessage(`⚠️ Output Display: No data found in blackboard key "${inputKey}"`);
            }
            return true;
        }
    });

    // ── playVideo ──────────────────────────────────────────────
    R.register('playVideo', {
        label: 'Play Video',
        fields: ['inputKey'],
        defaults: { inputType: 'media' },
        handler: async (ctx) => {
            const { bt, app, path, inputKey, mediaArr, setCleanup } = ctx;

            if (!inputKey) {
                app.outputMessage('❌ Play Video: No input key specified');
                return false;
            }
            if (!mediaArr || !Array.isArray(mediaArr) || mediaArr.length === 0) {
                app.outputMessage(`❌ Play Video: No video data found in blackboard key "${inputKey}"`);
                return false;
            }

            const item = mediaArr[0];
            const mime = item.mimetype || 'video/mp4';
            const b64  = item.content || '';
            if (!b64) {
                app.outputMessage(`❌ Play Video: Video content is empty for key "${inputKey}"`);
                return false;
            }

            const src    = `data:${mime};base64,${b64}`;
            const safeId = `bt-video-${path.replace(/[^a-z0-9]/gi, '_')}`;

            // Remove any previous player for this node (avoid duplicates)
            const prev = document.getElementById(safeId);
            if (prev) { prev.pause(); prev.remove(); }
            const prevContainer = document.getElementById(`${safeId}-container`);
            if (prevContainer) prevContainer.remove();

            return new Promise(resolve => {
                const video = document.createElement('video');
                video.id = safeId;
                video.src = src;
                video.controls = true;
                video.setAttribute('playsinline', '');

                const container = document.createElement('div');
                container.id = `${safeId}-container`;

                const styleEl = video.style;
                styleEl.width = '400px';
                styleEl.maxHeight = '300px';
                styleEl.position = 'fixed';
                styleEl.bottom = '20px';
                styleEl.right = '20px';
                styleEl.zIndex = '9999';
                styleEl.background = '#000';
                styleEl.borderRadius = '4px';

                container.style.cssText = 'display:none';

                setCleanup(() => {
                    video.pause();
                    video.remove();
                    container.remove();
                });

                video.onended = () => {
                    app.outputMessage(`🎬 Play Video: Finished playback from "${inputKey}"`);
                    video.remove();
                    container.remove();
                    resolve(true);
                };

                video.onerror = () => {
                    const errMsg = video.error?.message || 'Unknown error';
                    app.outputMessage(`❌ Play Video failed: ${errMsg}`);
                    video.remove();
                    container.remove();
                    resolve(false);
                };

                document.body.appendChild(video);
                document.body.appendChild(container);

                app.outputMessage(`🎬 Playing video from blackboard key "${inputKey}"`);
                video.play().catch(() => {
                    app.outputMessage(`⚠️ Autoplay blocked for "${inputKey}", click play on the player`);
                });
            });
        }
    });

    // ── math ───────────────────────────────────────────────────
    R.register('math', {
        label: 'Math',
        fields: ['prompt', 'outputKey', 'outputType'],
        defaults: { outputType: 'text' },
        handler: async (ctx) => {
            const { bt, app, node, prompt } = ctx;

            let result = '';
            let error = null;
            try {
                let expr = (prompt || '').trim();
                if (!expr) throw new Error('Empty mathematical expression');
                const allowedPattern = /^(?:[0-9+\-*/%().\s<>=!&|?:,]|Math\.(?:sin|cos|tan|abs|sqrt|pow|min|max|floor|ceil|round|random|PI|E))+$/;
                if (!allowedPattern.test(expr)) throw new Error('Invalid characters in mathematical expression.');
                const evalFn = new Function(`return (${expr});`);
                result = String(evalFn());
            } catch (e) {
                error = e.message || String(e);
            }

            const outputKey   = node.btOutputKey || '';
            const outputType  = node.btOutputType || 'text';
            const outputScope = node.btOutputScope || 'run';
            if (!error && outputKey) {
                bt.bbWrite(outputKey, result, outputScope, outputType);
            }

            if (error) {
                app.outputMessage(`❌ Math calculation failed: ${error}`);
            } else {
                app.outputMessage(`🔢 Math calculation: ${prompt} = ${result}`);
            }

            if (result.toLowerCase() === 'false') return false;
            return !error;
        }
    });

    // ── web ─────────────────────────────────────────────────────
    R.register('web', {
        label: 'Web Request',
        fields: ['prompt', 'outputKey', 'outputType'],
        defaults: { outputType: 'text' },
        handler: async (ctx) => {
            const { bt, app, node, prompt } = ctx;

            let url = (prompt || '').trim();
            let method = 'GET';
            let headers = {};
            let body = null;

            try {
                if (url.startsWith('{')) {
                    const config = JSON.parse(url);
                    if (config.url) {
                        url = config.url;
                        if (config.method) method = config.method;
                        if (config.headers) headers = config.headers;
                        if (config.body) body = typeof config.body === 'object' ? JSON.stringify(config.body) : String(config.body);
                    }
                }
            } catch (e) { /* treat as raw URL */ }

            if (!url) {
                app.outputMessage('❌ Web request failed: No URL specified');
                return false;
            }

            const outputKey   = node.btOutputKey || '';
            const outputType  = node.btOutputType || 'text';
            const outputScope = node.btOutputScope || 'run';

            return new Promise(resolve => {
                const handler = (msg) => {
                    if (msg.type === 'bt_http_request_result') {
                        app._removeMessageListener(handler);
                        if (msg.error) {
                            app.outputMessage(`❌ Web request failed: ${msg.error}`);
                            resolve(false);
                        } else {
                            const responseText = msg.response || '';
                            if (outputKey) {
                                bt.bbWrite(outputKey, responseText, outputScope, outputType);
                            }
                            app.outputMessage(`🌐 Web request to ${url} succeeded`);
                            const normalized = responseText.toLowerCase().replace(/[^a-z]/g, '');
                            resolve(normalized !== 'false');
                        }
                    }
                };
                app._addMessageListener(handler);
                app.postMessage({ type: 'bt_http_request', payload: { url, method, headers, body } });
            });
        }
    });

    // ── misc ────────────────────────────────────────────────────
    R.register('misc', {
        label: 'Misc Operation',
        fields: ['prompt', 'outputKey', 'outputType'],
        defaults: { outputType: 'text' },
        handler: async (ctx) => {
            const { bt, app, node, prompt } = ctx;

            const input = (prompt || '').trim();
            const lowerInput = input.toLowerCase();
            let result = '';
            let error = null;
            let actionMsg = '';

            try {
                if (lowerInput.startsWith('copy ') || lowerInput.startsWith('copy:')) {
                    const textToCopy = input.substring(input.startsWith('copy:') ? 5 : 5).trim();
                    await navigator.clipboard.writeText(textToCopy);
                    actionMsg = `📋 Copied to clipboard: "${textToCopy.slice(0, 50)}${textToCopy.length > 50 ? '...' : ''}"`;
                    result = textToCopy;
                } else if (lowerInput === 'paste' || lowerInput.startsWith('paste ') || lowerInput.startsWith('paste:')) {
                    const clipboardText = await navigator.clipboard.readText();
                    result = clipboardText || '';
                    actionMsg = `📋 Pasted from clipboard: "${result.slice(0, 50)}${result.length > 50 ? '...' : ''}"`;
                } else {
                    result = input;
                    actionMsg = `✍️ Write to blackboard: "${input.slice(0, 50)}${input.length > 50 ? '...' : ''}"`;
                }

                const outputKey   = node.btOutputKey || '';
                const outputType  = node.btOutputType || 'text';
                const outputScope = node.btOutputScope || 'run';
                if (outputKey) {
                    bt.bbWrite(outputKey, result, outputScope, outputType);
                }
            } catch (e) {
                error = e.message || String(e);
            }

            if (error) {
                app.outputMessage(`❌ Misc operation failed: ${error}`);
            } else {
                app.outputMessage(actionMsg);
            }
            return !error;
        }
    });

    // ── mediaToFile ────────────────────────────────────────────
    R.register('mediaToFile', {
        label: 'Media → File',
        description: 'Writes media (audio/video/image) from blackboard to a temp file and stores the file path.',
        fields: ['inputKey', 'outputKey'],
        defaults: { inputType: 'media', outputType: 'text' },
        handler: async (ctx) => {
            const { bt, app, inputKey, outputKey, mediaArr } = ctx;

            if (!mediaArr || !Array.isArray(mediaArr) || mediaArr.length === 0) {
                app.outputMessage(`❌ Media → File: No media data found in blackboard key "${inputKey}"`);
                return false;
            }

            const item = mediaArr[0];
            if (!item.content) {
                app.outputMessage(`❌ Media → File: Empty content for key "${inputKey}"`);
                return false;
            }

            return new Promise(resolve => {
                const handler = (msg) => {
                    if (msg.type === 'bt_media_to_file_result') {
                        app._removeMessageListener(handler);
                        if (msg.error) {
                            app.outputMessage(`❌ Media → File failed: ${msg.error}`);
                            resolve(false);
                        } else {
                            if (outputKey) {
                                bt.bbWrite(outputKey, msg.path, 'run', 'text');
                            }
                            app.outputMessage(`💾 Media written to ${msg.path}`);
                            resolve(true);
                        }
                    }
                };
                app._addMessageListener(handler);
                app.postMessage({ type: 'bt_media_to_file', payload: { content: item.content, filename: item.file || 'media' } });
            });
        }
    });

    // ── fileToMedia ────────────────────────────────────────────
    R.register('fileToMedia', {
        label: 'File → Media',
        description: 'Reads a file from disk using a path from the blackboard and stores it as media.',
        fields: ['inputKey', 'outputKey'],
        defaults: { inputType: 'text', outputType: 'media' },
        handler: async (ctx) => {
            const { bt, app, inputKey, outputKey, textInput } = ctx;
            const filePath = (textInput || '').trim();

            if (!filePath) {
                app.outputMessage(`❌ File → Media: No file path found in blackboard key "${inputKey}"`);
                return false;
            }

            return new Promise(resolve => {
                const handler = (msg) => {
                    if (msg.type === 'bt_load_local_file_result') {
                        app._removeMessageListener(handler);
                        if (msg.error) {
                            app.outputMessage(`❌ File → Media: ${msg.error}`);
                            resolve(false);
                        } else {
                            if (outputKey) {
                                bt.bbWrite(outputKey, [msg], 'run', 'media');
                            }
                            app.outputMessage(`📂 File loaded as media: ${msg.file}`);
                            resolve(true);
                        }
                    }
                };
                app._addMessageListener(handler);
                app.postMessage({ type: 'bt_load_local_file', payload: { filePath, basePath: '' } });
            });
        }
    });

})();
