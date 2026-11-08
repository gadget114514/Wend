## 2024-11-08 - Icon-Only Button Accessibility
**Learning:** Icon-only buttons (like toolbar buttons) in this app require `aria-label` attributes for screen reader accessibility, and must be integrated with the custom internationalization system via `data-i18n-aria-label`.
**Action:** When adding new icon-only buttons, ensure they have an `aria-label` and use `data-i18n-aria-label` for proper translations.
