# Chrome History Tab Manager

A lightweight Chrome MV3 extension for managing currently open tabs by age group.

## Features

- Popup summary for quick cleanup.
- Full dashboard for search, selection, and group actions.
- Hybrid age strategy: recorded open time after install, history-based estimate for existing tabs.
- Bulk close, bookmark, and memory release via `chrome.tabs.discard`.
- Dashboard supports two arrangements: **by age** (default) and **by Chrome window**. In window mode you can also drag a tab onto another window to move it, or pick a target window from the bulk panel to move the current selection.

## Install Locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/east/Documents/ChromeHistory`.
5. Pin the extension and open the popup.

## Development

Run pure module tests:

```bash
npm test
```

Run syntax checks:

```bash
npm run check
```

