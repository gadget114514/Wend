/**
 * behavior3js Node Registry
 * Maps Wend node types to behavior3js node classes
 * Supports both basic nodes and pre-composed decorator+composite combinations
 */

class B3NodeRegistry {
    constructor() {
        this.nodes = new Map();
        this.composites = ['Sequence', 'Selector', 'Parallel', 'MemSequence', 'MemSelector'];
        this.decorators = ['Inverter', 'Repeater'];
        this.registerBuiltins();
    }

    registerBuiltins() {
        // Built-in composites
        this.register('Sequence', b3.Sequence);
        this.register('Selector', b3.Selector);
        this.register('Parallel', b3.Parallel);

        // Memory variants (remember progress)
        this.register('MemSequence', b3.MemSequence);
        this.register('MemSelector', b3.MemSelector);

        // Built-in decorators
        this.register('Inverter', b3.Inverter);
        this.register('Repeater', b3.Repeater);

        // Pre-composed decorator+composite combinations
        // RepeatSequence: Repeater wrapping Sequence
        this.register('RepeatSequence', this._createDecoratedComposite('Repeater', 'Sequence'));
        // RepeatSelector: Repeater wrapping Selector
        this.register('RepeatSelector', this._createDecoratedComposite('Repeater', 'Selector'));
        // RepeatMemSequence: Repeater wrapping MemSequence
        this.register('RepeatMemSequence', this._createDecoratedComposite('Repeater', 'MemSequence'));
        // RepeatMemSelector: Repeater wrapping MemSelector
        this.register('RepeatMemSelector', this._createDecoratedComposite('Repeater', 'MemSelector'));

        // Placeholder for custom actions (registered later)
        // this.register('ProcessPromptAction', ProcessPromptAction);
        // this.register('LoadLocalFileAction', LoadLocalFileAction);
    }

    /**
     * Create a pre-composed decorator+composite node
     * Returns a class that instantiates as the decorator with composite child
     * @private
     */
    _createDecoratedComposite(decoratorName, compositeName) {
        const registry = this;

        return class DecoratedComposite extends b3.Composite {
            constructor(properties) {
                // Initialize as composite (base class for decorator+composite)
                super(properties);
                this.decoratorName = decoratorName;
                this.compositeName = compositeName;
                this._properties = properties;
            }

            tick(blackboard) {
                // Lazy-initialize the actual decorated structure on first tick
                if (!this._initialized) {
                    this._initializeDecoratedStructure();
                    this._initialized = true;
                }

                // Delegate to the decorator's tick
                if (this._decoratorInstance) {
                    return this._decoratorInstance.tick(blackboard);
                }
                return b3.Status.FAILURE;
            }

            _initializeDecoratedStructure() {
                // Create the inner composite
                const CompositeClass = b3[this.compositeName];
                if (!CompositeClass) {
                    console.error(`Unknown composite type: ${this.compositeName}`);
                    return;
                }

                const composite = new CompositeClass(this._properties);

                // Transfer children to the composite
                if (this.children && this.children.length > 0) {
                    composite.children = this.children;
                }

                // Create the decorator
                const DecoratorClass = b3[this.decoratorName];
                if (!DecoratorClass) {
                    console.error(`Unknown decorator type: ${this.decoratorName}`);
                    return;
                }

                const decorator = new DecoratorClass(this._properties);
                decorator.child = composite;

                // Store reference to decorator for tick delegation
                this._decoratorInstance = decorator;
            }
        };
    }

    register(name, nodeClass) {
        this.nodes.set(name, nodeClass);
    }

    get(name) {
        return this.nodes.get(name);
    }

    has(name) {
        return this.nodes.has(name);
    }

    getAll() {
        return this.nodes;
    }

    /**
     * Check if a node type is a composite
     */
    isComposite(nodeName) {
        return this.composites.includes(nodeName) ||
               nodeName.startsWith('Repeat') ||
               nodeName.startsWith('Mem');
    }

    /**
     * Check if a node type is a decorator
     */
    isDecorator(nodeName) {
        return this.decorators.includes(nodeName);
    }

    /**
     * Get base composite for a pre-composed node
     * e.g., 'RepeatSequence' -> 'Sequence'
     */
    getBaseComposite(nodeName) {
        if (nodeName === 'RepeatSequence') return 'Sequence';
        if (nodeName === 'RepeatSelector') return 'Selector';
        if (nodeName === 'RepeatMemSequence') return 'MemSequence';
        if (nodeName === 'RepeatMemSelector') return 'MemSelector';
        return null;
    }

    /**
     * Get decorator for a pre-composed node
     * e.g., 'RepeatSequence' -> 'Repeater'
     */
    getDecorator(nodeName) {
        if (nodeName.startsWith('Repeat')) return 'Repeater';
        return null;
    }
}

// Global registry instance
const b3NodeRegistry = new B3NodeRegistry();
