# Chrome Tab Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a loadable Chrome MV3 extension that groups open tabs by age and supports closing, bookmarking, and memory release from a popup plus full dashboard.

**Architecture:** Use plain HTML/CSS/JavaScript with ES modules to keep the extension lightweight and loadable without a build step. Put Chrome API access in background/service modules and keep date grouping/bookmark planning testable in pure modules.

**Tech Stack:** Chrome Manifest V3, vanilla JavaScript ES modules, CSS, Node.js built-in test runner for pure module tests.

---

## File Structure

- `manifest.json`: MV3 manifest with permissions, action popup, background service worker, and dashboard page.
- `src/background.js`: service worker that tracks tab metadata and handles UI requests.
- `src/chrome-api.js`: promise wrappers for callback-style Chrome APIs.
- `src/age-grouping.js`: pure date grouping helpers.
- `src/bookmark-planner.js`: pure bookmark folder naming and bookmark plan helpers.
- `src/tab-service.js`: tab listing, view-model creation, close, discard, and bookmark actions.
- `popup.html`, `src/popup.js`, `src/styles.css`: compact popup summary and shortcuts.
- `dashboard.html`, `src/dashboard.js`, `src/styles.css`: full tab management UI.
- `tests/age-grouping.test.mjs`: date boundary unit tests.
- `tests/bookmark-planner.test.mjs`: bookmark naming and grouping unit tests.
- `package.json`: Node test script only.
- `README.md`: install and usage instructions.

## Task 1: Project Scaffold

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `README.md`
- Create: `src/styles.css`

- [ ] Create the MV3 manifest with `tabs`, `bookmarks`, `history`, and `storage`.
- [ ] Create a minimal `package.json` with `npm test`.
- [ ] Add base extension styles shared by popup and dashboard.
- [ ] Document unpacked-extension install steps in `README.md`.

## Task 2: Pure Core Modules

**Files:**
- Create: `src/age-grouping.js`
- Create: `src/bookmark-planner.js`
- Create: `tests/age-grouping.test.mjs`
- Create: `tests/bookmark-planner.test.mjs`

- [ ] Write tests for today, yesterday, this week, last week, two weeks ago, one month ago, older, and unknown grouping.
- [ ] Implement date grouping helpers.
- [ ] Write tests for default bookmark folder names and flat/folder/grouped mode planning.
- [ ] Implement bookmark planning helpers.
- [ ] Run `npm test` and expect all pure tests to pass.

## Task 3: Chrome API and Background Service

**Files:**
- Create: `src/chrome-api.js`
- Create: `src/tab-service.js`
- Create: `src/background.js`

- [ ] Wrap Chrome callback APIs in Promise helpers.
- [ ] Implement metadata storage and reconciliation for runtime-scoped tab ids.
- [ ] Implement hybrid age estimation using `chrome.history.search`.
- [ ] Implement message handlers for `getTabs`, `closeTabs`, `bookmarkTabs`, `discardTabs`, and `openDashboard`.
- [ ] Return action summaries with succeeded, skipped, and failed counts.

## Task 4: Popup UI

**Files:**
- Create: `popup.html`
- Create: `src/popup.js`
- Modify: `src/styles.css`

- [ ] Render total/current-window tab counts.
- [ ] Render group summary counts.
- [ ] Add buttons for dashboard, bookmark old tabs, close old tabs, and release memory.
- [ ] Show confirmation prompts for destructive quick actions.
- [ ] Show compact action result messages.

## Task 5: Dashboard UI

**Files:**
- Create: `dashboard.html`
- Create: `src/dashboard.js`
- Modify: `src/styles.css`

- [ ] Render tabs grouped by age with recorded/estimated/unknown labels.
- [ ] Add current-window/all-windows filter and search.
- [ ] Add individual, group, visible, and all selection controls.
- [ ] Add close, bookmark, and discard bulk actions.
- [ ] Add bookmark mode controls: flat, one folder, grouped folders, custom folder name.
- [ ] Protect extension-owned tabs from default destructive selection.

## Task 6: Verification

**Files:**
- Modify as needed only if verification finds scoped issues.

- [ ] Run `npm test`.
- [ ] Run a syntax check over all JavaScript files with Node.
- [ ] Verify `manifest.json` parses as JSON.
- [ ] Manually inspect generated files for extension load readiness.
