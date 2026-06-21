'use strict';

/**
 * Recent files manager
 */
class RecentFilesManager {
    /**
     * @param {Object} storage - Storage instance
     * @param {number} maxFiles - Maximum number of recent files to keep
     */
    constructor(storage, maxFiles = 10) {
        this.storage = storage;
        this.maxFiles = maxFiles;
        this.files = [];
    }

    /**
     * Load recent files from storage
     */
    load() {
        this.files = this.storage.loadRecentFiles() || [];
        return this.files;
    }

    /**
     * Save current list to storage
     */
    save() {
        this.storage.saveRecentFiles(this.files);
    }

    /**
     * Add a file to recent files
     * @param {string} filePath - File path to add
     */
    add(filePath) {
        if (!filePath) return;

        this.files = this.files.filter(f => f !== filePath);
        this.files.unshift(filePath);

        if (this.files.length > this.maxFiles) {
            this.files.length = this.maxFiles;
        }

        this.save();
    }

    /**
     * Get the list of recent files
     * @param {number} limit - Max number to return (default: all)
     * @returns {string[]} Array of file paths
     */
    get(limit) {
        if (limit !== undefined) {
            return this.files.slice(0, limit);
        }
        return [...this.files];
    }

    /**
     * Clear all recent files
     */
    clear() {
        this.files = [];
        this.save();
    }

    /**
     * Remove a specific file from the list
     * @param {string} filePath - File path to remove
     */
    remove(filePath) {
        this.files = this.files.filter(f => f !== filePath);
        this.save();
    }
}

module.exports = { RecentFilesManager };
