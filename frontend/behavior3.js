'use strict';

const PREFIX_PRIVATE = "__PRIVATE_VAR";
const PREFIX_TEMP = "__TEMP_VAR";
class Blackboard {
    _values = {};
    _tree;
    constructor(tree) {
        this._tree = tree;
    }
    get values() {
        return this._values;
    }
    eval(code) {
        return this._tree.context.compileCode(code)(this._values);
    }
    get(k) {
        if (k) {
            return this._values[k];
        }
        else {
            return undefined;
        }
    }
    set(k, v) {
        if (k) {
            if (v === undefined || v === null) {
                delete this._values[k];
            }
            else {
                this._values[k] = v;
            }
        }
    }
    clear() {
        this._values = {};
    }
    static makePrivateVar(node, k) {
        if (typeof node === "string") {
            return `${PREFIX_PRIVATE}_${node}`;
        }
        else {
            return `${PREFIX_PRIVATE}_NODE#${node.id}_${k}`;
        }
    }
    static isPrivateVar(k) {
        return k.startsWith(PREFIX_PRIVATE);
    }
    static makeTempVar(node, k) {
        return `${PREFIX_TEMP}_NODE#${node.id}_${k}`;
    }
    static isTempVar(k) {
        return k.startsWith(PREFIX_TEMP);
    }
}

