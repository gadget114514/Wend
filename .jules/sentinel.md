## 2024-05-24 - Cross-Site Scripting (XSS) in HTML Attributes
**Vulnerability:** `escapeHtml` does not escape single quotes (`'`), leading to XSS vulnerabilities when used in HTML attributes defined with single quotes, e.g., `onclick="app.foo('${this.escapeHtml(payload)}')"`.
**Learning:** This repo frequently builds HTML strings via template literals and sets `innerHTML`. The `escapeHtml` function missed replacing `'` with `&#39;`.
**Prevention:** Always escape single quotes in HTML sanitization functions that might be used inside attributes, especially when they are surrounded by single quotes.
