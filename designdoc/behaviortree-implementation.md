# Behavior Tree Engine - Implementation Roadmap

## Overview
Current implementation covers core control structures (Sequence, Selector, Parallel) and basic leaf execution with a single-cycle blackboard. This roadmap prioritizes features by impact, complexity, and dependencies.

---

## Phase 1: Foundation (Critical - Blocks Everything Else)

### 1.1 Explicit Leaf Node Types
**Priority: P0 (Critical)**
**Complexity: Low**
**Effort: 4-6 hours**

Currently only implicit leaf behavior: "success if output non-empty"

**To Implement:**
- `leaf:success-always` - Always succeeds regardless of output
- `leaf:fail-always` - Always fails (guards/test nodes)
- `leaf:output-contains:pattern` - Success if output matches regex
- `leaf:output-length:min,max` - Success if output length in range
- `leaf:success-if-empty` - Inverse of default

**Files to modify:**
- `frontend/bt.js` - `_runLeaf()` method (line 332)
- `frontend/app.js` - Node config UI for btLeafType
- `electron/test.js` - Test cases for each leaf type

**Implementation notes:**
- Add `btLeafType` field to node configuration
- Update `_runLeaf()` to dispatch based on btLeafType
- Default to current behavior for backward compatibility

---

### 1.2 Error Handling & Recovery
**Priority: P0 (Critical)**
**Complexity: Medium**
**Effort: 6-8 hours**

Current implementation: Single try-catch, errors halt execution

**To Implement:**
- Per-node error state tracking (distinct from 'ng' status)
- Retry configuration (count, backoff strategy)
- Error callbacks vs normal callbacks
- Partial failure handling in Sequence/Selector
- Better error logging with context

**Files to modify:**
- `frontend/bt.js` - `_runNode()`, `_runLeaf()` (lines 239, 332)
- `frontend/app.js` - Error state rendering
- `electron/test.js` - Error scenarios

**Implementation notes:**
- Add btRetryCount, btRetryBackoff to node config
- Track error count in btRunState
- Log error chain for debugging

---

### 1.3 Decorator Nodes (High-Impact Control Flow)
**Priority: P0 (Critical)**
**Complexity: High**
**Effort: 8-10 hours**

Standard decorators that wrap single child:
- `Invert` - Flip success/failure
- `Repeat:N` - Retry N times
- `Until:condition` - Keep retrying until condition met
- `Guard:condition` - Precondition check before execution
- `Timeout:ms` - Abort if exceeds time
- `AlwaysSucceed` - Never fail (often used with error nodes)

**Files to modify:**
- `frontend/bt.js` - `_runNode()` decorator dispatch (line 239)
- `frontend/app.js` - Decorator UI configuration
- `electron/test.js` - Decorator test cases

**Implementation notes:**
- Treat decorators as nodes with btType='invert|repeat|guard|timeout|alwaysSucceed'
- Store decorator config (btDecoratorParam) on node
- Recursively call `_runNode()` on child, then apply decorator logic

**Example structure:**
```
root(sequence)
├─ loadInput
├─ Invert(
│    └─ checkIfExists
├─ Repeat:3(
│    └─ tryRetry
└─ AlwaysSucceed(
     └─ cleanup
```

---

## Phase 2: State Management & Persistence (P1 - High Priority)

### 2.1 Blackboard Persistence Across Cycles
**Priority: P1**
**Complexity: Medium**
**Effort: 6-8 hours**

Current: Blackboard resets each cycle (line 185 in bt.js)

**To Implement:**
- Persistent blackboard slots (explicit opt-in)
- Cycle-local vs global variables
- Checkpoint/restore mechanism
- Variable versioning (history)
- Cleanup/archive old cycles

**Files to modify:**
- `frontend/bt.js` - `_execute()`, blackboard lifecycle (line 163)
- `frontend/app.js` - Persistent variable UI
- Database layer (if persistence needed beyond session)

**Implementation notes:**
- Add `persistent` flag to blackboard entries
- Separate `_blackboardPersistent` from cycle-local `_blackboard`
- Merge approach: explicit names for persistent vars (e.g., `@globalVar`)

---

### 2.2 Node State & Execution Context
**Priority: P1**
**Complexity: Medium**
**Effort: 4-6 hours**

Per-node execution tracking beyond just success/fail

**To Implement:**
- Execution count per node (how many times run)
- Last execution timestamp
- Total execution time per node
- Node-local counters (for decorators like Repeat)
- Execution path history

**Files to modify:**
- `frontend/bt.js` - `_runNode()` (line 239)
- `frontend/app.js` - State display in tree view

