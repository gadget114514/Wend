## 2023-11-01 - Icon Button Accessibility
**Learning:** Icon-only buttons lack proper labels for screen readers. In Wend's dynamic translation framework, this means we should add `aria-label` (and `data-i18n-aria-label`) attributes so both English and localized screen readers read out what the buttons do.
**Action:** When I see icon-only buttons like those in the main UI (play, pause, stop, step, blackboard, retry, lock, copy, clear, refresh), I must add `aria-label` with English defaults and `data-i18n-aria-label` pointing to their i18n keys to ensure accessibility.
