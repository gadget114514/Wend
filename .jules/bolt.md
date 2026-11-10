## YYYY-MM-DD - [Debounce frontend filters]
**Learning:** Functions like `filterProjectList` and `filterRecipeSelectDialog` are fired on every input event. Without debouncing, this can cause unnecessary re-renders.
**Action:** Wrap these filtering methods with a `setTimeout` based debounce mechanism to improve performance.
