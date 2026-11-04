## 2024-05-18 - Safe Modification of JSON Translation Files
**Learning:** Naive regex manipulation or manual string appending of JSON files for translations runs a high risk of breaking the file or overwriting keys if not perfectly handled. Using a small Node script to parse and write the JSON guarantees structure.
**Action:** Next time translations need to be added from bash, always write a quick JS script to use `JSON.parse` and `JSON.stringify` to update the dictionary file safely.
