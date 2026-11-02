## 2023-11-02 - Hoisting static object out of recursive tree rendering function
**Learning:** In vanilla JS UI rendering, creating object dictionaries like `_iconMap` inside a recursive `buildTreeHTML` function causes massive memory allocation and GC churn for large trees.
**Action:** Move static maps and dictionaries outside of the rendering loop/recursive function to reuse a single instance.
