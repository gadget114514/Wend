## 2024-05-18 - Modals A11y
**Learning:** Modal close buttons `<span class="modal-close">\times;</span>` are spans and lack proper accessibility roles and labels for screen readers. Since they act like buttons, they need `role="button"`, `tabindex="0"`, `aria-label="Close"` (using the existing i18n key `data-i18n-aria-label="Close"`).
**Action:** Ensure all interactive spans masquerading as buttons have proper button semantics, focusability, and ARIA labels. Also added `data-i18n-aria-label` handling to the translation engine in `frontend/app.js`.
