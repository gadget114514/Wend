'use strict';
const fs = require('fs');
const path = require('path');

function b64(str) {
    if (!str) return '';
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return Buffer.from(binary, 'binary').toString('base64');
}

function leafNode(title, prompt, recipe, inputKey, inputType, outputKey, ...args) {
    const node = {
        title: b64(title),
        content: b64(prompt),
        mimetype: 'text/plain',
        attachments: [],
        children: [],
        nodeType: 'assemble',
        selectedRecipe: recipe,
    };
    if (inputKey) node.btInputKey = inputKey;
    if (inputType) node.btInputType = inputType;
    if (outputKey) node.btOutputKey = outputKey;
    // args: either [btPrompt] (backward-compat) or [outputType, btPrompt]
    let btPrompt, outputType;
    if (args.length === 2) {
        outputType = args[0];
        btPrompt = args[1];
    } else {
        btPrompt = args[0];
    }
    if (outputType) node.btOutputType = outputType;
    if (btPrompt) node.btPrompt = b64(btPrompt);
    return node;
}

function loadLocalFileNode(title, localFilePath, outputKey, outputType) {
    const node = {
        title: b64(title),
        content: '',
        mimetype: 'text/plain',
        attachments: [],
        children: [],
        nodeType: 'assemble',
        btAction: 'loadLocalFile',
        btLocalFilePath: localFilePath,
        btOutputKey: outputKey,
    };
    if (outputType) node.btOutputType = outputType;
    return node;
}

function playAudioNode(title, inputKey) {
    return {
        title: b64(title),
        content: '',
        mimetype: 'text/plain',
        attachments: [],
        children: [],
        nodeType: 'assemble',
        btAction: 'playAudio',
        btInputKey: inputKey,
    };
}

function pipelineOutputNode(title, inputKey) {
    return {
        title: b64(title),
        content: '',
        mimetype: 'text/plain',
        attachments: [],
        children: [],
        nodeType: 'assemble',
        btAction: 'pipelineOutput',
        btInputKey: inputKey,
    };
}

function compositeNode(title, btType, children) {
    return {
        title: b64(title),
        content: '',
        mimetype: 'text/plain',
        attachments: [],
        children: children,
        nodeType: 'assemble',
        btType: btType,
    };
}

function rootTree(btType, children) {
    return {
        title: '',
        content: '',
        mimetype: 'text/plain',
        attachments: [],
        children: children,
        nodeType: 'root',
        btType: btType,
    };
}