**Implementation notes:**
- Extend btRunState (currently Map<path, status>) to include metadata
- Add performance metrics collection

---

### 2.3 Scoped Variables (Sub-tree Isolation)
**Priority: P1**
**Complexity: High**
**Effort: 8-10 hours**

Blackboard scope hierarchy for complex trees

**To Implement:**
- Local scope per sub-tree (container node)
- Scope chain resolution (child can see parent, not sibling)
- Explicit input/output mappings between scopes
- Namespace prefixing (e.g., `scope:key`)

**Files to modify:**
- `frontend/bt.js` - Blackboard access logic (line 350-361)
- `frontend/app.js` - Scope container UI

**Implementation notes:**
- Maintain scope stack during execution
- Check local scope first, fall back to parent
- Enable reusable sub-tree patterns

---

## Phase 3: Advanced Node Types (P2 - High Value)

### 3.1 Composite Nodes
**Priority: P2**
**Complexity: Medium**
**Effort: 6-8 hours**

Beyond Sequence/Selector/Parallel:
- `Reactive Sequence` - Restart if child fails mid-execution
- `Random Selector` - Random child, not first-to-succeed
- `Weighted Random` - Probability-based child selection
- `Parallel Policy` - Configureable success/failure conditions
- `Switch` - Case/when based on blackboard value

**Files to modify:**
- `frontend/bt.js` - `_runNode()` dispatch (line 239)
- `electron/test.js` - Composite tests

**Implementation notes:**
- Add btCompositePolicy config field
- Parallel already exists; add policy options
- Random nodes need RNG seeding for reproducibility

---

### 3.2 External Action Nodes
**Priority: P2**
**Complexity: High**
**Effort: 10-12 hours**

Beyond processPrompt and loadLocalFile

**To Implement:**
- `wait:duration` - Sleep/delay node
- `http:method:url` - REST API calls
- `webhook` - Call external endpoint
- `database:query` - Query backend
- `conditional:expression` - Evaluate expression
- `javascript:code` - Execute arbitrary JS
- `file:read|write|append` - File operations
- `variable:set` - Explicit variable assignment

**Files to modify:**
- `frontend/bt.js` - `_runLeaf()` action dispatch (line 337)
- `frontend/app.js` - Action configuration UI
- `electron/main.js` - IPC handlers for privileged operations

**Implementation notes:**
- Extend btAction field (currently 'processPrompt', 'loadLocalFile')
- Each action type has own configuration fields (btWaitDuration, btHttpMethod, etc.)
- Use btPrompt interpolation for URL/query templates

---

### 3.3 Conditional Branches (If-Then-Else)
**Priority: P2**
**Complexity: Medium**
**Effort: 6-8 hours**

Simplified decision logic without Selector

**To Implement:**
- `IfThen(condition, thenNode)` - Execute if true
- `IfThenElse(condition, thenNode, elseNode)` - Binary branch
- `Switch(key, cases)` - Multi-branch on variable value

**Files to modify:**
- `frontend/bt.js` - Condition evaluation (line 239)
- `frontend/app.js` - Conditional UI builder

**Implementation notes:**
- Conditions can be:
  - Blackboard variable check (exists, equals value)
  - Expression evaluation
  - Previous step output match
- Store condition as btCondition field (parsed expression)

---

## Phase 4: Debugging & Visibility (P2 - DX Critical)

### 4.1 Execution Timeline & Visualization
**Priority: P2**
**Complexity: High**
**Effort: 10-12 hours**

Real-time execution trace and history

**To Implement:**
- Timeline view of node execution order
- Execution graph (which nodes ran, in what sequence)
- Duration per node (flame graph style)
- Breakpoint support (pause before/after nodes)
- Step-through mode improvements (currently basic step())

**Files to modify:**
- `frontend/app.js` - Timeline visualization panel
- `frontend/bt.js` - Enhanced logging (line 163+)
- New file: `frontend/bt-debug.js` - Debug UI

**Implementation notes:**
- Record execution events: { timestamp, path, status, duration }
- Render as interactive timeline
- Allow filtering by status, type, duration range

---

### 4.2 Blackboard Inspector & Editor
**Priority: P2**
**Complexity: Medium**
**Effort: 6-8 hours**

Current: getBlackboard() exists but no UI

**To Implement:**
- Graphical BB variable editor
- Real-time BB updates during execution
- Search/filter variables
- Export/import BB state (JSON)
- BB snapshots at each execution step
- Variable diff view (what changed)

**Files to modify:**
- `frontend/app.js` - BB inspector panel
- `frontend/bt.js` - Snapshot recording (line 163+)
- Existing: bbSetText, bbSetMedia, bbClearKey (line 28-48)

