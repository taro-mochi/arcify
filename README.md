# Arcify

Arcify provides deterministic Arc-style favorites, saved tab groups, and last-used-tab switching in Google Chrome.

## Why v0.8 is different

Earlier prototypes reacted to Chrome lifecycle events such as window creation, tab pin changes, focus changes, startup, and session restoration. Chrome can emit the same events while restoring or resuming browser state, and those events do not identify whether a change came from the user, Chrome, or an extension.

Version 0.8 therefore uses an explicit model:

- Arcify changes tabs only after an Arcify button or command is invoked.
- Chrome startup, sleep/wake, focus changes, and ordinary tab activation never create, pin, unpin, close, or regroup tabs.
- `Command + N` can be remapped to Arcify's explicit **Open Arcify window** command with the included Karabiner rule.
- Native pin/unpin changes are saved when the user clicks **Save this window** or **Save favorites**.

This design intentionally favors predictable behavior over background “repair” logic.

## Features

- Save the pinned tabs and native tab groups from the current window.
- Open a new Chrome window populated from the saved workspace.
- Restore only favorites or only groups into the current window.
- Toggle between the current and previously visited tab.
- Local-only storage with no backend, telemetry, content scripts, or host permissions.

## Install

1. Keep your existing `icons/` folder.
2. Copy the v0.8 files into the Arcify extension directory.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Reload Arcify.
6. In a clean Chrome window, arrange the pinned tabs and groups you want.
7. Click the Arcify toolbar button and choose **Save this window**.

## Reliable new windows

Chrome does not expose a trustworthy “the user pressed Command + N” signal to extensions. For reliable automatic workspaces, use the included Karabiner rule:

1. Copy `karabiner/arcify.json` into:

   ```text
   ~/.config/karabiner/assets/complex_modifications/arcify.json
   ```

2. In Karabiner-Elements, open **Complex Modifications**.
3. Enable **Chrome: Command + N opens a deterministic Arcify window**.
4. Confirm `open-arcify-window` is assigned to `Control + Shift + 9` at:

   ```text
   chrome://extensions/shortcuts
   ```

Physical `Command + N` will then invoke Arcify, which creates and initializes the new window directly.

## Updating favorites and groups

Arcify deliberately does not infer intent from Chrome's native pin/unpin events.

To update the workspace:

1. Pin/unpin tabs and edit tab groups normally.
2. Click **Save this window**.

The next Arcify-created window will use that saved state.

## Privacy and permissions

Arcify requests:

- `tabs` to read URLs of tabs that the user explicitly saves.
- `storage` to keep the local workspace configuration.
- `tabGroups` to save and restore native Chrome tab groups.

Arcify has:

- no host permissions
- no content scripts
- no page injection
- no cookie access
- no history or bookmarks access
- no network requests
- no analytics
- no backend
- no Incognito access

Saved URLs are sanitized before persistence. URL fragments and common authentication/session query parameters are removed. Runtime workspace data is stored in `chrome.storage.local` in the user's Chrome profile and is not present in the source repository.

## Architecture

```text
manifest.json
background.js   Explicit commands, popup messages, window creation, MRU switching
groups.js       Pure save/restore functions for native Chrome groups
storage.js      Schema validation, URL sanitization, migration, local persistence
popup.html
popup.css
popup.js
karabiner/arcify.json
```

There are intentionally no listeners for:

- `chrome.tabs.onUpdated`
- `chrome.windows.onCreated`
- `chrome.windows.onFocusChanged`
- `chrome.runtime.onStartup`

Those events previously caused restore and sleep/wake races.

## Development checks

```bash
node --check background.js
node --check groups.js
node --check storage.js
node --check popup.js
python3 -m json.tool manifest.json >/dev/null
```

Format with:

```bash
npx --yes prettier --write manifest.json background.js groups.js storage.js popup.js popup.html popup.css
```
