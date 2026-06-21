'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Run blob garbage collection
 * @param {Object} storage - Storage instance
 * @returns {Object} Report: { deleted: string[], kept: string[], errors: string[] }
 */
function runBlobGC(storage) {
    const report = { deleted: [], kept: [], errors: [] };

    try {
        const blobsDir = path.join(storage.getBasePath(), 'blobs');
        if (!fs.existsSync(blobsDir)) {
            return report;
        }

        const allBlobs = fs.readdirSync(blobsDir);
        if (allBlobs.length === 0) {
            return report;
        }

        const referencedBlobs = collectReferencedBlobs(storage);

        for (const blob of allBlobs) {
            if (referencedBlobs.has(blob)) {
                report.kept.push(blob);
            } else {
                try {
                    storage.removeBlob(blob);
                    report.deleted.push(blob);
                } catch (e) {
                    report.errors.push({ blob, error: e.message });
                }
            }
        }
    } catch (e) {
        report.errors.push({ blob: '*', error: e.message });
    }

    return report;
}

/**
 * Collect all blob filenames referenced in data files and history
 * @param {Object} storage - Storage instance
 * @returns {Set<string>} Set of referenced blob filenames
 */
function collectReferencedBlobs(storage) {
    const referenced = new Set();

    try {
        const tabFiles = storage.getTabFiles();
        for (const tabFile of tabFiles) {
            try {
                const root = storage.loadTabData(tabFile);
                collectFromNode(root, referenced);
            } catch {}
        }
    } catch {}

    try {
        const historyDir = path.join(storage.getBasePath(), 'history');
        if (fs.existsSync(historyDir)) {
            const historyFiles = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
            for (const hf of historyFiles) {
                try {
                    const raw = storage.loadHistoryRecord(hf);
                    if (raw) {
                        const obj = JSON.parse(raw);
                        collectFromHistory(obj, referenced);
                    }
                } catch {}
            }
        }
    } catch {}

    return referenced;
}

/**
 * Recursively collect blob references from a node tree
 * @param {Object} node - Node object
 * @param {Set<string>} referenced - Set to populate
 */
function collectFromNode(node, referenced) {
    if (!node) return;

    if (Array.isArray(node.attachments)) {
        for (const att of node.attachments) {
            if (att.file) {
                referenced.add(att.file);
            }
        }
    }

    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            collectFromNode(child, referenced);
        }
    }
}

/**
 * Collect blob references from a history record
 * @param {Object} historyObj - History record object
 * @param {Set<string>} referenced - Set to populate
 */
function collectFromHistory(historyObj, referenced) {
    if (!historyObj || !Array.isArray(historyObj.steps)) return;

    for (const step of historyObj.steps) {
        if (Array.isArray(step.inputAttachments)) {
            for (const att of step.inputAttachments) {
                if (att.file) referenced.add(att.file);
            }
        }
        if (Array.isArray(step.outputAttachments)) {
            for (const att of step.outputAttachments) {
                if (att.file) referenced.add(att.file);
            }
        }
    }
}

module.exports = { runBlobGC };
