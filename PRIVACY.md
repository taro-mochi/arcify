# Arcify Privacy

Arcify is local-only.

- No analytics, telemetry, backend, or remote requests.
- No content scripts or code injection.
- No cookie, history, bookmarks, or web-request access.
- Incognito use is disabled.
- Local extension storage is restricted to trusted extension contexts.
- Only URLs and native group metadata needed for the saved workspace are persisted.
- Tab titles are not persisted.
- URL fragments and common credential/session parameters are removed before storage.
- URLs containing embedded HTTP credentials are rejected.

Publishing the Arcify source code does not publish the user's Chrome extension storage. Do not commit Chrome profile directories, exported extension storage, logs, or local backup files.
