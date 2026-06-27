const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const net = require('net');

const PORT = 8765;
const MOCK_DIR = __dirname;

console.log(`[Mock Server] Starting up. Mock folder: ${MOCK_DIR}`);

// Dynamically scan the mock folder for files of specific extensions
function getFilesOfExtension(exts) {
    try {
        const files = fs.readdirSync(MOCK_DIR);
        return files.filter(f => {
            const ext = path.extname(f).toLowerCase();
            const fullPath = path.join(MOCK_DIR, f);
            // Skip folders, self server script, and empty files (unless it's txt files we want to skip if empty)
            if (f === 'server.js') return false;
            try {
                const stat = fs.statSync(fullPath);
                if (!stat.isFile()) return false;
                // Exclude empty text files if there are non-empty ones
                if (ext === '.txt' && stat.size === 0) return false;
                return exts.includes(ext);
            } catch {
                return false;
            }
        }).sort();
    } catch (e) {
        console.error('[Mock Server] Error scanning files:', e.message);
        return [];
    }
}

// Round-robin counters for rotating outputs
const counters = {
    text: 0,
    image: 0,
    audio: 0,
    video: 0
};

// Select next file in sequence
function getNextFile(type, exts) {
    const list = getFilesOfExtension(exts);
    if (list.length === 0) {
        console.warn(`[Mock Server] No files found for type: ${type} with extensions: ${exts.join(', ')}`);
        return null;
    }
    const index = counters[type] % list.length;
    const selected = list[index];
    counters[type]++;
    console.log(`[Mock Server] Rotated ${type} output -> Selected file: ${selected} (index: ${index}/${list.length})`);
    return selected;
}

