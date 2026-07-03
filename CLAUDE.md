# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome History Tab Manager — a Chrome MV3 extension that groups currently open tabs by age (or by Chrome window) and supports bulk close, bookmark, and memory-release (`chrome.tabs.discard`) actions. Two surfaces share a single `chrome.runtime.sendMessage` channel to a background service worker:

- `popup.html` + `src/popup.js` — compact summary and one-click "old tab" actions.
- `dashboard.html` + `src/dashboard.js` — full management page with search, filters, selection, group actions, drag-and-drop between windows, and a floating "drop into new window" zone.

The extension uses **no build step**. All source is plain ES modules loaded directly by Chrome.

## Commands

There is no bundler, linter, or transpiler. Development is just pure ES modules + Node's built-in test runner.

```bash
npm test             # run all *.test.mjs under tests/ with `node --test`
npm run check        # `node --check` over every .js source file
```

Run a single test file:

```bash
node --test tests/age-grouping.test.mjs
node --test tests/bookmark-planner.test.mjs
node --test tests/window-grouping.test.mjs
node --test tests/new-window-drop-zone.test.mjs
node --test tests/action-summary.test.mjs
```

Install locally: `chrome://extensions` → Developer mode → Load unpacked → select this folder. Re-load after editing `manifest.json`; UI pages and the service worker pick up JS/CSS changes on reload.

## Architecture

```
popup.html ──┐
             ├─► chrome.runtime.sendMessage ─► src/background.js (service worker)
dashboard.html┘                                          │
                                                        ├─► src/tab-service.js (business logic)
                                                        ├─► src/chrome-api.js (Promise wrappers)
                                                        └─► src/chrome.storage / chrome.history / chrome.windows / chrome.bookmarks
```

### Module layout (`src/`)

- **`chrome-api.js`** — Thin Promise wrappers around every callback-style Chrome API used (`queryTabs`, `removeTabs`, `discardTab`, `updateTab`, `moveTabs`, `queryWindows`, `createWindow`, `focusWindow`, `getCurrentWindow`, `getFromStorage`, `setInStorage`, `searchHistory`, `createBookmark`, `createTab`). Centralizing these keeps the rest of the code Promise-shaped.
- **`age-grouping.js`** — Pure date math. `GROUPS`, `groupTimestamp(ts, now)`, `groupTabs(tabs, now)`, `isOldGroup(key)`. `OLD_GROUP_KEYS = {last-week, two-weeks-ago, one-month-ago, older}` — used by the popup's quick "old tabs" buttons.
- **`window-grouping.js`** — Pure grouping by `tab.windowId`. Produces the same `{ key, label, tabs: [{ ..., groupKey, groupLabel }] }` shape as age-grouping, plus a `windowId` field used by the dashboard's drag targets and the "move to window" dropdown. Current window is sorted first; labels are sequential `窗口1`, `窗口2`, … (with `· 当前` suffix).
- **`bookmark-planner.js`** — Pure planning: `BOOKMARK_MODES.{FLAT,FOLDER,GROUPED}`, `defaultFolderName`, `sanitizeBookmarkTabs` (drops `chrome://` and `chrome-extension://` URLs), `createBookmarkPlan`, `groupBookmarkTabs`. Does not touch the Chrome API.
- **`action-summary.js`** — Formats `{succeeded, skipped, failed, errors}` into the Chinese status string `完成 X，跳过 Y，失败 Z，…`.
- **`tab-service.js`** — The only file that combines Chrome APIs with business logic. Owns:
  - Metadata persistence in `chrome.storage.local` under `tabAgeMetadata` (`recordTabOpened`, `removeTabMetadata`, `replaceTabMetadata`, `reconcileOpenTabs`, `estimateMetadataForTab`).
  - `getTabGroups({ mode })` — reconciles metadata, queries tabs, builds view-models, and dispatches to either `age-grouping` or `window-grouping`.
  - Bulk actions returning summary objects: `closeTabs`, `discardTabs`, `bookmarkTabs`, `moveTabsToWindow`, `createWindowWithTabs`, `activateTab`, `listWindows`.
  - `SkipTabError` is a private class; actions inside `runPerTab` convert it to `summary.skipped`, everything else to `summary.failed`.
