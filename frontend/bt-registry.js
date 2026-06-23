class BtActionRegistry {
    constructor() {
        this._actions = new Map();
    }

    register(name, config) {
        if (this._actions.has(name)) {
            console.warn(`[BtRegistry] Overwriting action "${name}"`);
        }
        this._actions.set(name, config);
    }

    get(name) {
        return this._actions.get(name);
    }

    has(name) {
        return this._actions.has(name);
    }

    getAll() {
        return Array.from(this._actions.entries());
    }

    getAllNames() {
        return Array.from(this._actions.keys());
    }

    getLabel(name) {
        const a = this._actions.get(name);
        return a ? a.label : name;
    }
}

window.btActions = new BtActionRegistry();
