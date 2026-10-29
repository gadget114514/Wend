## 2026-10-29 - Missing i18n support for ARIA labels
**Learning:** The application's custom i18n system lacked support for translating the `aria-label` attribute on icon-only buttons, reducing accessibility for screen-reader users.
**Action:** Add i18n support for `data-i18n-aria-label` in `app.js` and ensure icon-only buttons use this pattern to remain accessible.
