## 2023-10-24 - Electron Window Navigation Security
**Vulnerability:** Untrusted external URLs could navigate away from the application or open unauthorized windows within the app context.
**Learning:** Default Electron settings allow potentially unsafe window/navigation behavior.
**Prevention:** Implement `setWindowOpenHandler` and `will-navigate` listeners to deny untrusted contexts and safely route valid URLs (`http:`/`https:`) using `shell.openExternal`. Ensure checks account for development environments (`devMode`) appropriately.
