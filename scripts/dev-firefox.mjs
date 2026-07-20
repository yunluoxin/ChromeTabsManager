// Assembles dist/firefox/ — a loadable Firefox extension directory.
//
// Files are COPIED, not symlinked: Firefox's extension process reads files
// from a sandbox and does not reliably resolve symlinks that point outside
// the extension root (the popup then loads as an empty document). Copying
// sidesteps that entirely.
//
// Usage:
//   node scripts/dev-firefox.mjs          one-shot sync, then exit
//   node scripts/dev-firefox.mjs --watch  keep running; re-copy on change
//
// Then in Firefox: about:debugging → This Firefox → Load Temporary Add-on →
// pick dist/firefox/manifest.json. In watch mode, after editing source just
// hit "Reload" on the extension card (Firefox has no auto-reload).

import { cp, mkdir, rm, watch } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "firefox");

// Every top-level entry the extension needs at runtime, besides the manifest.
const SYNCED_ENTRIES = ["src", "popup.html", "dashboard.html", "snapshots.html", "lazy-tab.html"];

async function sync() {
  await mkdir(outDir, { recursive: true });

  // Firefox gets its own manifest (background.scripts + gecko id).
  await cp(
    path.join(root, "platforms", "firefox", "manifest.json"),
    path.join(outDir, "manifest.json"),
    { force: true }
  );

  for (const entry of SYNCED_ENTRIES) {
    await cp(path.join(root, entry), path.join(outDir, entry), {
      recursive: true,
      force: true
    });
  }
}

async function main() {
  const watchMode = process.argv.includes("--watch");

  await sync();
  console.log(`dist/firefox synced (${SYNCED_ENTRIES.length} entries + manifest).`);

  if (!watchMode) {
    console.log(`\nLoad it: about:debugging → This Firefox → Load Temporary Add-on → dist/firefox/manifest.json`);
    return;
  }

  console.log(`watching for changes… (reload the add-on in Firefox after edits)`);

  // Re-sync on any change under the synced entries. Firefox keeps the loaded
  // copy cached until you press Reload, so a debounce is enough — we just
  // need dist/ to be current by the time the user reloads.
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await sync();
        console.log(`[${new Date().toLocaleTimeString()}] re-synced`);
      } catch (error) {
        console.error(`re-sync failed: ${error.message}`);
      }
    }, 200);
  };

  const watchers = SYNCED_ENTRIES.map((entry) =>
    watch(path.join(root, entry), { recursive: true })
  );
  for (const watcher of watchers) {
    (async () => {
      for await (const _event of watcher) schedule();
    })();
  }
}

main().catch((error) => {
  console.error(`dev-firefox failed: ${error.message}`);
  process.exit(1);
});
