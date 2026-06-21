/**
 * Advanced behavior3js Decorators for Wend
 * MaxTime (timeout), Guard (conditional), and more
 */

/**
 * MaxTime Decorator - Abort if child doesn't complete within duration
 *
 * Properties:
 *   - maxTime: duration in milliseconds (default: 5000)
 *
 * Returns:
 *   - RUNNING: if child is running and time not exceeded
 *   - SUCCESS/FAILURE: if child completes before timeout
 *   - FAILURE: if timeout exceeded
 */
class MaxTime extends b3.Node {
    constructor(properties = {}) {
        super(properties);
        this.title = properties.title || 'MaxTime';
        this.properties = properties;
        this.child = null;
        this.maxTime = properties.maxTime || 5000; // ms
        this._startTime = null;
    }

    tick(blackboard) {
        if (!this.child) {
            return b3.Status.FAILURE;
        }

        // First tick - start timer
        if (!this._startTime) {
            this._startTime = Date.now();
        }

        const elapsed = Date.now() - this._startTime;

        // Check timeout
        if (elapsed > this.maxTime) {
            this._startTime = null; // Reset for next execution
            return b3.Status.FAILURE; // Timeout - abort
        }

        // Execute child
        const status = this.child.tick(blackboard);

        // Child finished (success or failure)
        if (status !== b3.Status.RUNNING) {
            this._startTime = null; // Reset for next execution
        }

        return status;
    }
}

/**
 * Guard Decorator - Execute child only if condition is met
 *
 * Properties:
 *   - condition: blackboard key to check
 *   - expectedValue: value to match (optional, any truthy if not specified)
 *   - negate: if true, succeed when condition is false
 *
 * Returns:
 *   - FAILURE: if condition not met (guard fails)
 *   - Result of child: if condition is met
 */
class Guard extends b3.Node {
    constructor(properties = {}) {
        super(properties);
        this.title = properties.title || 'Guard';
        this.properties = properties;
        this.child = null;
        this.condition = properties.condition; // blackboard key
        this.expectedValue = properties.expectedValue; // optional
        this.negate = properties.negate || false; // if true, guard inverts condition
    }

    tick(blackboard) {
        if (!this.child) {
            return b3.Status.FAILURE;
        }

        // Get condition from blackboard
        const value = blackboard.get(this.condition);

        // Determine if guard passes
        let guardPasses;
        if (this.expectedValue !== undefined) {
            guardPasses = value === this.expectedValue;
        } else {
            guardPasses = !!value; // Truthy check
        }

        // Apply negation if specified
        if (this.negate) {
            guardPasses = !guardPasses;
        }

        // Guard failed - don't execute child
        if (!guardPasses) {
            return b3.Status.FAILURE;
        }

        // Guard passed - execute child
        return this.child.tick(blackboard);
    }
}

/**
 * Limiter Decorator - Limit concurrent executions
 *
 * Properties:
 *   - maxConcurrent: maximum concurrent executions (default: 1)
 *
 * Returns:
 *   - FAILURE: if limit reached
 *   - Result of child: if under limit
 */
class Limiter extends b3.Node {
    constructor(properties = {}) {
        super(properties);
        this.title = properties.title || 'Limiter';
        this.properties = properties;
        this.child = null;
        this.maxConcurrent = properties.maxConcurrent || 1;
        this._runningCount = 0;
    }

    tick(blackboard) {
        if (!this.child) {
            return b3.Status.FAILURE;
        }

        // Check if we can execute
        if (this._runningCount >= this.maxConcurrent) {
            return b3.Status.FAILURE; // Limit reached
        }

        // Execute child
        const status = this.child.tick(blackboard);

        // Track running count
        if (status === b3.Status.RUNNING) {
            this._runningCount++;
        } else if (status !== b3.Status.RUNNING) {
            this._runningCount = Math.max(0, this._runningCount - 1);
        }

        return status;
    }
}

/**
 * Delay Decorator - Wait before executing child
 *
 * Properties:
 *   - delay: delay in milliseconds before execution
 *
 * Returns:
 *   - RUNNING: while waiting
 *   - Result of child: after delay expires
 */
class Delay extends b3.Node {
    constructor(properties = {}) {
        super(properties);
        this.title = properties.title || 'Delay';
        this.properties = properties;
        this.child = null;
        this.delay = properties.delay || 1000; // ms
        this._startTime = null;
    }

    tick(blackboard) {
        if (!this.child) {
            return b3.Status.FAILURE;
        }

        // First tick - start delay timer
        if (!this._startTime) {
            this._startTime = Date.now();
            return b3.Status.RUNNING;
        }

        const elapsed = Date.now() - this._startTime;

        // Still waiting
        if (elapsed < this.delay) {
            return b3.Status.RUNNING;
        }

        // Delay expired - execute child
        const status = this.child.tick(blackboard);

        // Child finished
        if (status !== b3.Status.RUNNING) {
            this._startTime = null; // Reset for next execution
        }

        return status;
    }
}

/**
 * Retry Decorator - Retry child on failure
 *
 * Properties:
 *   - maxRetries: maximum number of retries (default: 1)
 *
 * Returns:
 *   - RUNNING: while retrying
 *   - SUCCESS: if child succeeds
 *   - FAILURE: if all retries exhausted
 */
class Retry extends b3.Node {
    constructor(properties = {}) {
        super(properties);
        this.title = properties.title || 'Retry';
        this.properties = properties;
        this.child = null;
        this.maxRetries = properties.maxRetries || 1;
        this._attemptCount = 0;
    }

    tick(blackboard) {
        if (!this.child) {
            return b3.Status.FAILURE;
        }

        const status = this.child.tick(blackboard);

        // Success - done
        if (status === b3.Status.SUCCESS) {
            this._attemptCount = 0; // Reset for next execution
            return b3.Status.SUCCESS;
        }

        // Failure - check if we can retry
        if (status === b3.Status.FAILURE) {
            if (this._attemptCount < this.maxRetries) {
                this._attemptCount++;
                return b3.Status.RUNNING; // Will retry on next tick
            } else {
                this._attemptCount = 0; // Reset for next execution
                return b3.Status.FAILURE; // All retries exhausted
            }
        }

        // Still running
        return b3.Status.RUNNING;
    }
}

// Register advanced decorators with b3
if (typeof b3 !== 'undefined') {
    // These can be registered in the node registry if needed
    window.MaxTime = MaxTime;
    window.Guard = Guard;
    window.Limiter = Limiter;
    window.Delay = Delay;
    window.Retry = Retry;
}
