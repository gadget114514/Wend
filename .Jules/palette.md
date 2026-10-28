## 2026-10-28 - Adding aria-label support to translation system
**Learning:** This static, no-build app uses custom `data-i18n` attributes to handle translations via JavaScript, but it doesn't currently support `data-i18n-aria-label` for screen readers. Buttons like 'Copy all logs' or 'Clear logs' or 'Refresh' are icon-only buttons, but lack accessibility features.
**Action:** Add `data-i18n-aria-label` handling in `frontend/app.js` and add the appropriate attributes and lang strings.
