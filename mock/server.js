const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Mock Server] Running on http://localhost:${PORT}`);
});
