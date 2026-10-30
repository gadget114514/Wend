## 2024-05-19 - [Icon Button Accessibility]
**Learning:** This app relies heavily on icon-only buttons for core pipeline controls but uses `title` and `data-i18n-title` which are unreliable for screen readers. Support for `data-i18n-aria-label` was documented in memory but completely missing in the implementation.
**Action:** Always verify `aria-label` and `data-i18n-aria-label` handler logic when adding icon-only controls, rather than assuming standard `title` attributes are sufficient.