// Recipes
const recipes = [
    {
        name: 'Radio Music Fetcher',
        type: 'ai',
        provider: 'mock',
        model: 'echo',
        temperature: 0.3,
        systemPrompt: 'You are a music metadata assistant. Provide concise, accurate information about songs, artists, and genres.',
        command: '',
        useCustomApiPath: false,
        apiPath: '',
        apiType: 'simple',
        customParams: {}
    },
    {
        name: 'Radio Article Writer',
        type: 'ai',
        provider: 'mock',
        model: 'echo',
        temperature: 0.8,
        systemPrompt: 'You are a radio DJ and music journalist. Write engaging, informative articles about music.',
        command: '',
        useCustomApiPath: false,
        apiPath: '',
        apiType: 'simple',
        customParams: {}
    },
    {
        name: 'Radio Theme Generator',
        type: 'ai',
        provider: 'mock',
        model: 'echo',
        temperature: 0.8,
        systemPrompt: 'You are a creative radio show producer. Generate engaging themes and concepts for radio segments.',
        command: '',
        useCustomApiPath: false,
        apiPath: '',
        apiType: 'simple',
        customParams: {}
    },
    {
        name: 'Radio Log Writer',
        type: 'ai',
        provider: 'mock',
        model: 'echo',
        temperature: 0.3,
        systemPrompt: 'You are a broadcast logging assistant. Summarize radio segments concisely.',
        command: '',
        useCustomApiPath: false,
        apiPath: '',
        apiType: 'simple',
        customParams: {}
    },
    {
        name: 'Radio TTS',
        type: 'ai',
        provider: 'mock',
        model: 'echo',
        temperature: 0.7,
        systemPrompt: '',
        command: '',
        useCustomApiPath: false,
        apiPath: '',
        apiType: 'simple',
        customParams: {}
    },
    {
        name: 'Radio Music Fetcher',
        type: 'ai',
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        temperature: 0.3,
        systemPrompt: 'You are a music metadata assistant. Provide concise, accurate information about songs, artists, and genres.',
        command: '',
        useCustomApiPath: false,
        apiPath: '/v1beta/models/{model}:generateContent',
        apiType: 'simple',
        customParams: {}
    },
    {
        name: 'Radio Article Writer',
        type: 'ai',
        provider: 'gemini',
        model: 'gemini-3.1-pro-preview',
        temperature: 0.8,
        systemPrompt: 'You are a radio DJ and music journalist. Write engaging, informative articles about music.',
        command: '',
        useCustomApiPath: false,
        apiPath: '/v1beta/models/{model}:generateContent',
        apiType: 'simple',
        customParams: {}
    },
    {
        name: 'Radio Theme Generator',
        type: 'ai',
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        temperature: 0.8,
        systemPrompt: 'You are a creative radio show producer. Generate engaging themes and concepts for radio segments.',
        command: '',
        useCustomApiPath: false,
        apiPath: '/v1beta/models/{model}:generateContent',
        apiType: 'simple',
        customParams: {}
    },
    {
        name: 'Radio Log Writer',
        type: 'ai',
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        temperature: 0.3,
        systemPrompt: 'You are a broadcast logging assistant. Summarize radio segments concisely.',
        command: '',
        useCustomApiPath: false,
        apiPath: '/v1beta/models/{model}:generateContent',
        apiType: 'simple',
        customParams: {}
    },
    {
        name: 'Radio TTS',
        type: 'ai',
        provider: 'openai',
        model: 'tts-1',
        temperature: 0.7,
        systemPrompt: '',
        command: '',
        useCustomApiPath: false,
        apiPath: '/v1/audio/speech',
        apiType: 'simple',
        customParams: {}
    },
    {
        name: 'Radio TTS',
        type: 'ai',
        provider: 'voicebox',
        model: 'kokoro',
        temperature: 0.7,
        systemPrompt: '',
        command: '',
        useCustomApiPath: false,
        apiPath: '',
        apiType: 'simple',
        customParams: {
            profile_name: '',
            language: ''
        }
    }
];

const samples = {};

// 01: Basic Sequential (Fetch -> Write)
samples['01-basic-sequential'] = rootTree('sequence', [
    leafNode('Fetch Music Info', '', 'Radio Music Fetcher', null, null, 'music_info',
        'Search for a trending music track. Return the title, artist, genre, and a brief description of the mood and style.'),
    leafNode('Write Article', '', 'Radio Article Writer', 'music_info', 'text', 'article',
        'Write a 10-word radio DJ article about the following music: {bb:music_info}. Include background context, why it is worth listening to, and an engaging introduction for radio playback.'),
]);

// 02: Parallel (Load Local MP3 -> Theme -> [Describe || Write])
samples['02-parallel'] = rootTree('sequence', [
    loadLocalFileNode('Load Music File', 'music.mp3', 'music_audio'),
    leafNode('Generate Theme', '', 'Radio Theme Generator', null, null, 'topic',
        'Suggest a creative music theme for today\'s radio show based on the loaded music file. Return a short description of the theme, mood, and genre.'),
    compositeNode('Produce', 'parallel', [
        leafNode('Describe Music', '', 'Radio Music Fetcher', 'music_audio', 'media', 'music_info',
            'Describe the attached audio file. Identify the genre, mood, tempo, instruments, and overall style.'),
        leafNode('Write Article', '', 'Radio Article Writer', 'topic', 'text', 'article',
            'Write a 10-word radio DJ introduction for a show with theme: {bb:topic}'),
    ]),
]);

// 03: Simple Flow (Fetch -> Write)
samples['03-simple-flow'] = rootTree('sequence', [
    leafNode('Fetch Music Info', '', 'Radio Music Fetcher', null, null, 'music_info',
        'Search for a trending music track. Return the title, artist, genre, and a brief description.'),
    leafNode('Write Article', '', 'Radio Article Writer', 'music_info', 'text', 'article',
        'Write a 10-word radio DJ article about: {bb:music_info}'),
]);