**Implementation notes:**
- Extend existing manual BB controls
- Add modal/panel for deep inspection
- Allow pause-and-inspect at any step

---

### 4.3 Log & Audit Trail
**Priority: P2**
**Complexity: Low**
**Effort: 4-6 hours**

Better execution history beyond console logs

**To Implement:**
- Structured log format (JSON lines)
- Log levels (INFO, WARN, ERROR, DEBUG)
- Per-node audit (what input→output)
- Log export (download execution trace)
- Filtering by node path, status, time range

**Files to modify:**
- `frontend/bt.js` - Structured logging (currently addLog(), line 179+)
- `frontend/app.js` - Log view panel
- `electron/main.js` - Persistence layer (optional)

**Implementation notes:**
- Extend addLog() to accept structured data
- Store logs in session state initially
- Optional: persist to file for larger traces

---

## Phase 5: Production Features (P3 - Scale & Robustness)

### 5.1 Execution Timeout & Resource Limits
**Priority: P3**
**Complexity: Medium**
**Effort: 6-8 hours**

Prevent runaway execution

**To Implement:**
- Global execution timeout (abort entire tree)
- Per-node timeout
- Async operation cancellation
- Resource monitoring (memory, API calls)
- Rate limiting on external calls

**Files to modify:**
- `frontend/bt.js` - `_execute()`, `_runNode()` (line 163, 239)
- Configuration: btGlobalTimeout, btNodeTimeout

**Implementation notes:**
- Use AbortController for async cancellation
- Track resource usage in btRunState
- Log resource limit violations

---

### 5.2 Caching & Memoization
**Priority: P3**
**Complexity: Medium**
**Effort: 6-8 hours**

Optimization for repeated operations

**To Implement:**
- Node output caching (skip if inputs unchanged)
- Cache invalidation strategy
- Memoization decorator
- Cache hit/miss stats
- Manual cache clear

**Files to modify:**
- `frontend/bt.js` - `_runLeaf()` caching (line 332)
- Configuration: btCacheMode (none|input-based|time-based)

**Implementation notes:**
- Cache key = hash(inputs from blackboard)
- TTL-based expiration for time-based cache
- Add to btRunState for visibility

---

### 5.3 Parallel Execution Policies
**Priority: P3**
**Complexity: High**
**Effort: 8-10 hours**

Fine-grained control over Parallel node behavior

**To Implement:**
- Success policies: All, Any, AtLeast:N, Majority
- Failure policies: First, Last, None
- Synchronization barriers
- Task priority/ordering
- Cancellation propagation

**Files to modify:**
- `frontend/bt.js` - Parallel execution (line 320)
- Configuration: btParallelSuccessPolicy, btParallelFailurePolicy

**Implementation notes:**
- Currently: Parallel = all must succeed (AND)
- Extend with: any succeed (OR), majority, threshold

---

### 5.4 Context & Dependency Injection
**Priority: P3**
**Complexity: High**
**Effort: 10-12 hours**

Cleaner state management

**To Implement:**
- BT context object (shared read-only during execution)
- Dependency resolution (nodes declare dependencies)
- Service locator pattern
- Context chaining (scope inheritance)
- Mock/stub context for testing

**Files to modify:**
- `frontend/bt.js` - Context management (line 163+)
- `frontend/app.js` - DI configuration UI

**Implementation notes:**
- Separate from blackboard (BB is mutable shared state)
- Context is immutable reference data
- Example: { userId: "123", apiKey: "xxx" }

---

## Phase 6: Integration & Testing (P3 - Quality)

### 6.1 Behavior Tree Validator
**Priority: P3**
**Complexity: Medium**
**Effort: 6-8 hours**

Static analysis before execution

**To Implement:**
- Validate btType values
- Check for dead nodes (unreachable)
- Warn on circular references
- Unused variables detection
- Type mismatch detection (inputKey/outputKey)
- Leaf type compatibility

**Files to modify:**
- `frontend/app.js` - Validator UI warnings
- `electron/test.js` - checkNodeTypeInvariants (already exists, expand it)

**Implementation notes:**
- Run on tree load and before execution
- Extend existing checkNodeTypeInvariants (line 5271+)

---

### 6.2 Test Framework for BTs
**Priority: P3**
**Complexity: High**
**Effort: 10-12 hours**

Unit testing individual BTs

**To Implement:**
- Mock external actions (API, file I/O)
- Scenario-based testing (given tree, when executed with inputs, then...)
- State assertion helpers
- Blackboard state verification
- Coverage analysis (which paths executed)

**Files to modify:**
- New file: `frontend/bt-test-framework.js`
- `electron/test.js` - Framework tests

