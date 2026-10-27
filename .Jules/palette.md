## 2024-03-24 - Accessibility improvements for close buttons
**Learning:** Found multiple close buttons (X) lacking `aria-label`s, which makes them inaccessible to screen readers. We must ensure every action button has a proper label.
**Action:** Always add an explicit, translated `aria-label` (e.g. using `data-i18n-aria-label="Close"`) to icon-only close buttons.