// 04: Article Writing (Fetch -> Write)
samples['04-article-writing'] = rootTree('sequence', [
    leafNode('Fetch Music Info', '', 'Radio Music Fetcher', null, null, 'music_info',
        'Search for a trending music track. Return the title, artist, genre, and a brief description.'),
    leafNode('Write Article', '', 'Radio Article Writer', 'music_info', 'text', 'article',
        'Write a 10-word radio DJ article about: {bb:music_info}'),
]);

// 05: Validate and Write (Fetch -> Validate -> Write)
samples['05-validate-and-write'] = rootTree('sequence', [
    leafNode('Fetch Music Info', '', 'Radio Music Fetcher', null, null, 'music_info',
        'Search for a trending music track. Return the title, artist, genre, and a brief description.'),
    leafNode('Validate Info', '', 'Radio Music Fetcher', 'music_info', 'text', 'music_info',
        'Validate and clean the following music information. Ensure it contains title, artist, and genre: {bb:music_info}'),
    leafNode('Write Article', '', 'Radio Article Writer', 'music_info', 'text', 'article',
        'Write a 10-word radio DJ article about: {bb:music_info}'),
]);

// 06: Local Music (Load Local MP3 -> Describe -> Write)
samples['06-local-music'] = rootTree('sequence', [
    loadLocalFileNode('Load Music File', 'music.mp3', 'music_audio'),
    playAudioNode('Play Music', 'music_audio'),
    leafNode('Describe Music', '', 'Radio Music Fetcher', 'music_audio', 'media', 'music_info',
        'Describe the attached audio file. Identify the genre, mood, tempo, instruments, and overall style. Provide a concise summary suitable for a radio DJ introduction.'),
    leafNode('Write Article', '', 'Radio Article Writer', 'music_info', 'text', 'article',
        'Write a 10-word radio DJ article about: {bb:music_info}'),
]);

// 07: Streaming with Log (Fetch -> Write -> Log)
samples['07-streaming'] = rootTree('sequence', [
    leafNode('Fetch Stream Info', '', 'Radio Music Fetcher', null, null, 'stream_info',
        'Simulate fetching now-playing information from an online radio stream API. Return the current track title, artist, album, and any relevant metadata.'),
    leafNode('Write Article', '', 'Radio Article Writer', 'stream_info', 'text', 'article',
        'Write a 10-word radio DJ introduction for the currently playing track: {bb:stream_info}'),
    leafNode('Log Broadcast', '', 'Radio Log Writer', 'article', 'text', 'log',
        'Log this broadcast segment. Summarize what was presented: {bb:article}'),
]);

// 08: Continuous Station (3x [Fetch -> Write])
function trackSequence(trackNum) {
    return compositeNode(`Track ${trackNum}`, 'sequence', [
        leafNode(`Fetch Info ${trackNum}`, '', 'Radio Music Fetcher', null, null, 'music_info',
            `Search for music track #${trackNum} for a radio station playlist. Return the title, artist, genre, and a brief description.`),
        leafNode(`Write Article ${trackNum}`, '', 'Radio Article Writer', 'music_info', 'text', 'article',
        'Write a 5-word radio DJ article about: {bb:music_info}'),
    ]);
}

samples['08-continuous-station'] = rootTree('sequence', [
    trackSequence(1),
    trackSequence(2),
    trackSequence(3),
]);

// 09: TTS Playback (Generate Article -> Text to Speech -> Play Audio)
samples['09-tts-playback'] = rootTree('sequence', [
    leafNode('Generate Article', '', 'Radio Article Writer', null, null, 'article',
        'Write a 5-word radio DJ article about a trending music track.'),
    leafNode('Text to Speech', '', 'Radio TTS', 'article', 'text', 'tts_audio', 'media',
        'Convert the following radio DJ article to speech: {bb:article}'),
    playAudioNode('Play Audio', 'tts_audio'),
]);