**Implementation notes:**
- Similar to makeBtApp() in test.js but formalized
- Export test utilities for user trees

---

### 6.3 Performance Profiling
**Priority: P3**
**Complexity: Medium**
**Effort: 6-8 hours**

Identify bottlenecks

**To Implement:**
- Per-node execution time tracking
- Flame graph export
- Slowest nodes ranking
- Execution frequency analysis
- Memory usage per cycle

**Files to modify:**
- `frontend/bt.js` - Timing instrumentation (line 239+)
- `frontend/app.js` - Performance panel

**Implementation notes:**
- Use performance.now() for timing
- Store perf metrics in btRunState
- Aggregate stats across cycles

---

## Phase 7: Advanced Features (P4 - Nice-to-Have)

### 7.1 Reactive Trees (Event-Driven)
**Priority: P4**
**Complexity: Very High**
**Effort: 15-20 hours**

Trees that respond to external events, not just sequential execution

**To Implement:**
- Event listeners on nodes
- Event broadcasting
- Reactive sequences (restart if event fires)
- Interrupt handlers
- Event priority/ordering

**Files to modify:**
- `frontend/bt.js` - Event system architecture (major refactor)

---

### 7.2 Tree Inheritance & Composition
**Priority: P4**
**Complexity: High**
**Effort: 12-15 hours**

Reusable tree templates

**To Implement:**
- Tree extends/inherits from base
- Override node behavior in child trees
- Tree composition (include subtree by reference)
- Variable binding between parent/child
- Hot reload of included trees

**Files to modify:**
- `frontend/app.js` - Tree references UI
- Database/storage layer for tree library

---

### 7.3 Behavior Tree Marketplace
**Priority: P4**
**Complexity: High**
**Effort: 20+ hours**

Share and discover community trees

**To Implement:**
- Export tree as package
- Tree versioning & semver
- Dependency management
- Registry server
- Security validation

**Files to modify:**
- Backend API layer
- Package manager

---

## Implementation Order Summary

### By Quarters (Recommended Timeline)

**Q1 (Weeks 1-4):**
1. Explicit Leaf Node Types (1.1)
2. Error Handling (1.2)
3. Decorator Nodes (1.3) ← High impact
4. BB Persistence (2.1)

**Q2 (Weeks 5-8):**
5. Scoped Variables (2.3)
6. Composite Nodes (3.1)
7. Execution Timeline (4.1)
8. BB Inspector (4.2)

**Q3 (Weeks 9-12):**
9. External Actions (3.2)
10. Conditional Branches (3.3)
11. Timeout/Resource Limits (5.1)
12. Performance Profiling (6.3)

**Q4+ (Nice-to-have):**
- Advanced composite policies
- Context/DI
- Reactive trees
- Tree composition/marketplace

---

## Dependencies Map

```
Foundation (P0) - Blocks all:
├─ Leaf Types (1.1) → enables specialized nodes
├─ Error Handling (1.2) → enables robust chains
└─ Decorators (1.3) → enables control flow patterns

State Management (P1) - Needed for realistic workflows:
├─ BB Persistence (2.1)
└─ Scoped Variables (2.3)

Node Expansion (P2) - Increases expressiveness:
├─ Composite variants (3.1)
├─ External Actions (3.2)
└─ Conditionals (3.3)

Debugging (P2) - Quality of experience:
├─ Timeline visualization (4.1)
├─ BB Inspector (4.2)
└─ Audit trail (4.3)

Production Ready (P3) - Stability:
├─ Timeouts (5.1)
├─ Caching (5.2)
└─ Validator (6.1)

Advanced (P4) - Future:
├─ Reactive execution
└─ Tree reuse/composition
```

---

## Success Criteria

| Phase | Criteria |
|-------|----------|
| **Phase 1** | Can build complex workflows with guards, retries, and error recovery |
| **Phase 2** | Can persist state across cycles and debug mid-execution |
| **Phase 3** | Can integrate external APIs, databases, conditionals |
| **Phase 4** | Timeline/inspector show clear picture of execution |
| **Phase 5** | Production-safe (timeouts, limits, validation) |
| **Phase 6** | BTs can be unit tested reliably |
| **Phase 7** | Advanced patterns (reactive, reusable) supported |

---

## Notes for Implementation

- **Backward compatibility**: Each feature should not break existing trees
- **Configuration**: Extend node btXxx fields as needed; document all new fields
- **Testing**: Add comprehensive tests for each phase before proceeding
- **Documentation**: Keep design docs in sync with implementation
- **User Feedback**: Prioritize based on actual usage patterns
