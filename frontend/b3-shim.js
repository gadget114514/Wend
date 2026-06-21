/**
 * Minimal b3 (behavior3js) shim for browser testing
 * Provides just the classes needed for our custom actions
 */

const b3 = {
    // Status constants
    Status: {
        SUCCESS: 1,
        FAILURE: 2,
        RUNNING: 3,
        ERROR: 4
    },

    // Base Node class
    Node: class Node {
        constructor(properties = {}) {
            this.id = properties.id;
            this.title = properties.title || 'Node';
            this.properties = properties;
        }
    },

    // Action base class
    Action: class Action {
        constructor(properties = {}) {
            this.id = properties.id;
            this.title = properties.title || 'Action';
            this.properties = properties;
            this.children = [];
        }

        tick(blackboard) {
            return b3.Status.SUCCESS;
        }
    },

    // Composite base class
    Composite: class Composite {
        constructor(properties = {}) {
            this.id = properties.id;
            this.title = properties.title || 'Composite';
            this.properties = properties;
            this.children = [];
        }

        tick(blackboard) {
            return b3.Status.SUCCESS;
        }
    },

    // Sequence: all children must succeed
    Sequence: class Sequence {
        constructor(properties = {}) {
            this.id = properties.id;
            this.title = properties.title || 'Sequence';
            this.properties = properties;
            this.children = [];
        }

        tick(blackboard) {
            for (const child of this.children) {
                const status = child.tick(blackboard);
                if (status !== b3.Status.SUCCESS) {
                    return status;
                }
            }
            return b3.Status.SUCCESS;
        }
    },

    // Selector: first child that succeeds wins
    Selector: class Selector {
        constructor(properties = {}) {
            this.id = properties.id;
            this.title = properties.title || 'Selector';
            this.properties = properties;
            this.children = [];
        }

        tick(blackboard) {
            for (const child of this.children) {
                const status = child.tick(blackboard);
                if (status !== b3.Status.FAILURE) {
                    return status;
                }
            }
            return b3.Status.FAILURE;
        }
    },

    // Parallel: run all children, return based on policy
    Parallel: class Parallel {
        constructor(properties = {}) {
            this.id = properties.id;
            this.title = properties.title || 'Parallel';
            this.properties = properties;
            this.children = [];
            this.policy = properties.policy || 'require_all';
        }

        tick(blackboard) {
            let successCount = 0;
            for (const child of this.children) {
                const status = child.tick(blackboard);
                if (status === b3.Status.SUCCESS) successCount++;
                if (status === b3.Status.RUNNING) {
                    return b3.Status.RUNNING;
                }
            }

            if (this.policy === 'require_one') {
                return successCount > 0 ? b3.Status.SUCCESS : b3.Status.FAILURE;
            }
            return successCount === this.children.length ? b3.Status.SUCCESS : b3.Status.FAILURE;
        }
    },

    // MemSequence: remembers which child to start from
    MemSequence: class MemSequence {
        constructor(properties = {}) {
            this.id = properties.id;
            this.title = properties.title || 'MemSequence';
            this.properties = properties;
            this.children = [];
            this._running = null;
        }

        tick(blackboard) {
            const index = this._running || 0;
            for (let i = index; i < this.children.length; i++) {
                const status = this.children[i].tick(blackboard);
                if (status !== b3.Status.SUCCESS) {
                    this._running = i;
                    return status;
                }
            }
            this._running = null;
            return b3.Status.SUCCESS;
        }
    },

    // MemSelector: remembers progress
    MemSelector: class MemSelector {
        constructor(properties = {}) {
            this.id = properties.id;
            this.title = properties.title || 'MemSelector';
            this.properties = properties;
            this.children = [];
            this._running = null;
        }

        tick(blackboard) {
            const index = this._running || 0;
            for (let i = index; i < this.children.length; i++) {
                const status = this.children[i].tick(blackboard);
                if (status !== b3.Status.FAILURE) {
                    this._running = i;
                    return status;
                }
            }
            this._running = null;
            return b3.Status.FAILURE;
        }
    },

    // Inverter decorator
    Inverter: class Inverter {
        constructor(properties = {}) {
            this.id = properties.id;
            this.title = properties.title || 'Inverter';
            this.properties = properties;
            this.child = null;
        }

        tick(blackboard) {
            if (!this.child) return b3.Status.FAILURE;
            const status = this.child.tick(blackboard);
            if (status === b3.Status.SUCCESS) return b3.Status.FAILURE;
            if (status === b3.Status.FAILURE) return b3.Status.SUCCESS;
            return status;
        }
    },

    // Repeater decorator
    Repeater: class Repeater {
        constructor(properties = {}) {
            this.id = properties.id;
            this.title = properties.title || 'Repeater';
            this.properties = properties;
            this.child = null;
            this.maxLoop = properties.maxLoop || 1;
            this._count = 0;
        }

        tick(blackboard) {
            if (!this.child) return b3.Status.FAILURE;

            while (this._count < this.maxLoop) {
                const status = this.child.tick(blackboard);
                if (status === b3.Status.RUNNING) {
                    return b3.Status.RUNNING;
                }
                this._count++;
            }

            this._count = 0;
            return b3.Status.SUCCESS;
        }
    },

    // Blackboard for storing variables
    Blackboard: class Blackboard {
        constructor() {
            this._data = {};
        }

        set(key, value) {
            this._data[key] = value;
        }

        get(key) {
            return this._data[key];
        }

        clear() {
            this._data = {};
        }

        getAll() {
            return this._data;
        }
    },

    // Tree
    Tree: class Tree {
        constructor(definition, nodes = []) {
            this.definition = definition;
            this.nodes = nodes;
            this.root = definition.root || definition;
        }

        tick(blackboard) {
            if (typeof this.root === 'object' && this.root.tick) {
                return this.root.tick(blackboard);
            }
            return b3.Status.FAILURE;
        }
    },

    VERSION: '3.0-shim'
};

// Make available globally
window.b3 = b3;