- **`background.js`** — MV3 service worker (ES module). Wires `chrome.tabs.onCreated/onRemoved/onReplaced` to metadata updates, and `chrome.runtime.onMessage` to the dispatch table in `handleMessage`. Every message returns `{ ok: true, payload }` or `{ ok: false, error }`; the sender-side promise wrapper in `popup.js`/`dashboard.js` rejects on `ok:false`.
- **`popup.js`**, **`dashboard.js`** — UI controllers. Hold local `state`, call `sendMessage`, render via `innerHTML` (with `escapeHtml`/`escapeAttribute` in dashboard for safety). Dashboard persists the user's last grouping mode in `sessionStorage` under key `dashboardMode`.
- **`new-window-drop-zone.js`** — Floating bottom-right drop zone shown during a tab drag. Exposes pure helpers `computeZonePosition` and `isZoneActive` (covered by tests) plus the `NewWindowDropZone` class which reads `application/x-tab-ids` from the drag payload and invokes the host's `onDrop(tabIds)` callback. Drag payload format is set in `dashboard.js#handleDragStart` — keep the two in sync.
- **`styles.css`** — Shared by both surfaces.

### Data model

View model produced by `createTabViewModel`:

```
{ tabId, windowId, title, url, favIconUrl,
  active, pinned, discarded, audible,
  currentWindow, isExtensionOwned,
  ageTimestamp, ageSource: "recorded" | "estimated" | "unknown" }
```

Stored metadata (`chrome.storage.local["tabAgeMetadata"]`):

```
{ tabId, windowId, url,
  openedAt | null, estimatedOpenedAt | null,
  ageSource, createdByVersion, updatedAt }
```

### Grouping strategies

`getTabGroups` dispatches on `mode` ∈ `{ BY_AGE, BY_WINDOW }`. Both grouping modules intentionally produce the same shape (`{ key, label, tabs: [{..., groupKey, groupLabel}] }`) so the dashboard renderer doesn't branch on mode — it only reads `groupKey`/`groupLabel`. The dashboard wires the mode into drag-and-drop and the "move to" dropdown only when `BY_WINDOW`.

### Hybrid age strategy

- After install/upgrade, every new tab is recorded via `chrome.tabs.onCreated` → `recordTabOpened` (ageSource `recorded`).
- On `onInstalled`/`onStartup` and on every `getTabs` call, `reconcileOpenTabs` walks all open tabs:
  - Same `tabId` + same URL → keep and refresh `windowId`/`updatedAt`.
  - Same URL, different tabId → reassign metadata (tabs are reused by Chrome when reloading, so URLs recur).
  - Otherwise → `estimateMetadataForTab` queries `chrome.history.search` and falls back to `ageSource: "unknown"`.
- Chrome tab IDs are runtime-scoped and don't survive a browser restart; the URL-based reconciliation is what makes age tracking survive restarts.

### Dashboard interactions worth knowing

- Selecting tabs: row body click toggles the checkbox; the checkbox's native `change` event is what mutates `selectedTabIds`.
- Drag-and-drop is only enabled in `BY_WINDOW` mode. Drop targets are `<article class="tab-group">` with `data-window-id`. Drop payload key is `application/x-tab-ids` (JSON array of tab IDs), with `text/plain` as fallback.
- Dropping outside a target but on the floating zone (`NewWindowDropZone`) calls `createWindowWithTabs` instead.
- Bulk move uses `runMove` (single message `moveTabs`) for group drops and `runSelectedMove` for the dropdown.
- `moveTabsToWindow` filters out `isExtensionOwned` tabs and the source-window case; failures throw `SkipTabError` so the summary attributes them to "skipped" rather than "failed".

## Testing

Only the pure modules are unit-tested. Chrome-dependent code (`tab-service.js`, `background.js`, UI) is verified manually by reloading the extension — there is no DOM mock or fake Chrome.

When adding new pure helpers (date math, grouping, planning, formatting), add a sibling `tests/*.test.mjs` file using `node:test` + `node:assert/strict`. When adding a new grouping module, mirror the shape from `age-grouping.js`/`window-grouping.js` so the dashboard renderer keeps working unchanged.

## Conventions

- UI strings are Chinese (`今天`, `窗口1 · 当前`, `完成 X，跳过 Y`, etc.). Keep new strings in Chinese to match.
- New bulk actions should follow the `runPerTab` + `SkipTabError` pattern and return `{ succeeded, skipped, failed, errors }` so they plug into `formatActionSummary` automatically.
- New grouping strategies should produce `{ key, label, tabs }` with each tab carrying `groupKey` and `groupLabel` to stay compatible with `dashboard.js#renderGroup`.
- Keep pure modules Chrome-free — anything that imports `./chrome-api.js` is excluded from `npm test`.