'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Execute a tool step (external GUI app launch)
 * @param {Object} context - Runner context
 * @param {Function} context.postBridge - Bridge callback (type, json)
 * @param {Function} context.getContent - Get current content
 * @param {Function} context.setOutput - Set step output (output, attachments)
 * @param {number} context.idx - Step index
 * @param {Object} step - Step definition
 */
async function executeToolStep(context, step) {
    const { postBridge, getContent, setOutput, idx } = context;
    const cmd = step.params?.command || '';
    const argsStr = step.params?.args || '[]';
    const waitForExit = step.params?.waitForExit !== false;
    const resultAs = step.params?.resultAs || 'none';
    const resultFile = step.params?.resultFile || '';
    const confirm = step.params?.confirm !== false;

    if (!cmd) {
        setOutput(`Tool Step Error\nStep: ${step.name || 'Step ' + idx}\nError: No command specified\nAction: Provide a valid command in the step parameters`, []);
        postBridge('step_done', JSON.stringify({ index: idx }));
        return;
    }

    const content = getContent();
    const args = JSON.parse(argsStr);

    const tmpFile = path.join(os.tmpdir(), 'prompts_tool_' + Date.now() + '.tmp');
    fs.writeFileSync(tmpFile, content, 'utf8');

    const resolvedArgs = args.map(a =>
        a.replace('{content_file}', tmpFile)
         .replace('{content}', content)
         .replace('{result}', content)
    );

    if (confirm) {
        postBridge('tool_confirm', JSON.stringify({ index: idx, command: cmd, args: resolvedArgs }));
        const confirmed = await new Promise(res => {
            context._toolConfirmResolve = res;
        });
        context._toolConfirmResolve = null;
        if (!confirmed) {
            try { fs.unlinkSync(tmpFile); } catch {}
            setOutput('[cancelled]', []);
            postBridge('step_done', JSON.stringify({ index: idx }));
            return;
        }
    }

    let output = '';
    const outputAttachments = [];

    await new Promise((resolve) => {
        const proc = spawn(cmd, resolvedArgs, {
            shell: true,
            detached: false,
        });

        proc.stdout.on('data', chunk => {
            const text = chunk.toString('utf8');
            output += text;
            postBridge('stream_chunk', JSON.stringify({ stepIndex: idx, text }));
        });

        proc.stderr.on('data', chunk => {
            const text = chunk.toString('utf8');
            output += text;
            postBridge('stream_chunk', JSON.stringify({ stepIndex: idx, text }));
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                output += `\nTool Exit Error\nStep: ${step.name || 'Step ' + idx}\nCommand: ${cmd}\nExit Code: ${code}\nAction: Check command output above for error details`;
            }
            resolve();
        });

        proc.on('error', e => {
            output += `\nTool Execution Error\nStep: ${step.name || 'Step ' + idx}\nCommand: ${cmd}\nError: ${e.message}\nPossible causes: Command not found, permission denied, or invalid command path`;
            resolve();
        });

        if (!waitForExit) {
            proc.unref();
            resolve();
        }
    });

    try { fs.unlinkSync(tmpFile); } catch {}

    if (resultAs === 'file' && resultFile) {
        try {
            const resolvedPath = resultFile.replace('{content}', content);
            if (fs.existsSync(resolvedPath)) {
                output = fs.readFileSync(resolvedPath, 'utf8');
            } else {
                output += `\nTool Result Error\nStep: ${step.name || 'Step ' + idx}\nResult File: ${resolvedPath}\nError: Result file not found\nAction: Verify the tool created the expected output file`;
            }
        } catch (e) {
            output += `\nTool Result Error\nStep: ${step.name || 'Step ' + idx}\nResult File: ${resolvedPath}\nError: ${e.message}\nAction: Check file permissions and path validity`;
        }
    } else if (resultAs === 'clipboard') {
        try {
            const { execSync } = require('child_process');
            if (process.platform === 'win32') {
                output = execSync('powershell -command "Get-Clipboard"', { encoding: 'utf8' });
            } else if (process.platform === 'darwin') {
                output = execSync('pbpaste', { encoding: 'utf8' });
            } else {
                output = execSync('xclip -selection clipboard -o', { encoding: 'utf8' });
            }
        } catch (e) {
            output += `\nClipboard Read Error\nStep: ${step.name || 'Step ' + idx}\nError: ${e.message}\nPlatform: ${process.platform}\nAction: Ensure clipboard access is available and not empty`;
        }
    } else if (resultAs === 'attachment' && resultFile) {
        try {
            const resolvedPath = resultFile.replace('{content}', content);
            if (fs.existsSync(resolvedPath)) {
                const ext = path.extname(resolvedPath).toLowerCase().slice(1);
                const mimeMap = {
                    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
                    pdf: 'application/pdf', txt: 'text/plain', json: 'application/json'
                };
                const mimetype = mimeMap[ext] || 'application/octet-stream';
                const data = fs.readFileSync(resolvedPath).toString('base64');
                outputAttachments.push({
                    file: path.basename(resolvedPath),
                    path: resolvedPath,
                    mimetype,
                    content: data,
                    size: fs.statSync(resolvedPath).size
                });
                output = `[attachment: ${path.basename(resolvedPath)}]`;
            } else {
                output += `\nAttachment Error\nStep: ${step.name || 'Step ' + idx}\nAttachment File: ${resolvedPath}\nError: Attachment file not found\nAction: Verify the tool created the expected attachment file`;
            }
        } catch (e) {
            output += `\nAttachment Error\nStep: ${step.name || 'Step ' + idx}\nAttachment File: ${resolvedPath}\nError: ${e.message}\nAction: Check file permissions and path validity`;
        }
    }

    setOutput(output, outputAttachments);
    postBridge('step_done', JSON.stringify({ index: idx }));
}

module.exports = { executeToolStep };