// prettier-ignore
var TokenType;
(function (TokenType) {
    TokenType[TokenType["NUMBER"] = 0] = "NUMBER";
    TokenType[TokenType["STRING"] = 1] = "STRING";
    TokenType[TokenType["BOOLEAN"] = 2] = "BOOLEAN";
    TokenType[TokenType["NEGATION"] = 3] = "NEGATION";
    TokenType[TokenType["POSITIVE"] = 4] = "POSITIVE";
    TokenType[TokenType["DOT"] = 5] = "DOT";
    TokenType[TokenType["NOT"] = 6] = "NOT";
    TokenType[TokenType["BNOT"] = 7] = "BNOT";
    TokenType[TokenType["GT"] = 8] = "GT";
    TokenType[TokenType["GE"] = 9] = "GE";
    TokenType[TokenType["EQ"] = 10] = "EQ";
    TokenType[TokenType["NEQ"] = 11] = "NEQ";
    TokenType[TokenType["LT"] = 12] = "LT";
    TokenType[TokenType["LE"] = 13] = "LE";
    TokenType[TokenType["ADD"] = 14] = "ADD";
    TokenType[TokenType["SUB"] = 15] = "SUB";
    TokenType[TokenType["MUL"] = 16] = "MUL";
    TokenType[TokenType["DIV"] = 17] = "DIV";
    TokenType[TokenType["MOD"] = 18] = "MOD";
    TokenType[TokenType["QUESTION"] = 19] = "QUESTION";
    TokenType[TokenType["COLON"] = 20] = "COLON";
    TokenType[TokenType["AND"] = 21] = "AND";
    TokenType[TokenType["OR"] = 22] = "OR";
    TokenType[TokenType["BAND"] = 23] = "BAND";
    TokenType[TokenType["BOR"] = 24] = "BOR";
    TokenType[TokenType["BXOR"] = 25] = "BXOR";
    TokenType[TokenType["SHL"] = 26] = "SHL";
    TokenType[TokenType["SHR"] = 27] = "SHR";
    TokenType[TokenType["SHRU"] = 28] = "SHRU";
    TokenType[TokenType["SQUARE_BRACKET"] = 29] = "SQUARE_BRACKET";
    TokenType[TokenType["PARENTHESIS"] = 30] = "PARENTHESIS";
})(TokenType || (TokenType = {}));
const OP_REGEX = /^(<<|>>>|>>|>=|<=|==|!=|>|<|&&|&|\|\||[-+*%!?/:.|^()[\]])/;
const NUMBER_REGEX = /^(\d+\.\d+|\d+)/;
const WORD_REGEX = /^(\w+)/;
class ExpressionEvaluator {
    _postfix;
    _args = null;
    _expr;
    constructor(expression) {
        this._expr = expression;
        this._postfix = this._convertToPostfix(this._parse(this._expr));
    }
    _parse(expr) {
        const tokens = [];
        while (expr.length) {
            const char = expr[0];
            let token = null;
            // string literal: 'xxx' or "xxx"
            if (char === "'" || char === '"') {
                const quote = char;
                let end = 1;
                while (end < expr.length && expr[end] !== quote) {
                    end++;
                }
                if (end >= expr.length) {
                    throw new Error(`invalid expression: '${expr}' in '${this._expr}'`);
                }
                const literal = expr.slice(0, end + 1);
                tokens.push(literal);
                expr = expr.slice(end + 1).replace(/^\s+/, "");
                continue;
            }
            if (/^\d/.test(char)) {
                token = expr.match(NUMBER_REGEX);
            }
            else if (/^\w/.test(char)) {
                token = expr.match(WORD_REGEX);
            }
            else if (/^[-+*%/()<>=?&|:^.![\]]/.test(char)) {
                token = expr.match(OP_REGEX);
            }
            if (!token) {
                throw new Error(`invalid expression: '${expr}' in '${this._expr}'`);
            }
            tokens.push(token[1]);
            expr = expr.slice(token[1].length).replace(/^\s+/, "");
        }
        return tokens;
    }
    evaluate(args) {
        const stack = [];
        this._args = args;
        for (const token of this._postfix) {
            const type = token.type;
            if (type === TokenType.NUMBER ||
                type === TokenType.BOOLEAN ||
                type === TokenType.STRING) {
                stack.push(token.value);
            }
            else if (type === TokenType.QUESTION) {
                const condition = stack.pop();
                const trueValue = stack.pop();
                const falseValue = stack.pop();
                stack.push(this._toValue(condition, false) ? trueValue : falseValue);
            }
            else if (type === TokenType.POSITIVE) {
                stack.push(this._toValue(stack.pop(), false));
            }
            else if (type === TokenType.NEGATION) {
                stack.push(-this._toValue(stack.pop(), false));
            }
            else if (type === TokenType.NOT) {
                stack.push(!this._toValue(stack.pop(), false));
            }
            else if (type === TokenType.BNOT) {
                stack.push(~this._toValue(stack.pop(), false));
            }
            else {
                const b = stack.pop();
                const a = stack.pop();
                switch (type) {
                    case TokenType.DOT: {
                        const obj = this._toObject(a);
                        stack.push(this._toValue(obj[b]));
                        break;
                    }
                    case TokenType.SQUARE_BRACKET: {
                        const obj = this._toObject(a);
                        const index = this._toValue(b);
                        stack.push(this._toObject(obj[index]));
                        break;
                    }
                    case TokenType.GT:
                        stack.push(this._toValue(a) > this._toValue(b));
                        break;
                    case TokenType.GE:
                        stack.push(this._toValue(a) >= this._toValue(b));
                        break;
                    case TokenType.EQ:
                        stack.push(this._toValue(a, false) === this._toValue(b, false));
                        break;
                    case TokenType.NEQ:
                        stack.push(this._toValue(a, false) !== this._toValue(b, false));
                        break;
                    case TokenType.LT:
                        stack.push(this._toValue(a) < this._toValue(b));
                        break;
                    case TokenType.LE:
                        stack.push(this._toValue(a) <= this._toValue(b));
                        break;
                    case TokenType.ADD:
                        stack.push(this._toValue(a) + this._toValue(b));
                        break;
                    case TokenType.SUB:
                        stack.push(this._toValue(a) - this._toValue(b));
                        break;
                    case TokenType.MUL:
                        stack.push(this._toValue(a) * this._toValue(b));
                        break;
                    case TokenType.DIV:
                        stack.push(this._toValue(a) / this._toValue(b));
                        break;
                    case TokenType.MOD:
                        stack.push(this._toValue(a) % this._toValue(b));
                        break;
                    case TokenType.COLON: {
                        stack.push(this._toValue(a));
                        stack.push(this._toValue(b));
                        break;
                    }
                    case TokenType.SHL:
                        stack.push(this._toValue(a) << this._toValue(b));
                        break;
                    case TokenType.SHR:
                        stack.push(this._toValue(a) >> this._toValue(b));
                        break;
                    case TokenType.SHRU:
                        stack.push(this._toValue(a) >>> this._toValue(b));
                        break;
                    case TokenType.BAND:
                        stack.push(this._toValue(a) & this._toValue(b));
                        break;
                    case TokenType.BOR:
                        stack.push(this._toValue(a) | this._toValue(b));
                        break;
                    case TokenType.BXOR:
                        stack.push(this._toValue(a) ^ this._toValue(b));
                        break;
                    case TokenType.AND:
                        stack.push(this._toValue(a) && this._toValue(b));
                        break;
                    case TokenType.OR:
                        stack.push(this._toValue(a) || this._toValue(b));
                        break;
                    default:
                        throw new Error(`unsupport operator: ${token.value}`);
                }
            }
        }
        this._args = null;
        return stack.pop();
    }
    _toObject(token) {
        if (typeof token === "string") {
            const obj = this._args?.[token];
            if (typeof obj === "object") {
                return obj;
            }
            else {
                throw new Error(`value indexed by '${token}' is not a object`);
            }
        }
        else {
            return token;
        }
    }
    _toValue(token, isNumber = true) {
        const type = typeof token;
        if (type === "number" || type === "boolean" || token === null) {
            return token;
        }
        else if (typeof token === "string") {
            // string literal like 'success' or "ok"
            const literalMatch = token.match(/^(['"])(.*)\1$/);
            if (literalMatch) {
                const literal = literalMatch[2];
                if (isNumber) {
                    throw new Error(`value indexed by '${token}' is not a number'`);
                }
                return literal;
            }
            const value = this._args?.[token];
            if (value === undefined) {
                throw new Error(`value indexed by '${token}' is not found`);
            }
            else if (isNumber && typeof value !== "number") {
                throw new Error(`value indexed by '${token}' is not a number'`);
            }
            return value;
        }
        else {
            throw new Error(`token '${token}' type not support!`);
        }
    }
    _makeToken(symbol, last) {
        if (symbol === "-" || symbol === "+") {
            if (last === undefined || /^[-+*%<>=!&~^?:(|[]+$/.test(last)) {
                return {
                    type: symbol === "-" ? TokenType.NEGATION : TokenType.POSITIVE,
                    precedence: 15,
                    value: `${symbol}N`,
                };
            }
        }
        // string literal: keep the quotes in value so we can distinguish literals
        if ((symbol.startsWith("'") && symbol.endsWith("'")) ||
            (symbol.startsWith('"') && symbol.endsWith('"'))) {
            return { type: TokenType.STRING, precedence: 0, value: symbol };
        }
        if (NUMBER_REGEX.test(symbol)) {
            return { type: TokenType.NUMBER, precedence: 0, value: parseFloat(symbol) };
        }
        if (symbol === "true" || symbol === "false") {
            return { type: TokenType.BOOLEAN, precedence: 0, value: symbol === "true" };
        }
        if (WORD_REGEX.test(symbol)) {
            return { type: TokenType.STRING, precedence: 0, value: symbol };
        }
        if (symbol === ".") {
            return { type: TokenType.DOT, precedence: 18, value: symbol };
        }
        if (symbol === "(" || symbol === ")") {
            // parenthesis is not a operator
            return { type: TokenType.PARENTHESIS, precedence: 0, value: symbol };
        }
        if (symbol === "[" || symbol === "]") {
            return { type: TokenType.SQUARE_BRACKET, precedence: 18, value: symbol };
        }
        if (symbol === "!") {
            return { type: TokenType.NOT, precedence: 15, value: symbol };
        }
        if (symbol === "~") {
            return { type: TokenType.BNOT, precedence: 15, value: symbol };
        }
        if (symbol === "%") {
            return { type: TokenType.MOD, precedence: 13, value: symbol };
        }
        if (symbol === "*") {
            return { type: TokenType.MUL, precedence: 13, value: symbol };
        }
        if (symbol === "/") {
            return { type: TokenType.DIV, precedence: 13, value: symbol };
        }
        if (symbol === "+") {
            return { type: TokenType.ADD, precedence: 12, value: symbol };
        }
        if (symbol === "-") {
            return { type: TokenType.SUB, precedence: 12, value: symbol };
        }
        if (symbol === "<<") {
            return { type: TokenType.SHL, precedence: 11, value: symbol };
        }
        if (symbol === ">>") {
            return { type: TokenType.SHR, precedence: 11, value: symbol };
        }
        if (symbol === ">>>") {
            return { type: TokenType.SHRU, precedence: 11, value: symbol };
        }
        if (symbol === ">") {
            return { type: TokenType.GT, precedence: 10, value: symbol };
        }
        if (symbol === ">=") {
            return { type: TokenType.GE, precedence: 10, value: symbol };
        }
        if (symbol === "<") {
            return { type: TokenType.LT, precedence: 10, value: symbol };
        }
        if (symbol === "<=") {
            return { type: TokenType.LE, precedence: 10, value: symbol };
        }
        if (symbol === "==") {
            return { type: TokenType.EQ, precedence: 9, value: symbol };
        }
        if (symbol === "!=") {
            return { type: TokenType.NEQ, precedence: 9, value: symbol };
        }
        if (symbol === "&") {
            return { type: TokenType.BAND, precedence: 8, value: symbol };
        }
        if (symbol === "&") {
            return { type: TokenType.BXOR, precedence: 7, value: symbol };
        }
        if (symbol === "|") {
            return { type: TokenType.BOR, precedence: 6, value: symbol };
        }
        if (symbol === "&&") {
            return { type: TokenType.AND, precedence: 5, value: symbol };
        }
        if (symbol === "||") {
            return { type: TokenType.OR, precedence: 4, value: symbol };
        }
        if (symbol === ":") {
            return { type: TokenType.COLON, precedence: 2, value: symbol };
        }
        if (symbol === "?") {
            return { type: TokenType.QUESTION, precedence: 2 - 0.1, value: symbol };
        }
        throw new Error(`unsupport token: ${symbol}`);
    }
    _convertToPostfix(infix) {
        const output = [];
        const operators = [];
        for (let i = 0; i < infix.length; i++) {
            const token = this._makeToken(infix[i], infix[i - 1]);
            if (token.type === TokenType.NUMBER ||
                token.type === TokenType.BOOLEAN ||
                token.type === TokenType.STRING) {
                output.push(token);
            }
            else if (token.value === "(" || token.value === "[") {
                operators.push(token);
            }
            else if (token.value === ")" || token.value === "]") {
                while (operators.length &&
                    operators[operators.length - 1].value !== "(" &&
                    operators[operators.length - 1].value !== "[") {
                    output.push(operators.pop());
                }
                const last = operators[operators.length - 1];
                if (token.value === ")" && last.value !== "(") {
                    throw new Error("unmatched parentheses: '('");
                }
                else if (token.value === "]" && last.value !== "[") {
                    throw new Error("unmatched parentheses: '['");
                }
                if (token.value === "]") {
                    output.push(operators.pop());
                }
                else {
                    operators.pop();
                }
            }
            else {
                while (operators.length &&
                    token.precedence <= operators[operators.length - 1].precedence) {
                    output.push(operators.pop());
                }
                operators.push(token);
            }
        }
        while (operators.length) {
            output.push(operators.pop());
        }
        return output;
    }
    /**
     * Performs a dry run of the expression evaluation to check if it is syntactically valid.
     * Does not actually evaluate values, just verifies operator/operand counts and structure.
     * @returns true if expression is valid, false if invalid
     */
    dryRun() {
        const stack = [];
        try {
            for (const token of this._postfix) {
                const type = token.type;
                if (type === TokenType.NUMBER ||
                    type === TokenType.BOOLEAN ||
                    type === TokenType.STRING) {
                    stack.push(token);
                }
                else if (type === TokenType.QUESTION) {
                    if (stack.length < 3) {
                        console.error(`not enough operands for ternary operator: ${token.value}`);
                        return false;
                    }
                    stack.pop();
                    stack.pop();
                }
                else if (type === TokenType.POSITIVE ||
                    type === TokenType.NEGATION ||
                    type === TokenType.NOT ||
                    type === TokenType.BNOT) {
                    if (stack.length < 1) {
                        console.error(`not enough operands for unary operator: ${token.value}`);
                        return false;
                    }
                }
                else {
                    if (stack.length < 2) {
                        console.error(`not enough operands for binary operator: ${token.value}`);
                        return false;
                    }
                    const b = stack.pop(); // b
                    const a = stack.pop(); // a
                    stack.push(a);
                    if (type === TokenType.DOT) {
                        if (a.type !== TokenType.STRING || b.type !== TokenType.STRING) {
                            console.error(`invalid operands for dot operator: ${a.value} and ${b.value}`);
                            return false;
                        }
                    }
                    else if (type === TokenType.COLON) {
                        stack.push(b);
                    }
                }
            }
            if (stack.length !== 1) {
                console.error(`invalid number of operands remaining: ${stack.map((t) => t.value).join(", ")}`);
            }
            return stack.length === 1;
        }
        catch {
            return false;
        }
    }
}

class Node {
    args = {};
    input = [];
    output = [];
    _context;
    _parent = null;
    _children = [];
    _cfg;
    _yield;
    _stringifiedArgs;
    constructor(context, cfg) {
        this._context = context;
        this._cfg = cfg;
        Object.keys(cfg.args).forEach((k) => {
            const value = cfg.args[k];
            if (value && typeof value === "object") {
                this._stringifiedArgs = this._stringifiedArgs ?? {};
                this._stringifiedArgs[k] = JSON.stringify(value);
            }
            else {
                this.args[k] = value;
            }
        });
        for (const childCfg of cfg.children) {
            if (!childCfg.disabled) {
                const child = Node.create(context, childCfg);
                child._parent = this;
                this._children.push(child);
            }
        }
    }
    /** @private */
    get __yield() {
        return (this._yield ||= Blackboard.makeTempVar(this, "YIELD"));
    }
    get cfg() {
        return this._cfg;
    }
    get id() {
        return this.cfg.id;
    }
    get name() {
        return this.cfg.name;
    }
    get parent() {
        return this._parent;
    }
    get children() {
        return this._children;
    }
    tick(tree) {
        const { stack, blackboard } = tree;
        const { cfg, input, output, args } = this;
        if (stack.top() !== this) {
            stack.push(this);
        }
        input.length = 0;
        output.length = 0;
        cfg.input.forEach((k, i) => (input[i] = blackboard.get(k)));
        if (this._stringifiedArgs) {
            for (const k in this._stringifiedArgs) {
                args[k] = JSON.parse(this._stringifiedArgs[k]);
            }
        }
        tree.__runningNode = this;
        let status = "failure";
        try {
            status = this.onTick(tree, tree.__lastStatus);
        }
        catch (e) {
            if (e instanceof Error) {
                this.error(`${e.message}\n ${e.stack}`);
            }
            else {
                console.error(e);
            }
            tree.interrupt();
        }
        if (tree.__interrupted) {
            return "running";
        }
        else if (status !== "running") {
            cfg.output.forEach((k, i) => blackboard.set(k, output[i]));
            stack.pop();
        }
        else if (blackboard.get(this.__yield) === undefined) {
            blackboard.set(this.__yield, true);
        }
        tree.__lastStatus = status;
        if (cfg.debug || tree.debug) {
            let varStr = "";
            for (const k in blackboard.values) {
                if (!(Blackboard.isTempVar(k) || Blackboard.isPrivateVar(k))) {
                    varStr += `${k}:${blackboard.values[k]}, `;
                }
            }
            const indent = tree.debug ? " ".repeat(stack.length) : "";
            console.info(`[DEBUG] behavior3 -> ${indent}${this.name}: tree:${this.cfg.tree.name} tree_id:${tree.id}, ` +
                `node:${this.id}, status:${status}, values:{${varStr}} args:${JSON.stringify(cfg.args)}`);
        }
        return status;
    }
    assert(condition, msg) {
        if (!condition) {
            this.throw(msg);
        }
    }
    /**
     * throw an error
     */
    throw(msg) {
        throw new Error(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }
    /**
     * use console.error to print error message
     */
    error(msg) {
        console.error(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }
    /**
     * use console.warn to print warning message
     */
    warn(msg) {
        console.warn(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }
    /**
     * use console.debug to print debug message
     */
    debug(msg) {
        console.debug(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }
    /**
     * use console.info to print info message
     */
    info(msg) {
        console.info(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }
    /**
     * use console.log to print log message
     */
    log(msg) {
        console.log(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }
    _checkOneof(inputIndex, argValue, defaultValue) {
        const inputValue = this.input[inputIndex];
        const inputName = this.cfg.input[inputIndex];
        let value;
        if (inputName) {
            if (inputValue === undefined) {
                const func = defaultValue === undefined ? this.throw : this.warn;
                func.call(this, `missing input '${inputName}'`);
            }
            value = inputValue;
        }
        else {
            value = argValue;
        }
        return (value ?? defaultValue);
    }
    static get descriptor() {
        throw new Error(`descriptor not found in '${this.name}'`);
    }
    static create(context, cfg) {
        const NodeCls = context.nodeCtors[cfg.name];
        const descriptor = context.nodeDefs[cfg.name];
        if (!NodeCls || !descriptor) {
            throw new Error(`behavior3: node '${cfg.tree.name}->${cfg.name}' is not registered`);
        }
        const node = new NodeCls(context, cfg);
        if (node.tick !== Node.prototype.tick) {
            throw new Error("don't override 'tick' function");
        }
        if (descriptor.children !== undefined &&
            descriptor.children !== -1 &&
            descriptor.children !== node.children.length) {
            if (descriptor.children === 0) {
                node.warn(`no children is required`);
            }
            else if (node.children.length < descriptor.children) {
                node.throw(`at least ${descriptor.children} children are required`);
            }
            else {
                node.warn(`exactly ${descriptor.children} children`);
            }
        }
        return node;
    }
}

const nodeClasses = new Map();
function registerNode(cls) {
    const descriptor = cls.descriptor;
    if (nodeClasses.has(descriptor.name)) {
        throw new Error(`node ${descriptor.name} already registered`);
    }
    if (descriptor.doc) {
        let doc = descriptor.doc.replace(/^[\r\n]+/, "");
        const leadingSpace = doc.match(/^ */)?.[0];
        if (leadingSpace) {
            doc = doc
                .substring(leadingSpace.length)
                .replace(new RegExp(`[\r\n]${leadingSpace}`, "g"), "\n")
                .replace(/ +$/, "");
        }
        descriptor.doc = doc;
    }
    nodeClasses.set(descriptor.name, {
        ctor: cls,
        descriptor: descriptor,
    });
}
function getNodeDescriptors() {
    return Array.from(nodeClasses.values()).map((v) => v.descriptor);
}
function filterNodeDescriptors(groupTypes) {
    return Array.from(nodeClasses.values()).filter(({ descriptor }) => !descriptor.group?.length ||
        descriptor.group?.some((g) => groupTypes.indexOf(g) >= 0));
}

class Context {
    nodeDefs = {};
    nodeCtors = {};
    trees = {};
    _time = 0;
    _evaluators = {};
    _timers = [];
    _listeners = new Map();
    constructor() {
        filterNodeDescriptors(this.supportGroupTypes).forEach((v) => {
            this.registerNode(v.ctor);
        });
    }
    get time() {
        return this._time;
    }
    get supportGroupTypes() {
        return [];
    }
    /**
     * Schedules a callback to be executed after a specified delay, same callback will be replaced.
     *
     * @param time The delay in seconds before the callback is executed
     * @param callback The function to call after the delay
     * @param tag The tag used to identify which timers to remove
     */
    delay(time, callback, tag) {
        const expired = time + this._time;
        const timers = this._timers;
        let idx = timers.findIndex((v) => v.callback === callback);
        if (idx >= 0) {
            timers.splice(idx, 1);
        }
        idx = timers.findIndex((v) => v.expired > expired);
        if (idx >= 0) {
            timers.splice(idx, 0, { callback, tag, expired });
        }
        else {
            timers.push({ callback, tag, expired });
        }
    }
    update(dt) {
        this._time += dt;
        const timers = this._timers;
        while (timers.length > 0) {
            if (timers[0].expired <= this._time) {
                const { callback } = timers.shift();
                callback();
            }
            else {
                break;
            }
        }
    }
    on(event, callbackOrTarget, tagOrCallback, tag) {
        let target;
        let callback;
        if (typeof callbackOrTarget === "function") {
            callback = callbackOrTarget;
            tag = tagOrCallback;
            target = this;
        }
        else {
            target = callbackOrTarget;
            callback = tagOrCallback;
        }
        let listeners = this._listeners.get(event);
        if (!listeners) {
            listeners = new Map();
            this._listeners.set(event, listeners);
        }
        let targetListeners = listeners.get(target);
        if (!targetListeners) {
            targetListeners = new Map();
            listeners.set(target, targetListeners);
        }
        targetListeners.set(callback, tag);
    }
    /**
     * Dispatches an event to all listeners registered for the specified event.
     * If a target is provided, only listeners registered for that target will be notified.
     * Otherwise, listeners registered for the context(default target) will be notified.
     *
     * @param event The event name to dispatch
     * @param target Optional target object that the event is associated with
     * @param args Additional arguments to pass to the event listeners
     */
    dispatch(event, target, ...args) {
        this._listeners
            .get(event)
            ?.get(target ?? this)
            ?.forEach((_, callback) => {
            callback(...args);
        });
    }
    /**
     * Removes all listeners for the specified event that match the given tag.
     *
     * @param event The event name to remove listeners from
     * @param tag The tag used to identify which listeners to remove
     */
    off(event, tag) {
        this._listeners.get(event)?.forEach((targetListeners, target, listeners) => {
            targetListeners.forEach((value, key) => {
                if (value === tag) {
                    targetListeners.delete(key);
                }
            });
            if (targetListeners.size === 0) {
                listeners.delete(target);
            }
        });
    }
    /**
     * Removes all listeners for the specified tag from the context.
     * This includes both event listeners and timers.
     *
     * @param tag The tag used to identify which listeners to remove
     */
    offAll(tag) {
        this._listeners.forEach((listeners) => {
            listeners.forEach((targetListeners, target) => {
                targetListeners.forEach((value, key) => {
                    if (value === tag) {
                        targetListeners.delete(key);
                    }
                });
                if (targetListeners.size === 0) {
                    listeners.delete(target);
                }
            });
        });
        const timers = this._timers;
        for (let i = timers.length - 1; i >= 0; i--) {
            if (timers[i].tag === tag) {
                timers.splice(i, 1);
            }
        }
    }
    compileCode(code) {
        let evaluator = this._evaluators[code];
        if (!evaluator) {
            const expr = new ExpressionEvaluator(code);
            if (!expr.dryRun()) {
                throw new Error(`invalid expression: ${code}`);
            }
            evaluator = (envars) => expr.evaluate(envars);
            this._evaluators[code] = evaluator;
        }
        return evaluator;
    }
    registerCode(code, evaluator) {
        this._evaluators[code] = evaluator;
    }
    registerNode(cls) {
        const descriptor = cls.descriptor;
        if (descriptor.doc) {
            let doc = descriptor.doc.replace(/^[\r\n]+/, "");
            const leadingSpace = doc.match(/^ */)?.[0];
            if (leadingSpace) {
                doc = doc
                    .substring(leadingSpace.length)
                    .replace(new RegExp(`[\r\n]${leadingSpace}`, "g"), "\n")
                    .replace(/ +$/, "");
            }
            descriptor.doc = doc;
        }
        this.nodeDefs[descriptor.name] = descriptor;
        this.nodeCtors[descriptor.name] = cls;
    }
    _createTree(treeCfg) {
        const traverse = (cfg) => {
            cfg.tree = treeCfg;
            cfg.input ||= [];
            cfg.output ||= [];
            cfg.children ||= [];
            cfg.args ||= {};
            cfg.children.forEach(traverse);
        };
        traverse(treeCfg.root);
        return Node.create(this, treeCfg.root);
    }
}

class StackSlice {
    _nodes = [];
    get length() {
        return this._nodes.length;
    }
    move(dest, start) {
        const count = this._nodes.length - start;
        dest._nodes.push(...this._nodes.splice(start, count));
    }
    clear() {
        this._nodes.length = 0;
    }
}
class Stack extends StackSlice {
    _tree;
    constructor(tree) {
        super();
        this._tree = tree;
    }
    top() {
        const nodes = this._nodes;
        return nodes[nodes.length - 1];
    }
    push(node) {
        this._nodes.push(node);
    }
    pop() {
        const node = this._nodes.pop();
        if (node) {
            this._tree.blackboard.set(node.__yield, undefined);
        }
        return node;
    }
    popTo(index) {
        while (this._nodes.length > index) {
            this.pop();
        }
    }
    clear() {
        this.popTo(0);
    }
}

let treeId = 0;
class Tree {
    context;
    path;
    blackboard;
    stack;
    id = ++treeId;
    debug = false;
    _ticking = false;
    _owner;
    /** @private */
    __lastStatus = "success";
    /** @private */
    __runningNode = undefined;
    /** @private */
    __interrupted = false;
    _root;
    _status = "success";
    constructor(context, owner, path) {
        this.context = context;
        this.path = path;
        this.blackboard = new Blackboard(this);
        this.stack = new Stack(this);
        this.context.loadTree(this.path);
        this._owner = owner;
    }
    get owner() {
        return this._owner;
    }
    get root() {
        return (this._root ||= this.context.trees[this.path]);
    }
    get ready() {
        return !!this.root;
    }
    get status() {
        return this._status;
    }
    get ticking() {
        return this._ticking;
    }
    get runningNode() {
        return this.__runningNode;
    }
    clear() {
        // force run clear
        const interrupted = this.__interrupted;
        this.__interrupted = false;
        this.context.dispatch("treeCleaned" /* TreeEvent.CLEANED */, this);
        this.__interrupted = interrupted;
        this.interrupt();
        this.debug = false;
        this.__interrupted = false;
        this._status = "success";
        this.stack.clear();
        this.blackboard.clear();
        this.context.offAll(this);
    }
    interrupt() {
        if (this._status === "running" || this._ticking) {
            this.context.dispatch("treeInterrupted" /* TreeEvent.INTERRUPTED */, this);
            this.__interrupted = true;
            if (!this._ticking) {
                this._doInterrupt();
            }
        }
    }
    yield(node, value) {
        this.blackboard.set(node.__yield, value ?? true);
        return "running";
    }
    resume(node) {
        return this.blackboard.get(node.__yield);
    }
    tick() {
        const { context, stack, root } = this;
        if (!root) {
            return "failure";
        }
        if (this.debug) {
            console.debug(`---------------- debug ai: ${this.path} --------------------`);
        }
        if (this._ticking) {
            const node = stack.top();
            throw new Error(`tree '${this.path}' already ticking: ${node?.name}#${node?.id}`);
        }
        this._ticking = true;
        let status = "failure";
        if (stack.length > 0) {
            let node = stack.top();
            while (node) {
                status = node.tick(this);
                if (status === "running") {
                    break;
                }
                else {
                    node = stack.top();
                }
            }
        }
        else {
            context.dispatch("treeBeforeTicked" /* TreeEvent.BEFORE_TICKED */, this);
            status = root.tick(this);
        }
        if (status === "success") {
            this.__runningNode = undefined;
            this._status = "success";
            context.dispatch("treeAfterTicked" /* TreeEvent.AFTER_TICKED */, this);
            context.dispatch("treeTickedSuccess" /* TreeEvent.TICKED_SUCCESS */, this);
        }
        else if (status === "failure" || status === "error") {
            this._status = "failure";
            this.__runningNode = undefined;
            context.dispatch("treeAfterTicked" /* TreeEvent.AFTER_TICKED */, this);
            context.dispatch("treeTickedFailure" /* TreeEvent.TICKED_FAILURE */, this);
        }
        else {
            this._status = "running";
        }
        if (this.__interrupted) {
            this._doInterrupt();
        }
        this._ticking = false;
        return this._status;
    }
    _doInterrupt() {
        const values = this.blackboard.values;
        this._status = "interrupted";
        this.stack.clear();
        for (const key in values) {
            if (Blackboard.isTempVar(key)) {
                delete values[key];
            }
        }
        this.__interrupted = false;
    }
}

@registerNode
class Calculate extends Node {
    constructor(context, cfg) {
        super(context, cfg);
        if (typeof this.args.value !== "string" || this.args.value.length === 0) {
            this.throw(`args.value is not a expr string`);
        }
        context.compileCode(this.args.value);
    }
    onTick(tree, status) {
        const value = tree.blackboard.eval(this.args.value);
        this.output.push(value);
        return "success";
    }
    static get descriptor() {
        return {
            name: "Calculate",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "简单的数值公式计算",
            args: [{ name: "value", type: "expr", desc: "计算公式" }],
            output: ["计算结果"],
            doc: `
                + 做简单的数值公式计算，返回结果到输出
            `,
        };
    }
}

@registerNode
class Concat extends Node {
    onTick(tree, status) {
        const [arr1, arr2] = this.input;
        if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
            this.error(`invalid array: ${arr1} or ${arr2}`);
            return "error";
        }
        this.output.push(arr1.concat(arr2));
        return "success";
    }
    static get descriptor() {
        return {
            name: "Concat",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "将两个输入合并为一个数组，并返回新数组",
            input: ["数组1", "数组2"],
            output: ["新数组"],
            doc: `
                + 如果输入不是数组，则返回 \`failure\`
            `,
        };
    }
}

@registerNode
class GetField extends Node {
    onTick(tree, status) {
        const [obj] = this.input;
        if (typeof obj !== "object" || !obj) {
            this.error(`invalid object: ${obj}`);
            return "error";
        }
        const args = this.args;
        const field = this._checkOneof(1, args.field);
        const value = obj[field];
        if (typeof field !== "string" && typeof field !== "number") {
            this.error(`invalid field: ${field}`);
            return "error";
        }
        else if (value !== undefined && value !== null) {
            this.output.push(value);
            return "success";
        }
        else {
            return "failure";
        }
    }
    static get descriptor() {
        return {
            name: "GetField",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "获取对象的字段值",
            args: [
                {
                    name: "field",
                    type: "string?",
                    desc: "字段(field)",
                    oneof: "字段(field)",
                },
            ],
            input: ["对象", "字段(field)?"],
            output: ["字段值(value)"],
            doc: `
                + 合法元素不包括 \`undefined\` 和 \`null\`
                + 只有获取到合法元素时候才会返回 \`success\`，否则返回 \`failure\`
            `,
        };
    }
}

@registerNode
class Index extends Node {
    onTick(tree, status) {
        const [arr] = this.input;
        if (!Array.isArray(arr)) {
            this.error(`invalid array: ${arr}`);
            return "error";
        }
        const index = this._checkOneof(1, this.args.index);
        const value = arr[index];
        if (value !== undefined && value !== null) {
            this.output.push(value);
            return "success";
        }
        else if (typeof index !== "number" || isNaN(index)) {
            this.error(`invalid index: ${index}`);
            return "error";
        }
        return "failure";
    }
    static get descriptor() {
        return {
            name: "Index",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "索引输入的数组",
            args: [
                {
                    name: "index",
                    type: "int?",
                    desc: "索引",
                    oneof: "索引",
                },
            ],
            input: ["数组", "索引?"],
            output: ["值"],
            doc: `
                + 合法元素不包括 \`undefined\` 和 \`null\`
                + 索引数组的时候，第一个元素的索引为 0
                + 只有索引到有合法元素时候才会返回 \`success\`，否则返回 \`failure\`
            `,
        };
    }
}

@registerNode
class JustFailure extends Node {
    onTick(tree, status) {
        return "failure";
    }
    static get descriptor() {
        return {
            name: "JustFailure",
            type: "Action",
            children: 0,
            status: ["failure"],
            desc: "什么都不干，只返回失败",
        };
    }
}

// 只返回成功，用来满足一些特殊节点的结构要求
@registerNode
class JustSuccess extends Node {
    onTick(tree, status) {
        return "success";
    }
    static get descriptor() {
        return {
            name: "JustSuccess",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "什么都不干，只返回成功",
        };
    }
}

@registerNode
class Let extends Node {
    onTick(tree, status) {
        const value = this._checkOneof(0, this.args.value, null);
        this.output.push(value);
        return "success";
    }
    static get descriptor() {
        return {
            name: "Let",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "定义新的变量名",
            input: ["已存在变量名?"],
            args: [
                {
                    name: "value",
                    type: "json?",
                    desc: "值(value)",
                    oneof: "已存在变量名",
                },
            ],
            output: ["新变量名"],
            doc: `
                + 如果有输入变量，则给已有变量重新定义一个名字
                + 如果\`值(value)\`为 \`null\`，则清除变量
            `,
        };
    }
}

var LogLevel;
(function (LogLevel) {
    LogLevel["LOG"] = "log";
    LogLevel["INFO"] = "info";
    LogLevel["DEBUG"] = "debug";
    LogLevel["WARN"] = "warn";
    LogLevel["ERROR"] = "error";
})(LogLevel || (LogLevel = {}));
@registerNode
class Log extends Node {
    onTick(tree, status) {
        const [inputMsg] = this.input;
        const args = this.args;
        const level = args.level ?? LogLevel.LOG;
        let print = console.log;
        let prefix = "";
        switch (level) {
            case LogLevel.INFO:
                print = console.info;
                prefix = "behavior3 -> info:";
                break;
            case LogLevel.DEBUG:
                print = console.debug;
                prefix = "behavior3 -> debug:";
                break;
            case LogLevel.WARN:
                print = console.warn;
                prefix = "behavior3 -> warn:";
                break;
            case LogLevel.ERROR:
                print = console.error;
                prefix = "behavior3 -> error:";
                break;
            case LogLevel.LOG:
            default:
                print = console.log;
                prefix = "behavior3 -> log:";
                break;
        }
        print.call(console, prefix, args.message, inputMsg ?? "");
        return "success";
    }
    static get descriptor() {
        return {
            name: "Log",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "打印日志",
            input: ["日志?"],
            args: [
                {
                    name: "message",
                    type: "string",
                    desc: "日志",
                },
                {
                    name: "level",
                    type: "string",
                    desc: "日志级别",
                    default: LogLevel.LOG,
                    options: [
                        {
                            source: [
                                { name: "LOG", value: LogLevel.LOG },
                                { name: "INFO", value: LogLevel.INFO },
                                { name: "DEBUG", value: LogLevel.DEBUG },
                                { name: "WARN", value: LogLevel.WARN },
                                { name: "ERROR", value: LogLevel.ERROR },
                            ],
                        },
                    ],
                },
            ],
        };
    }
}

var Op;
(function (Op) {
    // 基础运算
    Op[Op["abs"] = 0] = "abs";
    Op[Op["ceil"] = 1] = "ceil";
    Op[Op["floor"] = 2] = "floor";
    Op[Op["round"] = 3] = "round";
    Op[Op["sign"] = 4] = "sign";
    // 三角函数
    Op[Op["sin"] = 5] = "sin";
    Op[Op["cos"] = 6] = "cos";
    Op[Op["tan"] = 7] = "tan";
    Op[Op["atan2"] = 8] = "atan2";
    // 幂和对数
    Op[Op["pow"] = 9] = "pow";
    Op[Op["sqrt"] = 10] = "sqrt";
    Op[Op["log"] = 11] = "log";
    // 最值运算
    Op[Op["min"] = 12] = "min";
    Op[Op["max"] = 13] = "max";
    // 随机数
    Op[Op["random"] = 14] = "random";
    Op[Op["randInt"] = 15] = "randInt";
    Op[Op["randFloat"] = 16] = "randFloat";
    // 其他运算
    Op[Op["sum"] = 17] = "sum";
    Op[Op["average"] = 18] = "average";
    Op[Op["product"] = 19] = "product";
})(Op || (Op = {}));
@registerNode
class MathNode extends Node {
    _op;
    constructor(context, cfg) {
        super(context, cfg);
        this._op = Op[cfg.args.op];
        if (this._op === undefined) {
            throw new Error(`unknown op: ${cfg.args.op}`);
        }
    }
    onTick(tree, status) {
        const op = this._op;
        const args = this.args;
        const inputValues = this.input.filter((value) => value !== undefined).map(Number);
        // 优先使用常量参数，如果没有则使用输入参数
        const values = [];
        if (args.value1 !== undefined) {
            values[0] = args.value1;
        }
        else if (inputValues.length > 0) {
            values[0] = inputValues[0];
        }
        if (args.value2 !== undefined) {
            values[1] = args.value2;
        }
        else if (inputValues.length > 1) {
            values[1] = inputValues[1];
        }
        // 对于需要更多参数的运算（min, max, sum等），添加剩余的输入参数
        if (inputValues.length > 2) {
            values.push(...inputValues.slice(2));
        }
        if (values.length === 0 && op !== Op.random && op !== Op.randInt && op !== Op.randFloat) {
            this.error("at least one parameter is required");
            return "failure";
        }
        let result;
        switch (op) {
            case Op.abs: {
                if (values.length !== 1) {
                    this.error("abs operation requires exactly one parameter");
                    return "failure";
                }
                result = Math.abs(values[0]);
                break;
            }
            case Op.ceil: {
                if (values.length !== 1) {
                    this.error("ceil operation requires exactly one parameter");
                    return "failure";
                }
                result = Math.ceil(values[0]);
                break;
            }
            case Op.floor: {
                if (values.length !== 1) {
                    this.error("floor operation requires exactly one parameter");
                    return "failure";
                }
                result = Math.floor(values[0]);
                break;
            }
            case Op.round: {
                if (values.length !== 1) {
                    this.error("round operation requires exactly one parameter");
                    return "failure";
                }
                result = Math.round(values[0]);
                break;
            }
            case Op.sin: {
                if (values.length !== 1) {
                    this.error("sin operation requires exactly one parameter");
                    return "failure";
                }
                result = Math.sin(values[0]);
                break;
            }
            case Op.cos: {
                if (values.length !== 1) {
                    this.error("cos operation requires exactly one parameter");
                    return "failure";
                }
                result = Math.cos(values[0]);
                break;
            }
            case Op.tan: {
                if (values.length !== 1) {
                    this.error("tan operation requires exactly one parameter");
                    return "failure";
                }
                result = Math.tan(values[0]);
                break;
            }
            case Op.pow: {
                if (values.length !== 2) {
                    this.error("pow operation requires exactly two parameters");
                    return "failure";
                }
                result = Math.pow(values[0], values[1]);
                break;
            }
            case Op.sqrt: {
                if (values.length !== 1) {
                    this.error("sqrt operation requires exactly one parameter");
                    return "failure";
                }
                result = Math.sqrt(values[0]);
                break;
            }
            case Op.log: {
                if (values.length !== 1) {
                    this.error("log operation requires exactly one parameter");
                    return "failure";
                }
                result = Math.log(values[0]);
                break;
            }
            case Op.min: {
                result = Math.min(...values);
                break;
            }
            case Op.max: {
                result = Math.max(...values);
                break;
            }
            case Op.sum: {
                result = values.reduce((a, b) => a + b, 0);
                break;
            }
            case Op.average: {
                result = values.reduce((a, b) => a + b, 0) / values.length;
                break;
            }
            case Op.product: {
                result = values.reduce((a, b) => a * b, 1);
                break;
            }
            case Op.sign: {
                if (values.length !== 1) {
                    this.error("sign operation requires exactly one parameter");
                    return "failure";
                }
                result = Math.sign(values[0]);
                break;
            }
            case Op.atan2: {
                if (values.length !== 2) {
                    this.error("atan2 operation requires exactly two parameters");
                    return "failure";
                }
                result = Math.atan2(values[0], values[1]);
                break;
            }
            case Op.random: {
                result = Math.random();
                break;
            }
            case Op.randInt: {
                if (values.length !== 2) {
                    this.error("randInt operation requires two parameters (min and max)");
                    return "failure";
                }
                const min = Math.ceil(values[0]);
                const max = Math.floor(values[1]);
                if (min > max) {
                    this.error("minimum value cannot be greater than maximum value");
                    return "failure";
                }
                result = Math.floor(Math.random() * (max - min + 1)) + min;
                break;
            }
            case Op.randFloat: {
                if (values.length !== 2) {
                    this.error("randFloat operation requires two parameters (min and max)");
                    return "failure";
                }
                if (values[0] > values[1]) {
                    this.error("minimum value cannot be greater than maximum value");
                    return "failure";
                }
                result = Math.random() * (values[1] - values[0]) + values[0];
                break;
            }
            default: {
                return "failure";
            }
        }
        if (isNaN(result)) {
            this.error(`result is NaN: ${result}`);
            return "error";
        }
        this.output.push(result);
        return "success";
    }
    static get descriptor() {
        return {
            name: "Math",
            type: "Action",
            desc: "执行数学运算",
            input: ["参数..."],
            output: ["结果"],
            status: ["success", "failure"],
            args: [
                {
                    name: "op",
                    type: "string",
                    desc: "数学运算类型",
                    options: [
                        {
                            source: [
                                // 基础运算
                                { name: "绝对值", value: Op[Op.abs] },
                                { name: "向上取整", value: Op[Op.ceil] },
                                { name: "向下取整", value: Op[Op.floor] },
                                { name: "四舍五入", value: Op[Op.round] },
                                { name: "符号", value: Op[Op.sign] },
                                // 三角函数
                                { name: "正弦", value: Op[Op.sin] },
                                { name: "余弦", value: Op[Op.cos] },
                                { name: "正切", value: Op[Op.tan] },
                                { name: "反正切2", value: Op[Op.atan2] },
                                // 幂和对数
                                { name: "幂运算", value: Op[Op.pow] },
                                { name: "平方根", value: Op[Op.sqrt] },
                                { name: "自然对数", value: Op[Op.log] },
                                // 最值运算
                                { name: "最小值", value: Op[Op.min] },
                                { name: "最大值", value: Op[Op.max] },
                                // 随机数
                                { name: "随机数", value: Op[Op.random] },
                                { name: "随机整数", value: Op[Op.randInt] },
                                { name: "随机浮点数", value: Op[Op.randFloat] },
                                // 其他运算
                                { name: "求和", value: Op[Op.sum] },
                                { name: "平均值", value: Op[Op.average] },
                                { name: "乘积", value: Op[Op.product] },
                            ],
                        },
                    ],
                },
                {
                    name: "value1",
                    type: "float?",
                    desc: "参数1（优先使用）",
                },
                {
                    name: "value2",
                    type: "float?",
                    desc: "参数2（优先使用）",
                },
            ],
        };
    }
}

@registerNode
class Now extends Node {
    onTick(tree, status) {
        this.output.push(tree.context.time);
        return "success";
    }
    static get descriptor() {
        return {
            name: "Now",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "获取当前时间",
            output: ["当前时间"],
        };
    }
}

@registerNode
class Push extends Node {
    onTick(tree, status) {
        const [arr, element] = this.input;
        if (!Array.isArray(arr)) {
            this.error(`arr is not an array: ${arr}`);
            return "error";
        }
        arr.push(element);
        return "success";
    }
    static get descriptor() {
        return {
            name: "Push",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "向数组中添加元素",
            input: ["数组", "元素"],
            doc: `
                + 当变量\`数组\`不是数组类型时返回 \`failure\`
                + 其余返回 \`success\`
            `,
        };
    }
}

@registerNode
class RandomIndex extends Node {
    onTick(tree, status) {
        const [arr] = this.input;
        if (!(arr instanceof Array)) {
            return "error";
        }
        if (arr.length === 0) {
            return "failure";
        }
        const idx = Math.floor(Math.random() * arr.length);
        const value = arr[idx];
        if (value !== undefined && value !== null) {
            this.output.push(value);
            this.output.push(idx);
            return "success";
        }
        else {
            return "failure";
        }
    }
    static get descriptor() {
        return {
            name: "RandomIndex",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "随机返回输入的其中一个!",
            input: ["输入目标"],
            output: ["随机目标", "索引?"],
            doc: `
                + 合法元素不包括 \`undefined\` 和 \`null\`
                + 在输入数组中，随机返回其中一个
                + 当输入数组为空时，或者没有合法元素，返回 \`failure\`
            `,
        };
    }
}

@registerNode
class SetField extends Node {
    onTick(tree, status) {
        const [obj] = this.input;
        if (typeof obj !== "object" || !obj) {
            this.error(`invalid object: ${obj}`);
            return "error";
        }
        const args = this.args;
        const field = this._checkOneof(1, args.field);
        const value = this._checkOneof(2, args.value, null);
        if (typeof field !== "string" && typeof field !== "number") {
            this.error(`invalid field: ${field}`);
            return "error";
        }
        else if (value === null || value === undefined) {
            delete obj[field];
            return "success";
        }
        else {
            obj[field] = value;
            return "success";
        }
    }
    static get descriptor() {
        return {
            name: "SetField",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "设置对象字段值",
            input: ["输入对象", "字段(field)?", "值(value)?"],
            args: [
                { name: "field", type: "string?", desc: "字段(field)", oneof: "字段(field)" },
                { name: "value", type: "json?", desc: "值(value)", oneof: "值(value)" },
            ],
            doc: `
                + 对输入对象设置 \`field\` 和 \`value\`
                + 输入参数1必须为对象，否则返回 \`failure\`
                + 如果 \`field\` 不为 \`string\`, 也返回 \`failure\`
                + 如果 \`value\` 为 \`undefined\` 或 \`null\`, 则删除 \`field\` 的值
            `,
        };
    }
}

@registerNode
class Wait extends Node {
    onTick(tree, status) {
        const t = tree.resume(this);
        if (typeof t === "number") {
            if (tree.context.time >= t) {
                return "success";
            }
            else {
                return "running";
            }
        }
        else {
            const args = this.args;
            let time = this._checkOneof(0, args.time, 0);
            if (args.random) {
                time += (Math.random() - 0.5) * args.random;
            }
            return tree.yield(this, tree.context.time + time);
        }
    }
    static get descriptor() {
        return {
            name: "Wait",
            type: "Action",
            children: 0,
            status: ["success", "running"],
            desc: "等待",
            input: ["等待时间?"],
            args: [
                {
                    name: "time",
                    type: "float?",
                    desc: "等待时间",
                    oneof: "等待时间",
                },
                {
                    name: "random",
                    type: "float?",
                    desc: "随机范围",
                },
            ],
        };
    }
}

@registerNode
class WaitForEvent extends Node {
    _triggerKey;
    _expiredKey;
    constructor(context, cfg) {
        super(context, cfg);
        this._triggerKey = Blackboard.makeTempVar(this, "trigger");
        this._expiredKey = Blackboard.makeTempVar(this, "expired");
    }
    onTick(tree) {
        const triggerKey = this._triggerKey;
        const triggered = tree.blackboard.get(triggerKey);
        const expiredKey = this._expiredKey;
        const expired = tree.blackboard.get(expiredKey) ?? tree.context.time;
        if (triggered === true) {
            tree.blackboard.set(triggerKey, undefined);
            tree.blackboard.set(expiredKey, undefined);
            return "success";
        }
        else if (triggered === undefined) {
            tree.blackboard.set(triggerKey, false);
            tree.blackboard.set(expiredKey, tree.context.time + 5);
            tree.context.on(this.args.event, () => {
                tree.blackboard.set(triggerKey, true);
                tree.context.off(this.args.event, tree);
                tree.context.off("treeInterrupted" /* TreeEvent.INTERRUPTED */, tree);
            }, tree);
            tree.context.on("treeInterrupted" /* TreeEvent.INTERRUPTED */, () => {
                tree.blackboard.set(triggerKey, undefined);
                tree.blackboard.set(expiredKey, undefined);
                tree.context.off(this.args.event, tree);
                tree.context.off("treeInterrupted" /* TreeEvent.INTERRUPTED */, tree);
            }, tree);
        }
        else if (tree.context.time >= expired) {
            tree.blackboard.set(expiredKey, tree.context.time + 5);
            this.debug(`wait for event: ${this.args.event}`);
        }
        return "running";
    }
    static get descriptor() {
        return {
            name: "WaitForEvent",
            type: "Action",
            children: 0,
            status: ["success", "running"],
            desc: "等待事件触发",
            args: [
                {
                    name: "event",
                    type: "string",
                    desc: "事件名称",
                },
            ],
        };
    }
}

/**
 * IfElse node executes different child nodes based on a condition.
 *
 * The node requires exactly 3 children:
 * 1. The condition node that determines which branch to execute
 * 2. The node to execute if condition returns `success`
 * 3. The node to execute if condition returns `failure`
 *
 * The execution flow is:
 * 1. Execute condition node (first child)
 * 2. If condition returns `success`, execute second child
 * 3. If condition returns `failure`, execute third child
 * 4. Return the status of whichever branch was executed
 */
@registerNode
class IfElse extends Node {
    _ifelse(tree, status) {
        if (status === "error") {
            return "error";
        }
        const i = status === "success" ? 1 : 2;
        const childStatus = this.children[i].tick(tree);
        if (childStatus === "running") {
            return tree.yield(this, i);
        }
        else {
            return childStatus;
        }
    }
    onTick(tree, status) {
        const i = tree.resume(this);
        if (i !== undefined) {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            else if (i === 0) {
                return this._ifelse(tree, status);
            }
            else {
                return status;
            }
        }
        status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this, 0);
        }
        else {
            return this._ifelse(tree, status);
        }
    }
    static get descriptor() {
        return {
            name: "IfElse",
            type: "Composite",
            children: 3,
            status: ["|success", "|failure", "|running"],
            desc: "条件执行",
            doc: `
                + 必须有三个子节点
                + 第一个子节点为条件节点
                + 第二个子节点为条件为 \`success\` 时执行的节点
                + 第三个子节点为条件为 \`failure\` 时执行的节点,
            `,
        };
    }
}

const EMPTY_STACK$1 = new Stack(null);
/**
 * Parallel node executes all child nodes simultaneously.
 *
 * The execution flow is:
 * 1. Execute all child nodes in parallel
 * 2. If any child returns `running`, store its state and continue next tick
 * 3. Return `running` until all children complete
 * 4. When all children complete, return `success`
 *
 * Each child's execution state is tracked independently, allowing true parallel behavior.
 * The node only succeeds when all children have completed successfully.
 */
@registerNode
class Parallel extends Node {
    onTick(tree, status) {
        const last = tree.resume(this) ?? [];
        const stack = tree.stack;
        const level = stack.length;
        const children = this.children;
        let count = 0;
        for (let i = 0; i < children.length; i++) {
            let childStack = last[i];
            if (childStack === undefined) {
                status = children[i].tick(tree);
            }
            else if (childStack.length > 0) {
                childStack.move(stack, 0);
                while (stack.length > level) {
                    status = stack.top().tick(tree);
                    if (status === "running") {
                        break;
                    }
                }
            }
            else {
                status = "success";
            }
            if (status === "running") {
                if (childStack === undefined) {
                    childStack = new StackSlice();
                }
                stack.move(childStack, level);
            }
            else {
                count++;
                childStack = EMPTY_STACK$1;
            }
            last[i] = childStack;
        }
        if (count === children.length) {
            return "success";
        }
        else {
            return tree.yield(this, last);
        }
    }
    static get descriptor() {
        return {
            name: "Parallel",
            type: "Composite",
            status: ["success", "|running"],
            children: -1,
            desc: "并行执行",
            doc: `
                + 并行执行所有子节点
                + 当有子节点返回 \`running\` 时，返回 \`running\` 状态
                + 执行完所有子节点后，返回 \`success\``,
        };
    }
}

const EMPTY_STACK = new Stack(null);
/**
 * Race node executes all child nodes simultaneously until one succeeds or all fail.
 *
 * The execution flow is:
 * 1. Execute all child nodes in parallel
 * 2. If any child returns `success`, immediately return `success` and cancel other running children
 * 3. If any child returns `running`, store its state and continue next tick
 * 4. Return `failure` only when all children have failed
 *
 * Each child's execution state is tracked independently, allowing parallel execution.
 * The first child to succeed "wins the race" and causes the node to succeed.
 * The node only fails if all children fail.
 */
@registerNode
class Race extends Node {
    onTick(tree, status) {
        const last = tree.resume(this) ?? [];
        const stack = tree.stack;
        const level = stack.length;
        const children = this.children;
        let count = 0;
        for (let i = 0; i < children.length; i++) {
            let childStack = last[i];
            status = "failure";
            if (childStack === undefined) {
                status = children[i].tick(tree);
            }
            else if (childStack.length > 0) {
                childStack.move(stack, 0);
                while (stack.length > level) {
                    status = stack.top().tick(tree);
                    if (status === "running") {
                        break;
                    }
                }
            }
            if (status === "running") {
                if (childStack === undefined) {
                    childStack = new StackSlice();
                }
                stack.move(childStack, level);
            }
            else if (status === "success") {
                last.forEach((v) => v !== EMPTY_STACK && v.clear());
                return "success";
            }
            else {
                count++;
                childStack = EMPTY_STACK;
            }
            last[i] = childStack;
        }
        if (count === children.length) {
            return "failure";
        }
        else {
            return tree.yield(this, last);
        }
    }
    static get descriptor() {
        return {
            name: "Race",
            type: "Composite",
            status: ["|success", "&failure", "|running"],
            children: -1,
            desc: "竞争执行",
            doc: `
                + 并行执行所有子节点
                + 当有子节点返回 \`success\` 时，立即返回 \`success\` 状态，并中断其他子节点
                + 如果所有子节点返回 \`failure\`或 \`error\` 则返回 \`failure\``,
        };
    }
}

/**
 * Selector composite node that executes children in order.
 * Returns:
 * - `success`: if any child returns `success`
 * - `failure`: when all children return `failure`
 * - `running`: if a child returns `running`
 *
 * Executes children sequentially until one succeeds or all fail.
 * If a child returns `running`, the selector will yield and resume
 * from that child on next tick.
 */
@registerNode
class Selector extends Node {
    onTick(tree, status) {
        const last = tree.resume(this);
        const children = this.children;
        let i = 0;
        if (typeof last === "number") {
            if (status === "failure" || status === "error") {
                i = last + 1;
            }
            else if (status === "success") {
                return "success";
            }
            else {
                this.throw(`unexpected status error`);
            }
        }
        for (; i < children.length; i++) {
            status = children[i].tick(tree);
            if (status === "success") {
                return "success";
            }
            else if (status === "running") {
                return tree.yield(this, i);
            }
        }
        return "failure";
    }
    static get descriptor() {
        return {
            name: "Selector",
            type: "Composite",
            children: -1,
            desc: "选择执行",
            status: ["|success", "&failure", "|running"],
            doc: `
                + 一直往下执行，直到有子节点返回 \`success\` 则返回 \`success\`
                + 若全部节点返回 \`failure\`或 \`error\` 则返回 \`failure\``,
        };
    }
}

/**
 * Sequence composite node that executes children in order.
 * Returns:
 * - `success`: when all children return `success`
 * - `failure`: if any child returns `failure`
 * - `running`: if a child returns `running`
 *
 * Executes children sequentially until one fails or all succeed.
 * If a child returns `running`, the sequence will yield and resume
 * from that child on next tick.
 */
@registerNode
class Sequence extends Node {
    onTick(tree, status) {
        const last = tree.resume(this);
        const children = this.children;
        let i = 0;
        if (typeof last === "number") {
            if (status === "success") {
                i = last + 1;
            }
            else if (status === "failure" || status === "error") {
                return status;
            }
            else {
                this.throw(`unexpected status error: ${status}`);
            }
        }
        for (; i < children.length; i++) {
            status = children[i].tick(tree);
            if (status === "failure" || status === "error") {
                return status;
            }
            else if (status === "running") {
                return tree.yield(this, i);
            }
        }
        return "success";
    }
    static get descriptor() {
        return {
            name: "Sequence",
            type: "Composite",
            children: -1,
            status: ["&success", "|failure", "|running"],
            desc: "顺序执行",
            doc: `
                + 一直往下执行，只有当所有子节点都返回 \`success\`, 才返回 \`success\`
                + 若子节点返回 \`failure\`，则直接返回 \`failure\` 状态
                + 其余情况返回 \`running\` 状态
            `,
        };
    }
}

/**
 * Switch node that executes cases in order until one matches.
 *
 * Each child must be a Case node with exactly 2 children:
 * 1. The condition node that determines if this case matches
 * 2. The action node to execute if condition returns `success`
 *
 * The execution flow is:
 * 1. Execute first child (condition) of each case in order
 * 2. If condition returns `success`, execute second child (action)
 * 3. Return the status of the action node
 * 4. If no case matches, return `failure`
 *
 * Similar to a switch statement, cases are evaluated in order
 * until a matching condition is found. Only the action of the
 * first matching case is executed.
 */
@registerNode
class Switch extends Node {
    constructor(context, cfg) {
        super(context, cfg);
        this.children.forEach((v) => {
            if (v.name !== "Case") {
                this.throw(`only allow Case node`);
            }
        });
    }
    onTick(tree, status) {
        let step = tree.resume(this);
        const children = this.children;
        if (typeof step === "number") {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            if (step % 2 === 0) {
                if (status === "success") {
                    step += 1; // do second node in case
                }
                else {
                    step += 2; // next case
                }
            }
            else {
                return status;
            }
        }
        else {
            step = 0;
        }
        for (let i = step >>> 1; i < children.length; i++) {
            const [first, second] = children[i].children;
            if (step % 2 === 0) {
                status = first.tick(tree);
                if (status === "running") {
                    return tree.yield(this, step);
                }
                else if (status === "success") {
                    step = i * 2 + 1;
                }
                else {
                    step = i * 2 + 2;
                }
            }
            if (step % 2 === 1) {
                status = second.tick(tree);
                if (status === "running") {
                    return tree.yield(this, step);
                }
                return status;
            }
        }
        return "failure";
    }
    static get descriptor() {
        return {
            name: "Switch",
            type: "Composite",
            children: -1,
            status: ["|success", "|failure", "|running"],
            desc: "分支执行",
            doc: `
                + 按顺序测试 \`Case\` 节点的判断条件（第一个子节点）
                + 若测试返回 \`success\` 则执行 \`Case\` 第二个子节点，并返回子节点的执行状态
                + 若没有判断为 \`success\` 的 \`Case\` 节点，则返回 \`failure\`
            `,
        };
    }
}
@registerNode
class Case extends Node {
    onTick(tree, status) {
        throw new Error("tick children by Switch");
    }
    static get descriptor() {
        return {
            name: "Case",
            type: "Composite",
            children: 2,
            status: ["&success", "|failure", "|running"],
            desc: "分支选择",
            doc: `
                + 必须有两个子节点
                + 第一个子节点为判断条件
                + 第二个子节点为判断为 \`success\` 时执行的节点
                + 此节点不会真正意义的执行，而是交由 \`Switch\` 节点来执行
            `,
        };
    }
}

@registerNode
class Watchdog extends Node {
    onTick(tree, status) {
        let last = tree.resume(this);
        const level = tree.stack.length;
        const lastStatus = tree.__lastStatus;
        status = this.children[0].tick(tree);
        tree.__lastStatus = lastStatus;
        if (status === "running") {
            this.error("unexpected status error: running");
            return "error";
        }
        else if (status === "error") {
            return status;
        }
        if (status === "failure") {
            this.children[2].tick(tree);
            tree.stack.popTo(level);
            return "failure";
        }
        else if (last === undefined) {
            status = this.children[1].tick(tree);
        }
        else {
            last.move(tree.stack, 0);
            while (tree.stack.length > level) {
                const child = tree.stack.top();
                status = child.tick(tree);
                if (status === "running") {
                    break;
                }
            }
        }
        if (status === "running") {
            if (last === undefined) {
                last = new StackSlice();
            }
            tree.stack.move(last, level);
            return tree.yield(this, last);
        }
        else {
            return status;
        }
    }
    static get descriptor() {
        return {
            name: "Watchdog",
            type: "Composite",
            children: 3,
            status: ["|success", "|failure", "|running"],
            desc: "测试执行",
            doc: `
                + 必须有3个子节点
                + 第一个子节点为条件节点，返回 \`success\` 或 \`failure\` 状态
                + 第二个子节点为条件为 \`success\` 时执行的节点
                + 第三个子节点为条件为 \`failure\` 时执行的节点，不管子节点返回什么状态，都直接返回 \`failure\`
                + 当第二个子节点返回 \`running\` 时，由本节点维护其运行状态
                + 每一次 tick 都会先执行测试节点，只有当测试节点返回 \`success\`，才执行第二个子节点
            `,
        };
    }
}

@registerNode
class Check extends Node {
    constructor(context, cfg) {
        super(context, cfg);
        if (typeof this.args.value !== "string" || this.args.value.length === 0) {
            this.throw(`args.value is not a expr string`);
        }
        context.compileCode(this.args.value);
    }
    onTick(tree, status) {
        const value = tree.blackboard.eval(this.args.value);
        return value ? "success" : "failure";
    }
    static get descriptor() {
        return {
            name: "Check",
            type: "Condition",
            children: 0,
            status: ["success", "failure"],
            desc: "检查True或False",
            args: [{ name: "value", type: "expr", desc: "值" }],
            doc: `
                + 做简单数值公式判定，返回 \`success\` 或 \`failure\`
            `,
        };
    }
}

@registerNode
class Includes extends Node {
    onTick(tree, status) {
        const [arr, element] = this.input;
        if (!Array.isArray(arr)) {
            this.error(`invalid array: ${arr}`);
            return "error";
        }
        else if (element === undefined || element === null) {
            return "failure";
        }
        const index = arr.indexOf(element);
        return index >= 0 ? "success" : "failure";
    }
    static get descriptor() {
        return {
            name: "Includes",
            type: "Condition",
            children: 0,
            status: ["success", "failure"],
            desc: "判断元素是否在数组中",
            input: ["数组", "元素"],
            doc: `
                + 若输入的元素不合法，返回 \`failure\`
                + 只有数组包含元素时返回 \`success\`，否则返回 \`failure\`
            `,
        };
    }
}

@registerNode
class IsNull extends Node {
    onTick(tree, status) {
        const [value] = this.input;
        if (value === undefined || value === null) {
            return "success";
        }
        else {
            return "failure";
        }
    }
    static get descriptor() {
        return {
            name: "IsNull",
            type: "Condition",
            children: 0,
            status: ["success", "failure"],
            desc: "判断变量是否不存在",
            input: ["判断的变量"],
        };
    }
}

@registerNode
class NotNull extends Node {
    onTick(tree, status) {
        const [value] = this.input;
        if (value === undefined || value === null) {
            return "failure";
        }
        else {
            return "success";
        }
    }
    static get descriptor() {
        return {
            name: "NotNull",
            type: "Condition",
            children: 0,
            status: ["success", "failure"],
            desc: "判断变量是否存在",
            input: ["判断的变量"],
        };
    }
}

@registerNode
class AlwaysFailure extends Node {
    onTick(tree, status) {
        const isYield = tree.resume(this);
        if (typeof isYield === "boolean") {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            return "failure";
        }
        status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this);
        }
        return "failure";
    }
    static get descriptor() {
        return {
            name: "AlwaysFailure",
            type: "Decorator",
            children: 1,
            status: ["failure", "|running"],
            desc: "始终返回失败",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`running\` 时，返回 \`running\`
                + 其它情况，不管子节点是否成功都返回 \`failure\`
            `,
        };
    }
}

@registerNode
class AlwaysRunning extends Node {
    onTick(tree, status) {
        this.children[0].tick(tree);
        return "running";
    }
    static get descriptor() {
        return {
            name: "AlwaysRunning",
            type: "Decorator",
            children: 1,
            status: ["running"],
            desc: "始终返回运行中状态",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 始终返回 \`running\`
            `,
        };
    }
}

@registerNode
class AlwaysSuccess extends Node {
    onTick(tree, status) {
        const isYield = tree.resume(this);
        if (typeof isYield === "boolean") {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            return "success";
        }
        status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this);
        }
        return "success";
    }
    static get descriptor() {
        return {
            name: "AlwaysSuccess",
            type: "Decorator",
            children: 1,
            status: ["success", "|running"],
            desc: "始终返回成功",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`running\` 时，返回 \`running\`
                + 其它情况，不管子节点是否成功都返回 \`success\`
            `,
        };
    }
}

@registerNode
class Assert extends Node {
    onTick(tree, status) {
        const args = this.args;
        const isYield = tree.resume(this);
        if (typeof isYield === "boolean") {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            if (status === "success") {
                return "success";
            }
            else {
                this.throw(args.message);
            }
        }
        status = this.children[0].tick(tree);
        if (status === "success") {
            return "success";
        }
        else if (status === "running") {
            return tree.yield(this);
        }
        else {
            this.throw(args.message);
        }
        return "success";
    }
    static get descriptor() {
        return {
            name: "Assert",
            type: "Decorator",
            children: 1,
            status: ["success"],
            desc: "断言",
            args: [
                {
                    name: "message",
                    type: "string",
                    desc: "消息",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`failure\` 时，抛出异常
                + 其余情况返回子节点的执行状态
            `,
        };
    }
}

@registerNode
class Delay extends Node {
    onTick(tree, status) {
        const args = this.args;
        const delay = this._checkOneof(0, args.delay, 0);
        const blackboard = tree.blackboard;
        const keys = args.cacheVars ?? [];
        const cacheArgs = keys.map((key) => blackboard.get(key));
        tree.context.delay(delay, () => {
            const cacheOldArgs = keys.map((key) => blackboard.get(key));
            keys.forEach((key, i) => blackboard.set(key, cacheArgs[i]));
            const level = tree.stack.length;
            status = this.children[0].tick(tree);
            if (status === "running") {
                tree.stack.popTo(level);
            }
            keys.forEach((key, i) => blackboard.set(key, cacheOldArgs[i]));
        }, tree);
        return "success";
    }
    static get descriptor() {
        return {
            name: "Delay",
            type: "Decorator",
            children: 1,
            status: ["success"],
            desc: "延时执行子节点",
            input: ["延时时间?"],
            args: [
                {
                    name: "delay",
                    type: "float?",
                    desc: "延时时间",
                    oneof: "延时时间",
                },
                {
                    name: "cacheVars",
                    type: "string[]?",
                    desc: "暂存环境变量",
                },
            ],
            doc: `
                + 当延时触发时，执行第一个子节点，多个仅执行第一个
                + 如果子节点返回 \`running\`，会中断执行并清理执行栈`,
        };
    }
}

@registerNode
class Filter extends Node {
    onTick(tree, status) {
        const [arr] = this.input;
        if (!(arr instanceof Array)) {
            return "error";
        }
        if (arr.length === 0) {
            return "failure";
        }
        let last = tree.resume(this);
        let i;
        let newArr;
        if (last instanceof Array) {
            [i, newArr] = last;
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            else if (status === "success") {
                newArr.push(arr[i]);
            }
            i++;
        }
        else {
            i = 0;
            newArr = [];
        }
        const filter = this.children[0];
        for (i = 0; i < arr.length; i++) {
            tree.blackboard.set(this.cfg.output[0], arr[i]);
            status = filter.tick(tree);
            if (status === "running") {
                if (last instanceof Array) {
                    last[0] = i;
                    last[1] = newArr;
                }
                else {
                    last = [i, newArr];
                }
                return tree.yield(this, last);
            }
            else if (status === "success") {
                newArr.push(arr[i]);
            }
        }
        this.output.push(undefined, newArr);
        return newArr.length === 0 ? "failure" : "success";
    }
    static get descriptor() {
        return {
            name: "Filter",
            type: "Decorator",
            children: 1,
            status: ["success", "failure", "|running"],
            desc: "返回满足条件的元素",
            input: ["输入数组"],
            output: ["变量", "新数组"],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 遍历输入数组，将当前元素写入\`变量\`，满足条件的元素放入新数组
                + 只有当新数组不为空时，才返回 \`success\`
            `,
        };
    }
}

@registerNode
class Foreach extends Node {
    onTick(tree, status) {
        const [arr] = this.input;
        const [varname, idx] = this.cfg.output;
        let i = tree.resume(this);
        if (i !== undefined) {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            else if (status === "failure" || status === "error") {
                return status;
            }
            i++;
        }
        else {
            i = 0;
        }
        for (; i < arr.length; i++) {
            tree.blackboard.set(varname, arr[i]);
            if (idx) {
                tree.blackboard.set(idx, i);
            }
            status = this.children[0].tick(tree);
            if (status === "running") {
                return tree.yield(this, i);
            }
            else if (status === "failure" || status === "error") {
                return status;
            }
        }
        return "success";
    }
    static get descriptor() {
        return {
            name: "ForEach",
            type: "Decorator",
            children: 1,
            status: ["success", "|running", "|failure"],
            desc: "遍历数组",
            input: ["数组"],
            output: ["变量", "索引?"],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 遍历输入数组，将当前元素写入\`变量\`
                + 当子节点返回 \`failure\` 时，退出遍历并返回 \`failure\` 状态
                + 执行完所有子节点后，返回 \`success\``,
        };
    }
}

@registerNode
class Invert extends Node {
    onTick(tree, status) {
        const isYield = tree.resume(this);
        if (typeof isYield === "boolean") {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            return this._invert(status);
        }
        status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this);
        }
        return this._invert(status);
    }
    _invert(status) {
        if (status === "error") {
            return "error";
        }
        else if (status === "failure") {
            return "success";
        }
        else {
            return "failure";
        }
    }
    static get descriptor() {
        return {
            name: "Invert",
            type: "Decorator",
            children: 1,
            status: ["!success", "!failure", "|running"],
            desc: "反转子节点运行结果",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`success\` 时返回 \`failure\`
                + 当子节点返回 \`failure\` 时返回 \`success\`
                + 当子节点返回 \`error\` 时返回 \`error\`
            `,
        };
    }
}

const builtinEventOptions = [
    { name: "行为树被中断", value: "treeInterrupted" /* TreeEvent.INTERRUPTED */ },
    { name: "行为树开始执行前", value: "treeBeforeTicked" /* TreeEvent.BEFORE_TICKED */ },
    { name: "行为树执行完成后", value: "treeAfterTicked" /* TreeEvent.AFTER_TICKED */ },
    { name: "行为树执行成功后", value: "treeTickedSuccess" /* TreeEvent.TICKED_SUCCESS */ },
    { name: "行为树执行失败后", value: "treeTickedFailure" /* TreeEvent.TICKED_FAILURE */ },
    { name: "行为树被清理", value: "treeCleaned" /* TreeEvent.CLEANED */ },
];
@registerNode
class Listen extends Node {
    _isBuiltinEvent(event) {
        return !!builtinEventOptions.find((e) => e.value === event);
    }
    _processOutput(tree, eventTarget, ...eventArgs) {
        const [eventTargetKey] = this.cfg.output;
        if (eventTargetKey) {
            tree.blackboard.set(eventTargetKey, eventTarget);
        }
        for (let i = 1; i < this.cfg.output.length; i++) {
            const key = this.cfg.output[i];
            if (key) {
                tree.blackboard.set(key, eventArgs[i - 1]);
            }
        }
    }
    onTick(tree, status) {
        let [target] = this.input;
        const args = this.args;
        if (this._isBuiltinEvent(args.event)) {
            if (target !== undefined) {
                this.warn(`invalid target ${target} for builtin event ${args.event}`);
            }
            target = tree;
        }
        const callback = (eventTarget) => {
            return (...eventArgs) => {
                this._processOutput(tree, eventTarget, ...eventArgs);
                const level = tree.stack.length;
                status = this.children[0].tick(tree);
                if (status === "running") {
                    tree.stack.popTo(level);
                }
            };
        };
        if (target !== undefined) {
            if (target instanceof Array) {
                target.forEach((v) => {
                    tree.context.on(args.event, v, callback(v), tree);
                });
            }
            else {
                tree.context.on(args.event, target, callback(target), tree);
            }
        }
        else {
            tree.context.on(args.event, callback(undefined), tree);
        }
        return "success";
    }
    static get descriptor() {
        return {
            name: "Listen",
            type: "Decorator",
            children: 1,
            status: ["success"],
            desc: "侦听事件",
            input: ["目标对象?"],
            output: ["事件目标?", "事件参数..."],
            args: [
                {
                    name: "event",
                    type: "string",
                    desc: "事件",
                    options: [
                        {
                            source: builtinEventOptions.slice(),
                        },
                    ],
                },
            ],
            doc: `
                + 当事件触发时，执行第一个子节点，多个仅执行第一个
                + 如果子节点返回 \`running\`，会中断执行并清理执行栈`,
        };
    }
}

@registerNode
class Once extends Node {
    _onceKey;
    constructor(context, cfg) {
        super(context, cfg);
        this._onceKey = Blackboard.makePrivateVar(this, "ONCE");
    }
    onTick(tree, status) {
        const onceKey = this._onceKey;
        if (tree.blackboard.get(onceKey) === true) {
            return "failure";
        }
        const isYield = tree.resume(this);
        if (typeof isYield === "boolean") {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            tree.blackboard.set(onceKey, true);
            return "success";
        }
        status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this);
        }
        tree.blackboard.set(onceKey, true);
        return "success";
    }
    static get descriptor() {
        return {
            name: "Once",
            type: "Decorator",
            children: 1,
            status: ["success", "failure", "|running"],
            desc: "只执行一次",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 第一次执行完全部子节点时返回 \`success\`，之后永远返回 \`failure\``,
        };
    }
}

@registerNode
class Repeat extends Node {
    onTick(tree, status) {
        const count = this._checkOneof(0, this.args.count, Number.MAX_SAFE_INTEGER);
        let i = tree.resume(this);
        if (i !== undefined) {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            else if (status === "failure" || status === "error") {
                return status;
            }
            i++;
        }
        else {
            i = 0;
        }
        for (; i < count; i++) {
            status = this.children[0].tick(tree);
            if (status === "running") {
                return tree.yield(this, i);
            }
            else if (status === "failure" || status === "error") {
                return status;
            }
        }
        return "success";
    }
    static get descriptor() {
        return {
            name: "Repeat",
            type: "Decorator",
            children: 1,
            status: ["success", "|running", "|failure"],
            desc: "循环执行",
            input: ["循环次数?"],
            args: [
                {
                    name: "count",
                    type: "int?",
                    desc: "循环次数",
                    oneof: "循环次数",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`failure\` 时，退出遍历并返回 \`failure\` 状态
                + 执行完所有子节点后，返回 \`success\`
            `,
        };
    }
}

@registerNode
class RetryUntilFailure extends Node {
    onTick(tree, status) {
        const maxTryTimes = this._checkOneof(0, this.args.count, Number.MAX_SAFE_INTEGER);
        let count = tree.resume(this);
        if (typeof count === "number") {
            if (status === "error") {
                return "error";
            }
            else if (status === "failure") {
                return "success";
            }
            else if (count >= maxTryTimes) {
                return "failure";
            }
            else {
                count++;
            }
        }
        else {
            count = 1;
        }
        status = this.children[0].tick(tree);
        if (status === "error") {
            return "error";
        }
        else if (status === "failure") {
            return "success";
        }
        else {
            return tree.yield(this, count);
        }
    }
    static get descriptor() {
        return {
            name: "RetryUntilFailure",
            type: "Decorator",
            children: 1,
            status: ["!success", "failure", "running"],
            desc: "一直尝试直到子节点返回失败",
            input: ["最大尝试次数?"],
            args: [
                {
                    name: "count",
                    type: "int?",
                    desc: "最大尝试次数",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 只有当子节点返回 \`failure\` 时，才返回 \`success\`，其它情况返回 \`running\` 状态
                + 如果设定了尝试次数，超过指定次数则返回 \`failure\``,
        };
    }
}

@registerNode
class RetryUntilSuccess extends Node {
    onTick(tree, status) {
        const maxTryTimes = this._checkOneof(0, this.args.count, Number.MAX_SAFE_INTEGER);
        let count = tree.resume(this);
        if (typeof count === "number") {
            if (status === "error") {
                return "error";
            }
            else if (status === "success") {
                return "success";
            }
            else if (count >= maxTryTimes) {
                return "failure";
            }
            else {
                count++;
            }
        }
        else {
            count = 1;
        }
        status = this.children[0].tick(tree);
        if (status === "error") {
            return "error";
        }
        else if (status === "success") {
            return "success";
        }
        else {
            return tree.yield(this, count);
        }
    }
    static get descriptor() {
        return {
            name: "RetryUntilSuccess",
            type: "Decorator",
            children: 1,
            status: ["|success", "failure", "running"],
            desc: "一直尝试直到子节点返回成功",
            input: ["最大尝试次数?"],
            args: [
                {
                    name: "count",
                    type: "int?",
                    desc: "最大尝试次数",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 只有当子节点返回 \`success\` 时，才返回 \`success\`，其它情况返回 \`running\` 状态
                + 如果设定了尝试次数，超过指定次数则返回 \`failure\``,
        };
    }
}

@registerNode
class Timeout extends Node {
    onTick(tree, status) {
        const { stack, context } = tree;
        const level = stack.length;
        let last = tree.resume(this);
        status = "failure";
        if (last === undefined) {
            status = this.children[0].tick(tree);
        }
        else if (context.time >= last.expired) {
            last.stack.clear();
            return "failure";
        }
        else {
            last.stack.move(stack, 0);
            while (stack.length > level) {
                const child = stack.top();
                status = child.tick(tree);
                if (status === "running") {
                    break;
                }
            }
        }
        if (status === "running") {
            if (last === undefined) {
                const time = this._checkOneof(0, this.args.time, 0);
                last = {
                    stack: new StackSlice(),
                    expired: context.time + time,
                };
            }
            stack.move(last.stack, level);
            return tree.yield(this, last);
        }
        else {
            return status;
        }
    }
    static get descriptor() {
        return {
            name: "Timeout",
            type: "Decorator",
            children: 1,
            status: ["|success", "|running", "failure"],
            desc: "超时",
            input: ["超时时间?"],
            args: [
                {
                    name: "time",
                    type: "float?",
                    desc: "超时时间",
                    oneof: "超时时间",
                },
            ],
            doc: `
                + 在限定时间内执行子节点，超时则失败
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点执行超时或返回 \`failure\` 时，返回 \`failure\`
                + 其余情况返回子节点的执行状态
            `,
        };
    }
}

exports.Blackboard = Blackboard;
exports.Context = Context;
exports.ExpressionEvaluator = ExpressionEvaluator;
exports.Node = Node;
exports.Stack = Stack;
exports.StackSlice = StackSlice;
exports.Tree = Tree;
exports.filterNodeDescriptors = filterNodeDescriptors;
exports.getNodeDescriptors = getNodeDescriptors;
exports.registerNode = registerNode;
//# sourceMappingURL=index.cjs.map
