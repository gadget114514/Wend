## 2024-03-24 - Missing escapeHtmlAttr
**Vulnerability:** XSS via unescaped HTML attributes.
**Learning:** Manual DOM strings construction needs escapeHtmlAttr to prevent XSS when passing stringified payloads.
**Prevention:** Implement and use escapeHtmlAttr for attribute values.
