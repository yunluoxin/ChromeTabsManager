// No-flash theme bootstrap: read the OS preference synchronously before
// first paint and stash it on <html data-theme-bootstrap>. The module
// entry point (popup.js / dashboard.js) then refines it from
// chrome.storage.local via theme.js#applyTheme.
//
// Loaded as a plain (non-module, non-deferred) <script> in the HTML so it
// runs synchronously while the parser is still building the document.
// This avoids both the FOUC that would happen if we waited for the module
// entry point and the CSP violation that Chrome MV3 enforces against
// inline <script> blocks.
(function () {
  try {
    var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    var prefersDark = mq && mq.matches;
    document.documentElement.dataset.themeBootstrap = prefersDark ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.themeBootstrap = "light";
  }
})();