// 10: TTS from Input Pane (type text in the input pane, convert to speech)
samples['10-tts-from-input-pane'] = rootTree('sequence', [
    leafNode('Text to Speech', '', 'Radio TTS', null, null, 'tts_audio', 'media',
        'Read the following text aloud: {content}'),
    playAudioNode('Play Audio', 'tts_audio'),
]);

// 11: TTS from Local File (load a text file from disk, convert to speech)
samples['11-tts-from-local-file'] = rootTree('sequence', [
    loadLocalFileNode('Load Text File', '/full/path/to/speech.txt', 'file_content', 'text'),
    leafNode('Text to Speech', '', 'Radio TTS', 'file_content', 'text', 'tts_audio', 'media',
        'Read the following text aloud: {bb:file_content}'),
    playAudioNode('Play Audio', 'tts_audio'),
]);

// 12: TTS from Operator Prompt (text typed directly in the operator pane's Prompt field)
samples['12-tts-from-operator-prompt'] = rootTree('sequence', [
    leafNode('Text to Speech',
        'Welcome to Wend! This is a demonstration of the text-to-speech feature using text from the operator pane.',
        'Radio TTS', null, null, 'tts_audio', 'media', null),
    playAudioNode('Play Audio', 'tts_audio'),
]);

// 13: TTS from Pipeline Output (AI generates text from input → output feeds as input to TTS)
samples['13-tts-pipeline-output'] = rootTree('sequence', [
    leafNode('Generate Text', '', 'Radio Article Writer', null, null, 'speech_text',
        'Write a short radio DJ introduction about: {content}'),
    leafNode('Text to Speech', '', 'Radio TTS', 'speech_text', 'text', 'tts_audio', 'media',
        'Read the following text aloud: {bb:speech_text}'),
    playAudioNode('Play Audio', 'tts_audio'),
]);

// Output directory
const baseDir = __dirname;

// Write projectrecipes.json at project root
const general = [];
const grouped = {};
const knownProviders = ['openai', 'gemini', 'anthropic', 'replicate', 'opencode', 'mock', 'voicebox'];

for (const r of recipes) {
    const prov = (r.provider || '').toLowerCase().trim();
    if (r.type === 'ai' && prov && knownProviders.includes(prov)) {
        if (!grouped[prov]) grouped[prov] = [];
        grouped[prov].push(r);
    } else {
        general.push(r);
    }
}

// Clean existing projectrecipes-*.json in baseDir
try {
    const files = fs.readdirSync(baseDir);
    for (const file of files) {
        if (file.startsWith('projectrecipes-') && file.endsWith('.json')) {
            fs.unlinkSync(path.join(baseDir, file));
        }
    }
} catch (e) {
    console.error('Failed to clean projectrecipes files:', e.message);
}

const recipesPath = path.join(baseDir, 'projectrecipes.json');
fs.writeFileSync(recipesPath, JSON.stringify(general, null, 2), 'utf8');
console.log(`Wrote ${recipesPath}`);

for (const [prov, list] of Object.entries(grouped)) {
    const outPath = path.join(baseDir, `projectrecipes-${prov}.json`);
    fs.writeFileSync(outPath, JSON.stringify(list, null, 2), 'utf8');
    console.log(`Wrote ${outPath}`);
}

// Write all samples
for (const [dirName, tree] of Object.entries(samples)) {
    const outDir = path.join(baseDir, dirName);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'radio.json');
    fs.writeFileSync(outPath, JSON.stringify(tree, null, 2), 'utf8');
    console.log(`Wrote ${outPath}`);
}

// Write speech.txt for sample 11 (TTS from Local File)
const sample11Dir = path.join(baseDir, '11-tts-from-local-file');
if (fs.existsSync(sample11Dir)) {
    const speechTextPath = path.join(sample11Dir, 'speech.txt');
    fs.writeFileSync(speechTextPath,
        'Hello! This is a test of the Voicebox text-to-speech system running through Wend. ' +
        'Voicebox provides high-quality, local TTS with support for multiple languages and voices.',
        'utf8');
    console.log(`Wrote ${speechTextPath}`);
}

console.log('Done! Generated', Object.keys(samples).length, 'samples and projectrecipes.json.');