// Helper to get file buffer/base64
function getFileData(filename, format = 'binary') {
    if (!filename) return null;
    const filePath = path.join(MOCK_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    if (format === 'base64') {
        return fs.readFileSync(filePath).toString('base64');
    }
    return fs.readFileSync(filePath);
}

// Memory stores for polling APIs
const predictions = {};
const falRequests = {};

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    console.log(`[Mock Server] ${method} ${pathname}`);

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key');

    if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (method === 'GET' && pathname === '/docs') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
    <title>Mock AI Provider API Documentation</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 20px; line-height: 1.6; }
        .container { max-width: 800px; margin: 0 auto; background: #1e1e1e; border: 1px solid #333; border-radius: 8px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
        h1 { color: #fff; font-size: 24px; border-bottom: 1px solid #333; padding-bottom: 10px; margin-top: 0; }
        h2 { color: #7ab0ff; font-size: 18px; margin-top: 24px; border-bottom: 1px solid #2d2d2d; padding-bottom: 5px; }
        .endpoint { background: #151515; border-left: 4px solid #4caf50; border-radius: 4px; padding: 12px; margin-bottom: 14px; font-family: monospace; }
        .method { font-weight: bold; padding: 2px 6px; border-radius: 3px; font-size: 12px; margin-right: 8px; color: #fff; }
        .get { background: #007acc; }
        .post { background: #2e7d32; }
        .path { font-weight: bold; color: #fff; }
        .desc { margin-top: 8px; font-family: sans-serif; color: #aaa; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🛠 Mock AI Provider API Documentation</h1>
        <p>This is a local mock server simulating multiple AI providers (OpenAI, Gemini, Replicate, Fal.ai, etc.) for testing workflows without requiring active API keys.</p>
        
        <h2>General endpoints</h2>
        <div class="endpoint">
            <span class="method get">GET</span><span class="path">/docs</span>
            <div class="desc">Displays this API documentation page.</div>
        </div>
        <div class="endpoint">
            <span class="method get">GET</span><span class="path">/files/:filename</span>
            <div class="desc">Serves static assets (images, audio, video) located in the mock directory.</div>
        </div>

        <h2>Mock-HTTP endpoints</h2>
        <div class="endpoint">
            <span class="method post">POST</span><span class="path">/recipe/text-to-text</span>
            <div class="desc">Mock text generation endpoint. Returns simulated text responses.</div>
        </div>
        <div class="endpoint">
            <span class="method post">POST</span><span class="path">/recipe/image-to-image</span>
            <div class="desc">Mock image-to-image processing endpoint. Returns base64 image data.</div>
        </div>
        
        <h2>OpenAI-compatible endpoints</h2>
        <div class="endpoint">
            <span class="method post">POST</span><span class="path">/v1/chat/completions</span>
            <div class="desc">Simulates OpenAI chat completions endpoint (GPT models).</div>
        </div>
        <div class="endpoint">
            <span class="method post">POST</span><span class="path">/v1/audio/speech</span>
            <div class="desc">Simulates OpenAI text-to-speech generation. Returns audio bytes.</div>
        </div>
        <div class="endpoint">
            <span class="method post">POST</span><span class="path">/v1/images/generations</span>
            <div class="desc">Simulates OpenAI DALL-E image generation. Returns base64 JSON payload.</div>
        </div>

        <h2>Google Gemini endpoints</h2>
        <div class="endpoint">
            <span class="method post">POST</span><span class="path">/v1beta/models/:model:generateContent</span>
            <div class="desc">Simulates Gemini content generation. Supports both text and image output.</div>
        </div>

        <h2>Replicate endpoints</h2>
        <div class="endpoint">
            <span class="method post">POST</span><span class="path">/v1/predictions</span>
            <div class="desc">Initiates a Replicate prediction process (returns processing status).</div>
        </div>
        <div class="endpoint">
            <span class="method get">GET</span><span class="path">/v1/predictions/:id</span>
            <div class="desc">Polls status of a Replicate prediction. Returns the succeeded static media URL.</div>
        </div>

        <h2>Fal.ai endpoints</h2>
        <div class="endpoint">
            <span class="method post">POST</span><span class="path">/:model</span>
            <div class="desc">Initiates a Fal.ai generation request.</div>
        </div>
        <div class="endpoint">
            <span class="method get">GET</span><span class="path">/requests/:id</span>
            <div class="desc">Polls status of a Fal.ai generation job.</div>
        </div>
    </div>
</body>
</html>`);
        return;
    }

    // Serve static files from mock directory
    if (method === 'GET' && pathname.startsWith('/files/')) {
        const filename = pathname.replace('/files/', '');
        const buffer = getFileData(filename);
        if (!buffer) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        let contentType = 'application/octet-stream';
        if (filename.endsWith('.png')) contentType = 'image/png';
        else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) contentType = 'image/jpeg';
        else if (filename.endsWith('.mp3')) contentType = 'audio/mpeg';
        else if (filename.endsWith('.wav')) contentType = 'audio/wav';
        else if (filename.endsWith('.mp4')) contentType = 'video/mp4';
        else if (filename.endsWith('.txt')) contentType = 'text/plain';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': buffer.length
        });
        res.end(buffer);
        return;
    }

    // Read request body helper
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        let reqJson = {};
        try {
            if (body) reqJson = JSON.parse(body);
        } catch (e) {}

        // 1. Built-in Mock HTTP endpoints
        if (pathname === '/recipe/text-to-text') {
            const prompt = parsedUrl.query.prompt || 'No prompt provided';
            const selectedTextFile = getNextFile('text', ['.txt']);
            let txt = selectedTextFile ? getFileData(selectedTextFile).toString('utf8').trim() : '';
            if (!txt) txt = `[Mock HTTP T2T] Echo: ${prompt}`;
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ output: txt }));
            return;
        }

        if (pathname === '/recipe/image-to-image' || pathname === '/recipe/multi-image-to-image') {
            const selectedImgFile = getNextFile('image', ['.png', '.jpg', '.jpeg']);
            const b64 = selectedImgFile ? getFileData(selectedImgFile, 'base64') : '';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ output_image: `processed:${b64}` }));
            return;
        }

        // 2. OpenAI-compatible endpoints
        if (pathname === '/v1/chat/completions') {
            const userMsg = reqJson.messages?.find(m => m.role === 'user')?.content || '';
            const selectedTextFile = getNextFile('text', ['.txt']);
            let txt = selectedTextFile ? getFileData(selectedTextFile).toString('utf8').trim() : '';
            if (!txt) txt = `[Mock OpenAI T2T] Responding to: "${typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg)}"`;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'chatcmpl-mock-' + Date.now(),
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: reqJson.model || 'gpt-4o',
                choices: [{
                    message: { role: 'assistant', content: txt },
                    finish_reason: 'stop',
                    index: 0
                }]
            }));
            return;
        }

        if (pathname === '/v1/audio/speech') {
            const selectedAudioFile = getNextFile('audio', ['.mp3', '.wav']);
            const buffer = selectedAudioFile ? getFileData(selectedAudioFile) : null;
            if (buffer) {
                const contentType = selectedAudioFile.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
                res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': buffer.length });
                res.end(buffer);
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'No mock audio files found in mock/ directory.' } }));
            }
            return;
        }

        if (pathname === '/v1/images/generations') {
            const selectedImgFile = getNextFile('image', ['.png', '.jpg', '.jpeg']);
            const b64 = selectedImgFile ? getFileData(selectedImgFile, 'base64') : '';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                created: Math.floor(Date.now() / 1000),
                data: [{ b64_json: b64 }]
            }));
            return;
        }

        // 3. Google Gemini-compatible endpoints
        if (pathname.includes(':generateContent')) {
            const model = pathname.split('/models/')[1]?.split(':')[0] || 'gemini-3.5-flash';
            let isImageOutput = model.includes('image') || model.includes('imagen');
            
            // Check customParams/modalities if passed
            if (reqJson.generationConfig?.responseModalities?.includes('IMAGE')) {
                isImageOutput = true;
            }

            const parts = [];
            const selectedTextFile = getNextFile('text', ['.txt']);
            let txt = selectedTextFile ? getFileData(selectedTextFile).toString('utf8').trim() : '';
            if (!txt) txt = `[Mock Gemini] Response from model: ${model}`;
            parts.push({ text: txt });

            if (isImageOutput) {
                const selectedImgFile = getNextFile('image', ['.png', '.jpg', '.jpeg']);
                const b64 = selectedImgFile ? getFileData(selectedImgFile, 'base64') : '';
                parts.push({
                    inlineData: {
                        mimeType: selectedImgFile?.endsWith('.jpg') || selectedImgFile?.endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
                        data: b64
                    }
                });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                candidates: [{
                    content: { parts }
                }]
            }));
            return;
        }

        // 4. Replicate-compatible endpoints
        if (pathname === '/v1/predictions' && method === 'POST') {
            const id = 'replicate_mock_' + Math.floor(Math.random() * 1000000);
            const prompt = reqJson.input?.prompt || '';
            const model = reqJson.version || '';

            // Decide which file to serve as replicate output based on prompt/model keywords
            let selectedFile = null;
            if (prompt.toLowerCase().includes('tts') || prompt.toLowerCase().includes('speech') || prompt.toLowerCase().includes('voice') || prompt.toLowerCase().includes('speak') || model.includes('xtts')) {
                selectedFile = getNextFile('audio', ['.mp3', '.wav']);
            } else if (prompt.toLowerCase().includes('video') || prompt.toLowerCase().includes('movie') || prompt.toLowerCase().includes('mp4') || model.includes('animatediff')) {
                selectedFile = getNextFile('video', ['.mp4']);
            } else if (prompt.toLowerCase().includes('text') || prompt.toLowerCase().includes('write')) {
                selectedFile = getNextFile('text', ['.txt']);
            } else {
                // Default to image T2I
                selectedFile = getNextFile('image', ['.png', '.jpg', '.jpeg']);
            }

            // Fallback selection if specific type is empty
            if (!selectedFile) {
                selectedFile = getNextFile('image', ['.png', '.jpg', '.jpeg']) || getNextFile('text', ['.txt']) || getNextFile('audio', ['.mp3']) || '150x150.png';
            }

            predictions[id] = {
                id,
                status: 'succeeded',
                output: `http://localhost:${PORT}/files/${selectedFile}`,
                urls: {
                    get: `http://localhost:${PORT}/v1/predictions/${id}`
                }
            };

            // Return "processing" first so replication polling flow occurs
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id,
                status: 'processing',
                urls: {
                    get: `http://localhost:${PORT}/v1/predictions/${id}`
                }
            }));
            return;
        }

        if (pathname.startsWith('/v1/predictions/') && method === 'GET') {
            const id = pathname.replace('/v1/predictions/', '');
            const pred = predictions[id];
            if (pred) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(pred));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Prediction not found' }));
            }
            return;
        }

        // 5. Fal.ai-compatible endpoints
        if (method === 'POST') {
            const id = 'fal_mock_' + Math.floor(Math.random() * 1000000);
            const prompt = reqJson.prompt || '';
            const model = pathname.replace(/^\//, '');

            let selectedFile = null;
            if (prompt.toLowerCase().includes('video') || prompt.toLowerCase().includes('mp4') || model.includes('video')) {
                selectedFile = getNextFile('video', ['.mp4']);
            } else {
                selectedFile = getNextFile('image', ['.png', '.jpg', '.jpeg']);
            }

            if (!selectedFile) {
                selectedFile = getNextFile('image', ['.png', '.jpg', '.jpeg']) || '150x150.png';
            }

            falRequests[id] = {
                request_id: id,
                status: 'COMPLETED',
                images: selectedFile.endsWith('.mp4') ? [] : [{ url: `http://localhost:${PORT}/files/${selectedFile}` }],
                video: selectedFile.endsWith('.mp4') ? { url: `http://localhost:${PORT}/files/${selectedFile}` } : null
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ request_id: id }));
            return;
        }

        if (method === 'GET' && pathname.includes('/requests/')) {
            const parts = pathname.split('/requests/');
            const id = parts[parts.length - 1];
            const job = falRequests[id];
            if (job) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(job));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Fal.ai request not found' }));
            }
            return;
        }

        // Default fallback
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });
});

server.on('connect', (req, clientSocket, head) => {
    console.log(`[Mock Server Proxy CONNECT] ${req.url}`);
    const parts = req.url.split(':');
    const hostname = parts[0];
    const port = parseInt(parts[1]) || 443;
    
    const serverSocket = net.connect(port, hostname, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                            'Proxy-agent: Wend-Mock-Proxy\r\n' +
                            '\r\n');
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
    });
    
    serverSocket.on('error', (err) => {
        console.error(`[Mock Server Proxy CONNECT Error] ${err.message}`);
        clientSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    });
    
    clientSocket.on('error', () => {
        serverSocket.end();
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Mock Server] Running on http://localhost:${PORT}`);
});
