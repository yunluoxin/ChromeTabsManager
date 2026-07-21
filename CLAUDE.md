# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome History Tab Manager — a cross-browser MV3 extension (Chrome + Firefox) that groups currently open tabs by age (or by browser window) and supports bulk close, bookmark, and memory-release (`tabs.discard`) actions. Two surfaces share a single `runtime.sendMessage` channel to a background worker:

- `popup.html` + `src/popup.js` — compact summary and one-click "old tab" actions.
- `dashboard.html` + `src/dashboard.js` — full management page with search, filters, selection, group actions, drag-and-drop between windows, and a floating "drop into new window" zone.

The extension uses **no build step**. All source is plain ES modules loaded directly by the browser.

## Multi-browser support

- **`src/chrome-api.js` is the only file allowed to touch `chrome`/`browser`.** It exports `api` (= `browser` when present, else `chrome` — detection order matters because Firefox aliases `chrome`). Business code imports wrappers from here; new API needs get a wrapper first.
- **Capability detection, never UA sniffing**: e.g. `tabs.onReplaced` is Chromium-only, so call sites do `if (api.tabs.onReplaced)`. New Chromium-family browsers then work automatically.
- **`src/system-urls.js`** — pure `isSystemUrl()` covering `chrome://`, `chrome-extension://`, `about:`, `moz-extension://`, `edge://`, Safari schemes. Bookmark/snapshot filters go through it.
- **Manifests fork** (hard requirement — Firefox rejects `background.service_worker`, Chrome rejects `background.scripts`):
  - Root `manifest.json` — Chrome; load the repo root via Load unpacked. Declares `"incognito": "split"` so the popup / dashboard / snapshots pages can load into incognito tabs. Without it, Chrome silently blocks `chrome-extension://` navigations to incognito windows and popup buttons appear to do nothing. Firefox treats `split` as `not_allowed`, so we can't share the key.
  - `platforms/firefox/manifest.json` — Firefox (`background.scripts` + fixed `browser_specific_settings.gecko.id`, which keeps `storage.local` data stable across reloads/restarts). No incognito key — Firefox has no analogous restriction.
- **Scripts**: `npm run dev:firefox` assembles `dist/firefox/` (Firefox manifest + symlinks back to source — edit source, just reload in Firefox). `npm run pack:firefox` builds an unsigned `.xpi` for permanent install in Firefox Developer Edition (`xpinstall.signatures.required=false`). Load temporary add-ons from `about:debugging` → `dist/firefox/manifest.json`.

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

- **`chrome-api.js`** — The only file touching the extension API namespace. Exports `api` (`browser` ?? `chrome`), thin Promise wrappers (`queryTabs`, `removeTabs`, `discardTab`, `updateTab`, `moveTabs`, `queryWindows`, `createWindow`, `focusWindow`, `getCurrentWindow`, `getFromStorage`, `setInStorage`, `searchHistory`, `createBookmark`, `createTab`, `getExtensionUrl`, `getExtensionVersion`), and the sender-side `sendMessage` (handles the `{ok, payload|error}` envelope + `runtime.lastError` on Chromium). UI pages use this `sendMessage`, not `chrome.runtime.sendMessage`.
- **`system-urls.js`** — Pure `isSystemUrl()` helper (all browser-internal schemes). Used by `bookmark-planner.js` and `tab-snapshot.js`.
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

### Chrome quirks to remember

These are real Chrome MV3 behaviors that Firefox doesn't share; if you ever feel like removing the workarounds, re-read this section first.

- **`windows.getCurrent()` from the service worker is unreliable in MV3.** It can return a stale or wrong window — the only safe source for "the window the user is interacting with" is `tabs.query({active: true, lastFocusedWindow: true})` from the UI page itself. That is why `queryLastFocusedActiveTab` exists in `chrome-api.js` and `popup.js`/`snapshots.js` call it on click instead of trusting the `currentWindowId` returned by `getTabGroups`. Firefox gives the same answer either way.
- **Default spanning incognito mode blocks extension-page loads into incognito tabs.** This is why the manifest declares `"incognito": "split"` and why popup buttons appear to do *nothing* in incognito if you ever remove it. Firefox does not have this restriction.
- **`tabs.discard` is rate-limited.** Discarding very many tabs at once will reject; the bulk release path already retries in chunks.
- **`tabs.move` rejects cross incognito / normal boundaries.** `moveTabsToWindow` translates that into `SkipTabError` so the summary shows "skipped" rather than "failed".
- **Incognito windows refuse `chrome://` URLs** — `chrome://extensions`, `chrome://settings`, `chrome://flags`, etc. all refuse to open in an incognito window regardless of `incognito: "split"`. This is a Chrome browser-level design choice to keep private sessions from leaking the user's extension list or settings. Firefox allows `about:addons` etc. in private windows without ceremony. If a user needs to tweak the extension from inside an incognito window, they have to bounce back to a normal window.

## Testing

Only the pure modules are unit-tested. Chrome-dependent code (`tab-service.js`, `background.js`, UI) is verified manually by reloading the extension — there is no DOM mock or fake Chrome.

When adding new pure helpers (date math, grouping, planning, formatting), add a sibling `tests/*.test.mjs` file using `node:test` + `node:assert/strict`. When adding a new grouping module, mirror the shape from `age-grouping.js`/`window-grouping.js` so the dashboard renderer keeps working unchanged.

## Conventions

- UI strings are Chinese (`今天`, `窗口1 · 当前`, `完成 X，跳过 Y`, etc.). Keep new strings in Chinese to match.
- New bulk actions should follow the `runPerTab` + `SkipTabError` pattern and return `{ succeeded, skipped, failed, errors }` so they plug into `formatActionSummary` automatically.
- New grouping strategies should produce `{ key, label, tabs }` with each tab carrying `groupKey` and `groupLabel` to stay compatible with `dashboard.js#renderGroup`.
- Keep pure modules Chrome-free — anything that imports `./chrome-api.js` is excluded from `npm test`.
- Never write `if (isFirefox)` — write `if (api.someFeature)`. Never use `chrome.` or `browser.` outside `chrome-api.js` (the `api` export is fine elsewhere).