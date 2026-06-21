'use strict';
/**
 * Build artifact verification tests
 * Run with: node test_build.js
 * Verifies that npm run build produced correct output at the expected location.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');

const BUILD_DIR = path.resolve(__dirname, '../bin/Release/Wend');
const RESOURCES = path.join(BUILD_DIR, 'resources');
const FRONTEND  = path.join(RESOURCES, 'frontend');
const ASAR      = path.join(RESOURCES, 'app.asar');
const CSS       = path.join(FRONTEND, 'style.css');
const HTML      = path.join(FRONTEND, 'index.html');
const JS        = path.join(FRONTEND, 'app.js');

describe('Build output location', () => {
    test('bin/Release/Wend directory exists', () => {
        assert.ok(fs.existsSync(BUILD_DIR), `Build dir missing: ${BUILD_DIR}`);
    });

    test('Wend.exe exists', () => {
        const exe = path.join(BUILD_DIR, 'Wend.exe');
        assert.ok(fs.existsSync(exe), `Executable missing: ${exe}`);
    });

    test('resources/app.asar exists', () => {
        assert.ok(fs.existsSync(ASAR), `app.asar missing: ${ASAR}`);
    });

    test('resources/frontend directory exists', () => {
        assert.ok(fs.existsSync(FRONTEND), `frontend dir missing: ${FRONTEND}`);
    });
});

describe('Bundled frontend/style.css', () => {
    test('file exists', () => {
        assert.ok(fs.existsSync(CSS), `style.css missing: ${CSS}`);
    });

    test('is not empty', () => {
        const size = fs.statSync(CSS).size;
        assert.ok(size > 10000, `style.css too small (${size} bytes) — may be stale`);
    });

    test('matches source file size', () => {
        const srcSize    = fs.statSync(path.join(__dirname, '../frontend/style.css')).size;
        const bundleSize = fs.statSync(CSS).size;
        assert.equal(bundleSize, srcSize,
            `Bundled style.css (${bundleSize}B) differs from source (${srcSize}B) — rebuild needed`);
    });

    test('contains .output-tab-bar (tab UI regression guard)', () => {
        const css = fs.readFileSync(CSS, 'utf8');
        assert.ok(css.includes('.output-tab-bar'),
            'Bundled style.css missing .output-tab-bar — CSS change not picked up by build');
    });

    test('contains .output-tab.active (tab active state)', () => {
        const css = fs.readFileSync(CSS, 'utf8');
        assert.ok(css.includes('.output-tab.active'),
            'Bundled style.css missing .output-tab.active');
    });

    test('contains .media-viewer-img-wrap (media viewer)', () => {
        const css = fs.readFileSync(CSS, 'utf8');
        assert.ok(css.includes('.media-viewer-img-wrap'),
            'Bundled style.css missing .media-viewer-img-wrap');
    });

    test('contains .attach-thumb-row (attachment thumbnail grid)', () => {
        const css = fs.readFileSync(CSS, 'utf8');
        assert.ok(css.includes('.attach-thumb-row'),
            'Bundled style.css missing .attach-thumb-row — thumbnail CSS not picked up');
    });
});

describe('Bundled frontend/index.html', () => {
    test('file exists', () => {
        assert.ok(fs.existsSync(HTML), `index.html missing: ${HTML}`);
    });

    test('matches source file size', () => {
        const srcSize    = fs.statSync(path.join(__dirname, '../frontend/index.html')).size;
        const bundleSize = fs.statSync(HTML).size;
        assert.equal(bundleSize, srcSize,
            `Bundled index.html (${bundleSize}B) differs from source (${srcSize}B) — rebuild needed`);
    });

    test('contains output-content element', () => {
        const html = fs.readFileSync(HTML, 'utf8');
        assert.ok(html.includes('id="output-content"'),
            'index.html missing output-content element');
    });

    test('contains config-default-image-fit select (image fit setting)', () => {
        const html = fs.readFileSync(HTML, 'utf8');
        assert.ok(html.includes('config-default-image-fit'),
            'index.html missing config-default-image-fit — UI change not picked up by build');
    });
});

describe('Bundled frontend/app.js', () => {
    test('file exists', () => {
        assert.ok(fs.existsSync(JS), `app.js missing: ${JS}`);
    });

    test('matches source file size', () => {
        const srcSize    = fs.statSync(path.join(__dirname, '../frontend/app.js')).size;
        const bundleSize = fs.statSync(JS).size;
        assert.equal(bundleSize, srcSize,
            `Bundled app.js (${bundleSize}B) differs from source (${srcSize}B) — rebuild needed`);
    });

    test('contains switchOutputTab (tab switching logic)', () => {
        const js = fs.readFileSync(JS, 'utf8');
        assert.ok(js.includes('switchOutputTab'),
            'app.js missing switchOutputTab — JS change not picked up by build');
    });

    test('contains _renderOutputHistory (history tab renderer)', () => {
        const js = fs.readFileSync(JS, 'utf8');
        assert.ok(js.includes('_renderOutputHistory'),
            'app.js missing _renderOutputHistory');
    });

    test('contains defaultImageFit state (image fit config)', () => {
        const js = fs.readFileSync(JS, 'utf8');
        assert.ok(js.includes('defaultImageFit'),
            'app.js missing defaultImageFit state');
    });

    test('contains _attachmentItemHtml (thumbnail helper)', () => {
        const js = fs.readFileSync(JS, 'utf8');
        assert.ok(js.includes('_attachmentItemHtml'),
            'app.js missing _attachmentItemHtml — thumbnail feature not present');
    });
});
