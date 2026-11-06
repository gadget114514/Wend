## 2024-03-24 - Cross-Site Scripting (XSS) Vulnerability in Interpolated HTML Attributes
**Vulnerability:** Interpolated `JSON.stringify` values in HTML attributes (like `onclick`) within DOM strings were not properly escaped.
**Learning:** `escapeHtml` only escapes HTML elements for innerHTML content. It doesn't safely encode strings for attributes that have their own parsing rules. Specifically, single quotes or double quotes in the `JSON.stringify` result can prematurely break out of the HTML attribute.
**Prevention:** Always use `escapeHtmlAttr` (or create it if it doesn't exist) to properly escape both quotes and HTML entities before inserting dynamically generated strings or JSON objects into HTML attributes when manually constructing DOM output.
