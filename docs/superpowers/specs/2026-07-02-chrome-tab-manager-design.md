# Chrome Tab Manager Extension Design

## Goal

Build a Chrome MV3 extension that manages all currently open Chrome tabs by estimated age groups. The extension should support quick actions from a popup and deeper bulk management from a full management page.

## Product Shape

Use **Option C: popup + full management page**.

- The popup gives a compact summary and common one-click actions.
- The management page supports searching, selecting, grouping, closing, bookmarking, and memory-releasing tabs in bulk.
- A plain web page is not enough because browser tab management requires Chrome extension APIs.

## Core User Flows

### Quick Popup

The extension popup shows:

- Total open tab count across all Chrome windows.
- Current window tab count.
- Age-group summary, such as today, last week, two weeks ago, one month ago, and unknown or estimated.
- Shortcut actions:
  - Open full management page.
  - Bookmark old tabs.
  - Close old tabs.
  - Discard eligible background tabs to release memory.

### Full Management Page

The management page shows all open tabs in grouped sections.

Users can:

- View tabs grouped by age.
- Filter by all windows or the current window.
- Hide or include extension-owned tabs.
- Search by title or URL.
- Select individual tabs, entire groups, or all tabs.
- Close selected tabs.
- Bookmark selected tabs.
- Discard selected eligible tabs to release memory.

## Time Grouping Strategy

Use a hybrid strategy:

1. **Real open time after installation**
   - The background service worker listens to tab creation and update events.
   - Newly observed tabs get a recorded `openedAt` timestamp.
   - This timestamp is persisted in extension storage by tab id and refreshed when tab lifecycle events require it.
   - On browser restart or extension startup, the extension reconciles currently open tabs against stored metadata by tab id and URL because Chrome tab ids are runtime-scoped.

2. **Estimated time for pre-existing tabs**
   - On first install or startup, the extension scans existing open tabs.
   - For tabs without a recorded `openedAt`, it queries Chrome history for the tab URL.
   - If history has a matching recent visit, use that visit time as `estimatedOpenedAt`.
   - These tabs are visibly labeled as estimated.
   - If no useful history entry exists, place the tab in an unknown group.

Age groups:

- Today
- Yesterday
- This week
- Last week
- Two weeks ago
- One month ago
- Older
- Unknown or estimated fallback

The exact boundary labels should be centralized in one grouping module so they are easy to adjust.

## Bookmarking Behavior

Bookmark actions support individual tabs, selected groups, and all open tabs.

When bookmarking, users choose one of:

- **Flat mode**: add bookmarks directly under the selected parent bookmark folder.
- **Folder mode**: create one folder and add all selected tabs inside it.
- **Grouped folder mode**: create a parent folder, then one child folder per age group.

Folder naming:

- If the user enters a folder name, use it.
- If no folder name is provided, default to `{YYYY-MM-DD} {group label}` for single-group actions.
- For multi-group actions, default to `{YYYY-MM-DD} Chrome Tabs`.

The management page should show a confirmation summary before large bookmark actions.

## Closing Behavior

Closing supports:

- One tab.
- Selected tabs.
- One group.
- All visible tabs.
- All tabs.

Safety rules:

- Require confirmation for destructive bulk close actions.
- Exclude the extension popup and dashboard tabs from destructive default selections.
- Avoid closing the active tab that hosts the management page until the action is complete, unless the user explicitly selects it.
- Show skipped tabs if Chrome refuses an operation.

## Memory Release Behavior

Chrome supports releasing memory for inactive tabs through tab discard behavior. The extension should expose this as “释放内存” or “Release memory”.

Implementation intent:

- Use `chrome.tabs.discard` for eligible background tabs.
- Do not discard active tabs.
- Do not discard pinned tabs by default; allow this later only behind an explicit setting.
- Do not discard tabs with unsaved-sensitive states if Chrome reports they are not discardable.
- Report skipped tabs with a short reason when possible.

This feature depends on available Chrome extension APIs and Chrome version behavior. If a tab cannot be discarded, the UI should treat that as a skipped operation, not an error.

## Architecture

### Extension Manifest

Use Manifest V3.

Likely permissions:

- `tabs`
- `bookmarks`
- `history`
- `storage`

Likely extension surfaces:

- `action.default_popup` for the quick popup.
- Extension page route for the full management dashboard.
- Background service worker for tab observation and storage maintenance.

### Modules

- `background`
  - Observes tab creation, replacement, updates, and removal.
  - Maintains tab age metadata.
  - Handles requests from UI pages for tab data and actions.

- `tabRepository`
  - Wraps Chrome tab APIs.
  - Lists all open tabs.
  - Closes selected tabs.
  - Discards eligible tabs.

- `ageMetadataStore`
  - Persists `openedAt`, `estimatedOpenedAt`, and confidence metadata.
  - Cleans up records when tabs close.

- `ageGrouping`
  - Converts timestamps into display groups.
  - Keeps date boundary logic testable and independent of Chrome APIs.

- `bookmarkService`
  - Creates bookmarks in flat, folder, or grouped folder mode.
  - Generates default folder names.

- `popupUi`
  - Shows summary counts and shortcuts.
  - Links to the management page.

- `dashboardUi`
  - Provides search, filters, selection, group actions, and confirmations.

## Data Model

Tab view model:

- `tabId`
- `windowId`
- `title`
- `url`
- `favIconUrl`
- `active`
- `pinned`
- `discarded`
- `audible`
- `ageTimestamp`
- `ageSource`: `recorded`, `estimated`, or `unknown`
- `groupKey`
- `groupLabel`

Stored metadata:

- `tabId`
- `windowId`
- `url`
- `openedAt`
- `estimatedOpenedAt`
- `ageSource`
- `createdByVersion`
- `updatedAt`

## Error Handling

- Chrome API failures should be displayed as action summaries rather than raw errors.
- Bulk actions should return counts for succeeded, skipped, and failed tabs.
- Restricted URLs such as `chrome://` pages may have limited capabilities and should be skipped gracefully.
- Extension-owned dashboard tabs should be protected from accidental bulk close and discard.
- Missing history data should place tabs in unknown rather than blocking the UI.

## Testing Plan

Unit tests:

- Date grouping boundaries.
- Default bookmark folder names.
- Bookmark mode planning.
- Bulk action result aggregation.

Manual extension tests:

- Install unpacked extension.
- Open multiple windows with varied tabs.
- Verify existing tabs get estimated or unknown age.
- Open new tabs and verify recorded age.
- Bookmark one tab, one group, and all tabs.
- Close one tab, one group, and all visible tabs.
- Release memory for background tabs and verify active tabs are skipped.

## Initial Implementation Scope

The first implementation should include:

- MV3 extension scaffold.
- Popup summary with shortcut to full page.
- Full dashboard listing open tabs grouped by hybrid age.
- Selection controls.
- Close selected/group/all.
- Bookmark selected/group/all with flat or folder mode.
- Discard selected/group/all eligible background tabs.

Nice-to-have later:

- Drag-and-drop group rearrangement.
- Saved cleanup presets.
- Per-domain grouping.
- Undo-like recovery through recently bookmarked closed groups.
